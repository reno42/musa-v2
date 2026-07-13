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

function offsetInlinePosition(element: Element, offset = 20): void {
  if (!(element instanceof HTMLElement)) return;
  for (const property of ["left", "top"] as const) {
    const value = element.style[property];
    if (/^-?\d+(?:\.\d+)?px$/.test(value)) {
      element.style[property] = `${parseFloat(value) + offset}px`;
    }
  }
}

function cloneLayerTree(element: Element, createId: () => string): { clone: Element; idMap: Map<string, string> } {
  const clone = element.cloneNode(true) as Element;
  const idMap = new Map<string, string>();
  for (const clonedElement of [clone, ...clone.querySelectorAll("[data-layer-id]")]) {
    const oldId = clonedElement.getAttribute("data-layer-id");
    if (!oldId) continue;
    const newId = createId();
    clonedElement.setAttribute("data-layer-id", newId);
    idMap.set(oldId, newId);
  }
  return { clone, idMap };
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
    if (!element.hasAttribute("data-layer-id")) {
      element.setAttribute("data-layer-id", createId());
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
): { html: string; idMap: Map<string, string>; rootLayerId: string } | null {
  const sourceDocument = parseFragment(sourceHtml);
  const sourceElement = findLayer(sourceDocument, sourceLayerId);
  if (!sourceElement) return null;

  const targetDocument = parseFragment(targetHtml);
  const { clone, idMap } = cloneLayerTree(sourceElement, createId);
  offsetInlinePosition(clone, offset);

  const matchingTarget = findLayer(targetDocument, sourceLayerId);
  if (matchingTarget) matchingTarget.after(clone);
  else targetDocument.body.appendChild(clone);

  const rootLayerId = idMap.get(sourceLayerId);
  if (!rootLayerId) return null;
  return { html: serializeFragment(targetDocument), idMap, rootLayerId };
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

export function ungroupLayerInHtml(html: string, groupId: string): string | null {
  const document = parseFragment(html);
  const group = findLayer(document, groupId);
  if (!group || !group.parentElement) return null;
  group.replaceWith(...group.childNodes);
  return serializeFragment(document);
}
