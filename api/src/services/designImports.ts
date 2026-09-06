import {
  escapeImportHtml,
  finalizeImportDocument,
  importSvgDocument,
  importFontCssValue,
  parseFigmaDesignUrl,
  sanitizeImportedSvg,
  safeImportId,
  type DesignImportArtboard,
  type DesignImportDocument,
  type DesignImportLayer,
} from "../../../shared/designImport.ts";
import { fetchRemoteImage } from "./remoteImage.js";
import { SYSTEM_FONTS } from "../data/systemFonts.js";

const FIGMA_API = "https://api.figma.com/v1";
const MAX_FIGMA_EXPORTS = 80;

type FetchLike = typeof fetch;

async function figmaJson(url: string, token: string, fetchImpl: FetchLike) {
  const response = await fetchImpl(url, {
    headers: { "X-Figma-Token": token, Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(response.status === 429 ? "Figma alcanzó el límite de solicitudes. Espera el tiempo indicado por tu plan y reintenta la importación." : response.status === 403 ? "Figma rechazó el token: verifica los permisos current_user:read y file_content:read y el acceso al archivo." : `Figma respondió HTTP ${response.status}.`);
  return response.json() as Promise<any>;
}

export async function testFigmaToken(token: string, fetchImpl: FetchLike = fetch) {
  const me = await figmaJson(`${FIGMA_API}/me`, token, fetchImpl);
  return { id: String(me.id || ""), handle: String(me.handle || me.email || "Cuenta de Figma") };
}

function findNode(root: any, id: string): any | undefined {
  if (!root) return undefined;
  if (String(root.id) === id) return root;
  for (const child of root.children || []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return undefined;
}

function nodeBox(node: any, origin: { x: number; y: number }) {
  const box = node.absoluteBoundingBox || {};
  const size = node.size || {};
  const transform = node.relativeTransform;
  const hasRelativePosition = Array.isArray(transform)
    && transform.length === 2
    && Number.isFinite(transform[0]?.[2])
    && Number.isFinite(transform[1]?.[2]);
  return {
    x: hasRelativePosition ? Number(transform[0][2]) : Number(box.x || 0) - origin.x,
    y: hasRelativePosition ? Number(transform[1][2]) : Number(box.y || 0) - origin.y,
    width: Math.max(1, Number(size.x || box.width || 1)),
    height: Math.max(1, Number(size.y || box.height || 1)),
  };
}

function rgba(color: any, opacity = 1) {
  if (!color) return "transparent";
  return `rgba(${Math.round(Number(color.r || 0) * 255)},${Math.round(Number(color.g || 0) * 255)},${Math.round(Number(color.b || 0) * 255)},${Number(color.a ?? 1) * opacity})`;
}

function visiblePaints(paints: any[] = []) {
  return paints.filter(item => item?.visible !== false && Number(item?.opacity ?? 1) > 0);
}

function paintCss(paints: any[] = []) {
  const paint = visiblePaints(paints)[0];
  if (!paint) return "transparent";
  if (paint.type === "SOLID") return rgba(paint.color, Number(paint.opacity ?? 1));
  if (["GRADIENT_LINEAR", "GRADIENT_RADIAL", "GRADIENT_ANGULAR", "GRADIENT_DIAMOND"].includes(paint.type)) {
    const stops = (paint.gradientStops || []).map((stop: any) => `${rgba(stop.color)} ${Math.round(Number(stop.position || 0) * 100)}%`).join(",");
    return paint.type === "GRADIENT_LINEAR" ? `linear-gradient(90deg,${stops})` : `radial-gradient(circle,${stops})`;
  }
  return "transparent";
}

function wrapperStyle(node: any) {
  const styles = [`overflow:${node.clipsContent ? "hidden" : "visible"}`, `opacity:${Number(node.opacity ?? 1)}`];
  const transform = node.relativeTransform;
  if (Array.isArray(transform) && transform.length === 2) {
    const [a, c] = transform[0] || [];
    const [b, d] = transform[1] || [];
    if ([a, b, c, d].every(Number.isFinite) && (Math.abs(a - 1) > 1e-6 || Math.abs(b) > 1e-6 || Math.abs(c) > 1e-6 || Math.abs(d - 1) > 1e-6)) {
      styles.push(`transform:matrix(${a},${b},${c},${d},0,0)`, "transform-origin:0 0");
    }
  }
  for (const effect of (node.effects || []).filter((item: any) => item.visible !== false)) {
    if (["DROP_SHADOW", "INNER_SHADOW"].includes(effect.type)) {
      const inset = effect.type === "INNER_SHADOW" ? "inset " : "";
      styles.push(`box-shadow:${inset}${Number(effect.offset?.x || 0)}px ${Number(effect.offset?.y || 0)}px ${Number(effect.radius || 0)}px ${rgba(effect.color)}`);
    } else if (effect.type === "LAYER_BLUR") styles.push(`filter:blur(${Number(effect.radius || 0)}px)`);
    else if (effect.type === "BACKGROUND_BLUR") styles.push(`backdrop-filter:blur(${Number(effect.radius || 0)}px)`);
  }
  const radius = Number(node.cornerRadius || 0);
  if (radius) styles.push(`border-radius:${radius}px`);
  return `${styles.join(";")};`;
}

function textStyle(style: any, fills: any[]) {
  const family = String(style?.fontFamily || "sans-serif");
  return { family, css: `font-family:${importFontCssValue(family)};font-size:${Number(style?.fontSize || 16)}px;font-weight:${Number(style?.fontWeight || 400)};font-style:${String(style?.italic ? "italic" : "normal")};line-height:${Number(style?.lineHeightPx || style?.fontSize || 16)}px;letter-spacing:${Number(style?.letterSpacing || 0)}px;color:${paintCss(fills)}` };
}

function textLayer(node: any, origin: { x: number; y: number }): DesignImportLayer {
  const base = textStyle(node.style || {}, node.fills || []);
  const characters = String(node.characters || "");
  const overrides = Array.isArray(node.characterStyleOverrides) ? node.characterStyleOverrides : [];
  const table = node.styleOverrideTable || {};
  const families = new Set([base.family]);
  let html = "";
  for (let start = 0; start < characters.length;) {
    const override = overrides[start] || 0;
    let end = start + 1;
    while (end < characters.length && (overrides[end] || 0) === override) end++;
    const run = textStyle({ ...(node.style || {}), ...(table[override] || {}) }, table[override]?.fills || node.fills || []);
    families.add(run.family);
    html += `<span data-figma-font="${escapeImportHtml(run.family)}" style="${run.css}">${escapeImportHtml(characters.slice(start, end))}</span>`;
    start = end;
  }
  if (!characters) html = "<span></span>";
  const align = String(node.style?.textAlignHorizontal || "LEFT").toLowerCase();
  return { id: `figma-${safeImportId(String(node.id))}`, name: String(node.name || "Text"), kind: "text", ...nodeBox(node, origin), fidelity: "editable", style: wrapperStyle(node), fontFamilies: [...families], html: `<div contenteditable="true" style="width:100%;height:100%;white-space:pre-wrap;text-align:${align}">${html}</div>` };
}

async function download(url: string, fetchImpl: FetchLike) {
  const downloaded = fetchImpl === fetch
    ? await fetchRemoteImage(url)
    : await (async () => {
        const response = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(20_000) });
        if (!response.ok) throw new Error("No se pudo descargar un recurso de Figma.");
        const mimeType = (response.headers.get("content-type") || "application/octet-stream").split(";")[0];
        return { buffer: Buffer.from(await response.arrayBuffer()), mimeType };
      })();
  return downloaded;
}

function geometrySvg(node: any) {
  const size = node.size || node.absoluteBoundingBox || { x: 1, y: 1 };
  const width = Math.max(1, Number(size.x || size.width || 1));
  const height = Math.max(1, Number(size.y || size.height || 1));
  const svgPaint = (paints: any[], id: string) => {
    const paint = (paints || []).find(item => item?.visible !== false && Number(item?.opacity ?? 1) > 0);
    if (!paint) return { value: "none", defs: "" };
    if (paint.type === "SOLID") return { value: rgba(paint.color, Number(paint.opacity ?? 1)), defs: "" };
    if (["GRADIENT_LINEAR", "GRADIENT_RADIAL"].includes(paint.type)) {
      const stops = (paint.gradientStops || []).map((stop: any) => `<stop offset="${Number(stop.position || 0) * 100}%" stop-color="${rgba(stop.color)}"/>`).join("");
      const radial = paint.type !== "GRADIENT_LINEAR";
      const handles = paint.gradientHandlePositions || [];
      const p0 = handles[0] || { x: 0, y: radial ? 0 : 0.5 };
      const p1 = handles[1] || { x: 1, y: 0.5 };
      const p2 = handles[2] || { x: 0, y: 1 };
      const attrs = radial
        ? `gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="matrix(${(p1.x - p0.x) * width} ${(p1.y - p0.y) * height} ${(p2.x - p0.x) * width} ${(p2.y - p0.y) * height} ${p0.x * width} ${p0.y * height})"`
        : `gradientUnits="userSpaceOnUse" x1="${p0.x * width}" y1="${p0.y * height}" x2="${p1.x * width}" y2="${p1.y * height}"`;
      return { value: `url(#${id})`, defs: `<defs><${radial ? "radialGradient" : "linearGradient"} id="${id}" ${attrs}>${stops}</${radial ? "radialGradient" : "linearGradient"}></defs>` };
    }
    return { value: "none", defs: "" };
  };
  const fill = svgPaint(node.fills || [], `fill-${safeImportId(String(node.id))}`);
  const stroke = svgPaint(node.strokes || [], `stroke-${safeImportId(String(node.id))}`);
  const sw = Number(node.strokeWeight || 0);
  let shape = "";
  if (node.type === "RECTANGLE") shape = `<rect width="100%" height="100%" rx="${Number(node.cornerRadius || 0)}"/>`;
  else if (node.type === "ELLIPSE") shape = `<ellipse cx="50%" cy="50%" rx="50%" ry="50%"/>`;
  else if (node.type === "LINE") shape = `<line x1="0" y1="0" x2="${width}" y2="${height}"/>`;
  else {
    const paths = [...(node.fillGeometry || []), ...(node.strokeGeometry || [])].map((path: any) => `<path d="${escapeImportHtml(String(path.path || ""))}" fill-rule="${String(path.windingRule || "NONZERO").toLowerCase()}"/>`).join("");
    if (paths) shape = paths;
  }
  if (!shape) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="width:100%;height:100%;overflow:visible;fill:${escapeImportHtml(fill.value)};stroke:${escapeImportHtml(stroke.value)};stroke-width:${sw}">${fill.defs}${stroke.defs}${shape}</svg>`;
}

function unsupportedComposition(node: any, allowComplexBackground = false) {
  const unsupportedEffects = (node.effects || []).filter((effect: any) => effect.visible !== false && !["DROP_SHADOW", "INNER_SHADOW", "LAYER_BLUR", "BACKGROUND_BLUR"].includes(effect.type));
  const vectorNeedsExactExport = node.type === "VECTOR" && ((node.fillGeometry || []).length !== 1 || (node.strokeGeometry || []).length || Object.keys(node.fillOverrideTable || {}).length);
  const paints = visiblePaints(node.fills || []);
  const strokes = visiblePaints(node.strokes || []);
  const unsupportedPaint = !allowComplexBackground && (paints.length > 1 || paints.some((paint: any) => ["GRADIENT_ANGULAR", "GRADIENT_DIAMOND"].includes(paint.type) || String(paint.type).startsWith("GRADIENT_") && (!Array.isArray(paint.gradientHandlePositions) || paint.gradientHandlePositions.length < 3)));
  const unsupportedStroke = strokes.length > 1 || strokes.some((paint: any) => paint.type === "IMAGE" || ["GRADIENT_ANGULAR", "GRADIENT_DIAMOND"].includes(paint.type) || String(paint.type).startsWith("GRADIENT_") && (!Array.isArray(paint.gradientHandlePositions) || paint.gradientHandlePositions.length < 3));
  const unsupportedImage = paints.some((paint: any) => paint.type === "IMAGE" && !["FILL", "FIT"].includes(String(paint.scaleMode || "FILL")));
  const missingShapeGeometry = ["POLYGON", "STAR", "BOOLEAN_OPERATION"].includes(node.type) && !(node.fillGeometry || []).length;
  const textPaint = node.type === "TEXT" && paints.some((paint: any) => paint.type !== "SOLID");
  return Boolean(unsupportedEffects.length || vectorNeedsExactExport || unsupportedPaint || unsupportedStroke || unsupportedImage || missingShapeGeometry || textPaint || (node.blendMode && !["NORMAL", "PASS_THROUGH"].includes(node.blendMode)));
}

function chooseArtboards(documentNode: any, nodeId?: string) {
  const selected = nodeId ? findNode(documentNode, nodeId) : documentNode;
  if (!selected) throw new Error("El node-id no existe en ese archivo de Figma.");

  function collect(node: any): any[] {
    if (node.visible === false) return [];
    // Pages and sections organize artboards; their bounds are not a frame.
    // Stop at actual frames/groups so their internal composition stays intact.
    if (["DOCUMENT", "CANVAS", "SECTION"].includes(node.type)) {
      return (node.children || []).flatMap((child: any) => collect(child));
    }
    if (["FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE"].includes(node.type)) return [node];
    // Export container children whole to retain frame fills, clipping and effects.
    // A directly selected leaf also needs a one-layer artboard.
    return [{
      id: `selection-${node.id}`,
      name: node.name || "Figma selection",
      type: "FRAME",
      absoluteBoundingBox: node.absoluteBoundingBox,
      children: [node],
    }];
  }
  return collect(selected);
}

export async function importFigmaUrl(rawUrl: string, token: string, fetchImpl: FetchLike = fetch): Promise<DesignImportDocument> {
  const { fileKey, nodeId } = parseFigmaDesignUrl(rawUrl);
  const file = await figmaJson(`${FIGMA_API}/files/${encodeURIComponent(fileKey)}?geometry=paths`, token, fetchImpl);
  const nodes = chooseArtboards(file.document, nodeId);
  const fallbackNodes: any[] = [];
  const imageRefs = new Set<string>();
  const scan = (node: any, isArtboardRoot = false) => {
    if (node.visible === false) return;
    for (const paint of node.fills || []) if (paint?.type === "IMAGE" && paint.imageRef) imageRefs.add(String(paint.imageRef));
    if (node.isMask) { fallbackNodes.push(node); return; }
    // The artboard itself remains a native editor frame. Its supported fill is
    // converted into an independent background layer below; descendants may
    // fall back individually without flattening the artboard.
    const isContainer = Boolean(node.children?.length || ["FRAME", "GROUP", "COMPONENT", "INSTANCE", "SECTION"].includes(node.type));
    if (!isArtboardRoot && unsupportedComposition(node, isContainer)) { fallbackNodes.push(node); return; }
    (node.children || []).forEach((child: any) => scan(child));
  };
  nodes.forEach(node => scan(node, true));
  if (fallbackNodes.length > MAX_FIGMA_EXPORTS) throw new Error(`Selecciona un frame con menos de ${MAX_FIGMA_EXPORTS} composiciones complejas para importarlo por partes.`);
  const fallbackIds = fallbackNodes.map(node => node.id);
  const exportMap = fallbackIds.length ? (await figmaJson(`${FIGMA_API}/images/${encodeURIComponent(fileKey)}?ids=${encodeURIComponent(fallbackIds.join(","))}&format=svg&svg_include_id=true`, token, fetchImpl)).images || {} : {};
  const imageMap = imageRefs.size ? (await figmaJson(`${FIGMA_API}/files/${encodeURIComponent(fileKey)}/images`, token, fetchImpl)).images || {} : {};
  const warnings: DesignImportDocument["warnings"] = [];
  const usedFonts = new Set<string>();
  const rasterCache = new Map<string, Promise<string>>();

  const rasterData = async (imageRef: string) => {
    const url = imageMap[imageRef];
    if (!url) throw new Error(`Figma no devolvió el recurso de imagen ${imageRef}.`);
    if (!rasterCache.has(imageRef)) rasterCache.set(imageRef, download(url, fetchImpl).then(asset => `data:${asset.mimeType};base64,${asset.buffer.toString("base64")}`));
    return rasterCache.get(imageRef)!;
  };

  const sampleGradient = (stops: any[], progress: number) => {
    const ordered = [...stops].sort((left, right) => Number(left.position || 0) - Number(right.position || 0));
    if (!ordered.length) return "transparent";
    const upperIndex = ordered.findIndex(stop => Number(stop.position || 0) >= progress);
    if (upperIndex <= 0) return rgba(ordered[Math.max(0, upperIndex)]?.color);
    if (upperIndex < 0) return rgba(ordered[ordered.length - 1].color);
    const lower = ordered[upperIndex - 1];
    const upper = ordered[upperIndex];
    const span = Math.max(1e-6, Number(upper.position || 0) - Number(lower.position || 0));
    const ratio = (progress - Number(lower.position || 0)) / span;
    const color = Object.fromEntries(["r", "g", "b", "a"].map(key => [key, Number(lower.color?.[key] ?? (key === "a" ? 1 : 0)) + (Number(upper.color?.[key] ?? (key === "a" ? 1 : 0)) - Number(lower.color?.[key] ?? (key === "a" ? 1 : 0))) * ratio]));
    return rgba(color);
  };

  const complexBackgroundSvg = async (node: any, paints: any[], width: number, height: number) => {
    const parts: string[] = [];
    const embeddedImages = new Map(await Promise.all(
      paints.filter(paint => paint.type === "IMAGE" && paint.imageRef)
        .map(async paint => [String(paint.imageRef), await rasterData(String(paint.imageRef))] as const),
    ));
    for (const [index, paint] of [...paints].reverse().entries()) {
      if (paint.type === "IMAGE" && paint.imageRef) {
        const dataUrl = embeddedImages.get(String(paint.imageRef));
        if (!dataUrl) throw new Error(`Figma no devolvió el fondo de imagen ${paint.imageRef}.`);
        parts.push(`<image href="${dataUrl}" width="${width}" height="${height}" preserveAspectRatio="${paint.scaleMode === "FIT" ? "xMidYMid meet" : "xMidYMid slice"}" opacity="${Number(paint.opacity ?? 1)}"/>`);
        continue;
      }
      if (paint.type === "GRADIENT_ANGULAR") {
        const handles = paint.gradientHandlePositions || [];
        const center = handles[0] || { x: .5, y: .5 };
        const direction = handles[1] || { x: 1, y: .5 };
        const cx = center.x * width;
        const cy = center.y * height;
        const start = Math.atan2((direction.y - center.y) * height, (direction.x - center.x) * width);
        const radius = Math.hypot(width, height) * 1.5;
        for (let step = 0; step < 180; step++) {
          const a0 = start + step / 180 * Math.PI * 2;
          const a1 = start + (step + 1.01) / 180 * Math.PI * 2;
          parts.push(`<path d="M${cx} ${cy}L${cx + Math.cos(a0) * radius} ${cy + Math.sin(a0) * radius}L${cx + Math.cos(a1) * radius} ${cy + Math.sin(a1) * radius}Z" fill="${sampleGradient(paint.gradientStops || [], step / 179)}" opacity="${Number(paint.opacity ?? 1)}"/>`);
        }
        continue;
      }
      if (paint.type === "GRADIENT_DIAMOND") {
        const handles = paint.gradientHandlePositions || [];
        const center = handles[0] || { x: .5, y: .5 };
        const axisX = handles[1] || { x: 1, y: .5 };
        const axisY = handles[2] || { x: .5, y: 1 };
        const point = (base: any, axis: any, scale: number) => `${(base.x + (axis.x - base.x) * scale) * width},${(base.y + (axis.y - base.y) * scale) * height}`;
        parts.push(`<rect width="${width}" height="${height}" fill="${sampleGradient(paint.gradientStops || [], 1)}" opacity="${Number(paint.opacity ?? 1)}"/>`);
        for (let step = 100; step >= 0; step--) {
          const scale = step / 100;
          const oppositeX = { x: center.x * 2 - axisX.x, y: center.y * 2 - axisX.y };
          const oppositeY = { x: center.x * 2 - axisY.x, y: center.y * 2 - axisY.y };
          parts.push(`<polygon points="${point(center, axisX, scale)} ${point(center, axisY, scale)} ${point(center, oppositeX, scale)} ${point(center, oppositeY, scale)}" fill="${sampleGradient(paint.gradientStops || [], scale)}" opacity="${Number(paint.opacity ?? 1)}"/>`);
        }
        continue;
      }
      const svg = geometrySvg({ ...node, id: `${node.id}-background-${index}`, type: "RECTANGLE", size: { x: width, y: height }, fills: [paint], strokes: [], effects: [] });
      if (svg) parts.push(svg);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="width:100%;height:100%;overflow:hidden">${parts.join("")}</svg>`;
  };

  const backgroundLayer = async (node: any, width: number, height: number): Promise<DesignImportLayer | null> => {
    const fills = node.fills?.length ? node.fills : node.backgroundColor ? [{ type: "SOLID", color: node.backgroundColor }] : [];
    const visible = visiblePaints(fills);
    if (!visible.length) return null;
    const imagePaint = visible.find((paint: any) => paint.type === "IMAGE" && paint.imageRef);
    const id = `figma-${safeImportId(String(node.id))}-background`;
    const name = `${String(node.name || "Frame")} background`;
    if (imagePaint && visible.length === 1) {
      const dataUrl = await rasterData(String(imagePaint.imageRef));
      const fit = imagePaint.scaleMode === "FIT" ? "contain" : "cover";
      return { id, name, kind: "image", x: 0, y: 0, width, height, fidelity: "raster", style: "overflow:hidden;", html: `<img src="${dataUrl}" alt="" style="width:100%;height:100%;object-fit:${fit}">` };
    }
    const needsApproximation = visible.length > 1 || visible.some((paint: any) => ["GRADIENT_ANGULAR", "GRADIENT_DIAMOND"].includes(paint.type));
    if (needsApproximation) {
      warnings.push({ code: "figma_frame_background_fallback", layerId: String(node.id), message: `${node.name || node.id} usa un fondo compuesto o un gradiente sin equivalente nativo; se conservó como una capa SVG independiente.` });
      return { id, name, kind: "vector", x: 0, y: 0, width, height, fidelity: "approximate", style: "overflow:hidden;", html: await complexBackgroundSvg(node, visible, width, height) };
    }
    const svg = geometrySvg({ ...node, id: `${node.id}-background`, type: "RECTANGLE", size: { x: width, y: height }, strokes: [], effects: [], cornerRadius: node.cornerRadius || 0 });
    if (!svg) return null;
    return { id, name, kind: "vector", x: 0, y: 0, width, height, fidelity: "editable", style: "overflow:hidden;", html: svg };
  };

  const fallbackLayer = async (node: any, origin: { x: number; y: number }): Promise<DesignImportLayer> => {
    const url = exportMap[node.id];
    if (!url) throw new Error(`Figma no pudo exportar la composición ${node.name || node.id}.`);
    const asset = await download(url, fetchImpl);
    if (asset.mimeType !== "image/svg+xml") throw new Error(`La composición ${node.name || node.id} no devolvió SVG.`);
    warnings.push({ code: "figma_subtree_fallback", layerId: String(node.id), message: `${node.name || node.id} usa máscaras, efectos o mezcla sin equivalente y se conservó como un vector independiente.` });
    return { id: `figma-${safeImportId(String(node.id))}`, name: String(node.name || node.type), kind: "vector", ...nodeBox(node, origin), fidelity: "approximate", style: wrapperStyle(node), html: sanitizeImportedSvg(asset.buffer.toString("utf8")) };
  };

  const convert = async (node: any, origin: { x: number; y: number }): Promise<DesignImportLayer | null> => {
    if (node.visible === false) return null;
    const isContainer = Boolean(node.children?.length || ["FRAME", "GROUP", "COMPONENT", "INSTANCE", "SECTION"].includes(node.type));
    if (unsupportedComposition(node, isContainer)) return fallbackLayer(node, origin);
    if (node.type === "TEXT") {
      const layer = textLayer(node, origin);
      layer.fontFamilies?.forEach(family => usedFonts.add(family));
      return layer;
    }
    const box = nodeBox(node, origin);
    const imagePaint = (node.fills || []).find((paint: any) => paint?.type === "IMAGE" && paint.visible !== false && paint.imageRef);
    if (imagePaint && !isContainer) {
      const dataUrl = await rasterData(String(imagePaint.imageRef));
      const fit = imagePaint.scaleMode === "FIT" ? "contain" : "cover";
      return { id: `figma-${safeImportId(String(node.id))}`, name: String(node.name || "Image"), kind: "image", ...box, fidelity: "raster", style: wrapperStyle(node), html: `<img src="${dataUrl}" alt="" style="width:100%;height:100%;object-fit:${fit}">` };
    }
    const vector = geometrySvg(node);
    if (vector) return { id: `figma-${safeImportId(String(node.id))}`, name: String(node.name || node.type), kind: "vector", ...box, fidelity: "editable", style: wrapperStyle(node), html: vector };
    if (isContainer) {
      const childOrigin = { x: Number(node.absoluteBoundingBox?.x || 0), y: Number(node.absoluteBoundingBox?.y || 0) };
      const children = await convertChildren(node, childOrigin);
      const background = await backgroundLayer(node, box.width, box.height);
      return { id: `figma-${safeImportId(String(node.id))}`, name: String(node.name || node.type), kind: "group", ...box, fidelity: "editable", style: wrapperStyle(node), html: "", children: background ? [background, ...children] : children };
    }
    warnings.push({ code: "figma_empty_node", layerId: String(node.id), message: `${node.name || node.id} no tenía geometría visible importable.` });
    return { id: `figma-${safeImportId(String(node.id))}`, name: String(node.name || node.type), kind: "fallback", ...box, fidelity: "approximate", style: wrapperStyle(node), html: "" };
  };

  const convertChildren = async (parent: any, origin: { x: number; y: number }): Promise<DesignImportLayer[]> => {
    const source = (parent.children || []).filter((child: any) => child.visible !== false);
    const layers: DesignImportLayer[] = [];
    for (let index = 0; index < source.length; index++) {
      const child = source[index];
      if (!child.isMask) {
        const layer = await convert(child, origin);
        if (layer) layers.push(layer);
        continue;
      }
      let end = index + 1;
      while (end < source.length && !source[end].isMask) end++;
      const affected = source.slice(index + 1, end);
      const maskUrl = exportMap[child.id];
      if (!maskUrl) throw new Error(`Figma no pudo exportar la máscara ${child.name || child.id}.`);
      const asset = await download(maskUrl, fetchImpl);
      if (asset.mimeType !== "image/svg+xml") throw new Error(`La máscara ${child.name || child.id} no devolvió SVG.`);
      const maskSvg = sanitizeImportedSvg(asset.buffer.toString("utf8"));
      const maskData = `data:image/svg+xml;base64,${Buffer.from(maskSvg).toString("base64")}`;
      const maskBox = nodeBox(child, origin);
      const parentSize = parent.size || parent.absoluteBoundingBox || {};
      const maskMode = child.maskType === "LUMINANCE" ? "luminance" : "alpha";
      const maskedChildren = (await Promise.all(affected.map((item: any) => convert(item, origin)))).filter(Boolean) as DesignImportLayer[];
      const maskLayer: DesignImportLayer = { id: `figma-${safeImportId(String(child.id))}`, name: String(child.name || "Mask"), kind: "vector", ...maskBox, fidelity: "editable", style: "display:none;", html: maskSvg };
      layers.push({ id: `figma-mask-group-${safeImportId(String(child.id))}`, name: `${String(child.name || "Mask")} · masked content`, kind: "group", x: 0, y: 0, width: Math.max(1, Number(parentSize.x || parentSize.width || 1)), height: Math.max(1, Number(parentSize.y || parentSize.height || 1)), fidelity: "editable", style: `overflow:visible;mask-image:url(${maskData});mask-repeat:no-repeat;mask-position:${maskBox.x}px ${maskBox.y}px;mask-size:${maskBox.width}px ${maskBox.height}px;mask-mode:${maskMode};-webkit-mask-image:url(${maskData});-webkit-mask-repeat:no-repeat;-webkit-mask-position:${maskBox.x}px ${maskBox.y}px;-webkit-mask-size:${maskBox.width}px ${maskBox.height}px;`, html: "", children: [maskLayer, ...maskedChildren] });
      warnings.push({ code: "figma_mask_group", layerId: String(child.id), message: `${child.name || child.id} se conservó como máscara ${maskMode} sobre su rango de capas.` });
      index = end - 1;
    }
    return layers;
  };

  const artboards: DesignImportArtboard[] = [];
  for (const node of nodes) {
    const bounds = node.absoluteBoundingBox || { x: 0, y: 0, width: 1080, height: 1080 };
    const origin = { x: Number(bounds.x || 0), y: Number(bounds.y || 0) };
    const layers = await convertChildren(node, origin);
    const framePaints = visiblePaints(node.fills || []);
    const approximateFramePaint = framePaints.length > 1 || framePaints.some((paint: any) => ["GRADIENT_ANGULAR", "GRADIENT_DIAMOND"].includes(paint.type));
    const frameBackground = await backgroundLayer(node, Math.max(1, Math.round(bounds.width || 1080)), Math.max(1, Math.round(bounds.height || 1080)));
    if (frameBackground) { if (approximateFramePaint) frameBackground.fidelity = "approximate"; layers.unshift(frameBackground); }
    if (!layers.length) {
      const fallback = importSvgDocument(`<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width || 1080}" height="${bounds.height || 1080}"><rect width="100%" height="100%" fill="#f5f5f4"/></svg>`, String(node.name || "Figma"));
      layers.push(...fallback.artboards[0].layers);
      warnings.push({ code: "figma_empty_frame", message: "El frame no contenía capas visibles; se creó un lienzo de referencia." });
    }
    artboards.push({ id: `figma-artboard-${safeImportId(String(node.id))}`, name: String(node.name || "Figma frame"), width: Math.max(1, Math.round(bounds.width || 1080)), height: Math.max(1, Math.round(bounds.height || 1080)), background: paintCss(node.backgroundColor ? [{ type: "SOLID", color: node.backgroundColor }] : node.fills || []) || "#ffffff", layers });
  }
  const available = new Set(SYSTEM_FONTS.map(font => font.family.toLowerCase()));
  const used = [...usedFonts].filter(family => family && family !== "sans-serif");
  const missing = used.filter(family => !available.has(family.toLowerCase()));
  return finalizeImportDocument({ version: "futuraria-import/v1", name: String(file.name || "Figma import"), source: "figma", artboards, warnings, report: { editable: 0, approximate: 0, raster: 0 }, fonts: { used, missing } });
}
