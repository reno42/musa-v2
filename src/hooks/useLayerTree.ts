import { useMemo } from "react";
export {
  groupLayersInHtml,
  moveLayerBefore,
  reorderLayerInHtml,
  ungroupLayerInHtml,
} from "../lib/htmlMutations";

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
