/**
 * Gradient model shared by the contextual panel's fill picker (F2) and the
 * SVG defs writer that paints gradients onto svg shapes (htmlMutations).
 *
 * Serialization targets CSS `*-gradient()` for div/text layers and SVG
 * `<linearGradient>/<radialGradient>` defs for shapes. "diamond" has no CSS
 * primitive — it serializes as a conic gradient whose stop list repeats four
 * times, which reads as a four-point diamond blend.
 */

/** Split on top-level commas only (a paren-depth counter, not a naive regex
 * split) — a color-stop list like "rgb(1,2,3) 0%, rgb(4,5,6) 100%" has
 * commas INSIDE the rgb() calls that must not become stop boundaries. */
export function splitTopLevelCommas(str: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of str) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else { cur += ch; }
  }
  if (cur) out.push(cur);
  return out;
}

const GRADIENT_DIRECTION_ANGLES: Record<string, number> = {
  top: 0, bottom: 180, left: 270, right: 90,
  "top right": 45, "right top": 45, "bottom right": 135, "right bottom": 135,
  "bottom left": 225, "left bottom": 225, "top left": 315, "left top": 315,
};

export interface GradientStop { color: string; alpha: number; pos: number }
export type GradientType = "linear" | "radial" | "conic" | "diamond";
export interface ParsedGradient { type: GradientType; angle: number; stops: GradientStop[] }

export const DEFAULT_NEW_GRADIENT: ParsedGradient = {
  type: "linear", angle: 90,
  stops: [{ color: "#667eea", alpha: 1, pos: 0 }, { color: "#764ba2", alpha: 1, pos: 100 }],
};

/**
 * Parse ANY CSS gradient — critically, one whose colors come back from
 * getComputedStyle() as rgb()/rgba(), which is what the browser always
 * reports regardless of how the source CSS was authored.
 */
export function parseGradientValue(value: string): ParsedGradient | null {
  if (!value || value === "none") return null;
  const typeMatch = value.match(/(linear|radial|conic)-gradient\(/);
  if (!typeMatch) return null;
  const type = typeMatch[1] as "linear" | "radial" | "conic";
  const openIdx = value.indexOf(typeMatch[0]) + typeMatch[0].length - 1;
  let depth = 0, end = -1;
  for (let i = openIdx; i < value.length; i++) {
    if (value[i] === "(") depth++;
    else if (value[i] === ")") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return null;
  const parts = splitTopLevelCommas(value.slice(openIdx + 1, end)).map(p => p.trim());
  if (!parts.length) return null;

  let angle = 90;
  let stopParts = parts;
  const first = parts[0] || "";
  if (type === "linear") {
    const angleMatch = first.match(/^(-?[\d.]+)deg$/);
    if (angleMatch) { angle = parseFloat(angleMatch[1]); stopParts = parts.slice(1); }
    else if (/^to\s+/i.test(first)) {
      angle = GRADIENT_DIRECTION_ANGLES[first.replace(/^to\s+/i, "").trim().toLowerCase()] ?? 90;
      stopParts = parts.slice(1);
    }
  } else {
    // radial()/conic()'s leading shape/position descriptor ("circle at
    // center", "from 45deg") has no color. A real stop is just a color
    // token optionally followed by one "N%" and nothing else — anything
    // that doesn't fit that shape is the descriptor, not the first stop.
    const angleMatch = first.match(/from\s+(-?[\d.]+)deg/);
    if (angleMatch) angle = parseFloat(angleMatch[1]);
    const isJustAStop = /^(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}|[a-zA-Z]+)\s*(-?[\d.]+%)?\s*$/.test(first);
    if (!isJustAStop && parts.length > 1) stopParts = parts.slice(1);
  }

  const stops: GradientStop[] = [];
  stopParts.forEach((p, i) => {
    const colorMatch = p.match(/^(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}|[a-zA-Z]+)/);
    if (!colorMatch) return;
    const colorToken = colorMatch[0];
    const rest = p.slice(colorToken.length).trim();
    const pctMatch = rest.match(/(-?[\d.]+)%/);
    stops.push({
      color: toHexColorToken(colorToken),
      alpha: parseStopAlpha(colorToken),
      pos: pctMatch ? parseFloat(pctMatch[1]) : Math.round((i / Math.max(1, stopParts.length - 1)) * 100),
    });
  });
  return stops.length >= 2 ? { type, angle, stops } : null;
}

export function buildGradientCss(g: ParsedGradient): string {
  const stop = (s: GradientStop) => `${s.alpha < 1 ? rgbaStop(s) : s.color} ${s.pos}%`;
  if (g.type === "linear") return `linear-gradient(${g.angle}deg, ${g.stops.map(stop).join(", ")})`;
  if (g.type === "radial") return `radial-gradient(circle, ${g.stops.map(stop).join(", ")})`;
  if (g.type === "diamond") {
    // No CSS diamond primitive: repeat the stop list 4× around a conic —
    // four symmetric sweeps meeting at the edges read as a diamond blend.
    const sweep = g.stops.map(s => ({ ...s, pos: s.pos / 4 }));
    const repeats: GradientStop[] = [];
    for (let i = 0; i < 4; i++) {
      for (const s of sweep) repeats.push({ ...s, pos: s.pos + i * 25 });
    }
    if (repeats.length) repeats.push({ ...repeats[0], pos: 100 });
    return `conic-gradient(from ${g.angle}deg at 50% 50%, ${repeats.map(stop).join(", ")})`;
  }
  return `conic-gradient(from ${g.angle}deg, ${g.stops.map(stop).join(", ")})`;
}

function rgbaStop(s: GradientStop): string {
  const m = s.color.match(/^#([0-9a-f]{6})$/i);
  if (!m) return s.color;
  const r = parseInt(m[1].slice(0, 2), 16), g = parseInt(m[1].slice(2, 4), 16), b = parseInt(m[1].slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${s.alpha})`;
}

/** Color of the gradient at `pos` (0-100) — used when a new node is added so
 * it starts with the value the bar already shows there. */
export function gradientColorAt(stops: GradientStop[], pos: number): { color: string; alpha: number } {
  const sorted = [...stops].sort((a, b) => a.pos - b.pos);
  if (!sorted.length) return { color: "#000000", alpha: 1 };
  if (pos <= sorted[0].pos) return { color: sorted[0].color, alpha: sorted[0].alpha };
  const last = sorted[sorted.length - 1];
  if (pos >= last.pos) return { color: last.color, alpha: last.alpha };
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (pos >= a.pos && pos <= b.pos) {
      const t = (pos - a.pos) / Math.max(1, b.pos - a.pos);
      return {
        color: mixHex(a.color, b.color, t),
        alpha: a.alpha + (b.alpha - a.alpha) * t,
      };
    }
  }
  return { color: last.color, alpha: last.alpha };
}

function mixHex(a: string, b: string, t: number): string {
  const pa = parseHex6(a), pb = parseHex6(b);
  if (!pa || !pb) return t < 0.5 ? a : b;
  const mix = (x: number, y: number) => Math.round(x + (y - x) * t);
  return "#" + [mix(pa[0], pb[0]), mix(pa[1], pb[1]), mix(pa[2], pb[2])]
    .map(n => n.toString(16).padStart(2, "0")).join("");
}

function parseHex6(hex: string): [number, number, number] | null {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  return m ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)] : null;
}

// Local fallbacks (kept dependency-free; the panel's richer color math lives
// in colorUtils, but this lib must also work where only hex stops exist).
function toHexColorToken(color: string): string {
  const hex = color.match(/^#[0-9a-fA-F]{3,8}$/);
  if (hex) {
    let body = color.slice(1);
    if (body.length === 3 || body.length === 4) body = body.slice(0, 3).split("").map(c => c + c).join("");
    return "#" + body.slice(0, 6).toLowerCase();
  }
  const rgb = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgb) {
    return "#" + [rgb[1], rgb[2], rgb[3]]
      .map(n => Math.max(0, Math.min(255, parseInt(n, 10) || 0)).toString(16).padStart(2, "0"))
      .join("");
  }
  return "#000000";
}

function parseStopAlpha(color: string): number {
  const m = color.match(/rgba?\([^)]*[,:\s]([\d.]+)\s*\)$/i);
  return m ? Math.max(0, Math.min(1, parseFloat(m[1]))) : 1;
}
