import { createLayerId } from "./htmlMutations";
import { removeCssProperties, updateCssProperties } from "./cssMutations";
import {
  MASK_CSS_PROPERTIES,
  SELECTION_OUTLINE,
  bakePathMask,
  parseBrushesAttr,
  readLayerBox,
  readViewBox,
  serializeBrushesAttr,
  type Box,
  type BrushStroke,
  type MaskMode,
} from "../../shared/maskBake.ts";

/**
 * Mask application for the editor — the DOM/string surgery around the pure
 * bake in shared/maskBake.ts. Server-side MCP runs the same bake through
 * cheerio (netlify/functions/mcp.mjs); the geometry and CSS contracts live
 * there, the DOM idioms live here.
 *
 * Every function takes a frame's html+css strings and returns updated ones
 * (or null when the inputs don't describe a mask), so callers flow the result
 * through the usual replaceAllWithUndo → autoSave pipeline.
 */

function parseFragment(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

function serializeFragment(document: Document): string {
  return document.body.innerHTML;
}

function findLayer(document: Document, layerId: string): Element | null {
  return [...document.body.querySelectorAll("[data-layer-id]")]
    .find(element => element.getAttribute("data-layer-id") === layerId) || null;
}

interface BakeOutcome {
  css: string;
  imageBox: Box;
  localPathData: string;
}

/**
 * Tags the path as the image's mask source, bakes the declaration into the
 * image rule, and repaints the source path as the dashed-blue selection
 * outline. Shared by create/invert/fill/re-bake so they can never disagree.
 */
function bakeOnDocument(
  document: Document,
  css: string,
  pathLayerId: string,
  imageLayerId: string,
  mode: MaskMode,
): BakeOutcome | null {
  const svg = findLayer(document, pathLayerId);
  const path = svg && (svg.matches("path") ? svg : svg.querySelector("path"));
  const img = findLayer(document, imageLayerId);
  if (!svg || !path || !img || img.tagName.toLowerCase() !== "img") return null;

  const d = path.getAttribute("d") || "";
  const pathBox = readLayerBox(svg.getAttribute("style"), css, pathLayerId);
  const imageBox = readLayerBox(img.getAttribute("style"), css, imageLayerId);
  if (!pathBox || !imageBox) return null;

  const baked = bakePathMask({
    pathData: d,
    pathBox,
    viewBox: readViewBox(svg.getAttribute("viewBox")),
    imageBox,
    mode,
    brushes: parseBrushesAttr(img.getAttribute("data-mask-brushes")),
  });
  if (!baked) return null;

  path.setAttribute("data-mask-for", imageLayerId);
  path.setAttribute("data-mask-mode", mode);

  const imageSelector = `[data-layer-id="${imageLayerId}"]`;
  let updatedCss = removeCssProperties(css, imageSelector, MASK_CSS_PROPERTIES);
  updatedCss = updateCssProperties(updatedCss, imageSelector, {
    [baked.property]: baked.value,
    ...baked.companions,
  });
  // The source path becomes a selection marker: dashed blue, see-through.
  updatedCss = updateCssProperties(updatedCss, `[data-layer-id="${pathLayerId}"] path`, SELECTION_OUTLINE);

  return { css: updatedCss, imageBox, localPathData: baked.localPathData };
}

/** Creates (or re-applies) a path mask over an image layer. Non-destructive:
 * the image's own pixels and src are never touched. */
export function applyPathMask(
  html: string,
  css: string,
  pathLayerId: string,
  imageLayerId: string,
  mode: MaskMode,
): { html: string; css: string } | null {
  const document = parseFragment(html);
  const outcome = bakeOnDocument(document, css, pathLayerId, imageLayerId, mode);
  if (!outcome) return null;
  return { html: serializeFragment(document), css: outcome.css };
}

/**
 * Re-bakes an existing mask after its path was edited (edit_path_points).
 * Returns null when the path isn't a mask source, leaving the frame as-is.
 */
export function reBakePathMask(
  html: string,
  css: string,
  pathLayerId: string,
): { html: string; css: string } | null {
  const document = parseFragment(html);
  const svg = findLayer(document, pathLayerId);
  const path = svg && (svg.matches("path") ? svg : svg.querySelector("path"));
  const imageLayerId = path?.getAttribute("data-mask-for");
  if (!svg || !path || !imageLayerId) return null;
  const mode: MaskMode = path.getAttribute("data-mask-mode") === "exclude" ? "exclude" : "include";

  const outcome = bakeOnDocument(document, css, pathLayerId, imageLayerId, mode);
  if (!outcome) return null;

  // A fill layer behind the image clips to the same subject shape and must
  // follow the edited path too.
  let updatedCss = outcome.css;
  const fill = [...document.body.querySelectorAll(`[data-fill-for="${imageLayerId}"]`)]
    .find(element => element.tagName.toLowerCase() === "div");
  if (fill) {
    const fillId = fill.getAttribute("data-layer-id");
    if (fillId) {
      updatedCss = updateCssProperties(updatedCss, `[data-layer-id="${fillId}"]`, {
        "clip-path": `path("evenodd, ${outcome.localPathData}")`,
      });
    }
  }
  return { html: serializeFragment(document), css: updatedCss };
}

/**
 * Appends one brush stroke to an image's mask and re-bakes. Non-destructive:
 * the stroke is stored as JSON in `data-mask-brushes` on the img and painted
 * into the mask document, so it stays re-editable (add strokes, or flip the
 * whole mask back with invert) and the img's own pixels are never touched.
 *
 * When the image has no mask path yet, a full-rect include mask is created
 * behind it (an svg > path layer tagged data-mask-for/mode), so the first
 * erase stroke works exactly like it does on an image that already has a
 * selection.
 */
export function applyBrushStroke(
  html: string,
  css: string,
  imageLayerId: string,
  stroke: BrushStroke,
): { html: string; css: string; pathLayerId: string; maskCreated: boolean } | null {
  const document = parseFragment(html);
  const img = findLayer(document, imageLayerId);
  if (!img || img.tagName.toLowerCase() !== "img") return null;

  let pathLayerId: string | null = null;
  let maskCreated = false;
  const existingPath = [...document.body.querySelectorAll(`path[data-mask-for="${imageLayerId}"]`)]
    .find(element => element.getAttribute("data-mask-for") === imageLayerId);
  if (existingPath) {
    const svg = existingPath.matches("svg") ? existingPath : existingPath.closest("svg[data-layer-id]");
    pathLayerId = svg?.getAttribute("data-layer-id") || existingPath.getAttribute("data-layer-id");
  }

  if (!pathLayerId) {
    // First stroke on a bare image: create the full-rect include mask.
    const imageBox = readLayerBox(img.getAttribute("style"), css, imageLayerId);
    if (!imageBox) return null;
    pathLayerId = createLayerId();
    const d = `M${imageBox.left} ${imageBox.top} L${imageBox.left + imageBox.width} ${imageBox.top} L${imageBox.left + imageBox.width} ${imageBox.top + imageBox.height} L${imageBox.left} ${imageBox.top + imageBox.height} Z`;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("data-layer-id", pathLayerId);
    svg.setAttribute("data-layer-kind", "mask");
    svg.setAttribute("data-layer-name", "Máscara de imagen");
    svg.setAttribute("style", `position:absolute;left:${imageBox.left}px;top:${imageBox.top}px;width:${Math.max(imageBox.width, 1)}px;height:${Math.max(imageBox.height, 1)}px;overflow:visible;`);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    svg.appendChild(path);
    // Behind the image = earlier sibling, so the img stays the hit-test
    // target for subsequent eraser drags. pointer-events: none on the mask
    // layer's rule keeps it out of the way even where it would overlap.
    img.before(svg);
    css = `${css.trimEnd()}\n\n[data-layer-id="${pathLayerId}"] {\n  position: absolute;\n  left: ${imageBox.left}px;\n  top: ${imageBox.top}px;\n  width: ${Math.max(imageBox.width, 1)}px;\n  height: ${Math.max(imageBox.height, 1)}px;\n  overflow: visible;\n  pointer-events: none;\n}`;
    maskCreated = true;
  }

  const brushes = parseBrushesAttr(img.getAttribute("data-mask-brushes"));
  brushes.push(stroke);
  img.setAttribute("data-mask-brushes", serializeBrushesAttr(brushes));

  const mode: MaskMode = existingPath?.getAttribute("data-mask-mode") === "exclude" ? "exclude" : "include";
  const outcome = bakeOnDocument(document, css, pathLayerId, imageLayerId, mode);
  if (!outcome) return null;
  return { html: serializeFragment(document), css: outcome.css, pathLayerId, maskCreated };
}

/**
 * Fills the selection with a colour: the image gets an EXCLUDE mask (the
 * subject becomes a hole) and a div clipped to the subject shape is inserted
 * right behind it, painted with the fill. Deleting that div removes the fill.
 */
export function applySelectionFill(
  html: string,
  css: string,
  pathLayerId: string,
  imageLayerId: string,
  color: string,
): { html: string; css: string; fillLayerId: string } | null {
  const document = parseFragment(html);
  const outcome = bakeOnDocument(document, css, pathLayerId, imageLayerId, "exclude");
  const img = findLayer(document, imageLayerId);
  if (!outcome || !img) return null;

  let updatedCss = outcome.css;
  const existing = [...document.body.querySelectorAll(`[data-fill-for="${imageLayerId}"]`)]
    .find(element => element.tagName.toLowerCase() === "div");

  if (existing) {
    const fillId = existing.getAttribute("data-layer-id");
    if (!fillId) return null;
    updatedCss = updateCssProperties(updatedCss, `[data-layer-id="${fillId}"]`, {
      "clip-path": `path("evenodd, ${outcome.localPathData}")`,
      background: color,
    });
    return { html: serializeFragment(document), css: updatedCss, fillLayerId: fillId };
  }

  const fillLayerId = createLayerId();
  const fill = document.createElement("div");
  fill.setAttribute("data-layer-id", fillLayerId);
  fill.setAttribute("data-layer-kind", "fill");
  fill.setAttribute("data-layer-name", "Relleno de selección");
  fill.setAttribute("data-fill-for", imageLayerId);
  // Behind the image = earlier sibling; both are absolutely positioned, so
  // DOM order decides the stacking.
  img.before(fill);
  updatedCss = `${updatedCss.trimEnd()}\n\n[data-layer-id="${fillLayerId}"] {\n  position: absolute;\n  left: ${outcome.imageBox.left}px;\n  top: ${outcome.imageBox.top}px;\n  width: ${outcome.imageBox.width}px;\n  height: ${outcome.imageBox.height}px;\n  clip-path: path("evenodd, ${outcome.localPathData}");\n  background: ${color};\n}`;
  return { html: serializeFragment(document), css: updatedCss, fillLayerId };
}
