import SVGPathCommander from "svg-path-commander";
import {
  classifyBezierDegeneracy,
  deCasteljau,
  findBezierChainIntersections,
  findBezierSingularities,
  splitBezier,
} from "./bezierMath.ts";

export interface Point {
  x: number;
  y: number;
}

/**
 * Editable anchor model. Handles belong to the anchor, never to a command:
 * cpIn controls the segment arriving at the anchor and cpOut the one leaving it.
 */
export interface PathPoint extends Point {
  type: "anchor" | "smooth";
  cpIn?: Point;
  cpOut?: Point;
}

export interface ClosestPathSegment {
  /** Index of the segment's end anchor. `points.length` is the closing segment. */
  endIndex: number;
  t: number;
  distance: number;
  point: Point;
}

export interface PathAnalysis {
  degeneracy: "point" | "line" | "curve";
  selfIntersections: number;
  singularities: number;
}

type PathSegment = Array<string | number>;

/** Parse one SVG subpath into anchors with correctly-owned cubic handles. */
export function parsePathData(d: string): PathPoint[] {
  if (!d.trim()) return [];

  const closed = isPathClosed(d);
  const absolute = SVGPathCommander.pathToAbsolute(d) as unknown as PathSegment[];

  // Arcs need cubic conversion before they can be edited with this anchor model.
  // Shape is preserved; only the SVG command representation changes.
  if (absolute.some((segment) => segment[0] === "A")) {
    const curve = SVGPathCommander.pathToCurve(d) as unknown as PathSegment[];
    return parseCurveSegments(curve, closed);
  }

  const points: PathPoint[] = [];
  let current: Point = { x: 0, y: 0 };
  let previousCommand = "";
  let previousQuadraticControl: Point | undefined;

  for (const segment of absolute) {
    const command = String(segment[0]).toUpperCase();
    if (command === "M") {
      current = pointFrom(segment, 1);
      points.push({ type: "anchor", ...current });
      previousQuadraticControl = undefined;
    } else if (command === "L") {
      current = pointFrom(segment, 1);
      points.push({ type: "anchor", ...current });
      previousQuadraticControl = undefined;
    } else if (command === "H") {
      current = { x: numberAt(segment, 1), y: current.y };
      points.push({ type: "anchor", ...current });
      previousQuadraticControl = undefined;
    } else if (command === "V") {
      current = { x: current.x, y: numberAt(segment, 1) };
      points.push({ type: "anchor", ...current });
      previousQuadraticControl = undefined;
    } else if (command === "C") {
      addCubicPoint(points, pointFrom(segment, 1), pointFrom(segment, 3), pointFrom(segment, 5));
      current = pointFrom(segment, 5);
      previousQuadraticControl = undefined;
    } else if (command === "S") {
      const previous = points[points.length - 1];
      const cpOut = (previousCommand === "C" || previousCommand === "S") && previous?.cpIn
        ? reflect(previous.cpIn, current)
        : { ...current };
      const end = pointFrom(segment, 3);
      addCubicPoint(points, cpOut, pointFrom(segment, 1), end);
      current = end;
      previousQuadraticControl = undefined;
    } else if (command === "Q") {
      const quadraticControl = pointFrom(segment, 1);
      const end = pointFrom(segment, 3);
      addQuadraticPoint(points, current, quadraticControl, end);
      current = end;
      previousQuadraticControl = quadraticControl;
    } else if (command === "T") {
      const quadraticControl = previousCommand === "Q" || previousCommand === "T"
        ? reflect(previousQuadraticControl ?? current, current)
        : { ...current };
      const end = pointFrom(segment, 1);
      addQuadraticPoint(points, current, quadraticControl, end);
      current = end;
      previousQuadraticControl = quadraticControl;
    }
    previousCommand = command;
  }

  mergeExplicitClosingPoint(points, closed);
  return classifyPoints(points);
}

/** Serialize anchors to SVG. A cubic segment uses previous.cpOut and current.cpIn. */
export function serializePathData(points: PathPoint[], closed = false): string {
  if (points.length === 0) return "";
  const first = points[0];
  let d = `M ${round(first.x)} ${round(first.y)}`;

  for (let index = 1; index < points.length; index++) {
    d += serializeSegment(points[index - 1], points[index]);
  }

  if (closed) {
    const last = points[points.length - 1];
    if (points.length > 1 && (last.cpOut || first.cpIn)) {
      d += serializeSegment(last, first);
    }
    d += " Z";
  }
  return d;
}

export function serializePathDataClosed(points: PathPoint[]): string {
  return serializePathData(points, true);
}

export function isPathClosed(d: string): boolean {
  return /z\s*$/i.test(d.trim());
}

export function createSmoothPoint(anchor: Point, outgoingHandle: Point): PathPoint {
  return {
    type: "smooth",
    ...anchor,
    cpIn: reflect(outgoingHandle, anchor),
    cpOut: { ...outgoingHandle },
  };
}

export function insertPoint(points: PathPoint[], index: number, position: Point): PathPoint[] {
  const result = clonePathPoints(points);
  result.splice(index, 0, { type: "anchor", ...position });
  return result;
}

export function deletePoint(points: PathPoint[], index: number): PathPoint[] {
  if (points.length <= 2) return points;
  return clonePathPoints(points).filter((_, pointIndex) => pointIndex !== index);
}

/** Convert a straight/corner anchor to smooth, or remove all handles from a curved one. */
export function toggleSmoothCorner(points: PathPoint[], index: number, closed = false): PathPoint[] {
  const result = clonePathPoints(points);
  const point = result[index];
  if (!point) return result;

  if (point.cpIn || point.cpOut) {
    result[index] = { type: "anchor", x: point.x, y: point.y };
    return result;
  }

  const previous = index > 0 ? result[index - 1] : closed ? result[result.length - 1] : undefined;
  const next = index < result.length - 1 ? result[index + 1] : closed ? result[0] : undefined;
  const direction = smoothDirection(point, previous, next);
  const previousDistance = previous ? distance(point, previous) : Number.POSITIVE_INFINITY;
  const nextDistance = next ? distance(point, next) : Number.POSITIVE_INFINITY;
  const finiteDistance = Math.min(previousDistance, nextDistance);
  const handleLength = Number.isFinite(finiteDistance) ? Math.max(8, finiteDistance / 3) : 24;

  result[index] = {
    type: "smooth",
    x: point.x,
    y: point.y,
    cpIn: {
      x: point.x - direction.x * handleLength,
      y: point.y - direction.y * handleLength,
    },
    cpOut: {
      x: point.x + direction.x * handleLength,
      y: point.y + direction.y * handleLength,
    },
  };
  return result;
}

export function movePathPoint(points: PathPoint[], index: number, position: Point): PathPoint[] {
  const result = clonePathPoints(points);
  const point = result[index];
  if (!point) return result;
  const dx = position.x - point.x;
  const dy = position.y - point.y;
  point.x = position.x;
  point.y = position.y;
  if (point.cpIn) point.cpIn = { x: point.cpIn.x + dx, y: point.cpIn.y + dy };
  if (point.cpOut) point.cpOut = { x: point.cpOut.x + dx, y: point.cpOut.y + dy };
  return result;
}

/** Move a handle. Smooth points keep the opposite handle collinear unless linked=false. */
export function movePathHandle(
  points: PathPoint[],
  index: number,
  handle: "cpIn" | "cpOut",
  position: Point,
  linked = true,
): PathPoint[] {
  const result = clonePathPoints(points);
  const point = result[index];
  if (!point) return result;

  const opposite = handle === "cpIn" ? "cpOut" : "cpIn";
  const oldOppositeLength = point[opposite] ? distance(point, point[opposite]!) : distance(point, position);
  point[handle] = { ...position };

  if (linked) {
    const length = distance(point, position);
    const scale = length > 0 ? oldOppositeLength / length : 0;
    point[opposite] = {
      x: point.x - (position.x - point.x) * scale,
      y: point.y - (position.y - point.y) * scale,
    };
    point.type = "smooth";
  } else {
    point.type = "anchor";
  }
  return result;
}

/** Split a straight or cubic segment without changing its rendered shape. */
export function splitPathSegment(
  points: PathPoint[],
  endIndex: number,
  t = 0.5,
  closed = false,
): PathPoint[] {
  if (points.length < 2 || endIndex < 1 || endIndex > points.length) return points;
  if (endIndex === points.length && !closed) return points;

  const result = clonePathPoints(points);
  const previousIndex = endIndex - 1;
  const currentIndex = endIndex % result.length;
  const previous = result[previousIndex];
  const current = result[currentIndex];
  const insertAt = endIndex === result.length ? result.length : endIndex;

  if (!previous.cpOut && !current.cpIn) {
    const position = deCasteljau([previous, current], t);
    result.splice(insertAt, 0, { type: "anchor", ...position });
    return result;
  }

  const controls = [
    { x: previous.x, y: previous.y },
    previous.cpOut ?? { x: previous.x, y: previous.y },
    current.cpIn ?? { x: current.x, y: current.y },
    { x: current.x, y: current.y },
  ];
  const [left, right] = splitBezier(controls, t);
  previous.cpOut = left[1];
  current.cpIn = right[2];
  const inserted: PathPoint = {
    type: "smooth",
    ...left[3],
    cpIn: left[2],
    cpOut: right[1],
  };
  result.splice(insertAt, 0, inserted);
  return result;
}

/** Find the closest sampled location on every segment, including closure. */
export function findClosestPathSegment(
  points: PathPoint[],
  position: Point,
  closed = false,
  samplesPerSegment = 32,
): ClosestPathSegment | null {
  if (points.length < 2) return null;
  let best: ClosestPathSegment | null = null;
  const segmentCount = points.length - 1 + (closed ? 1 : 0);

  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
    const previous = points[segmentIndex];
    const endIndex = segmentIndex + 1;
    const current = points[endIndex % points.length];
    const controls = previous.cpOut || current.cpIn
      ? [previous, previous.cpOut ?? previous, current.cpIn ?? current, current]
      : [previous, current];

    for (let sample = 0; sample <= samplesPerSegment; sample++) {
      const t = sample / samplesPerSegment;
      const candidate = deCasteljau(controls, t);
      const candidateDistance = distance(candidate, position);
      if (!best || candidateDistance < best.distance) {
        best = { endIndex, t, distance: candidateDistance, point: candidate };
      }
    }
  }
  return best;
}

/** Return every path segment as a linear or cubic Bezier control polygon. */
export function getPathBezierSegments(points: PathPoint[], closed = false): Point[][] {
  const segments: Point[][] = [];
  const segmentCount = Math.max(0, points.length - 1 + (closed && points.length > 1 ? 1 : 0));
  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
    const previous = points[segmentIndex];
    const current = points[(segmentIndex + 1) % points.length];
    segments.push(previous.cpOut || current.cpIn
      ? [
          { x: previous.x, y: previous.y },
          previous.cpOut ?? { x: previous.x, y: previous.y },
          current.cpIn ?? { x: current.x, y: current.y },
          { x: current.x, y: current.y },
        ]
      : [{ x: previous.x, y: previous.y }, { x: current.x, y: current.y }]);
  }
  return segments;
}

/**
 * Point at the middle of every segment (t = 0.5 on the segment's Bezier),
 * in segment order — index N is the segment ending at anchor N + 1. Drives
 * the vertex-edit mode's "click the segment midpoint to add a point" handles.
 */
export function segmentMidpoints(points: PathPoint[], closed = false): Point[] {
  return getPathBezierSegments(points, closed).map(controls => deCasteljau(controls, 0.5));
}

export function analyzePathData(d: string, closed = isPathClosed(d)): PathAnalysis {
  const segments = getPathBezierSegments(parsePathData(d), closed);
  const controls = segments.flat();
  return {
    degeneracy: classifyBezierDegeneracy(controls),
    selfIntersections: findBezierChainIntersections(segments).length,
    singularities: segments
      .filter((segment) => segment.length > 2)
      .reduce((count, segment) => count + findBezierSingularities(segment).length, 0),
  };
}

export function computeBounds(points: PathPoint[]): { x: number; y: number; width: number; height: number } {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const coordinates = points.flatMap((point) => [
    { x: point.x, y: point.y },
    ...(point.cpIn ? [point.cpIn] : []),
    ...(point.cpOut ? [point.cpOut] : []),
  ]);
  const xs = coordinates.map((point) => point.x);
  const ys = coordinates.map((point) => point.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

export function clonePathPoints(points: PathPoint[]): PathPoint[] {
  return points.map((point) => ({
    ...point,
    cpIn: point.cpIn ? { ...point.cpIn } : undefined,
    cpOut: point.cpOut ? { ...point.cpOut } : undefined,
  }));
}

function parseCurveSegments(segments: PathSegment[], closed: boolean): PathPoint[] {
  const points: PathPoint[] = [];
  for (const segment of segments) {
    const command = String(segment[0]).toUpperCase();
    if (command === "M") points.push({ type: "anchor", ...pointFrom(segment, 1) });
    if (command === "C") addCubicPoint(points, pointFrom(segment, 1), pointFrom(segment, 3), pointFrom(segment, 5));
  }
  mergeExplicitClosingPoint(points, closed);
  return classifyPoints(points);
}

function addCubicPoint(points: PathPoint[], cpOut: Point, cpIn: Point, end: Point): void {
  const previous = points[points.length - 1];
  if (!previous) {
    points.push({ type: "anchor", ...end });
    return;
  }
  previous.cpOut = cpOut;
  points.push({ type: "anchor", ...end, cpIn });
}

function addQuadraticPoint(points: PathPoint[], start: Point, control: Point, end: Point): void {
  addCubicPoint(
    points,
    { x: start.x + (2 / 3) * (control.x - start.x), y: start.y + (2 / 3) * (control.y - start.y) },
    { x: end.x + (2 / 3) * (control.x - end.x), y: end.y + (2 / 3) * (control.y - end.y) },
    end,
  );
}

function mergeExplicitClosingPoint(points: PathPoint[], closed: boolean): void {
  if (!closed || points.length < 2) return;
  const first = points[0];
  const last = points[points.length - 1];
  if (distance(first, last) > 1e-7) return;
  first.cpIn = last.cpIn;
  points.pop();
}

function classifyPoints(points: PathPoint[]): PathPoint[] {
  return points.map((point) => ({
    ...point,
    type: hasSmoothHandles(point) ? "smooth" : "anchor",
  }));
}

function hasSmoothHandles(point: PathPoint): boolean {
  if (!point.cpIn && !point.cpOut) return false;
  if (!point.cpIn || !point.cpOut) return true;
  const incoming = { x: point.cpIn.x - point.x, y: point.cpIn.y - point.y };
  const outgoing = { x: point.cpOut.x - point.x, y: point.cpOut.y - point.y };
  const cross = Math.abs(incoming.x * outgoing.y - incoming.y * outgoing.x);
  const scale = Math.max(1, Math.hypot(incoming.x, incoming.y) * Math.hypot(outgoing.x, outgoing.y));
  return cross / scale < 1e-4 && incoming.x * outgoing.x + incoming.y * outgoing.y <= 0;
}

function serializeSegment(previous: PathPoint, current: PathPoint): string {
  if (!previous.cpOut && !current.cpIn) {
    return ` L ${round(current.x)} ${round(current.y)}`;
  }
  const cpOut = previous.cpOut ?? previous;
  const cpIn = current.cpIn ?? current;
  return ` C ${round(cpOut.x)} ${round(cpOut.y)} ${round(cpIn.x)} ${round(cpIn.y)} ${round(current.x)} ${round(current.y)}`;
}

function smoothDirection(point: Point, previous?: Point, next?: Point): Point {
  let dx = 1;
  let dy = 0;
  if (previous && next) {
    dx = next.x - previous.x;
    dy = next.y - previous.y;
  } else if (next) {
    dx = next.x - point.x;
    dy = next.y - point.y;
  } else if (previous) {
    dx = point.x - previous.x;
    dy = point.y - previous.y;
  }
  const length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length };
}

function pointFrom(segment: PathSegment, index: number): Point {
  return { x: numberAt(segment, index), y: numberAt(segment, index + 1) };
}

function numberAt(segment: PathSegment, index: number): number {
  const value = Number(segment[index]);
  return Number.isFinite(value) ? value : 0;
}

function reflect(point: Point, around: Point): Point {
  return { x: around.x * 2 - point.x, y: around.y * 2 - point.y };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
