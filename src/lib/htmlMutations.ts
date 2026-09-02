import { cloneLayerCss, remapCssReferences, remapFragmentReferences } from "./cssMutations";
import { classifyLayer } from "./layerKind";
import { parseGradientValue } from "./gradient";

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

let generatedLayerSequence = 0;

export function createLayerId(): string {
  generatedLayerSequence++;
  return `el_${Date.now().toString(36)}_${generatedLayerSequence.toString(36)}`;
}

export function replaceLayerPathData(
  html: string,
  layerId: string,
  pathData: string,
  metadata: Record<string, string> = {},
): string | null {
  const document = parseFragment(html);
  const layer = findLayer(document, layerId);
  if (!layer) return null;
  const path = layer.matches("path") ? layer : layer.querySelector("path");
  if (!path) return null;
  path.setAttribute("d", pathData);
  for (const [name, value] of Object.entries(metadata)) layer.setAttribute(name, value);
  return serializeFragment(document);
}

/** What a shape's fill can be (F2 fill picker routed through svg defs). */
export type SvgFillMedia =
  | { kind: "solid"; color: string }
  | { kind: "gradient"; css: string }
  | { kind: "image"; url: string }
  | { kind: "none" };

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

function gradientTransformCoords(angle: number): { x1: string; y1: string; x2: string; y2: string } {
  // CSS 0deg points up; convert to an objectBoundingBox axis.
  const rad = (angle * Math.PI) / 180;
  const dx = Math.sin(rad) / 2, dy = -Math.cos(rad) / 2;
  return { x1: String(0.5 - dx), y1: String(0.5 - dy), x2: String(0.5 + dx), y2: String(0.5 + dy) };
}

/**
 * Paint an svg shape's fill through real svg paint servers: gradients and
 * photos become <defs> entries referenced with url(#…), solid/none are
 * plain fill attributes. CSS gradients don't apply inside an svg's <path>,
 * so this is the only way the fill picker's degradados render on shapes.
 */
export function applyLayerSvgFill(
  html: string,
  layerId: string,
  fill: SvgFillMedia,
): string | null {
  const document = parseFragment(html);
  const layer = findLayer(document, layerId);
  if (!layer) return null;
  const path = layer.matches("path") ? layer : layer.querySelector("path");
  if (!path) return null;
  const svg = layer.matches("svg") ? layer : layer.querySelector("svg");

  const defId = `musa-fill-${layerId}`;
  const dropDef = () => {
    if (!svg) return;
    svg.querySelector(`#${defId}`)?.remove();
  };

  if (fill.kind === "none") {
    dropDef();
    path.setAttribute("fill", "none");
    return serializeFragment(document);
  }

  if (fill.kind === "solid") {
    dropDef();
    path.setAttribute("fill", fill.color);
    return serializeFragment(document);
  }

  if (!svg) {
    // No svg host (a bare path without an svg ancestor) — degrade to solid.
    path.setAttribute("fill", fill.kind === "image" ? "none" : "#000000");
    return serializeFragment(document);
  }

  dropDef();
  const defs = svg.querySelector("defs") ?? svg.insertBefore(document.createElementNS(SVG_NS, "defs"), svg.firstChild);

  if (fill.kind === "gradient") {
    const parsed = parseGradientValue(fill.css);
    if (!parsed) {
      path.setAttribute("fill", "none");
      return serializeFragment(document);
    }
    // svg has no conic primitive: angular/diamond degrade to the linear
    // axis (documented approximation; divs/text keep the real conic).
    const isRadial = parsed.type === "radial";
    const server = document.createElementNS(SVG_NS, isRadial ? "radialGradient" : "linearGradient");
    server.setAttribute("id", defId);
    if (isRadial) {
      server.setAttribute("cx", "50%");
      server.setAttribute("cy", "50%");
      server.setAttribute("r", "75%");
    } else {
      const coords = gradientTransformCoords(parsed.angle);
      server.setAttribute("x1", coords.x1);
      server.setAttribute("y1", coords.y1);
      server.setAttribute("x2", coords.x2);
      server.setAttribute("y2", coords.y2);
    }
    for (const stop of parsed.stops) {
      const stopEl = document.createElementNS(SVG_NS, "stop");
      stopEl.setAttribute("offset", `${stop.pos}%`);
      stopEl.setAttribute("stop-color", stop.color);
      stopEl.setAttribute("stop-opacity", String(stop.alpha));
      server.appendChild(stopEl);
    }
    defs.appendChild(server);
    path.setAttribute("fill", `url(#${defId})`);
    return serializeFragment(document);
  }

  // Image fill via a pattern sized to the viewBox (cover behavior).
  const vb = (svg.getAttribute("viewBox") || "0 0 0 0").split(/\s+/).map(Number);
  const w = vb[2] || 100, h = vb[3] || 100;
  const pattern = document.createElementNS(SVG_NS, "pattern");
  pattern.setAttribute("id", defId);
  pattern.setAttribute("patternUnits", "userSpaceOnUse");
  pattern.setAttribute("width", String(w));
  pattern.setAttribute("height", String(h));
  const image = document.createElementNS(SVG_NS, "image");
  image.setAttribute("width", String(w));
  image.setAttribute("height", String(h));
  image.setAttribute("preserveAspectRatio", "xMidYMid slice");
  image.setAttribute("href", fill.url);
  image.setAttributeNS(XLINK_NS, "xlink:href", fill.url);
  pattern.appendChild(image);
  defs.appendChild(pattern);
  path.setAttribute("fill", `url(#${defId})`);
  return serializeFragment(document);
}

function offsetInlinePosition(element: Element, offset = 20): void {
  if (!(element instanceof HTMLElement)) return;
  for (const property of ["left", "top"] as const) {
    const value = element.style[property];
    if (/^-?\d+(?:\.\d+)?px$/.test(value)) {
      element.style[property] = `${parseFloat(value) + offset}px`;
    }
  }
}

function cloneLayerTree(element: Element, createId: () => string): { clone: Element; idMap: Map<string, string>; referenceIdMap: Map<string, string> } {
  const clone = element.cloneNode(true) as Element;
  const idMap = new Map<string, string>();
  const clonedElements = [clone, ...clone.querySelectorAll("*")];
  for (const clonedElement of clonedElements.filter(item => item.hasAttribute("data-layer-id"))) {
    const oldId = clonedElement.getAttribute("data-layer-id");
    if (!oldId) continue;
    const newId = createId();
    clonedElement.setAttribute("data-layer-id", newId);
    idMap.set(oldId, newId);
  }
  const referenceIdMap = new Map<string, string>();
  for (const clonedElement of clonedElements.filter(item => item.hasAttribute("id"))) {
    const oldId = clonedElement.getAttribute("id");
    if (!oldId) continue;
    const newId = `${oldId}_${createId()}`;
    clonedElement.setAttribute("id", newId);
    referenceIdMap.set(oldId, newId);
  }
  if (referenceIdMap.size > 0) {
    for (const clonedElement of clonedElements) {
      for (const attribute of clonedElement.getAttributeNames()) {
        if (attribute === "id") continue;
        const value = clonedElement.getAttribute(attribute);
        if (!value) continue;
        const remapped = /^(?:aria-labelledby|aria-describedby)$/i.test(attribute)
          ? value.split(/\s+/).map(token => referenceIdMap.get(token) || token).join(" ")
          : remapFragmentReferences(value, referenceIdMap);
        clonedElement.setAttribute(attribute, remapped);
      }
      if (clonedElement.tagName.toLowerCase() === "style" && clonedElement.textContent) {
        clonedElement.textContent = remapCssReferences(clonedElement.textContent, referenceIdMap);
      }
    }
  }
  return { clone, idMap, referenceIdMap };
}

/**
 * Give every layer a UNIQUE data-layer-id, cloning the CSS of any duplicate
 * so it keeps its exact look under the fresh id.
 *
 * Designs produced by earlier versions (batch/AI generation) frequently ship
 * the SAME data-layer-id on several elements — three circles all called
 * "circ", three labels all called "lbl". Every part of the editor addresses
 * layers by id (selection, CSS rules, the DOM reconciler, group baking), so a
 * repeated id means an operation aimed at one element silently hits another:
 * objects duplicate on screen or vanish when a group is dissolved.
 *
 * Normalizing once at load is the only durable fix — downstream code can then
 * trust that an id identifies exactly one element.
 */
export function dedupeLayerIds(
  html: string,
  css: string,
  createId: () => string,
): { html: string; css: string; changed: boolean } {
  if (!html.trim()) return { html, css, changed: false };
  const document = parseFragment(html);
  const seen = new Set<string>();
  /** [originalId, freshId] per duplicate occurrence (an id may repeat N times). */
  const remapped: Array<[string, string]> = [];

  for (const element of document.body.querySelectorAll("[data-layer-id]")) {
    const id = element.getAttribute("data-layer-id");
    if (!id) continue;
    if (!seen.has(id)) { seen.add(id); continue; }
    let freshId = createId();
    while (seen.has(freshId)) freshId = createId();
    element.setAttribute("data-layer-id", freshId);
    seen.add(freshId);
    remapped.push([id, freshId]);
  }

  if (remapped.length === 0) return { html, css, changed: false };

  // Clone rule-by-rule: cloneLayerCss takes a Map, which can only express one
  // target per source id, so an id repeated three times needs one pass each.
  let updatedCss = css;
  for (const [oldId, freshId] of remapped) {
    updatedCss = cloneLayerCss(updatedCss, new Map([[oldId, freshId]]));
  }

  return { html: serializeFragment(document), css: updatedCss, changed: true };
}

export function ensureLayerIds(html: string, createId: () => string): string {
  if (!html.trim()) return html;
  const document = parseFragment(html);
  let changed = false;

  // A mixed text/element container is a semantic group. Wrap its direct text
  // nodes so every visible text run can be selected, resized, and reordered.
  const containers = [document.body, ...document.body.querySelectorAll("*")];
  for (const container of containers) {
    if (container.closest("svg, style, script") || container.children.length === 0) continue;
    for (const child of [...container.childNodes]) {
      if (child.nodeType !== Node.TEXT_NODE || !child.textContent?.trim()) continue;
      const textLayer = document.createElement("span");
      textLayer.setAttribute("data-layer-id", createId());
      textLayer.setAttribute("data-layer-kind", "text");
      textLayer.setAttribute("data-layer-name", child.textContent.trim());
      textLayer.textContent = child.textContent;
      child.replaceWith(textLayer);
      changed = true;
    }
  }

  for (const element of document.body.querySelectorAll("*")) {
    const richTextRoot = element.parentElement?.closest('[data-layer-kind="text"]');
    if (richTextRoot) {
      if (element.hasAttribute("data-layer-id")) { element.removeAttribute("data-layer-id"); changed = true; }
      if (element.hasAttribute("data-layer-kind")) { element.removeAttribute("data-layer-kind"); changed = true; }
      continue;
    }
    if (!element.hasAttribute("data-layer-id")) {
      element.setAttribute("data-layer-id", createId());
      changed = true;
    }
    // Classify element kind for scope-based selection. The rules live in
    // lib/layerKind.ts, where they are testable: "group" is now reserved for
    // pure scaffolding, so a painted card and a text block stop presenting
    // themselves as things you have to ungroup to reach.
    if (!element.hasAttribute("data-layer-kind")) {
      const kind = classifyLayer({
        tag: element.tagName,
        styleAttr: element.getAttribute("style"),
        children: Array.from(element.children).map(child => ({
          tag: child.tagName,
          hasChildren: child.children.length > 0,
          // Carried so two runs with different looks do not read as one block.
          styleAttr: child.getAttribute("style"),
        })),
      });
      element.setAttribute("data-layer-kind", kind);
      changed = true;
    }
  }
  return changed ? serializeFragment(document) : html;
}

export function replaceLayerText(html: string, layerId: string, text: string): string | null {
  const document = parseFragment(html);
  const element = findLayer(document, layerId);
  if (!element) return null;
  element.textContent = text;
  return serializeFragment(document);
}

export function deleteLayerFromHtml(html: string, layerId: string): string | null {
  const document = parseFragment(html);
  const element = findLayer(document, layerId);
  if (!element) return null;
  element.remove();
  return serializeFragment(document);
}

export function duplicateLayerInHtml(
  html: string,
  layerId: string,
  createId: () => string,
): { html: string; idMap: Map<string, string> } | null {
  const document = parseFragment(html);
  const element = findLayer(document, layerId);
  if (!element) return null;

  const { clone, idMap } = cloneLayerTree(element, createId);
  offsetInlinePosition(clone);
  element.after(clone);
  return { html: serializeFragment(document), idMap };
}

export function pasteLayerFromHtml(
  targetHtml: string,
  sourceHtml: string,
  sourceLayerId: string,
  createId: () => string,
  offset = 20,
): { html: string; idMap: Map<string, string>; referenceIdMap: Map<string, string>; rootLayerId: string } | null {
  const sourceDocument = parseFragment(sourceHtml);
  const sourceElement = findLayer(sourceDocument, sourceLayerId);
  if (!sourceElement) return null;

  const targetDocument = parseFragment(targetHtml);
  const { clone, idMap, referenceIdMap } = cloneLayerTree(sourceElement, createId);
  offsetInlinePosition(clone, offset);

  const matchingTarget = findLayer(targetDocument, sourceLayerId);
  if (matchingTarget) matchingTarget.after(clone);
  else targetDocument.body.appendChild(clone);

  const rootLayerId = idMap.get(sourceLayerId);
  if (!rootLayerId) return null;
  return { html: serializeFragment(targetDocument), idMap, referenceIdMap, rootLayerId };
}

export function changeLayerTag(html: string, layerId: string, newTag: string): string | null {
  const document = parseFragment(html);
  const element = findLayer(document, layerId);
  if (!element) return null;

  const replacement = document.createElement(newTag);
  for (const attribute of element.getAttributeNames()) {
    replacement.setAttribute(attribute, element.getAttribute(attribute) || "");
  }
  while (element.firstChild) replacement.appendChild(element.firstChild);
  element.replaceWith(replacement);
  return serializeFragment(document);
}

/**
 * Set raw attributes on a layer (e.g. swap an <img> src to a background-
 * removed cutout while remembering the original in data-orig-src). Returns
 * null when the layer does not exist.
 */
export function setLayerAttributes(html: string, layerId: string, attributes: Record<string, string>): string | null {
  const document = parseFragment(html);
  const element = findLayer(document, layerId);
  if (!element) return null;
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return serializeFragment(document);
}

/** Remove one attribute from a layer (e.g. data-orig-src on restore). */
export function removeLayerAttribute(html: string, layerId: string, name: string): string | null {
  const document = parseFragment(html);
  const element = findLayer(document, layerId);
  if (!element) return null;
  element.removeAttribute(name);
  return serializeFragment(document);
}

/** Read one attribute from a layer (e.g. data-orig-src before restoring). */
export function getLayerAttribute(html: string, layerId: string, name: string): string | null {
  const document = parseFragment(html);
  const element = findLayer(document, layerId);
  return element ? element.getAttribute(name) : null;
}

export function reorderLayerInHtml(
  html: string,
  layerId: string,
  direction: "up" | "down",
): string | null {
  const document = parseFragment(html);
  const element = findLayer(document, layerId);
  const sibling = direction === "up" ? element?.previousElementSibling : element?.nextElementSibling;
  if (!element || !sibling || element.parentElement !== sibling.parentElement) return null;

  if (direction === "up") sibling.before(element);
  else sibling.after(element);
  return serializeFragment(document);
}

export function moveLayerBefore(html: string, layerId: string, targetLayerId: string): string | null {
  const document = parseFragment(html);
  const element = findLayer(document, layerId);
  const target = findLayer(document, targetLayerId);
  if (!element || !target || element === target || element.parentElement !== target.parentElement) return null;
  target.before(element);
  return serializeFragment(document);
}

export type LayerStackPlacement = "above" | "below";
export type LayerStackDirection = "forward" | "backward";
export type LayerStackEdge = "front" | "back";
export type LayerDropPlacement = LayerStackPlacement | "inside";

export interface LayerStackChange {
  html: string;
  /** Layer ids ordered from the back of the canvas to the front. */
  siblingLayerIds: string[];
}

export interface ExtractedLayer {
  html: string;
  layerHtml: string;
  layerIds: string[];
}

export interface RemappedLayerTree {
  html: string;
  idMap: Map<string, string>;
}

function stackChange(document: Document, parent: Element): LayerStackChange {
  return {
    html: serializeFragment(document),
    siblingLayerIds: [...parent.children]
      .map(element => element.getAttribute("data-layer-id"))
      .filter((layerId): layerId is string => Boolean(layerId)),
  };
}

/**
 * Moves a layer relative to another sibling. "Above" matches the layers-panel
 * convention: the moved layer is painted later and therefore appears in front.
 */
export function moveLayerInStack(
  html: string,
  layerId: string,
  targetLayerId: string,
  placement: LayerStackPlacement,
): LayerStackChange | null {
  const document = parseFragment(html);
  const element = findLayer(document, layerId);
  const target = findLayer(document, targetLayerId);
  const parent = target?.parentElement;
  if (!element || !target || !parent || element === target || element.parentElement !== parent) return null;

  if (placement === "above") target.after(element);
  else target.before(element);
  return stackChange(document, parent);
}

/** Moves one layer a single visual step forward or backward. */
export function reorderLayerInStack(
  html: string,
  layerId: string,
  direction: LayerStackDirection,
): LayerStackChange | null {
  const document = parseFragment(html);
  const element = findLayer(document, layerId);
  const parent = element?.parentElement;
  if (!element || !parent) return null;

  const siblings = [...parent.children].filter(sibling => sibling.hasAttribute("data-layer-id"));
  const index = siblings.indexOf(element);
  const target = direction === "forward" ? siblings[index + 1] : siblings[index - 1];
  if (!target) return null;

  if (direction === "forward") target.after(element);
  else target.before(element);
  return stackChange(document, parent);
}

/**
 * Sends a layer all the way to the front or the back of its siblings.
 *
 * Distinct from stepping: repeating a single step would work, but a caller
 * cannot know how many steps are left without re-parsing between each one.
 */
export function moveLayerToStackEdge(
  html: string,
  layerId: string,
  edge: LayerStackEdge,
): LayerStackChange | null {
  const document = parseFragment(html);
  const element = findLayer(document, layerId);
  const parent = element?.parentElement;
  if (!element || !parent) return null;

  const siblings = [...parent.children].filter(sibling => sibling.hasAttribute("data-layer-id"));
  const target = edge === "front" ? siblings[siblings.length - 1] : siblings[0];
  if (!target || target === element) return null;

  if (edge === "front") target.after(element);
  else target.before(element);
  return stackChange(document, parent);
}

/**
 * The ids of every group nested under a layer, outermost first.
 *
 * "Ungroup all" needs the list rather than doing the dissolving itself:
 * dissolving has to preserve layout, which means measuring each group on the
 * canvas between passes. Doing it here from the markup alone would move the
 * contents, which is the bug the layout-preserving path exists to avoid.
 */
export function nestedGroupIds(html: string, rootLayerId?: string): string[] {
  const document = parseFragment(html);
  const root = rootLayerId ? findLayer(document, rootLayerId) : document.body;
  if (!root) return [];

  const candidates = rootLayerId ? [root, ...root.querySelectorAll("*")] : [...root.querySelectorAll("*")];
  return candidates
    .filter(element => element.getAttribute("data-layer-kind") === "group" && element.hasAttribute("data-layer-id"))
    .map(element => element.getAttribute("data-layer-id") as string);
}

/** Reparents a layer inside the same frame, including into semantic groups. */
export function reparentLayerInHtml(
  html: string,
  layerId: string,
  targetLayerId: string | null,
  placement: LayerDropPlacement,
): LayerStackChange | null {
  const document = parseFragment(html);
  const element = findLayer(document, layerId);
  if (!element) return null;

  if (targetLayerId === null) {
    if (placement !== "inside") return null;
    document.body.appendChild(element);
    return stackChange(document, document.body);
  }

  const target = findLayer(document, targetLayerId);
  if (!target || target === element || element.contains(target)) return null;

  if (placement === "inside") {
    target.appendChild(element);
    return stackChange(document, target);
  }

  const parent = target.parentElement;
  if (!parent) return null;
  if (placement === "above") target.after(element);
  else target.before(element);
  return stackChange(document, parent);
}

/** Removes a whole layer subtree while preserving the markup for insertion elsewhere. */
export function extractLayerFromHtml(html: string, layerId: string): ExtractedLayer | null {
  const document = parseFragment(html);
  const element = findLayer(document, layerId);
  if (!element) return null;

  const layerIds = [element, ...element.querySelectorAll("[data-layer-id]")]
    .map(item => item.getAttribute("data-layer-id"))
    .filter((id): id is string => Boolean(id));
  const layerHtml = element.outerHTML;
  element.remove();
  return { html: serializeFragment(document), layerHtml, layerIds };
}

/** Remaps only ids that would collide with layers already present in the target frame. */
export function remapLayerTreeForTarget(
  layerHtml: string,
  targetHtml: string,
  createId: () => string,
): RemappedLayerTree | null {
  const sourceDocument = parseFragment(layerHtml);
  const root = sourceDocument.body.firstElementChild;
  if (!root) return null;

  const targetDocument = parseFragment(targetHtml);
  const occupied = new Set(
    [...targetDocument.body.querySelectorAll("[data-layer-id]")]
      .map(element => element.getAttribute("data-layer-id"))
      .filter((id): id is string => Boolean(id)),
  );
  const idMap = new Map<string, string>();
  for (const element of [root, ...root.querySelectorAll("[data-layer-id]")]) {
    const oldId = element.getAttribute("data-layer-id");
    if (!oldId) continue;
    if (!occupied.has(oldId)) {
      occupied.add(oldId);
      continue;
    }

    let newId = createId();
    while (occupied.has(newId)) newId = createId();
    element.setAttribute("data-layer-id", newId);
    occupied.add(newId);
    idMap.set(oldId, newId);
  }
  return { html: root.outerHTML, idMap };
}

/** Inserts a previously extracted subtree into a frame or semantic group. */
export function insertLayerIntoHtml(
  html: string,
  layerHtml: string,
  targetLayerId: string | null,
  placement: LayerDropPlacement,
): LayerStackChange | null {
  const document = parseFragment(html);
  const fragment = parseFragment(layerHtml);
  const element = fragment.body.firstElementChild;
  if (!element) return null;

  const movedIds = [element, ...element.querySelectorAll("[data-layer-id]")]
    .map(item => item.getAttribute("data-layer-id"))
    .filter((id): id is string => Boolean(id));
  if (movedIds.some(id => findLayer(document, id))) return null;

  const imported = document.importNode(element, true);
  if (targetLayerId === null) {
    if (placement !== "inside") return null;
    document.body.appendChild(imported);
    return stackChange(document, document.body);
  }

  const target = findLayer(document, targetLayerId);
  if (!target) return null;
  if (placement === "inside") {
    target.appendChild(imported);
    return stackChange(document, target);
  }

  const parent = target.parentElement;
  if (!parent) return null;
  if (placement === "above") target.after(imported);
  else target.before(imported);
  return stackChange(document, parent);
}

function nextGroupName(document: Document): string {
  let highest = 0;
  let groupCount = 0;
  for (const element of document.body.querySelectorAll("*")) {
    const isGroup = element.getAttribute("data-layer-kind") === "group"
      || (element.tagName.toLowerCase() !== "svg" && element.children.length > 0);
    if (!isGroup) continue;
    groupCount++;
    const match = /^Group\s+(\d+)$/i.exec(element.getAttribute("data-layer-name") || "");
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `Group ${Math.max(highest, groupCount) + 1}`;
}

export function groupLayersInHtml(
  html: string,
  layerIds: string[],
  groupId: string,
  groupName?: string,
): string | null {
  if (layerIds.length < 2) return null;
  const document = parseFragment(html);
  const elements = layerIds.map(id => findLayer(document, id));
  if (elements.some(element => !element)) return null;

  const layers = elements as Element[];
  const parent = layers[0].parentElement;
  if (!parent || layers.some(layer => layer.parentElement !== parent)) return null;

  const selected = new Set(layers);
  const ordered = [...parent.children].filter(child => selected.has(child));
  const group = document.createElement("div");
  group.setAttribute("data-layer-id", groupId);
  group.setAttribute("data-layer-kind", "group");
  group.setAttribute("data-layer-name", groupName || nextGroupName(document));
  group.style.display = "contents";
  ordered[0].before(group);
  for (const layer of ordered) group.appendChild(layer);
  return serializeFragment(document);
}

export interface WrapLayerEntry {
  layerId: string;
  /** Measured offset of the layer relative to the new frame's origin. */
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Wrap the given layers inside a new frame container (Figma-style Ctrl+Alt+G).
 * The frame becomes the layers' parent and its own coordinate system: children
 * are pinned with inline absolute offsets measured relative to the frame.
 */
export function wrapLayersInFrame(
  html: string,
  entries: WrapLayerEntry[],
  frame: { layerId: string; name: string; left: number; top: number; width: number; height: number },
): string | null {
  if (entries.length === 0) return null;
  const document = parseFragment(html);
  const elements = entries.map(entry => findLayer(document, entry.layerId));
  if (elements.some(element => !element)) return null;

  const layers = elements as Element[];
  const parent = layers[0].parentElement;
  if (!parent || layers.some(layer => layer.parentElement !== parent)) return null;

  const container = document.createElement("div");
  container.setAttribute("data-layer-id", frame.layerId);
  container.setAttribute("data-layer-kind", "frame");
  container.setAttribute("data-layer-name", frame.name);
  container.setAttribute(
    "style",
    `position:absolute;left:${frame.left}px;top:${frame.top}px;width:${frame.width}px;height:${frame.height}px;overflow:hidden;`,
  );

  const selected = new Set(layers);
  const ordered = [...parent.children].filter(child => selected.has(child));
  ordered[0].before(container);
  for (let index = 0; index < ordered.length; index++) {
    const layer = ordered[index] as HTMLElement;
    const entry = entries.find(candidate => candidate.layerId === layer.getAttribute("data-layer-id"))!;
    layer.style.position = "absolute";
    layer.style.left = `${entry.left}px`;
    layer.style.top = `${entry.top}px`;
    layer.style.width = `${entry.width}px`;
    layer.style.height = `${entry.height}px`;
    container.appendChild(layer);
  }
  return serializeFragment(document);
}

export function ungroupLayerInHtml(html: string, groupId: string): string | null {
  const document = parseFragment(html);
  const group = findLayer(document, groupId);
  if (!group || !group.parentElement) return null;
  group.replaceWith(...group.childNodes);
  return serializeFragment(document);
}
