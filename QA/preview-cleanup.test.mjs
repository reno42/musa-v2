/**
 * Preview image cleanup — path logic.
 *
 * Preview captures upsert to {dir}/{templateId}.{ext}, so re-capturing in the
 * same format overwrites. The extension follows the capture's mime type, so a
 * design captured as PNG and later as JPEG used to leave the PNG behind for
 * good. These tests pin the rule that decides which files get deleted — the
 * dangerous failure would be deleting the capture that was just written.
 *
 * Run: node --test QA/preview-cleanup.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const modPath = "file://" + resolve(__dirname, "..", "api", "src", "services", "supabase.ts");

const { stalePreviewPaths, allPreviewPaths } = await import(modPath);

const DIR = "ws_1/thumbnails";
const TPL = "tpl_abc";

describe("stalePreviewPaths", () => {
  it("never deletes the file just written", () => {
    const keep = `${DIR}/${TPL}.png`;
    const stale = stalePreviewPaths(DIR, TPL, keep);
    assert.ok(!stale.includes(keep), "the freshly uploaded capture must survive");
  });

  it("removes the same design's captures in other formats", () => {
    const stale = stalePreviewPaths(DIR, TPL, `${DIR}/${TPL}.png`);
    assert.deepEqual(stale.sort(), [
      `${DIR}/${TPL}.jpeg`,
      `${DIR}/${TPL}.jpg`,
      `${DIR}/${TPL}.webp`,
    ].sort());
  });

  it("works whichever format the new capture used", () => {
    for (const ext of ["png", "jpg", "jpeg", "webp"]) {
      const keep = `${DIR}/${TPL}.${ext}`;
      const stale = stalePreviewPaths(DIR, TPL, keep);
      assert.ok(!stale.includes(keep));
      assert.equal(stale.length, 3, `expected the other 3 formats for ${ext}`);
    }
  });

  it("only ever targets this design, never a neighbour", () => {
    const stale = stalePreviewPaths(DIR, TPL, `${DIR}/${TPL}.png`);
    assert.ok(stale.every(path => path.includes(`/${TPL}.`)));
    assert.ok(stale.every(path => path.startsWith(`${DIR}/`)));
  });

  it("stays inside the given folder (no cross-workspace deletion)", () => {
    const stale = stalePreviewPaths("ws_A/thumbnails", TPL, `ws_A/thumbnails/${TPL}.png`);
    assert.ok(stale.every(path => path.startsWith("ws_A/")), "must not touch another workspace");
  });
});

describe("allPreviewPaths", () => {
  it("covers thumbnail and cover folders in every format", () => {
    const paths = allPreviewPaths(TPL, "ws_1");
    assert.equal(paths.length, 8); // 2 folders x 4 formats
    assert.ok(paths.includes(`ws_1/thumbnails/${TPL}.png`));
    assert.ok(paths.includes(`ws_1/covers/${TPL}.jpg`));
  });

  it("scopes every path to the design being deleted", () => {
    const paths = allPreviewPaths(TPL, "ws_1");
    assert.ok(paths.every(path => path.startsWith("ws_1/") && path.includes(`/${TPL}.`)));
  });
});
