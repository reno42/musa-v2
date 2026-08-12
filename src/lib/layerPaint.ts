/**
 * What a layer can be painted with.
 *
 * A layer has exactly two paints: a FILL, which colours its interior, and a
 * STROKE, which colours its outline. There is no third thing called a
 * "background".
 *
 * That was not how the editor behaved. For an HTML element the panel offered
 * "Fill" and meant `background-color`, and for a text it offered "BG" and meant
 * the same property — so the same control had two names and one of them
 * described a box nobody asked for. Worse, it was offered on GROUPS, where
 * painting means drawing a rectangle behind unrelated objects. Anything that
 * paints is a real box rather than scaffolding, so that box then survives as a
 * container while the group semantics people expect quietly disappear.
 *
 * Which CSS property carries the fill depends on what the layer is, because
 * that is what the medium requires — a `<div>` colours its interior with
 * `background-color`, a `<path>` with `fill`, and a glyph with `color`. The
 * name the person sees stays "Fill" in all three cases.
 *
 * A group gets no properties at all. Its fill is its children's fill, which is
 * why `paintPropertiesFor` returns nulls for one and callers fan out instead.
 */

export interface PaintableLayer {
  tag: string;
  isSvg?: boolean;
  svgChildTag?: string;
  /** data-layer-kind: shape | image | text | group | container. */
  layerKind?: string;
}

export interface PaintProperties {
  /** The property that colours the interior, or null when the layer has none. */
  fill: string | null;
  strokeColor: string | null;
  strokeWidth: string | null;
}

const NO_PAINT: PaintProperties = { fill: null, strokeColor: null, strokeWidth: null };

const SVG_SHAPE_TAGS = new Set(["path", "rect", "circle", "ellipse", "polygon", "polyline", "line"]);

const HTML_TEXT_TAGS = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "a", "li", "label",
  "em", "strong", "small", "b", "i", "blockquote", "figcaption",
]);

/** A group paints nothing of its own — its fill is whatever its children carry. */
export function isGroupLayer(layer: PaintableLayer): boolean {
  return layer.layerKind === "group";
}

/**
 * The properties that carry this layer's fill and stroke.
 *
 * Never returns `background-color` for a group, which is the whole point: a
 * group cannot paint a box, so a caller with a group in hand has to reach its
 * children instead of writing to the wrapper.
 */
export function paintPropertiesFor(layer: PaintableLayer): PaintProperties {
  if (isGroupLayer(layer)) return NO_PAINT;

  const tag = (layer.tag || "").toLowerCase();
  const svgChild = (layer.svgChildTag || "").toLowerCase();

  if (layer.isSvg && (SVG_SHAPE_TAGS.has(svgChild) || svgChild === "text")) {
    return { fill: "fill", strokeColor: "stroke", strokeWidth: "stroke-width" };
  }

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
  // and calling that property "Fill" is the honest name for it.
  return { fill: "background-color", strokeColor: "border-color", strokeWidth: "border-width" };
}

/** Whether this layer can be painted at all. */
export function canPaint(layer: PaintableLayer): boolean {
  return paintPropertiesFor(layer).fill !== null;
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
 * A group shows a LIST rather than one colour: selecting three objects painted
 * two colours and being shown a single swatch would misreport two of them, and
 * there would be no way to read the other hex out to copy it.
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
