/**
 * The two paints a layer has: a FILL that colours its interior, and a STROKE
 * that colours its outline. There is no third thing called a "background".
 *
 * Which CSS property carries the fill depends on what the layer is, because
 * that is what the medium requires — a `<div>` colours its interior with
 * `background-color`, a `<path>` with `fill`, a glyph with `color`. The name a
 * person or an agent uses stays "fill" in all three cases.
 *
 * A group gets no properties at all. Its fill is its members' fill, so
 * `paintPropertiesFor` returns nulls for one and callers fan out instead. That
 * is what makes "paint a box behind a group" unexpressible: anything that
 * paints is a real box rather than scaffolding, and ungrouping is entitled to
 * dissolve scaffolding.
 */

export interface PaintableLayer {
  tag: string;
  /** data-layer-kind: shape | image | text | group | container. */
  layerKind?: string;
  /** True when the layer is an `<svg>` wrapper. Inferred from `tag` if absent. */
  isSvg?: boolean;
  /** For an `<svg>` wrapper, the shape tag it paints through. */
  svgChildTag?: string;
}

export interface PaintProperties {
  /** The property that colours the interior, or null when the layer has none. */
  fill: string | null;
  strokeColor: string | null;
  strokeWidth: string | null;
}

const NO_PAINT: PaintProperties = { fill: null, strokeColor: null, strokeWidth: null };
const SVG_PAINT: PaintProperties = { fill: "fill", strokeColor: "stroke", strokeWidth: "stroke-width" };

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
 * Accepts a layer described either way callers hold one: the editor knows it
 * is looking at an `<svg>` wrapper and names the shape inside it, while an
 * agent walking markup may be holding the shape element itself.
 */
export function paintPropertiesFor(layer: PaintableLayer): PaintProperties {
  if (isGroupLayer(layer)) return NO_PAINT;

  const tag = (layer.tag || "").toLowerCase();
  const svgChild = (layer.svgChildTag || "").toLowerCase();

  // An <svg> wrapper paints through the shape inside it, and has nothing to
  // paint when there is none.
  if (tag === "svg" || layer.isSvg === true) {
    return SVG_PAINT_TAGS.has(svgChild) ? SVG_PAINT : NO_PAINT;
  }
  if (SVG_PAINT_TAGS.has(tag)) return SVG_PAINT;

  // An image's interior is its own pixels; painting behind it would be the
  // background this model does not have.
  if (["img", "video", "canvas", "picture"].includes(tag)) return NO_PAINT;

  if (layer.layerKind === "text" || HTML_TEXT_TAGS.has(tag)) {
    return {
      fill: "color",
      strokeColor: "-webkit-text-stroke-color",
      strokeWidth: "-webkit-text-stroke-width",
    };
  }

  // A shape or container built from a div: its interior IS its background box,
  // and "fill" is the honest name for that property.
  return { fill: "background-color", strokeColor: "border-color", strokeWidth: "border-width" };
}

/** Whether this layer can be painted at all. */
export function canPaint(layer: PaintableLayer): boolean {
  return paintPropertiesFor(layer).fill !== null;
}

/**
 * The declarations that express a paint intent on one layer.
 *
 * This is the translation an agent needs: it says "fill" and gets whichever
 * property this particular layer paints with, so it never has to name
 * `background-color` itself.
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
    // A bare number is read as pixels, which is what agents tend to send.
    const width = /^-?[\d.]+$/.test(raw) ? `${raw}px` : raw;
    out[paint.strokeWidth] = width;
    // A border with no style draws nothing however wide it is set. SVG needs
    // no equivalent — a stroke-width is enough on its own.
    if (paint.strokeWidth === "border-width" && parseFloat(width) > 0) out["border-style"] = "solid";
  }

  return out;
}

/** Colours that mean "no paint here". */
const BLANK = new Set(["", "none", "transparent", "initial", "unset", "inherit", "rgba(0, 0, 0, 0)", "rgba(0,0,0,0)"]);

export function isBlankPaint(value: string | null | undefined): boolean {
  return BLANK.has((value || "").trim().toLowerCase());
}

export interface LayerFill {
  layerId: string;
  /** The value read from the layer, before normalising. */
  value: string;
}

export interface FillGroup {
  /** The value to show and edit — the first spelling seen for this colour. */
  value: string;
  /** Every layer painted this colour, so a change reaches all of them. */
  layerIds: string[];
}

/** Colour spellings differ; `#FFF`, `#ffffff` and `rgb(255,255,255)` are one colour. */
function normalizeColor(value: string): string {
  const trimmed = value.trim().toLowerCase();

  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(trimmed);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;

  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(trimmed);
  if (rgb) {
    if (rgb[4] !== undefined && parseFloat(rgb[4]) === 0) return "transparent";
    const hex = (n: string) => parseInt(n, 10).toString(16).padStart(2, "0");
    return `#${hex(rgb[1])}${hex(rgb[2])}${hex(rgb[3])}`;
  }
  return trimmed;
}

/**
 * The distinct fills across a selection, each with the layers wearing it.
 *
 * A group shows a LIST rather than one colour: three objects painted two
 * colours shown as a single swatch would misreport two of them, and there
 * would be no way to read the other hex out to copy it.
 *
 * Layers with no paint are dropped — an object that has only a stroke has no
 * fill to list, and inventing "transparent" for it would suggest a colour is
 * set when none is.
 */
export function summarizeFills(fills: LayerFill[]): FillGroup[] {
  const byColor = new Map<string, FillGroup>();

  for (const { layerId, value } of fills) {
    // Normalise BEFORE testing for blankness: a fully transparent rgba is not
    // a colour, but it does not spell itself "transparent".
    const key = normalizeColor(value);
    if (isBlankPaint(key)) continue;

    const existing = byColor.get(key);
    if (existing) existing.layerIds.push(layerId);
    else byColor.set(key, { value: value.trim(), layerIds: [layerId] });
  }
  return [...byColor.values()];
}
