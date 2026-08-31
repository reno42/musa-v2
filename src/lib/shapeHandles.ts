/**
 * Pure hit-testing and radius helpers for the shape editing system
 * (corner-radius handles + vertex network). Framework-free so the drag
 * logic in DesignFrame stays unit-testable.
 *
 * Corner order is fixed as topLeft, topRight, bottomLeft, bottomRight
 * (indexes 0-3), matching the bounding-box convention of the spec.
 */

export interface CornerHandle {
  x: number;
  y: number;
}

/** The 4 corners of a bounding box in TL/TR/BL/BR order. */
export function bboxCorners(x: number, y: number, width: number, height: number): CornerHandle[] {
  return [
    { x, y },                       // 0 — top-left
    { x: x + width, y },            // 1 — top-right
    { x, y: y + height },           // 2 — bottom-left
    { x: x + width, y: y + height }, // 3 — bottom-right
  ];
}

/**
 * Boolean hit test against a handle center. Default hit radius is 12px
 * (24px diameter) so small 6px visuals still meet touch/pointer targets.
 */
export function hitTestHandle(
  mouseX: number,
  mouseY: number,
  cornerX: number,
  cornerY: number,
  hitRadius = 12,
): boolean {
  return Math.hypot(mouseX - cornerX, mouseY - cornerY) < hitRadius;
}

/**
 * Index (0-3, TL/TR/BL/BR) of the corner handle under the mouse, or null
 * when the cursor is outside every handle's hit radius.
 */
export function getHandleAt(
  mouseX: number,
  mouseY: number,
  corners: readonly CornerHandle[],
  hitRadius = 12,
): number | null {
  let best: number | null = null;
  let bestDistance = hitRadius;
  for (let index = 0; index < corners.length; index++) {
    const corner = corners[index];
    const distance = Math.hypot(mouseX - corner.x, mouseY - corner.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

/**
 * Index of the vertex nearest to the cursor within the threshold
 * (default 8px), or null. Screen-space coordinates.
 */
export function getVertexAt(
  mouseX: number,
  mouseY: number,
  points: readonly { x: number; y: number }[],
  threshold = 8,
): number | null {
  let best: number | null = null;
  let bestDistance = threshold;
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    const distance = Math.hypot(mouseX - point.x, mouseY - point.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

export interface SegmentHit {
  /** Index of the segment's start vertex — the new vertex inserts after it. */
  startIndex: number;
  /** Closest point on the segment (projection), same space as the input. */
  x: number;
  y: number;
}

/**
 * The segment (straight line between consecutive vertices) nearest to the
 * cursor within the threshold (default 8px), or null. Screen-space. When
 * closed, the last vertex connects back to the first; open paths only test
 * their real segments. Zero-length segments fall back to their point.
 */
export function getSegmentAt(
  mouseX: number,
  mouseY: number,
  points: readonly { x: number; y: number }[],
  closed: boolean,
  threshold = 8,
): SegmentHit | null {
  const count = points.length;
  const segments = closed ? count : Math.max(0, count - 1);
  let best: SegmentHit | null = null;
  let bestDistance = threshold;
  for (let startIndex = 0; startIndex < segments; startIndex++) {
    const a = points[startIndex];
    const b = points[(startIndex + 1) % count];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    let projectedX: number;
    let projectedY: number;
    if (lengthSq === 0) {
      projectedX = a.x;
      projectedY = a.y;
    } else {
      const t = ((mouseX - a.x) * dx + (mouseY - a.y) * dy) / lengthSq;
      const clamped = Math.min(1, Math.max(0, t));
      projectedX = a.x + clamped * dx;
      projectedY = a.y + clamped * dy;
    }
    const distance = Math.hypot(mouseX - projectedX, mouseY - projectedY);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { startIndex, x: projectedX, y: projectedY };
    }
  }
  return best;
}

/**
 * Immutable radius update. With index === null every corner takes the new
 * value (uniform); with an index only that corner changes and the others
 * keep their current radius. Values are clamped to >= 0.
 */
export function updateCornerRadius(radii: readonly number[], index: number | null, value: number): number[] {
  const next = Math.max(0, value);
  if (index === null) return radii.map(() => next);
  return radii.map((radius, position) => (position === index ? next : radius));
}

/** Resolve a radius from a horizontal drag: left decreases, right increases. */
export function radiusFromHorizontalDrag(
  baseRadius: number,
  horizontalDelta: number,
  maxRadius: number,
  scale = 1,
): number {
  return Math.max(0, Math.min(maxRadius, baseRadius + horizontalDelta * scale));
}
