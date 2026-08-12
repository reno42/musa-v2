import assert from "node:assert/strict";
import test from "node:test";
import {
  canPaint,
  isBlankPaint,
  isGroupLayer,
  paintPropertiesFor,
  summarizeFills,
} from "../shared/paintModel.ts";

const svgShape = { tag: "svg", isSvg: true, svgChildTag: "path", layerKind: "shape" };
const svgText = { tag: "svg", isSvg: true, svgChildTag: "text", layerKind: "shape" };
const divShape = { tag: "div", layerKind: "shape" };
const htmlText = { tag: "h1", layerKind: "text" };
const group = { tag: "div", layerKind: "group" };
const container = { tag: "div", layerKind: "container" };
const image = { tag: "img", layerKind: "image" };

test("a group has no paint of its own", () => {
  // The whole point: a group cannot paint a box behind unrelated objects.
  // Returning nulls is what forces callers to reach the children instead.
  assert.deepEqual(paintPropertiesFor(group), { fill: null, strokeColor: null, strokeWidth: null });
  assert.equal(isGroupLayer(group), true);
  assert.equal(canPaint(group), false);
});

test("a group is never offered background-color, whatever its tag", () => {
  for (const tag of ["div", "section", "span", "h1", "svg"]) {
    assert.equal(paintPropertiesFor({ tag, layerKind: "group" }).fill, null, `${tag} as a group must not paint`);
  }
});

test("fill maps to the property the medium actually paints with", () => {
  assert.equal(paintPropertiesFor(svgShape).fill, "fill");
  assert.equal(paintPropertiesFor(svgText).fill, "fill");
  assert.equal(paintPropertiesFor(divShape).fill, "background-color");
  assert.equal(paintPropertiesFor(htmlText).fill, "color");
});

test("a text is filled with its own colour, not with a box behind it", () => {
  // The panel used to label this "BG" and write background-color, painting a
  // rectangle behind the glyphs instead of colouring them.
  const paint = paintPropertiesFor(htmlText);
  assert.equal(paint.fill, "color");
  assert.notEqual(paint.fill, "background-color");
});

test("every paintable layer carries a stroke as well as a fill", () => {
  for (const layer of [svgShape, svgText, divShape, htmlText, container]) {
    const paint = paintPropertiesFor(layer);
    assert.ok(paint.fill, "must have a fill");
    assert.ok(paint.strokeColor, "must have a stroke colour");
    assert.ok(paint.strokeWidth, "must have a stroke width");
  }
});

test("stroke maps to the outline the medium actually draws", () => {
  assert.deepEqual(
    { c: paintPropertiesFor(svgShape).strokeColor, w: paintPropertiesFor(svgShape).strokeWidth },
    { c: "stroke", w: "stroke-width" },
  );
  assert.deepEqual(
    { c: paintPropertiesFor(divShape).strokeColor, w: paintPropertiesFor(divShape).strokeWidth },
    { c: "border-color", w: "border-width" },
  );
  assert.deepEqual(
    { c: paintPropertiesFor(htmlText).strokeColor, w: paintPropertiesFor(htmlText).strokeWidth },
    { c: "-webkit-text-stroke-color", w: "-webkit-text-stroke-width" },
  );
});

test("an image has no fill — its interior is its own pixels", () => {
  assert.equal(canPaint(image), false);
});

test("blank paints are recognised however they are spelled", () => {
  for (const value of ["", "none", "transparent", "rgba(0, 0, 0, 0)", "  NONE  "]) {
    assert.equal(isBlankPaint(value), true, `${JSON.stringify(value)} is not a paint`);
  }
  assert.equal(isBlankPaint("#000000"), false);
});

// ── Selecting a group shows the fills of everything inside it ──

test("one colour across the selection collapses to a single entry", () => {
  const groups = summarizeFills([
    { layerId: "a", value: "#ff0000" },
    { layerId: "b", value: "#FF0000" },
    { layerId: "c", value: "rgb(255, 0, 0)" },
  ]);
  assert.equal(groups.length, 1, "one colour spelled three ways is one colour");
  assert.deepEqual(groups[0].layerIds, ["a", "b", "c"]);
});

test("several colours are listed, so each hex can be read and copied", () => {
  const groups = summarizeFills([
    { layerId: "a", value: "#ff0000" },
    { layerId: "b", value: "#00ff00" },
    { layerId: "c", value: "#ff0000" },
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map(g => g.layerIds), [["a", "c"], ["b"]]);
});

test("shorthand hex is the same colour as its long form", () => {
  const groups = summarizeFills([
    { layerId: "a", value: "#fff" },
    { layerId: "b", value: "#FFFFFF" },
  ]);
  assert.equal(groups.length, 1);
});

test("objects with only a stroke contribute no fill to list", () => {
  // Nothing is set, so nothing is reported — showing "transparent" would
  // claim a colour had been chosen.
  const groups = summarizeFills([
    { layerId: "a", value: "none" },
    { layerId: "b", value: "" },
    { layerId: "c", value: "transparent" },
  ]);
  assert.deepEqual(groups, []);
});

test("a fully transparent rgba is not a colour either", () => {
  assert.deepEqual(summarizeFills([{ layerId: "a", value: "rgba(12, 34, 56, 0)" }]), []);
});

test("the value kept is one a colour input can read back", () => {
  const [entry] = summarizeFills([{ layerId: "a", value: "  #AABBCC  " }]);
  assert.equal(entry.value, "#AABBCC", "trimmed, and not rewritten behind the user's back");
});
