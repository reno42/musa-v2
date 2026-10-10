/**
 * Pintura de capas compartida — REQ-045.
 *
 * La librería que REQ-044 §3 pospuso: UN solo lugar que sabe leer y escribir
 * fill/stroke de una capa, usado por los atajos X/D/,/., el bote de pintura
 * (que hoy está cableado a nada) y el live paint. Dos caras:
 *
 *  - Núcleo puro (sin DOM): swap/default de pares, para atajos de EditorV2
 *    que operan sobre el HTML del frame con htmlMutations (undo atómico).
 *  - Helpers de string (DOMParser, lado cliente): leer/escribir pintura de
 *    una capa por su data-layer-id dentro del HTML del frame.
 *  - Helpers DOM (elemento vivo): para tools de DesignFrame que pintan y
 *    emiten el frame change con el innerHTML ya mutado (patrón line tool).
 *
 * Alcance v1 (documentado en REQ-045): capas SVG (fill/stroke del primer
 * path bajo el layer, o del propio elemento svg). Capas HTML → el caller
 * muestra "Solo capas SVG por ahora".
 */

export interface PaintPair {
  fill: string | null;
  stroke: string | null;
}

/** Default estilo Illustrator (D): relleno blanco, trazo negro. */
export const DEFAULT_PAINT: PaintPair = { fill: "#ffffff", stroke: "#000000" };

/** Intercambia fill ↔ stroke (núcleo puro). */
export function swapPair(p: PaintPair): PaintPair {
  return { fill: p.stroke, stroke: p.fill };
}

/** El primer <path> bajo el layer (o el propio elemento si ya es un path/svg). */
function firstPaintTarget(document: Document, layer: Element): Element | null {
  if (layer.tagName.toLowerCase() === "path") return layer;
  const path = layer.querySelector("path");
  if (path) return path;
  if (layer.namespaceURI?.includes("svg") || layer.tagName.toLowerCase() === "svg") return layer;
  return null;
}

function findLayer(document: Document, layerId: string): Element | null {
  return [...document.querySelectorAll("[data-layer-id]")].find(
    el => el.getAttribute("data-layer-id") === layerId,
  ) || null;
}

/** Lee fill/stroke del primer path del layer, dentro del HTML del frame.
 * Null si el layer no existe o no tiene nada pintable (capa HTML). */
export function readLayerPaintHtml(html: string, layerId: string): PaintPair | null {
  const document = new DOMParser().parseFromString(html, "text/html");
  const layer = findLayer(document, layerId);
  if (!layer) return null;
  const target = firstPaintTarget(document, layer);
  if (!target) return null;
  return {
    fill: target.getAttribute("fill"),
    stroke: target.getAttribute("stroke"),
  };
}

/** Escribe el fill del layer (color sólido o "none"). Null si no existe. */
export function writeLayerFillHtml(html: string, layerId: string, fill: string): string | null {
  const document = new DOMParser().parseFromString(html, "text/html");
  const layer = findLayer(document, layerId);
  if (!layer) return null;
  const target = firstPaintTarget(document, layer);
  if (!target) return null;
  target.setAttribute("fill", fill);
  return document.body.innerHTML;
}

/** Escribe el stroke del layer (color o "none") y opcionalmente su ancho. */
export function writeLayerStrokeHtml(
  html: string,
  layerId: string,
  stroke: string,
  strokeWidth?: number,
): string | null {
  const document = new DOMParser().parseFromString(html, "text/html");
  const layer = findLayer(document, layerId);
  if (!layer) return null;
  const target = firstPaintTarget(document, layer);
  if (!target) return null;
  target.setAttribute("stroke", stroke);
  if (strokeWidth !== undefined && Number.isFinite(strokeWidth) && strokeWidth > 0) {
    target.setAttribute("stroke-width", String(strokeWidth));
  }
  return document.body.innerHTML;
}

/** Intercambia fill/stroke de un layer dentro del HTML. Null si no hay pintura. */
export function swapLayerPaintHtml(html: string, layerId: string): string | null {
  const current = readLayerPaintHtml(html, layerId);
  if (!current) return null;
  const swapped = swapPair(current);
  const withFill = writeLayerFillHtml(html, layerId, swapped.fill ?? "none");
  if (withFill === null) return null;
  return writeLayerStrokeHtml(withFill, layerId, swapped.stroke ?? "none");
}

/** Pintura por defecto (blanco/negro) de un layer dentro del HTML. */
export function resetLayerPaintHtml(html: string, layerId: string): string | null {
  const withFill = writeLayerFillHtml(html, layerId, DEFAULT_PAINT.fill as string);
  if (withFill === null) return null;
  return writeLayerStrokeHtml(withFill, layerId, DEFAULT_PAINT.stroke as string);
}

// ── Helpers DOM (elemento vivo — tools de DesignFrame) ──

/** El elemento que recibe la pintura de un layer vivo (primer path o el svg). */
export function paintTargetOf(el: Element): Element | null {
  if (el.tagName.toLowerCase() === "path") return el;
  const path = el.querySelector("path");
  if (path) return path;
  if (el.tagName.toLowerCase() === "svg") return el;
  return null;
}

/** Lee la pintura de un layer vivo. Null en capas HTML (no SVG). */
export function readPaint(el: Element): PaintPair | null {
  const target = paintTargetOf(el);
  if (!target) return null;
  return { fill: target.getAttribute("fill"), stroke: target.getAttribute("stroke") };
}

/** Escribe el fill en un layer vivo (SVG: attr; soporta "none"). */
export function writeFillEl(el: Element, fill: string): boolean {
  const target = paintTargetOf(el);
  if (!target) return false;
  target.setAttribute("fill", fill);
  return true;
}

/** Escribe el stroke (y opcionalmente el ancho) en un layer vivo. */
export function writeStrokeEl(el: Element, stroke: string, strokeWidth?: number): boolean {
  const target = paintTargetOf(el);
  if (!target) return false;
  target.setAttribute("stroke", stroke);
  if (strokeWidth !== undefined && Number.isFinite(strokeWidth) && strokeWidth > 0) {
    target.setAttribute("stroke-width", String(strokeWidth));
  }
  return true;
}
