/**
 * The two paints a layer has, for callers that are not the editor.
 *
 * The editor's panel offers a Fill and a Stroke and quietly writes whichever
 * CSS property that layer actually paints with — `background-color` on a div,
 * `fill` on a path, `color` on a glyph. An agent driving the MCP tools had no
 * such vocabulary: it wrote raw CSS, so "fill this" became "set a background",
 * and on a group that means painting a box behind unrelated objects.
 *
 * This is the same model the frontend uses in `src/lib/layerPaint.ts`. The two
 * packages are sealed to their own `src`, so it exists in both; keep them in
 * step. The frontend copy is the one with the UI-facing helpers.
 */

export interface PaintableLayer {
  tag: string;
  /** data-layer-kind: shape | image | text | group | container. */
  layerKind?: string;
  /** For an <svg> wrapper, the shape tag it paints through. */
  svgChildTag?: string;
}

export interface PaintProperties {
  fill: string | null;
  strokeColor: string | null;
  strokeWidth: string | null;
}

const NO_PAINT: PaintProperties = { fill: null, strokeColor: null, strokeWidth: null };

const SVG_PAINT_TAGS = new Set(["path", "rect", "circle", "ellipse", "polygon", "polyline", "line", "text"]);

const HTML_TEXT_TAGS = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "a", "li", "label",
  "em", "strong", "small", "b", "i", "blockquote", "figcaption",
]);

/** A group paints nothing of its own — its fill is whatever its members carry. */
export function isGroupLayer(layer: PaintableLayer): boolean {
  return layer.layerKind === "group";
}

/**
 * Which properties carry this layer's fill and stroke.
 *
 * Returns nulls for a group, which is what forces a caller to reach the
 * members instead of painting the wrapper.
 */
export function paintPropertiesFor(layer: PaintableLayer): PaintProperties {
  if (isGroupLayer(layer)) return NO_PAINT;

  const tag = (layer.tag || "").toLowerCase();
  const svgChild = (layer.svgChildTag || "").toLowerCase();

  if (tag === "svg" || SVG_PAINT_TAGS.has(tag)) {
    if (tag === "svg" && !SVG_PAINT_TAGS.has(svgChild)) return NO_PAINT;
    return { fill: "fill", strokeColor: "stroke", strokeWidth: "stroke-width" };
  }

  // An image's interior is its own pixels.
  if (["img", "video", "canvas", "picture"].includes(tag)) return NO_PAINT;

  if (layer.layerKind === "text" || HTML_TEXT_TAGS.has(tag)) {
    return {
      fill: "color",
      strokeColor: "-webkit-text-stroke-color",
      strokeWidth: "-webkit-text-stroke-width",
    };
  }

  return { fill: "background-color", strokeColor: "border-color", strokeWidth: "border-width" };
}

/** Whether this layer can be painted at all. */
export function canPaint(layer: PaintableLayer): boolean {
  return paintPropertiesFor(layer).fill !== null;
}

/**
 * The declarations that express a paint intent on one layer.
 *
 * `strokeWidth` carries a unit already; a bare number is read as pixels, since
 * that is what an agent tends to send.
 */
export function paintDeclarations(
  layer: PaintableLayer,
  intent: { fill?: string; stroke?: string; strokeWidth?: string | number },
): Record<string, string> {
  const paint = paintPropertiesFor(layer);
  const out: Record<string, string> = {};

  if (intent.fill !== undefined && paint.fill) out[paint.fill] = intent.fill;
  if (intent.stroke !== undefined && paint.strokeColor) out[paint.strokeColor] = intent.stroke;

  if (intent.strokeWidth !== undefined && paint.strokeWidth) {
    const raw = String(intent.strokeWidth).trim();
    const width = /^-?[\d.]+$/.test(raw) ? `${raw}px` : raw;
    out[paint.strokeWidth] = width;
    // A border with no style draws nothing however wide it is set. SVG needs
    // no equivalent — a stroke-width is enough on its own.
    if (paint.strokeWidth === "border-width" && parseFloat(width) > 0) out["border-style"] = "solid";
  }

  return out;
}
