export const MIXED_TEXT_STYLE = "__mixed__";

export const RICH_TEXT_PROPERTIES = [
  "font-family", "font-size", "font-weight", "font-style", "color",
  "letter-spacing", "line-height", "text-decoration", "text-transform",
] as const;

export type RichTextProperty = typeof RICH_TEXT_PROPERTIES[number];

/**
 * Length properties where a bare number means pixels. Typing "56" into the
 * Size field used to write `font-size: 56` — invalid CSS — so the browser
 * ignored it silently and the panel snapped back to the old value (dogfood
 * BUG-12). line-height stays absent on purpose: unitless ratios are valid.
 */
const PX_PROPERTIES = new Set<string>(["font-size", "letter-spacing"]);

export function normalizeRichTextValue(property: string, value: string): string {
  if (!PX_PROPERTIES.has(property)) return value;
  return /^\s*-?\d+(\.\d+)?\s*$/.test(value) ? `${value.trim()}px` : value;
}

/** Live bridge from the contextual panel to a frame's Shadow DOM selection. */
export const frameRichTextRegistry = new Map<string, (layerId: string, property: RichTextProperty, value: string) => void>();

function selectedTextNodes(root: HTMLElement, range: Range | null): Text[] {
  const nodes: Text[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, root.ownerDocument.defaultView!.NodeFilter.SHOW_TEXT);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    if (!node.data.length || (range && !range.intersectsNode(node))) continue;
    nodes.push(node);
  }
  return nodes;
}

export function summarizeRichTextStyles(root: HTMLElement, range: Range | null): Record<string, string> {
  const nodes = selectedTextNodes(root, range);
  const summary: Record<string, string> = {};
  for (const property of RICH_TEXT_PROPERTIES) {
    const values = new Set(nodes.map(node =>
      root.ownerDocument.defaultView!.getComputedStyle(node.parentElement || root).getPropertyValue(property).trim(),
    ));
    summary[property] = values.size > 1 ? MIXED_TEXT_STYLE : (values.values().next().value || "");
  }
  return summary;
}

function cleanFormattingSpans(root: HTMLElement): void {
  for (const span of [...root.querySelectorAll("span")].reverse()) {
    if (!span.getAttribute("style")?.trim() && !span.attributes.length) span.replaceWith(...span.childNodes);
  }
  root.normalize();
}

export function applyRichTextStyle(root: HTMLElement, range: Range | null, property: RichTextProperty, value: string): Range | null {
  if (!range || range.collapsed || !root.contains(range.commonAncestorContainer)) {
    root.style.setProperty(property, normalizeRichTextValue(property, value));
    for (const child of root.querySelectorAll<HTMLElement>("span")) child.style.removeProperty(property);
    cleanFormattingSpans(root);
    return null;
  }

  const span = root.ownerDocument.createElement("span");
  span.style.setProperty(property, normalizeRichTextValue(property, value));
  span.appendChild(range.extractContents());
  range.insertNode(span);
  const next = root.ownerDocument.createRange();
  next.selectNodeContents(span);
  cleanFormattingSpans(root);
  return next;
}
