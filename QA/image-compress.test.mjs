/**
 * The sizing decisions behind image compression. Canvas encoding needs a
 * browser, so what is covered here is everything that decides WHETHER and HOW
 * far to shrink — which is where a wrong answer costs the user their picture.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  fitWithin, chooseFormat, formatBytes, MAX_EDGE, TARGET_BYTES,
} from "../src/lib/imageCompress.ts";

test("an oversized image is capped on its longest edge, aspect kept", () => {
  const fit = fitWithin(6000, 4000, 2000);
  assert.deepEqual(fit, { width: 2000, height: 1333, scaled: true });
  assert.ok(Math.abs(6000 / 4000 - fit.width / fit.height) < 0.01);
});

test("a tall image is capped on height, not width", () => {
  const fit = fitWithin(1080, 5400, 2000);
  assert.equal(fit.height, 2000);
  assert.equal(fit.width, 400);
});

test("an image already within budget is left exactly as it is", () => {
  assert.deepEqual(fitWithin(1080, 1350, 2000), { width: 1080, height: 1350, scaled: false });
});

test("a small image is never upscaled", () => {
  const fit = fitWithin(200, 200, 2000);
  assert.equal(fit.scaled, false);
  assert.equal(fit.width, 200);
});

test("degenerate dimensions do not produce a zero-or-negative canvas", () => {
  assert.deepEqual(fitWithin(0, 0), { width: 0, height: 0, scaled: false });
  const sliver = fitWithin(10000, 1, 2000);
  assert.ok(sliver.height >= 1, "a one-pixel edge must survive rounding");
});

test("webp is preferred when the browser can actually encode it", () => {
  assert.equal(chooseFormat("image/jpeg", true), "image/webp");
  assert.equal(chooseFormat("image/png", true), "image/webp");
});

test("without webp, a png stays a png so transparency survives", () => {
  assert.equal(chooseFormat("image/png", false), "image/png");
  assert.equal(chooseFormat("image/jpeg", false), "image/jpeg");
});

test("vectors and gifs are never rasterized", () => {
  // An SVG is already tiny, and flattening a GIF would drop its animation.
  assert.equal(chooseFormat("image/svg+xml", true), "image/svg+xml");
  assert.equal(chooseFormat("image/gif", true), "image/gif");
});

test("the budget is the one the product promises", () => {
  assert.equal(MAX_EDGE, 2000);
  assert.ok(TARGET_BYTES <= 2 * 1024 * 1024, "target must stay inside the 1-2MB the user asked for");
});

test("sizes read the way a person would say them", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
});
