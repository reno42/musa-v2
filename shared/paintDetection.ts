/**
 * Whether a block of CSS paints a visible box.
 *
 * One question, asked from two places for two reasons: the editor asks it to
 * decide whether a wrapper is real scaffolding or a card someone drew on
 * purpose, and the server asks it to enforce that a group never paints. Both
 * have to answer identically or a layer changes meaning on its way through.
 *
 * Reads declarations as text rather than computed styles on purpose: this runs
 * over HTML and CSS strings where there is no layout to compute from. A
 * class-based background is therefore missed, and the layer stays a group —
 * which is why the editor re-checks against the live DOM before ungrouping.
 */

/** CSS that means "somebody drew this box". */
export const PAINT_PROPS = [
  "background", "background-color", "background-image",
  "border", "border-width", "border-top", "border-right", "border-bottom", "border-left",
  "box-shadow", "backdrop-filter",
] as const;

/** Values that look like paint but are not. */
const BLANK_PAINT = new Set([
  "none", "transparent", "0", "0px", "initial", "unset", "inherit",
  "rgba(0, 0, 0, 0)", "rgba(0,0,0,0)",
]);

export function paintsABox(declarations: string | null | undefined): boolean {
  const style = (declarations || "").toLowerCase();
  if (!style) return false;

  for (const prop of PAINT_PROPS) {
    // The boundary stops `background-color:` matching inside `background-clip:`
    // and `border-width` inside `-webkit-border-width`. `{` counts too, since
    // this is also handed whole rule bodies.
    const hit = style.match(new RegExp(`(^|[;{])\\s*${prop}\\s*:\\s*([^;]+)`, "i"));
    if (!hit) continue;

    const value = hit[2].trim().replace(/!important$/, "").trim();
    if (!value || BLANK_PAINT.has(value)) continue;

    // A zero-width BORDER draws nothing. Scoped to borders on purpose: a
    // shadow legitimately starts at a zero offset — `box-shadow: 0 2px 8px …`
    // is one of the most common ways to paint a card.
    if (prop.startsWith("border") && /^0(px)?(\s|$)/.test(value)) continue;
    return true;
  }
  return false;
}
