/**
 * Create: Strokes — the parts of a colour layer no wider than the stroke
 * width, traced as stroked centre lines instead of filled outlines.
 *
 * Algorithms (public descriptions, reimplemented from scratch):
 * 1. Chamfer 3-4 distance transform: each pixel's distance to the nearest
 *    pixel outside the layer (3 per orthogonal, 4 per diagonal step).
 * 2. Line selection: an 8-connected component whose widest point (twice its
 *    largest distance, less one, in the chamfer metric) fits the stroke
 *    width is a line; wider ones stay filled areas.
 * 3. Skeletonization: Zhang–Suen thinning, applied pixel by pixel (both
 *    sub-iterations pick from the same state before removing), so topology
 *    is preserved and two-pixel-wide lines thin to one instead of vanishing.
 *    Staircase corners that connect nothing are dropped afterwards.
 * 4. Graph: runs of skeleton pixels between ends and junctions (junction
 *    pixels merged into one node) become polylines through pixel centres;
 *    rings without ends become closed lines. Short spurs left by thinning
 *    are pruned and runs meeting at a pass-through node are joined.
 * 5. Curves: each polyline is fitted like an outline (Douglas–Peucker +
 *    Schneider least squares); the stroke width is the line's mean width.
 */

import type { FitOptions, FitSubPath } from "./fit.ts";
import { fitPolyline } from "./fit.ts";

export interface Centerline {
  /** Fitted centre-line subpaths, in pixel coordinates. */
  subPaths: FitSubPath[];
  /** Stroke width in pixels (the line's mean width). */
  width: number;
  /** Pixel count of the component the line came from. */
  pixels: number;
}

/**
 * The centre lines of one colour label, plus which pixels they cover (to
 * leave out of the filled areas).
 */
export function centerlines(
  labels: Uint16Array,
  label: number,
  w: number,
  h: number,
  maxWidth: number,
  o: FitOptions,
): { thin: Uint8Array; lines: Centerline[] } {
  const thin = new Uint8Array(labels.length);
  const lines: Centerline[] = [];
  if (w === 0 || h === 0 || labels.length !== w * h) return { thin, lines };
  const mask = (i: number): boolean => labels[i] === label;
  const dt = chamferDistance(mask, w, h);
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!mask(start) || seen[start]) continue;
    const comp: number[] = [];
    seen[start] = 1;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop()!;
      comp.push(i);
      for (const j of neighbours8(i, w, h)) {
        if (mask(j) && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    let maxDt = 0;
    for (const i of comp) if (dt[i] > maxDt) maxDt = dt[i];
    const widest = (2 * maxDt) / 3 - 1;
    if (widest > maxWidth) continue;
    const line = traceLine(comp, w, maxWidth, o);
    if (!line) continue;
    for (const i of comp) thin[i] = 1;
    lines.push(line);
  }
  return { thin, lines };
}

/** The 8 neighbour indices of pixel i inside the w × h image. */
function* neighbours8(i: number, w: number, h: number): Generator<number> {
  const x = i % w;
  const y = (i / w) | 0;
  for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < w && ny < h) yield ny * w + nx;
  }
}

/** Chamfer 3-4 distance of each mask pixel to the nearest non-mask pixel. */
function chamferDistance(mask: (i: number) => boolean, w: number, h: number): Uint16Array {
  const d = new Uint16Array(w * h);
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (mask(i)) {
        d[i] = Math.min(
          at(x - 1, y) + 3,
          at(x - 1, y - 1) + 4,
          at(x, y - 1) + 3,
          at(x + 1, y - 1) + 4,
          0xffff,
        );
      }
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (mask(i)) {
        const v = Math.min(
          at(x + 1, y) + 3,
          at(x + 1, y + 1) + 4,
          at(x, y + 1) + 3,
          at(x - 1, y + 1) + 4,
          0xffff,
        );
        if (v < d[i]) d[i] = v;
      }
    }
  }
  return d;
}

/** A grid around one line component: its pixels plus a one-pixel empty border. */
class Grid {
  on: Uint8Array;
  w: number;
  h: number;
  x0: number;
  y0: number;

  constructor(comp: number[], w: number) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const i of comp) {
      const x = i % w;
      const y = (i / w) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    this.w = x1 - x0 + 3;
    this.h = y1 - y0 + 3;
    this.x0 = x0 - 1;
    this.y0 = y0 - 1;
    this.on = new Uint8Array(this.w * this.h);
    for (const i of comp) {
      this.on[(((i / w) | 0) - y0 + 1) * this.w + ((i % w) - x0 + 1)] = 1;
    }
  }

  /** The 8 neighbours (N, NE, E, SE, S, SW, W, NW) of an interior pixel. */
  ring(i: number): [boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean] {
    const w = this.w;
    const g = (j: number) => j >= 0 && j < this.on.length && this.on[j] === 1;
    return [g(i - w), g(i - w + 1), g(i + 1), g(i + w + 1), g(i + w), g(i + w - 1), g(i - 1), g(i - w - 1)];
  }

  *interior(): Generator<number> {
    for (let y = 1; y < this.h - 1; y++) {
      for (let x = 1; x < this.w - 1; x++) {
        yield y * this.w + x;
      }
    }
  }

  *onNeighbours(i: number): Generator<number> {
    const w = this.w;
    for (const j of [i - w, i - w + 1, i + 1, i + w + 1, i + w, i + w - 1, i - 1, i - w - 1]) {
      if (j >= 0 && j < this.on.length && this.on[j] === 1) yield j;
    }
  }

  degree(i: number): number {
    let n = 0;
    for (const _ of this.onNeighbours(i)) n++;
    return n;
  }

  /** Centre of pixel i in image coordinates. */
  centre(i: number): [number, number] {
    return [this.x0 + (i % this.w) + 0.5, this.y0 + ((i / this.w) | 0) + 0.5];
  }
}

/**
 * Zhang–Suen thinning. Each sub-iteration picks the pixels to remove from
 * the same state, so the skeleton stays centred; they are then removed one
 * by one, each only if it still doesn't disconnect anything, so a
 * two-pixel-wide line thins to one pixel instead of vanishing.
 */
function thin(g: Grid): void {
  const removable = (p: boolean[]): boolean => {
    let b = 0;
    for (const v of p) if (v) b++;
    let a = 0;
    for (let k = 0; k < 8; k++) {
      if (!p[k] && p[(k + 1) % 8]) a++;
    }
    return b >= 2 && b <= 6 && a === 1;
  };
  const picked: number[] = [];
  for (;;) {
    let changed = false;
    for (let step = 0; step < 2; step++) {
      picked.length = 0;
      for (const i of g.interior()) {
        if (!g.on[i]) continue;
        const p = g.ring(i);
        const [n, , e, , s, , w] = p;
        const side = step === 0 ? !(e && s && (n || w)) : !(n && w && (e || s));
        if (side && removable(p)) picked.push(i);
      }
      for (const i of picked) {
        if (removable(g.ring(i))) {
          g.on[i] = 0;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  // Staircase corners: a pixel whose neighbours stay connected without it
  // (Yokoi 8-connectivity number = 1) and that doesn't end the line.
  for (;;) {
    let changed = false;
    for (const i of g.interior()) {
      if (!g.on[i] || g.degree(i) < 2) continue;
      const p = g.ring(i);
      // x1 = E, x2 = NE, x3 = N, x4 = NW, x5 = W, x6 = SW, x7 = S, x8 = SE.
      const x = [p[2], p[1], p[0], p[7], p[6], p[5], p[4], p[3]];
      const off = (k: number) => !x[k % 8];
      let c8 = 0;
      for (const k of [0, 2, 4, 6]) {
        const trio = off(k) && off(k + 1) && off(k + 2);
        c8 += (off(k) ? 1 : 0) - (trio ? 1 : 0);
      }
      if (c8 === 1) {
        g.on[i] = 0;
        changed = true;
      }
    }
    if (!changed) break;
  }
}

interface Run {
  pts: Array<[number, number]>;
  ends: [number | null, number | null];
  closed: boolean;
}

function runLength(r: Run): number {
  let len = 0;
  for (let i = 1; i < r.pts.length; i++) len += Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]);
  if (r.closed && r.pts.length > 1) {
    len += Math.hypot(r.pts[0][0] - r.pts[r.pts.length - 1][0], r.pts[0][1] - r.pts[r.pts.length - 1][1]);
  }
  return len;
}

/** The centre lines of one line component (image pixel indices). */
function traceLine(comp: number[], w: number, maxWidth: number, o: FitOptions): Centerline | null {
  const g = new Grid(comp, w);
  thin(g);
  const skeleton: number[] = [];
  for (const i of g.interior()) if (g.on[i]) skeleton.push(i);
  if (skeleton.length < 2) return null;
  // Nodes: line ends, and junctions with the junction pixels touching them.
  const node = new Int32Array(g.on.length).fill(-1);
  const centres: Array<[number, number]> = [];
  for (const i of skeleton) {
    const d = g.degree(i);
    if (d === 2 || node[i] !== -1) continue;
    const id = centres.length;
    const members = [i];
    node[i] = id;
    if (d > 2) {
      let k = 0;
      while (k < members.length) {
        const p = members[k++];
        for (const q of g.onNeighbours(p)) {
          if (node[q] === -1 && g.degree(q) > 2) {
            node[q] = id;
            members.push(q);
          }
        }
      }
    }
    let sx = 0;
    let sy = 0;
    for (const m of members) {
      const c = g.centre(m);
      sx += c[0];
      sy += c[1];
    }
    centres.push([sx / members.length, sy / members.length]);
  }
  // Runs from each node, then the rings left.
  const used = new Set<string>();
  const edgeKey = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`;
  const runs: Run[] = [];
  for (const p of skeleton) {
    if (node[p] === -1) continue;
    for (const q of g.onNeighbours(p)) {
      if (node[q] === node[p] || used.has(edgeKey(p, q))) continue;
      used.add(edgeKey(p, q));
      const pts: Array<[number, number]> = [centres[node[p]], g.centre(q)];
      let prev = p;
      let cur = q;
      while (node[cur] === -1) {
        let next = -1;
        for (const n of g.onNeighbours(cur)) {
          if (n !== prev && !used.has(edgeKey(cur, n))) {
            next = n;
            break;
          }
        }
        if (next === -1) break;
        used.add(edgeKey(cur, next));
        pts.push(g.centre(next));
        prev = cur;
        cur = next;
      }
      const end = node[cur] !== -1 ? node[cur] : null;
      if (end !== null) pts[pts.length - 1] = centres[end];
      runs.push({ pts, ends: [node[p], end], closed: false });
    }
  }
  for (const s of skeleton) {
    if (node[s] !== -1) continue;
    let touchesUsed = false;
    for (const n of g.onNeighbours(s)) {
      if (used.has(edgeKey(s, n))) {
        touchesUsed = true;
        break;
      }
    }
    if (touchesUsed) continue;
    const pts: Array<[number, number]> = [g.centre(s)];
    let prev = -1;
    let cur = s;
    let closed = false;
    for (;;) {
      let next = -1;
      for (const n of g.onNeighbours(cur)) {
        if (n !== prev && !used.has(edgeKey(cur, n))) {
          next = n;
          break;
        }
      }
      if (next === -1) break;
      used.add(edgeKey(cur, next));
      if (next === s) {
        closed = true;
        break;
      }
      pts.push(g.centre(next));
      prev = cur;
      cur = next;
    }
    runs.push({ pts, ends: [null, null], closed });
  }
  // Mean width: pixels over length (the skeleton stops about half a width
  // short of each end, so the length grows by that in the quadratic).
  const widthOf = (rs: Run[]): number => {
    let length = 0;
    for (const r of rs) length += runLength(r);
    const px = comp.length;
    return Math.min(Math.max((-length + Math.sqrt(length * length + 4 * px)) / 2, 1), Math.max(maxWidth, 1));
  };
  const spur = widthOf(runs);
  const finalRuns = joinRuns(pruneRuns(runs, centres.length, spur), centres.length);
  const width = widthOf(finalRuns);
  const subPaths: FitSubPath[] = [];
  for (const r of finalRuns) {
    const sp = fitPolyline(r.pts, r.closed, o);
    if (sp) subPaths.push(sp);
  }
  if (subPaths.length === 0) return null;
  return { subPaths, width, pixels: comp.length };
}

/** Drop spurs shorter than the line's width that hang off a junction. */
function pruneRuns(runs: Run[], nodes: number, width: number): Run[] {
  const degree = new Array<number>(nodes).fill(0);
  for (const r of runs) {
    if (r.ends[0] !== null) degree[r.ends[0]]++;
    if (r.ends[1] !== null) degree[r.ends[1]]++;
  }
  const order = runs.map((_, i) => i).sort((a, b) => runLength(runs[a]) - runLength(runs[b]));
  const keep = new Array<boolean>(runs.length).fill(true);
  for (const i of order) {
    const r = runs[i];
    const [a, b] = r.ends;
    if (a === null || b === null) continue;
    const tip = degree[a] === 1 ? a : b;
    const fork = tip === a ? b : a;
    if (degree[tip] === 1 && degree[fork] >= 3 && runLength(r) < Math.max(width, 2)) {
      keep[i] = false;
      degree[tip]--;
      degree[fork]--;
    }
  }
  return runs.filter((_, i) => keep[i]);
}

/** Join runs through every node where exactly two of them meet. */
function joinRuns(runs: Run[], nodes: number): Run[] {
  const alive: Array<Run | null> = runs.slice();
  for (let n = 0; n < nodes; n++) {
    const at: Array<[number, number]> = [];
    for (let i = 0; i < alive.length; i++) {
      const r = alive[i];
      if (!r) continue;
      if (r.ends[0] === n) at.push([i, 0]);
      if (r.ends[1] === n) at.push([i, 1]);
    }
    if (at.length !== 2) continue;
    const [i, ki] = at[0];
    const [j, kj] = at[1];
    const a = alive[i];
    const b = alive[j];
    if (!a || !b) continue;
    if (i === j) {
      a.pts.pop();
      a.ends = [null, null];
      a.closed = a.pts.length >= 3;
      continue;
    }
    if (ki === 0) {
      a.pts.reverse();
      a.ends = [a.ends[1], a.ends[0]];
    }
    if (kj === 1) {
      b.pts.reverse();
      b.ends = [b.ends[1], b.ends[0]];
    }
    a.pts = a.pts.concat(b.pts.slice(1));
    a.ends = [a.ends[0], b.ends[1]];
    alive[i] = a;
    alive[j] = null;
  }
  return alive.filter((r): r is Run => r !== null);
}
