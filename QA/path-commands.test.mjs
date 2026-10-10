/**
 * QA — Object → Path commands (edit.ts) + Offset Path / Outline Stroke
 * (offset.ts) + the shared cubic fit the pencil reuses (trace/fit.ts).
 * Run: npm run test:path-commands
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  addAnchorPoints,
  joinPaths,
  removeRedundantPoints,
  simplifyPath,
  smoothPath,
} from "../src/lib/pathOps/edit.ts";
import { offsetPathD, outlineStrokeD } from "../src/lib/pathOps/offset.ts";
import { parsePathData, serializePathData } from "../src/lib/pathData.ts";
import { fitPolyline, subPathToD } from "../src/lib/trace/fit.ts";

// ── Helpers ──

/** Dense sample of one subpath's `d` as a closed polygon (for area tests). */
function subpathPolygons(d) {
  return d
    .split(/(?=[Mm])/)
    .map(chunk => chunk.trim())
    .filter(Boolean)
    .map(chunk => {
      const points = parsePathData(chunk);
      const closed = /z\s*$/i.test(chunk);
      const poly = [];
      const count = closed ? points.length : points.length - 1;
      for (let i = 0; i < count; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        const controls = a.cpOut || b.cpIn
          ? [a, a.cpOut ?? a, b.cpIn ?? b, b]
          : [a, b];
        const steps = controls.length === 2 ? 1 : 32;
        for (let s = poly.length === 0 ? 0 : 1; s <= steps; s++) {
          const t = s / steps;
          const u = 1 - t;
          const p0 = controls[0];
          const c1 = controls.length === 2 ? controls[0] : controls[1];
          const c2 = controls.length === 2 ? controls[1] : controls[2];
          const p1 = controls.length === 2 ? controls[1] : controls[3];
          poly.push({
            x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
            y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
          });
        }
      }
      return poly;
    })
    .filter(poly => poly.length >= 3);
}

function polygonArea(poly) {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

/** Total |area| of a compound path (holes wind opposite and subtract). */
function pathArea(d) {
  return Math.abs(subpathPolygons(d).reduce((acc, poly) => acc + polygonArea(poly), 0));
}

/** Every sampled point of a path, as its distance to (cx, cy). */
function radialDistances(d, cx, cy) {
  const out = [];
  for (const poly of subpathPolygons(d)) {
    for (const p of poly) out.push(Math.hypot(p.x - cx, p.y - cy));
  }
  return out;
}

/** Kappa Bézier circle, centre (50,50), r = 50 (the editor's circle model). */
const CIRCLE_R50 = "M 100 50 C 100 77.6 77.6 100 50 100 C 22.4 100 0 77.6 0 50 C 0 22.4 22.4 0 50 0 C 77.6 0 100 22.4 100 50 Z";

function anchor(x, y, cpIn, cpOut) {
  const p = { type: cpIn || cpOut ? "smooth" : "anchor", x, y };
  if (cpIn) p.cpIn = cpIn;
  if (cpOut) p.cpOut = cpOut;
  return p;
}

// ── Simplify ──

test("simplify never returns more anchors than the input", () => {
  // Dense sine polyline: 60 anchors, no handles.
  const pts = [];
  for (let i = 0; i < 60; i++) {
    pts.push(anchor(i * 4, 50 + Math.sin(i / 3) * 30));
  }
  const result = simplifyPath(pts, false, { tolerance: 1 });
  assert.ok(result.length <= pts.length, `${result.length} > ${pts.length}`);
  // A smooth wave collapses to a handful of cubics.
  assert.ok(result.length < 20, `expected a strong reduction, got ${result.length}`);
  assert.ok(result.some(p => p.cpOut), "simplified wave should carry curve handles");
});

test("simplify straightLines keeps only line anchors", () => {
  const pts = [];
  for (let i = 0; i < 30; i++) pts.push(anchor(i * 2, Math.sin(i) * 0.4));
  const result = simplifyPath(pts, false, { tolerance: 0.6, straightLines: true });
  assert.ok(result.length <= pts.length);
  for (const p of result) {
    assert.ok(!p.cpIn && !p.cpOut, "straight-lines output must be pure lines");
  }
});

// ── Smooth ──

test("smooth keeps both endpoints of an open path byte-identical", () => {
  const pts = [
    anchor(0, 0),
    anchor(30, 10, { x: 20, y: 2 }, { x: 40, y: 18 }),
    anchor(60, 40, { x: 50, y: 30 }, { x: 70, y: 50 }),
    anchor(100, 100),
  ];
  const result = smoothPath(pts, false, 3);
  const firstIn = result[0], firstRef = pts[0];
  const lastIn = result[result.length - 1], lastRef = pts[pts.length - 1];
  assert.equal(JSON.stringify([firstIn.x, firstIn.y, firstIn.cpIn, firstIn.cpOut]),
    JSON.stringify([firstRef.x, firstRef.y, firstRef.cpIn, firstRef.cpOut]));
  assert.equal(JSON.stringify([lastIn.x, lastIn.y, lastIn.cpIn, lastIn.cpOut]),
    JSON.stringify([lastRef.x, lastRef.y, lastRef.cpIn, lastRef.cpOut]));
  // Interior anchors gained Catmull-Rom-style handles.
  assert.ok(result[1].cpIn && result[1].cpOut, "interior handles expected");
});

// ── Add / remove anchor points ──

test("addAnchorPoints splits every segment at its midpoint", () => {
  const pts = [anchor(0, 0), anchor(20, 0), anchor(20, 20)];
  const result = addAnchorPoints(pts, false);
  assert.equal(result.length, 5);
  assert.ok(result.some(p => Math.abs(p.x - 10) < 1e-6 && Math.abs(p.y) < 1e-6));
  assert.ok(result.some(p => Math.abs(p.x - 20) < 1e-6 && Math.abs(p.y - 10) < 1e-6));
});

test("removeRedundantPoints collapses a collinear polyline", () => {
  const pts = [anchor(0, 0), anchor(10, 0), anchor(20, 0), anchor(30, 0.01), anchor(40, 0)];
  const result = removeRedundantPoints(pts, false, 0.25);
  assert.equal(result.length, 2, `expected bare endpoints, got ${result.length}`);
  assert.deepEqual([result[0].x, result[0].y], [0, 0]);
  assert.deepEqual([result[1].x, result[1].y], [40, 0]);
});

// ── Join ──

test("join of two open paths within tolerance merges into one 3-anchor path", () => {
  const a = { points: [anchor(0, 0), anchor(10, 0)], closed: false };
  const b = { points: [anchor(12, 0), anchor(30, 5)], closed: false };
  const result = joinPaths([a, b], 5);
  assert.equal(result.length, 1);
  assert.equal(result[0].points.length, 3);
  assert.equal(result[0].closed, false);
  // The merged joint keeps the first path's position.
  assert.deepEqual([result[0].points[1].x, result[0].points[1].y], [10, 0]);
});

test("join of a single open path closes it through the shared anchor", () => {
  const sp = {
    points: [anchor(0, 0), anchor(40, 10, { x: 30, y: 4 }), anchor(0, 2, { x: 10, y: 4 })],
    closed: false,
  };
  const result = joinPaths([sp], 5);
  assert.equal(result.length, 1);
  assert.equal(result[0].closed, true);
  assert.equal(result[0].points.length, 2);
  assert.ok(result[0].points[0].cpIn, "closing anchor inherits the dropped anchor's cpIn");
});

// ── Offset Path (real geometry, not bbox scaling) ──

test("offset +5 on a r=50 circle grows it to r≈55", () => {
  const d = offsetPathD(CIRCLE_R50, 5, { join: "round" });
  assert.ok(d, "offset should produce a path");
  const radii = radialDistances(d, 50, 50);
  assert.ok(radii.length > 0);
  for (const r of radii) {
    assert.ok(Math.abs(r - 55) < 1.5, `radial distance ${r.toFixed(2)} ≠ 55±1.5`);
  }
});

test("offset −5 on a r=50 circle shrinks it to r≈45", () => {
  const d = offsetPathD(CIRCLE_R50, -5, { join: "round" });
  assert.ok(d, "inset should produce a path");
  const radii = radialDistances(d, 50, 50);
  assert.ok(radii.length > 0);
  for (const r of radii) {
    assert.ok(Math.abs(r - 45) < 1.5, `radial distance ${r.toFixed(2)} ≠ 45±1.5`);
  }
});

test("offset area tracks the circle: grow/inset bracket the original", () => {
  const grow = offsetPathD(CIRCLE_R50, 5, { join: "round" });
  const inset = offsetPathD(CIRCLE_R50, -5, { join: "round" });
  assert.ok(grow && inset);
  const aGrow = pathArea(grow);
  const aInset = pathArea(inset);
  // 2% tolerance: the refit is shape-preserving, not area-exact.
  assert.ok(Math.abs(aGrow - Math.PI * 55 * 55) < 0.02 * Math.PI * 55 * 55, `grow area ${aGrow.toFixed(1)}`);
  assert.ok(Math.abs(aInset - Math.PI * 45 * 45) < 0.02 * Math.PI * 45 * 45, `inset area ${aInset.toFixed(1)}`);
  const band = Math.PI * (55 * 55 - 45 * 45);
  assert.ok(Math.abs(aGrow - aInset - band) < 0.1 * band, `band area mismatch: ${aGrow} vs ${aInset}`);
});

// ── Outline Stroke ──

test("outline stroke of a 4px line is a closed compound path of non-zero area", () => {
  const d = outlineStrokeD("M 20 50 L 120 50", 4, { cap: "round", join: "round" });
  assert.ok(d, "outline should produce a path");
  assert.match(d, /Z/, "result must be closed");
  const area = pathArea(d);
  // Stadium: 100·4 + π·2² ≈ 412.6
  assert.ok(Math.abs(area - 412.6) < 8, `area ${area.toFixed(1)} ≠ 412.6±8`);
});

test("outline stroke honors butt caps", () => {
  const d = outlineStrokeD("M 20 50 L 120 50", 4, { cap: "butt" });
  assert.ok(d);
  const area = pathArea(d);
  assert.ok(Math.abs(area - 400) < 8, `area ${area.toFixed(1)} ≠ 400±8`);
});

// ── Pencil fit (shared trace/fit.ts primitive) ──

test("pencil simulation: 3px-spaced polyline fits cubics with real handles", () => {
  // Quarter-circle arc of r = 60, resampled every ~3 px.
  const pts = [];
  const steps = Math.ceil(((Math.PI / 2) * 60) / 3);
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * (Math.PI / 2);
    pts.push([60 + Math.cos(t) * 60, 60 + Math.sin(t) * 60]);
  }
  const sp = fitPolyline(pts, false, { polygonTol: 0.8, fitTol: 1, cornerAngle: 150, snapLines: false });
  assert.ok(sp, "fit should produce a subpath");
  const d = subPathToD(sp);
  assert.match(d, /C/, "freehand output must contain cubic segments");
  const parsed = parsePathData(d);
  assert.ok(parsed.some(p => p.cpOut), "fitted anchors must carry handles");
  assert.ok(sp.anchors.length < pts.length / 3, `fit should compress ${pts.length} points, got ${sp.anchors.length}`);
  // Endpoints survive the fit.
  assert.ok(Math.hypot(parsed[0].x - pts[0][0], parsed[0].y - pts[0][1]) < 0.1);
});

// ── Serialize round-trip sanity for edit results ──

test("edit results serialize and re-parse losslessly", () => {
  const pts = [anchor(0, 0), anchor(30, 10, { x: 20, y: 2 }, { x: 40, y: 18 }), anchor(60, 40)];
  const smoothed = smoothPath(pts, false, 1);
  const d = serializePathData(smoothed, false);
  const reparsed = parsePathData(d);
  assert.equal(reparsed.length, smoothed.length);
  for (let i = 0; i < reparsed.length; i++) {
    assert.ok(Math.abs(reparsed[i].x - smoothed[i].x) < 0.01);
    assert.ok(Math.abs(reparsed[i].y - smoothed[i].y) < 0.01);
  }
});
