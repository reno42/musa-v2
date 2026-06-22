import { useMemo } from "react";

export interface LayerNode {
  layerId: string;
  tag: string;
  text: string;
  depth: number;
  parentId: string | null;
  children: string[];
  /** DOM child-index path from body to this element. Used to locate auto-generated layers. */
  path: number[];
}

let _autoIdCounter = 0;
function resetAutoIds() { _autoIdCounter = 0; }

/**
 * Parses an HTML string and extracts all elements with data-layer-id into
 * a flat tree structure suitable for rendering a layers panel.
 */
export function useLayerTree(html: string): LayerNode[] {
  return useMemo(() => parseLayerTree(html), [html]);
}

export function parseLayerTree(html: string): LayerNode[] {
  if (!html) return [];

  resetAutoIds();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  if (!doc.body) return [];

  const nodes: LayerNode[] = [];
  const stack: string[] = [];
  const path: number[] = [];

  function walk(el: Element) {
    const hasLid = el.hasAttribute("data-layer-id");
    const tag = el.tagName.toLowerCase();

    // Get direct text (not from children) to detect if this is a structural wrapper
    let directText = "";
    for (let i = 0; i < el.childNodes.length; i++) {
      if (el.childNodes[i].nodeType === 3) { // Text node
        directText += el.childNodes[i].textContent || "";
      }
    }
    const trimmedDirect = directText.trim();

    // Skip structural wrappers: div with no data-layer-id, no direct text, has children
    const isWrapper = tag === "div" && !hasLid && el.children.length > 0 && !trimmedDirect;

    if (!isWrapper) {
      const lid = hasLid ? el.getAttribute("data-layer-id")! : `auto_${_autoIdCounter++}`;
      const parentId = stack.length > 0 ? stack[stack.length - 1] : null;
      const depth = stack.length;

      let text = "";
      if (lid.startsWith("grp_")) {
        // Group name
        text = `Grupo ${lid.replace("grp_", "").substring(0, 6)}`;
      } else if (tag === "img") {
        const src = el.getAttribute("src") || "";
        text = src ? `🖼 ${src.substring(0, 30)}` : "🖼 Image";
      } else if (tag === "svg") {
        text = "📐 SVG Path";
      } else if (trimmedDirect) {
        text = trimmedDirect.substring(0, 40) + (trimmedDirect.length > 40 ? "…" : "");
      } else if (!el.children.length && el.textContent) {
        const tc = el.textContent.trim();
        text = tc.substring(0, 40) + (tc.length > 40 ? "…" : "");
      }

      nodes.push({
        layerId: lid,
        tag,
        text: text || tag,
        depth,
        parentId,
        children: [],
        path: [...path],
      });

      if (parentId) {
        const parent = nodes.find(n => n.layerId === parentId);
        if (parent) parent.children.push(lid);
      }

      stack.push(lid);
    }

    for (let i = 0; i < el.children.length; i++) {
      path.push(i);
      walk(el.children[i]);
      path.pop();
    }

    if (!isWrapper) {
      stack.pop();
    }
  }

  // Walk all children of body (skip body itself)
  for (let i = 0; i < doc.body.children.length; i++) {
    path[0] = i;
    walk(doc.body.children[i]);
  }

  return nodes;
}

/**
 * Reorder layers: moves a child element before/after a sibling in the HTML.
 */
export function reorderLayerInHtml(
  html: string,
  layerId: string,
  direction: "up" | "down",
): string | null {
  if (layerId.startsWith("auto_")) return null;
  const elRe = new RegExp(
    `(<[^>]*data-layer-id="${layerId}"[^>]*>[\\s\\S]*?<\\/[a-zA-Z0-9]+>|<[^>]*data-layer-id="${layerId}"[^>]*\\s*\\/?>)`,
    "",
  );
  const match = elRe.exec(html);
  if (!match) return null;

  if (direction === "up") {
    // Move element before the previous sibling
    const before = html.lastIndexOf("\n", match.index - 1);
    if (before < 0) return null;
    const prevBlock = html.lastIndexOf("\n", before - 1);
    const insertAt = prevBlock >= 0 ? prevBlock : 0;
    const removed = html.slice(0, match.index) + html.slice(match.index + match[0].length);
    return removed.slice(0, insertAt) + match[0] + "\n" + removed.slice(insertAt);
  } else {
    // Move element after the next sibling
    const afterEnd = match.index + match[0].length;
    const nextNewline = html.indexOf("\n", afterEnd);
    if (nextNewline < 0) return null;
    const nextElemStart = html.indexOf("<", nextNewline);
    if (nextElemStart < 0) {
      // Append at end
      const removed = html.slice(0, match.index) + html.slice(match.index + match[0].length);
      return removed + "\n" + match[0];
    }
    const nextElemEndRe = new RegExp(
      `(<[^>]*data-layer-id="([^"]+)"[^>]*>[\\s\\S]*?<\\/[a-zA-Z0-9]+>|<[^>]*data-layer-id="([^"]+)"[^>]*\\s*\\/?>)`,
      "",
    );
    nextElemEndRe.lastIndex = nextElemStart;
    const nextMatch = nextElemEndRe.exec(html);
    const insertAt = nextMatch ? nextMatch.index + nextMatch[0].length + 1 : html.length;
    const removed = html.slice(0, match.index) + html.slice(match.index + match[0].length);
    return removed.slice(0, insertAt - match[0].length - 1) + match[0] + "\n" + removed.slice(insertAt - match[0].length - 1);
  }
}

/**
 * Group multiple layers by wrapping them in a container div.
 */
export function groupLayersInHtml(
  html: string,
  layerIds: string[],
): { html: string; groupId: string } | null {
  if (layerIds.length < 2) return null;

  const groupId = `grp_${Date.now().toString(36)}`;
  const childHtmls: string[] = [];
  let result = html;

  for (const lid of layerIds) {
    const elRe = new RegExp(
      `(<[^>]*data-layer-id="${lid}"[^>]*>[\\s\\S]*?<\\/[a-zA-Z0-9]+>|<[^>]*data-layer-id="${lid}"[^>]*\\s*\\/?>)`,
      "",
    );
    const m = elRe.exec(result);
    if (m) {
      childHtmls.push(m[1]);
      result = result.replace(m[1], "");
    }
  }

  if (childHtmls.length === 0) return null;

  const wrapper = `<div data-layer-id="${groupId}">\n${childHtmls.join("\n")}\n</div>`;
  result = result + "\n" + wrapper;
  return { html: result, groupId };
}

/**
 * Ungroup: extract children from a wrapper div, remove the wrapper.
 */
export function ungroupLayerInHtml(
  html: string,
  groupId: string,
): string | null {
  const elRe = new RegExp(
    `<div[^>]*data-layer-id="${groupId}"[^>]*>([\\s\\S]*?)<\\/div>`,
    "",
  );
  const match = elRe.exec(html);
  if (!match) return null;
  const children = match[1].trim();
  return html.replace(match[0], children);
}
