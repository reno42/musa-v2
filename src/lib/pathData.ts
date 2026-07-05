/**
 * SVG Path Data Parser/Serializer — Phase E1
 * Parses path d="M...C...L...Z" strings into editable point models and back.
 */

export interface Point {
  x: number;
  y: number;
}

export interface PathPoint {
  type: "anchor" | "smooth";
  x: number;
  y: number;
  cpIn?: Point;   // incoming control point (for bezier)
  cpOut?: Point;  // outgoing control point (for bezier)
}

/** Parse SVG d attribute into array of PathPoint */
export function parsePathData(d: string): PathPoint[] {
  const points: PathPoint[] = [];
  const tokens = tokenize(d);
  let i = 0;
  let currentX = 0;
  let currentY = 0;
  let subPathStartX = 0;
  let subPathStartY = 0;
  let prevCommand = "";

  while (i < tokens.length) {
    const cmd = tokens[i];
    const isRelative = cmd === cmd.toLowerCase();
    const upperCmd = cmd.toUpperCase();

    if (upperCmd === "M" || upperCmd === "L" || upperCmd === "T") {
      const x = parseFloat(tokens[i + 1]);
      const y = parseFloat(tokens[i + 2]);
      const absX = isRelative ? currentX + x : x;
      const absY = isRelative ? currentY + y : y;
      if (upperCmd === "M") {
        subPathStartX = absX; subPathStartY = absY;
      }
      points.push({ type: "anchor", x: absX, y: absY });
      currentX = absX; currentY = absY;
      i += 3;
    } else if (upperCmd === "C") {
      const cp1x = isRelative ? currentX + parseFloat(tokens[i + 1]) : parseFloat(tokens[i + 1]);
      const cp1y = isRelative ? currentY + parseFloat(tokens[i + 2]) : parseFloat(tokens[i + 2]);
      const cp2x = isRelative ? currentX + parseFloat(tokens[i + 3]) : parseFloat(tokens[i + 3]);
      const cp2y = isRelative ? currentY + parseFloat(tokens[i + 4]) : parseFloat(tokens[i + 4]);
      const x = isRelative ? currentX + parseFloat(tokens[i + 5]) : parseFloat(tokens[i + 5]);
      const y = isRelative ? currentY + parseFloat(tokens[i + 6]) : parseFloat(tokens[i + 6]);
      points.push({ type: "smooth", x, y, cpIn: { x: cp2x, y: cp2y }, cpOut: { x: cp1x, y: cp1y } });
      currentX = x; currentY = y;
      i += 7;
    } else if (upperCmd === "S") {
      const cp2x = isRelative ? currentX + parseFloat(tokens[i + 1]) : parseFloat(tokens[i + 1]);
      const cp2y = isRelative ? currentY + parseFloat(tokens[i + 2]) : parseFloat(tokens[i + 2]);
      const x = isRelative ? currentX + parseFloat(tokens[i + 3]) : parseFloat(tokens[i + 3]);
      const y = isRelative ? currentY + parseFloat(tokens[i + 4]) : parseFloat(tokens[i + 4]);
      // Reflect cpOut of previous point as cpIn
      const prevPt = points[points.length - 1];
      const cp1x = prevPt?.cpIn ? currentX + (currentX - prevPt.cpIn.x) : currentX;
      const cp1y = prevPt?.cpIn ? currentY + (currentY - prevPt.cpIn.y) : currentY;
      points.push({ type: "smooth", x, y, cpIn: { x: cp2x, y: cp2y }, cpOut: { x: cp1x, y: cp1y } });
      currentX = x; currentY = y;
      i += 5;
    } else if (upperCmd === "Q") {
      const cpx = isRelative ? currentX + parseFloat(tokens[i + 1]) : parseFloat(tokens[i + 1]);
      const cpy = isRelative ? currentY + parseFloat(tokens[i + 2]) : parseFloat(tokens[i + 2]);
      const x = isRelative ? currentX + parseFloat(tokens[i + 3]) : parseFloat(tokens[i + 3]);
      const y = isRelative ? currentY + parseFloat(tokens[i + 4]) : parseFloat(tokens[i + 4]);
      // Quadratic → cubic approximation: cp1 = current + 2/3*(cp - current), cp2 = target + 2/3*(cp - target)
      const cp1x = currentX + (2 / 3) * (cpx - currentX);
      const cp1y = currentY + (2 / 3) * (cpy - currentY);
      const cp2x = x + (2 / 3) * (cpx - x);
      const cp2y = y + (2 / 3) * (cpy - y);
      points.push({ type: "smooth", x, y, cpIn: { x: cp2x, y: cp2y }, cpOut: { x: cp1x, y: cp1y } });
      currentX = x; currentY = y;
      i += 5;
    } else if (upperCmd === "A") {
      // Arc: extract endpoint
      const x = isRelative ? currentX + parseFloat(tokens[i + 6]) : parseFloat(tokens[i + 6]);
      const y = isRelative ? currentY + parseFloat(tokens[i + 7]) : parseFloat(tokens[i + 7]);
      points.push({ type: "anchor", x, y });
      currentX = x; currentY = y;
      i += 8;
    } else if (upperCmd === "Z") {
      // Close path — add reference to subpath start
      currentX = subPathStartX; currentY = subPathStartY;
      i += 1;
    } else if (upperCmd === "H") {
      const x = isRelative ? currentX + parseFloat(tokens[i + 1]) : parseFloat(tokens[i + 1]);
      points.push({ type: "anchor", x, y: currentY });
      currentX = x;
      i += 2;
    } else if (upperCmd === "V") {
      const y = isRelative ? currentY + parseFloat(tokens[i + 1]) : parseFloat(tokens[i + 1]);
      points.push({ type: "anchor", x: currentX, y });
      currentY = y;
      i += 2;
    } else {
      // Unknown or numeric (implicit command repeat)
      i++;
    }
    prevCommand = upperCmd;
  }
  return points;
}

/** Serialize PathPoint array back to SVG d attribute */
export function serializePathData(points: PathPoint[]): string {
  if (points.length === 0) return "";
  const first = points[0];
  let d = `M ${round(first.x)} ${round(first.y)}`;
  for (let i = 1; i < points.length; i++) {
    const pt = points[i];
    if (pt.type === "smooth" && pt.cpOut && points[i - 1]?.cpIn) {
      d += ` C ${round(pt.cpOut.x)} ${round(pt.cpOut.y)} ${round(pt.cpIn!.x)} ${round(pt.cpIn!.y)} ${round(pt.x)} ${round(pt.y)}`;
    } else if (pt.type === "smooth" && pt.cpOut) {
      // Only outgoing control point
      d += ` Q ${round(pt.cpOut.x)} ${round(pt.cpOut.y)} ${round(pt.x)} ${round(pt.y)}`;
    } else {
      d += ` L ${round(pt.x)} ${round(pt.y)}`;
    }
  }
  return d;
}

/** Serialize with Z at end for closed paths */
export function serializePathDataClosed(points: PathPoint[]): string {
  return serializePathData(points) + " Z";
}

/** Insert a new point at the given index */
export function insertPoint(points: PathPoint[], index: number, position: Point): PathPoint[] {
  const result = [...points];
  result.splice(index, 0, { type: "anchor", x: position.x, y: position.y });
  return result;
}

/** Delete the point at the given index */
export function deletePoint(points: PathPoint[], index: number): PathPoint[] {
  if (points.length <= 2) return points; // minimum 2 points
  return points.filter((_, i) => i !== index);
}

/** Toggle between anchor (corner) and smooth (bezier) at given index */
export function toggleSmoothCorner(points: PathPoint[], index: number): PathPoint[] {
  const result = [...points];
  const pt = result[index];
  if (!pt) return result;
  if (pt.type === "anchor") {
    // Convert to smooth: create symmetric bezier handles
    const prev = result[index - 1] || result[result.length - 1];
    const next = result[index + 1] || result[0];
    const dxPrev = pt.x - prev.x;
    const dyPrev = pt.y - prev.y;
    const dxNext = next.x - pt.x;
    const dyNext = next.y - pt.y;
    const handleLen = Math.min(Math.hypot(dxPrev, dyPrev), Math.hypot(dxNext, dyNext)) * 0.33;
    const angleIn = Math.atan2(dyPrev, dxPrev);
    const angleOut = Math.atan2(dyNext, dxNext);
    result[index] = {
      type: "smooth", x: pt.x, y: pt.y,
      cpIn: { x: pt.x + handleLen * Math.cos(angleIn), y: pt.y + handleLen * Math.sin(angleIn) },
      cpOut: { x: pt.x + handleLen * Math.cos(angleOut), y: pt.y + handleLen * Math.sin(angleOut) },
    };
  } else {
    result[index] = { type: "anchor", x: pt.x, y: pt.y };
  }
  return result;
}

/** Compute bounds for a set of points */
export function computeBounds(points: PathPoint[]): { x: number; y: number; width: number; height: number } {
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

// ── Helpers ──

function tokenize(d: string): string[] {
  return d
    .replace(/,/g, " ")
    .replace(/([a-zA-Z])/g, " $1 ")
    .trim()
    .split(/\s+/);
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
