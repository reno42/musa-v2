export interface BezierPoint {
  x: number;
  y: number;
}

export interface ComplexNumber {
  re: number;
  im: number;
}

export interface ComplexPoint {
  x: ComplexNumber;
  y: ComplexNumber;
}

export interface CubicBezier {
  p0: BezierPoint;
  p1: BezierPoint;
  p2: BezierPoint;
  p3: BezierPoint;
}

export interface CurveIntersection {
  point: BezierPoint;
  t1: number;
  t2: number;
  segment1?: number;
  segment2?: number;
}

export interface ContinuityResult {
  g1: boolean;
  g2: boolean;
  tangentAngle: number;
  curvatureDelta: number;
}

/** Stable evaluation for Bezier curves of any degree. */
export function deCasteljau(points: readonly BezierPoint[], t: number): BezierPoint {
  if (points.length === 0) throw new Error("A Bezier curve needs at least one control point.");
  const parameter = clamp01(t);
  let level = points.map((point) => ({ ...point }));
  while (level.length > 1) {
    level = level.slice(0, -1).map((point, index) => lerp(point, level[index + 1], parameter));
  }
  return level[0];
}

/** Exact De Casteljau subdivision; both curves reproduce the original shape. */
export function splitBezier(
  points: readonly BezierPoint[],
  t: number,
): [BezierPoint[], BezierPoint[]] {
  if (points.length === 0) throw new Error("A Bezier curve needs at least one control point.");
  const parameter = clamp01(t);
  const levels: BezierPoint[][] = [points.map((point) => ({ ...point }))];
  while (levels[levels.length - 1].length > 1) {
    const previous = levels[levels.length - 1];
    levels.push(previous.slice(0, -1).map((point, index) => lerp(point, previous[index + 1], parameter)));
  }
  return [levels.map((level) => level[0]), levels.map((level) => level[level.length - 1]).reverse()];
}

/** Rational Bezier evaluation with real weights (including exact conic arcs). */
export function evaluateRationalBezier(
  points: readonly BezierPoint[],
  weights: readonly number[],
  t: number,
): BezierPoint {
  assertMatchingWeights(points, weights);
  const degree = points.length - 1;
  let denominator = 0;
  let x = 0;
  let y = 0;
  for (let index = 0; index <= degree; index++) {
    const factor = bernstein(degree, index, clamp01(t)) * weights[index];
    denominator += factor;
    x += points[index].x * factor;
    y += points[index].y * factor;
  }
  if (Math.abs(denominator) < 1e-12) throw new Error("Rational Bezier denominator is zero.");
  return { x: x / denominator, y: y / denominator };
}

/** Rational evaluation with complex weights for projective/complex workflows. */
export function evaluateComplexRationalBezier(
  points: readonly BezierPoint[],
  weights: readonly ComplexNumber[],
  t: number,
): ComplexPoint {
  assertMatchingWeights(points, weights);
  const degree = points.length - 1;
  let denominator: ComplexNumber = { re: 0, im: 0 };
  let numeratorX: ComplexNumber = { re: 0, im: 0 };
  let numeratorY: ComplexNumber = { re: 0, im: 0 };
  for (let index = 0; index <= degree; index++) {
    const basis = bernstein(degree, index, clamp01(t));
    const weighted = scaleComplex(weights[index], basis);
    denominator = addComplex(denominator, weighted);
    numeratorX = addComplex(numeratorX, scaleComplex(weighted, points[index].x));
    numeratorY = addComplex(numeratorY, scaleComplex(weighted, points[index].y));
  }
  return { x: divideComplex(numeratorX, denominator), y: divideComplex(numeratorY, denominator) };
}

/** Elevate degree without changing curve geometry. */
export function elevateBezierDegree(points: readonly BezierPoint[], times = 1): BezierPoint[] {
  let elevated = points.map((point) => ({ ...point }));
  for (let pass = 0; pass < Math.max(0, Math.floor(times)); pass++) {
    const degree = elevated.length - 1;
    if (degree <= 0) return elevated;
    const next: BezierPoint[] = [elevated[0]];
    for (let index = 1; index <= degree; index++) {
      const ratio = index / (degree + 1);
      next.push({
        x: ratio * elevated[index - 1].x + (1 - ratio) * elevated[index].x,
        y: ratio * elevated[index - 1].y + (1 - ratio) * elevated[index].y,
      });
    }
    next.push(elevated[elevated.length - 1]);
    elevated = next;
  }
  return elevated;
}

export function evaluateBezierDerivative(
  points: readonly BezierPoint[],
  t: number,
  order = 1,
): BezierPoint {
  if (order < 0 || !Number.isInteger(order)) throw new Error("Derivative order must be a non-negative integer.");
  if (order === 0) return deCasteljau(points, t);
  let derivative = points.map((point) => ({ ...point }));
  for (let pass = 0; pass < order; pass++) {
    const degree = derivative.length - 1;
    if (degree <= 0) return { x: 0, y: 0 };
    derivative = derivative.slice(0, -1).map((point, index) => ({
      x: degree * (derivative[index + 1].x - point.x),
      y: degree * (derivative[index + 1].y - point.y),
    }));
  }
  return deCasteljau(derivative, t);
}

export function bezierCurvature(points: readonly BezierPoint[], t: number): number {
  const first = evaluateBezierDerivative(points, t, 1);
  const second = evaluateBezierDerivative(points, t, 2);
  const speedSquared = first.x * first.x + first.y * first.y;
  if (speedSquared < 1e-18) return Number.POSITIVE_INFINITY;
  return (first.x * second.y - first.y * second.x) / Math.pow(speedSquared, 1.5);
}

/** Geometric G1/G2 continuity analysis at a cubic-chain join. */
export function analyzeCubicContinuity(
  left: CubicBezier,
  right: CubicBezier,
  tolerance = 1e-4,
): ContinuityResult {
  const leftControls = [left.p0, left.p1, left.p2, left.p3];
  const rightControls = [right.p0, right.p1, right.p2, right.p3];
  const leftTangent = evaluateBezierDerivative(leftControls, 1, 1);
  const rightTangent = evaluateBezierDerivative(rightControls, 0, 1);
  const leftLength = Math.hypot(leftTangent.x, leftTangent.y);
  const rightLength = Math.hypot(rightTangent.x, rightTangent.y);
  const cross = leftTangent.x * rightTangent.y - leftTangent.y * rightTangent.x;
  const dot = leftTangent.x * rightTangent.x + leftTangent.y * rightTangent.y;
  const tangentAngle = Math.atan2(Math.abs(cross), dot);
  const sameJoin = distance(left.p3, right.p0) <= tolerance;
  const g1 = sameJoin && leftLength > tolerance && rightLength > tolerance && tangentAngle <= tolerance;
  const leftCurvature = bezierCurvature(leftControls, 1);
  const rightCurvature = bezierCurvature(rightControls, 0);
  const curvatureDelta = Math.abs(leftCurvature - rightCurvature);
  const g2 = g1 && Number.isFinite(curvatureDelta) && curvatureDelta <= tolerance;
  return { g1, g2, tangentAngle, curvatureDelta };
}

export function classifyBezierDegeneracy(
  points: readonly BezierPoint[],
  tolerance = 1e-7,
): "point" | "line" | "curve" {
  if (points.length === 0) return "point";
  const origin = points[0];
  if (points.every((point) => distance(point, origin) <= tolerance)) return "point";
  const farthest = points.reduce((best, point) => distance(point, origin) > distance(best, origin) ? point : best, origin);
  const baseline = { x: farthest.x - origin.x, y: farthest.y - origin.y };
  const baselineLength = Math.hypot(baseline.x, baseline.y);
  const collinear = points.every((point) => {
    const relative = { x: point.x - origin.x, y: point.y - origin.y };
    return Math.abs(relative.x * baseline.y - relative.y * baseline.x) / baselineLength <= tolerance;
  });
  return collinear ? "line" : "curve";
}

/** Approximate self-intersection classification using a sampled curve polyline. */
export function findBezierSelfIntersections(
  points: readonly BezierPoint[],
  samples = 160,
  tolerance = 1e-6,
): CurveIntersection[] {
  const count = Math.max(8, Math.floor(samples));
  const polyline = Array.from({ length: count + 1 }, (_, index) => ({
    t: index / count,
    point: deCasteljau(points, index / count),
  }));
  const intersections: CurveIntersection[] = [];
  const closedCurve = distance(polyline[0].point, polyline[count].point) <= tolerance;
  for (let first = 0; first < count; first++) {
    for (let second = first + 2; second < count; second++) {
      if (closedCurve && first === 0 && second === count - 1) continue;
      const hit = lineIntersection(
        polyline[first].point,
        polyline[first + 1].point,
        polyline[second].point,
        polyline[second + 1].point,
        tolerance,
      );
      if (!hit) continue;
      intersections.push({
        point: hit.point,
        t1: (first + hit.u) / count,
        t2: (second + hit.v) / count,
      });
    }
  }
  return deduplicateIntersections(intersections, 1 / count);
}

/** Detect intersections across a complete chain of linear/cubic Bezier segments. */
export function findBezierChainIntersections(
  segments: readonly (readonly BezierPoint[])[],
  samplesPerSegment = 48,
  tolerance = 1e-6,
): CurveIntersection[] {
  if (segments.length === 0) return [];
  const sampleCount = Math.max(8, Math.floor(samplesPerSegment));
  const edges: Array<{
    from: BezierPoint;
    to: BezierPoint;
    segment: number;
    t0: number;
    t1: number;
  }> = [];

  segments.forEach((controls, segment) => {
    for (let sample = 0; sample < sampleCount; sample++) {
      const t0 = sample / sampleCount;
      const t1 = (sample + 1) / sampleCount;
      edges.push({
        from: deCasteljau(controls, t0),
        to: deCasteljau(controls, t1),
        segment,
        t0,
        t1,
      });
    }
  });

  const intersections: CurveIntersection[] = [];
  for (let first = 0; first < edges.length; first++) {
    for (let second = first + 1; second < edges.length; second++) {
      const firstEdge = edges[first];
      const secondEdge = edges[second];
      // Consecutive edges along the chain only meet at their shared vertex.
      const consecutiveEdges = second - first === 1;
      const closedChainWraparound = first === 0 && second === edges.length - 1
        && distance(edges[0].from, edges[edges.length - 1].to) <= tolerance;
      if (consecutiveEdges || closedChainWraparound) continue;
      const hit = lineIntersection(firstEdge.from, firstEdge.to, secondEdge.from, secondEdge.to, tolerance);
      if (!hit) continue;
      intersections.push({
        point: hit.point,
        t1: firstEdge.t0 + (firstEdge.t1 - firstEdge.t0) * hit.u,
        t2: secondEdge.t0 + (secondEdge.t1 - secondEdge.t0) * hit.v,
        segment1: firstEdge.segment,
        segment2: secondEdge.segment,
      });
    }
  }
  return deduplicateIntersections(intersections, 1 / sampleCount);
}

/** Detect singular parameters where the first derivative approaches zero. */
export function findBezierSingularities(
  points: readonly BezierPoint[],
  samples = 200,
  tolerance = 1e-4,
): number[] {
  const count = Math.max(8, Math.floor(samples));
  const speed = (t: number) => {
    const derivative = evaluateBezierDerivative(points, t);
    return Math.hypot(derivative.x, derivative.y);
  };
  const singularities: number[] = [];
  // Endpoints are excluded: a collapsed endpoint handle is a common, valid way
  // to ease into a segment and does not imply an interior singularity.
  for (let index = 1; index < count; index++) {
    const t = index / count;
    const value = speed(t);
    if (value > speed((index - 1) / count) || value > speed((index + 1) / count)) continue;
    // Refine each sampled local minimum so cusps between samples are not missed.
    let low = (index - 1) / count;
    let high = (index + 1) / count;
    for (let iteration = 0; iteration < 48; iteration++) {
      const leftThird = low + (high - low) / 3;
      const rightThird = high - (high - low) / 3;
      if (speed(leftThird) <= speed(rightThird)) high = rightThird;
      else low = leftThird;
    }
    const refined = (low + high) / 2;
    if (refined > 0 && refined < 1 && speed(refined) <= tolerance) singularities.push(refined);
  }
  return singularities.filter((value, index) => index === 0 || value - singularities[index - 1] > 2 / count);
}

/** Normalized trigonometric basis for adjustable non-polynomial Bezier curves. */
export function evaluateTrigonometricBezier(
  points: readonly BezierPoint[],
  t: number,
  shape = 1,
): BezierPoint {
  if (points.length === 0) throw new Error("A Bezier curve needs at least one control point.");
  const parameter = clamp01(t);
  const degree = points.length - 1;
  const left = Math.pow(Math.sin((1 - parameter) * Math.PI / 2), Math.max(0.01, shape));
  const right = Math.pow(Math.sin(parameter * Math.PI / 2), Math.max(0.01, shape));
  const basis = points.map((_, index) => binomial(degree, index) * Math.pow(left, degree - index) * Math.pow(right, index));
  const sum = basis.reduce((total, value) => total + value, 0) || 1;
  return points.reduce((result, point, index) => ({
    x: result.x + point.x * basis[index] / sum,
    y: result.y + point.y * basis[index] / sum,
  }), { x: 0, y: 0 });
}

/** Fractional parameter control without changing endpoints or the convex hull. */
export function evaluateFractionalBezier(
  points: readonly BezierPoint[],
  t: number,
  alpha: number,
): BezierPoint {
  if (!(alpha > 0)) throw new Error("Fractional alpha must be greater than zero.");
  const parameter = clamp01(t);
  if (parameter === 0 || parameter === 1) return deCasteljau(points, parameter);
  const left = Math.pow(parameter, alpha);
  const right = Math.pow(1 - parameter, alpha);
  return deCasteljau(points, left / (left + right));
}

/** Multiple positive shape parameters; equivalent to a rational Bernstein basis. */
export function evaluateShapeParameterizedBezier(
  points: readonly BezierPoint[],
  t: number,
  shapeParameters: readonly number[],
): BezierPoint {
  if (shapeParameters.some((value) => !(value > 0))) {
    throw new Error("Shape parameters must be greater than zero.");
  }
  return evaluateRationalBezier(points, shapeParameters, t);
}

function bernstein(degree: number, index: number, t: number): number {
  return binomial(degree, index) * Math.pow(1 - t, degree - index) * Math.pow(t, index);
}

function binomial(n: number, k: number): number {
  const limit = Math.min(k, n - k);
  let result = 1;
  for (let index = 1; index <= limit; index++) result = result * (n - limit + index) / index;
  return result;
}

function lerp(a: BezierPoint, b: BezierPoint, t: number): BezierPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function lineIntersection(
  a: BezierPoint,
  b: BezierPoint,
  c: BezierPoint,
  d: BezierPoint,
  tolerance: number,
): { point: BezierPoint; u: number; v: number } | null {
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const cd = { x: d.x - c.x, y: d.y - c.y };
  const denominator = ab.x * cd.y - ab.y * cd.x;
  if (Math.abs(denominator) <= tolerance) return null;
  const ac = { x: c.x - a.x, y: c.y - a.y };
  const u = (ac.x * cd.y - ac.y * cd.x) / denominator;
  const v = (ac.x * ab.y - ac.y * ab.x) / denominator;
  // Inclusive bounds: crossings that land exactly on a sample vertex are real
  // intersections and must not be dropped by the discretization.
  if (u < -tolerance || u > 1 + tolerance || v < -tolerance || v > 1 + tolerance) return null;
  return { point: { x: a.x + ab.x * u, y: a.y + ab.y * u }, u: clamp01(u), v: clamp01(v) };
}

function deduplicateIntersections(intersections: CurveIntersection[], tolerance: number): CurveIntersection[] {
  return intersections.filter((intersection, index) => !intersections.slice(0, index).some((candidate) =>
    Math.abs(candidate.t1 - intersection.t1) <= tolerance && Math.abs(candidate.t2 - intersection.t2) <= tolerance
  ));
}

function addComplex(a: ComplexNumber, b: ComplexNumber): ComplexNumber {
  return { re: a.re + b.re, im: a.im + b.im };
}

function scaleComplex(value: ComplexNumber, scale: number): ComplexNumber {
  return { re: value.re * scale, im: value.im * scale };
}

function divideComplex(numerator: ComplexNumber, denominator: ComplexNumber): ComplexNumber {
  const magnitude = denominator.re * denominator.re + denominator.im * denominator.im;
  if (magnitude < 1e-18) throw new Error("Complex rational Bezier denominator is zero.");
  return {
    re: (numerator.re * denominator.re + numerator.im * denominator.im) / magnitude,
    im: (numerator.im * denominator.re - numerator.re * denominator.im) / magnitude,
  };
}

function assertMatchingWeights(points: readonly BezierPoint[], weights: readonly unknown[]): void {
  if (points.length === 0 || points.length !== weights.length) {
    throw new Error("Bezier points and weights must have the same non-zero length.");
  }
}

function distance(a: BezierPoint, b: BezierPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
