/**
 * Pathfinder (buscatrazos) — union / subtract / intersect / exclude across
 * two or more shape paths (F1 header action).
 *
 * Curves are flattened to dense polygons, combined with the Martinez-style
 * polygon clipper, and the result rings serialize back to an SVG path (all
 * rings as subpaths — pair the result with fill-rule: evenodd so holes read
 * correctly).
 */
import polygonClipping from "polygon-clipping";
import { parsePathData, type PathPoint } from "./pathData.ts";

export type BooleanOpName = "union" | "subtract" | "intersect" | "exclude";

type Pt = [number, number];
type Ring = Pt[];
/** polygon-clipping geometry: MultiPolygon = Polygon[] = Ring[] */
type Geom = Ring[][];

const round = (n: number) => Math.round(n * 100) / 100;

function cubicAt(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ];
}

/** Flatten a path `d` into one closed polygon ring. Handles are sampled at
 * `perCurve` points per segment; straight segments contribute endpoints only. */
export function sampleShapeRing(d: string, perCurve = 24): Ring | null {
  let points: PathPoint[];
  try {
    points = parsePathData(d);
  } catch {
    return null;
  }
  if (points.length < 2) return null;

  const ring: Ring = [];
  const push = (p: Pt) => {
    const last = ring[ring.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > 0.01 || Math.abs(last[1] - p[1]) > 0.01) {
      ring.push([round(p[0]), round(p[1])]);
    }
  };

  // The first point (the move-to) anchors the ring — the loop below only
  // pushes segment ENDPOINTS, so without this the start vertex is lost.
  push([points[0].x, points[0].y]);

  for (let i = 0; i < points.length - 1; i++) {
    const prev = points[i];
    const next = points[i + 1];
    const start: Pt = [prev.x, prev.y];
    const end: Pt = [next.x, next.y];
    if (prev.cpOut || next.cpIn) {
      const c1: Pt = prev.cpOut ? [prev.cpOut.x, prev.cpOut.y] : start;
      const c2: Pt = next.cpIn ? [next.cpIn.x, next.cpIn.y] : end;
      for (let s = 1; s <= perCurve; s++) push(cubicAt(start, c1, c2, end, s / perCurve));
    } else {
      push(end);
    }
  }

  // A ring needs at least 3 distinct points to enclose area.
  return ring.length >= 3 ? ring : null;
}

function ringArea(ring: Ring): number {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

/**
 * Combine already-flattened rings (each entry = one shape, in the SAME
 * coordinate space) with the named boolean op. Returns the resulting rings
 * (outers + holes) or null when the op annihilates the geometry.
 */
export function booleanShapeOp(op: BooleanOpName, shapes: Ring[][]): Ring[] | null {
  const usable = shapes.filter(rings => rings && rings.length > 0);
  if (usable.length < 2) return null;

  // polygon-clipping consumes MultiPolygon geometries; each shape is a
  // polygon whose single ring is its outline (evenodd semantics make the
  // holes of the SOURCE shapes come out right as well).
  const toGeom = (rings: Ring[]): Geom => rings.map(ring => [ring]);
  const run = (a: Geom, b: Geom): Geom => {
    try {
      switch (op) {
        case "union": return polygonClipping.union(a as never, b as never) as Geom;
        case "subtract": return polygonClipping.difference(a as never, b as never) as Geom;
        case "intersect": return polygonClipping.intersection(a as never, b as never) as Geom;
        case "exclude": return polygonClipping.xor(a as never, b as never) as Geom;
      }
    } catch {
      return [];
    }
  };

  let acc = toGeom(usable[0]);
  for (let i = 1; i < usable.length; i++) {
    acc = run(acc, toGeom(usable[i]));
    if (!acc.length) return null;
  }

  const rings = acc.flat();
  // Drop degenerate slivers the clipper can emit.
  return rings.filter(ring => Math.abs(ringArea(ring)) > 0.5);
}

/** Serialize result rings to a path `d` (M/L/Z per ring, 2-decimal coords).
 *  The clipper returns rings CLOSED (last point = first) — drop the duplicate. */
export function ringsToPathD(rings: Ring[]): string {
  return rings.map(ring => {
    const pts = ring.slice();
    if (pts.length > 1) {
      const first = pts[0], last = pts[pts.length - 1];
      if (Math.abs(first[0] - last[0]) < 0.01 && Math.abs(first[1] - last[1]) < 0.01) pts.pop();
    }
    if (!pts.length) return "";
    const body = pts.map(p => `L${p[0]} ${p[1]}`).join("");
    return `M${pts[0][0]} ${pts[0][1]}${body}Z`;
  }).filter(Boolean).join(" ");
}

/** Bounding box of all rings — [minX, minY, maxX, maxY]. */
export function ringsBounds(rings: Ring[]): [number, number, number, number] | null {
  if (!rings.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}
