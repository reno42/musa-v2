/**
 * Width tool — perfil de ancho variable sobre un trazo — REQ-045 (Fase 3).
 *
 * SVG no tiene trazos de ancho variable: la conversión honesta es EXPANDIR —
 * el trazo se reemplaza por una FORMA cerrada (outline) cuyo ancho sigue un
 * perfil piecewise-linear por fracción de arc-length. Con perfil uniforme el
 * resultado coincide con un outline de ancho constante.
 *
 * Sin DOM/Node: compatible Cloudflare/Workers (mismo motor en UI y MCP).
 */

import type { PathPoint } from "../pathData.ts";
import { cubicAt, refitPathPoints, type Pt } from "./distort.ts";
import type { FitOptions } from "../trace/fit.ts";

/** Un punto del perfil: t = fracción de arc-length (0..1), w = ancho total px. */
export interface WidthStop {
  t: number;
  w: number;
}

export type WidthCaps = "round" | "flat";

/** Ancho del perfil en t (piecewise-linear, sujeta en los extremos).
 * Perfil vacío → 0 (el caller debe pasar baseWidth aparte). */
export function widthAt(stops: WidthStop[], t: number): number {
  if (!stops.length) return 0;
  const sorted = [...stops].sort((a, b) => a.t - b.t);
  if (t <= sorted[0].t) return sorted[0].w;
  if (t >= sorted[sorted.length - 1].t) return sorted[sorted.length - 1].w;
  for (let i = 1; i < sorted.length; i++) {
    if (t <= sorted[i].t) {
      const a = sorted[i - 1];
      const b = sorted[i];
      const f = (t - a.t) / Math.max(b.t - a.t, 1e-9);
      return a.w + (b.w - a.w) * f;
    }
  }
  return sorted[sorted.length - 1].w;
}

/** Densifica TODOS los segmentos (rectas incluidas): el perfil por
 * arc-length y el hit del tool necesitan muestras intermedias aunque el
 * segmento no tenga manijas — samplePathPoints las rectas las salta. */
function densifyPathPoints(points: PathPoint[], closed: boolean, perSeg: number): Pt[] {
  if (points.length < 2) return points.map(p => [p.x, p.y] as Pt);
  const out: Pt[] = [];
  const segmentCount = closed ? points.length : points.length - 1;
  for (let i = 0; i < segmentCount; i++) {
    const p0 = points[i];
    const p3 = points[(i + 1) % points.length];
    const start: Pt = [p0.x, p0.y];
    const end: Pt = [p3.x, p3.y];
    if (!out.length) out.push(start);
    const c1: Pt = p0.cpOut ? [p0.cpOut.x, p0.cpOut.y] : start;
    const c2: Pt = p3.cpIn ? [p3.cpIn.x, p3.cpIn.y] : end;
    for (let k = 1; k <= perSeg; k++) out.push(cubicAt(start, c1, c2, end, k / perSeg));
  }
  return out;
}

export interface WidthPick {
  /** Fracción de arc-length del punto más cercano (0..1). */
  t: number;
  /** Distancia en px al trazo. */
  distance: number;
  /** El punto más cercano sobre el trazo. */
  point: Pt;
  /** Normal unitaria en ese punto (hacia la izquierda del avance). */
  normal: Pt;
}

/** Punto más cercano del trazo a `pt`, con su t por arc-length y la normal
 * local (el tool la usa para dirigir el drag del ancho). */
export function pickWidthT(
  points: PathPoint[],
  closed: boolean,
  pt: Pt,
  perSeg = 32,
): WidthPick | null {
  const poly = densifyPathPoints(points, closed, perSeg);
  if (poly.length < 2) return null;
  const cum = [0];
  for (let i = 1; i < poly.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]));
  }
  const total = cum[cum.length - 1];
  if (!(total > 0)) return null;

  let best = -1;
  let bestD2 = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const dx = poly[i][0] - pt[0];
    const dy = poly[i][1] - pt[1];
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  if (best < 0) return null;

  const prev = poly[Math.max(0, best - 1)];
  const next = poly[Math.min(poly.length - 1, best + 1)];
  let tx = next[0] - prev[0];
  let ty = next[1] - prev[1];
  const tLen = Math.hypot(tx, ty);
  let normal: Pt = [0, -1];
  if (tLen > 1e-9) {
    tx /= tLen;
    ty /= tLen;
    normal = [-ty, tx];
  }
  return { t: cum[best] / total, distance: Math.sqrt(bestD2), point: poly[best], normal };
}

/**
 * Expande el trazo a una forma cerrada cuyo ancho sigue `profile`
 * (piecewise-linear; sin perfil → baseWidth uniforme). Caps redondeados en
 * paths abiertos con caps="round". Devuelve anclas Bézier editables o null.
 */
export function widthProfileOutline(
  points: PathPoint[],
  closed: boolean,
  baseWidth: number,
  profile: WidthStop[],
  caps: WidthCaps = "round",
  opts: { perSeg?: number; fit?: Partial<FitOptions> } = {},
): PathPoint[] | null {
  if (points.length < 2) return null;
  if (!(baseWidth >= 0) || profile.some(s => !(s.w >= 0) || !(s.t >= 0 && s.t <= 1))) return null;

  const poly = densifyPathPoints(points, closed, opts.perSeg ?? 24);
  if (poly.length < 2) return null;
  const cum = [0];
  for (let i = 1; i < poly.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]));
  }
  const total = cum[cum.length - 1];
  if (!(total > 1e-9)) return null;
  const n = poly.length;

  const stops: WidthStop[] = profile.length ? profile : [{ t: 0, w: baseWidth }, { t: 1, w: baseWidth }];
  const halfAt = (i: number) => Math.max(widthAt(stops, cum[i] / total), 0) / 2;

  const left: Pt[] = [];
  const right: Pt[] = [];
  let prevNormal: Pt = [0, -1];
  for (let i = 0; i < n; i++) {
    const prev = poly[Math.max(0, i - 1)];
    const next = poly[Math.min(n - 1, i + 1)];
    let tx = next[0] - prev[0];
    let ty = next[1] - prev[1];
    const tLen = Math.hypot(tx, ty);
    let normal: Pt;
    if (tLen > 1e-9) {
      normal = [-ty / tLen, tx / tLen];
      prevNormal = normal;
    } else {
      normal = prevNormal; // pico degenerado: hereda la normal previa
    }
    const half = halfAt(i);
    left.push([poly[i][0] + normal[0] * half, poly[i][1] + normal[1] * half]);
    right.push([poly[i][0] - normal[0] * half, poly[i][1] - normal[1] * half]);
  }

  // Normal al inicio y al final (para los caps).
  const startNormal = normalAt(poly, 0, prevNormal);
  const endNormal = normalAt(poly, n - 1, prevNormal);
  const startTan: Pt = [startNormal[1], -startNormal[0]];
  const endTan: Pt = [endNormal[1], -endNormal[0]];

  let polygon: Pt[];
  if (closed) {
    polygon = [...left, ...right.slice().reverse()];
  } else if (caps === "round") {
    const CAP_STEPS = 10;
    const endCap: Pt[] = [];
    const halfEnd = halfAt(n - 1);
    // Del lado izquierdo al derecho pasando por el FRENTE (+tangente).
    for (let k = 1; k < CAP_STEPS; k++) {
      const phi = (Math.PI * k) / CAP_STEPS;
      endCap.push([
        poly[n - 1][0] + endNormal[0] * Math.cos(phi) * halfEnd + endTan[0] * Math.sin(phi) * halfEnd,
        poly[n - 1][1] + endNormal[1] * Math.cos(phi) * halfEnd + endTan[1] * Math.sin(phi) * halfEnd,
      ]);
    }
    const startCap: Pt[] = [];
    const halfStart = halfAt(0);
    // Del lado derecho al izquierdo pasando por el ATRÁS (-tangente).
    for (let k = 1; k < CAP_STEPS; k++) {
      const phi = (Math.PI * k) / CAP_STEPS;
      startCap.push([
        poly[0][0] - startNormal[0] * Math.cos(phi) * halfStart - startTan[0] * Math.sin(phi) * halfStart,
        poly[0][1] - startNormal[1] * Math.cos(phi) * halfStart - startTan[1] * Math.sin(phi) * halfStart,
      ]);
    }
    polygon = [...left, ...endCap, ...right.slice().reverse(), ...startCap];
  } else {
    polygon = [...left, ...right.slice().reverse()];
  }

  if (polygon.length < 3) return null;
  return refitPathPoints(polygon, true, opts.fit);
}

function normalAt(poly: Pt[], i: number, fallback: Pt): Pt {
  const prev = poly[Math.max(0, i - 1)];
  const next = poly[Math.min(poly.length - 1, i + 1)];
  let tx = next[0] - prev[0];
  let ty = next[1] - prev[1];
  const len = Math.hypot(tx, ty);
  if (len <= 1e-9) return fallback;
  return [-ty / len, tx / len];
}
