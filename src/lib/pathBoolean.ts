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

// ─── REQ-043 Fase 3: Buscatrazos extendido (10 ops estilo Illustrator) ───

/** Nombres de op alineados a Illustrator. Las formas de entrada van ordenadas
 * DE ATRÁS HACIA ADELANTE (orden de pintura del HTML): la última es la que
 * queda más al frente. Semántica sobre esa pila:
 *  - unite / intersect / exclude: operaciones clásicas; el resultado usa el
 *    relleno de la fuente más al frente que defina uno.
 *  - minusFront: la de ATRÁS menos todas las del frente; conserva el relleno
 *    de la de atrás.
 *  - minusBack: la del FRENTE menos todas las de atrás; conserva su relleno.
 *  - divide / merge: todos los átomos del arreglo (cada región atómica es una
 *    cara); cada cara hereda el relleno de su fuente más al frente.
 *  - trim: partes visibles de cada figura (la de atrás sobrevive donde nadie
 *    la tapa); cada pieza conserva el relleno de SU fuente.
 *  - crop: intersección de todas; relleno de la de ATRÁS (la de adelante
 *    actúa de máscara).
 *  - outline: contornos de cada átomo sin relleno (paths para trazar).
 */
export type PathfinderOp =
  | "unite" | "minusFront" | "intersect" | "exclude"
  | "divide" | "trim" | "merge" | "crop" | "outline" | "minusBack";

/** Figura de entrada: anillos aplanados (outer + agujeros) y su pintura. */
export interface PathfinderInput {
  rings: Ring[];
  fill?: string;
}

/** Una cara del resultado (outer + agujeros serializan a un solo path con
 * fill-rule: evenodd). `fill: "none"` = cara de contorno (op outline). */
export interface PathfinderFace {
  rings: Ring[];
  fill?: string;
}

/** Resultado multi-figura: divide/trim/merge/outline devuelven varias caras
 * para que el caller las pinte (un svg con un path por cara mantiene el undo
 * atómico). */
export interface PathfinderResult {
  shapes: PathfinderFace[];
}

type ClipKind = "union" | "difference" | "intersection" | "xor";

function clip(kind: ClipKind, a: Geom, b: Geom): Geom {
  try {
    switch (kind) {
      case "union": return polygonClipping.union(a as never, b as never) as Geom;
      case "difference": return polygonClipping.difference(a as never, b as never) as Geom;
      case "intersection": return polygonClipping.intersection(a as never, b as never) as Geom;
      case "xor": return polygonClipping.xor(a as never, b as never) as Geom;
    }
  } catch {
    // Los contactos tangenciales/degenerados tumban al sweep de Martinez:
    // degradar a geometría vacía en vez de romper la operación completa.
    return [];
  }
}

/** MultiPolygon → anillos planos descartando polígonos degenerados. */
function cleanGeom(g: Geom): Ring[] {
  return g
    .filter(poly => poly.some(ring => Math.abs(ringArea(ring)) > 0.5))
    .flat();
}

function geomOf(rings: Ring[]): Geom {
  // polygon-clipping MUTA los anillos de entrada (inserta vértices de
  // intersección in situ) — sin la copia, una op envenena a las siguientes
  // que reusen los mismos anillos (p. ej. el loop de ops del editor).
  return rings.map((ring): Ring[] => [ring.map((pt): Pt => [pt[0], pt[1]])]);
}

/** Unión en cadena de varias geometrías (tolera vacíos y fallos del clipper).
 * Los contactos tangenciales tumban al sweep de Martinez: el catch degrada a
 * geometría parcial en vez de romper la operación completa. */
function unionGeom(geoms: Geom[]): Geom {
  let acc: Geom | null = null;
  for (const g of geoms) {
    if (!g.length) continue;
    acc = acc && acc.length ? clip("union", acc, g) : g;
  }
  return acc || [];
}

/** Fold de un clip binario sobre toda la pila (unite/intersect/exclude/crop). */
function foldClip(kind: ClipKind, inputs: PathfinderInput[]): Ring[] {
  let acc: Geom | null = null;
  for (const input of inputs) {
    const g = geomOf(input.rings);
    acc = acc && acc.length ? clip(kind, acc, g) : g;
  }
  return acc ? cleanGeom(acc) : [];
}

/** Relleno de la fuente más al frente que defina uno. */
function frontFill(inputs: PathfinderInput[]): string | undefined {
  for (let i = inputs.length - 1; i >= 0; i--) {
    if (inputs[i].fill) return inputs[i].fill;
  }
  return undefined;
}

/** Átomos del arreglo: cada región atómica hereda el relleno de la fuente más
 * al frente que la cubre. Recursión por capa frontal — las caras previas se
 * parten en cubiertas (pintura del nuevo frente, que le gana a cualquiera de
 * abajo) y descubiertas (conservan su pintura), y se añade la parte exclusiva
 * del nuevo frente. Divide y merge comparten esta descomposición. */
function arrangementFaces(inputs: PathfinderInput[]): PathfinderFace[] {
  if (!inputs.length) return [];
  let faces: PathfinderFace[] = [{ rings: cleanGeom(geomOf(inputs[0].rings)), fill: inputs[0].fill }];
  for (let i = 1; i < inputs.length; i++) {
    const front = inputs[i];
    const fg = geomOf(front.rings);
    const next: PathfinderFace[] = [];
    for (const face of faces) {
      if (!face.rings.length) continue;
      const g = geomOf(face.rings);
      const covered = cleanGeom(clip("intersection", g, fg));
      const uncovered = cleanGeom(clip("difference", g, fg));
      if (covered.length) next.push({ rings: covered, fill: front.fill ?? face.fill });
      if (uncovered.length) next.push({ rings: uncovered, fill: face.fill });
    }
    const rest = unionGeom(inputs.slice(0, i).map(s => geomOf(s.rings)));
    const frontOnly = rest.length ? cleanGeom(clip("difference", fg, rest)) : cleanGeom(fg);
    if (frontOnly.length) next.push({ rings: frontOnly, fill: front.fill });
    faces = next;
  }
  return faces.filter(f => f.rings.length > 0);
}

/**
 * Buscatrazos extendido: las 10 ops de Illustrator sobre la pila ordenada de
 * atrás hacia adelante. Devuelve null cuando la op aniquila la geometría
 * (p. ej. minusFront de dos figuras idénticas). Las caras con agujeros se
 * serializan con ringsToPathD + fill-rule: evenodd.
 */
export function pathfinder(op: PathfinderOp, inputs: PathfinderInput[]): PathfinderResult | null {
  const usable = inputs.filter(s => s.rings && s.rings.length > 0);
  if (usable.length < 2) return null;

  let faces: PathfinderFace[] = [];
  switch (op) {
    case "unite":
    case "intersect":
    case "exclude": {
      const kind: ClipKind = op === "unite" ? "union" : op === "intersect" ? "intersection" : "xor";
      const rings = foldClip(kind, usable);
      if (rings.length) faces.push({ rings, fill: frontFill(usable) });
      break;
    }
    case "minusFront": {
      const front = unionGeom(usable.slice(1).map(s => geomOf(s.rings)));
      const rings = cleanGeom(clip("difference", geomOf(usable[0].rings), front));
      if (rings.length) faces.push({ rings, fill: usable[0].fill });
      break;
    }
    case "minusBack": {
      const last = usable[usable.length - 1];
      const back = unionGeom(usable.slice(0, -1).map(s => geomOf(s.rings)));
      const rings = cleanGeom(clip("difference", geomOf(last.rings), back));
      if (rings.length) faces.push({ rings, fill: last.fill });
      break;
    }
    case "divide":
    case "merge":
      faces = arrangementFaces(usable);
      break;
    case "trim": {
      for (let i = 0; i < usable.length; i++) {
        const g = geomOf(usable[i].rings);
        const front = unionGeom(usable.slice(i + 1).map(s => geomOf(s.rings)));
        const visible = front.length ? cleanGeom(clip("difference", g, front)) : cleanGeom(g);
        if (visible.length) faces.push({ rings: visible, fill: usable[i].fill });
      }
      break;
    }
    case "crop": {
      const rings = foldClip("intersection", usable);
      if (rings.length) faces.push({ rings, fill: usable[0].fill });
      break;
    }
    case "outline":
      faces = arrangementFaces(usable).map(f => ({ rings: f.rings, fill: "none" }));
      break;
  }

  return faces.length ? { shapes: faces } : null;
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
