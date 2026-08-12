/**
 * What a layer IS — and specifically, when a wrapper is a group and when it is
 * a real design element that merely happens to contain something.
 *
 * The distinction costs real time. Everything with children was called a
 * "group", so a painted card holding a headline was a group, a text block made
 * of two lines was a group, and getting to the thing you wanted meant
 * ungrouping your way down to it. Worse, ungrouping a "group" that was really
 * a painted card dropped its background — the paint lived on the wrapper, and
 * the wrapper was treated as scaffolding.
 *
 * Two rules fix both:
 *
 *   A wrapper that PAINTS is not a group. Background, border, shadow — any of
 *   them means someone drew that box on purpose, so it is a container: a real
 *   element with a fill, which is why a group must never carry paint.
 *
 *   A wrapper whose children are all text runs is a TEXT BLOCK, not a group.
 *   A heading over a subheading is one thing a person moves, styles and
 *   selects as a unit. It is not two texts that were grouped.
 *
 * Pure and DOM-free so QA can cover it; htmlMutations calls it while walking
 * the tree. Whether a style paints is asked of shared/paintDetection, so the
 * editor and the server cannot disagree about what counts as paint.
 */

import { paintsABox } from "../../shared/paintDetection.ts";

const TEXT_TAGS = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "span", "a", "em", "strong", "small",
  "b", "i", "code", "pre", "blockquote", "label", "figcaption", "cite", "q",
  "sub", "sup", "mark", "del", "ins", "u", "s", "br",
]);

export interface ChildShape {
  tag: string;
  hasChildren: boolean;
  /** Inline style, used to tell one block from two. */
  styleAttr?: string | null;
}

/** The properties that decide whether two runs belong to the same block. */
const BLOCK_IDENTITY_PROPS = ["font-family", "font-size", "font-weight", "font-style", "color"];

/** Reads one declaration out of an inline style. */
function readProp(styleAttr: string | null | undefined, prop: string): string {
  const hit = (styleAttr || "").match(new RegExp(`(^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "i"));
  return hit ? hit[2].trim().toLowerCase() : "";
}

/**
 * The style fingerprint that decides block membership.
 *
 * Two runs are the same block only if they look the same. Renzo's example is
 * the whole rule: "El carro está bonito" is one block — but bold and recolour
 * "está" and it becomes three, because that word now needs its own font and
 * colour and there is no way to express that from a single block's controls.
 * Its neighbours are separated by it, so they cannot be one block either.
 */
export function styleFingerprint(styleAttr: string | null | undefined): string {
  return BLOCK_IDENTITY_PROPS.map(p => `${p}:${readProp(styleAttr, p)}`).join("|");
}

/**
 * True when every child is a plain text run AND they all share one look.
 *
 * A heading over a subheading is one block: a person selects it, moves it and
 * styles it as a unit. The moment one run carries a different font, weight or
 * colour, it is a block of its own — a single block has one set of type
 * controls, so two looks inside it would be unconfigurable.
 */
export function isTextBlock(children: ChildShape[]): boolean {
  if (children.length === 0) return false;
  if (!children.every(c => TEXT_TAGS.has(c.tag.toLowerCase()) && !c.hasChildren)) return false;
  const first = styleFingerprint(children[0].styleAttr);
  return children.every(c => styleFingerprint(c.styleAttr) === first);
}

export type LayerKind = "shape" | "image" | "text" | "group" | "container";

/**
 * Decides a layer's kind from what it is made of.
 *
 * `container` is the answer whenever the element is a thing in its own right:
 * it paints, or it is a block of text. `group` is reserved for pure
 * scaffolding — a wrapper that draws nothing and holds unrelated elements,
 * which is the only case where flattening it is lossless.
 */
export function classifyLayer(el: {
  tag: string;
  styleAttr?: string | null;
  children: ChildShape[];
}): LayerKind {
  const tag = el.tag.toLowerCase();
  if (tag === "svg") return "shape";
  if (["img", "video", "canvas", "picture"].includes(tag)) return "image";

  const hasChildren = el.children.length > 0;
  if (!hasChildren) return TEXT_TAGS.has(tag) ? "text" : "container";

  // A wrapper that paints is a real box, and a real box is never a group —
  // which is what stops an ungroup from throwing its background away.
  if (paintsABox(el.styleAttr)) return "container";

  // Several text runs and nothing else: one text block.
  if (isTextBlock(el.children)) return "container";

  return "group";
}
