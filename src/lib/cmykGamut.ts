/**
 * cmykGamut — aproximación SIN ICC del gamut de imprenta offset coated
 * (estilo FOGRA39) para la UI de diseño: el checkbox "Solo CMYK" del picker
 * y el botón "Convertir a CMYK" del archivo. NO reemplaza al soft-proof del
 * export (ese usa los ICC reales vía Ghostscript en el worker).
 *
 * Modelo: en HSV la croma es C = S·V. Cada tinta coated tiene un tope de
 * croma por matiz (el verde puro #00ff00 o el azul #0000ff se salen por
 * mucho; el amarillo casi no). Interpolamos circularmente el tope entre 6
 * anclas de tintas y clampeamos bajando V: el matiz y la saturación se
 * conservan porque en imprenta los vivos "se apagan", no cambian de matiz.
 *
 * Los colores siguen siendo RGB hex — el diseño NUNCA almacena CMYK.
 * Named colors ("white") y funciones CSS exóticas pasan sin cambio.
 */

export interface Hsv { h: number; s: number; v: number; }
interface Rgb { r: number; g: number; b: number; }

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return "#" + [r, g, b].map(n => clamp255(n).toString(16).padStart(2, "0")).join("");
}

export function rgbToHsv(r: number, g: number, b: number): Hsv {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rr) h = 60 * (((gg - bb) / d) % 6);
    else if (max === gg) h = 60 * ((bb - rr) / d + 2);
    else h = 60 * ((rr - gg) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const c = v * s;
  const hp = ((((h % 360) + 360) % 360) / 60);
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = v - c;
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((((h % 360) + 360) % 360) / 60);
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = l - c / 2;
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

/** Tintas coated aproximadas en sRGB: CMY puros + R/G/B como overprints de
 *  2 tintas. Valores clásicos de referencia de imprenta offset estucada. */
const ANCHORS = [
  { hex: "#fff200" }, // amarillo (Y)
  { hex: "#00a651" }, // verde (C+Y)
  { hex: "#00aeef" }, // cian (C)
  { hex: "#2e3192" }, // azul (C+M)
  { hex: "#ec008c" }, // magenta (M)
  { hex: "#ed1c24" }, // rojo (M+Y)
];

/** Tope de croma (S·V) por matiz, precalculado de las anclas. */
const ANCHOR_LIMITS = ANCHORS
  .map(a => {
    const rgb = hexToRgb(a.hex)!;
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    return { h: hsv.h, c: hsv.s * hsv.v };
  })
  .sort((x, y) => x.h - y.h);

function maxChromaAtHue(h: number): number {
  const hue = ((h % 360) + 360) % 360;
  const n = ANCHOR_LIMITS.length;
  // Meseta de ±3° por ancla: un color sobre la tinta (amarillo puro a 60°
  // vs ancla a 56.9°) no se penaliza por interpolación con el vecino.
  const PLATEAU = 3;
  for (let i = 0; i < n; i++) {
    const a = ANCHOR_LIMITS[i];
    const b = ANCHOR_LIMITS[(i + 1) % n];
    const bh = i + 1 === n ? b.h + 360 : b.h;
    if (hue >= a.h && hue <= bh) {
      const lo = a.h + PLATEAU;
      const hi = bh - PLATEAU;
      if (hue <= lo || hi <= lo) return a.c;
      if (hue >= hi) return b.c;
      const t = (hue - lo) / (hi - lo);
      return a.c + (b.c - a.c) * t;
    }
  }
  return 1;
}

/** true si el color cabe (aprox) en el gamut coated. Los neutros (grises,
 *  blanco, negro) siempre: imprimen con K o papel. Entrada no-color → true. */
export function isCmykSafe(hex: string): boolean {
  const rgb = hexToRgb(hex);
  if (!rgb) return true;
  const { h, s, v } = rgbToHsv(rgb.r, rgb.g, rgb.b);
  if (s < 0.04) return true;
  return s * v <= maxChromaAtHue(h) * 1.02 + 1e-6;
}

/** Clampa al gamut conservando matiz y saturación (baja el valor V).
 *  Idempotente. Apunta al tope ESTRICTO (sin la tolerancia de isCmykSafe):
 *  el redondeo al subir de vuelta no puede volver a salir del gamut.
 *  Entrada no-color (transparent/var(...)/named) sin cambio. */
export function clampToCmykGamut(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  if (hsv.s < 0.04) return hex;
  const maxC = maxChromaAtHue(hsv.h);
  const c = hsv.s * hsv.v;
  if (c <= maxC + 1e-6) return hex;
  const v2 = Math.max(0, Math.min(1, (maxC * 0.999) / hsv.s));
  return rgbToHex(hsvToRgb({ h: hsv.h, s: hsv.s, v: v2 }));
}

const COLOR_TOKEN = /#(?:[0-9a-f]{3}|[0-9a-f]{6})\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi;
const NUM_TOKEN = /-?\d*\.?\d+/g;

function tokenToRgba(token: string): (Rgb & { a: number }) | null {
  const t = token.toLowerCase();
  if (t.startsWith("#")) {
    const rgb = hexToRgb(t);
    return rgb ? { ...rgb, a: 1 } : null;
  }
  if (t.startsWith("rgb") || t.startsWith("hsl")) {
    const nums = (t.match(NUM_TOKEN) || []).map(Number);
    const a = nums.length >= 4 ? clamp01(nums[3]) : 1;
    if (t.startsWith("rgb")) {
      if (nums.length < 3) return null;
      const pct = t.includes("%");
      const scale = pct ? 2.55 : (nums.slice(0, 3).every(n => n >= 0 && n <= 1) ? 255 : 1);
      return { r: clamp255(nums[0] * scale), g: clamp255(nums[1] * scale), b: clamp255(nums[2] * scale), a };
    }
    if (nums.length < 3) return null;
    const s = clamp01(nums[1] > 1 ? nums[1] / 100 : nums[1]);
    const l = clamp01(nums[2] > 1 ? nums[2] / 100 : nums[2]);
    return { ...hslToRgb(((nums[0] % 360) + 360) % 360, s, l), a };
  }
  return null;
}

/** Aplica fn a cada color de un texto CSS/HTML (hex 3/6, rgb/rgba, hsl/hsl a).
 *  rgba/hsla conservan su alpha (canales clampeados, salida rgba). Los tokens
 *  que no parsean como color quedan exactamente como estaban. */
export function mapCssColors(text: string, fn: (hex: string) => string): string {
  if (!text) return text;
  return text.replace(COLOR_TOKEN, token => {
    const parsed = tokenToRgba(token);
    if (!parsed) return token;
    const out = fn(rgbToHex(parsed));
    if (parsed.a < 1) {
      const o = hexToRgb(out) || parsed;
      const aStr = String(Number(parsed.a.toFixed(3)));
      return "rgba(" + o.r + ", " + o.g + ", " + o.b + ", " + aStr + ")";
    }
    return out;
  });
}
