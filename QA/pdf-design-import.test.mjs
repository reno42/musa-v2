import assert from "node:assert/strict";
import test from "node:test";

import {
  applyMatrix,
  buildPathBuffer,
  bucketTextLines,
  DRAW_OPS,
  cmykToHex,
  grayToHex,
  matrixScale,
  mulMatrix,
  psFontMeta,
  rgbToHex,
  shadingFillSvg,
  unionBox,
} from "../src/lib/pdfImportUtils.ts";

// pdf.js v6 fused-path tests: buffers carry DrawOPS codes in PDF user space.
test("buildPathBuffer decodes fused buffers through the viewport y-flip and detects rects", () => {
  // "10 10 50 50 re" on a 100pt-tall page: user space (y-up) → CSS space.
  const rect = buildPathBuffer([
    DRAW_OPS.moveTo, 10, 10, DRAW_OPS.lineTo, 60, 10, DRAW_OPS.lineTo, 60, 60, DRAW_OPS.lineTo, 10, 60, DRAW_OPS.closePath,
  ], [1, 0, 0, -1, 0, 100]);
  assert.equal(rect.d, "M10 90L60 90L60 40L10 40Z");
  assert.deepEqual(rect.rect, { x: 10, y: 40, width: 50, height: 50 });
});

test("buildPathBuffer maps curves, quadratics and rejects corrupt buffers", () => {
  const curve = buildPathBuffer([DRAW_OPS.moveTo, 0, 0, DRAW_OPS.curveTo, 10, 0, 10, 10, 20, 10], [1, 0, 0, 1, 0, 0]);
  assert.equal(curve.d, "M0 0C10 0 10 10 20 10");
  assert.equal(curve.rect, null);
  // Quadratic → cubic: controls two thirds of the way to the control point.
  const quad = buildPathBuffer([DRAW_OPS.moveTo, 0, 0, DRAW_OPS.quadraticCurveTo, 10, 10, 20, 0], [1, 0, 0, 1, 0, 0]);
  assert.equal(quad.d, "M0 0C6.67 6.67 13.33 6.67 20 0");
  assert.equal(buildPathBuffer([99, 1, 2], [1, 0, 0, 1, 0, 0]), null);
  assert.equal(buildPathBuffer([], [1, 0, 0, 1, 0, 0]), null);
  assert.equal(buildPathBuffer(null, [1, 0, 0, 1, 0, 0]), null);
});

test("matrix helpers compose like pdf.js Util.transform and flip Y for viewports", () => {
  const translate = [1, 0, 0, 1, 5, 7];
  assert.deepEqual(applyMatrix(translate, 1, 1), [6, 8]);
  const composed = mulMatrix(translate, translate);
  assert.deepEqual(applyMatrix(composed, 0, 0), [10, 14]);
  // Canonical viewport transform: y-up PDF space → y-down CSS space.
  assert.deepEqual(applyMatrix([1, 0, 0, -1, 0, 100], 10, 10), [10, 90]);
  assert.deepEqual(matrixScale([0, 1, -1, 0, 0, 0]), { x: 1, y: 1 });
});

test("psFontMeta recovers family, weight and style from PostScript names", () => {
  assert.deepEqual(psFontMeta("ABCDEF+Helvetica-Bold"), { family: "Helvetica", weight: 700, style: "normal", key: "Helvetica|700|normal" });
  assert.deepEqual(psFontMeta("OpenSans-SemiBold"), { family: "Open Sans", weight: 600, style: "normal", key: "Open Sans|600|normal" });
  const black = psFontMeta("Arial-BlackOblique");
  assert.equal(black.family, "Arial");
  assert.equal(black.weight, 900);
  assert.equal(black.style, "italic");
  assert.equal(psFontMeta("Times-Roman").family, "Times");
  assert.equal(psFontMeta("Times-Roman").weight, 400);
  assert.equal(psFontMeta("Helvetica").weight, 400);
  assert.equal(psFontMeta("Union").weight, 400); // "uni..." must not trip style stripping
});

test("bucketTextLines merges runs on the same baseline and inserts spaces", () => {
  const merged = bucketTextLines([
    { x: 70, y: 100, fontSize: 12, key: "k", text: "Musa", width: 40 },
    { x: 10, y: 100, fontSize: 12, key: "k", text: "Hola", width: 40 },
    { x: 10, y: 130, fontSize: 12, key: "k", text: "Otra", width: 30 },
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].text, "Hola Musa");
  assert.equal(merged[0].width, 100);
  assert.equal(merged[1].text, "Otra");
});

test("shadingFillSvg builds axial and radial gradients and rejects the rest", () => {
  const axial = shadingFillSvg({
    type: 2,
    coords: [0, 0, 100, 0],
    stops: [{ offset: 0, color: [1, 0, 0, 1] }, { offset: 1, color: [0, 0, 1, 1] }],
  }, "grad-1");
  assert.ok(axial);
  assert.match(axial.defs, /linearGradient id="grad-1" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="0"/);
  assert.match(axial.defs, /stop-color="#ff0000"/);
  assert.match(axial.defs, /stop-color="#0000ff"/);
  assert.equal(axial.fill, "url(#grad-1)");
  const radial = shadingFillSvg({
    type: 3,
    coords: [50, 50, 0, 50, 50, 40],
    stops: [{ offset: 0, color: [1, 1, 1] }, { offset: 1, color: [0, 0, 0] }],
  }, "grad-2");
  assert.ok(radial);
  assert.match(radial.defs, /radialGradient id="grad-2" gradientUnits="userSpaceOnUse" cx="50" cy="50" r="40"/);
  assert.equal(shadingFillSvg({ type: 6, coords: [1, 2, 3], stops: [] }, "x"), null);
  assert.equal(shadingFillSvg({ type: 2, coords: [0, 0, 100, 0], stops: [] }, "x"), null);
});

test("color helpers cover rgb, gray and cmyk operators", () => {
  assert.equal(rgbToHex(255, 0, 0), "#ff0000");
  assert.equal(grayToHex(0.5), "#808080");
  assert.equal(cmykToHex(0, 1, 1, 0), "#ff0000");
  assert.equal(cmykToHex(1, 0, 0, 0), "#00ffff");
});

test("unionBox envelopes boxes and degrades to a unit box when empty", () => {
  assert.deepEqual(unionBox([{ x: 10, y: 40, width: 50, height: 50 }, { x: 0, y: 0, width: 5, height: 5 }]), { x: 0, y: 0, width: 60, height: 90 });
  assert.deepEqual(unionBox([]), { x: 0, y: 0, width: 1, height: 1 });
});
