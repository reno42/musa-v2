import assert from "node:assert/strict";
import test from "node:test";
import {
  appendCssOverride,
  getCssPropertyValue,
  removeCssOverride,
  removeTransformFunction,
  setTransformFunction,
  updateCssProperty,
} from "../src/lib/cssMutations.ts";

test("updates exact CSS properties without touching similarly named properties", () => {
  const source = `[data-layer-id="title"] { background-color: red; border-width: 4px; color: white; width: 200px; }`;
  const withColor = updateCssProperty(source, `[data-layer-id="title"]`, "color", "gold");
  const updated = updateCssProperty(withColor, `[data-layer-id="title"]`, "width", "240px");

  assert.equal(getCssPropertyValue(updated, `[data-layer-id="title"]`, "background-color"), "red");
  assert.equal(getCssPropertyValue(updated, `[data-layer-id="title"]`, "border-width"), "4px");
  assert.equal(getCssPropertyValue(updated, `[data-layer-id="title"]`, "color"), "gold");
  assert.equal(getCssPropertyValue(updated, `[data-layer-id="title"]`, "width"), "240px");
});

test("keeps quoted font family values valid", () => {
  const updated = updateCssProperty(
    `[data-layer-id="title"] { color: gold; font-family: 'Inter'; font-size: 64px; }`,
    `[data-layer-id="title"]`,
    "font-family",
    `'Roboto' !important`,
  );

  assert.match(updated, /font-family:\s*'Roboto' !important/);
  assert.equal(getCssPropertyValue(updated, `[data-layer-id="title"]`, "font-size"), "64px");
});

test("removes only the temporary hide override", () => {
  const source = `[data-layer-id="card"] { display: flex; color: white; }`;
  const hidden = appendCssOverride(source, `[data-layer-id="card"]`, "display", "none !important");
  const visible = removeCssOverride(hidden, `[data-layer-id="card"]`, "display", "none !important");

  assert.equal(getCssPropertyValue(visible, `[data-layer-id="card"]`, "display"), "flex");
  assert.equal(getCssPropertyValue(visible, `[data-layer-id="card"]`, "color"), "white");
});

test("preserves existing transforms when rotating", () => {
  assert.equal(
    setTransformFunction("translate(-50%, -50%) scale(1.2)", "rotate", "30deg"),
    "translate(-50%, -50%) scale(1.2) rotate(30deg)",
  );
  assert.equal(
    removeTransformFunction("translate(-50%, -50%) rotate(30deg) scale(1.2)", "rotate"),
    "translate(-50%, -50%) scale(1.2)",
  );
});
