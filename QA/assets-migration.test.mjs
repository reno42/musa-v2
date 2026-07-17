import assert from "node:assert/strict";
import test from "node:test";
import { migrateBase64FromHtml } from "../api/src/services/supabase.ts";
import { randomBytes } from "node:crypto";

// ── Base64 migration: extracts large inline images to Storage URLs ──

// Small PNG (~70 bytes when decoded)
const tinyPngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const tinyPngDataUri = `data:image/png;base64,${tinyPngB64}`;

// Generate a genuinely large >150KB base64 image (random data as fake PNG)
const largeBuf = randomBytes(150_000);
const largeB64 = largeBuf.toString("base64");
const largeDataUri = `data:image/png;base64,${largeB64}`;

test("keeps tiny base64 images inline (<100KB)", async () => {
  const html = `<img src="${tinyPngDataUri}" alt="icon" />`;
  const result = await migrateBase64FromHtml(html, "", "test");
  // Tiny image stays inline (below 100KB threshold)
  assert.equal(result.migrated, 0);
  assert.ok(result.html.includes("data:image/png;base64,"));
});

test("migrates large base64 images (>100KB) to storage URL", async () => {
  const html = `<img src="${largeDataUri}" alt="large" />`;
  const result = await migrateBase64FromHtml(html, "", "test");
  assert.equal(result.migrated, 1);
  // Should no longer contain base64
  assert.ok(!result.html.includes("data:image/png;base64,"));
  // Should contain a storage-style URL or local path
  assert.ok(result.html.includes("/assets/test/") || result.html.includes("/storage/v1/object/public/"));
});

test("handles CSS url() with base64", async () => {
  const css = `.bg { background: url(${largeDataUri}); }`;
  const result = await migrateBase64FromHtml(css, "", "test");
  assert.equal(result.migrated, 1);
  assert.ok(!result.html.includes("data:image/png;base64,"));
});

test("migrates multiple images in same HTML", async () => {
  const html = `<div><img src="${largeDataUri}" /><img src="${tinyPngDataUri}" /><img src="${largeDataUri}" /></div>`;
  const result = await migrateBase64FromHtml(html, "", "test");
  // Two large, one tiny kept
  assert.equal(result.migrated, 2);
  const base64Count = (result.html.match(/data:image\/png;base64,/g) || []).length;
  assert.equal(base64Count, 1); // only the tiny one remains
});

test("returns unchanged HTML when no base64 images exist", async () => {
  const html = `<div><img src="https://example.com/photo.png" /></div>`;
  const result = await migrateBase64FromHtml(html, "", "test");
  assert.equal(result.migrated, 0);
  assert.equal(result.html, html);
});

test("respects custom minSizeBytes threshold", async () => {
  const html = `<img src="${tinyPngDataUri}" alt="tiny" />`;
  // With a very low threshold, even tiny images get migrated
  const result = await migrateBase64FromHtml(html, "", "test", 10);
  assert.equal(result.migrated, 1);
});
