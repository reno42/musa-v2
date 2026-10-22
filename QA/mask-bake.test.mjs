import assert from "node:assert/strict";
import test from "node:test";
import {
  MASK_CSS_PROPERTIES,
  bakePathMask,
  parseBrushesAttr,
  pathDataBounds,
  readLayerBox,
  readViewBox,
  serializeBrushesAttr,
  transformPathData,
} from "../shared/maskBake.ts";
import { readCssDeclaration, removeCssDeclarations, setCssDeclaration } from "../worker/runtime/functions/css-rules.mjs";

// ── Path data transform ──

/** Collapses whitespace AND the space after a command letter, so the
 * serializer's compact "M10 20" compares equal to a hand-written "M 10 20". */
const sameD = (a, b) => norm(a) === norm(b);
const norm = s => s.replace(/\s+/g, " ").replace(/([MmLlHhVvCcSsQqTtAaZz]) /g, "$1").trim();

test("identity transform leaves path data unchanged in shape", () => {
  const d = "M 10 20 C 30 40 50 60 70 80 Z";
  assert.ok(sameD(transformPathData(d, { sx: 1, sy: 1, dx: 0, dy: 0 }), d));
});

test("translation shifts absolute coordinates, not relative deltas", () => {
  const out = transformPathData("M 0 0 l 10 10 L 20 20 Z", { sx: 1, sy: 1, dx: 100, dy: 50 });
  // The l deltas stay; the M and L endpoints move.
  assert.equal(norm(out), "M100 50 l10 10 L120 70 Z");
});

test("multi-pair M re-emits the extra pairs as L, never as new subpaths", () => {
  const out = transformPathData("M 1 2 3 4 Z", { sx: 1, sy: 1, dx: 10, dy: 10 });
  assert.equal(norm(out), "M11 12 L13 14 Z");
});

test("scaling multiplies absolute points, relative deltas and arc radii", () => {
  const out = transformPathData("M 0 0 a 5 5 0 0 1 10 10 Z", { sx: 2, sy: 2, dx: 0, dy: 0 });
  assert.equal(norm(out), "M0 0 a10 10 0 0 1 20 20 Z");
});

test("H and V take their single coordinate through the transform", () => {
  const out = transformPathData("M 0 0 H 10 V 10 Z", { sx: 1, sy: 1, dx: 5, dy: 7 });
  assert.equal(norm(out), "M5 7 H15 V17 Z");
});

test("pathDataBounds covers anchors and control points, resolving relatives", () => {
  const bounds = pathDataBounds("M 100 100 c 50 -50 100 0 100 50 Z");
  assert.equal(bounds.left, 100);
  assert.equal(bounds.top, 50); // the first control point dips above the anchors
  assert.equal(bounds.width, 100);
  assert.equal(bounds.height, 100);
  assert.equal(pathDataBounds("garbage"), null);
});

// ── Geometry readers ──

test("readViewBox parses the four numbers or gives up", () => {
  assert.deepEqual(readViewBox("10 20 300 200"), { left: 10, top: 20, width: 300, height: 200 });
  assert.equal(readViewBox(""), null);
  assert.equal(readViewBox(null), null);
});

test("readLayerBox prefers inline style over the CSS rule", () => {
  const css = '[data-layer-id="img1"] {\n  position: absolute;\n  left: 0px;\n  top: 0px;\n  width: 200px;\n  height: 100px;\n}';
  assert.deepEqual(readLayerBox(null, css, "img1"), { left: 0, top: 0, width: 200, height: 100 });
  // Inline overrides left, CSS fills the rest.
  assert.deepEqual(readLayerBox("left: 40px;", css, "img1"), { left: 40, top: 0, width: 200, height: 100 });
  // No px box anywhere → null, the caller decides what that means.
  assert.equal(readLayerBox(null, css, "missing"), null);
  assert.equal(readLayerBox("position:absolute;", "", "img1"), null);
});

// ── Brush round-trip ──

test("brushes survive the attribute round-trip and reject junk", () => {
  const strokes = [
    { points: [{ x: 1.5, y: 2 }, { x: 3, y: 4 }], size: 24, mode: "erase" },
    { points: [{ x: 9, y: 9 }], size: 8, mode: "restore" },
  ];
  assert.deepEqual(parseBrushesAttr(serializeBrushesAttr(strokes)), strokes);
  assert.deepEqual(parseBrushesAttr("not json"), []);
  assert.deepEqual(parseBrushesAttr('[{"points":[],"size":10}]'), []);
  // A missing size defaults, an unknown mode reads as erase.
  assert.deepEqual(
    parseBrushesAttr('[{"points":[{"x":0,"y":0}]}]'),
    [{ points: [{ x: 0, y: 0 }], size: 12, mode: "erase" }],
  );
});

// ── The bake ──

const GEOMETRY = {
  // The classic draw_bezier shape: viewBox origin equals the layer box origin,
  // so path coordinates ARE frame coordinates.
  pathData: "M 120 130 C 150 100 200 100 230 130 C 200 160 150 160 120 130 Z",
  pathBox: { left: 120, top: 100, width: 110, height: 60 },
  viewBox: { left: 120, top: 100, width: 110, height: 60 },
  imageBox: { left: 100, top: 100, width: 200, height: 150 },
};

test("include without brushes bakes a clip-path in image-local coordinates", () => {
  const baked = bakePathMask({ ...GEOMETRY, mode: "include" });
  assert.equal(baked.property, "clip-path");
  // Frame point 120,130 minus image origin 100,100 = local 20,30.
  assert.match(baked.value, /^path\("evenodd, M20 30/);
  assert.equal(Object.keys(baked.companions).length, 0, "a clip needs no companions");
});

test("exclude bakes a self-contained SVG mask: white world, black subject", () => {
  const baked = bakePathMask({ ...GEOMETRY, mode: "exclude" });
  assert.equal(baked.property, "mask-image");
  assert.match(baked.value, /^url\("data:image\/svg\+xml;base64,/);
  assert.equal(baked.companions["mask-size"], "100% 100%");
  assert.equal(baked.companions["mask-repeat"], "no-repeat");

  const svg = Buffer.from(baked.value.slice("url(\"data:image/svg+xml;base64,".length, -2), "base64").toString("utf8");
  assert.match(svg, /width="200" height="150" viewBox="0 0 200 150"/);
  assert.match(svg, /<rect x="0" y="0" width="200" height="150" fill="#ffffff"\/>/);
  assert.match(svg, /<path d="M20 30 [^"]*" fill="#000000" fill-rule="evenodd"\/>/);
  // No url(#id) reference anywhere — that is the whole point.
  assert.doesNotMatch(svg, /url\(#/);
});

test("include with brushes routes through the mask: black world, white subject, dabs in order", () => {
  const brushes = [
    { points: [{ x: 10, y: 10 }, { x: 30, y: 30 }], size: 24, mode: "erase" },
    { points: [{ x: 50, y: 50 }], size: 8, mode: "restore" },
  ];
  const baked = bakePathMask({ ...GEOMETRY, mode: "include", brushes });
  assert.equal(baked.property, "mask-image");
  const svg = Buffer.from(baked.value.slice("url(\"data:image/svg+xml;base64,".length, -2), "base64").toString("utf8");
  assert.match(svg, /fill="#000000"\/>/); // base rect hides all
  const subjectAt = svg.indexOf('fill="#ffffff" fill-rule="evenodd"');
  const eraseAt = svg.indexOf('stroke="#000000" stroke-width="24"');
  const restoreAt = svg.indexOf('stroke="#ffffff" stroke-width="8"');
  assert.ok(subjectAt > -1 && eraseAt > subjectAt && restoreAt > eraseAt, "layers paint in order: subject, erase, restore");
});

test("a null viewBox means the d is already in frame coordinates", () => {
  const baked = bakePathMask({
    ...GEOMETRY,
    viewBox: null,
    mode: "include",
  });
  // No viewBox rescaling or layer offset — only the image origin moves it.
  assert.match(baked.value, /^path\("evenodd, M20 30/);
});

test("unbakeable inputs return null instead of throwing", () => {
  assert.equal(bakePathMask({ ...GEOMETRY, pathData: "  " , mode: "include" }), null);
  assert.equal(bakePathMask({ ...GEOMETRY, viewBox: { left: 0, top: 0, width: 0, height: 1 }, mode: "include" }), null);
});

// ── The CSS round-trip both surfaces run on every bake ──

test("clearing stale mask declarations then setting the fresh one is lossless", () => {
  const imgSel = '[data-layer-id="img1"]';
  let css = '[data-layer-id="img1"] {\n  position: absolute;\n  left: 10px;\n  top: 10px;\n  width: 200px;\n  height: 150px;\n  object-fit: contain;\n}';
  // An older exclude bake left a mask behind…
  css = setCssDeclaration(css, imgSel, "mask-image", 'url("data:image/svg+xml;base64,AAAA")');
  css = setCssDeclaration(css, imgSel, "mask-size", "100% 100%");
  // …the new include bake clears every mask property and writes its clip.
  for (const property of MASK_CSS_PROPERTIES) css = removeCssDeclarations(css, imgSel, property);
  css = setCssDeclaration(css, imgSel, "clip-path", 'path("evenodd, M 0 0 L 10 0 L 10 10 Z")');

  assert.equal(readCssDeclaration(css, imgSel, "mask-image"), "");
  assert.equal(readCssDeclaration(css, imgSel, "mask-size"), "");
  assert.equal(readCssDeclaration(css, imgSel, "clip-path"), 'path("evenodd, M 0 0 L 10 0 L 10 10 Z")');
  assert.equal(readCssDeclaration(css, imgSel, "object-fit"), "contain", "unrelated declarations survive");
});

test("removing the last declaration drops the rule instead of leaving a husk", () => {
  const sel = '[data-layer-id="gone"]';
  let css = 'body { color: red; }\n[data-layer-id="gone"] {\n  clip-path: path("evenodd, M 0 0 Z");\n}';
  css = removeCssDeclarations(css, sel, "clip-path");
  assert.doesNotMatch(css, /data-layer-id="gone"/);
  assert.match(css, /body \{ color: red; \}/);
});
