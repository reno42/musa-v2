import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  appendCssOverride,
  cloneLayerTreeCss,
  cloneLayerCss,
  extractLayerCss,
  getCssPropertyValue,
  mergeCssRules,
  remapLayerCss,
  removeLayerCss,
  removeLayersCss,
  removeCssOverride,
  removeTransformFunction,
  setTransformFunction,
  updateCssProperty,
} from "../src/lib/cssMutations.ts";
import {
  DESIGN_CLIPBOARD_KEY,
  persistDesignClipboard,
  readDesignClipboard,
} from "../src/lib/designClipboard.ts";

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

test("clones SVG child styles and offsets the cloned root", () => {
  const source = `[data-layer-id="path"] { left: 10px; top: 15px; }\n[data-layer-id="path"] path { fill: red; stroke: blue; stroke-width: 3px; }`;
  const cloned = cloneLayerCss(source, new Map([["path", "path-copy"]]), 20);

  assert.equal(getCssPropertyValue(cloned, `[data-layer-id="path-copy"]`, "left"), "30px");
  assert.equal(getCssPropertyValue(cloned, `[data-layer-id="path-copy"]`, "top"), "35px");
  assert.equal(getCssPropertyValue(cloned, `[data-layer-id="path-copy"] path`, "fill"), "red");
  assert.equal(getCssPropertyValue(cloned, `[data-layer-id="path-copy"] path`, "stroke-width"), "3px");
});

test("removes root and descendant CSS when deleting an SVG layer", () => {
  const source = `[data-layer-id="path"] { left: 10px; }\n.keep, [data-layer-id="path"] path { fill: red; }\n.keep { color: white; }`;
  const updated = removeLayerCss(source, "path");

  assert.doesNotMatch(updated, /data-layer-id=["']path/);
  assert.match(updated, /\.keep\s*\{\s*fill:\s*red/);
  assert.equal(getCssPropertyValue(updated, ".keep", "color"), "white");
});

test("transfers only CSS selectors owned by a moved layer subtree", () => {
  const source = `.shared { color: black; }\n[data-layer-id="group"] { display: contents; }\n.shared, [data-layer-id="child"] { color: green; }\n[data-layer-id="child"] span { font-size: 24px; }`;
  const extracted = extractLayerCss(source, ["group", "child"]);
  const remaining = removeLayersCss(source, ["group", "child"]);

  assert.match(extracted, /data-layer-id="group"/);
  assert.match(extracted, /data-layer-id="child"/);
  assert.doesNotMatch(extracted, /^\.shared/m);
  assert.doesNotMatch(remaining, /data-layer-id="(?:group|child)"/);
  assert.equal(getCssPropertyValue(remaining, ".shared", "color"), "green");
});

test("merges transferred CSS without duplicating rules or misplacing imports", () => {
  const base = `.card { color: black; }`;
  const addition = `@import url("https://fonts.example.test/inter.css");\n.card { color: black; }\n.moved { font-family: Inter; }`;
  const merged = mergeCssRules(base, addition);
  const mergedTwice = mergeCssRules(merged, addition);

  assert.match(merged, /^@import/);
  assert.equal((mergedTwice.match(/\.card\s*\{/g) || []).length, 1);
  assert.equal((mergedTwice.match(/\.moved\s*\{/g) || []).length, 1);
  assert.equal((mergedTwice.match(/@import/g) || []).length, 1);
});

test("remaps layer selectors when a cross-frame move resolves id collisions", () => {
  const remapped = remapLayerCss(
    `[data-layer-id="group"] .title, [data-layer-id='child'] { color: red; }`,
    new Map([["group", "group_2"], ["child", "child_2"]]),
  );

  assert.match(remapped, /data-layer-id="group_2"/);
  assert.match(remapped, /data-layer-id='child_2'/);
  assert.doesNotMatch(remapped, /data-layer-id=["'](?:group|child)["']/);
});

test("clones an extracted layer stylesheet and offsets positioned roots", () => {
  const cloned = cloneLayerTreeCss(
    `[data-layer-id="source"] { position: absolute; left: 10px; top: 15px; color: red; }`,
    `<div data-layer-id="source"></div>`,
    ["source"],
    new Map([["source", "copy"]]),
    20,
  );

  assert.equal(getCssPropertyValue(cloned, `[data-layer-id="copy"]`, "left"), "30px");
  assert.equal(getCssPropertyValue(cloned, `[data-layer-id="copy"]`, "top"), "35px");
  assert.equal(getCssPropertyValue(cloned, `[data-layer-id="copy"]`, "color"), "red");
});

test("persists a copied frame so another editor project can read it", () => {
  const values = new Map();
  const previousStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  });

  const clipboard = {
    kind: "frames",
    frames: [{
      id: "frame_source",
      name: "Source",
      x: 20,
      y: 30,
      width: 500,
      height: 360,
      html: '<div data-layer-id="card">Luxury</div>',
      css: '[data-layer-id="card"] { color: gold; }',
      background: "#fff",
    }],
    pasteCount: 0,
  };

  try {
    assert.equal(persistDesignClipboard(clipboard), true);
    assert.ok(values.has(DESIGN_CLIPBOARD_KEY));
    assert.deepEqual(readDesignClipboard(), clipboard);
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else Object.defineProperty(globalThis, "localStorage", { configurable: true, value: previousStorage });
  }
});

test("reads the newest shared-tab clipboard even when copies share a timestamp", () => {
  const values = new Map();
  const previousStorage = globalThis.localStorage;
  const previousNow = Date.now;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  });
  Date.now = () => 9_999_999_999_999;

  const firstClipboard = {
    kind: "frames",
    frames: [{ id: "frame_a", name: "A", x: 0, y: 0, width: 100, height: 100, html: "<div>A</div>", css: "", background: "#fff" }],
    pasteCount: 0,
  };
  const secondClipboard = {
    kind: "frames",
    frames: [{ id: "frame_b", name: "B", x: 0, y: 0, width: 100, height: 100, html: "<div>B</div>", css: "", background: "#fff" }],
    pasteCount: 0,
  };

  try {
    persistDesignClipboard(firstClipboard);
    values.set(DESIGN_CLIPBOARD_KEY, JSON.stringify({
      version: 1,
      updatedAt: Date.now(),
      clipboard: secondClipboard,
    }));

    assert.deepEqual(readDesignClipboard(), secondClipboard);
  } finally {
    Date.now = previousNow;
    if (previousStorage === undefined) delete globalThis.localStorage;
    else Object.defineProperty(globalThis, "localStorage", { configurable: true, value: previousStorage });
  }
});

test("raster import inserts into the active design without creating a template", () => {
  const source = readFileSync(new URL("../src/components/SvgImportDialog.tsx", import.meta.url), "utf8");
  const rasterStart = source.indexOf('if (importMode === "raster" && rasterDataUrl)');
  const svgStart = source.indexOf("} else {", rasterStart);
  const rasterBranch = source.slice(rasterStart, svgStart);

  assert.notEqual(rasterStart, -1);
  assert.notEqual(svgStart, -1);
  assert.match(rasterBranch, /onRasterImported/);
  assert.doesNotMatch(rasterBranch, /create_template|create_html_frame/);
});
