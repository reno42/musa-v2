import assert from "node:assert/strict";
import test from "node:test";
import {
  clampShapeCount,
  cornersFromShapePath,
  generatePolygonPath,
  generateStarPath,
  normalizeRadii,
  parametricVertices,
  parseVertexRadiiAttr,
  polygonVertices,
  serializeVertexRadiiAttr,
  starVertices,
  verticesToPath,
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
  const numbers = path.match(/-?\d+(?:\.\d+)?/g).map(Number);
  for (const value of numbers) {
    assert.ok(value >= -1 && value <= 41, `coordinate ${value} escaped the shape box`);
  }
});

// ── F4: per-vertex radii ──

test("per-vertex radii round only the vertices with radius > 0", () => {
  const vertices = polygonVertices(120, 6);
  const radii = [12, 0, 12, 0, 12, 0];
  const path = verticesToPath(vertices, radii);
  // One quadratic per rounded vertex (3), sharp vertices stay as L commands
  assert.equal((path.match(/Q/g) || []).length, 3);
  assert.ok(path.trimEnd().endsWith("Z"));
});

test("rounded corners can be recovered from the serialized path", () => {
  const source = { kind: "polygon", count: 5, ratio: 1, size: 120 };
  const base = parametricVertices(source);
  const radii = [0, 10, 0, 0, 24];
  const path = verticesToPath(base, radii);
  const recovered = cornersFromShapePath(path);
  assert.ok(recovered);
  assert.equal(recovered.length, 5);
  for (let index = 0; index < base.length; index++) {
    assert.ok(Math.abs(recovered[index].x - base[index].x) < 0.02, `vertex ${index} x`);
    assert.ok(Math.abs(recovered[index].y - base[index].y) < 0.02, `vertex ${index} y`);
  }
});

test("sharp paths expose their vertices directly as corners", () => {
  const path = generatePolygonPath(120, 4);
  const corners = cornersFromShapePath(path);
  assert.ok(corners);
  assert.equal(corners.length, 4);
  const base = polygonVertices(120, 4);
  assert.ok(Math.abs(corners[2].x - base[2].x) < 0.02);
});

test("corner recovery rejects cubic pen paths", () => {
  assert.equal(cornersFromShapePath("M10 10 C 40 10 60 40 90 90 Z"), null);
});

test("vertex radius attribute parsing merges overrides over the uniform radius", () => {
  assert.deepEqual(parseVertexRadiiAttr(null, 8, 4), [8, 8, 8, 8]);
  assert.deepEqual(parseVertexRadiiAttr("0,12", 8, 3), [0, 12, 8]);
  assert.equal(serializeVertexRadiiAttr(parseVertexRadiiAttr("0,12", 8, 3)), "0,12,8");
});

test("normalizeRadii pads and clamps to the vertex count", () => {
  assert.deepEqual(normalizeRadii(5, 3), [5, 5, 5]);
  assert.deepEqual(normalizeRadii([2, -4], 4), [2, 0, 0, 0]);
});
