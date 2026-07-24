/**
 * Color normalization shared by every `<input type="color">` in the editor.
 *
 * That input only accepts exactly "#rrggbb". Anything else (a 3-digit "#000",
 * "rgb(…)", "transparent", a named color) makes the browser reject the value
 * and log: 'The specified value "#000" does not conform to the required
 * format'. Design CSS is full of short hex and rgb(), so every value must be
 * normalized before it reaches the swatch.
 */

/** Convert any CSS color to the "#rrggbb" form `<input type="color">` requires. */
export function toHexColor(color?: string | null, fallback = "#000000"): string {
  if (!color) return fallback;
  const value = color.trim();

  // #rgb / #rgba → expand each nibble. Lowercase throughout: the input
  // normalizes to lowercase anyway, and matching it avoids React value churn.
  if (/^#[0-9a-f]{3,4}$/i.test(value)) {
    return ("#" + value.slice(1, 4).split("").map(char => char + char).join("")).toLowerCase();
  }
  // #rrggbb / #rrggbbaa → drop any alpha pair
  if (/^#[0-9a-f]{6,8}$/i.test(value)) return value.slice(0, 7).toLowerCase();

  // Let the canvas resolve named colors, rgb(), hsl(), etc. (browser only —
  // the rgb() regex below covers the common cases everywhere else).
  const context = typeof document === "undefined"
    ? null
    : document.createElement("canvas").getContext("2d");
  if (context) {
    context.fillStyle = "#000000";
    context.fillStyle = value;
    const resolved = context.fillStyle;
    if (typeof resolved === "string" && resolved.startsWith("#")) return resolved.slice(0, 7);
    const parsed = resolved.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (parsed) return rgbToHex(parsed[1], parsed[2], parsed[3]);
  }

  const m = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? rgbToHex(m[1], m[2], m[3]) : fallback;
}

function rgbToHex(r: string, g: string, b: string): string {
  return "#" + [r, g, b]
    .map(channel => Math.max(0, Math.min(255, parseInt(channel, 10) || 0)).toString(16).padStart(2, "0"))
    .join("");
}
