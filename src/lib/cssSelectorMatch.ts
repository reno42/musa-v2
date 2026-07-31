/**
 * Compound CSS selector matching: tag, .class, #id and [attr="value"] in any
 * combination (e.g. `img[data-layer-id="x"]`), no DOM required — only the
 * three element facts a match can depend on.
 *
 * Used by the SVG vector exporter (EditorV2.tsx buildFrameSvg) to resolve
 * which rules apply to which element. Every layer this app generates is
 * styled via its own `[data-layer-id="…"]` rule — a plain tag/.class/#id
 * matcher (what used to be here) never matches that, so every per-layer
 * rule silently failed to resolve: size, color, filter, all of it. That is
 * why an `<img>` styled only through its data-layer-id rule never got a
 * width/height and the SVG exporter skipped emitting it entirely — not a
 * networking or CORS issue, the element was simply invisible to the export.
 *
 * Descendant/combinator selectors ("body img", ".card > img") are
 * intentionally rejected rather than mismatched — this app never authors
 * those; every rule targets exactly one layer by id.
 */

export interface SelectableElement {
  tagName: string;
  id: string;
  classList: { contains(cls: string): boolean };
  hasAttribute(name: string): boolean;
  getAttribute(name: string): string | null;
}

export function matchesCompoundSelector(el: SelectableElement, selector: string): boolean {
  const trimmed = selector.trim();
  if (!trimmed || /[\s>+~]/.test(trimmed)) return false;

  const partRe = /([a-zA-Z][a-zA-Z0-9-]*)|\.([\w-]+)|#([\w-]+)|\[([\w-]+)(?:=("([^"]*)"|'([^']*)'|[^\]]*))?\]/g;
  let m: RegExpExecArray | null;
  let matchedAny = false;
  let cursor = 0;

  while ((m = partRe.exec(trimmed)) !== null) {
    if (m.index !== cursor) return false; // unrecognized character(s) in the selector
    cursor = partRe.lastIndex;
    matchedAny = true;
    if (m[1]) {
      if (el.tagName.toLowerCase() !== m[1].toLowerCase()) return false;
    } else if (m[2]) {
      if (!el.classList.contains(m[2])) return false;
    } else if (m[3]) {
      if (el.id !== m[3]) return false;
    } else if (m[4]) {
      if (!el.hasAttribute(m[4])) return false;
      const expected = m[6] ?? m[7] ?? m[5];
      if (expected !== undefined && el.getAttribute(m[4]) !== expected) return false;
    }
  }
  return matchedAny && cursor === trimmed.length;
}
