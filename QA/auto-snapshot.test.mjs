/**
 * When a design's card gets a fresh thumbnail, and — more importantly — when
 * it does not. Every rule here exists to stop the editor spending a rasterize
 * it did not need.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldCapture, thumbnailScale, MIN_INTERVAL_MS, THUMB_EDGE,
} from "../src/lib/autoSnapshot.ts";

const base = {
  revision: 5, capturedRevision: 4, lastCaptureAt: 0, now: MIN_INTERVAL_MS + 1, hasFrame: true,
};

test("a settled edit is captured", () => {
  assert.deepEqual(shouldCapture(base), { capture: true, reason: "settled" });
});

test("a design nobody touched is never re-captured", () => {
  const d = shouldCapture({ ...base, capturedRevision: 5 });
  assert.equal(d.capture, false);
  assert.equal(d.reason, "no-change");
});

test("furious typing cannot spin the rasterizer", () => {
  const d = shouldCapture({ ...base, lastCaptureAt: 1000, now: 1000 + MIN_INTERVAL_MS - 1 });
  assert.equal(d.capture, false);
  assert.equal(d.reason, "too-soon");
});

test("leaving the page overrides the interval floor, but not the change check", () => {
  const justEdited = { ...base, lastCaptureAt: 1000, now: 1500, flush: true };
  assert.deepEqual(shouldCapture(justEdited), { capture: true, reason: "flush" });
  // Nothing changed: even a flush has nothing worth spending on.
  const untouched = { ...justEdited, capturedRevision: base.revision };
  assert.equal(shouldCapture(untouched).capture, false);
});

test("an empty design is not rasterized into a blank card", () => {
  const d = shouldCapture({ ...base, hasFrame: false, flush: true });
  assert.equal(d.capture, false);
  assert.equal(d.reason, "nothing-to-capture");
});

test("a poster is scaled down to card size, not rendered full bore", () => {
  // 4000px artboard at scale 1 is 16 megapixels thrown away for a 480px card.
  const scale = thumbnailScale(4000, 4000);
  assert.ok(scale < 1);
  assert.equal(Math.round(4000 * scale), THUMB_EDGE);
});

test("a small frame is never upscaled", () => {
  assert.equal(thumbnailScale(200, 200), 1);
  assert.equal(thumbnailScale(THUMB_EDGE, 100), 1);
});

test("the long edge decides, whichever side it is", () => {
  assert.equal(Math.round(1080 * thumbnailScale(1080, 1920)), Math.round(1080 * (THUMB_EDGE / 1920)));
  assert.equal(Math.round(1920 * thumbnailScale(1920, 1080)), THUMB_EDGE);
});

test("degenerate dimensions do not produce a zero or negative scale", () => {
  assert.equal(thumbnailScale(0, 0), 1);
  assert.ok(thumbnailScale(100000, 100000) > 0);
});
