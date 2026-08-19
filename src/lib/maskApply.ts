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
  transformPathData,
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
    // Pinned to the FRAME ORIGIN (1×1, overflow visible): the path data is
    // in frame coordinates, so the dashed selection outline overlays the
    // image exactly instead of offsetting by the image's own origin.
    svg.setAttribute("style", "position:absolute;left:0px;top:0px;width:1px;height:1px;overflow:visible;");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    svg.appendChild(path);
    // Behind the image = earlier sibling, so the img stays the hit-test
    // target for subsequent eraser drags. pointer-events: none on the mask
    // layer's rule keeps it out of the way even where it would overlap.
    img.before(svg);
    css = `${css.trimEnd()}\n\n[data-layer-id="${pathLayerId}"] {\n  position: absolute;\n  left: 0px;\n  top: 0px;\n  width: 1px;\n  height: 1px;\n  overflow: visible;\n  pointer-events: none;\n}`;
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
 * F2 (Varita): applies a traced segmentation result to an image layer.
 * `dNorm` is the job's svgPath.dNorm — normalized 0..1 over the image — so
 * it is scaled into frame coordinates and stored in a mask svg pinned to
 * the frame origin (no viewBox, overflow visible), the same convention as
 * the eraser's auto-mask: the dashed outline overlays the subject exactly
 * and the bake lands the clip in image-local space.
 *
 * When a mask path already targets the image, its d is replaced in THAT
 * svg's own coordinate space (viewBox-aware) instead of creating a second
 * layer; legacy no-viewBox masks get re-pinned to the frame origin.
 */
export function applySegmentMaskPath(
  html: string,
  css: string,
  imageLayerId: string,
  dNorm: string,
): { html: string; css: string; pathLayerId: string; maskCreated: boolean } | null {
  if (!dNorm || !dNorm.trim()) return null;
  const document = parseFragment(html);
  const img = findLayer(document, imageLayerId);
  if (!img || img.tagName.toLowerCase() !== "img") return null;
  const imageBox = readLayerBox(img.getAttribute("style"), css, imageLayerId);
  if (!imageBox || imageBox.width <= 0 || imageBox.height <= 0) return null;

  // dNorm is 0..1 over the image → frame coordinates over the img's box.
  const frameD = transformPathData(dNorm, {
    sx: imageBox.width, sy: imageBox.height, dx: imageBox.left, dy: imageBox.top,
  });

  let pathLayerId: string | null = null;
  let maskCreated = false;
  const existingPath = [...document.body.querySelectorAll(`path[data-mask-for="${imageLayerId}"]`)]
    .find(element => element.getAttribute("data-mask-for") === imageLayerId);
  if (existingPath) {
    const svg = existingPath.matches("svg") ? existingPath : existingPath.closest("svg[data-layer-id]");
    pathLayerId = svg?.getAttribute("data-layer-id") || existingPath.getAttribute("data-layer-id");
  }

  let d = frameD;
  if (pathLayerId) {
    const svg = findLayer(document, pathLayerId);
    if (!svg) return null;
    const vb = readViewBox(svg.getAttribute("viewBox"));
    const pathBox = readLayerBox(svg.getAttribute("style"), css, pathLayerId);
    if (!pathBox) return null;
    if (vb) {
      // Map frame coords into the svg's own space:
      // p = (frame - svgTopLeft) / scale + vbOrigin.
      const sx = pathBox.width / vb.width;
      const sy = pathBox.height / vb.height;
      if (!Number.isFinite(sx) || !Number.isFinite(sy) || Math.abs(sx) < 1e-6 || Math.abs(sy) < 1e-6) return null;
      d = transformPathData(frameD, { sx: 1 / sx, sy: 1 / sy, dx: vb.left - pathBox.left / sx, dy: vb.top - pathBox.top / sy });
    } else if (pathBox.left !== 0 || pathBox.top !== 0 || pathBox.width !== 1 || pathBox.height !== 1) {
      // No-viewBox masks render in frame coordinates; pin the svg to the
      // frame origin so the selection outline overlays the subject exactly.
      svg.setAttribute("style", "position:absolute;left:0px;top:0px;width:1px;height:1px;overflow:visible;");
      css = updateCssProperties(css, `[data-layer-id="${pathLayerId}"]`, {
        position: "absolute",
        left: "0px",
        top: "0px",
        width: "1px",
        height: "1px",
        overflow: "visible",
      });
      d = frameD;
    }
  } else {
    // Fresh mask layer pinned to the frame origin (frame-coords path data).
    pathLayerId = createLayerId();
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("data-layer-id", pathLayerId);
    svg.setAttribute("data-layer-kind", "mask");
    svg.setAttribute("data-layer-name", "Selección Varita");
    svg.setAttribute("style", "position:absolute;left:0px;top:0px;width:1px;height:1px;overflow:visible;");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", frameD);
    path.setAttribute("fill", "none");
    svg.appendChild(path);
    img.before(svg);
    css = `${css.trimEnd()}\n\n[data-layer-id="${pathLayerId}"] {\n  position: absolute;\n  left: 0px;\n  top: 0px;\n  width: 1px;\n  height: 1px;\n  overflow: visible;\n  pointer-events: none;\n}`;
    maskCreated = true;
  }

  const svgEl = findLayer(document, pathLayerId);
  const pathEl = svgEl && (svgEl.matches("path") ? svgEl : svgEl.querySelector("path"));
  if (!pathEl) return null;
  pathEl.setAttribute("d", d);

  // A fresh subject selection: the wand always lands in include mode.
  const outcome = bakeOnDocument(document, css, pathLayerId, imageLayerId, "include");
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
