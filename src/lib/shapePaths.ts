/**
 * Parametric shape path generation — stars and regular polygons with
 * adjustable point count, star ratio, and rounded corners.
 * All paths are generated inside a square [0, size] viewBox.
 */

export interface ShapeVertex {
  x: number;
  y: number;
}

export const MIN_SHAPE_SIDES = 3;
export const MAX_SHAPE_SIDES = 60;

export function clampShapeCount(value: number): number {
  return Math.min(MAX_SHAPE_SIDES, Math.max(MIN_SHAPE_SIDES, Math.round(value) || MIN_SHAPE_SIDES));
}

/** Vertices of a regular polygon, first point at 12 o'clock. */
export function polygonVertices(size: number, sides: number): ShapeVertex[] {
  const n = clampShapeCount(sides);
  const half = size / 2;
  const radius = half * 0.92;
  return Array.from({ length: n }, (_, index) => {
    const angle = -Math.PI / 2 + (2 * Math.PI / n) * index;
    return { x: half + radius * Math.cos(angle), y: half + radius * Math.sin(angle) };
  });
}

/** Vertices of a star: alternating outer/inner points, first spike at 12 o'clock. */
export function starVertices(size: number, points: number, ratio: number): ShapeVertex[] {
  const n = clampShapeCount(points);
  const half = size / 2;
  const outer = half * 0.95;
  const inner = outer * Math.min(0.99, Math.max(0.01, ratio));
  return Array.from({ length: n * 2 }, (_, index) => {
    const angle = -Math.PI / 2 + (Math.PI / n) * index;
    const radius = index % 2 === 0 ? outer : inner;
    return { x: half + radius * Math.cos(angle), y: half + radius * Math.sin(angle) };
  });
}

/** One radius per vertex, or a single uniform radius for the whole shape. */
export type CornerRadii = number | number[];

/** Pad/truncate a radius list to the vertex count (missing → 0 = sharp). */
export function normalizeRadii(radii: CornerRadii, count: number): number[] {
  if (!Array.isArray(radii)) return new Array(count).fill(Math.max(0, radii || 0));
  return Array.from({ length: count }, (_, index) => Math.max(0, radii[index] || 0));
}

/**
 * Serialize a closed vertex loop to a path, optionally rounding corners.
 * Rounding trims each edge by the radius (clamped to half the shorter edge)
 * and bridges the gap with a quadratic curve through the original vertex.
 * A per-vertex array rounds only the vertices whose radius is > 0.
 */
export function verticesToPath(vertices: ShapeVertex[], cornerRadius: CornerRadii = 0): string {
  if (vertices.length < 3) return "";
  const rounded = (value: number) => Math.round(value * 100) / 100;
  const radii = normalizeRadii(cornerRadius, vertices.length);
  if (radii.every(radius => radius <= 0)) {
    return `M${vertices.map(v => `${rounded(v.x)},${rounded(v.y)}`).join(" L")} Z`;
  }

  const count = vertices.length;
  const commands: string[] = [];
  for (let index = 0; index < count; index++) {
    const cornerRadiusAtIndex = radii[index];
    const previous = vertices[(index - 1 + count) % count];
    const vertex = vertices[index];
    const next = vertices[(index + 1) % count];
    if (cornerRadiusAtIndex <= 0) {
      // Sharp vertex: a single line through the corner itself.
      commands.push(index === 0 ? `M${rounded(vertex.x)},${rounded(vertex.y)}` : `L${rounded(vertex.x)},${rounded(vertex.y)}`);
      continue;
    }
    const inLength = Math.hypot(vertex.x - previous.x, vertex.y - previous.y);
    const outLength = Math.hypot(next.x - vertex.x, next.y - vertex.y);
    const trim = Math.min(cornerRadiusAtIndex, inLength / 2, outLength / 2);
    const entry = {
      x: vertex.x - ((vertex.x - previous.x) / (inLength || 1)) * trim,
      y: vertex.y - ((vertex.y - previous.y) / (inLength || 1)) * trim,
    };
    const exit = {
      x: vertex.x + ((next.x - vertex.x) / (outLength || 1)) * trim,
      y: vertex.y + ((next.y - vertex.y) / (outLength || 1)) * trim,
    };
    commands.push(index === 0 ? `M${rounded(entry.x)},${rounded(entry.y)}` : `L${rounded(entry.x)},${rounded(entry.y)}`);
    commands.push(`Q${rounded(vertex.x)},${rounded(vertex.y)} ${rounded(exit.x)},${rounded(exit.y)}`);
  }
  return `${commands.join(" ")} Z`;
}

export function generatePolygonPath(size: number, sides: number, cornerRadius: CornerRadii = 0): string {
  return verticesToPath(polygonVertices(size, sides), cornerRadius);
}

export function generateStarPath(size: number, points: number, ratio: number, cornerRadius: CornerRadii = 0): string {
  return verticesToPath(starVertices(size, points, ratio), cornerRadius);
}

// ── Per-vertex radius persistence (data-vr on the shape's layer element) ──

/** Serialize per-vertex radii for the data-vr attribute ("0,8,0,12"). */
export function serializeVertexRadiiAttr(radii: number[]): string {
  return radii.map(radius => Math.round(radius * 10) / 10).join(",");
}

/**
 * Effective radius of every vertex: the per-vertex override (data-vr) when
 * present, otherwise the uniform data-shape-corner-radius. Always matches
 * the vertex count so callers can zip radii with corners safely.
 */
export function parseVertexRadiiAttr(raw: string | null | undefined, uniform: number, count: number): number[] {
  if (!raw) return new Array(count).fill(Math.max(0, uniform || 0));
  const overrides = raw.split(",").map(value => Math.max(0, Number(value.trim()) || 0));
  return Array.from({ length: count }, (_, index) => overrides[index] ?? Math.max(0, uniform || 0));
}

// ── Corner recovery: vertices back out of a serialized path ──

export interface ShapeSource {
  kind: "star" | "polygon";
  count: number;
  ratio: number;
  size: number;
}

/**
 * Base vertices for a parametric shape (star/polygon). Returns null when the
 * shape carries custom vertex edits — its geometry must then be recovered
 * from the path itself via cornersFromShapePath.
 */
export function parametricVertices(source: ShapeSource): ShapeVertex[] {
  return source.kind === "star"
    ? starVertices(source.size, source.count, source.ratio)
    : polygonVertices(source.size, source.count);
}

interface PathToken {
  command: "M" | "L" | "Q";
  points: ShapeVertex[];
}

/** Tokenize the restricted M/L/Q/Z grammar this module produces; null otherwise. */
function tokenizeShapePath(d: string): PathToken[] | null {
  const tokens: PathToken[] = [];
  const regex = /([MLQZ])\s*((?:-?\d+(?:\.\d+)?(?:[\s,]+-?\d+(?:\.\d+)?)?[\s,]*)*)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(d)) !== null) {
    const command = match[1].toUpperCase();
    if (command === "Z") continue;
    const numbers = (match[2].match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    if (command === "M" || command === "L") {
      if (numbers.length < 2) return null;
      tokens.push({ command: "L", points: [{ x: numbers[0], y: numbers[1] }] });
      if (command === "M" && tokens.length === 1) tokens[0].command = "M";
    } else {
      if (numbers.length < 4) return null;
      tokens.push({ command: "Q", points: [{ x: numbers[0], y: numbers[1] }, { x: numbers[2], y: numbers[3] }] });
    }
  }
  // Every coordinate must have been consumed — leftover text means curves/arcs.
  const stripped = d.replace(regex, "").replace(/[\s,]/g, "");
  return stripped.length === 0 && tokens.length >= 3 ? tokens : null;
}

/**
 * Recover the corner vertices of a shape path produced by verticesToPath —
 * both the sharp form (M/L chain) and the rounded form (each rounded vertex
 * emits an entry L followed by a Q whose control IS the original corner).
 * Returns null for paths with cubic/arc commands (pen curves) — those are
 * edited through the anchor model instead.
 */
export function cornersFromShapePath(d: string): ShapeVertex[] | null {
  const tokens = tokenizeShapePath(d);
  if (!tokens || tokens[0]?.command !== "M") return null;
  const corners: ShapeVertex[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.command === "Q") continue; // handled by the L that opened the vertex
    if (token.command === "M" && index > 0) return null;
    const next = tokens[index + 1];
    if (next?.command === "Q") {
      corners.push(next.points[0]); // quadratic control = original corner
    } else {
      corners.push(token.points[0]); // sharp vertex: the point IS the corner
    }
  }
  return corners.length >= 3 ? corners : null;
}
