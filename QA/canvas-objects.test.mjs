import assert from "node:assert/strict";
import test from "node:test";
import {
  findCanvasObjectPosition,
  normalizeCanvasObject,
  resizeCanvasObjectBounds,
  rotationDegreesFromTransform,
  rotationFromPointer,
  toFrameLocalBounds,
} from "../src/lib/canvasObjects.ts";
import {
  DESIGN_CLIPBOARD_KEY,
  persistDesignClipboard,
  readDesignClipboard,
} from "../src/lib/designClipboard.ts";
import { updateTemplateSchema } from "../api/src/middleware/validate.ts";
import { createDocumentStore } from "../src/lib/documentStore.ts";

test("normalizes root objects with null frame ownership for data synchronization", () => {
  const object = normalizeCanvasObject({
    id: "copy",
    name: "Copy",
    html: '<p data-layer-kind="text">Draft</p>',
    css: "",
    x: 20,
    y: 30,
    width: 240,
    height: 60,
  }, 0);

  assert.equal(object.frameId, null);
  assert.equal(object.kind, "text");
  assert.equal(object.name, "Copy");
});

test("places imported root objects beyond frames and existing canvas objects", () => {
  const position = findCanvasObjectPosition(
    [{ x: 0, y: 40, width: 1080, height: 1080 }],
    [{ x: 1280, y: 100, width: 300, height: 200 }],
  );

  assert.deepEqual(position, { x: 1680, y: 40 });
});

test("resizes root objects from every edge while keeping the opposite edge fixed", () => {
  assert.deepEqual(
    resizeCanvasObjectBounds({ x: 100, y: 80, width: 200, height: 120 }, "se", 30, 20),
    { x: 100, y: 80, width: 230, height: 140 },
  );
  assert.deepEqual(
    resizeCanvasObjectBounds({ x: 100, y: 80, width: 200, height: 120 }, "nw", 40, 30),
    { x: 140, y: 110, width: 160, height: 90 },
  );
  assert.deepEqual(
    resizeCanvasObjectBounds({ x: 100, y: 80, width: 200, height: 120 }, "w", 500, 0),
    { x: 292, y: 80, width: 8, height: 120 },
  );
});

test("computes visual root rotation without discarding an existing angle", () => {
  assert.equal(rotationDegreesFromTransform("scaleX(-1) rotate(30deg)"), 30);
  assert.equal(
    Math.round(rotationFromPointer(
      { x: 100, y: 100 },
      { x: 100, y: 50 },
      { x: 150, y: 100 },
      30,
    )),
    120,
  );
});

test("converts the painted bbox to frame-local coordinates at the active zoom", () => {
  assert.deepEqual(
    toFrameLocalBounds(
      { left: 300, top: 220, width: 240, height: 120 },
      { left: 100, top: 100 },
      2,
    ),
    { x: 100, y: 60, width: 120, height: 60 },
  );
});

test("undoes frame-to-canvas transfers atomically without reverting unrelated frames", () => {
  const frameA = { id: "a", name: "A", x: 0, y: 0, width: 100, height: 100, html: "<div>A</div>", css: "", background: "#fff" };
  const frameB = { id: "b", name: "B", x: 200, y: 0, width: 100, height: 100, html: "<div>B</div>", css: "", background: "#fff" };
  const object = {
    id: "root", name: "Root", kind: "shape", frameId: null,
    html: '<div data-layer-id="root"></div>', css: "", x: 20, y: 20,
    width: 40, height: 40, zIndex: 1,
  };
  const store = createDocumentStore([frameA, frameB]);
  store.replaceCanvasObjects([]);
  store.replaceDocumentWithUndo([{ ...frameA, html: "" }, frameB], [object], "move to canvas");

  assert.equal(store.undo(), true);
  assert.equal(store.frames[0].html, "<div>A</div>");
  assert.equal(store.frames[1].html, "<div>B</div>");
  assert.equal(store.canvasObjects.length, 0);
  assert.equal(store.redo(), true);
  assert.equal(store.frames[0].html, "");
  assert.equal(store.frames[1].html, "<div>B</div>");
  assert.equal(store.canvasObjects[0].id, "root");
});

test("shares selected root objects through the cross-tab design clipboard", () => {
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
    kind: "canvas-object",
    objects: [{
      layerId: "orphan_source",
      object: {
        id: "orphan_source",
        name: "Photo",
        kind: "image",
        frameId: null,
        html: '<img data-layer-id="orphan_source" src="photo.png">',
        css: '[data-layer-id="orphan_source"] { width: 240px; height: 160px; }',
        x: 320,
        y: 180,
        width: 240,
        height: 160,
        zIndex: 2,
      },
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

test("API validation preserves root objects and their null frame ownership", () => {
  const result = updateTemplateSchema.safeParse({
    canvasObjects: [{
      id: "copy",
      name: "Copy",
      kind: "text",
      frameId: null,
      html: "<p>Draft</p>",
      css: "",
      x: 20,
      y: 30,
      width: 240,
      height: 60,
      zIndex: 1,
    }],
  });

  assert.equal(result.success, true);
  assert.equal(result.data?.canvasObjects?.[0].frameId, null);
});
