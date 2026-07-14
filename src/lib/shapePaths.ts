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

/**
 * Serialize a closed vertex loop to a path, optionally rounding every corner.
 * Rounding trims each edge by the radius (clamped to half the shorter edge)
 * and bridges the gap with a quadratic curve through the original vertex.
 */
export function verticesToPath(vertices: ShapeVertex[], cornerRadius = 0): string {
  if (vertices.length < 3) return "";
  const rounded = (value: number) => Math.round(value * 100) / 100;
  if (cornerRadius <= 0) {
    return `M${vertices.map(v => `${rounded(v.x)},${rounded(v.y)}`).join(" L")} Z`;
  }

  const count = vertices.length;
  const commands: string[] = [];
  for (let index = 0; index < count; index++) {
    const previous = vertices[(index - 1 + count) % count];
    const vertex = vertices[index];
    const next = vertices[(index + 1) % count];
    const inLength = Math.hypot(vertex.x - previous.x, vertex.y - previous.y);
    const outLength = Math.hypot(next.x - vertex.x, next.y - vertex.y);
    const trim = Math.min(cornerRadius, inLength / 2, outLength / 2);
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

export function generatePolygonPath(size: number, sides: number, cornerRadius = 0): string {
  return verticesToPath(polygonVertices(size, sides), cornerRadius);
}

export function generateStarPath(size: number, points: number, ratio: number, cornerRadius = 0): string {
  return verticesToPath(starVertices(size, points, ratio), cornerRadius);
}
