import assert from "node:assert/strict";
import test from "node:test";
import {
  findCanvasObjectPosition,
  normalizeCanvasObject,
} from "../src/lib/canvasObjects.ts";
import { updateTemplateSchema } from "../api/src/middleware/validate.ts";

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
