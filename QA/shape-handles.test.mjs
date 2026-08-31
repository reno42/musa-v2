import assert from "node:assert/strict";
import test from "node:test";
import {
  bboxCorners,
  getHandleAt,
  getSegmentAt,
  getVertexAt,
  hitTestHandle,
  updateCornerRadius,
} from "../src/lib/shapeHandles.ts";
import { verticesToPath } from "../src/lib/shapePaths.ts";

const closeTo = (actual, expected, tolerance = 1e-7) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
};

// ── hitTestHandle ──

test("hitTestHandle is true inside the hit radius, false outside", () => {
  assert.equal(hitTestHandle(8, 8, 0, 0), true);   // 11.3px < 12
  assert.equal(hitTestHandle(10, 10, 0, 0), false); // 14.1px > 12
});

test("hitTestHandle respects the default 12px hit radius", () => {
  assert.equal(hitTestHandle(11, 0, 0, 0), true);   // 11px < 12
  assert.equal(hitTestHandle(12, 0, 0, 0), false);  // 12px is NOT inside (strict <)
  assert.equal(hitTestHandle(5, 5, 0, 0), true);
  assert.equal(hitTestHandle(20, 0, 0, 0), false);
});

test("hitTestHandle honors a custom hit radius", () => {
  assert.equal(hitTestHandle(9, 0, 0, 0, 8), false);
  assert.equal(hitTestHandle(7, 0, 0, 0, 8), true);
});

// ── bboxCorners / getHandleAt ──

test("bboxCorners returns TL/TR/BL/BR order", () => {
  const corners = bboxCorners(10, 20, 100, 50);
  assert.deepEqual(corners, [
    { x: 10, y: 20 },    // 0 — top-left
    { x: 110, y: 20 },   // 1 — top-right
    { x: 10, y: 70 },    // 2 — bottom-left
    { x: 110, y: 70 },   // 3 — bottom-right
  ]);
});

test("getHandleAt returns the corner index under the mouse (0-3)", () => {
  const corners = bboxCorners(0, 0, 100, 100);
  assert.equal(getHandleAt(3, 4, corners), 0);    // top-left
  assert.equal(getHandleAt(97, 2, corners), 1);   // top-right
  assert.equal(getHandleAt(5, 96, corners), 2);   // bottom-left
  assert.equal(getHandleAt(104, 105, corners), 3); // bottom-right
});

test("getHandleAt returns null when outside every handle", () => {
  const corners = bboxCorners(0, 0, 100, 100);
  assert.equal(getHandleAt(50, 50, corners), null);
  assert.equal(getHandleAt(20, 20, corners), null); // 28px from every corner
  assert.equal(getHandleAt(-50, 0, corners), null);
});

test("getHandleAt picks the NEAREST corner when hit radii overlap", () => {
  const corners = bboxCorners(0, 0, 10, 100); // narrow box: corners 0/2 overlap horizontally
  // (0,1) is 1px from top-left and 9px from bottom-left → top-left wins
  assert.equal(getHandleAt(0, 1, corners), 0);
  // (0,99) is 1px from bottom-left and 9px from top-left → bottom-left wins
  assert.equal(getHandleAt(0, 99, corners), 2);
});

test("getHandleAt honors a custom hit radius", () => {
  const corners = bboxCorners(0, 0, 100, 100);
  assert.equal(getHandleAt(10, 0, corners, 8), null); // 10px > 8
  assert.equal(getHandleAt(7, 0, corners, 8), 0);
});

// ── getVertexAt ──

test("getVertexAt finds the nearest vertex within the threshold", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 50, y: 100 },
  ];
  assert.equal(getVertexAt(3, 4, points), 0);
  assert.equal(getVertexAt(99, 2, points), 1);
  assert.equal(getVertexAt(48, 97, points), 2);
});

test("getVertexAt returns null when no vertex is close enough", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 100, y: 100 },
  ];
  assert.equal(getVertexAt(50, 50, points), null);
  assert.equal(getVertexAt(9, 0, points), null); // 9px > default 8px threshold
});

test("getVertexAt uses a custom threshold and breaks ties by first index", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];
  assert.equal(getVertexAt(5, 0, points, 8), 0);
  assert.equal(getVertexAt(50, 50, points, 80), 0); // both at equal distance (70.7 < 80)
});

// ── getSegmentAt ──

test("getSegmentAt finds the segment under the cursor with its projection", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
  // 6px above the bottom edge (0,100)-(100,100) → that segment, point (40,100)
  const hit = getSegmentAt(40, 94, points, true);
  assert.equal(hit.startIndex, 2);
  closeTo(hit.x, 40);
  closeTo(hit.y, 100);
});

test("getSegmentAt respects the threshold and returns null outside it", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];
  assert.notEqual(getSegmentAt(50, 7, points, false), null); // 7px < 8 → hit
  assert.equal(getSegmentAt(50, 8, points, false), null);  // 8px is NOT inside (strict <)
  assert.equal(getSegmentAt(50, 20, points, false), null);
});

test("getSegmentAt clamps the projection to the segment ends", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];
  // Beyond the right end: projection clamps to (100,0), distance 3 → hit
  const hit = getSegmentAt(103, 0, points, false);
  assert.equal(hit.startIndex, 0);
  closeTo(hit.x, 100);
  closeTo(hit.y, 0);
});

test("getSegmentAt connects the last vertex back to the first only when closed", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];
  // Near the closing diagonal (100,100)→(0,0): only reachable when closed.
  assert.equal(getSegmentAt(60, 64, points, false), null);
  const closedHit = getSegmentAt(60, 64, points, true);
  assert.equal(closedHit.startIndex, 2);
  closeTo(closedHit.x, 62);
  closeTo(closedHit.y, 62);
});

test("getSegmentAt picks the NEAREST segment and skips zero-length ones", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 0, y: 0 }, // duplicate — zero-length segment
    { x: 100, y: 0 },
  ];
  // 5px above the (0,0)-(100,0) edge; the degenerate segment contributes
  // nothing closer than the real one.
  const hit = getSegmentAt(50, 5, points, false);
  assert.equal(hit.startIndex, 1);
  closeTo(hit.x, 50);
  closeTo(hit.y, 0);
});

test("getSegmentAt honors a custom threshold", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];
  assert.equal(getSegmentAt(50, 10, points, false, 12).startIndex, 0); // 10px < 12
  assert.equal(getSegmentAt(50, 10, points, false, 8), null); // 10px > 8
});

// ── updateCornerRadius ──

test("updateCornerRadius with null index applies the value uniformly", () => {
  assert.deepEqual(updateCornerRadius([0, 0, 0, 0], null, 12), [12, 12, 12, 12]);
  assert.deepEqual(updateCornerRadius([4, 8, 2, 6], null, 0), [0, 0, 0, 0]);
});

test("updateCornerRadius with an index changes only that corner", () => {
  assert.deepEqual(updateCornerRadius([0, 0, 0, 0], 2, 10), [0, 0, 10, 0]);
  assert.deepEqual(updateCornerRadius([4, 8, 2, 6], 0, 20), [20, 8, 2, 6]);
  assert.deepEqual(updateCornerRadius([4, 8, 2, 6], 3, 20), [4, 8, 2, 20]);
});

test("updateCornerRadius is immutable and clamps negative values", () => {
  const radii = [4, 8, 2, 6];
  const next = updateCornerRadius(radii, 1, -5);
  assert.deepEqual(next, [4, 0, 2, 6]);
  assert.deepEqual(radii, [4, 8, 2, 6]); // original untouched
});

test("updateCornerRadius output feeds verticesToPath (per-corner radii)", () => {
  const vertices = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 50, y: 100 },
  ];
  const flat = verticesToPath(vertices, updateCornerRadius([0, 0, 0, 0], null, 0));
  const singleCorner = verticesToPath(vertices, updateCornerRadius([0, 0, 0, 0], 0, 12));
  assert.equal(typeof flat, "string");
  assert.ok(flat.length > 0);
  assert.notEqual(singleCorner, flat); // one rounded corner changes the path
  assert.ok(singleCorner.includes("Q") || singleCorner.includes("A")); // arc/quad for the rounded corner
});

// ── shapePaths API regression: verticesToPath still accepts a scalar ──

test("verticesToPath still accepts a scalar radius (uniform)", () => {
  const vertices = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 50, y: 100 },
  ];
  const fromScalar = verticesToPath(vertices, 10);
  const fromArray = verticesToPath(vertices, updateCornerRadius([0, 0, 0, 0], null, 10));
  assert.equal(fromScalar, fromArray);
  closeTo(vertices.length, 3);
});
