import assert from "node:assert/strict";
import test from "node:test";
import { pickTopmostByBounds, updateSelection } from "../src/lib/selectionModel.ts";

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
