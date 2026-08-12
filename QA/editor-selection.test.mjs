import assert from "node:assert/strict";
import test from "node:test";
import { pickTopmostByBounds, styleTargets, updateSelection } from "../src/lib/selectionModel.ts";
import { updateCssProperty } from "../src/lib/cssMutations.ts";

test("selects the last layer in stack order when bounds overlap", () => {
  const layers = [
    { id: "bottom", left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 },
    { id: "group", left: 20, top: 20, right: 180, bottom: 180, width: 160, height: 160 },
  ];

  assert.equal(pickTopmostByBounds(layers, { x: 50, y: 50 }, layer => layer)?.id, "group");
  assert.equal(pickTopmostByBounds(layers, { x: 10, y: 10 }, layer => layer)?.id, "bottom");
  assert.equal(pickTopmostByBounds(layers, { x: 250, y: 250 }, layer => layer), null);
});

test("Shift selection keeps the first layer and toggles later layers", () => {
  assert.deepEqual(updateSelection([], "first", false), ["first"]);
  assert.deepEqual(updateSelection(["first"], "second", true), ["first", "second"]);
  assert.deepEqual(updateSelection(["first", "second"], "first", true), ["second"]);
  assert.deepEqual(updateSelection(["second"], "replacement", false), ["replacement"]);
});

/**
 * A style change applies to everything selected.
 *
 * The contextual panel is handed one element, and every control wrote to that
 * selector alone — so picking three objects and setting a fill painted one of
 * them and left the other two untouched.
 */
test("a lone selection writes to just that element", () => {
  assert.deepEqual(styleTargets('[data-layer-id="a"]', "a", []), ['[data-layer-id="a"]']);
  assert.deepEqual(styleTargets('[data-layer-id="a"]', "a", ["a"]), ['[data-layer-id="a"]']);
});

test("every selected object is painted, not only the primary one", () => {
  assert.deepEqual(
    styleTargets('[data-layer-id="a"]', "a", ["a", "b", "c"]),
    ['[data-layer-id="a"]', '[data-layer-id="b"]', '[data-layer-id="c"]'],
  );
});

test("a compound primary selector is kept, not rebuilt from its layer id", () => {
  // An SVG child's selector reaches past the layer wrapper. Rebuilding it from
  // the id alone would style the wrapper instead of the node that was clicked.
  assert.deepEqual(
    styleTargets('[data-layer-id="a"] path', "a", ["a", "b"]),
    ['[data-layer-id="a"] path', '[data-layer-id="b"]'],
  );
});

test("the primary is included even when the selection list omits it", () => {
  const targets = styleTargets('[data-layer-id="a"]', "a", ["b", "c"]);
  assert.equal(targets.includes('[data-layer-id="a"]'), true);
  assert.equal(targets.length, 3);
});

test("a repeated layer is written once, so a value is not applied twice", () => {
  assert.deepEqual(
    styleTargets('[data-layer-id="a"]', "a", ["a", "b", "a"]),
    ['[data-layer-id="a"]', '[data-layer-id="b"]'],
  );
});

test("no element means nothing to write to", () => {
  assert.deepEqual(styleTargets("", "", ["a", "b"]), []);
});

/**
 * Fanning out is only useful if it reaches objects that carry no rule for the
 * property yet — which is the normal case for a fill nobody has set.
 */
test("a fill applied to a multi-selection reaches objects with no rule of their own", () => {
  let css = `
[data-layer-id="a"] { position: absolute; left: 0px; background-color: red; }
[data-layer-id="b"] { position: absolute; left: 100px; }
`;
  // "c" has no rule in the stylesheet at all.
  const targets = styleTargets('[data-layer-id="a"]', "a", ["a", "b", "c"]);
  for (const target of targets) {
    css = updateCssProperty(css, target, "background-color", "#00ff00 !important");
  }

  for (const id of ["a", "b", "c"]) {
    const declaration = new RegExp(`\\[data-layer-id="${id}"\\]\\s*\\{([^}]*)\\}`).exec(css)?.[1] || "";
    const fill = /background-color:\s*([^;]+)/.exec(declaration)?.[1]?.trim();
    assert.equal(fill, "#00ff00 !important", `${id} must take the new fill`);
  }
  // The object that already had a fill must not keep the old one alongside it.
  assert.equal(/background-color:\s*red/.test(css), false, "the previous fill must be replaced, not duplicated");
});
