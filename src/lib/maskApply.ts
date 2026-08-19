import { createLayerId } from "./htmlMutations";
import { removeCssProperties, updateCssProperties } from "./cssMutations";
import {
  MASK_CSS_PROPERTIES,
  SELECTION_OUTLINE,
  bakePathMask,
  parseBrushesAttr,
  readLayerBox,
  readViewBox,
  type Box,
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
