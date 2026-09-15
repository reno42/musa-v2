import {
  createFallbackImportDocument,
  escapeImportHtml,
  importSvgDocument,
  renderImportArtboard,
  type DesignImportDocument,
} from "../../shared/designImport.ts";

/**
 * Design Import — converts files from external tools (SVG, PSD, AI, FIG)
 * into Futuraria frames (HTML + CSS).
 *
 * - SVG: Validated static vector block, with an explicit fidelity report.
 * - PSD: Uses ag-psd (dynamic import, loaded on demand) → absolutely positioned HTML layers.
 * - AI/PDF: editable conversion via the pdf.js operator walk (pdfImport.ts);
 *   legacy AI without PDF compatibility keeps its raster preview.
 * - FIG: Proprietary binary; converts server-side when dropped in the editor
 *   (DesignImportModal routes it to /api/design-imports/fig-file).
 * - PNG/JPG: Imports as full-frame image.
 */

export interface ImportResult {
  html: string;
  css: string;
  width: number;
  height: number;
  name: string;
  /** Warning message to show user (e.g., "FIG not supported, use SVG export") */
  warning?: string;
  report?: DesignImportDocument["report"];
  warnings?: DesignImportDocument["warnings"];
  /** Stable, non-secret provenance key used to update a previous import. */
  sourceKey?: string;
  replacePrevious?: boolean;
}

export interface ImportBatch {
  results: ImportResult[];
  sourceName: string;
}

// ── SVG Import ──────────────────────────────────────────────────

export function importSvg(svgText: string, fileName: string): ImportResult {
  const document = importSvgDocument(svgText, fileName);
  const result = renderImportArtboard(document.artboards[0]);
  return { ...result, report: document.report, warnings: document.warnings };
}

// ── Image Import (PNG/JPG) ──────────────────────────────────────

export async function importImage(file: File): Promise<ImportResult> {
  const dataUrl = await readFileAsDataURL(file);
  const img = await loadImage(dataUrl);
  return {
    html: `<img src="${dataUrl}" alt="${escapeImportHtml(file.name)}" style="width:100%;height:100%;object-fit:contain;" />`,
    css: `img { display: block; }`,
    width: img.naturalWidth || 1080,
    height: img.naturalHeight || 1080,
    name: file.name.replace(/\.[^.]+$/, ""),
    report: { editable: 0, approximate: 0, raster: 1 },
  };
}

// ── PSD Import (via ag-psd, dynamically loaded) ─────────────────

export async function importPsdResults(file: File): Promise<ImportResult[]> {
  try {
    const PsdModule: any = await import("ag-psd");
    const buffer = await file.arrayBuffer();
    const header = new DataView(buffer);
    if (buffer.byteLength < 26 || header.getUint32(14) * header.getUint32(18) > 16_777_216) throw new Error("PSD demasiado grande: máximo 16 megapíxeles por archivo.");
    const psd = PsdModule.readPsd(buffer);

    const rootName = file.name.replace(/\.psd$/i, "") || "Photoshop";
    const artboardLayers = (psd.children || []).filter((layer: any) => !layer.hidden && layer.artboard?.rect);
    const targets = artboardLayers.length ? artboardLayers : [{
      name: rootName,
      artboard: { rect: { left: 0, top: 0, right: psd.width || 1080, bottom: psd.height || 1080 } },
      children: psd.children || [],
      canvas: psd.canvas,
    }];

    return targets.map((target: any, targetIndex: number) => {
      const rect = target.artboard.rect;
      const originX = Number(rect.left || 0);
      const originY = Number(rect.top || 0);
      const width = Math.max(1, Number(rect.right || psd.width || 1080) - originX);
      const height = Math.max(1, Number(rect.bottom || psd.height || 1080) - originY);
      const layerHtml: string[] = [];
      let editable = 0;
      let raster = 0;
      let layerIndex = 0;

      const needsComposite = (layer: any): boolean => !layer.hidden && Boolean(layer.mask || layer.vectorMask || layer.effects || layer.clipping || layer.adjustment || (layer.blendMode && !["normal", "pass through"].includes(layer.blendMode)) || layer.children?.some(needsComposite));
      if (psd.canvas && needsComposite(target)) {
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d")!.drawImage(psd.canvas, -originX, -originY);
        return { html: `<img data-layer-kind="image" src="${canvas.toDataURL("image/png")}" alt="" style="width:100%;height:100%;object-fit:contain">`, css: "", width, height, name: String(target.name || rootName), report: { editable: 0, approximate: 0, raster: 1 }, warnings: [{ code: "psd_composite", message: "Esta mesa contiene máscaras, ajustes o efectos. Se conservó la composición de Photoshop como imagen." }] };
      }

      const colorCss = (value: any) => value && typeof value === "object" && "r" in value
        ? `rgba(${Math.round(value.r)},${Math.round(value.g)},${Math.round(value.b)},${"a" in value ? Math.max(0, Math.min(1, value.a / (value.a > 1 ? 255 : 1))) : 1})`
        : "#000000";
      const walk = (layer: any, parentOpacity = 1) => {
        if (layer.hidden) return;
        // ag-psd exposes layer coordinates in document space, including for
        // nested groups. Subtract the artboard origin exactly once.
        const left = Number(layer.left ?? originX) - originX;
        const top = Number(layer.top ?? originY) - originY;
        const layerWidth = Math.max(1, Number(layer.right ?? layer.left ?? originX + 1) - Number(layer.left ?? originX));
        const layerHeight = Math.max(1, Number(layer.bottom ?? layer.top ?? originY + 1) - Number(layer.top ?? originY));
        const id = `psd-${targetIndex}-${layerIndex++}`;
        const name = escapeImportHtml(String(layer.name || `Layer ${layerIndex}`));
        const opacity = parentOpacity * Math.max(0, Math.min(1, Number(layer.opacity ?? 1)));
        const common = `position:absolute;left:${left}px;top:${top}px;width:${layerWidth}px;height:${layerHeight}px;overflow:hidden;opacity:${opacity};`;

        if (layer.text?.text) {
          const style = layer.text.style || layer.text.styleRuns?.[0]?.style || {};
          const fontName = escapeImportHtml(String(style.font?.name || "sans-serif"));
          const content = escapeImportHtml(String(layer.text.text));
          layerHtml.push(`<div data-layer-id="${id}" data-layer-kind="text" data-layer-name="${name}" style="${common}white-space:pre-wrap;font-family:${fontName};font-size:${Number(style.fontSize || 16)}px;font-weight:${style.fauxBold ? 700 : 400};font-style:${style.fauxItalic ? "italic" : "normal"};line-height:${Number(style.leading || style.fontSize || 16)}px;color:${colorCss(style.fillColor)}">${content}</div>`);
          editable += 1;
        } else if (layer.canvas) {
          const dataUrl = layer.canvas.toDataURL("image/png");
          layerHtml.push(`<img data-layer-id="${id}" data-layer-kind="image" data-layer-name="${name}" src="${dataUrl}" alt="" draggable="false" style="${common}" />`);
          raster += 1;
        }
        for (const child of layer.children || []) walk(child, opacity);
      };
      for (const child of target.children || []) walk(child);

      if (!layerHtml.length && target.canvas) {
        const dataUrl = target.canvas.toDataURL("image/png");
        layerHtml.push(`<img data-layer-id="psd-${targetIndex}-preview" data-layer-kind="image" data-layer-name="${escapeImportHtml(String(target.name || rootName))}" src="${dataUrl}" alt="" draggable="false" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain" />`);
        raster = 1;
      }
      if (!layerHtml.length) throw new Error(`La mesa ${target.name || targetIndex + 1} no contiene una vista importable.`);
      const warnings = raster ? [{ code: "psd_raster_layers", message: `${raster} capa(s) con píxeles, efectos o Smart Objects se conservaron visualmente como imagen.` }] : [];
      return {
        html: layerHtml.join("\n"),
        css: `[data-layer-kind="image"]{display:block}`,
        width, height,
        name: String(target.name || (targets.length > 1 ? `${rootName} ${targetIndex + 1}` : rootName)),
        warning: warnings[0]?.message,
        warnings,
        report: { editable, approximate: 0, raster },
      };
    });
  } catch (err: any) {
    throw new Error(`PSD import failed: ${err?.message || "unknown error"}`);
  }
}

// ── AI Import (Adobe Illustrator) ───────────────────────────────

export async function importAi(file: File): Promise<ImportResult> {
  // AI files are PDF-based binary files. They contain embedded raster previews.
  // Strategy: Try to extract the embedded image. If that fails, read as ArrayBuffer
  // and look for embedded PNG/JPEG signatures.
  try {
    const buffer = new Uint8Array(await file.arrayBuffer());

    // Search for PNG signature: 89 50 4E 47
    const pngSig = [0x89, 0x50, 0x4e, 0x47];
    // Search for JPEG signature: FF D8 FF
    const jpegSig = [0xff, 0xd8, 0xff];

    // Find the largest embedded image (usually the preview)
    let bestStart = -1;
    let bestEnd = -1;
    let bestSig: "png" | "jpeg" | null = null;

    // Look for JPEG (more common in AI previews)
    jpegScan: for (let i = 0; i < buffer.length - 3; i++) {
      if (buffer[i] === jpegSig[0] && buffer[i + 1] === jpegSig[1] && buffer[i + 2] === jpegSig[2]) {
        // Find JPEG end marker (FF D9)
        for (let j = i + 3; j < buffer.length - 1; j++) {
          if (buffer[j] === 0xff && buffer[j + 1] === 0xd9) {
            const size = j - i;
            if (size > (bestEnd - bestStart)) {
              bestStart = i;
              bestEnd = j + 2;
              bestSig = "jpeg";
            }
            i = j + 1;
            continue jpegScan;
          }
        }
        break;
      }
    }

    // Look for PNG
    {
      pngScan: for (let i = 0; i < buffer.length - 4; i++) {
        if (buffer[i] === pngSig[0] && buffer[i + 1] === pngSig[1] &&
            buffer[i + 2] === pngSig[2] && buffer[i + 3] === pngSig[3]) {
          // PNG ends with IEND chunk: 00 00 00 00 49 45 4E 44 AE 42 60 82
          const iendSig = [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
          for (let j = i + 4; j < buffer.length - 8; j++) {
            if (buffer[j] === iendSig[0] && buffer[j + 1] === iendSig[1] &&
                buffer[j + 2] === iendSig[2] && buffer[j + 3] === iendSig[3]) {
              const size = j - i;
              if (size > (bestEnd - bestStart)) {
                bestStart = i;
                bestEnd = j + 8;
                bestSig = "png";
              }
              i = j + 7;
              continue pngScan;
            }
          }
          break;
        }
      }
    }

    if (bestStart >= 0 && bestSig) {
      const imageBytes = buffer.slice(bestStart, bestEnd);
      const blob = new Blob([imageBytes], { type: `image/${bestSig}` });
      const dataUrl = await blobToDataURL(blob);
      const img = await loadImage(dataUrl);
      return {
        html: `<img src="${dataUrl}" alt="${escapeImportHtml(file.name)}" style="width:100%;height:100%;object-fit:contain;" />`,
        css: `img { display:block; }`,
        width: img.naturalWidth || 1080,
        height: img.naturalHeight || 1080,
        name: file.name.replace(/\.ai$/i, ""),
        warning: "La vista previa de Illustrator se conservó como imagen. Exporta SVG para editar sus vectores.",
        warnings: [{ code: "ai_raster_preview", message: "La vista previa de Illustrator se conservó como imagen. Exporta SVG para editar sus vectores." }],
        report: { editable: 0, approximate: 0, raster: 1 },
      };
    }

    throw new Error("Este AI no tiene una vista previa utilizable. Guárdalo con compatibilidad PDF o exporta SVG desde Illustrator y vuelve a importarlo.");
  } catch (err: any) {
    throw new Error(`AI import failed: ${err?.message || "unknown error"}`);
  }
}

// ── FIG Import (Figma) ──────────────────────────────────────────

export function importFigGuidance(fileName: string): ImportResult {
  throw new Error(`${fileName}: suelta el archivo .fig en el diálogo de importación del editor para convertirlo (o pega el enlace de Figma). No se ha importado el archivo .fig.`);
}

/** Editable AI/PDF conversion; the raster renderer only survives inside
 *  pdfImport.ts as the per-page safety net. */
export async function importPdfDocumentResults(file: File, source: "ai" | "pdf"): Promise<ImportResult[]> {
  const { parsePdfDocumentResults } = await import("./pdfImport");
  const document = await parsePdfDocumentResults(file, source);
  const fontCss = document.fontCss || "";
  return resultsFromDocument(document).map((result, index) => ({ ...result, css: `${fontCss}${result.css}` }));
}

export async function importPsd(file: File): Promise<ImportResult> {
  return (await importPsdResults(file))[0];
}

export function importPdfGuidance(fileName: string): ImportResult {
  return resultFromDocument(createFallbackImportDocument({
    name: fileName.replace(/\.pdf$/i, ""),
    source: "pdf",
    message: "El PDF se recibió correctamente. Esta versión conserva una referencia visual; exporta SVG desde Illustrator para editar vectores y texto.",
  }));
}

export function resultsFromDocument(document: DesignImportDocument): ImportResult[] {
  return document.artboards.map(artboard => {
    const result = renderImportArtboard(artboard);
    const report = { editable: 0, approximate: 0, raster: 0 };
    const count = (layer: typeof artboard.layers[number]) => {
      report[layer.fidelity] += 1;
      layer.children?.forEach(count);
    };
    artboard.layers.forEach(count);
    return {
      ...result,
      warning: document.warnings[0]?.message,
      warnings: document.warnings,
      report,
    };
  });
}

function resultFromDocument(document: DesignImportDocument): ImportResult {
  return resultsFromDocument(document)[0];
}

const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

async function assertFileSignature(file: File, ext: string) {
  if (file.size > MAX_IMPORT_BYTES) throw new Error("El archivo supera el límite de 50 MB.");
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const ascii = new TextDecoder().decode(bytes);
  const ok = ext === "svg" ? /<\??(?:xml|svg)|\s*<svg/i.test(await file.slice(0, 512).text())
    : ext === "psd" ? ascii.startsWith("8BPS")
    : ext === "pdf" ? ascii.startsWith("%PDF-")
    : ext === "ai" ? ascii.startsWith("%PDF-") || ascii.startsWith("%!PS-Adobe")
    : ext === "fig" ? bytes.length > 0
    : ext === "png" ? bytes[0] === 0x89 && ascii.slice(1, 4) === "PNG"
    : ext === "jpg" || ext === "jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : ext === "webp" ? ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP"
    : true;
  if (!ok) throw new Error(`El contenido no coincide con un archivo .${ext} válido.`);
}

// ── Main entry point ────────────────────────────────────────────

export async function importDesignFile(file: File): Promise<ImportResult> {
  return (await importDesignFileResults(file))[0];
}

export async function importDesignFileResults(file: File): Promise<ImportResult[]> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  await assertFileSignature(file, ext);
  const withSource = (results: ImportResult[]) => results.map((result, index) => ({
    ...result,
    sourceKey: `file-${sourceFingerprint((file.webkitRelativePath || file.name).toLowerCase())}-${index}`,
  }));
  switch (ext) {
    case "svg":
      return withSource([importSvg(await file.text(), file.name)]);
    case "png":
    case "jpg":
    case "jpeg":
    case "webp":
      return withSource([await importImage(file)]);
    case "psd":
      return withSource(await importPsdResults(file));
    case "ai":
      if ((await file.slice(0, 5).text()) === "%PDF-") return withSource(await importPdfDocumentResults(file, "ai"));
      return withSource([await importAi(file)]);
    case "fig":
      return withSource([importFigGuidance(file.name)]);
    case "pdf":
      return withSource(await importPdfDocumentResults(file, "pdf"));
    default:
      throw new Error(`Formato no compatible: .${ext}. Usa SVG, PSD, AI, PDF, FIG, PNG, JPG o WEBP.`);
  }
}

export function sourceFingerprint(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

// ── Helpers ─────────────────────────────────────────────────────

function readFileAsDataURL(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export const SUPPORTED_IMPORT_FORMATS = ".svg,.psd,.ai,.pdf,.fig,.png,.jpg,.jpeg,.webp";
export const SUPPORTED_IMPORT_LABELS = ["SVG", "PSD (Photoshop)", "AI/PDF (Illustrator)", "FIG/Figma URL", "PNG", "JPG", "WEBP"];
