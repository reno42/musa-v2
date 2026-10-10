/**
 * Boundary following on the pixel-crack grid (the "Moore/crack following"
 * family of contour tracers, reimplemented from its published description).
 *
 * Vertices are pixel corners (x, y) with 0 ≤ x ≤ w, 0 ≤ y ≤ h. Every edge
 * between an inside and an outside pixel becomes a directed edge walked with
 * the inside pixel on its right (y down), so outer boundaries come out
 * clockwise and holes counter-clockwise — the result fills correctly with
 * either fill rule. At a saddle (two inside pixels touching only diagonally)
 * the walk turns right, which keeps diagonal neighbours apart: the same
 * 4-connectivity the component labeling uses.
 */

/** A closed boundary loop of pixel-corner vertices. */
export interface CrackLoop {
  /** Corner vertices in order (the loop closes back to the first). */
  pts: Array<[number, number]>;
  /** Twice the signed area (positive = outer boundary, negative = hole). */
  area2: number;
}

/** One 4-connected component of the mask: its outer loop and holes. */
export interface MaskComponent {
  outer: CrackLoop;
  holes: CrackLoop[];
  /** Inside pixel count. */
  pixels: number;
}

const R = 1;
const D = 2;
const L = 4;
const U = 8;

function rightOf(d: number): number {
  return d === R ? D : d === D ? L : d === L ? U : R;
}

function step(d: number): [number, number] {
  return d === R ? [1, 0] : d === D ? [0, 1] : d === L ? [-1, 0] : [0, -1];
}

const OUTSIDE = 0xffffffff;

/** 4-connected component labels (0xffffffff outside) and per-component pixel counts. */
function labelComponents(mask: Uint8Array, w: number, h: number): { comp: Uint32Array; sizes: number[] } {
  const comp = new Uint32Array(w * h).fill(OUTSIDE);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || comp[s] !== OUTSIDE) continue;
    const id = sizes.length;
    let n = 0;
    comp[s] = id;
    stack.push(s);
    while (stack.length > 0) {
      const i = stack.pop()!;
      n++;
      const x = i % w;
      const y = (i / w) | 0;
      const go = (j: number) => {
        if (mask[j] && comp[j] === OUTSIDE) {
          comp[j] = id;
          stack.push(j);
        }
      };
      if (x > 0) go(i - 1);
      if (x + 1 < w) go(i + 1);
      if (y > 0) go(i - w);
      if (y + 1 < h) go(i + w);
    }
    sizes.push(n);
  }
  return { comp, sizes };
}

/** Trace every 4-connected component of `mask` (row-major, w × h). */
export function traceMask(mask: Uint8Array, w: number, h: number): MaskComponent[] {
  if (mask.length !== w * h || w === 0 || h === 0) return [];
  const { comp, sizes } = labelComponents(mask, w, h);
  const vw = w + 1;
  const dirs = new Uint8Array(vw * (h + 1));
  const inside = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] !== 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (!inside(x, y - 1)) dirs[y * vw + x] |= R;
      if (!inside(x + 1, y)) dirs[y * vw + x + 1] |= D;
      if (!inside(x, y + 1)) dirs[(y + 1) * vw + x + 1] |= L;
      if (!inside(x - 1, y)) dirs[(y + 1) * vw + x] |= U;
    }
  }
  const outers: Array<CrackLoop | null> = new Array(sizes.length).fill(null);
  const holes: CrackLoop[][] = sizes.map(() => []);
  for (let start = 0; start < dirs.length; start++) {
    // Every loop has an R edge (the top edge of some inside pixel); starting
    // there makes the loop close exactly (right-turn rule at the start too).
    while ((dirs[start] & R) !== 0) {
      const sx = start % vw;
      const sy = (start / vw) | 0;
      const owner = comp[sy * w + sx];
      dirs[start] &= ~R;
      const pts: Array<[number, number]> = [[sx, sy]];
      let x = sx + 1;
      let y = sy;
      let d = R;
      let area2 = 0;
      let px = sx;
      let py = sy;
      for (;;) {
        area2 += px * y - x * py;
        px = x;
        py = y;
        const v = y * vw + x;
        const atStart = x === sx && y === sy;
        let cand = dirs[v];
        if (atStart) cand |= R;
        let next: number;
        if (cand === R || cand === D || cand === L || cand === U) {
          next = cand;
        } else if ((cand & rightOf(d)) !== 0) {
          next = rightOf(d);
        } else if ((cand & d) !== 0) {
          next = d;
        } else {
          next = rightOf(rightOf(rightOf(d)));
        }
        if (atStart && next === R) break;
        if (next === 0 || (dirs[v] & next) === 0) break;
        dirs[v] &= ~next;
        // Keep only turn vertices — straight runs collapse to their ends.
        if (next !== d) pts.push([x, y]);
        const [dx, dy] = step(next);
        x += dx;
        y += dy;
        d = next;
      }
      if (owner === OUTSIDE) continue;
      const loop: CrackLoop = { pts, area2 };
      if (loop.area2 > 0) {
        outers[owner] = loop;
      } else {
        holes[owner].push(loop);
      }
    }
  }
  const out: MaskComponent[] = [];
  for (let i = 0; i < outers.length; i++) {
    const outer = outers[i];
    if (outer) out.push({ outer, holes: holes[i], pixels: sizes[i] });
  }
  return out;
}
