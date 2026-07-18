/**
 * FrameReconciler unit tests.
 * DOM-dependent tests skip in Node; full integration tested in browser suite.
 * Run: node --test QA/frameReconciler.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const modPath = "file://" + resolve(__dirname, "..", "src", "lib", "frameReconciler.ts");

const { reconcileFrameHtml, frameHtmlMatches } = await import(modPath);

const hasDom = typeof globalThis.document !== "undefined";

describe("FrameReconciler", () => {
  it("exports reconcileFrameHtml and frameHtmlMatches", () => {
    assert.equal(typeof reconcileFrameHtml, "function");
    assert.equal(typeof frameHtmlMatches, "function");
  });

  if (hasDom) {
    it("skips identical layers (no-op reconcile)", () => {
      const content = document.createElement("div");
      const html = `<div data-layer-id="a">Hello</div><span data-layer-id="b">World</span>`;
      content.innerHTML = html;
      const stats = reconcileFrameHtml(content, html);
      assert.equal(stats.patched, 0);
      assert.equal(stats.inserted, 0);
      assert.equal(stats.removed, 0);
      assert(stats.skipped >= 2, "all layers should be skipped");
    });

    it("patches a single changed layer", () => {
      const content = document.createElement("div");
      content.innerHTML = `<div data-layer-id="a">Hello</div><span data-layer-id="b">World</span>`;
      const stats = reconcileFrameHtml(
        content,
        `<div data-layer-id="a">Hello</div><span data-layer-id="b">Updated</span>`,
      );
      assert.equal(stats.patched, 1);
      assert.equal(stats.skipped, 1);
      const b = content.querySelector('[data-layer-id="b"]');
      assert(b, "layer b should still exist");
      assert.equal(b.textContent, "Updated");
    });

    it("inserts new layers", () => {
      const content = document.createElement("div");
      content.innerHTML = `<div data-layer-id="a">A</div>`;
      const stats = reconcileFrameHtml(
        content,
        `<div data-layer-id="a">A</div><div data-layer-id="b">B</div>`,
      );
      assert.equal(stats.inserted, 1);
      assert(content.querySelector('[data-layer-id="b"]'));
    });

    it("removes deleted layers", () => {
      const content = document.createElement("div");
      content.innerHTML = `<div data-layer-id="a">A</div><div data-layer-id="b">B</div>`;
      const stats = reconcileFrameHtml(content, `<div data-layer-id="a">A</div>`);
      assert.equal(stats.removed, 1);
      assert.equal(content.querySelector('[data-layer-id="b"]'), null);
    });

    it("frameHtmlMatches returns true/false correctly", () => {
      const content = document.createElement("div");
      const html = `<div data-layer-id="a">A</div><span data-layer-id="b">B</span>`;
      content.innerHTML = html;
      assert.equal(frameHtmlMatches(content, html), true);
      assert.equal(frameHtmlMatches(content, `<div data-layer-id="a">Changed</div>`), false);
    });

    it("exposes stats via futurariaAgent", () => {
      globalThis.window = globalThis;
      const agent = {};
      globalThis.futurariaAgent = agent;
      const content = document.createElement("div");
      content.innerHTML = `<div data-layer-id="a">A</div>`;
      reconcileFrameHtml(content, `<div data-layer-id="a">B</div>`);
      assert(agent.__lastReconcile);
      assert.equal(agent.__lastReconcile.patched, 1);
      delete globalThis.futurariaAgent;
      delete globalThis.window;
    });
  } else {
    it("DOM tests skipped (no document global in this runtime)", () => {
      // Graceful skip — reconciler is browser-only
    });
  }
});
