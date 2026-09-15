/**
 * Canonical semantic layer classification shared by the editor and MCP.
 *
 * A group is structural and therefore never paints. Any wrapper that paints a
 * box is a real container. Text runs remain formatting inside one text layer.
 */
import { paintsABox } from "./paintDetection.ts";

const TEXT_TAGS = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "span", "a", "em", "strong", "small",
  "b", "i", "code", "pre", "blockquote", "label", "figcaption", "cite", "q",
  "sub", "sup", "mark", "del", "ins", "u", "s", "br",
]);

export interface ChildShape {
  tag: string;
  hasChildren: boolean;
  styleAttr?: string | null;
}

export type LayerKind = "shape" | "image" | "text" | "button" | "group" | "container" | "component";

const BLOCK_IDENTITY_PROPS = ["font-family", "font-size", "font-weight", "font-style", "color"];

function readProp(styleAttr: string | null | undefined, prop: string): string {
  const hit = (styleAttr || "").match(new RegExp(`(^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "i"));
  return hit ? hit[2].trim().toLowerCase() : "";
}

export function styleFingerprint(styleAttr: string | null | undefined): string {
  return BLOCK_IDENTITY_PROPS.map(prop => `${prop}:${readProp(styleAttr, prop)}`).join("|");
}

export function isTextBlock(children: ChildShape[]): boolean {
  if (children.length === 0) return false;
  return children.every(child => TEXT_TAGS.has(child.tag.toLowerCase()) && !child.hasChildren);
}

export function classifyLayer(element: {
  tag: string;
  styleAttr?: string | null;
  children: ChildShape[];
  hasDirectText?: boolean;
}): LayerKind {
  const tag = element.tag.toLowerCase();
  if (tag === "svg") return "shape";
  if (["img", "video", "canvas", "picture"].includes(tag)) return "image";
  if (tag === "button") return "button";

  // Paint ownership wins over DOM shape. A painted wrapper is an object.
  if (paintsABox(element.styleAttr)) return "container";

  const hasChildren = element.children.length > 0;
  if (!hasChildren) {
    if (TEXT_TAGS.has(tag) || element.hasDirectText) return "text";
    return "container";
  }

  if (isTextBlock(element.children)) return "text";
  return "group";
}

