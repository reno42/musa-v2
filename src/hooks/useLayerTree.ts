import { useMemo } from "react";
import { classifyLayer } from "../lib/layerKind.ts";
import { elementCssDeclarations } from "../lib/layerCss.ts";

export {
  groupLayersInHtml,
  moveLayerInStack,
  reorderLayerInStack,
  ungroupLayerInHtml,
} from "../lib/htmlMutations";

export type LayerKind = "text" | "image" | "svg" | "bezier" | "shape" | "button" | "group" | "container" | "component";

export interface LayerNode {
  layerId: string;
  tag: string;
  kind: LayerKind;
  name: string;
  depth: number;
  parentId: string | null;
  children: string[];
  autoNamed: boolean;
  /** DOM child-index path from body to this element. Used to locate layers without ids. */
  path: number[];
}

const TEXT_TAGS = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "a", "button", "label", "li",
  "strong", "em", "small", "blockquote", "figcaption", "text", "textpath",
]);

function directText(element: Element): string {
  return [...element.childNodes]
    .filter(node => node.nodeType === Node.TEXT_NODE)
    .map(node => node.textContent || "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactText(value: string): string {
  return value.length > 44 ? `${value.slice(0, 43)}…` : value;
}

function humanizeIdentifier(value: string): string {
  return value
    .replace(/^(?:el|auto|grp)[_-]/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, character => character.toUpperCase())
    .trim();
}

function isGeneratedIdentifier(value: string): boolean {
  return /^(?:el|auto|grp)[_-]/i.test(value);
}

function inferLayerKind(element: Element, text: string, css: string): LayerKind {
  const declared = element.getAttribute("data-layer-kind")?.toLowerCase();
  const tag = element.tagName.toLowerCase();
  const inferred = classifyLayer({
    tag,
    styleAttr: elementCssDeclarations(element, css),
    hasDirectText: Boolean(text),
    children: [...element.children].map(child => ({
      tag: child.tagName,
      hasChildren: child.children.length > 0,
      styleAttr: elementCssDeclarations(child, css),
    })),
  });

  if (declared && ["text", "image", "svg", "bezier", "shape", "button", "group", "container", "component"].includes(declared)) {
    return declared === "group" && inferred === "container" ? "container" : declared as LayerKind;
  }
  if (tag === "svg") return "svg";
  if (["input", "select", "textarea", "form"].includes(tag)) return "component";
  return inferred;
}

function inferLayerName(
  element: Element,
  layerId: string,
  kind: LayerKind,
  text: string,
  groupNumber: number,
): string {
  const explicitName = element.getAttribute("data-layer-name")
    || element.getAttribute("aria-label")
    || element.getAttribute("title");
  if (explicitName?.trim()) return compactText(explicitName.trim());

  if (kind === "group") return `Group ${groupNumber}`;
  if (kind === "container") return "Container";
  if (kind === "button") return "Button";

  if (kind === "text") {
    const readableText = text || element.textContent?.replace(/\s+/g, " ").trim() || "";
    if (readableText) return compactText(readableText);
  }
  if (kind === "image") {
    const alt = element.getAttribute("alt")?.trim();
    if (alt) return compactText(alt);
    const source = element.getAttribute("src") || "";
    if (source.startsWith("data:")) return "Image";
    const filename = source.split(/[\\/]/).pop()?.split(/[?#]/)[0];
    return filename ? compactText(filename) : "Image";
  }
  if (kind === "bezier") return "Bezier";
  if (kind === "svg") {
    const title = element.querySelector("title")?.textContent?.trim();
    return title ? compactText(title) : "SVG";
  }

  if (!isGeneratedIdentifier(layerId)) {
    const identifierName = humanizeIdentifier(layerId);
    if (identifierName) return compactText(identifierName);
  }

  if (kind === "component") return "Component";

  const style = element.getAttribute("style") || "";
  if (/border-radius\s*:\s*50%/i.test(style)) return "Circle";
  return "Shape";
}

/** Parses editor HTML into semantic layer nodes without exposing raw DOM tag names. */
export function parseLayerTree(html: string, css = ""): LayerNode[] {
  if (!html.trim()) return [];

  const document = new DOMParser().parseFromString(html, "text/html");
  const nodes: LayerNode[] = [];
  const byId = new Map<string, LayerNode>();
  let groupCount = 0;

  function walk(element: Element, path: number[], parentId: string | null, depth: number): void {
    const text = directText(element);
    const tag = element.tagName.toLowerCase();
    if (tag === "br") return;
    const declaredId = element.getAttribute("data-layer-id");
    const layerId = declaredId || `auto_${path.join("_")}`;
    const kind = inferLayerKind(element, text, css);
    const isStructuralWrapper = !declaredId && kind === "group" && tag === "div" && element.children.length > 0 && !text;
    let nextParentId = parentId;
    let nextDepth = depth;

    if (!isStructuralWrapper) {
      const groupNumber = kind === "group" ? ++groupCount : 0;
      const hasExplicitName = Boolean((
        element.getAttribute("data-layer-name")
        || element.getAttribute("aria-label")
        || element.getAttribute("title")
      )?.trim());
      const node: LayerNode = {
        layerId,
        tag,
        kind,
        name: inferLayerName(element, layerId, kind, text, groupNumber),
        depth,
        parentId,
        children: [],
        autoNamed: kind === "group" && !hasExplicitName,
        path,
      };
      nodes.push(node);
      byId.set(layerId, node);
      if (parentId) byId.get(parentId)?.children.push(layerId);
      nextParentId = layerId;
      nextDepth = depth + 1;
    }

    // SVG internals and rich-text runs are content of one layer, never layers.
    if (tag === "svg" || kind === "text") return;
    [...element.children].forEach((child, index) => {
      walk(child, [...path, index], nextParentId, nextDepth);
    });
  }

  [...document.body.children].forEach((element, index) => walk(element, [index], null, 0));
  return nodes;
}

export function useLayerTree(html: string, css = ""): LayerNode[] {
  return useMemo(() => parseLayerTree(html, css), [html, css]);
}
