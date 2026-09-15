/**
 * Editable PDF / Illustrator import (dogfood parity with the .fig pipeline).
 *
 * Strategy: walk each page's operator list with pdf.js instead of rendering it.
 * Graphics state (CTM, colors, alpha, clip) is replayed by hand so every text
 * run, path, image and Optional Content Group becomes a native DesignImportLayer:
 *
 * - OCG markers (/OC BDC … EMC) → named group layers (Illustrator's Layers panel
 *   when the PDF is saved with "Preserve Illustrator Editing Capabilities").
 * - Text (BT/Tf/Tm/Tj) → editable text layers; embedded font programs are
 *   registered as @font-face data URLs and families are exposed for the
 *   missing-font replacement flow shared with Figma imports.
 * - Paths arrive pre-fused by pdf.js v6 (one constructPath op per painted
 *   path, carrying a DrawOPS buffer + the paint op in user space) → inline
 *   SVG vector layers mapped through the CTM; W/W* clips become clip-path
 *   insets or CSS mask groups; axial/radial shadings (sh, pattern scn) become
 *   SVG gradients (approximate); SMask, tiling/mesh patterns degrade to a
 *   cropped raster patch.
 * - Images (Do/BI) → raster layers persisted later by the modal.
 * - Rect clips ride the graphics state as clip-path insets; complex clips wrap
 *   their content in a CSS mask group (same pattern as Figma imports).
 *
 * Pure geometry/name/bucketing helpers live in pdfImportUtils.ts (Node-testable).
 */
import {
  escapeImportHtml,
  finalizeImportDocument,
  importFontCssValue,
  safeImportId,
  type DesignImportArtboard,
  type DesignImportDocument,
  type DesignImportLayer,
} from "../../shared/designImport.ts";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  applyMatrix,
  bucketTextLines,
  buildPathBuffer,
  cmykToHex,
  grayToHex,
  isAxisAligned,
  matrixScale,
  mulMatrix,
  psFontMeta,
  rgbToHex,
  shadingFillSvg,
  unionBox,
  type Box,
  type BuiltPath,
  type Matrix,
} from "./pdfImportUtils.ts";

const MAX_PDF_PAGES = 50;
const MAX_PAGE_OPS = 300_000;
const MAX_RASTER_EDGE = 4096;
const PAGE_TIME_BUDGET_MS = 20_000;
const MAX_EMBEDDED_FONT_BYTES = 4 * 1024 * 1024;

class PageBudgetError extends Error {
  constructor() {
    super("presupuesto de tiempo por página agotado");
  }
}

interface RectClip { x: number; y: number; width: number; height: number }

interface GState {
  ctm: Matrix;
  fill: string;
  stroke: string;
  ca: number;
  lw: number;
  bm: string | null;
  fontRef: string | null;
  fontSize: number;
  clipRect: RectClip | null;
  /** Depth of clipWrappers when this state was pushed (q). */
  wrapperDepth: number;
}

interface RunSegment {
  x: number;
  y: number;
  fontSize: number;
  width: number;
  text: string;
  key: string;
  container: DesignImportLayer[];
  color: string;
  ca: number;
  bm: string | null;
  clip: RectClip | null;
  family: string;
  weight: number;
  style: "normal" | "italic";
}

interface DocAccumulator {
  usedFonts: Set<string>;
  fontFaceCss: string[];
  embeddedKeys: Set<string>;
  seq: number;
  hiddenLayers: number;
  approximations: Set<string>;
}

function safeGet(store: any, id: string): any {
  if (!store || !id) return null;
  try {
    const value = typeof store.get === "function" ? store.get(id) : store[id];
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

/** Extract an (axial|radial) shading spec from whatever pdf.js stored for a pattern. */
function extractShading(pattern: any): { type: number; coords: number[]; stops: Array<{ offset: number; color: number[] }>; matrix: Matrix | null } | null {
  if (!pattern || typeof pattern !== "object") return null;
  const shading = pattern.shading || pattern.map?.shading || pattern;
  const type = Number(shading.type ?? pattern.type ?? 0);
  const rawCoords = shading.coords || pattern.coords;
  if ((type !== 2 && type !== 3) || !Array.isArray(rawCoords)) return null;
  const coords = rawCoords.map(Number);
  if (coords.length < (type === 2 ? 4 : 6) || coords.some((value: any) => !Number.isFinite(Number(value)))) return null;
  let stops = shading.colorStops || pattern.colorStops || shading.stops || pattern.stops;
  if (Array.isArray(stops) && stops.length && Array.isArray(stops[0])) {
    stops = stops.map((entry: any[]) => ({ offset: Number(entry[0]), color: Array.isArray(entry[1]) ? entry[1].map(Number) : null }));
  }
  if (!Array.isArray(stops) || !stops.length) return null;
  const clean = stops
    .filter((stop: any) => stop && Array.isArray(stop.color) && stop.color.length >= 3 && stop.color.every((value: any) => Number.isFinite(Number(value))))
    .map((stop: any) => ({ offset: Number(stop.offset) || 0, color: stop.color.map(Number) }));
  if (!clean.length) return null;
  const matrix = Array.isArray(pattern.matrix) && pattern.matrix.length === 6 ? pattern.matrix.map(Number) : null;
  return { type, coords, stops: clean, matrix };
}

function pageName(baseName: string, pageNumber: number, total: number): string {
  return total === 1 ? baseName : `${baseName} · ${pageNumber}`;
}

export async function parsePdfDocumentResults(file: File, source: "ai" | "pdf"): Promise<DesignImportDocument> {
  // pdfjs-dist v6 ships named ESM exports only (no default export).
  const [pdfjsModule, buffer] = await Promise.all([import("pdfjs-dist"), file.arrayBuffer()]);
  const pdfjs = pdfjsModule as unknown as { GlobalWorkerOptions: { workerSrc: string }; getDocument: (options: unknown) => { promise: Promise<any>; destroy: () => Promise<void> }; OPS: Record<string, number> };
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false });
  try {
    const pdf: any = await task.promise;
    if (pdf.numPages > MAX_PDF_PAGES) throw new Error("El archivo tiene más de 50 páginas. Divídelo en lotes más pequeños.");
    const OPS = pdfjs.OPS;
    let ocConfig: any = null;
    try {
      if (typeof (pdf as any).getOptionalContentConfig === "function") ocConfig = await (pdf as any).getOptionalContentConfig();
    } catch { /* PDFs without /OCProperties */ }
    // BDC payloads arrive as the objects built by the worker's parseMarkedContentProps
    // ({type:"OCG", id:"4R0"} / {type:"OCMD", …}) — the exact shape that
    // OptionalContentConfig.getGroup()/isVisible() resolve (same Ref ids, same semantics).
    const ocLookup = (payload: any): { name: string; visible: boolean } | null => {
      if (!ocConfig || !payload || typeof payload !== "object") return null;
      try {
        const group = payload.type === "OCG" && payload.id ? ocConfig.getGroup(payload.id) : null;
        return { name: String(group?.name || ""), visible: ocConfig.isVisible(payload) !== false };
      } catch {
        return null;
      }
    };

    const acc: DocAccumulator = { usedFonts: new Set(), fontFaceCss: [], embeddedKeys: new Set(), seq: 0, hiddenLayers: 0, approximations: new Set() };
    const baseName = file.name.replace(/\.(ai|pdf)$/i, "") || (source === "ai" ? "Illustrator" : "PDF");
    const artboards: DesignImportArtboard[] = [];
    const warnings: DesignImportDocument["warnings"] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      try {
        artboards.push(await convertPage({ page, pageNumber, baseName, source, pdf, OPS, ocLookup, acc }));
      } catch (error) {
        if (!(error instanceof PageBudgetError)) {
          warnings.push({ code: "pdf_page_partial", message: `La página ${pageNumber} no se pudo convertir a capas (${error instanceof Error ? error.message : "error desconocido"}); se conservó como imagen.` });
        }
        artboards.push(await rasterFallbackArtboard(page, pageNumber, baseName, source));
        warnings.push({ code: "pdf_page_fallback", message: `La página ${pageNumber} se conservó como imagen de referencia.` });
      } finally {
        page.cleanup();
      }
    }

    if (source === "ai" && pdf.numPages === 1) {
      warnings.push({ code: "ai_artboard_single", message: "El .ai expone una sola página PDF con todo el lienzo. Para traer cada mesa de Illustrator como frame separado, guarda «Adobe PDF» con «Preservar capacidades de edición de Illustrator» y «Páginas» activado." });
    }
    if (acc.hiddenLayers) {
      warnings.push({ code: "ai_hidden_ocg", message: `${acc.hiddenLayers} capa(s) oculta(s) del documento se omitieron en la importación.` });
    }
    const approximationMessages: Record<string, string> = {
      ai_gradient_approx: "Algunos degradados se aproximaron con gradientes SVG.",
      ai_pattern_raster: "Patrones vectoriales y recortes complejos se conservaron como imagen recortada o máscara.",
      ai_smask_raster: "Contenido con máscara de suavizado (SMask) se conservó como imagen recortada.",
      ai_blend_approx: "Modos de fusión no normal se aproximan con mix-blend-mode.",
    };
    for (const [code, message] of Object.entries(approximationMessages)) {
      if (acc.approximations.has(code)) warnings.push({ code, message });
    }

    return finalizeImportDocument({
      version: "futuraria-import/v1",
      name: baseName,
      source,
      artboards,
      warnings,
      report: { editable: 0, approximate: 0, raster: 0 },
      fonts: { used: [...acc.usedFonts], missing: [] },
      fontCss: acc.fontFaceCss.join("\n") || undefined,
    });
  } finally {
    await task.destroy();
  }
}

// ── Per-page conversion ─────────────────────────────────────────────────

async function convertPage(context: {
  page: any;
  pageNumber: number;
  baseName: string;
  source: "ai" | "pdf";
  pdf: any;
  OPS: any;
  ocLookup: (payload: any) => { name: string; visible: boolean } | null;
  acc: DocAccumulator;
}): Promise<DesignImportArtboard> {
  const { page, pageNumber, baseName, source, pdf, OPS, ocLookup, acc } = context;
  const started = Date.now();
  const viewport = page.getViewport({ scale: 1 });
  const width = Math.max(1, Math.ceil(viewport.width));
  const height = Math.max(1, Math.ceil(viewport.height));
  const base: Matrix = Array.from(viewport.transform || [1, 0, 0, -1, 0, height]) as Matrix;

  const list = await page.getOperatorList();
  const fnArray: number[] = list.fnArray;
  const argsArray: any[][] = list.argsArray;
  if (fnArray.length > MAX_PAGE_OPS) throw new PageBudgetError();

  const root: DesignImportLayer[] = [];
  const gstack: GState[] = [{ ctm: base.slice(), fill: "#000000", stroke: "#000000", ca: 1, lw: 1, bm: null, fontRef: null, fontSize: 12, clipRect: null, wrapperDepth: 0 }];
  const gs = () => gstack[gstack.length - 1];
  const ocStack: Array<{ layer: DesignImportLayer; hidden: boolean }> = [];
  const ocMarkers: boolean[] = [];
  const clipWrappers: DesignImportLayer[] = [];
  const segments: RunSegment[] = [];
  let smaskPending = false;
  /** W/W* clip seen; its path arrives in the next fused constructPath. */
  let pendingClip: "normal" | "evenodd" | null = null;
  let textMatrix: Matrix = [1, 0, 0, 1, 0, 0];
  let textLineMatrix: Matrix = [1, 0, 0, 1, 0, 0];
  let textLeading = 0;
  let rasterCanvas: HTMLCanvasElement | null = null;

  const containerId = () => (clipWrappers.length ? clipWrappers[clipWrappers.length - 1].id : ocStack.length ? ocStack[ocStack.length - 1].layer.id : `root-${pageNumber}`);
  const currentContainer = (): DesignImportLayer[] => {
    if (clipWrappers.length) return clipWrappers[clipWrappers.length - 1].children!;
    if (ocStack.length) return ocStack[ocStack.length - 1].layer.children!;
    return root;
  };
  const currentHidden = () => ocStack.some(entry => entry.hidden);
  const nextId = (kind: string) => `${source}-${kind}-${safeImportId(baseName)}-${pageNumber}-${acc.seq++}`;

  /** Apply the active rect clip; null when the layer falls fully outside it. */
  const finalizeLayer = (layer: DesignImportLayer, clip: RectClip | null = gs().clipRect): DesignImportLayer | null => {
    if (!clip) return layer;
    const left = clip.x - layer.x;
    const top = clip.y - layer.y;
    const right = layer.x + layer.width - (clip.x + clip.width);
    const bottom = layer.y + layer.height - (clip.y + clip.height);
    if (left >= layer.width || right >= layer.width || top >= layer.height || bottom >= layer.height) return null;
    if (left <= 0.5 && top <= 0.5 && right <= 0.5 && bottom <= 0.5) return layer;
    const clamp0 = (value: number) => Math.max(0, Math.round(value * 100) / 100);
    layer.style = `${layer.style || ""}clip-path:inset(${clamp0(top)}px ${clamp0(right)}px ${clamp0(bottom)}px ${clamp0(left)}px);`;
    return layer;
  };

  const pushLayer = (layer: DesignImportLayer | null): void => {
    if (!layer) return;
    if (currentHidden()) { acc.hiddenLayers += 1; return; }
    const final = finalizeLayer(layer);
    if (final) currentContainer().push(final);
  };

  const unitSquareBox = (ctm: Matrix): { box: Box; aligned: boolean; matrix: Matrix } => {
    const corners = [applyMatrix(ctm, 0, 0), applyMatrix(ctm, 1, 0), applyMatrix(ctm, 0, 1), applyMatrix(ctm, 1, 1)];
    const xs = corners.map(point => point[0]);
    const ys = corners.map(point => point[1]);
    return {
      box: { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(1, Math.max(...xs) - Math.min(...xs)), height: Math.max(1, Math.max(...ys) - Math.min(...ys)) },
      aligned: isAxisAligned(ctm),
      matrix: ctm,
    };
  };

  /** Cropped raster patch of a device-space region — the honest fallback. */
  const rasterPatch = async (box: Box, code: string): Promise<DesignImportLayer | null> => {
    if (!rasterCanvas) {
      const scale = Math.min(2, MAX_RASTER_EDGE / Math.max(width, height));
      const scaled = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(scaled.width);
      canvas.height = Math.ceil(scaled.height);
      await page.render({ canvasContext: canvas.getContext("2d")!, viewport: scaled }).promise;
      rasterCanvas = canvas;
    }
    const scale = rasterCanvas.width / width;
    const sx = Math.max(0, Math.floor(box.x * scale));
    const sy = Math.max(0, Math.floor(box.y * scale));
    const sw = Math.max(1, Math.min(rasterCanvas.width - sx, Math.ceil(box.width * scale)));
    const sh = Math.max(1, Math.min(rasterCanvas.height - sy, Math.ceil(box.height * scale)));
    if (sw < 2 || sh < 2 || sw * sh > MAX_RASTER_EDGE * MAX_RASTER_EDGE) return null;
    const crop = document.createElement("canvas");
    crop.width = sw;
    crop.height = sh;
    crop.getContext("2d")!.drawImage(rasterCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
    acc.approximations.add(code);
    return {
      id: nextId("patch"),
      name: code === "ai_smask_raster" ? "Contenido enmascarado" : "Patrón",
      kind: "image",
      x: box.x, y: box.y, width: box.width, height: box.height,
      fidelity: "approximate",
      style: "overflow:hidden;",
      html: `<img src="${crop.toDataURL("image/png")}" alt="" draggable="false" style="width:100%;height:100%;object-fit:fill">`,
    };
  };

  const registerFont = (font: any, meta: ReturnType<typeof psFontMeta>) => {
    acc.usedFonts.add(meta.family);
    const data = font?.data;
    if (!data || !(data.byteLength ?? data.length)) return;
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (bytes.length > MAX_EMBEDDED_FONT_BYTES) return;
    const key = `${meta.family}|${meta.weight}|${meta.style}`;
    if (acc.embeddedKeys.has(key)) return;
    acc.embeddedKeys.add(key);
    const mimetype = String(font.mimetype || "font/ttf");
    const format = mimetype.includes("otf") || mimetype.includes("cff") ? "opentype" : "truetype";
    acc.fontFaceCss.push(`@font-face{font-family:${importFontCssValue(meta.family)};src:url(data:${mimetype};base64,${bytesToBase64(bytes)}) format("${format}");font-weight:${meta.weight};font-style:${meta.style};}`);
  };

  const getFont = (ref: string): any => safeGet(page.commonObjs, ref) ?? safeGet(page.objs, ref);

  const emitRun = (glyphs: any[]) => {
    const state = gs();
    if (!state.fontRef || currentHidden()) return;
    const font = getFont(state.fontRef);
    const meta = psFontMeta(String(font?.name || state.fontRef));
    registerFont(font, meta);
    const trm = mulMatrix(state.ctm, textMatrix);
    const scale = matrixScale(trm);
    const fontSize = state.fontSize > 0 ? state.fontSize : Math.abs(scale.y) || 12;
    const fsPx = fontSize * (Math.abs(scale.y) || 1);
    if (!(fsPx >= 0.5) || !Number.isFinite(fsPx)) return;
    let text = "";
    let advance = 0;
    for (const glyph of glyphs) {
      if (typeof glyph === "number") { advance -= glyph; continue; }
      const unicode = glyph?.unicode;
      if (unicode == null) continue;
      text += typeof unicode === "number" ? String.fromCharCode(unicode) : String(unicode);
      advance += Number(glyph.width) || 0;
    }
    if (!text.trim()) return;
    const deviceWidth = Math.abs((advance * fontSize / 1000) * (scale.x || 1));
    segments.push({
      x: trm[4],
      y: trm[5],
      fontSize: fsPx,
      width: Math.max(1, deviceWidth),
      text,
      key: `${meta.key}|${fsPx.toFixed(1)}|${state.fill}|${containerId()}`,
      container: currentContainer(),
      color: state.fill,
      ca: state.ca,
      bm: state.bm,
      clip: state.clipRect,
      family: meta.family,
      weight: meta.weight,
      style: meta.style,
    });
  };

  /** Axial/radial shading → SVG gradient in device space; null when unusable. */
  const buildGradient = (shading: NonNullable<ReturnType<typeof extractShading>>, ctm: Matrix) => {
    const combined = mulMatrix(ctm, shading.matrix ?? [1, 0, 0, 1, 0, 0]);
    const transformed: number[] = [];
    for (let offset = 0; offset < shading.coords.length; offset += 2) {
      transformed.push(...applyMatrix(combined, shading.coords[offset], shading.coords[offset + 1]));
    }
    return shadingFillSvg({ type: shading.type, coords: transformed, stops: shading.stops }, `grad-${acc.seq++}`);
  };

  async function paintPath(built: BuiltPath, mode: "fill" | "eofill" | "stroke" | "fillstroke" | "eofillstroke"): Promise<void> {
    if (currentHidden()) return;
    const state = gs();
    const doFill = mode !== "stroke";
    const doStroke = mode === "stroke" || mode === "fillstroke" || mode === "eofillstroke";
    const evenOdd = mode === "eofill" || mode === "eofillstroke";
    const pad = doStroke ? Math.min(64, state.lw * matrixScale(state.ctm).x / 2 + 1) : 0.5;
    const box: Box = {
      x: built.minX - pad,
      y: built.minY - pad,
      width: Math.max(1, built.maxX - built.minX + pad * 2),
      height: Math.max(1, built.maxY - built.minY + pad * 2),
    };
    if (smaskPending) {
      smaskPending = false;
      pushLayer(await rasterPatch(box, "ai_smask_raster"));
      return;
    }
    if (!doFill && !doStroke) return;
    const strokeAttrs = doStroke ? ` stroke="${state.stroke}" stroke-width="${Math.max(0.1, Math.round(state.lw * matrixScale(state.ctm).x * 100) / 100)}" stroke-linejoin="round" stroke-linecap="round"` : "";
    const viewBox = `${Math.round(built.minX * 100) / 100} ${Math.round(built.minY * 100) / 100} ${Math.round(box.width * 100) / 100} ${Math.round(box.height * 100) / 100}`;
    pushLayer({
      id: nextId("vec"),
      name: doStroke ? "Trazo" : "Forma",
      kind: "vector",
      ...box,
      fidelity: "editable",
      style: "overflow:visible;",
      html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" preserveAspectRatio="none" style="width:100%;height:100%;overflow:visible"><path d="${escapeImportHtml(built.d)}" fill="${doFill ? state.fill : "none"}"${evenOdd ? ' fill-rule="evenodd"' : ""}${strokeAttrs}/></svg>`,
    });
  }

  /** `sh` and pattern-`scn`: fill the current clip area with a shading. */
  async function paintShadingFill(objId: string): Promise<void> {
    if (currentHidden()) return;
    const wrapper = clipWrappers.length ? clipWrappers[clipWrappers.length - 1] : null;
    const box: Box = gs().clipRect ?? (wrapper ? { x: wrapper.x, y: wrapper.y, width: wrapper.width, height: wrapper.height } : { x: 0, y: 0, width, height });
    const shading = extractShading(lookupPattern(objId));
    const gradient = shading ? buildGradient(shading, gs().ctm) : null;
    if (!gradient) {
      pushLayer(await rasterPatch(box, "ai_pattern_raster"));
      return;
    }
    acc.approximations.add("ai_gradient_approx");
    const round = (value: number) => Math.round(value * 100) / 100;
    pushLayer({
      id: nextId("grad"),
      name: "Degradado",
      kind: "vector",
      ...box,
      fidelity: "approximate",
      style: "overflow:hidden;",
      html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${round(box.x)} ${round(box.y)} ${round(box.width)} ${round(box.height)}" preserveAspectRatio="none" style="width:100%;height:100%"><defs>${gradient.defs}</defs><rect x="${round(box.x)}" y="${round(box.y)}" width="${round(box.width)}" height="${round(box.height)}" fill="${gradient.fill}"/></svg>`,
    });
  }

  function lookupPattern(ref: string): any {
    for (const candidate of [ref, `p${pageNumber - 1}_${ref}`, `g_d0_${ref}`]) {
      const pattern = safeGet(page.objs, candidate) ?? safeGet(page.commonObjs, candidate);
      if (pattern) return pattern;
    }
    return null;
  }

  function imageObjectToDataUrl(obj: any): string | null {
    try {
      if (obj.bitmap) {
        const canvas = document.createElement("canvas");
        canvas.width = Number(obj.width) || obj.bitmap.width;
        canvas.height = Number(obj.height) || obj.bitmap.height;
        canvas.getContext("2d")!.drawImage(obj.bitmap, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/png");
      }
      const data = obj.data;
      const w = Number(obj.width);
      const h = Number(obj.height);
      if (!data || !w || !h) return null;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const context = canvas.getContext("2d")!;
      const image = context.createImageData(w, h);
      const kind = Number(obj.kind);
      if (kind === 1) {
        // GRAYSCALE_1BPP: MSB-first packed rows, padded to byte boundaries.
        const rowBytes = (w + 7) >> 3;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
            const offset = (y * w + x) * 4;
            const value = bit ? 255 : 0;
            image.data[offset] = image.data[offset + 1] = image.data[offset + 2] = value;
            image.data[offset + 3] = 255;
          }
        }
      } else if (kind === 2) {
        for (let pixel = 0; pixel < w * h; pixel++) {
          image.data[pixel * 4] = data[pixel * 3];
          image.data[pixel * 4 + 1] = data[pixel * 3 + 1];
          image.data[pixel * 4 + 2] = data[pixel * 3 + 2];
          image.data[pixel * 4 + 3] = 255;
        }
      } else {
        image.data.set(data.length >= w * h * 4 ? data.subarray(0, w * h * 4) : data);
      }
      context.putImageData(image, 0, 0);
      return canvas.toDataURL("image/png");
    } catch {
      return null;
    }
  }

  async function paintImageObject(obj: any, ctm: Matrix = gs().ctm): Promise<void> {
    if (!obj || currentHidden()) { smaskPending = false; return; }
    const dataUrl = imageObjectToDataUrl(obj);
    smaskPending = false;
    if (!dataUrl) return;
    const { box, aligned, matrix } = unitSquareBox(ctm);
    const extra = aligned ? "" : `transform:matrix(${matrix.slice(0, 4).map(value => Math.round(value * 1e4) / 1e4).join(",")},0,0);transform-origin:0 0;`;
    pushLayer({
      id: nextId("img"),
      name: "Imagen",
      kind: "image",
      ...box,
      fidelity: "raster",
      style: `overflow:hidden;${extra}`,
      html: `<img src="${dataUrl}" alt="" draggable="false" style="width:100%;height:100%;object-fit:fill">`,
    });
  }

  async function paintImageMask(mask: any, ctm: Matrix = gs().ctm): Promise<void> {
    smaskPending = false;
    if (!mask || currentHidden()) return;
    // Fused image-mask ops carry a lazy object id instead of the decoded bytes.
    const resolved = typeof mask.data === "string" ? safeGet(page.objs, mask.data) ?? safeGet(page.commonObjs, mask.data) : mask;
    const source = resolved || mask;
    const w = Number(source.width);
    const h = Number(source.height);
    const data = source.data;
    if (!w || !h || !data) return;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext("2d")!;
    const image = context.createImageData(w, h);
    const fill = gs().fill;
    const rgb = [1, 3, 5].map(offset => parseInt(fill.slice(offset, offset + 2), 16));
    for (let pixel = 0; pixel < w * h; pixel++) {
      const bit = (data[pixel >> 3] >> (7 - (pixel & 7))) & 1;
      image.data[pixel * 4] = rgb[0];
      image.data[pixel * 4 + 1] = rgb[1];
      image.data[pixel * 4 + 2] = rgb[2];
      image.data[pixel * 4 + 3] = bit ? 255 : 0;
    }
    context.putImageData(image, 0, 0);
    const { box } = unitSquareBox(ctm);
    pushLayer({
      id: nextId("imgmask"),
      name: "Máscara de imagen",
      kind: "image",
      ...box,
      fidelity: "raster",
      style: "overflow:hidden;",
      html: `<img src="${canvas.toDataURL("image/png")}" alt="" draggable="false" style="width:100%;height:100%;object-fit:fill">`,
    });
  }

  for (let index = 0; index < fnArray.length; index++) {
    if ((index & 0x3fff) === 0 && Date.now() - started > PAGE_TIME_BUDGET_MS) throw new PageBudgetError();
    const fn = fnArray[index];
    const args = argsArray[index] || [];
    switch (fn) {
      case OPS.save:
        gstack.push({ ...gs(), wrapperDepth: clipWrappers.length });
        break;
      case OPS.restore: {
        pendingClip = null;
        if (gstack.length > 1) {
          const popped = gstack.pop()!;
          if (clipWrappers.length > (popped.wrapperDepth ?? 0)) clipWrappers.length = popped.wrapperDepth;
        }
        break;
      }
      case OPS.transform:
        gs().ctm = mulMatrix(gs().ctm, args as number[]);
        break;
      case OPS.setFillRGBColor:
        // v6 normalizes every color operator (rg/g/k/sc…) into a CSS hex arg.
        gs().fill = typeof args[0] === "string" ? args[0] : rgbToHex(Number(args[0]) * 255, Number(args[1]) * 255, Number(args[2]) * 255);
        break;
      case OPS.setStrokeRGBColor:
        gs().stroke = typeof args[0] === "string" ? args[0] : rgbToHex(Number(args[0]) * 255, Number(args[1]) * 255, Number(args[2]) * 255);
        break;
      case OPS.setFillGray:
        gs().fill = grayToHex(Number(args[0]));
        break;
      case OPS.setStrokeGray:
        gs().stroke = grayToHex(Number(args[0]));
        break;
      case OPS.setFillCMYKColor:
        gs().fill = cmykToHex(Number(args[0]), Number(args[1]), Number(args[2]), Number(args[3]));
        break;
      case OPS.setStrokeCMYKColor:
        gs().stroke = cmykToHex(Number(args[0]), Number(args[1]), Number(args[2]), Number(args[3]));
        break;
      case OPS.setFillColor:
      case OPS.setStrokeColor: {
        const target: "fill" | "stroke" = fn === OPS.setFillColor ? "fill" : "stroke";
        if (args.length >= 4) gs()[target] = cmykToHex(Number(args[0]), Number(args[1]), Number(args[2]), Number(args[3]));
        else if (args.length === 3) gs()[target] = rgbToHex(Number(args[0]) * 255, Number(args[1]) * 255, Number(args[2]) * 255);
        else if (args.length === 1) gs()[target] = grayToHex(Number(args[0]));
        break;
      }
      case OPS.setFillColorN:
      case OPS.setStrokeColorN:
        // Pattern fills (`/name scn`) are resolved by pdf.js into shadingFill
        // ops; only plain numeric colors reach this op.
        if (typeof args[0] !== "string" && fn === OPS.setFillColorN && args.length) {
          gs().fill = args.length >= 4
            ? cmykToHex(Number(args[0]), Number(args[1]), Number(args[2]), Number(args[3]))
            : args.length === 3
              ? rgbToHex(Number(args[0]) * 255, Number(args[1]) * 255, Number(args[2]) * 255)
              : grayToHex(Number(args[0]));
        }
        break;
      case OPS.setGState: {
        for (const entry of args[0] || []) {
          const [key, value] = entry;
          if (key === "ca") gs().ca = Math.max(0, Math.min(1, Number(value)));
          else if (key === "LW") gs().lw = Math.max(0, Number(value) || 0);
          else if (key === "Font") { gs().fontRef = typeof value?.[0] === "string" ? value[0] : null; gs().fontSize = Number(value?.[1] ?? 12); }
          else if (key === "BM") gs().bm = typeof value === "string" && !/normal|compatib/i.test(value) ? value : null;
          else if (key === "SMask") smaskPending = Boolean(value && value !== "none");
        }
        break;
      }
      case OPS.setLineWidth:
        gs().lw = Math.max(0, Number(args[0]) || 0);
        break;
      case OPS.constructPath: {
        // pdf.js v6 fuses path construction + paint into one op:
        // [paintFn, [DrawOPS buffer], minMax] in PDF user space (y-up).
        // `q cm … Q` runs around paths get their cm baked into the buffer,
        // so composing points with the current CTM is always correct.
        const paintFn = Number(args[0]);
        const buffer = args[1]?.[0];
        const built = buffer && typeof buffer.length === "number" && typeof buffer[0] === "number"
          ? buildPathBuffer(buffer, gs().ctm)
          : null;
        if (pendingClip) {
          // W/W* clip: its path arrives in the following (usually endPath) constructPath.
          const clipMode = pendingClip;
          pendingClip = null;
          if (built?.rect && built.rect.width > 0.5 && built.rect.height > 0.5) {
            gs().clipRect = { ...built.rect };
          } else if (built && built.maxX - built.minX > 1 && built.maxY - built.minY > 1) {
            // Complex clip: wrap subsequent content in a CSS mask group (Figma pattern).
            const box: Box = { x: built.minX, y: built.minY, width: built.maxX - built.minX, height: built.maxY - built.minY };
            const maskSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${Math.round(box.x * 100) / 100} ${Math.round(box.y * 100) / 100} ${Math.round(box.width * 100) / 100} ${Math.round(box.height * 100) / 100}" preserveAspectRatio="none"><path d="${escapeImportHtml(built.d)}" fill="#fff"${clipMode === "evenodd" ? ' fill-rule="evenodd"' : ""}/></svg>`;
            const maskData = `data:image/svg+xml;base64,${bytesToBase64(new TextEncoder().encode(maskSvg))}`;
            const wrapper: DesignImportLayer = {
              id: nextId("clip"),
              name: "Recorte",
              kind: "group",
              x: box.x, y: box.y, width: box.width, height: box.height,
              fidelity: "editable",
              style: `overflow:visible;mask-image:url(${maskData});mask-repeat:no-repeat;mask-position:0 0;mask-size:100% 100%;-webkit-mask-image:url(${maskData});-webkit-mask-repeat:no-repeat;-webkit-mask-size:100% 100%;`,
              html: "",
              children: [],
            };
            pushLayer(wrapper);
            clipWrappers.push(wrapper);
          }
          break;
        }
        if (built) {
          const mode = paintFn === OPS.fill ? "fill"
            : paintFn === OPS.eoFill ? "eofill"
            : paintFn === OPS.stroke || paintFn === OPS.closeStroke ? "stroke"
            : paintFn === OPS.eoFillStroke || paintFn === OPS.closeEOFillStroke ? "eofillstroke"
            : paintFn === OPS.fillStroke || paintFn === OPS.closeFillStroke ? "fillstroke"
            : null;
          if (mode) await paintPath(built, mode);
        }
        break;
      }
      case OPS.clip:
        pendingClip = "normal";
        break;
      case OPS.eoClip:
        pendingClip = "evenodd";
        break;
      case OPS.shadingFill:
        await paintShadingFill(String(args[0] || ""));
        break;
      case OPS.beginText:
        // BT resets both text matrices to identity (PDF §9.4.1).
        textMatrix = textLineMatrix = [1, 0, 0, 1, 0, 0];
        break;
      case OPS.setTextMatrix:
        // Tm sets the text matrix and the line matrix.
        if (args.length >= 6) textMatrix = textLineMatrix = args.slice(0, 6) as unknown as Matrix;
        break;
      case OPS.setTextLineMatrix:
      case OPS.moveText:
        // Td moves relative to the line matrix; the text matrix follows it.
        textMatrix = textLineMatrix = mulMatrix(textLineMatrix, [1, 0, 0, 1, Number(args[0]) || 0, Number(args[1]) || 0]);
        break;
      case OPS.setLeadingMoveText:
        // TD sets the leading from -ty and then behaves like Td.
        textLeading = -Number(args[1]) || textLeading;
        textMatrix = textLineMatrix = mulMatrix(textLineMatrix, [1, 0, 0, 1, Number(args[0]) || 0, Number(args[1]) || 0]);
        break;
      case OPS.setTextLeading:
        textLeading = Number(args[0]) || 0;
        break;
      case OPS.setFont:
        gs().fontRef = typeof args[0] === "string" ? args[0] : null;
        gs().fontSize = Number(args[1]);
        break;
      case OPS.nextLine:
        textMatrix = textLineMatrix = mulMatrix(textLineMatrix, [1, 0, 0, 1, 0, -textLeading]);
        break;
      case OPS.nextLineShowText:
        textMatrix = textLineMatrix = mulMatrix(textLineMatrix, [1, 0, 0, 1, 0, -textLeading]);
        if (Array.isArray(args[0])) emitRun(args[0]);
        break;
      case OPS.nextLineSetSpacingShowText:
        textMatrix = textLineMatrix = mulMatrix(textLineMatrix, [1, 0, 0, 1, 0, -textLeading]);
        if (Array.isArray(args[2])) emitRun(args[2]);
        break;
      case OPS.showText:
      case OPS.showSpacedText:
        if (Array.isArray(args[0])) emitRun(args[0]);
        break;
      case OPS.beginMarkedContent:
        ocMarkers.push(false);
        break;
      case OPS.beginMarkedContentProps: {
        const tag = String(args[0] || "");
        const group = tag === "OC" ? ocLookup(args[1]) : null;
        if (group) {
          const name = group.name || `Capa ${ocStack.length + 1}`;
          const layer: DesignImportLayer = {
            id: nextId("ocg"),
            name,
            kind: "group",
            x: 0, y: 0, width: 1, height: 1,
            fidelity: "editable",
            style: "overflow:visible;",
            html: "",
            children: [],
          };
          pushLayer(layer);
          ocStack.push({ layer, hidden: group.visible === false });
          ocMarkers.push(true);
        } else {
          ocMarkers.push(false);
        }
        break;
      }
      case OPS.endMarkedContent:
        if (ocMarkers.pop()) ocStack.pop();
        break;
      case OPS.paintImageXObject: {
        const object = safeGet(page.commonObjs, args[0]) ?? safeGet(page.objs, args[0]);
        await paintImageObject(object);
        break;
      }
      case OPS.paintImageXObjectRepeat: {
        // Fused repeats: [objId, scaleX, scaleY, positions(xy, xy, …)].
        const object = safeGet(page.commonObjs, args[0]) ?? safeGet(page.objs, args[0]);
        if (!object) break;
        const positions = args[3];
        if (positions && typeof positions.length === "number" && positions.length >= 2) {
          const unit: Matrix = [Number(args[1]) || 1, 0, 0, Number(args[2]) || 1, 0, 0];
          for (let p = 0; p + 1 < positions.length; p += 2) {
            await paintImageObject(object, mulMatrix(gs().ctm, [unit[0], 0, 0, unit[3], Number(positions[p]), Number(positions[p + 1])]));
          }
        } else {
          await paintImageObject(object);
        }
        break;
      }
      case OPS.paintInlineImageXObject:
        await paintImageObject(args[0]);
        break;
      case OPS.paintImageMaskXObject:
        await paintImageMask(args[0]);
        break;
      case OPS.paintImageMaskXObjectRepeat: {
        // [objId, a, b, c, d, positions(xy, xy, …)].
        const mask = safeGet(page.objs, args[0]) ?? safeGet(page.commonObjs, args[0]);
        if (!mask) break;
        const positions = args[5];
        if (positions && typeof positions.length === "number" && positions.length >= 2) {
          const unit: Matrix = [Number(args[1]), Number(args[2]), Number(args[3]), Number(args[4]), 0, 0];
          for (let p = 0; p + 1 < positions.length; p += 2) {
            await paintImageMask(mask, mulMatrix(gs().ctm, [unit[0], unit[1], unit[2], unit[3], Number(positions[p]), Number(positions[p + 1])]));
          }
        } else {
          await paintImageMask(mask);
        }
        break;
      }
      case OPS.paintImageMaskXObjectGroup:
        for (const entry of args[0] || []) {
          const transform = Array.isArray(entry?.transform) && entry.transform.length === 6 ? entry.transform : [1, 0, 0, 1, 0, 0];
          await paintImageMask(entry, mulMatrix(gs().ctm, transform as number[]));
        }
        break;
      case OPS.paintSolidColorImageMask: {
        const { box } = unitSquareBox(gs().ctm);
        pushLayer({
          id: nextId("mask"),
          name: "Máscara de color",
          kind: "vector",
          ...box,
          fidelity: "editable",
          style: "overflow:hidden;",
          html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box.width} ${box.height}" preserveAspectRatio="none" style="width:100%;height:100%"><rect width="100%" height="100%" fill="${gs().fill}"/></svg>`,
        });
        break;
      }
      case OPS.paintFormXObjectBegin:
        gstack.push({ ...gs(), wrapperDepth: clipWrappers.length });
        if (Array.isArray(args[0]) && args[0].length === 6) gs().ctm = mulMatrix(gs().ctm, args[0] as number[]);
        break;
      case OPS.paintFormXObjectEnd: {
        pendingClip = null;
        if (gstack.length > 1) {
          const popped = gstack.pop()!;
          if (clipWrappers.length > (popped.wrapperDepth ?? 0)) clipWrappers.length = popped.wrapperDepth;
        }
        break;
      }
      default:
        break;
    }
  }

  // Emit accumulated text runs now that every container exists. Text lands at
  // the end of its container, so text painted UNDER later vectors loses exact
  // z-order — accepted v1 tradeoff (Illustrator text is almost always on top).
  const lines = bucketTextLines(segments);
  for (const line of lines) {
    const source = segments.find(segment => segment.key === line.key);
    if (!source) continue;
    if (source.bm) acc.approximations.add("ai_blend_approx");
    const layer: DesignImportLayer = {
      id: nextId("text"),
      name: line.text.trim().slice(0, 48) || "Texto",
      kind: "text",
      x: line.x,
      y: line.y - line.fontSize * 0.85,
      width: Math.max(1, Math.ceil(line.width)),
      height: Math.max(1, Math.round(line.fontSize * 1.25)),
      fidelity: "editable",
      style: `color:${source.color};font-family:${importFontCssValue(source.family)};font-size:${Math.round(line.fontSize)}px;font-weight:${source.weight};font-style:${source.style};white-space:pre;${source.ca < 1 ? `opacity:${Math.round(source.ca * 100) / 100};` : ""}${source.bm ? `mix-blend-mode:${source.bm.toLowerCase()};` : ""}`,
      fontFamilies: [source.family],
      html: `<div contenteditable="true" style="width:100%;height:100%;white-space:pre;">${escapeImportHtml(line.text)}</div>`,
    };
    const final = finalizeLayer(layer, source.clip);
    if (final) source.container.push(final);
  }
  segments.length = 0;

  // Size OC groups from their children (clip wrappers keep their clip box),
  // and prune groups that ended up empty. The renderer positions children
  // relative to their (positioned) parent, so each direct child is rebased
  // into the group box afterwards.
  const wrapperSet = new Set(clipWrappers);
  const pruneAndSize = (layers: DesignImportLayer[]): DesignImportLayer[] => {
    const kept: DesignImportLayer[] = [];
    for (const layer of layers) {
      if (layer.children) {
        layer.children = pruneAndSize(layer.children);
        if (!layer.children.length && !wrapperSet.has(layer)) continue;
        if (!wrapperSet.has(layer)) {
          const box = unionBox(layer.children.map(child => ({ x: child.x, y: child.y, width: child.width, height: child.height })));
          layer.x = box.x;
          layer.y = box.y;
          layer.width = box.width;
          layer.height = box.height;
        }
        for (const child of layer.children) {
          child.x -= layer.x;
          child.y -= layer.y;
        }
      }
      kept.push(layer);
    }
    return kept;
  };
  const sizedRoot = pruneAndSize(root);

  return {
    id: `artboard-${source}-${safeImportId(baseName)}-${pageNumber}`,
    name: pageName(baseName, pageNumber, pdf.numPages),
    width,
    height,
    background: "#ffffff",
    layers: sizedRoot,
  };
}

/** Existing raster behaviour, kept as the per-page safety net. */
async function rasterFallbackArtboard(page: any, pageNumber: number, baseName: string, source: "ai" | "pdf"): Promise<DesignImportArtboard> {
  const original = page.getViewport({ scale: 1 });
  const scale = Math.min(2, MAX_RASTER_EDGE / Math.max(original.width, original.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
  const data = canvas.toDataURL("image/png");
  canvas.width = canvas.height = 0;
  const width = Math.ceil(original.width);
  const height = Math.ceil(original.height);
  const id = safeImportId(`${baseName}-${pageNumber}`);
  return {
    id: `artboard-${source}-${id}-${pageNumber}`,
    name: pageName(baseName, pageNumber, pageNumber),
    width,
    height,
    background: "#ffffff",
    layers: [{
      id: `fallback-${id}`,
      name: baseName,
      kind: "image",
      x: 0, y: 0, width, height,
      fidelity: "raster",
      style: "overflow:hidden;",
      html: `<img data-layer-kind="image" src="${data}" alt="" draggable="false" style="width:100%;height:100%;object-fit:fill">`,
    }],
  };
}
