/**
 * Loop → polygon → Bézier curves for the local image trace.
 *
 * Algorithms (public descriptions, reimplemented from scratch):
 * - Douglas–Peucker polyline simplification (iterative, stack-based).
 * - "Dejag": staircase jogs of pixel staircases collapse to their midpoints,
 *   which lie on the ideal boundary; true corner vertices are kept.
 * - Cubic Bézier fitting: the classic Graphics Gems approach (Philip
 *   Schneider) — chord-length parameterization, least-squares solve of the
 *   two handle lengths along fixed end tangents (2×2 normal equations),
 *   Newton–Raphson reparameterization (≤ 6 rounds), split at the worst point.
 *   Consecutive output cubics are G1 continuous.
 */

import type { CrackLoop } from "./contour.ts";

export interface FitOptions {
  polygonTol: number;
  fitTol: number;
  cornerAngle: number;
  snapLines: boolean;
}

export type Pt = [number, number];

/** An editable anchor: position plus optional incoming/outgoing handles. */
export interface FitAnchor {
  x: number;
  y: number;
  /** Handle controlling the segment arriving at this anchor. */
  hIn: Pt | null;
  /** Handle controlling the segment leaving this anchor. */
  hOut: Pt | null;
}

export interface FitSubPath {
  anchors: FitAnchor[];
  closed: boolean;
}

interface Cubic {
  p0: Pt;
  c1: Pt;
  c2: Pt;
  p3: Pt;
}

interface Seg {
  c: Cubic;
  line: boolean;
}

// ── Small vector helpers ──

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function unit(v: [number, number]): [number, number] | null {
  const l = Math.hypot(v[0], v[1]);
  return l > 1e-12 && Number.isFinite(l) ? [v[0] / l, v[1] / l] : null;
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const l2 = abx * abx + aby * aby;
  if (l2 < 1e-18) return dist(p, a);
  let t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / l2;
  t = Math.min(1, Math.max(0, t));
  return Math.hypot(p[0] - (a[0] + abx * t), p[1] - (a[1] + aby * t));
}

// ── Douglas–Peucker ──

/** Douglas–Peucker on pts[a..=b], marking kept indices (b may wrap via mod). */
function rdpMark(pts: Pt[], a: number, b: number, tol: number, keep: boolean[]): void {
  const stack: Array<[number, number]> = [[a, b]];
  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!;
    if (hi <= lo + 1) continue;
    const pa = pts[lo];
    const pb = pts[hi % pts.length];
    let bestD = 0;
    let bestI = lo;
    for (let i = lo + 1; i < hi; i++) {
      const d = segDist(pts[i], pa, pb);
      if (d > bestD) {
        bestD = d;
        bestI = i;
      }
    }
    if (bestD > tol) {
      keep[bestI] = true;
      stack.push([lo, bestI], [bestI, hi]);
    }
  }
}

// ── Dejag: collapse pixel-staircase jogs to midpoints ──

/**
 * A unit-length edge whose ends turn in opposite directions (an S-shaped
 * step) is a jog of a staircase approximating a sloped line: its midpoint
 * lies on the ideal boundary. Vertices not adjacent to any jog (true
 * corners, or the U-turns of one-pixel-wide lines) are kept.
 */
function dejag(v: Array<[number, number]>): Pt[] {
  const n = v.length;
  const edge = (i: number): [number, number] => {
    const a = v[i % n];
    const b = v[(i + 1) % n];
    return [b[0] - a[0], b[1] - a[1]];
  };
  const turn = (i: number): number => {
    const a = edge((i + n - 1) % n);
    const b = edge(i);
    return Math.sign(a[0] * b[1] - a[1] * b[0]);
  };
  const jog: boolean[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const [dx, dy] = edge(i);
    jog[i] = Math.abs(dx) + Math.abs(dy) === 1 && turn(i) * turn((i + 1) % n) < 0;
  }
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    if (!jog[i] && !jog[(i + n - 1) % n]) out.push([v[i][0], v[i][1]]);
    if (jog[i]) {
      const a = v[i];
      const b = v[(i + 1) % n];
      out.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    }
  }
  return out;
}

/** The polygon approximating a closed loop of pixel-corner vertices within tol. */
export function polygon(loopPts: Array<[number, number]>, tol: number): Pt[] {
  const raw: Pt[] = loopPts.map(p => [p[0], p[1]] as Pt);
  if (raw.length < 4) return raw;
  let pts = dejag(loopPts);
  if (pts.length < 3) pts = raw.slice();
  const n = pts.length;
  if (n < 4) return pts;
  // Split the closed loop at vertex 0 and the vertex farthest from it.
  let far = (n / 2) | 0;
  let bestD2 = -1;
  for (let i = 1; i < n; i++) {
    const d2 = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2;
    if (d2 > bestD2) {
      bestD2 = d2;
      far = i;
    }
  }
  const ext = pts.concat([pts[0]]);
  const keep = new Array<boolean>(n + 1).fill(false);
  keep[0] = true;
  keep[far] = true;
  rdpMark(ext, 0, far, tol, keep);
  rdpMark(ext, far, n, tol, keep);
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i]);
  // Vertex 0 was forced; drop it when it is not needed.
  if (out.length > 3) {
    const p = out[0];
    const a = out[out.length - 1];
    const b = out[1];
    if (segDist(p, a, b) <= tol * 0.5) out.shift();
  }
  return out.length < 3 ? raw : out;
}

// ── Cubic Bézier machinery ──

function cubicEval(c: Cubic, t: number): Pt {
  const s = 1 - t;
  const b0 = s * s * s, b1 = 3 * s * s * t, b2 = 3 * s * t * t, b3 = t * t * t;
  return [
    b0 * c.p0[0] + b1 * c.c1[0] + b2 * c.c2[0] + b3 * c.p3[0],
    b0 * c.p0[1] + b1 * c.c1[1] + b2 * c.c2[1] + b3 * c.p3[1],
  ];
}

function cubicDeriv(c: Cubic, t: number): Pt {
  const s = 1 - t;
  return [
    3 * (s * s * (c.c1[0] - c.p0[0]) + 2 * s * t * (c.c2[0] - c.c1[0]) + t * t * (c.p3[0] - c.c2[0])),
    3 * (s * s * (c.c1[1] - c.p0[1]) + 2 * s * t * (c.c2[1] - c.c1[1]) + t * t * (c.p3[1] - c.c2[1])),
  ];
}

function cubicDeriv2(c: Cubic, t: number): Pt {
  const s = 1 - t;
  return [
    6 * (s * (c.c2[0] - 2 * c.c1[0] + c.p0[0]) + t * (c.p3[0] - 2 * c.c2[0] + c.c1[0])),
    6 * (s * (c.c2[1] - 2 * c.c1[1] + c.p0[1]) + t * (c.p3[1] - 2 * c.c2[1] + c.c1[1])),
  ];
}

/** Arc length by dense sampling (deterministic; only drives sample counts). */
function cubicArcLen(c: Cubic): number {
  let len = 0;
  let prev = c.p0;
  for (let i = 1; i <= 64; i++) {
    const p = cubicEval(c, i / 64);
    len += dist(prev, p);
    prev = p;
  }
  return len;
}

/** Direction the curve leaves p0 (robust to retracted handles). */
function startTangent(c: Cubic): [number, number] {
  return unit([c.c1[0] - c.p0[0], c.c1[1] - c.p0[1]])
    ?? unit([c.c2[0] - c.p0[0], c.c2[1] - c.p0[1]])
    ?? unit([c.p3[0] - c.p0[0], c.p3[1] - c.p0[1]])
    ?? [1, 0];
}

/** Direction the curve arrives at p3, pointing forward along travel. */
function endTangent(c: Cubic): [number, number] {
  return unit([c.p3[0] - c.c2[0], c.p3[1] - c.c2[1]])
    ?? unit([c.p3[0] - c.c1[0], c.p3[1] - c.c1[1]])
    ?? unit([c.p3[0] - c.p0[0], c.p3[1] - c.p0[1]])
    ?? [1, 0];
}

const MAX_REPARAM = 6;

function chordParams(pts: Pt[]): number[] {
  const u: number[] = [0];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    acc += dist(pts[i - 1], pts[i]);
    u.push(acc);
  }
  if (acc > 0) for (let i = 0; i < u.length; i++) u[i] /= acc;
  return u;
}

function bern(t: number): [number, number, number, number] {
  const s = 1 - t;
  return [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t];
}

/**
 * Solve the 2×2 normal equations for the two handle lengths along the fixed
 * end tangents, with degenerate-data fallbacks (negative/non-finite solutions
 * collapse to the cubic Bezier control approximation seg/3).
 */
function generate(pts: Pt[], u: number[], t0: [number, number], t1: [number, number]): Cubic {
  const p0 = pts[0];
  const p3 = pts[pts.length - 1];
  const dirIn: [number, number] = [-t1[0], -t1[1]]; // end handle points backwards
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < pts.length; i++) {
    const b = bern(u[i]);
    const a0x = t0[0] * b[1], a0y = t0[1] * b[1];
    const a1x = dirIn[0] * b[2], a1y = dirIn[1] * b[2];
    c00 += a0x * a0x + a0y * a0y;
    c01 += a0x * a1x + a0y * a1y;
    c11 += a1x * a1x + a1y * a1y;
    const rx = pts[i][0] - (p0[0] * (b[0] + b[1]) + p3[0] * (b[2] + b[3]));
    const ry = pts[i][1] - (p0[1] * (b[0] + b[1]) + p3[1] * (b[2] + b[3]));
    x0 += a0x * rx + a0y * ry;
    x1 += a1x * rx + a1y * ry;
  }
  const det = c00 * c11 - c01 * c01;
  const seg = dist(p0, p3);
  const eps = 1e-6 * seg;
  let al: number;
  let ar: number;
  if (Math.abs(det) > 1e-12) {
    al = (x0 * c11 - x1 * c01) / det;
    ar = (c00 * x1 - c01 * x0) / det;
  } else {
    al = seg / 3;
    ar = seg / 3;
  }
  if (!Number.isFinite(al) || !Number.isFinite(ar) || al < eps || ar < eps) {
    al = seg / 3;
    ar = seg / 3;
  }
  // Guard against wild handles on nearly-degenerate data.
  const cap = seg * 4 + 1e-9;
  al = Math.min(al, cap);
  ar = Math.min(ar, cap);
  return {
    p0: [p0[0], p0[1]],
    c1: [p0[0] + t0[0] * al, p0[1] + t0[1] * al],
    c2: [p3[0] + dirIn[0] * ar, p3[1] + dirIn[1] * ar],
    p3: [p3[0], p3[1]],
  };
}

function maxError(pts: Pt[], c: Cubic, u: number[]): [number, number] {
  let e = 0;
  let idx = (pts.length / 2) | 0;
  for (let i = 0; i < pts.length; i++) {
    const p = cubicEval(c, u[i]);
    const d = Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]);
    if (d > e) {
      e = d;
      idx = i;
    }
  }
  return [e, idx];
}

function newton(c: Cubic, p: Pt, t: number): number {
  const q: [number, number] = [cubicEval(c, t)[0] - p[0], cubicEval(c, t)[1] - p[1]];
  const d1 = cubicDeriv(c, t);
  const d2 = cubicDeriv2(c, t);
  const num = q[0] * d1[0] + q[1] * d1[1];
  const den = d1[0] * d1[0] + d1[1] * d1[1] + q[0] * d2[0] + q[1] * d2[1];
  if (Math.abs(den) < 1e-12) return t;
  const nt = t - num / den;
  return Number.isFinite(nt) ? Math.min(1, Math.max(0, nt)) : t;
}

/** Best single cubic for pts with the given end tangents → [curve, maxError, worstIndex]. */
export function fitSingle(pts: Pt[], t0: [number, number], t1: [number, number]): [Cubic, number, number] {
  const u = chordParams(pts);
  let best = generate(pts, u, t0, t1);
  let [bestErr, bestSplit] = maxError(pts, best, u);
  for (let round = 0; round < MAX_REPARAM; round++) {
    for (let i = 0; i < u.length; i++) u[i] = newton(best, pts[i], u[i]);
    const c = generate(pts, u, t0, t1);
    const [e, s] = maxError(pts, c, u);
    if (e < bestErr) {
      best = c;
      bestErr = e;
      bestSplit = s;
    } else {
      break;
    }
  }
  return [best, bestErr, bestSplit];
}

function dedup(pts: Pt[]): Pt[] {
  const v: Pt[] = [];
  for (const p of pts) {
    if (v.length === 0 || dist(v[v.length - 1], p) > 1e-12) v.push(p);
  }
  return v;
}

/** Fit a chain of cubics through pts (max parametric error tol), G1 continuous. */
export function fitCubics(pts: Pt[], t0: [number, number], t1: [number, number], tol: number): Cubic[] {
  const out: Cubic[] = [];
  const p = dedup(pts);
  if (p.length < 2) return out;
  const rec = (seg: Pt[], a: [number, number], b: [number, number], depth: number): void => {
    if (seg.length === 2) {
      const d = dist(seg[0], seg[1]) / 3;
      out.push({
        p0: seg[0],
        c1: [seg[0][0] + a[0] * d, seg[0][1] + a[1] * d],
        c2: [seg[1][0] - b[0] * d, seg[1][1] - b[1] * d],
        p3: seg[1],
      });
      return;
    }
    const [c, err, split0] = fitSingle(seg, a, b);
    if (err <= Math.max(tol, 1e-9) || depth > 40) {
      out.push(c);
      return;
    }
    // Split at the worst point with a centre tangent from its neighbours.
    const split = Math.min(Math.max(split0, 1), seg.length - 2);
    const tc = unit([seg[split + 1][0] - seg[split - 1][0], seg[split + 1][1] - seg[split - 1][1]]) ?? a;
    rec(seg.slice(0, split + 1), a, tc, depth + 1);
    rec(seg.slice(split), tc, b, depth + 1);
  };
  rec(p, t0, t1, 0);
  return out;
}

/** Is the cubic (within tol) a straight line from p0 to p3, handles inside the chord? */
export function isStraight(c: Cubic, tol: number): boolean {
  const chord: [number, number] = [c.p3[0] - c.p0[0], c.p3[1] - c.p0[1]];
  const len = Math.hypot(chord[0], chord[1]);
  if (len < 1e-12) {
    return dist(c.c1, c.p0) <= tol && dist(c.c2, c.p0) <= tol;
  }
  const dir: [number, number] = [chord[0] / len, chord[1] / len];
  for (const h of [c.c1, c.c2]) {
    const v: [number, number] = [h[0] - c.p0[0], h[1] - c.p0[1]];
    const along = v[0] * dir[0] + v[1] * dir[1];
    const cross = Math.abs(v[0] * dir[1] - v[1] * dir[0]);
    if (cross > tol || along < -tol || along > len + tol) return false;
  }
  return true;
}

// ── Subpath pipeline (corners → runs → fitted segments → anchors) ──

function turnDeg(a: Seg, b: Seg): number {
  const t1 = endTangent(a.c);
  const t2 = startTangent(b.c);
  const d = Math.min(1, Math.max(-1, t1[0] * t2[0] + t1[1] * t2[1]));
  return Math.acos(d) * (180 / Math.PI);
}

/** Ramer–Douglas–Peucker polyline reduction (open). */
export function rdp(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = true;
  keep[pts.length - 1] = true;
  rdpMark(pts, 0, pts.length - 1, tol, keep);
  return pts.filter((_, i) => keep[i]);
}

function polylineSubPath(poly: Pt[], closed: boolean): FitSubPath {
  return {
    anchors: poly.map(p => ({ x: p[0], y: p[1], hIn: null, hOut: null })),
    closed,
  };
}

function segmentsOf(sp: FitSubPath): Seg[] {
  const segs: Seg[] = [];
  const n = sp.anchors.length;
  const last = sp.closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = sp.anchors[i];
    const b = sp.anchors[(i + 1) % n];
    const c1: Pt = a.hOut ?? [a.x, a.y];
    const c2: Pt = b.hIn ?? [b.x, b.y];
    segs.push({ c: { p0: [a.x, a.y], c1, c2, p3: [b.x, b.y] }, line: !a.hOut && !b.hIn });
  }
  return segs;
}

function subPathFromSegments(segs: Seg[], closed: boolean): FitSubPath | null {
  if (segs.length === 0) return null;
  const anchors: FitAnchor[] = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const prev = segs[(i + segs.length - 1) % segs.length];
    const isFirst = i === 0;
    anchors.push({
      x: s.c.p0[0],
      y: s.c.p0[1],
      hIn: closed || !isFirst ? (prev.line ? null : prev.c.c2) : null,
      hOut: s.line ? null : s.c.c1,
    });
  }
  const lastSeg = segs[segs.length - 1];
  if (closed) {
    const first = anchors[0];
    first.hIn = lastSeg.line ? null : lastSeg.c.c2;
  } else {
    anchors.push({ x: lastSeg.c.p3[0], y: lastSeg.c.p3[1], hIn: lastSeg.line ? null : lastSeg.c.c2, hOut: null });
  }
  return { anchors, closed };
}

/**
 * Least-squares Bézier refit of a polyline subpath, keeping corners sharper
 * than the threshold. Contract: never returns more anchors than the input.
 */
function simplifyWith(poly: FitSubPath, cornerAngleDeg: number, tol: number): FitSubPath {
  const segs = segmentsOf(poly);
  const n = segs.length;
  if (n === 0) return poly;
  const cornerAt = (i: number): boolean => {
    if (!poly.closed && (i === 0 || i === n)) return true;
    return turnDeg(segs[(i + n - 1) % n], segs[i % n]) > cornerAngleDeg;
  };
  let corners: number[] = [];
  for (let i = 0; i < n; i++) if (cornerAt(i)) corners.push(i);
  if (poly.closed) {
    if (corners.length > 0) {
      const k = corners[0];
      const rotated = segs.slice(k).concat(segs.slice(0, k));
      segs.length = 0;
      segs.push(...rotated);
      corners = corners.map(c => c - k);
    } else {
      corners = [0];
    }
    corners.push(n);
  } else if (corners[corners.length - 1] !== n) {
    corners.push(n);
  }
  const result: Seg[] = [];
  for (let w = 0; w + 1 < corners.length; w++) {
    const run = segs.slice(corners[w], corners[w + 1]);
    if (run.length === 0) continue;
    const pts: Pt[] = [];
    for (let k = 0; k < run.length; k++) {
      const len = cubicArcLen(run[k].c);
      const m = Math.min(256, Math.max(4, Math.ceil(len / (tol * 0.5))));
      for (let s = k === 0 ? 0 : 1; s <= m; s++) pts.push(cubicEval(run[k].c, s / m));
    }
    const t0 = startTangent(run[0].c);
    const t1 = endTangent(run[run.length - 1].c);
    for (const c of fitCubics(pts, t0, t1, tol)) {
      const line = isStraight(c, tol * 0.02);
      result.push({ c, line });
    }
  }
  const fitted = subPathFromSegments(result, poly.closed);
  if (!fitted) return poly;
  // Simplify never adds anchors: keep whichever subpath is smaller.
  return fitted.anchors.length > poly.anchors.length ? poly : fitted;
}

/** Retract the handles of curves that stay within tol of their chord. */
function snapToLines(sp: FitSubPath, tol: number): void {
  const n = sp.anchors.length;
  const segCount = sp.closed ? n : n - 1;
  for (let i = 0; i < segCount; i++) {
    const a = sp.anchors[i];
    const b = sp.anchors[(i + 1) % n];
    if (!a.hOut && !b.hIn) continue;
    const c: Cubic = {
      p0: [a.x, a.y],
      c1: a.hOut ?? [a.x, a.y],
      c2: b.hIn ?? [b.x, b.y],
      p3: [b.x, b.y],
    };
    let straight = true;
    for (let k = 1; k < 8; k++) {
      if (segDist(cubicEval(c, k / 8), c.p0, c.p3) > tol) {
        straight = false;
        break;
      }
    }
    if (straight) {
      a.hOut = null;
      b.hIn = null;
    }
  }
  for (const a of sp.anchors) {
    if (!a.hIn || !a.hOut) {
      // A corner keeps at most a dangling handle pair cleared for consistency.
      if (!a.hIn) a.hIn = null;
      if (!a.hOut) a.hOut = null;
    }
  }
}

function finalizeFit(poly: Pt[], closed: boolean, o: FitOptions): FitSubPath | null {
  if (poly.length < (closed ? 3 : 2)) return null;
  const sp = polylineSubPath(poly, closed);
  const fitted = simplifyWith(sp, o.cornerAngle, o.fitTol);
  if (fitted.anchors.length < 2) return null;
  if (o.snapLines) snapToLines(fitted, Math.max(o.fitTol * 2, 1.5));
  return fitted;
}

/** Fit one boundary loop into a closed Bézier subpath (pixel coordinates). */
export function fitLoop(l: CrackLoop, o: FitOptions): FitSubPath | null {
  const poly = polygon(l.pts, o.polygonTol);
  if (poly.length < 3) return null;
  return finalizeFit(poly, true, o);
}

/**
 * Fit a centre line through pts (pixel-centre points in order): RDP drops
 * the points within polygonTol of it, then curves are fitted. A `closed`
 * line runs back to its first point.
 */
export function fitPolyline(pts: Pt[], closed: boolean, o: FitOptions): FitSubPath | null {
  const n = pts.length;
  if (n < 2) return null;
  let poly: Pt[];
  if (closed) {
    const first = pts[0];
    let far = (n / 2) | 0;
    let bestD2 = -1;
    for (let i = 1; i < n; i++) {
      const d2 = (pts[i][0] - first[0]) ** 2 + (pts[i][1] - first[1]) ** 2;
      if (d2 > bestD2) {
        bestD2 = d2;
        far = i;
      }
    }
    const ext = pts.concat([first]);
    const keep = new Array<boolean>(n + 1).fill(false);
    keep[0] = true;
    keep[far] = true;
    rdpMark(ext, 0, far, o.polygonTol, keep);
    rdpMark(ext, far, n, o.polygonTol, keep);
    poly = [];
    for (let i = 0; i < n; i++) if (keep[i]) poly.push(pts[i]);
    if (poly.length < 3) poly = pts.slice();
    if (poly.length < 3) return null;
  } else {
    const keep = new Array<boolean>(n).fill(false);
    keep[0] = true;
    keep[n - 1] = true;
    rdpMark(pts, 0, n - 1, o.polygonTol, keep);
    poly = [];
    for (let i = 0; i < n; i++) if (keep[i]) poly.push(pts[i]);
    if (poly.length < 2) return null;
  }
  return finalizeFit(poly, closed, o);
}

// ── Serialization to SVG path data ──

const round2 = (v: number) => Math.round(v * 100) / 100;

const fmtPt = (p: Pt) => `${round2(p[0])} ${round2(p[1])}`;

/** Serialize one subpath as M…C/L…Z SVG path data (compatible with parsePathData). */
export function subPathToD(sp: FitSubPath): string {
  const n = sp.anchors.length;
  if (n === 0) return "";
  const a0 = sp.anchors[0];
  let d = `M${round2(a0.x)} ${round2(a0.y)}`;
  const segCount = sp.closed ? n : n - 1;
  for (let i = 0; i < segCount; i++) {
    const a = sp.anchors[i];
    const b = sp.anchors[(i + 1) % n];
    const c1: Pt = a.hOut ?? [a.x, a.y];
    const c2: Pt = b.hIn ?? [b.x, b.y];
    const end: Pt = [b.x, b.y];
    const isLine =
      (!a.hOut || (a.hOut[0] === a.x && a.hOut[1] === a.y)) &&
      (!b.hIn || (b.hIn[0] === b.x && b.hIn[1] === b.y));
    d += isLine ? `L${fmtPt(end)}` : `C${fmtPt(c1)} ${fmtPt(c2)} ${fmtPt(end)}`;
  }
  if (sp.closed) d += "Z";
  return d;
}

/** Anchor count of a subpath (feeds the TooComplex budget). */
export function anchorCount(sp: FitSubPath): number {
  return sp.anchors.length;
}
