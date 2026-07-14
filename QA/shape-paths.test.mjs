import assert from "node:assert/strict";
import test from "node:test";
import {
  clampShapeCount,
  generatePolygonPath,
  generateStarPath,
  polygonVertices,
  starVertices,
} from "../src/lib/shapePaths.ts";

test("clamps shape counts to the 3-60 range", () => {
  assert.equal(clampShapeCount(1), 3);
  assert.equal(clampShapeCount(6.6), 7);
  assert.equal(clampShapeCount(120), 60);
  assert.equal(clampShapeCount(NaN), 3);
});

test("generates regular polygons with the requested number of sides", () => {
  const vertices = polygonVertices(120, 8);
  assert.equal(vertices.length, 8);
  // All vertices lie on the same circle around the center
  const radii = vertices.map(v => Math.hypot(v.x - 60, v.y - 60));
  for (const r of radii) assert.ok(Math.abs(r - radii[0]) < 1e-9);
  // First vertex points straight up
  assert.ok(Math.abs(vertices[0].x - 60) < 1e-9);
  assert.ok(vertices[0].y < 60);
});

test("generates stars with alternating outer/inner radii controlled by ratio", () => {
  const thin = starVertices(130, 5, 0.2);
  const thick = starVertices(130, 5, 0.8);
  assert.equal(thin.length, 10);
  const radius = (v) => Math.hypot(v.x - 65, v.y - 65);
  // Outer points identical, inner points scale with the ratio
  assert.ok(Math.abs(radius(thin[0]) - radius(thick[0])) < 1e-9);
  assert.ok(radius(thick[1]) > radius(thin[1]) * 3);
});

test("serializes closed paths, adding quadratic corners when a radius is set", () => {
  const sharp = generatePolygonPath(120, 6);
  assert.ok(sharp.startsWith("M"));
  assert.ok(sharp.trimEnd().endsWith("Z"));
  assert.ok(!sharp.includes("Q"));

  const rounded = generateStarPath(130, 5, 0.4, 8);
  assert.ok(rounded.includes("Q"));
  // One quadratic corner per vertex (5 outer + 5 inner)
  assert.equal((rounded.match(/Q/g) || []).length, 10);
});

test("corner radius never overshoots half the shortest edge", () => {
  // Huge radius on a small polygon must still produce a valid, closed path
  const path = generatePolygonPath(40, 3, 999);
  assert.ok(path.startsWith("M"));
  assert.ok(path.trimEnd().endsWith("Z"));
  const numbers = path.match(/-?\d+(\.\d+)?/g).map(Number);
  for (const value of numbers) {
    assert.ok(value >= -1 && value <= 41, `coordinate ${value} escaped the shape box`);
  }
});
