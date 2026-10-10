/**
 * Blend (mezcla) entre dos trazados — REQ-045.
 *
 * Estrategia: remuestrear ambos paths a la MISMA cantidad de puntos por
 * arc-length, interpolar linealmente punto a punto en cada paso intermedio y
 * refitear cada polilínea con el motor de Bézier del trace (Schneider). El
 * resultado son anclas editables reales, no una imagen intermedia.
 *
 * Sin DOM/Node: compatible Cloudflare/Workers (mismo motor en UI y MCP).
 */

import { parsePathData, serializePathData, type PathPoint } from "../pathData.ts";
import { fitPolyline, type FitOptions } from "../trace/fit.ts";
import { refitPathPoints, samplePathPoints, type Pt } from "./distort.ts";

export interface BlendOptions {
  /** Recorre B al revés antes de mezclar (extremos B->A en vez de A->A). */
  flipB?: boolean;
  /** Ajuste fino del refit (hereda los defaults de distort). */
  fit?: Partial<FitOptions>;
  /** Puntos de muestreo compartidos (32-512; default según el tamaño). */
  samples?: number;
}

const BLEND_MIN_STEPS = 1;
const BLEND_MAX_STEPS = 50;
const BLEND_MAX_SAMPLES = 512;

/** Remuestrea un path a exactamente `n` puntos equiespaciados por arc-length. */
export function resamplePath(points: PathPoint[], closed: boolean, n: number): Pt[] {
  const dense = samplePathPoints(points, closed, 24);
  if (dense.length < 2 || n < 2) return dense;
  const cumulative: number[] = [0];
  for (let i = 1; i < dense.length; i++) {
    const dx = dense[i][0] - dense[i - 1][0];
    const dy = dense[i][1] - dense[i - 1][1];
    cumulative.push(cumulative[i - 1] + Math.hypot(dx, dy));
  }
  const total = cumulative[cumulative.length - 1];
  if (!(total > 0)) return dense;

  const out: Pt[] = [];
  let cursor = 1;
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    while (cursor < cumulative.length - 1 && cumulative[cursor] < target) cursor++;
    const s0 = cumulative[cursor - 1];
    const s1 = cumulative[cursor];
    const span = s1 - s0;
    const f = span > 0 ? (target - s0) / span : 0;
    const a = dense[cursor - 1];
    const b = dense[cursor];
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return out;
}

function lerpPolyline(a: Pt[], b: Pt[], t: number): Pt[] {
  const out: Pt[] = new Array(a.length);
  for (let i = 0; i < a.length; i++) {
    out[i] = [a[i][0] + (b[i][0] - a[i][0]) * t, a[i][1] + (b[i][1] - a[i][1]) * t];
  }
  return out;
}

/** Endpoint distance helper for auto-flip. */
function distance2(a: Pt, b: Pt): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

/**
 * Mezcla A→B en `steps` formas intermedias (sin incluir los extremos).
 * Devuelve null con steps fuera de rango o paths degenerados.
 */
export function blendPaths(
  a: PathPoint[],
  b: PathPoint[],
  closedA: boolean,
  closedB: boolean,
  steps: number,
  opts: BlendOptions = {},
): PathPoint[][] | null {
  if (!Number.isFinite(steps) || steps < BLEND_MIN_STEPS || steps > BLEND_MAX_STEPS) return null;
  if (a.length < 2 || b.length < 2) return null;

  const anchorBudget = Math.max(a.length, b.length) * 8;
  const n = Math.min(Math.max(opts.samples ?? Math.max(64, anchorBudget), 32), BLEND_MAX_SAMPLES);
  const sa = resamplePath(a, closedA, n);
  let sb = resamplePath(b, closedB, n);
  if (sa.length < 2 || sb.length < 2) return null;

  // Auto-flip: si el inicio de B quedó más lejos del inicio de A que su
  // final, recorrer B para que la mezcla no se crucice (efecto reloj de arena).
  const flip = opts.flipB ?? distance2(sa[0], sb[0]) > distance2(sa[0], sb[sb.length - 1]);
  if (flip) sb = sb.slice().reverse();

  // Cerrados ambos → los intermedios cierran; si difieren, abiertos (el
  // morph entre abierto y cerrado se lee mejor sin cierre implícito).
  const closedOut = closedA && closedB;

  const out: PathPoint[][] = [];
  for (let k = 1; k <= steps; k++) {
    const t = k / (steps + 1);
    const fitted = refitPathPoints(lerpPolyline(sa, sb, t), closedOut, opts.fit);
    if (!fitted) return null;
    out.push(fitted);
  }
  return out;
}

/** Serializa los pasos de un blend a strings `d` listos para capas SVG. */
export function blendStepsToD(steps: PathPoint[][], closed: boolean): string[] {
  return steps.map(points => serializePathData(points, closed));
}

/** Conveniencia: mezclar dos `d` ya parseados (MCP los recibe como strings). */
export function blendD(
  dA: string,
  dB: string,
  steps: number,
  opts: BlendOptions & { closedA?: boolean; closedB?: boolean } = {},
): string[] | null {
  const closedA = opts.closedA ?? /z\s*$/i.test(dA.trim());
  const closedB = opts.closedB ?? /z\s*$/i.test(dB.trim());
  const a = parsePathData(dA);
  const b = parsePathData(dB);
  const blended = blendPaths(a, b, closedA, closedB, steps, opts);
  if (!blended) return null;
  return blendStepsToD(blended, closedA && closedB);
}
