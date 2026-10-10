/**
 * Offset Path and Outline Stroke — true geometric offsets for SVG paths.
 *
 * Approach (public descriptions, reimplemented from scratch): the path is
 * flattened to dense polylines and offsets are computed as boolean
 * combinations with the swept band of the boundary — growing unions the
 * fill with a 2|delta|-wide band, insetting subtracts it (the arrangement
 * semantics `m[0] || m[1]` / `m[0] && !m[1]` of the classic offset
 * algorithms). The band itself is the union of per-edge quads plus join
 * fills (round discs / miter-bevel triangles), which keeps every input
 * piece simple so the clipper never sees self-intersections. Contours that
 * fold inside themselves when |delta| exceeds a curvature radius are
 * dropped with the published deep-point test: a contour is spurious iff a
 * point well inside it lies closer than delta to the source path.
 *
 * Pure TypeScript (string → string, no DOM, no Node APIs): the same module
 * serves the editor, the worker and the MCP tool.
 */

import polygonClipping from "polygon-clipping";
import SVGPathCommander from "svg-path-commander";
import { deCasteljau } from "../bezierMath.ts";
import { getPathBezierSegments, parsePathData, type PathPoint } from "../pathData.ts";
import { fitPolyline, subPathToD, type FitOptions, type Pt } from "../trace/fit.ts";

export interface StrokeOpts {
  /** Open-path end treatment (offsets always use butt). */
  cap?: "butt" | "round" | "square";
  /** Corner treatment of the swept band. */
  join?: "miter" | "round" | "bevel";
  /** Miter length limit, in multiples of the band half width. */
  miterLimit?: number;
}

type Ring = Pt[];
/** polygon-clipping geometry: MultiPolygon = Polygon[] = Ring[]. */
type Geom = Ring[][];

interface FlatSub {
  points: PathPoint[];
  closed: boolean;
  poly: Pt[];
}

const FIT: FitOptions = { polygonTol: 0.5, fitTol: 0.4, cornerAngle: 60, snapLines: true };

// ── Flattening ──

/** Split a `d` into subpaths and flatten each to a dense polyline. */
function flattenSubpaths(d: string, step = 2): FlatSub[] {
  if (!d.trim()) return [];
  let abs: Array<Array<string | number>>;
  try {
    abs = SVGPathCommander.pathToAbsolute(d) as Array<Array<string | number>>;
  } catch {
    return [];
  }
  const chunks: Array<{ d: string; closed: boolean }> = [];
  let current: Array<Array<string | number>> = [];
  let currentClosed = false;
  const flush = () => {
    if (current.length) {
      chunks.push({ d: current.map(seg => `${seg[0]} ${seg.slice(1).join(" ")}`).join(" "), closed: currentClosed });
    }
    current = [];
    currentClosed = false;
  };
  for (const seg of abs) {
    const cmd = String(seg[0]).toUpperCase();
    if (cmd === "M") flush();
    if (cmd === "Z") currentClosed = true;
    current.push(seg);
  }
  flush();

  const subs: FlatSub[] = [];
  for (const chunk of chunks) {
    let points: PathPoint[];
    try {
      points = parsePathData(chunk.d);
    } catch {
      continue;
    }
    if (points.length < 2) continue;
    const poly: Pt[] = [];
    for (const controls of getPathBezierSegments(points, chunk.closed)) {
      const isLine = controls.length === 2;
      const len = isLine
        ? Math.hypot(controls[1].x - controls[0].x, controls[1].y - controls[0].y)
        : cubicLen(controls);
      const m = Math.min(256, Math.max(8, Math.ceil(len / step)));
      for (let s = poly.length === 0 ? 0 : 1; s <= m; s++) {
        const p = deCasteljau(controls, s / m);
        const last = poly[poly.length - 1];
        if (!last || Math.hypot(p.x - last[0], p.y - last[1]) > 1e-7) poly.push([p.x, p.y]);
      }
    }
    if (poly.length >= (chunk.closed ? 3 : 2)) subs.push({ points, closed: chunk.closed, poly });
  }
  return subs;
}

function cubicLen(controls: Array<{ x: number; y: number }>): number {
  let len = 0;
  let px = controls[0].x, py = controls[0].y;
  for (let k = 1; k <= 8; k++) {
    const p = deCasteljau(controls, k / 8);
    len += Math.hypot(p.x - px, p.y - py);
    px = p.x; py = p.y;
  }
  return len;
}

// ── Swept band (stroke) pieces ──

interface Edge { a: Pt; b: Pt; dir: Pt; nrm: Pt }

function buildEdges(poly: Pt[], closed: boolean): Edge[] {
  const edges: Edge[] = [];
  const count = closed ? poly.length : poly.length - 1;
  for (let i = 0; i < count; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    edges.push({ a, b, dir: [dx / len, dy / len], nrm: [dy / len, -dx / len] });
  }
  return edges;
}

/** Every simple piece whose union is the band swept by the polyline. */
function strokePieces(
  poly: Pt[],
  closed: boolean,
  halfW: number,
  opts: StrokeOpts,
): Ring[] {
  const join = opts.join ?? "round";
  const cap = opts.cap ?? "round";
  const miterLimit = Math.max(1, opts.miterLimit ?? 4);
  const pieces: Ring[] = [];
  const edges = buildEdges(poly, closed);
  if (!edges.length) return pieces;
  const h = halfW;
  // Quads extend by ε past their endpoints: consecutive quads then OVERLAP
  // (transversally) instead of touching at a point. Join fills are built at
  // h + gap with gap ≈ 1%: at exactly h a disc is TANGENT to the quad edge
  // lines, which crashes polygon-clipping's sweep line — a hair of oversize
  // turns every contact into a clean two-point crossing.
  const eps = Math.max(1e-4, h * 1e-3);
  const gap = Math.max(0.01, h * 0.01);
  const hw = h + gap;

  // One quad per edge (both sides), extended ε along the tangent.
  for (const e of edges) {
    const nx = e.nrm[0] * h, ny = e.nrm[1] * h;
    const sx = e.a[0] - e.dir[0] * eps, sy = e.a[1] - e.dir[1] * eps;
    const ex = e.b[0] + e.dir[0] * eps, ey = e.b[1] + e.dir[1] * eps;
    pieces.push([
      [sx + nx, sy + ny],
      [ex + nx, ey + ny],
      [ex - nx, ey - ny],
      [sx - nx, sy - ny],
    ]);
  }

  // Join fills between consecutive edges: a wedge arc spanning exactly the
  // turn angle at radius h + gap. Full discs graze the quad edge lines at
  // ~8° (near-tangential), which corrupts polygon-clipping's sweep; a wedge
  // either clears the lines entirely (near-collinear) or crosses them at a
  // healthy angle.
  const last = closed ? edges.length : edges.length - 1;
  for (let i = 0; i < last; i++) {
    const e0 = edges[i];
    const e1 = edges[(i + 1) % edges.length];
    const v = e0.b;
    const turn = Math.abs(signedAngle(e0.dir, e1.dir));
    if (join === "round") {
      // Straight continuation: the ε-extended quads already overlap and a
      // zero-angle wedge would be a degenerate (repeated-point) ring.
      if (turn > 1e-6) {
        pieces.push(wedge(v, e0.nrm, e1.nrm, hw, turn));
        pieces.push(wedge(v, neg(e0.nrm), neg(e1.nrm), hw, turn));
      }
      continue;
    }
    for (const side of [1, -1]) {
      // One of the two sides is the outer notch; the other lands inside the
      // union of the quads and is harmless.
      const a0: Pt = [v[0] + e0.nrm[0] * hw * side, v[1] + e0.nrm[1] * hw * side];
      const b0: Pt = [v[0] + e1.nrm[0] * hw * side, v[1] + e1.nrm[1] * hw * side];
      const m = rayIntersect(a0, e0.dir, b0, e1.dir);
      if (join === "miter" && m && Math.hypot(m[0] - v[0], m[1] - v[1]) <= hw * miterLimit) {
        pieces.push([a0, m, b0]);
      } else {
        pieces.push([a0, [v[0], v[1]], b0]);
      }
    }
  }

  // Caps on the open ends: a half-disc wedge (180°) around the endpoint.
  if (!closed && cap !== "butt") {
    const first = edges[0];
    const lastEdge = edges[edges.length - 1];
    if (cap === "round") {
      pieces.push(wedge(first.a, first.nrm, neg(first.nrm), hw, Math.PI, -1));
      pieces.push(wedge(lastEdge.b, lastEdge.nrm, neg(lastEdge.nrm), hw, Math.PI, 1));
    } else {
      // Square: extend by half the width along the tangent; corners at
      // h + gap so they cross the quad edge lines instead of touching them.
      pieces.push([
        [first.a[0] + first.nrm[0] * hw, first.a[1] + first.nrm[1] * hw],
        [first.a[0] - first.nrm[0] * hw, first.a[1] - first.nrm[1] * hw],
        [first.a[0] - first.nrm[0] * hw - first.dir[0] * h, first.a[1] - first.nrm[1] * hw - first.dir[1] * h],
        [first.a[0] + first.nrm[0] * hw - first.dir[0] * h, first.a[1] + first.nrm[1] * hw - first.dir[1] * h],
      ]);
      pieces.push([
        [lastEdge.b[0] + lastEdge.nrm[0] * hw, lastEdge.b[1] + lastEdge.nrm[1] * hw],
        [lastEdge.b[0] - lastEdge.nrm[0] * hw, lastEdge.b[1] - lastEdge.nrm[1] * hw],
        [lastEdge.b[0] - lastEdge.nrm[0] * hw + lastEdge.dir[0] * h, lastEdge.b[1] - lastEdge.nrm[1] * hw + lastEdge.dir[1] * h],
        [lastEdge.b[0] + lastEdge.nrm[0] * hw + lastEdge.dir[0] * h, lastEdge.b[1] + lastEdge.nrm[1] * hw + lastEdge.dir[1] * h],
      ]);
    }
  }
  return pieces;
}

function neg(v: Pt): Pt {
  return [-v[0], -v[1]];
}

/** Signed angle from unit vector a to unit vector b, in (−π, π]. */
function signedAngle(a: Pt, b: Pt): number {
  return Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]);
}

/**
 * Circular wedge with apex `v` from unit direction `u0` to `u1` at radius
 * `r`, sweeping the short way (or the way `forceSign` says). The apex sits
 * inside the band, the arc endpoints a hair past the quad edge lines —
 * every contact with the quads is a transversal crossing.
 */
function wedge(v: Pt, u0: Pt, u1: Pt, r: number, angle: number, forceSign?: number): Ring {
  const cross = u0[0] * u1[1] - u0[1] * u1[0];
  const sign = forceSign ?? (cross >= 0 ? 1 : -1);
  const m = Math.max(2, Math.ceil(Math.abs(angle) / 0.2));
  const ring: Ring = [[v[0], v[1]]];
  for (let k = 0; k <= m; k++) {
    const a = (angle * k / m) * sign;
    const c = Math.cos(a), s = Math.sin(a);
    // Rotate u0 by a around the origin.
    ring.push([v[0] + (u0[0] * c - u0[1] * s) * r, v[1] + (u0[0] * s + u0[1] * c) * r]);
  }
  return ring;
}

/** Intersection of p + s·dir with q + t·dirB, or null when parallel. */
function rayIntersect(p: Pt, dir: Pt, q: Pt, dirB: Pt): Pt | null {
  const den = dir[0] * dirB[1] - dir[1] * dirB[0];
  if (Math.abs(den) < 1e-12) return null;
  const dx = q[0] - p[0], dy = q[1] - p[1];
  const s = (dx * dirB[1] - dy * dirB[0]) / den;
  return [p[0] + dir[0] * s, p[1] + dir[1] * s];
}

// ── Boolean helpers ──

function toGeom(pieces: Ring[]): Geom {
  // Zero-area rings (degenerate wedges) corrupt the sweep line — drop them.
  return pieces.filter(p => p.length >= 3 && Math.abs(ringArea(p)) > 0.01).map(ring => [ring]);
}

/** Union of simple pieces, as polygons (outer + holes kept together). */
function unionPolys(pieces: Ring[]): Geom {
  const usable = pieces.filter(p => p.length >= 3);
  if (!usable.length) return [];
  let geom: Geom;
  try {
    const args = toGeom(usable) as unknown as Parameters<typeof polygonClipping.union>;
    geom = polygonClipping.union(...args) as Geom;
  } catch {
    // The batch union can hit sweep-line degeneracies; fall back to a
    // chained union, skipping pieces that break it.
    let acc: Geom | null = null;
    for (const piece of toGeom(usable)) {
      if (!acc) { acc = [piece]; continue; }
      try {
        acc = polygonClipping.union(acc as never, piece as never) as unknown as Geom;
      } catch {
        // skip this piece
      }
    }
    geom = acc ?? [];
  }
  const kept: Geom = [];
  for (const polygon of geom) {
    const rings = polygon.filter(ring => Math.abs(ringArea(ring)) > 0.05);
    if (rings.length) kept.push(rings);
  }
  return kept;
}

function unionPieces(pieces: Ring[]): Ring[] {
  return unionPolys(pieces).flat();
}

function differenceRings(fill: Ring[], bandPolys: Geom): Ring[] {
  if (!bandPolys.length) return fill;
  try {
    const geom = polygonClipping.difference(toGeom(fill) as never, bandPolys as never) as Geom;
    return geom.flat().filter(ring => Math.abs(ringArea(ring)) > 0.05);
  } catch {
    return fill;
  }
}

function ringArea(ring: Ring): number {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

function pointInRing(ring: Ring, p: Pt): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Even/odd containment count — 1 means the ring is a hole. */
function containmentParity(rings: Ring[], index: number): number {
  let count = 0;
  for (let i = 0; i < rings.length; i++) {
    if (i !== index && pointInRing(rings[i], rings[index][0])) count++;
  }
  return count;
}

// ── Spurious-contour cleanup (the published deep-point test) ──

/** Point well inside a closed ring: midpoint of the widest horizontal span. */
function deepPoint(ring: Ring): Pt | null {
  let minY = Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const height = maxY - minY;
  if (!(height > 0)) return null;
  let best: { span: number; p: Pt } | null = null;
  for (const f of [0.5, 0.3, 0.7]) {
    const y = minY + height * f;
    const xs: number[] = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      if ((a[1] <= y) !== (b[1] <= y)) {
        xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const span = xs[k + 1] - xs[k];
      if (!best || span > best.span) {
        best = { span, p: [(xs[k] + xs[k + 1]) / 2, y] };
      }
    }
  }
  return best ? best.p : null;
}

function distToPolys(polys: Pt[][], p: Pt): number {
  let best = Infinity;
  for (const poly of polys) {
    const count = poly.length; // closed ring: last→first edge included
    for (let i = 0; i < count; i++) {
      const a = poly[i], b = poly[(i + 1) % count];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy;
      const t = len2 < 1e-12 ? 0 : Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
      const qx = a[0] + t * dx - p[0], qy = a[1] + t * dy - p[1];
      const d = Math.hypot(qx, qy);
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * Drop contours that folded inside themselves: holes when growing, islands
 * when insetting, whenever a point deep inside lies closer than `d` to the
 * source. Marked contours take everything nested inside them with them.
 */
function cleanupSpurious(rings: Ring[], sourcePolys: Pt[][], d: number, inset: boolean): Ring[] {
  const isHole = rings.map((_, i) => containmentParity(rings, i) % 2 === 1);
  const marked = rings.map((ring, i) => {
    // Holes are the spurious ones when growing, outer islands when insetting.
    if (inset ? isHole[i] : !isHole[i]) return false;
    const dp = deepPoint(ring);
    return dp !== null && distToPolys(sourcePolys, dp) < d * (1 - 1e-4) - 1e-6;
  });
  if (!marked.some(Boolean)) return rings;
  return rings.filter((ring, i) => {
    if (marked[i]) return false;
    for (let j = 0; j < rings.length; j++) {
      if (j !== i && marked[j] && pointInRing(rings[j], ring[0])) return false;
    }
    return true;
  });
}

// ── Serialization ──

/**
 * Collapse sliver vertices a boolean union leaves behind: where a wedge
 * chord runs a hair (ε) from a quad's extended end edge, the result ring
 * takes a zero-width excursion that would feed the curve fit perpendicular
 * tangents and flatten round caps. Any vertex within `tol` of the chord
 * joining its kept neighbours goes; real geometry deviates more.
 */
function despikeRing(ring: Ring, tol: number): Ring {
  if (ring.length < 4) return ring;
  const out: Ring = [];
  for (let i = 0; i < ring.length; i++) {
    const a = out.length ? out[out.length - 1] : ring[ring.length - 1];
    const b = ring[i];
    const c = ring[(i + 1) % ring.length];
    const dx = c[0] - a[0], dy = c[1] - a[1];
    const len = Math.hypot(dx, dy);
    const dev = len < 1e-12
      ? Math.hypot(b[0] - a[0], b[1] - a[1])
      : Math.abs((b[0] - a[0]) * dy - (b[1] - a[1]) * dx) / len;
    if (dev > tol) out.push(b);
  }
  return out.length >= 3 ? out : ring;
}

function serializeRings(rings: Ring[], despTol = 0.05): string | null {
  const clean = rings
    .map(ring => {
      // Drop the duplicate closing point first: despike's wrap-around
      // neighbour is the previous vertex, not a copy of the first one.
      const c = ring.slice();
      if (c.length > 1) {
        const first = c[0], last = c[c.length - 1];
        if (Math.abs(first[0] - last[0]) < 1e-7 && Math.abs(first[1] - last[1]) < 1e-7) c.pop();
      }
      return despikeRing(c, despTol);
    })
    .filter(c => c.length >= 3);
  if (!clean.length) return null;
  // Non-zero-safe orientation: outers wind positive, their holes negative.
  const oriented = clean.map((ring, i) => {
    const positive = containmentParity(clean, i) % 2 === 0;
    return (ringArea(ring) > 0) === positive ? ring : ring.slice().reverse();
  });
  let d = "";
  for (const ring of oriented) {
    // Adaptive fidelity: a fixed tolerance chops small features (a 2px
    // round cap cannot survive the tolerance that suits a 200px ring).
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const girth = Math.min(maxX - minX, maxY - minY);
    const tol = Math.min(FIT.polygonTol, Math.max(0.02, girth * 0.02));
    const sp = fitPolyline(ring, true, { ...FIT, polygonTol: tol, fitTol: Math.min(FIT.fitTol, tol) });
    if (sp) d += subPathToD(sp);
  }
  return d || null;
}

// ── Public API ──

/**
 * Object → Path → Outline Stroke: the filled area painted by stroking `d`
 * with `width`. Overlaps come out united as one compound path.
 */
export function outlineStrokeD(d: string, width: number, opts: StrokeOpts = {}): string | null {
  const halfW = width / 2;
  if (!Number.isFinite(halfW) || halfW <= 0) return null;
  const subs = flattenSubpaths(d);
  if (!subs.length) return null;
  const pieces: Ring[] = [];
  for (const sub of subs) pieces.push(...strokePieces(sub.poly, sub.closed, halfW, opts));
  const rings = unionPieces(pieces);
  if (!rings.length) return null;
  return serializeRings(rings, Math.max(0.05, halfW * 0.01));
}

/**
 * Object → Path → Offset Path. Positive `delta` grows the filled area,
 * negative insets it. Closed subpaths are treated as a filled region; open
 * subpaths are outlined with a band of width 2|delta| when growing (and are
 * ignored when insetting, matching the reference semantics).
 */
export function offsetPathD(d: string, delta: number, opts: StrokeOpts = {}): string | null {
  if (!Number.isFinite(delta)) return null;
  const subs = flattenSubpaths(d);
  if (!subs.length) return null;
  const closedPolys = subs.filter(s => s.closed && s.poly.length >= 3).map(s => s.poly);
  const openSubs = subs.filter(s => !s.closed && s.poly.length >= 2);
  const ad = Math.abs(delta);
  const sourcePolys = subs.map(s => s.poly);

  let rings: Ring[];
  if (delta >= 0) {
    const pieces: Ring[] = [];
    for (const poly of closedPolys) pieces.push(poly);
    if (ad > 1e-9) {
      for (const poly of closedPolys) pieces.push(...strokePieces(poly, true, ad, { ...opts, cap: "butt" }));
      for (const sub of openSubs) pieces.push(...strokePieces(sub.poly, false, ad, { ...opts, cap: "butt" }));
    }
    rings = unionPieces(pieces);
  } else {
    if (!closedPolys.length || ad <= 1e-9) return null;
    const band: Ring[] = [];
    for (const poly of closedPolys) band.push(...strokePieces(poly, true, ad, { ...opts, cap: "butt" }));
    const bandPolys = unionPolys(band);
    if (!bandPolys.length) return null;
    const fill: Ring[] = [];
    for (const poly of closedPolys) fill.push(poly);
    rings = differenceRings(fill, bandPolys);
  }
  if (ad > 1e-9) rings = cleanupSpurious(rings, sourcePolys, ad, delta < 0);
  if (!rings.length) return null;
  return serializeRings(rings, Math.max(0.05, ad * 0.01));
}
