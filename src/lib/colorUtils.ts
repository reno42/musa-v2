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

// ── Color-space math for the fill picker (F2). Everything converts through
// rgb; the picker edits in whichever format the user selected and pipes the
// result back as hex + alpha. ──

export interface Rgb { r: number; g: number; b: number }
export interface Hsv { h: number; s: number; v: number }
export interface Hsl { h: number; s: number; l: number }
export interface Cmyk { c: number; m: number; y: number; k: number }

export function hexToRgb(hex?: string | null): Rgb | null {
  if (!hex) return null;
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i)
    || hex.trim().match(/^#?([0-9a-f]{3})$/i);
  if (!m) return null;
  const full = m[1].length === 3 ? m[1].split("").map(ch => ch + ch).join("") : m[1];
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === rr) h = 60 * (((gg - bb) / d) % 6);
    else if (max === gg) h = 60 * ((bb - rr) / d + 2);
    else h = 60 * ((rr - gg) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const c = v * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs(hp % 2 - 1));
  const [r1, g1, b1] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = v - c;
  return { r: Math.round((r1 + m) * 255), g: Math.round((g1 + m) * 255), b: Math.round((b1 + m) * 255) };
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rr) h = 60 * (((gg - bb) / d) % 6);
  else if (max === gg) h = 60 * ((bb - rr) / d + 2);
  else h = 60 * ((rr - gg) / d + 4);
  if (h < 0) h += 360;
  return { h, s, l };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs(hp % 2 - 1));
  const [r1, g1, b1] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return { r: Math.round((r1 + m) * 255), g: Math.round((g1 + m) * 255), b: Math.round((b1 + m) * 255) };
}

export function rgbToCmyk({ r, g, b }: Rgb): Cmyk {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const k = 1 - Math.max(rr, gg, bb);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 1 };
  return {
    c: (1 - rr - k) / (1 - k),
    m: (1 - gg - k) / (1 - k),
    y: (1 - bb - k) / (1 - k),
    k,
  };
}

export function cmykToRgb({ c, m, y, k }: Cmyk): Rgb {
  return {
    r: Math.round(255 * (1 - c) * (1 - k)),
    g: Math.round(255 * (1 - m) * (1 - k)),
    b: 255 * (1 - y) * (1 - k) | 0,
  };
}

/** Formats accepted by the fill picker's value field ("css" = free form). */
export type ColorFormat = "hex" | "rgb" | "hsl" | "hsb" | "cmyk" | "css";

const round2 = (n: number) => Math.round(n * 100) / 100;

export function formatColor(hex: string, fmt: ColorFormat, alpha = 1): string {
  const rgb = hexToRgb(hex) ?? { r: 0, g: 0, b: 0 };
  const a = round2(alpha);
  if (fmt === "hex") return alpha < 1 ? hex + Math.round(alpha * 255).toString(16).padStart(2, "0") : hex;
  if (fmt === "rgb") return alpha < 1 ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})` : `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  if (fmt === "hsl") {
    const { h, s, l } = rgbToHsl(rgb);
    return alpha < 1 ? `hsla(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%, ${a})`
      : `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
  }
  if (fmt === "hsb") {
    const { h, s, v } = rgbToHsv(rgb);
    return alpha < 1 ? `hsba(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(v * 100)}%, ${a})`
      : `hsb(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(v * 100)}%)`;
  }
  if (fmt === "cmyk") {
    const { c, m, y, k } = rgbToCmyk(rgb);
    return `cmyk(${Math.round(c * 100)}%, ${Math.round(m * 100)}%, ${Math.round(y * 100)}%, ${Math.round(k * 100)}%)`;
  }
  return hex;
}

/**
 * Parses what the picker's value field shows back into hex + alpha. Accepts
 * the selected format's own shape plus anything "css" allows — named colors,
 * short hex, rgb(), hsl() — so paste tolerance is high.
 */
export function parseColorText(text: string): { hex: string; alpha: number } | null {
  const value = text.trim();
  if (!value) return null;

  const hexMatch = value.match(/^#?([0-9a-f]{3,8})$/i);
  if (hexMatch) {
    const raw = hexMatch[1];
    let alpha = 1;
    let body = raw;
    if (raw.length === 8) { alpha = parseInt(raw.slice(6, 8), 16) / 255; body = raw.slice(0, 6); }
    else if (raw.length === 4) { alpha = parseInt(raw[3] + raw[3], 16) / 255; body = raw.slice(0, 3); }
    const rgb = hexToRgb("#" + body);
    return rgb ? { hex: rgbToHex(String(rgb.r), String(rgb.g), String(rgb.b)), alpha } : null;
  }

  const rgbMatch = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+%?))?\s*\)$/i);
  if (rgbMatch) {
    const alpha = parseAlphaToken(rgbMatch[4]);
    const rgb = hexToRgb("#" + [rgbMatch[1], rgbMatch[2], rgbMatch[3]]
      .map(n => Math.max(0, Math.min(255, Math.round(parseFloat(n)))).toString(16).padStart(2, "0"))
      .join(""));
    return rgb ? { hex: rgbToHex(String(rgb.r), String(rgb.g), String(rgb.b)), alpha } : null;
  }

  const hslMatch = value.match(/^hsla?\(\s*([\d.]+)(?:deg)?[,\s]+([\d.]+)%[,\s]+([\d.]+)%(?:[,/\s]+([\d.]+%?))?\s*\)$/i);
  if (hslMatch) {
    const rgb = hslToRgb({ h: parseFloat(hslMatch[1]), s: parseFloat(hslMatch[2]) / 100, l: parseFloat(hslMatch[3]) / 100 });
    return { hex: rgbToHex(String(rgb.r), String(rgb.g), String(rgb.b)), alpha: parseAlphaToken(hslMatch[4]) };
  }

  const hsbMatch = value.match(/^hsba?\(\s*([\d.]+)(?:deg)?[,\s]+([\d.]+)%[,\s]+([\d.]+)%(?:[,/\s]+([\d.]+%?))?\s*\)$/i);
  if (hsbMatch) {
    const rgb = hsvToRgb({ h: parseFloat(hsbMatch[1]), s: parseFloat(hsbMatch[2]) / 100, v: parseFloat(hsbMatch[3]) / 100 });
    return { hex: rgbToHex(String(rgb.r), String(rgb.g), String(rgb.b)), alpha: parseAlphaToken(hsbMatch[4]) };
  }

  const cmykMatch = value.match(/^cmyk\(\s*([\d.]+)%,\s*([\d.]+)%,\s*([\d.]+)%,\s*([\d.]+)%\)$/i);
  if (cmykMatch) {
    const rgb = cmykToRgb({
      c: parseFloat(cmykMatch[1]) / 100, m: parseFloat(cmykMatch[2]) / 100,
      y: parseFloat(cmykMatch[3]) / 100, k: parseFloat(cmykMatch[4]) / 100,
    });
    return { hex: rgbToHex(String(rgb.r), String(rgb.g), String(rgb.b)), alpha: 1 };
  }

  // "css": anything the canvas can resolve — named colors included.
  const hex = toHexColor(value, "");
  return hex ? { hex, alpha: alphaOfRgba(value) } : null;
}

function alphaOfRgba(text: string): number {
  const m = text.match(/rgba?\([^)]*[,\s]([\d.]+)\s*\)$/i);
  return m ? parseAlphaToken(m[1]) : 1;
}

function parseAlphaToken(token?: string): number {
  if (!token) return 1;
  const n = token.endsWith("%") ? parseFloat(token) / 100 : parseFloat(token);
  return isNaN(n) ? 1 : Math.max(0, Math.min(1, n));
}
