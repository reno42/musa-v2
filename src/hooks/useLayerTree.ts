import { useMemo } from "react";

export interface LayerNode {
  layerId: string;
  tag: string;
  text: string;
  depth: number;
  parentId: string | null;
  children: string[];
}

/**
 * Parses an HTML string and extracts all elements with data-layer-id into
 * a flat tree structure suitable for rendering a layers panel.
 */
export function useLayerTree(html: string): LayerNode[] {
  return useMemo(() => parseLayerTree(html), [html]);
}

export function parseLayerTree(html: string): LayerNode[] {
  if (!html) return [];

  const nodes: LayerNode[] = [];
  // Use a simple tag-based parser (regex) tuned for the subset of HTML we generate
  const tagRe = /<(\w+)([^>]*)>(.*?)<\/\1>|<(\w+)([^>]*)\s*\/>/gs;
  const stack: { layerId: string; tag: string }[] = [];
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(html)) !== null) {
    const isSelfClosing = !!match[4];
    const tag = (match[1] || match[4] || "").toLowerCase();
    const attrs = match[2] || match[5] || "";
    const inner = match[3] || "";

    // Extract data-layer-id
    const lidMatch = attrs.match(/data-layer-id="([^"]+)"/);
    if (!lidMatch) continue;

    const layerId = lidMatch[1];
    const parentId = stack.length > 0 ? stack[stack.length - 1].layerId : null;

    // Extract text preview
    let text = "";
    if (!isSelfClosing) {
      const stripped = inner.replace(/<[^>]+>/g, "").trim();
      text = stripped.substring(0, 40) + (stripped.length > 40 ? "…" : "");
      if (!text && tag === "img") {
        const srcMatch = attrs.match(/src="([^"]+)"/);
        text = srcMatch ? `🖼 ${srcMatch[1].substring(0, 30)}` : "🖼 Image";
      }
      if (!text && tag === "svg") {
        text = "📐 SVG Path";
      }
    }

    nodes.push({
      layerId,
      tag,
      text: text || tag,
      depth: stack.length,
      parentId,
      children: [],
    });

    // Track parent-child relationships
    if (parentId) {
      const parent = nodes.find(n => n.layerId === parentId);
      if (parent) parent.children.push(layerId);
    }

    if (!isSelfClosing) {
      stack.push({ layerId, tag });
    }

    // Pop stack when closing tag is encountered in the raw HTML
    // (the regex greedy match handles nesting for us, but we need to manage stack)
  }

  // Realign stack by scanning for closing tags of elements we pushed
  // This is an approximation — full HTML parser would be more accurate
  // For our use case (design tool generated HTML), regex is sufficient
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
