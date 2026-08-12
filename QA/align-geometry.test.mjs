import assert from "node:assert/strict";
import test from "node:test";
import {
  alignElements,
  applyAlignment,
  collectElements,
  computeAlignValue,
  readPixels,
  targetPosition,
} from "../netlify/functions/align-geometry.mjs";

const css = `
[data-layer-id="a"] { position: absolute; left: 10px; top: 40px; width: 100px; height: 20px; }
[data-layer-id="b"] { position: absolute; left: 200px; top: 90px; width: 60px; height: 80px; }
`;

const leftOf = (sheet, id) =>
  readPixels(new RegExp(`\\[data-layer-id="${id}"\\]\\s*\\{([^}]*)\\}`).exec(sheet)[1], "left");
const topOf = (sheet, id) =>
  readPixels(new RegExp(`\\[data-layer-id="${id}"\\]\\s*\\{([^}]*)\\}`).exec(sheet)[1], "top");

test("reads negative and fractional coordinates", () => {
  // `\d+` matched neither, so an element at -20px read as sitting at 0 and got
  // aligned against a phantom origin at the frame's edge.
  assert.equal(readPixels("left: -20px;", "left"), -20);
  assert.equal(readPixels("left: 12.5px;", "left"), 12.5);
  assert.equal(readPixels("left: .5px;", "left"), 0.5);
  assert.equal(readPixels("top: 0px;", "top"), 0);
});

test("does not find a property inside a longer one", () => {
  assert.equal(readPixels("border-left: 4px; left: 30px;", "left"), 30);
  assert.equal(readPixels("border-left: 4px;", "left"), null);
  assert.equal(readPixels("margin-top: 8px;", "top"), null);
});

test("distinguishes an absent width from a zero width", () => {
  const { elements } = collectElements({
    css: `[data-layer-id="x"] { left: 5px; top: 5px; }`,
    elementIds: ["x"],
  });
  assert.equal(elements[0].width, null);
  assert.equal(elements[0].left, 5);
});

test("every alignment moves elements to a different place", () => {
  // The whole bug in one assertion: with the parameter name mismatched, all
  // six of these produced identical output.
  const results = new Set();
  for (const align of ["left", "center", "right", "top", "middle", "bottom"]) {
    results.add(alignElements({ css, elementIds: ["a", "b"], align }).css);
  }
  assert.equal(results.size, 6, "each alignment must produce a distinct result");
});

test("aligns to the selection, not to the frame", () => {
  // Left edges are 10 and 200; the selection's left edge is 10, and neither
  // element may be dragged to the frame's origin at 0.
  const out = alignElements({ css, elementIds: ["a", "b"], align: "left", frameWidth: 1080, frameHeight: 1080 }).css;
  assert.equal(leftOf(out, "a"), 10);
  assert.equal(leftOf(out, "b"), 10);
});

test("right alignment lands the far edges together, not the leading ones", () => {
  // a spans 10..110, b spans 200..260, so the selection's right edge is 260.
  const out = alignElements({ css, elementIds: ["a", "b"], align: "right" }).css;
  assert.equal(leftOf(out, "a"), 160, "a's right edge must reach 260");
  assert.equal(leftOf(out, "b"), 200);
});

test("bottom alignment uses each element's own height", () => {
  // a spans 40..60, b spans 90..170, so the selection's bottom edge is 170.
  const out = alignElements({ css, elementIds: ["a", "b"], align: "bottom" }).css;
  assert.equal(topOf(out, "a"), 150);
  assert.equal(topOf(out, "b"), 90);
});

test("moves every element in the selection, not just one", () => {
  const out = alignElements({ css, elementIds: ["a", "b"], align: "center" }).css;
  // Centres are 60 and 230, averaging 145; a is 100 wide and b is 60.
  assert.equal(leftOf(out, "a"), 95);
  assert.equal(leftOf(out, "b"), 115);
});

test("measured bounds win over the stylesheet, so auto-sized text can align", () => {
  // An auto-sized text carries no width rule. Read from CSS alone its width is
  // 0, and right-aligning it would strand its left edge on the group's far edge.
  const autoCss = `
[data-layer-id="t"] { position: absolute; left: 0px; top: 0px; }
[data-layer-id="b"] { position: absolute; left: 200px; top: 0px; width: 60px; }
`;
  const bounds = [{ layerId: "t", left: 0, top: 0, width: 150, height: 30 }];
  const out = alignElements({ css: autoCss, elementIds: ["t", "b"], align: "right", bounds }).css;
  assert.equal(leftOf(out, "t"), 110, "the text's right edge must reach 260");
  assert.equal(leftOf(out, "b"), 200);
});

test("a single element aligns against its frame", () => {
  const out = alignElements({
    css, elementIds: ["a"], align: "right", frameWidth: 1080, frameHeight: 1080,
  }).css;
  assert.equal(leftOf(out, "a"), 980, "1080 minus its own 100 width");

  const centred = alignElements({
    css, elementIds: ["a"], align: "center", frameWidth: 1080, frameHeight: 1080,
  }).css;
  assert.equal(leftOf(centred, "a"), 490);
});

test("a single element with no frame size reports why rather than jumping to 0", () => {
  assert.throws(
    () => alignElements({ css, elementIds: ["a"], align: "right" }),
    /Frame has no size/,
  );
});

test("an element with no rule of its own gets one, positioned", () => {
  const bounds = [
    { layerId: "a", left: 10, top: 40, width: 100, height: 20 },
    { layerId: "ghost", left: 300, top: 0, width: 40, height: 10 },
  ];
  const out = alignElements({ css, elementIds: ["a", "ghost"], align: "left", bounds }).css;
  assert.match(out, /\[data-layer-id="ghost"\][^}]*position:\s*absolute/);
  assert.equal(leftOf(out, "ghost"), 10);
});

test("rewriting a position keeps the rest of the declaration valid", () => {
  const source = `[data-layer-id="a"] { top: 5px; left: 3px; color: red; }`;
  const out = applyAlignment({
    css: source, elements: [{ id: "a", left: 3, top: 5, width: 10, height: 10 }],
    align: "left", alignValue: 100,
  });
  // The semicolon that ended `top: 5px` must survive, or the rule is broken.
  assert.match(out, /top:\s*5px\s*;/);
  assert.match(out, /color:\s*red/);
  assert.equal(leftOf(out, "a"), 100);
});

test("a declaration containing $ is not re-read as a replacement pattern", () => {
  const source = `[data-layer-id="a"] { left: 1px; background: url("a$&b.png"); }`;
  const out = applyAlignment({
    css: source, elements: [{ id: "a", left: 1, top: 0, width: 10, height: 10 }],
    align: "left", alignValue: 50,
  });
  assert.match(out, /a\$&b\.png/);
});

test("rejects an alignment it does not understand instead of guessing", () => {
  assert.throws(() => alignElements({ css, elementIds: ["a", "b"] }), /got: nothing/);
  assert.throws(() => alignElements({ css, elementIds: ["a", "b"], align: "sideways" }), /got: sideways/);
});

test("accepts the name the editor sends and the name the schema documents", () => {
  const viaSchema = alignElements({ css, elementIds: ["a", "b"], align: "right" });
  const viaEditor = alignElements({ css, elementIds: ["a", "b"], alignment: "right" });
  assert.equal(viaEditor.css, viaSchema.css);
  assert.equal(viaEditor.align, "right");
});

test("reports which elements had no position rather than failing silently", () => {
  const result = alignElements({ css, elementIds: ["a", "b", "missing"], align: "left" });
  assert.deepEqual(result.unpositioned, ["missing"]);
  assert.equal(result.elementsAligned, 2);
});

test("computes a midpoint from centres, and an edge from extremes", () => {
  const elements = [
    { id: "a", left: 0, top: 0, width: 100, height: 10 },
    { id: "b", left: 100, top: 0, width: 100, height: 10 },
  ];
  assert.equal(computeAlignValue({ elements, align: "left" }), 0);
  assert.equal(computeAlignValue({ elements, align: "right" }), 200);
  assert.equal(computeAlignValue({ elements, align: "center" }), 100);
  assert.equal(targetPosition(elements[0], "center", 100), 50);
});
