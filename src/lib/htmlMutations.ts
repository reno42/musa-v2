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

function offsetInlinePosition(element: Element): void {
  if (!(element instanceof HTMLElement)) return;
  for (const property of ["left", "top"] as const) {
    const value = element.style[property];
    if (/^-?\d+(?:\.\d+)?px$/.test(value)) {
      element.style[property] = `${parseFloat(value) + 20}px`;
    }
  }
}

export function ensureLayerIds(html: string, createId: () => string): string {
  if (!html.trim()) return html;
  const document = parseFragment(html);
  let changed = false;
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

  const clone = element.cloneNode(true) as Element;
  const idMap = new Map<string, string>();
  for (const clonedElement of [clone, ...clone.querySelectorAll("[data-layer-id]")]) {
    const oldId = clonedElement.getAttribute("data-layer-id");
    if (!oldId) continue;
    const newId = createId();
    clonedElement.setAttribute("data-layer-id", newId);
    idMap.set(oldId, newId);
  }
  offsetInlinePosition(clone);
  element.after(clone);
  return { html: serializeFragment(document), idMap };
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

export function groupLayersInHtml(
  html: string,
  layerIds: string[],
  groupId: string,
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
