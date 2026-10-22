import assert from "node:assert/strict";
import test from "node:test";
import { canPaint, isGroupLayer, paintDeclarations, paintPropertiesFor } from "../shared/paintModel.ts";
import { readCssDeclaration, setCssDeclaration } from "../worker/runtime/functions/css-rules.mjs";

// ── The paint model an agent writes against ──

test("a group has no paint of its own, so an agent cannot paint one", () => {
  // Painting a box behind a group is the thing that must be unexpressible.
  assert.deepEqual(paintPropertiesFor({ tag: "div", layerKind: "group" }),
    { fill: null, strokeColor: null, strokeWidth: null });
  assert.equal(canPaint({ tag: "div", layerKind: "group" }), false);
  assert.equal(isGroupLayer({ tag: "div", layerKind: "group" }), true);
});

test("fill translates to whatever the layer actually paints with", () => {
  assert.equal(paintPropertiesFor({ tag: "div", layerKind: "shape" }).fill, "background-color");
  assert.equal(paintPropertiesFor({ tag: "svg", svgChildTag: "path" }).fill, "fill");
  assert.equal(paintPropertiesFor({ tag: "path" }).fill, "fill");
  assert.equal(paintPropertiesFor({ tag: "h1", layerKind: "text" }).fill, "color");
});

test("an svg with nothing paintable inside paints nothing", () => {
  assert.equal(canPaint({ tag: "svg", svgChildTag: "" }), false);
});

test("an image has no fill", () => {
  assert.equal(canPaint({ tag: "img", layerKind: "image" }), false);
});

// ── Turning intent into declarations ──

test("one intent becomes different CSS for different layers", () => {
  const intent = { fill: "#3B82F6" };
  assert.deepEqual(paintDeclarations({ tag: "div", layerKind: "shape" }, intent), { "background-color": "#3B82F6" });
  assert.deepEqual(paintDeclarations({ tag: "svg", svgChildTag: "path" }, intent), { fill: "#3B82F6" });
  assert.deepEqual(paintDeclarations({ tag: "h1", layerKind: "text" }, intent), { color: "#3B82F6" });
});

test("a bare stroke width is read as pixels", () => {
  assert.deepEqual(
    paintDeclarations({ tag: "svg", svgChildTag: "path" }, { strokeWidth: 4 }),
    { "stroke-width": "4px" },
  );
  assert.deepEqual(
    paintDeclarations({ tag: "svg", svgChildTag: "path" }, { strokeWidth: "2rem" }),
    { "stroke-width": "2rem" },
  );
});

test("a border gets a style, or its width would draw nothing", () => {
  const decls = paintDeclarations({ tag: "div", layerKind: "shape" }, { strokeWidth: 3 });
  assert.equal(decls["border-width"], "3px");
  assert.equal(decls["border-style"], "solid");
});

test("a zero border width is not given a style it does not need", () => {
  const decls = paintDeclarations({ tag: "div", layerKind: "shape" }, { strokeWidth: 0 });
  assert.equal(decls["border-width"], "0px");
  assert.equal("border-style" in decls, false);
});

test("an svg stroke needs no style property", () => {
  const decls = paintDeclarations({ tag: "svg", svgChildTag: "path" }, { strokeWidth: 3 });
  assert.equal("border-style" in decls, false);
});

test("a group yields no declarations at all", () => {
  assert.deepEqual(paintDeclarations({ tag: "div", layerKind: "group" }, { fill: "#fff", stroke: "#000" }), {});
});

test("only what was asked for is written", () => {
  const decls = paintDeclarations({ tag: "div", layerKind: "shape" }, { fill: "#fff" });
  assert.deepEqual(Object.keys(decls), ["background-color"]);
});

// ── Writing it into a stylesheet ──

test("a property is set on an existing rule without disturbing its neighbours", () => {
  const css = `[data-layer-id="a"] { top: 5px; background-color: red; width: 10px; }`;
  const out = setCssDeclaration(css, '[data-layer-id="a"]', "background-color", "#00ff00");
  assert.equal(readCssDeclaration(out, '[data-layer-id="a"]', "background-color"), "#00ff00");
  assert.equal(readCssDeclaration(out, '[data-layer-id="a"]', "top"), "5px");
  assert.equal(readCssDeclaration(out, '[data-layer-id="a"]', "width"), "10px");
});

test("the semicolon closing the previous declaration survives a rewrite", () => {
  const css = `[data-layer-id="a"] { top: 5px; color: red; }`;
  const out = setCssDeclaration(css, '[data-layer-id="a"]', "color", "blue");
  assert.match(out, /top:\s*5px\s*;/);
});

test("a property is not matched inside a longer one", () => {
  const css = `[data-layer-id="a"] { -webkit-border-color: red; }`;
  const out = setCssDeclaration(css, '[data-layer-id="a"]', "border-color", "#123456");
  assert.match(out, /-webkit-border-color:\s*red/, "the vendor property must be left alone");
  assert.equal(readCssDeclaration(out, '[data-layer-id="a"]', "border-color"), "#123456");
});

test("a missing rule is created", () => {
  const out = setCssDeclaration("", '[data-layer-id="new"]', "fill", "#abcdef");
  assert.equal(readCssDeclaration(out, '[data-layer-id="new"]', "fill"), "#abcdef");
});

test("extra declarations are written only when the rule is new", () => {
  const created = setCssDeclaration("", '[data-layer-id="a"]', "left", "10px", "position: absolute;");
  assert.match(created, /position:\s*absolute/);

  const existing = setCssDeclaration(`[data-layer-id="a"] { left: 0px; }`,
    '[data-layer-id="a"]', "left", "10px", "position: absolute;");
  assert.doesNotMatch(existing, /position:\s*absolute/, "an existing rule is not given a position it did not ask for");
});

test("a value containing $ is not re-read as a replacement pattern", () => {
  const css = `[data-layer-id="a"] { background-image: url("a$&b.png"); color: red; }`;
  const out = setCssDeclaration(css, '[data-layer-id="a"]', "color", "blue");
  assert.match(out, /a\$&b\.png/);
});

test("reading a property that is not set returns nothing rather than guessing", () => {
  assert.equal(readCssDeclaration(`[data-layer-id="a"] { color: red; }`, '[data-layer-id="a"]', "fill"), "");
  assert.equal(readCssDeclaration("", '[data-layer-id="a"]', "fill"), "");
});
