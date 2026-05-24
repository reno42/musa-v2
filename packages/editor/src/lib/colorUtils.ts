// colorUtils.ts — Shared color conversion utilities
// Ported from Figma plugins (HTML Mirror v2.4 + Brand Manual Generator)

/** Convert 0-1 RGB values to HEX string (#RRGGBB) */
export function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return "#" + h(r) + h(g) + h(b);
}

/** Parse a CSS hex/rgb/rgba string into { r, g, b } 0-255 */
export function parseColor(c: string): { r: number; g: number; b: number } | null {
  if (!c) return null;
  // hex
  if (c.startsWith("#")) {
    const raw = c.slice(1);
    if (raw.length === 3) {
      return {
        r: parseInt(raw[0] + raw[0], 16),
        g: parseInt(raw[1] + raw[1], 16),
        b: parseInt(raw[2] + raw[2], 16),
      };
    }
    if (raw.length >= 6) {
      return {
        r: parseInt(raw.slice(0, 2), 16),
        g: parseInt(raw.slice(2, 4), 16),
        b: parseInt(raw.slice(4, 6), 16),
      };
    }
  }
  // rgb(r, g, b) or rgba(r, g, b, a)
  const m = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) {
    return { r: +m[1], g: +m[2], b: +m[3] };
  }
  return null;
}

/** Convert 0-1 RGB to CMYK (each 0-100) */
export function rgbToCmyk(r: number, g: number, b: number): {
  c: number;
  m: number;
  y: number;
  k: number;
} {
  const k = 1 - Math.max(r, g, b);
  if (k >= 0.99) return { c: 0, m: 0, y: 0, k: 100 };
  return {
    c: Math.round(((1 - r - k) / (1 - k)) * 100),
    m: Math.round(((1 - g - k) / (1 - k)) * 100),
    y: Math.round(((1 - b - k) / (1 - k)) * 100),
    k: Math.round(k * 100),
  };
}

/** Format CMYK object as string */
export function formatCmyk(cmyk: {
  c: number;
  m: number;
  y: number;
  k: number;
}): string {
  return `C:${cmyk.c} M:${cmyk.m} Y:${cmyk.y} K:${cmyk.k}`;
}

/** Map Figma/Fabric blend mode to CSS mix-blend-mode */
export function blendToCSS(blend: string): string {
  const map: Record<string, string> = {
    MULTIPLY: "multiply",
    SCREEN: "screen",
    OVERLAY: "overlay",
    DARKEN: "darken",
    LIGHTEN: "lighten",
    COLOR_DODGE: "color-dodge",
    COLOR_BURN: "color-burn",
    HARD_LIGHT: "hard-light",
    SOFT_LIGHT: "soft-light",
    DIFFERENCE: "difference",
    EXCLUSION: "exclusion",
    HUE: "hue",
    SATURATION: "saturation",
    COLOR: "color",
    LUMINOSITY: "luminosity",
  };
  return map[blend?.toUpperCase()] || "normal";
}

/** Extract CSS font-weight from style name */
export function fontWeightFromStyle(style: string): number {
  const s = (style || "").toLowerCase();
  if (/thin|hairline/.test(s)) return 100;
  if (/extralight|ultralight/.test(s)) return 200;
  if (/light/.test(s)) return 300;
  if (/medium/.test(s)) return 500;
  if (/semibold|demibold/.test(s)) return 600;
  if (/extrabold|ultrabold/.test(s)) return 800;
  if (/black|heavy/.test(s)) return 900;
  if (/bold/.test(s)) return 700;
  return 400;
}

/** Sanitize a name for CSS class usage */
export function sanitizeCSS(name: string): string {
  return (
    (name || "element")
      .toLowerCase()
      .replace(/[^a-z0-9\s_-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/^(-?\d)/, "el-$1")
      .replace(/-+/g, "-")
      .substring(0, 40)
  ) || "element";
}
