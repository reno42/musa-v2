/**
 * Where an asset's bytes live.
 *
 * Content Machine pulls photos from wherever the writer found them, so the
 * difference between "this is ours now" and "this still depends on someone
 * else's server" is the one thing the table has to get right — a design
 * quietly hotlinking a stock site breaks the day that page is taken down.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { assetOrigin } from "../api/src/services/brandFiling.ts";

test("a Supabase Storage URL is ours", () => {
  assert.equal(
    assetOrigin("https://abc.supabase.co/storage/v1/object/sign/design-assets/ws/a.jpg?token=x"),
    "bucket",
  );
  assert.equal(
    assetOrigin("https://abc.supabase.co/storage/v1/object/public/design-assets/ws/a.png"),
    "bucket",
  );
});

test("the local disk fallback counts as ours too", () => {
  assert.equal(assetOrigin("/assets/ws_1/foto.png"), "bucket");
});

test("anything else on the open web is borrowed", () => {
  assert.equal(assetOrigin("https://images.unsplash.com/photo-1"), "external");
  assert.equal(assetOrigin("https://drive.google.com/uc?export=download&id=1"), "external");
  assert.equal(assetOrigin("http://mi-servidor.com/foto.jpg"), "external");
});

test("a missing or unreadable url is not guessed at", () => {
  assert.equal(assetOrigin(""), "unknown");
  assert.equal(assetOrigin(null), "unknown");
  assert.equal(assetOrigin(undefined), "unknown");
  assert.equal(assetOrigin("no soy una url"), "unknown");
});

test("a host merely mentioning storage does not pass as ours", () => {
  // The marker is the Storage API path, not the word appearing somewhere.
  assert.equal(assetOrigin("https://storage.example.com/design-assets/a.jpg"), "external");
});
