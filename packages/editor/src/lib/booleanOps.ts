// ─── Boolean Operations Engine ───────────────────────────────────
// Pure canvas-based boolean operations for Fabric.js shapes.
// Renders shapes to a temporary canvas using composite operations,
// then traces the contour to produce an SVG path.

import type { BooleanOperation } from "@futuraria/shared";

interface Point {
  x: number;
  y: number;
}

/**
 * Convert a Fabric.js object to a polygon (array of points).
 * Supports rect, ellipse, polygon, polyline, path (approximated).
 */
export function objectToPolygon(obj: any, canvas: any): Point[] {
  const type = obj.type;
  const left = obj.left || 0;
  const top = obj.top || 0;
  const w = (obj.width || 0) * (obj.scaleX || 1);
  const h = (obj.height || 0) * (obj.scaleY || 1);
  const angle = (obj.angle || 0) * (Math.PI / 180);
  const cx = left + w / 2;
  const cy = top + h / 2;

  let points: Point[] = [];

  if (type === "rect") {
    const rx = obj.rx || 0;
    const ry = obj.ry || 0;
    if (rx > 0 || ry > 0) {
      // Rounded rect — approximate with many points
      points = roundedRectPoints(left, top, w, h, rx * (obj.scaleX || 1), ry * (obj.scaleY || 1), 16);
    } else {
      points = [
        { x: left, y: top },
        { x: left + w, y: top },
        { x: left + w, y: top + h },
        { x: left, y: top + h },
      ];
    }
  } else if (type === "ellipse") {
    const rx = (obj.rx || w / 2) * (obj.scaleX || 1);
    const ry = (obj.ry || h / 2) * (obj.scaleY || 1);
    const cx2 = left + (obj.rx || w / 2) * (obj.scaleX || 1);
    const cy2 = top + (obj.ry || h / 2) * (obj.scaleY || 1);
    const segments = 64;
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      points.push({ x: cx2 + Math.cos(a) * rx, y: cy2 + Math.sin(a) * ry });
    }
  } else if (type === "circle") {
    const r = (obj.radius || 0) * (obj.scaleX || 1);
    const segments = 64;
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      points.push({ x: left + Math.cos(a) * r, y: top + Math.sin(a) * r });
    }
  } else if (type === "triangle") {
    points = [
      { x: left + w / 2, y: top },
      { x: left + w, y: top + h },
      { x: left, y: top + h },
    ];
  } else if (type === "polygon" && obj.points) {
    const matrix = obj.calcTransformMatrix();
    for (const p of obj.points) {
      const px = p.x - (obj.pathOffset?.x || 0);
      const py = p.y - (obj.pathOffset?.y || 0);
      points.push({
        x: matrix[0] * px + matrix[2] * py + matrix[4],
        y: matrix[1] * px + matrix[3] * py + matrix[5],
      });
    }
  } else if (type === "path" && obj.path) {
    // Approximate path with sampled points
    points = approximatePath(obj);
  } else if (type === "group") {
    // For groups, combine all children polygons
    const children = obj.getObjects ? obj.getObjects() : [];
    const allPoints: Point[] = [];
    for (const child of children) {
      const childPoly = objectToPolygon(child, canvas);
      allPoints.push(...childPoly);
    }
    if (allPoints.length > 0) return convexHull(allPoints);
    return [];
  } else {
    // Fallback: use bounding box
    points = [
      { x: left, y: top },
      { x: left + w, y: top },
      { x: left + w, y: top + h },
      { x: left, y: top + h },
    ];
  }

  // Apply rotation around center
  if (Math.abs(angle) > 0.001) {
    points = points.map(p => rotatePoint(p, cx, cy, angle));
  }

  return points;
}

function roundedRectPoints(
  x: number, y: number, w: number, h: number,
  rx: number, ry: number, segments: number
): Point[] {
  const points: Point[] = [];
  // Top-right corner
  for (let i = 0; i <= segments; i++) {
    const a = -Math.PI / 2 + (Math.PI / 2) * (i / segments);
    points.push({ x: x + w - rx + Math.cos(a) * rx, y: y + ry + Math.sin(a) * ry });
  }
  // Bottom-right corner
  for (let i = 0; i <= segments; i++) {
    const a = 0 + (Math.PI / 2) * (i / segments);
    points.push({ x: x + w - rx + Math.cos(a) * rx, y: y + h - ry + Math.sin(a) * ry });
  }
  // Bottom-left corner
  for (let i = 0; i <= segments; i++) {
    const a = Math.PI / 2 + (Math.PI / 2) * (i / segments);
    points.push({ x: x + rx + Math.cos(a) * rx, y: y + h - ry + Math.sin(a) * ry });
  }
  // Top-left corner
  for (let i = 0; i <= segments; i++) {
    const a = Math.PI + (Math.PI / 2) * (i / segments);
    points.push({ x: x + rx + Math.cos(a) * rx, y: y + ry + Math.sin(a) * ry });
  }
  return points;
}

function approximatePath(obj: any): Point[] {
  const points: Point[] = [];
  const path = obj.path;
  if (!path) return points;

  const matrix = obj.calcTransformMatrix();

  for (const cmd of path) {
    const type = cmd[0];
    if (type === "M" || type === "L") {
      const px = cmd[1];
      const py = cmd[2];
      points.push({
        x: matrix[0] * px + matrix[2] * py + matrix[4],
        y: matrix[1] * px + matrix[3] * py + matrix[5],
      });
    } else if (type === "C") {
      // Sample cubic bezier
      const p0 = points.length > 0 ? points[points.length - 1] : { x: 0, y: 0 };
      const p1 = { x: cmd[1], y: cmd[2] };
      const p2 = { x: cmd[3], y: cmd[4] };
      const p3 = { x: cmd[5], y: cmd[6] };
      for (let t = 0.1; t <= 1; t += 0.1) {
        const x = cubicBezier(p0.x, p1.x, p2.x, p3.x, t);
        const y = cubicBezier(p0.y, p1.y, p2.y, p3.y, t);
        points.push({
          x: matrix[0] * x + matrix[2] * y + matrix[4],
          y: matrix[1] * x + matrix[3] * y + matrix[5],
        });
      }
    } else if (type === "Q") {
      // Sample quadratic bezier
      const p0 = points.length > 0 ? points[points.length - 1] : { x: 0, y: 0 };
      const p1 = { x: cmd[1], y: cmd[2] };
      const p2 = { x: cmd[3], y: cmd[4] };
      for (let t = 0.1; t <= 1; t += 0.1) {
        const x = quadBezier(p0.x, p1.x, p2.x, t);
        const y = quadBezier(p0.y, p1.y, p2.y, t);
        points.push({
          x: matrix[0] * x + matrix[2] * y + matrix[4],
          y: matrix[1] * x + matrix[3] * y + matrix[5],
        });
      }
    }
    // Z (close) — ignored, we close by connecting first/last
  }

  return points;
}

function cubicBezier(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

function quadBezier(p0: number, p1: number, p2: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * p0 + 2 * mt * t * p1 + t * t * p2;
}

function rotatePoint(p: Point, cx: number, cy: number, angle: number): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = p.x - cx;
  const dy = p.y - cy;
  return {
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  };
}

// ─── Convex Hull (Graham scan) ──────────────────────────────────
function convexHull(points: Point[]): Point[] {
  if (points.length < 3) return points;

  // Find the lowest point
  let lowest = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].y > points[lowest].y ||
        (points[i].y === points[lowest].y && points[i].x < points[lowest].x)) {
      lowest = i;
    }
  }
  [points[0], points[lowest]] = [points[lowest], points[0]];
  const pivot = points[0];

  // Sort by polar angle
  const sorted = points.slice(1).sort((a, b) => {
    const angleA = Math.atan2(a.y - pivot.y, a.x - pivot.x);
    const angleB = Math.atan2(b.y - pivot.y, b.x - pivot.x);
    if (angleA !== angleB) return angleA - angleB;
    const distA = (a.x - pivot.x) ** 2 + (a.y - pivot.y) ** 2;
    const distB = (b.x - pivot.x) ** 2 + (b.y - pivot.y) ** 2;
    return distA - distB;
  });

  const stack: Point[] = [pivot, sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    while (stack.length > 1 && cross(stack[stack.length - 2], stack[stack.length - 1], sorted[i]) <= 0) {
      stack.pop();
    }
    stack.push(sorted[i]);
  }
  return stack;
}

function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

// ─── Polygon Boolean Operations ─────────────────────────────────
// Uses Sutherland-Hodgman clipping for intersect,
// and canvas composite operations for pixel-based fallback.

/** Check if point is inside a polygon (ray casting). */
function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if ((yi > p.y) !== (yj > p.y) && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Find intersection of two line segments. */
function lineIntersection(
  p1: Point, p2: Point,
  p3: Point, p4: Point
): Point | null {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return { x: p1.x + t * d1x, y: p1.y + t * d1y };
  }
  return null;
}

/** Sutherland-Hodgman polygon clipping — finds intersection polygon. */
function clipPolygon(subject: Point[], clip: Point[]): Point[] {
  let output = [...subject];

  for (let i = 0; i < clip.length; i++) {
    if (output.length === 0) return [];
    const input = [...output];
    output = [];
    const edgeStart = clip[i];
    const edgeEnd = clip[(i + 1) % clip.length];

    for (let j = 0; j < input.length; j++) {
      const current = input[j];
      const previous = input[(j + input.length - 1) % input.length];

      const currInside = isLeftOfEdge(current, edgeStart, edgeEnd);
      const prevInside = isLeftOfEdge(previous, edgeStart, edgeEnd);

      if (currInside) {
        if (!prevInside) {
          const inter = lineIntersection(previous, current, edgeStart, edgeEnd);
          if (inter) output.push(inter);
        }
        output.push(current);
      } else if (prevInside) {
        const inter = lineIntersection(previous, current, edgeStart, edgeEnd);
        if (inter) output.push(inter);
      }
    }
  }
  return output;
}

function isLeftOfEdge(p: Point, edgeStart: Point, edgeEnd: Point): boolean {
  return (edgeEnd.x - edgeStart.x) * (p.y - edgeStart.y) -
         (edgeEnd.y - edgeStart.y) * (p.x - edgeStart.x) >= 0;
}

// ─── Canvas-based boolean operations (pixel method) ─────────────

interface CanvasBoolResult {
  pathD: string;
  bounds: { x: number; y: number; width: number; height: number };
}

/**
 * Perform a boolean operation on two Fabric.js objects using canvas compositing.
 * This renders both shapes to a temporary canvas with the appropriate composite
 * operation, then traces the result contour to produce an SVG path.
 */
export function performBooleanOperation(
  operation: BooleanOperation,
  objA: any,
  objB: any,
  fabricCanvas: any
): CanvasBoolResult | null {
  // Get bounding boxes
  const brA = objA.getBoundingRect();
  const brB = objB.getBoundingRect();

  // Combined bounds with padding
  const padding = 4;
  const minX = Math.min(brA.left, brB.left) - padding;
  const minY = Math.min(brA.top, brB.top) - padding;
  const maxX = Math.max(brA.left + brA.width, brB.left + brB.width) + padding;
  const maxY = Math.max(brA.top + brA.height, brB.top + brB.height) + padding;
  const totalW = Math.ceil(maxX - minX);
  const totalH = Math.ceil(maxY - minY);

  if (totalW <= 0 || totalH <= 0) return null;

  // Scale factor for better accuracy
  const scale = 2;
  const canvasW = totalW * scale;
  const canvasH = totalH * scale;

  // Create temporary canvases
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = canvasW;
  tempCanvas.height = canvasH;
  const ctx = tempCanvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.translate(-minX, -minY);

  // Set composite operation based on boolean operation type
  const compositeOp = getCompositeOperation(operation);

  // Clear canvas
  ctx.clearRect(minX, minY, totalW, totalH);

  // Draw shape A first (with source-over)
  ctx.globalCompositeOperation = "source-over";
  renderObjectToCanvas(objA, ctx);

  // Apply composite operation and draw shape B
  ctx.globalCompositeOperation = compositeOp;
  renderObjectToCanvas(objB, ctx);

  // Reset composite operation
  ctx.globalCompositeOperation = "source-over";

  // Trace the contour from the result
  const pathD = traceContourFromCanvas(tempCanvas, minX, minY, scale);

  if (!pathD) return null;

  return {
    pathD,
    bounds: { x: minX, y: minY, width: totalW, height: totalH },
  };
}

function getCompositeOperation(operation: BooleanOperation): GlobalCompositeOperation {
  switch (operation) {
    case "union":
      return "source-over";
    case "subtract":
      return "destination-out";
    case "intersect":
      return "source-in";
    case "exclude":
      return "xor";
    default:
      return "source-over";
  }
}

/**
 * Render a Fabric.js object to a 2D canvas context.
 * Handles basic shape types.
 */
function renderObjectToCanvas(obj: any, ctx: CanvasRenderingContext2D) {
  const type = obj.type;

  ctx.save();

  // Apply fill
  const fill = obj.fill || "#000000";
  const stroke = obj.stroke;

  if (type === "rect") {
    const left = obj.left || 0;
    const top = obj.top || 0;
    const w = (obj.width || 0) * (obj.scaleX || 1);
    const h = (obj.height || 0) * (obj.scaleY || 1);
    const rx = obj.rx || 0;
    const ry = obj.ry || 0;
    const angle = (obj.angle || 0) * (Math.PI / 180);

    ctx.translate(left + w / 2, top + h / 2);
    ctx.rotate(angle);
    ctx.translate(-(left + w / 2), -(top + h / 2));

    ctx.beginPath();
    if (rx > 0 || ry > 0) {
      roundRect(ctx, left, top, w, h, rx * (obj.scaleX || 1), ry * (obj.scaleY || 1));
    } else {
      ctx.rect(left, top, w, h);
    }
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = obj.strokeWidth || 1;
      ctx.stroke();
    }
  } else if (type === "ellipse") {
    const left = obj.left || 0;
    const top = obj.top || 0;
    const rx = (obj.rx || (obj.width || 0) / 2) * (obj.scaleX || 1);
    const ry = (obj.ry || (obj.height || 0) / 2) * (obj.scaleY || 1);
    const cx = left + rx;
    const cy = top + ry;
    const angle = (obj.angle || 0) * (Math.PI / 180);

    ctx.translate(cx, cy);
    ctx.rotate(angle);

    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = obj.strokeWidth || 1;
      ctx.stroke();
    }
  } else if (type === "circle") {
    const r = (obj.radius || 0) * (obj.scaleX || 1);
    ctx.beginPath();
    ctx.arc(obj.left || 0, obj.top || 0, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  } else if (type === "triangle") {
    const left = obj.left || 0;
    const top = obj.top || 0;
    const w = (obj.width || 0) * (obj.scaleX || 1);
    const h = (obj.height || 0) * (obj.scaleY || 1);
    ctx.beginPath();
    ctx.moveTo(left + w / 2, top);
    ctx.lineTo(left + w, top + h);
    ctx.lineTo(left, top + h);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  } else if (type === "path" && obj.path) {
    // Use the SVG path data directly
    const path2d = new Path2D(obj.toSVG ? extractPathD(obj) : "");
    ctx.fillStyle = fill;
    ctx.fill(path2d);
  } else if (type === "group" && obj.getObjects) {
    // Render all children
    const children = obj.getObjects();
    for (const child of children) {
      renderObjectToCanvas(child, ctx);
    }
  } else if (type === "polygon" && obj.points) {
    const points = obj.points;
    const matrix = obj.calcTransformMatrix();
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const px = p.x - (obj.pathOffset?.x || 0);
      const py = p.y - (obj.pathOffset?.y || 0);
      const x = matrix[0] * px + matrix[2] * py + matrix[4];
      const y = matrix[1] * px + matrix[3] * py + matrix[5];
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  } else {
    // Fallback: bounding box
    const left = obj.left || 0;
    const top = obj.top || 0;
    const w = (obj.width || 0) * (obj.scaleX || 1);
    const h = (obj.height || 0) * (obj.scaleY || 1);
    ctx.fillStyle = fill;
    ctx.fillRect(left, top, w, h);
  }

  ctx.restore();
}

function extractPathD(obj: any): string {
  // Try to extract the 'd' attribute from the SVG
  if (obj.path) {
    let d = "";
    for (const cmd of obj.path) {
      d += cmd[0];
      for (let i = 1; i < cmd.length; i++) {
        d += (i > 1 ? "," : " ") + cmd[i];
      }
    }
    return d;
  }
  return "";
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  w: number, h: number,
  rx: number, ry: number
) {
  const r = Math.min(rx, w / 2);
  const r2 = Math.min(ry, h / 2);
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r2);
  ctx.lineTo(x + w, y + h - r2);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r2);
  ctx.lineTo(x, y + r2);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ─── Contour Tracing (Marching Squares) ─────────────────────────

/**
 * Trace the contour of non-transparent pixels on a canvas.
 * Uses marching squares to produce an SVG path `d` string.
 */
function traceContourFromCanvas(
  canvas: HTMLCanvasElement,
  offsetX: number,
  offsetY: number,
  scale: number
): string | null {
  const ctx = canvas.getContext("2d")!;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  // Create binary mask (1 = filled, 0 = transparent)
  const w = canvas.width;
  const h = canvas.height;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    mask[i] = data[i * 4 + 3] > 127 ? 1 : 0; // Alpha threshold
  }

  // Find outer contour using Moore neighborhood tracing
  const contourPoints = mooreTraceContour(mask, w, h);

  if (contourPoints.length < 3) return null;

  // Simplify contour (Ramer-Douglas-Peucker)
  const simplified = simplifyContour(contourPoints, 1.5);

  // Convert to SVG path coordinates (undo scale and offset)
  const pathPoints = simplified.map(p => ({
    x: p.x / scale + offsetX,
    y: p.y / scale + offsetY,
  }));

  // Build SVG path
  let d = `M ${pathPoints[0].x.toFixed(2)} ${pathPoints[0].y.toFixed(2)}`;
  for (let i = 1; i < pathPoints.length; i++) {
    d += ` L ${pathPoints[i].x.toFixed(2)} ${pathPoints[i].y.toFixed(2)}`;
  }
  d += " Z";

  return d;
}

/**
 * Moore neighborhood boundary tracing algorithm.
 * Finds the outer contour of connected non-zero pixels.
 */
function mooreTraceContour(mask: Uint8Array, w: number, h: number): Point[] {
  // Find starting point (first non-zero pixel, scanning top-left)
  let startX = -1, startY = -1;
  for (let y = 0; y < h && startX === -1; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] === 1) {
        startX = x;
        startY = y;
        break;
      }
    }
  }
  if (startX === -1) return [];

  // Moore neighborhood offsets (8-connected, starting from left, going clockwise)
  const dx = [-1, -1, 0, 1, 1, 1, 0, -1];
  const dy = [0, -1, -1, -1, 0, 1, 1, 1];

  const contour: Point[] = [];
  let x = startX;
  let y = startY;
  let dir = 6; // Start looking from the left (backtrack direction)
  let steps = 0;
  const maxSteps = w * h * 2;

  do {
    contour.push({ x, y });

    // Search for next boundary pixel in Moore neighborhood
    let found = false;
    for (let i = 0; i < 8; i++) {
      // Start searching from (dir + 5) % 8 (backtrack + 1, i.e., 90° CCW from backtrack)
      const searchDir = (dir + 5 + i) % 8;
      const nx = x + dx[searchDir];
      const ny = y + dy[searchDir];

      if (nx >= 0 && nx < w && ny >= 0 && ny < h && mask[ny * w + nx] === 1) {
        dir = searchDir;
        x = nx;
        y = ny;
        found = true;
        break;
      }
    }

    if (!found) break;

    steps++;
  } while ((x !== startX || y !== startY || contour.length < 3) && steps < maxSteps);

  return contour;
}

/**
 * Ramer-Douglas-Peucker line simplification algorithm.
 */
function simplifyContour(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2) return points;

  // Find the point with the maximum distance from the line between first and last
  let maxDist = 0;
  let maxIdx = 0;
  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = simplifyContour(points.slice(0, maxIdx + 1), epsilon);
    const right = simplifyContour(points.slice(maxIdx), epsilon);
    return left.slice(0, -1).concat(right);
  } else {
    return [first, last];
  }
}

function perpendicularDistance(p: Point, lineStart: Point, lineEnd: Point): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return Math.sqrt((p.x - lineStart.x) ** 2 + (p.y - lineStart.y) ** 2);
  return Math.abs(dy * p.x - dx * p.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x) / len;
}

// ─── Weiler-Atherton style polygon boolean (vector-based) ───────
// For higher quality results on polygon shapes

/**
 * Polygon union: combine two polygons.
 * Uses the convex hull of both as a simple approximation.
 */
export function polygonUnion(polyA: Point[], polyB: Point[]): Point[] {
  return convexHull([...polyA, ...polyB]);
}

/**
 * Polygon subtract: polyA minus polyB.
 * Uses canvas-based method as polygon subtraction is complex.
 */
export function polygonSubtract(polyA: Point[], polyB: Point[]): Point[] {
  // For polygon subtraction, we need the Weiler-Atherton algorithm
  // which is very complex. For now, use a simplified approach:
  // find points of A that are outside B, and intersection points.
  const result: Point[] = [];

  for (let i = 0; i < polyA.length; i++) {
    const curr = polyA[i];
    const next = polyA[(i + 1) % polyA.length];

    if (!pointInPolygon(curr, polyB)) {
      result.push(curr);
    }

    // Check for edge intersections
    for (let j = 0; j < polyB.length; j++) {
      const bCurr = polyB[j];
      const bNext = polyB[(j + 1) % polyB.length];
      const inter = lineIntersection(curr, next, bCurr, bNext);
      if (inter) {
        result.push(inter);
      }
    }
  }

  // If we got a valid polygon, return it
  if (result.length >= 3) {
    return convexHull(result);
  }

  // Fallback: return A's bounding box minus B (approximation)
  return polyA;
}

/**
 * Polygon intersection: area where both overlap.
 */
export function polygonIntersect(polyA: Point[], polyB: Point[]): Point[] {
  return clipPolygon(polyA, polyB);
}

/**
 * Polygon exclude (XOR): everything except the intersection.
 * Returns two polygons: the parts of A not in B, and parts of B not in A.
 */
export function polygonExclude(polyA: Point[], polyB: Point[]): Point[] {
  // For XOR, we combine subtract(A,B) and subtract(B,A)
  const subA = polygonSubtract(polyA, polyB);
  const subB = polygonSubtract(polyB, polyA);
  if (subA.length < 3 && subB.length < 3) return polyA;
  if (subA.length < 3) return subB;
  if (subB.length < 3) return subA;
  return convexHull([...subA, ...subB]);
}

/**
 * Convert a polygon (array of points) to an SVG path `d` string.
 */
export function polygonToPath(points: Point[]): string {
  if (points.length === 0) return "";
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)}`;
  }
  d += " Z";
  return d;
}
