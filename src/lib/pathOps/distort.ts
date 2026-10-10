/**
 * Distorsiones líquidas y Warp — REQ-045 (paridad Illustrator, Fase 3).
 *
 * Pipeline de cada efecto: aplanar el modelo de anclas a polilínea densa →
 * aplicar el kernel (puro, determinista) → refitear con el motor de Bézier
 * del trace (Schneider, ya existente) para devolver anclas editables reales.
 *
 * `amount` está SIEMPRE en px (twirl lo convierte a ángulo vía radius) y los
 * kernels aleatorios usan mulberry32 con seed: mismas entradas, mismas
 * salidas — QA y MCP reproducibles.
 *
 * Sin DOM/Node: compatible Cloudflare/Workers (mismo motor en UI y MCP).
 */

import type { PathPoint } from "../pathData.ts";
import { fitPolyline, type FitOptions, type FitSubPath } from "../trace/fit.ts";

export type Pt = [number, number];

/** Defaults del refit: conservador — nunca inventa curvas donde había rectas
 * (snapLines off) y ajustado como el FIT de offset.ts (fitTol 1.2 colapsa
 * formas cerradas suaves en 2 anclas con manijas absurdas). */
export const DISTORT_FIT_DEFAULTS: FitOptions = {
  polygonTol: 0.5,
  fitTol: 0.4,
  cornerAngle: 60,
  snapLines: false,
};

/** RNG determinista (mulberry32) — nada de Math.random. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Punto de una cúbica en t (con puntos de control degenerados = anclas). */
export function cubicAt(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ];
}

/** Aplana el modelo de anclas a polilínea: rectas aportan extremos, curvas
 * `perSeg` muestras. El segmento de cierre (cerrados) se incluye. */
export function samplePathPoints(points: PathPoint[], closed: boolean, perSeg = 16): Pt[] {
  if (points.length < 2) return points.map(p => [p.x, p.y] as Pt);
  const out: Pt[] = [];
  const segmentCount = closed ? points.length : points.length - 1;
  for (let i = 0; i < segmentCount; i++) {
    const p0 = points[i];
    const p3 = points[(i + 1) % points.length];
    const start: Pt = [p0.x, p0.y];
    const end: Pt = [p3.x, p3.y];
    if (!out.length) out.push(start);
    if (!p0.cpOut && !p3.cpIn) {
      out.push(end);
      continue;
    }
    const c1: Pt = p0.cpOut ? [p0.cpOut.x, p0.cpOut.y] : start;
    const c2: Pt = p3.cpIn ? [p3.cpIn.x, p3.cpIn.y] : end;
    for (let k = 1; k <= perSeg; k++) out.push(cubicAt(start, c1, c2, end, k / perSeg));
  }
  return out;
}

/** Conversor FitSubPath (trace) → modelo de anclas del editor. */
export function fitSubPathToPathPoints(sp: FitSubPath): PathPoint[] {
  return sp.anchors.map(a => ({
    type: a.hIn || a.hOut ? "smooth" : "anchor",
    x: a.x,
    y: a.y,
    ...(a.hIn ? { cpIn: { x: a.hIn[0], y: a.hIn[1] } } : {}),
    ...(a.hOut ? { cpOut: { x: a.hOut[0], y: a.hOut[1] } } : {}),
  }));
}

/** Refit de una polilínea a anclas Bézier editables. Null si degenera. */
export function refitPathPoints(
  poly: Pt[],
  closed: boolean,
  o: Partial<FitOptions> = {},
): PathPoint[] | null {
  if (poly.length < 2) return null;
  if (!poly.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1]))) return null;
  const sp = fitPolyline(poly, closed, { ...DISTORT_FIT_DEFAULTS, ...o });
  if (!sp || sp.anchors.length < 2) return null;
  const points = fitSubPathToPathPoints(sp);
  return points.length >= 2 ? points : null;
}

/** Longitud de arco acumulada de una polilínea. */
export function cumulativeLength(poly: Pt[]): number[] {
  const cum: number[] = [0];
  for (let i = 1; i < poly.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]));
  }
  return cum;
}

export interface DistortParams {
  /** Centro del efecto (coordenadas del frame). */
  cx: number;
  cy: number;
  /** Radio de alcance en px (fuera del radio no hay distorsión). */
  radius: number;
  /** Intensidad en px (twirl la convierte a ángulo vía radius). */
  amount: number;
  /** Semilla de los kernels aleatorios (crystallize/wrinkle). Default 1. */
  seed?: number;
}

/** Parámetros con centro/radio por omisión: el centroide de la polilínea y
 * la mitad de su extensión máxima. Los callers (UI/MCP) pueden pasarlos ya. */
export function defaultDistortParams(poly: Pt[], overrides: Partial<DistortParams> = {}): DistortParams {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return {
    cx: overrides.cx ?? (minX + maxX) / 2,
    cy: overrides.cy ?? (minY + maxY) / 2,
    radius: overrides.radius && overrides.radius > 0
      ? overrides.radius
      : Math.max(maxX - minX, maxY - minY) * 0.75,
    amount: overrides.amount ?? 30,
    seed: overrides.seed ?? 1,
  };
}

/** Twirl: rota cada punto alrededor del centro; el ángulo decae con el
 * cuadrado de la distancia (remolino). Conserva el módulo radial. */
export function twirl(poly: Pt[], p: DistortParams): Pt[] {
  return poly.map(([x, y]) => {
    const dx = x - p.cx;
    const dy = y - p.cy;
    const r = Math.hypot(dx, dy);
    if (r < 1e-9 || r >= p.radius) return [x, y] as Pt;
    const falloff = 1 - r / p.radius;
    const angle = (p.amount / p.radius) * falloff * falloff;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return [p.cx + dx * cos - dy * sin, p.cy + dx * sin + dy * cos] as Pt;
  });
}

/** Pucker: acerca los puntos al centro (amount px en el centro, decae). */
export function pucker(poly: Pt[], p: DistortParams): Pt[] {
  return poly.map(([x, y]) => {
    const dx = x - p.cx;
    const dy = y - p.cy;
    const r = Math.hypot(dx, dy);
    if (r < 1e-9 || r >= p.radius) return [x, y] as Pt;
    const falloff = 1 - r / p.radius;
    const newR = Math.max(0, r - p.amount * falloff);
    const k = newR / r;
    return [p.cx + dx * k, p.cy + dy * k] as Pt;
  });
}

/** Bloat: aleja los puntos del centro (inverso de pucker). */
export function bloat(poly: Pt[], p: DistortParams): Pt[] {
  return poly.map(([x, y]) => {
    const dx = x - p.cx;
    const dy = y - p.cy;
    const r = Math.hypot(dx, dy);
    if (r < 1e-9 || r >= p.radius) return [x, y] as Pt;
    const falloff = 1 - r / p.radius;
    const newR = r + p.amount * falloff;
    const k = newR / r;
    return [p.cx + dx * k, p.cy + dy * k] as Pt;
  });
}

/** Crystallize: picos aleatorios hacia el centro (jagged, determinista). */
export function crystallize(poly: Pt[], p: DistortParams): Pt[] {
  const rand = mulberry32(p.seed ?? 1);
  return poly.map(([x, y]) => {
    const dx = x - p.cx;
    const dy = y - p.cy;
    const r = Math.hypot(dx, dy);
    if (r < 1e-9 || r >= p.radius) return [x, y] as Pt;
    const falloff = 1 - r / p.radius;
    const newR = Math.max(0, r - rand() * p.amount * falloff);
    const k = newR / r;
    return [p.cx + dx * k, p.cy + dy * k] as Pt;
  });
}

/** Scallop: festones suaves — desplazamiento radial sinusoidal a lo largo
 * del path (longitud de onda = radius/2) con decaimiento radial. */
export function scallop(poly: Pt[], p: DistortParams): Pt[] {
  const cum = cumulativeLength(poly);
  const wavelength = Math.max(p.radius / 2, 1);
  return poly.map(([x, y], i) => {
    const dx = x - p.cx;
    const dy = y - p.cy;
    const r = Math.hypot(dx, dy);
    if (r < 1e-9 || r >= p.radius) return [x, y] as Pt;
    const falloff = 1 - r / p.radius;
    const bump = Math.sin((cum[i] / wavelength) * Math.PI * 2) * p.amount * falloff;
    const newR = r + bump;
    const k = newR / r;
    return [p.cx + dx * k, p.cy + dy * k] as Pt;
  });
}

/** Wrinkle: arrugas — jitter aleatorio en dirección libre, decae con el radio. */
export function wrinkle(poly: Pt[], p: DistortParams): Pt[] {
  const rand = mulberry32((p.seed ?? 1) + 1);
  return poly.map(([x, y]) => {
    const dx = x - p.cx;
    const dy = y - p.cy;
    const r = Math.hypot(dx, dy);
    if (r >= p.radius) return [x, y] as Pt;
    const falloff = r < 1e-9 ? 1 : 1 - r / p.radius;
    const mag = rand() * p.amount * falloff;
    const ang = rand() * Math.PI * 2;
    return [x + Math.cos(ang) * mag, y + Math.sin(ang) * mag] as Pt;
  });
}

export type WarpPreset =
  | "arc" | "bulge" | "flag" | "wave" | "fish" | "fisheye" | "rise" | "twist";

/** Los 8 presets Warp (v1): fórmulas sobre coords normalizadas del bbox.
 * `amount` es el desplazamiento máximo en px. */
export function warpPath(poly: Pt[], preset: WarpPreset, amount: number): Pt[] {
  if (!poly.length) return poly;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const w = Math.max(maxX - minX, 1e-9);
  const h = Math.max(maxY - minY, 1e-9);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  return poly.map(([x, y]) => {
    const u = (x - minX) / w;
    const v = (y - minY) / h;
    // Distancia normalizada al centro: 0 en el centro, 1 en el borde.
    const dHat = Math.min(1, Math.hypot((u - 0.5) * 2, (v - 0.5) * 2));
    const rx = x - cx;
    const ry = y - cy;
    const r = Math.hypot(rx, ry);
    switch (preset) {
      case "arc":
        return [x, y - amount * Math.sin(Math.PI * u)] as Pt;
      case "bulge": {
        if (r < 1e-9) return [x, y] as Pt;
        const disp = amount * (1 - dHat);
        return [x + (rx / r) * disp, y + (ry / r) * disp] as Pt;
      }
      case "flag":
        return [x, y + amount * u * Math.sin(Math.PI * 2 * u)] as Pt;
      case "wave":
        return [x, y + amount * Math.sin(Math.PI * 2 * u * 1.5)] as Pt;
      case "fish": {
        if (r < 1e-9) return [x, y] as Pt;
        const disp = amount * (1 - dHat) * 0.6;
        return [x - (rx / r) * disp, y - (ry / r) * disp] as Pt;
      }
      case "fisheye": {
        if (r < 1e-9) return [x, y] as Pt;
        const disp = amount * (1 - dHat) * (1 - dHat);
        return [x + (rx / r) * disp, y + (ry / r) * disp] as Pt;
      }
      case "rise":
        return [x + amount * Math.sin(Math.PI * v), y] as Pt;
      case "twist": {
        const angle = (amount / Math.max(w, h)) * (0.5 - v);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        return [cx + rx * cos - ry * sin, cy + rx * sin + ry * cos] as Pt;
      }
    }
  });
}

export type DistortEffect =
  | "twirl" | "pucker" | "bloat" | "crystallize" | "scallop" | "wrinkle" | "warp";

export interface ApplyDistortOptions {
  params?: Partial<DistortParams>;
  /** Solo warp. */
  preset?: WarpPreset;
  perSeg?: number;
  fit?: Partial<FitOptions>;
}

/**
 * Aplica un efecto al modelo de anclas: sample → kernel → refit.
 * Devuelve null con entradas degeneradas o si el refit no produce anclas.
 */
export function applyDistortion(
  points: PathPoint[],
  closed: boolean,
  effect: DistortEffect,
  opts: ApplyDistortOptions = {},
): PathPoint[] | null {
  if (points.length < 2) return null;
  const poly = samplePathPoints(points, closed, opts.perSeg ?? 16);
  if (poly.length < 3) return null;
  const params = defaultDistortParams(poly, opts.params);
  if (!(params.radius > 0) || !Number.isFinite(params.amount)) return null;

  let distorted: Pt[];
  switch (effect) {
    case "twirl": distorted = twirl(poly, params); break;
    case "pucker": distorted = pucker(poly, params); break;
    case "bloat": distorted = bloat(poly, params); break;
    case "crystallize": distorted = crystallize(poly, params); break;
    case "scallop": distorted = scallop(poly, params); break;
    case "wrinkle": distorted = wrinkle(poly, params); break;
    case "warp":
      if (!opts.preset) return null;
      distorted = warpPath(poly, opts.preset, params.amount);
      break;
    default:
      return null;
  }

  return refitPathPoints(distorted, closed, opts.fit);
}
