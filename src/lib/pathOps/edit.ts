/**
 * Object → Path commands: Simplify, Smooth, Add Anchor Points, Remove
 * Redundant Points and Join — editor parity for the classic vector-editor
 * commands, working directly on the PathPoint anchor model (cpIn/cpOut).
 *
 * Algorithms (public descriptions, reimplemented from scratch):
 * - Simplify: dense resampling + least-squares cubic refit (Philip Schneider,
 *   "Graphics Gems") between corner anchors; Douglas–Peucker for the
 *   straight-line variant. Simplify never adds anchors.
 * - Smooth: handles pulled toward Catmull-Rom tangents; anchor positions and
 *   the endpoints of open paths never move.
 * - Remove redundant: collinear line merges plus single-cubic refits across
 *   (near-)smooth joints.
 */

import {
  clonePathPoints,
  splitPathSegment,
  type PathPoint,
  type Point,
} from "../pathData.ts";
import { fitCubics, fitSingle, rdp, type Pt } from "../trace/fit.ts";

/** One Bézier segment extracted from the anchor model. */
interface CubicSeg {
  p0: Pt;
  c1: Pt;
  c2: Pt;
  p3: Pt;
  line: boolean;
}

const P = (p: Point): Pt => [p.x, p.y];
const asPoint = (p: Pt): Point => ({ x: p[0], y: p[1] });
const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

function unit(v: Pt): Pt | null {
  const len = Math.hypot(v[0], v[1]);
  return len < 1e-12 ? null : [v[0] / len, v[1] / len];
}

function cubicAt(c: CubicSeg, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
  return [
    a * c.p0[0] + b * c.c1[0] + d * c.c2[0] + e * c.p3[0],
    a * c.p0[1] + b * c.c1[1] + d * c.c2[1] + e * c.p3[1],
  ];
}

/** Chord-length approximation of a segment's arc length. */
function cubicLen(c: CubicSeg): number {
  let len = 0;
  let prev = c.p0;
  for (let k = 1; k <= 8; k++) {
    const p = cubicAt(c, k / 8);
    len += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
  }
  return len;
}

function segOf(a: PathPoint, b: PathPoint): CubicSeg {
  return {
    p0: [a.x, a.y],
    c1: a.cpOut ? [a.cpOut.x, a.cpOut.y] : [a.x, a.y],
    c2: b.cpIn ? [b.cpIn.x, b.cpIn.y] : [b.x, b.y],
    p3: [b.x, b.y],
    line: !a.cpOut && !b.cpIn,
  };
}

/** Every segment of the subpath, closure included when closed. */
function allSegs(points: PathPoint[], closed: boolean): CubicSeg[] {
  const segs: CubicSeg[] = [];
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    segs.push(segOf(points[i], points[(i + 1) % points.length]));
  }
  return segs;
}

/** Rebuild anchors from a segment chain (handles come from the cubics). */
function segsToPoints(segs: CubicSeg[], closed: boolean): PathPoint[] {
  if (segs.length === 0) return [];
  const result: PathPoint[] = [];
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const prev = segs[(i + segs.length - 1) % segs.length];
    result.push({
      type: "anchor",
      x: seg.p0[0],
      y: seg.p0[1],
      cpIn: (closed || i > 0) && !prev.line ? asPoint(prev.c2) : undefined,
      cpOut: seg.line ? undefined : asPoint(seg.c1),
    });
  }
  const last = segs[segs.length - 1];
  if (closed) {
    result[0].cpIn = last.line ? undefined : asPoint(last.c2);
  } else {
    result.push({
      type: "anchor",
      x: last.p3[0],
      y: last.p3[1],
      cpIn: last.line ? undefined : asPoint(last.c2),
    });
  }
  return result;
}

// ── Simplify ──

export interface SimplifyOptions {
  /** Maximum distance (document units) between the original and the result. */
  tolerance?: number;
  /** Anchors where the path turns by more degrees stay corners. */
  cornerAngleDeg?: number;
  /** Produce only straight segments. */
  straightLines?: boolean;
}

/**
 * Least-squares Bézier refit of every smooth run, keeping corners sharper
 * than the threshold. Contract: the result never has more anchors than the
 * input.
 */
export function simplifyPath(
  points: PathPoint[],
  closed = false,
  opts: SimplifyOptions = {},
): PathPoint[] {
  const n = points.length;
  if (n < 3) return clonePathPoints(points);
  const tol = Math.max(1e-3, opts.tolerance ?? 1);
  const cornerAngle = opts.cornerAngleDeg ?? 30;

  if (opts.straightLines) {
    // Douglas–Peucker over the dense polyline; corners survive as the
    // high-deviation vertices RDP always keeps.
    const samples = denseSamples(points, closed, tol);
    const keep = closed ? samples.concat([samples[0]]) : samples;
    const poly = rdp(keep, tol);
    const anchors = poly.slice(0, closed ? poly.length - 1 : poly.length);
    if (anchors.length < (closed ? 3 : 2)) return clonePathPoints(points);
    if (anchors.length > n) return clonePathPoints(points);
    return anchors.map(p => ({ type: "anchor" as const, x: p[0], y: p[1] }));
  }

  // Corner anchors split the path into smooth runs.
  const corners: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) { corners.push(i); continue; }
    if (turnAt(points, closed, i) > cornerAngle) corners.push(i);
  }
  if (closed && corners.length === 0) corners.push(0);

  const segs = allSegs(points, closed);
  const segCount = segs.length;
  const runs: Array<[number, number]> = []; // inclusive segment index ranges
  if (closed) {
    for (let c = 0; c < corners.length; c++) {
      const from = corners[c];
      const to = c + 1 < corners.length ? corners[c + 1] : corners[0] + segCount;
      if (to > from) runs.push([from, to]);
    }
  } else {
    for (let c = 0; c + 1 < corners.length; c++) {
      if (corners[c + 1] > corners[c]) runs.push([corners[c], corners[c + 1]]);
    }
  }

  const fitted: CubicSeg[] = [];
  for (const [from, to] of runs) {
    // Dense samples of the run, starting at its corner anchor.
    const samples: Pt[] = [P(points[from % n])];
    for (let i = from; i < to; i++) {
      const seg = segs[i % segCount];
      const m = Math.min(256, Math.max(4, Math.ceil(cubicLen(seg) / (tol * 0.5))));
      for (let s = 1; s <= m; s++) samples.push(cubicAt(seg, s / m));
    }
    const firstSeg = segs[from % segCount];
    const lastSeg = segs[(to - 1) % segCount];
    const t0 = unit([firstSeg.c1[0] - firstSeg.p0[0], firstSeg.c1[1] - firstSeg.p0[1]])
      ?? unit([lastSeg.p3[0] - lastSeg.p0[0], lastSeg.p3[1] - lastSeg.p0[1]]);
    const t1 = unit([lastSeg.p3[0] - lastSeg.c2[0], lastSeg.p3[1] - lastSeg.c2[1]])
      ?? unit([lastSeg.p3[0] - lastSeg.p0[0], lastSeg.p3[1] - lastSeg.p0[1]]);
    if (!t0 || !t1) continue;
    for (const c of fitCubics(samples, t0, t1, tol)) {
      fitted.push({
        p0: c.p0, c1: c.c1, c2: c.c2, p3: c.p3,
        line: isStraightStruct(c, tol * 0.02),
      });
    }
  }
  if (fitted.length === 0) return clonePathPoints(points);
  const result = segsToPoints(fitted, closed);
  // Simplify never adds anchors: keep whichever version is smaller.
  return result.length > n ? clonePathPoints(points) : result;
}

/** Structural stand-in for fit.ts's private Cubic type. */
function isStraightStruct(c: { p0: Pt; c1: Pt; c2: Pt; p3: Pt }, tol: number): boolean {
  let flat = true;
  for (let k = 1; k < 8; k++) {
    const t = k / 8;
    const u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, w = 3 * u * t * t, e = t * t * t;
    const x = a * c.p0[0] + b * c.c1[0] + w * c.c2[0] + e * c.p3[0];
    const y = a * c.p0[1] + b * c.c1[1] + w * c.c2[1] + e * c.p3[1];
    // Distance to the chord p0→p3.
    const dx = c.p3[0] - c.p0[0], dy = c.p3[1] - c.p0[1];
    const len = Math.hypot(dx, dy);
    const dev = len < 1e-12
      ? Math.hypot(x - c.p0[0], y - c.p0[1])
      : Math.abs((x - c.p0[0]) * dy - (y - c.p0[1]) * dx) / len;
    if (dev > tol) { flat = false; break; }
  }
  return flat;
}

/** Angle (degrees) between incoming and outgoing travel directions. */
function turnAt(points: PathPoint[], closed: boolean, i: number): number {
  const n = points.length;
  const p = points[i];
  const prev = closed ? points[(i + n - 1) % n] : points[i - 1];
  const next = closed ? points[(i + 1) % n] : points[i + 1];
  const inDir = p.cpIn ? unit([p.x - p.cpIn.x, p.y - p.cpIn.y])
    : prev ? unit([p.x - prev.x, p.y - prev.y]) : null;
  const outDir = p.cpOut ? unit([p.cpOut.x - p.x, p.cpOut.y - p.y])
    : next ? unit([next.x - p.x, next.y - p.y]) : null;
  if (!inDir || !outDir) return 0;
  const d = Math.min(1, Math.max(-1, inDir[0] * outDir[0] + inDir[1] * outDir[1]));
  return Math.acos(d) * (180 / Math.PI);
}

/** Dense polyline of the whole subpath (all points, deduplicated). */
function denseSamples(points: PathPoint[], closed: boolean, tol: number): Pt[] {
  const segs = allSegs(points, closed);
  const out: Pt[] = [];
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const m = Math.min(256, Math.max(4, Math.ceil(cubicLen(seg) / (tol * 0.5))));
    for (let s = i === 0 ? 0 : 1; s <= m; s++) out.push(cubicAt(seg, s / m));
  }
  return out;
}

// ── Smooth ──

/**
 * Pull handles toward Catmull-Rom tangents. `iterations` relaxation rounds,
 * each blending half a step; anchor positions never move and the endpoints
 * of open paths keep their handles untouched.
 */
export function smoothPath(points: PathPoint[], closed = false, iterations = 1): PathPoint[] {
  const n = points.length;
  if (n < 3 || iterations <= 0) return clonePathPoints(points);
  const out = clonePathPoints(points);
  const rounds = Math.max(1, Math.min(10, Math.round(iterations)));
  for (let round = 0; round < rounds; round++) {
    const snapshot = clonePathPoints(out);
    for (let i = 0; i < n; i++) {
      if (!closed && (i === 0 || i === n - 1)) continue;
      const prev = snapshot[(i + n - 1) % n];
      const next = snapshot[(i + 1) % n];
      const p = snapshot[i];
      const dir = unit([next.x - prev.x, next.y - prev.y]);
      if (!dir) continue;
      const tin: Pt = [p.x - dir[0] * (dist(p, prev) / 3), p.y - dir[1] * (dist(p, prev) / 3)];
      const tout: Pt = [p.x + dir[0] * (dist(p, next) / 3), p.y + dir[1] * (dist(p, next) / 3)];
      const a = out[i];
      a.cpIn = blendHandle(a.cpIn, tin, p);
      a.cpOut = blendHandle(a.cpOut, tout, p);
      a.type = a.cpIn || a.cpOut ? "smooth" : a.type;
    }
  }
  return out;
}

/** Half a step from the current handle toward the Catmull-Rom target. */
function blendHandle(base: Point | undefined, target: Pt, anchor: Point): Point | undefined {
  const from = base ? [base.x, base.y] : [anchor.x, anchor.y];
  const blended: Point = { x: from[0] + (target[0] - from[0]) * 0.5, y: from[1] + (target[1] - from[1]) * 0.5 };
  if (Math.abs(blended.x - anchor.x) < 1e-6 && Math.abs(blended.y - anchor.y) < 1e-6) return undefined;
  return blended;
}

// ── Remove redundant points ──

/**
 * Drop anchors that can be removed without changing the shape by more than
 * `tolerance`: duplicate points, collinear line joints, and curve joints one
 * cubic can replace (joints sharper than ~8° are kept as corners).
 */
export function removeRedundantPoints(
  points: PathPoint[],
  closed = false,
  tolerance = 0.25,
): PathPoint[] {
  const tol = Math.max(1e-9, tolerance);
  let segs = allSegs(points, closed).filter(s => !isZeroSeg(s));
  const minSegs = closed ? 2 : 1;
  const G1 = 0.99; // cos(≈8°): only (near-)smooth joints merge
  let changed = true;
  while (changed && segs.length > minSegs) {
    changed = false;
    const joints = closed ? segs.length : segs.length - 1;
    for (let j = 0; j < joints; j++) {
      const i0 = closed ? (j + segs.length - 1) % segs.length : j;
      const i1 = closed ? j : j + 1;
      const merged = mergeSegs(segs[i0], segs[i1], tol, G1);
      if (merged) {
        segs[i0] = merged;
        segs.splice(i1, 1);
        if (closed && i1 === 0) {
          // The merged segment now starts the loop.
          const lastSeg = segs.pop();
          if (lastSeg) segs.unshift(lastSeg);
        }
        changed = true;
        break;
      }
    }
  }
  const result = segsToPoints(segs, closed);
  return result.length >= 2 ? result : clonePathPoints(points);
}

function isZeroSeg(s: CubicSeg): boolean {
  return (
    Math.hypot(s.p3[0] - s.p0[0], s.p3[1] - s.p0[1]) < 1e-9 &&
    Math.hypot(s.c1[0] - s.p0[0], s.c1[1] - s.p0[1]) < 1e-9 &&
    Math.hypot(s.c2[0] - s.p0[0], s.c2[1] - s.p0[1]) < 1e-9
  );
}

function mergeSegs(a: CubicSeg, b: CubicSeg, tol: number, g1: number): CubicSeg | null {
  if (a.line && b.line) {
    const chord: Pt = [b.p3[0] - a.p0[0], b.p3[1] - a.p0[1]];
    const len = Math.hypot(chord[0], chord[1]);
    if (len < 1e-12) return null;
    const mid: Pt = [a.p3[0] - a.p0[0], a.p3[1] - a.p0[1]];
    const along = (mid[0] * chord[0] + mid[1] * chord[1]) / len;
    const cross = Math.abs(mid[0] * chord[1] - mid[1] * chord[0]) / len;
    if (cross > tol || along < 0 || along > len) return null;
    return { p0: a.p0, c1: a.p0, c2: b.p3, p3: b.p3, line: true };
  }
  const ta: Pt = [a.p3[0] - a.c2[0], a.p3[1] - a.c2[1]];
  const tb: Pt = [b.c1[0] - b.p0[0], b.c1[1] - b.p0[1]];
  const ua = unit(ta), ub = unit(tb);
  if (!ua || !ub || ua[0] * ub[0] + ua[1] * ub[1] < g1) return null;
  const samples: Pt[] = [];
  for (let k = 0; k <= 16; k++) samples.push(cubicAt(a, k / 16));
  for (let k = 1; k <= 16; k++) samples.push(cubicAt(b, k / 16));
  const [c, err] = fitSingle(samples, ua, ub);
  if (!Number.isFinite(err) || err > tol) return null;
  return { p0: c.p0, c1: c.c1, c2: c.c2, p3: c.p3, line: false };
}

// ── Add anchor points ──

/** One new anchor at the middle (t = 0.5) of every segment. */
export function addAnchorPoints(points: PathPoint[], closed = false): PathPoint[] {
  const segCount = closed ? points.length : points.length - 1;
  let out = points;
  for (let endIdx = segCount; endIdx >= 1; endIdx--) {
    out = splitPathSegment(out, endIdx, 0.5, closed);
  }
  return out;
}

// ── Join ──

export interface JoinablePath {
  points: PathPoint[];
  closed: boolean;
}

/**
 * Join the open subpaths nearest-endpoint-first into one open path
 * (endpoints closer than `tolerance` merge into a single anchor, otherwise a
 * straight segment bridges them). A single open path is closed instead.
 * Closed subpaths pass through unchanged.
 */
export function joinPaths(paths: JoinablePath[], tolerance = 5): JoinablePath[] {
  const closedOut: JoinablePath[] = [];
  const open: JoinablePath[] = [];
  for (const p of paths) {
    if (!p.points.length) continue;
    if (p.closed || p.points.length < 2) {
      closedOut.push({ points: clonePathPoints(p.points), closed: p.closed });
    } else {
      open.push({ points: clonePathPoints(p.points), closed: false });
    }
  }
  if (open.length === 1) {
    const sp = open[0];
    const first = sp.points[0];
    const last = sp.points[sp.points.length - 1];
    if (sp.points.length > 2 && dist(first, last) <= tolerance) {
      // Close through the shared anchor: the first keeps its cpOut and takes
      // the last one's cpIn.
      const dropped = sp.points.pop();
      if (dropped) first.cpIn = dropped.cpIn;
    } else {
      first.cpIn = undefined;
      last.cpOut = undefined;
    }
    closedOut.push({ points: sp.points, closed: true });
    return closedOut;
  }
  while (open.length > 1) {
    let best = { d: Infinity, i: 0, j: 1, ei: false, ej: false };
    for (let i = 0; i < open.length; i++) {
      for (let j = i + 1; j < open.length; j++) {
        for (const ei of [false, true]) {
          for (const ej of [false, true]) {
            const pa = endAnchor(open[i], ei);
            const pb = endAnchor(open[j], ej);
            const d = dist(pa, pb);
            if (d < best.d) best = { d, i, j, ei, ej };
          }
        }
      }
    }
    const b = open.splice(best.j, 1)[0];
    const a = open[best.i];
    if (!best.ei) reverseJoinableInPlace(a);
    if (best.ej) reverseJoinableInPlace(b);
    const lastA = a.points[a.points.length - 1];
    if (best.d <= tolerance && b.points.length > 0) {
      const firstB = b.points.shift();
      if (firstB) lastA.cpOut = firstB.cpOut;
    } else {
      lastA.cpOut = undefined;
      b.points[0].cpIn = undefined;
    }
    a.points.push(...b.points);
  }
  return [...closedOut, ...open];
}

function endAnchor(p: JoinablePath, last: boolean): PathPoint {
  return last ? p.points[p.points.length - 1] : p.points[0];
}

/** In-place reversal used by Join to splice far endpoints. */
function reverseJoinableInPlace(p: JoinablePath): void {
  p.points.reverse();
  for (const a of p.points) {
    const swap = a.cpIn;
    a.cpIn = a.cpOut;
    a.cpOut = swap;
  }
}

// ── Reverse ──

/**
 * Reverse the travel direction of the path: the anchor order flips and every
 * anchor swaps its incoming and outgoing handles, so the drawn curve is
 * unchanged. The anchor of a closed path stays wherever it is; the open path
 * starts where it ended.
 */
export function reversePath(points: PathPoint[], closed = false): PathPoint[] {
  const out = clonePathPoints(points);
  if (out.length < 2) return out;
  out.reverse();
  for (const a of out) {
    const swap = a.cpIn;
    a.cpIn = a.cpOut;
    a.cpOut = swap;
  }
  return out;
}

// ── Average ──

/** Which coordinate(s) the anchors average onto (Illustrator's dialog). */
export type AverageMode = "h" | "v" | "both";

/**
 * Average every anchor onto the mean: "h" lines them up along a horizontal
 * (shared Y), "v" along a vertical (shared X), "both" collapses them onto the
 * centroid. Handles travel with their anchor (same delta), so the character
 * of each curve survives the move.
 */
export function averagePath(points: PathPoint[], mode: AverageMode = "both"): PathPoint[] {
  const out = clonePathPoints(points);
  if (out.length < 2) return out;
  const meanX = out.reduce((s, p) => s + p.x, 0) / out.length;
  const meanY = out.reduce((s, p) => s + p.y, 0) / out.length;
  for (const p of out) {
    const dx = mode === "h" ? 0 : meanX - p.x;
    const dy = mode === "v" ? 0 : meanY - p.y;
    if (dx === 0 && dy === 0) continue;
    p.x += dx;
    p.y += dy;
    if (p.cpIn) { p.cpIn.x += dx; p.cpIn.y += dy; }
    if (p.cpOut) { p.cpOut.x += dx; p.cpOut.y += dy; }
  }
  return out;
}

// ── Cleanup (stray anchors) ──

export interface StrayResult {
  points: PathPoint[];
  removed: number;
}

export const STRAY_EPSILON = 1e-6;

/**
 * Cleanup's stray-point pass: drop bare anchors (no handles) that duplicate
 * the position of their neighbour, including a duplicated closing anchor on
 * a closed path. Anchors that carry handles always survive — they shape the
 * neighbouring segments. Returns null when there is nothing to remove.
 */
export function removeStrayAnchors(points: PathPoint[], closed = false): StrayResult | null {
  const kept: PathPoint[] = [];
  let removed = 0;
  for (const p of points) {
    const prev = kept[kept.length - 1];
    const bare = !p.cpIn && !p.cpOut;
    const duplicatesPrev = prev
      && bare
      && Math.abs(p.x - prev.x) < STRAY_EPSILON
      && Math.abs(p.y - prev.y) < STRAY_EPSILON;
    if (duplicatesPrev) { removed++; continue; }
    kept.push(p);
  }
  // A closed path whose first and last anchors coincide carries the closing
  // point twice (splitting does this); the duplicate is stray.
  if (closed && kept.length > 1) {
    const first = kept[0];
    const last = kept[kept.length - 1];
    if (!last.cpIn && !last.cpOut
      && Math.abs(first.x - last.x) < STRAY_EPSILON
      && Math.abs(first.y - last.y) < STRAY_EPSILON) {
      kept.pop();
      removed++;
    }
  }
  const min = closed ? 3 : 2;
  if (removed === 0 || kept.length < Math.min(min, points.length)) return null;
  return { points: kept, removed };
}
