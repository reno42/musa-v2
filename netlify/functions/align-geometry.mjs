/**
 * Aligning elements inside a frame.
 *
 * This lived inline in the align_elements handler, where it could not be run
 * without a template store, and so was never tested. Every defect below was
 * found by reading it rather than by a failing test:
 *
 *  - the handler read `align` while the editor sent `alignment`, so the value
 *    was undefined on every click and all six buttons did the same thing;
 *  - positions were parsed with `\d+`, which matches neither a negative nor a
 *    fractional coordinate, so such elements read as sitting at 0 and were
 *    aligned against a phantom origin at the frame's edge;
 *  - a missing width read as 0, collapsing right and centre onto an element's
 *    leading edge;
 *  - an element with no rule of its own was skipped silently, so a selection
 *    could come back with only some of its members moved;
 *  - the property rewrite matched `left` inside `border-left`.
 */

import { setCssDeclaration } from "./css-rules.mjs";

export const HORIZONTAL_ALIGNMENTS = ["left", "center", "right"];
export const VERTICAL_ALIGNMENTS = ["top", "middle", "bottom"];

/** Escapes a string for use as a literal inside a RegExp. */
const escapeForRegExp = str => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const selectorFor = layerId => `[data-layer-id="${layerId}"]`;

/**
 * Reads a pixel-valued property out of a declaration block.
 *
 * Accepts negative and fractional values, and requires a boundary before the
 * property name so `left` is not found inside `border-left`.
 */
export function readPixels(declaration, prop) {
  if (!declaration) return null;
  const hit = new RegExp(`(?:^|[;{\\s])${escapeForRegExp(prop)}\\s*:\\s*(-?[0-9]*\\.?[0-9]+)\\s*px`).exec(declaration);
  return hit ? parseFloat(hit[1]) : null;
}

/** Pulls the declaration block for one layer out of a stylesheet. */
function declarationFor(css, layerId) {
  const re = new RegExp(`${escapeForRegExp(selectorFor(layerId))}\\s*\\{([^}]*)\\}`);
  return re.exec(css || "")?.[1];
}

/**
 * Resolves each element's box, preferring geometry the caller measured from
 * the rendered DOM. The stylesheet cannot describe an auto-sized element: it
 * carries no width or height rule, and right/centre alignment needs its real
 * box. Agent callers send no bounds, so the stylesheet remains the fallback.
 */
export function collectElements({ css, elementIds, bounds }) {
  const measured = new Map((bounds || []).map(box => [box.layerId, box]));
  const elements = [];
  const unpositioned = [];

  for (const id of elementIds || []) {
    const declaration = declarationFor(css, id);
    const box = measured.get(id);
    if (declaration === undefined && !box) {
      unpositioned.push(id);
      continue;
    }
    elements.push({
      id,
      left: box?.left ?? readPixels(declaration, "left") ?? 0,
      top: box?.top ?? readPixels(declaration, "top") ?? 0,
      // Left null rather than 0 so a caller can tell "no width" from "zero
      // width" — the two align very differently.
      width: box?.width ?? readPixels(declaration, "width"),
      height: box?.height ?? readPixels(declaration, "height"),
    });
  }
  return { elements, unpositioned };
}

const extentOf = (el, axis) => (axis === "x" ? el.width : el.height) ?? 0;

/**
 * The coordinate every element is pulled towards: an edge or a midpoint, in
 * frame coordinates. `applyAlignment` subtracts each element's own extent from
 * it, so this is not any single element's target position.
 *
 * A lone element aligns against its frame, the way every design tool does.
 * That case used to throw "Need at least 2 elements", so a single selection
 * had no behaviour at all.
 */
export function computeAlignValue({ elements, align, frameWidth, frameHeight }) {
  const horizontal = HORIZONTAL_ALIGNMENTS.includes(align);
  const axis = horizontal ? "x" : "y";

  if (elements.length === 1) {
    const span = horizontal ? frameWidth : frameHeight;
    if (!span) throw new Error("Frame has no size to align a single element against");
    if (align === "left" || align === "top") return 0;
    if (align === "right" || align === "bottom") return span;
    return span / 2;
  }

  const near = horizontal ? e => e.left : e => e.top;
  const far = e => near(e) + extentOf(e, axis);

  if (align === "left" || align === "top") return Math.min(...elements.map(near));
  if (align === "right" || align === "bottom") return Math.max(...elements.map(far));
  return elements.reduce((sum, e) => sum + near(e) + extentOf(e, axis) / 2, 0) / elements.length;
}

/** Where a single element must sit for the given alignment. */
export function targetPosition(el, align, alignValue) {
  const horizontal = HORIZONTAL_ALIGNMENTS.includes(align);
  const extent = extentOf(el, horizontal ? "x" : "y");
  if (align === "left" || align === "top") return Math.round(alignValue);
  if (align === "right" || align === "bottom") return Math.round(alignValue - extent);
  return Math.round(alignValue - extent / 2);
}

/**
 * Writes the new positions into the stylesheet, returning the result. An
 * element with no rule of its own gets one created — `position` has to come
 * along with it or `left`/`top` do nothing at all.
 */
export function applyAlignment({ css, elements, align, alignValue }) {
  const prop = HORIZONTAL_ALIGNMENTS.includes(align) ? "left" : "top";
  let out = css || "";

  for (const el of elements) {
    const value = targetPosition(el, align, alignValue);
    // `position` has to come along when the rule is new, or left/top do
    // nothing at all.
    out = setCssDeclaration(out, selectorFor(el.id), prop, `${value}px`, "position: absolute;");
  }
  return out;
}

/**
 * Aligns a set of layers within one frame's stylesheet.
 *
 * `align` is the documented name; `alignment` is accepted because that is what
 * the editor's toolbar sends, and dropping it on the floor was the original bug.
 */
export function alignElements({ css, elementIds, align, alignment, bounds, frameWidth, frameHeight }) {
  const axis = align || alignment;
  if (!HORIZONTAL_ALIGNMENTS.includes(axis) && !VERTICAL_ALIGNMENTS.includes(axis)) {
    throw new Error(`align must be one of left|center|right|top|middle|bottom, got: ${axis ?? "nothing"}`);
  }

  const { elements, unpositioned } = collectElements({ css, elementIds, bounds });
  if (!elements.length) {
    throw new Error(`No selected element has a position to align: ${unpositioned.join(", ") || "none given"}`);
  }

  const alignValue = computeAlignValue({ elements, align: axis, frameWidth, frameHeight });
  return {
    css: applyAlignment({ css, elements, align: axis, alignValue }),
    align: axis,
    elementsAligned: elements.length,
    unpositioned,
  };
}
