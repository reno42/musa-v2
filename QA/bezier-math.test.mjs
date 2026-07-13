import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeCubicContinuity,
  classifyBezierDegeneracy,
  deCasteljau,
  elevateBezierDegree,
  evaluateComplexRationalBezier,
  evaluateFractionalBezier,
  evaluateRationalBezier,
  evaluateTrigonometricBezier,
  findBezierChainIntersections,
  findBezierSingularities,
} from "../src/lib/bezierMath.ts";
import {
  analyzePathData,
  createSmoothPoint,
  movePathHandle,
  parsePathData,
  serializePathData,
  splitPathSegment,
  toggleSmoothCorner,
} from "../src/lib/pathData.ts";

const closeTo = (actual, expected, tolerance = 1e-7) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
};

test("owns cubic controls on the anchors they actually control", () => {
  const points = parsePathData("M 0 0 C 25 0 75 100 100 100");
  assert.deepEqual(points[0].cpOut, { x: 25, y: 0 });
  assert.deepEqual(points[1].cpIn, { x: 75, y: 100 });
  assert.equal(serializePathData(points), "M 0 0 C 25 0 75 100 100 100");
});

test("click creates straight anchors and click-drag creates symmetric handles", () => {
  const straight = [
    { type: "anchor", x: 0, y: 0 },
    { type: "anchor", x: 100, y: 50 },
  ];
  assert.equal(serializePathData(straight), "M 0 0 L 100 50");

  const first = createSmoothPoint({ x: 0, y: 0 }, { x: 40, y: 0 });
  const second = createSmoothPoint({ x: 100, y: 100 }, { x: 140, y: 100 });
  assert.deepEqual(second.cpIn, { x: 60, y: 100 });
  assert.equal(serializePathData([first, second]), "M 0 0 C 40 0 60 100 100 100");
});

test("moves linked handles collinearly while preserving opposite length", () => {
  const point = createSmoothPoint({ x: 50, y: 50 }, { x: 80, y: 50 });
  const linked = movePathHandle([point], 0, "cpOut", { x: 50, y: 90 }, true)[0];
  assert.deepEqual(linked.cpOut, { x: 50, y: 90 });
  closeTo(linked.cpIn.x, 50);
  closeTo(linked.cpIn.y, 20);
  assert.equal(linked.type, "smooth");

  const broken = movePathHandle([linked], 0, "cpOut", { x: 90, y: 90 }, false)[0];
  assert.deepEqual(broken.cpIn, linked.cpIn);
  assert.equal(broken.type, "anchor");
});

test("converts straight anchors to aligned curves and back", () => {
  const points = [
    { type: "anchor", x: 0, y: 50 },
    { type: "anchor", x: 50, y: 50 },
    { type: "anchor", x: 100, y: 50 },
  ];
  const curved = toggleSmoothCorner(points, 1);
  assert.equal(curved[1].type, "smooth");
  closeTo(curved[1].cpIn.y, 50);
  closeTo(curved[1].cpOut.y, 50);
  assert.deepEqual(toggleSmoothCorner(curved, 1)[1], { type: "anchor", x: 50, y: 50 });
});

test("subdivides cubic paths exactly with De Casteljau", () => {
  const points = parsePathData("M 0 0 C 20 80 80 80 100 0");
  const split = splitPathSegment(points, 1, 0.35);
  assert.equal(split.length, 3);

  const originalControls = [points[0], points[0].cpOut, points[1].cpIn, points[1]];
  const leftControls = [split[0], split[0].cpOut, split[1].cpIn, split[1]];
  const rightControls = [split[1], split[1].cpOut, split[2].cpIn, split[2]];
  for (const t of [0, 0.1, 0.35, 0.7, 1]) {
    const expected = deCasteljau(originalControls, t);
    const actual = t <= 0.35
      ? deCasteljau(leftControls, t / 0.35)
      : deCasteljau(rightControls, (t - 0.35) / 0.65);
    closeTo(actual.x, expected.x, 1e-6);
    closeTo(actual.y, expected.y, 1e-6);
  }
});

test("preserves curved closure handles through parse and serialization", () => {
  const source = "M 0 0 C 20 0 80 0 100 0 C 100 20 0 80 0 0 Z";
  const points = parsePathData(source);
  assert.equal(points.length, 2);
  assert.deepEqual(points[0].cpIn, { x: 0, y: 80 });
  assert.equal(serializePathData(points, true), source);
});

test("evaluates rational conics and complex rational weights", () => {
  const controls = [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const weights = [1, Math.SQRT1_2, 1];
  const midpoint = evaluateRationalBezier(controls, weights, 0.5);
  closeTo(midpoint.x, Math.SQRT1_2);
  closeTo(midpoint.y, Math.SQRT1_2);

  const complex = evaluateComplexRationalBezier(controls, weights.map(re => ({ re, im: 0 })), 0.5);
  closeTo(complex.x.re, midpoint.x);
  closeTo(complex.y.re, midpoint.y);
  closeTo(complex.x.im, 0);
});

test("supports arbitrary degree and degree elevation without shape changes", () => {
  const controls = [
    { x: 0, y: 0 }, { x: 10, y: 40 }, { x: 30, y: -20 },
    { x: 60, y: 60 }, { x: 100, y: 0 },
  ];
  const elevated = elevateBezierDegree(controls, 2);
  assert.equal(elevated.length, controls.length + 2);
  for (const t of [0, 0.2, 0.5, 0.85, 1]) {
    const expected = deCasteljau(controls, t);
    const actual = deCasteljau(elevated, t);
    closeTo(actual.x, expected.x, 1e-6);
    closeTo(actual.y, expected.y, 1e-6);
  }
});

test("classifies G1/G2 joins and degenerate control polygons", () => {
  const continuity = analyzeCubicContinuity(
    { p0: { x: 0, y: 0 }, p1: { x: 20, y: 0 }, p2: { x: 40, y: 0 }, p3: { x: 60, y: 0 } },
    { p0: { x: 60, y: 0 }, p1: { x: 80, y: 0 }, p2: { x: 100, y: 0 }, p3: { x: 120, y: 0 } },
  );
  assert.equal(continuity.g1, true);
  assert.equal(continuity.g2, true);
  assert.equal(classifyBezierDegeneracy([{ x: 2, y: 2 }, { x: 2, y: 2 }]), "point");
  assert.equal(classifyBezierDegeneracy([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 }]), "line");
  assert.equal(classifyBezierDegeneracy([{ x: 0, y: 0 }, { x: 10, y: 20 }, { x: 20, y: 0 }]), "curve");
});

test("detects chain self-intersections and interior singularities", () => {
  const bowTie = [
    [{ x: 0, y: 0 }, { x: 100, y: 100 }],
    [{ x: 100, y: 100 }, { x: 0, y: 100 }],
    [{ x: 0, y: 100 }, { x: 100, y: 0 }],
  ];
  const intersections = findBezierChainIntersections(bowTie, 16);
  assert.equal(intersections.length, 1);
  closeTo(intersections[0].point.x, 50);
  closeTo(intersections[0].point.y, 50);

  // This degenerate cubic reverses direction twice; its speed vanishes exactly
  // at t = (3 ± √3) / 6, not at t = 0.5 (there the velocity is (-1.5, -1.5)).
  const singular = findBezierSingularities([
    { x: 0, y: 0 }, { x: 1, y: 1 }, { x: -1, y: -1 }, { x: 0, y: 0 },
  ], 200, 1e-3);
  const cusps = [(3 - Math.sqrt(3)) / 6, (3 + Math.sqrt(3)) / 6];
  assert.equal(singular.length, 2);
  for (const cusp of cusps) {
    assert.ok(singular.some(t => Math.abs(t - cusp) < 1e-3), `missing cusp near ${cusp}`);
  }
});

test("offers fractional and trigonometric shape controls without losing endpoints", () => {
  const controls = [{ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 }];
  assert.deepEqual(evaluateFractionalBezier(controls, 0, 0.5), controls[0]);
  assert.deepEqual(evaluateFractionalBezier(controls, 1, 2), controls[2]);
  const trigStart = evaluateTrigonometricBezier(controls, 0, 1.5);
  const trigEnd = evaluateTrigonometricBezier(controls, 1, 1.5);
  closeTo(trigStart.x, controls[0].x);
  closeTo(trigStart.y, controls[0].y);
  closeTo(trigEnd.x, controls[2].x);
  closeTo(trigEnd.y, controls[2].y);
});

test("annotates a complete path analysis", () => {
  const analysis = analyzePathData("M 0 0 L 100 100 L 0 100 L 100 0");
  assert.equal(analysis.degeneracy, "curve");
  assert.equal(analysis.selfIntersections, 1);
  assert.equal(analysis.singularities, 0);
});
