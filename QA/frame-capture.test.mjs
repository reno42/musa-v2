/**
 * frameCapture — export rendering. DOM-dependent parts (buildFrameSvgMarkup,
 * rasterizeFrame) skip in Node, same convention as frameReconciler.test.mjs;
 * verified against the live editor in the browser instead. mapBodySelectors
 * is pure and is the one piece responsible for the class of bug this module
 * fixes: exported html/css was previously injected UNSCOPED, so a design's
 * `body {}` rules (background, padding, filters on images) leaked onto the
 * real page instead of styling the export target — background disappeared,
 * top content that depended on body padding shifted up/off-canvas, and
 * (separately, since it also required leaving html2canvas) CSS `filter`
 * effects like grayscale never applied at all.
 *
 * Run: node --test QA/frame-capture.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const modPath = "file://" + resolve(__dirname, "..", "src", "lib", "frameCapture.ts");

const { mapBodySelectors } = await import(modPath);

describe("mapBodySelectors", () => {
  it("maps a bare body rule to #__df_content", () => {
    assert.equal(mapBodySelectors("body { background: red; }"), "#__df_content { background: red; }");
  });

  it("maps a bare html rule to #__df_content", () => {
    assert.equal(mapBodySelectors("html { padding: 40px; }"), "#__df_content { padding: 40px; }");
  });

  it("maps body/html appearing after another rule's closing brace", () => {
    const css = "p { color: red; } body { background: blue; }";
    assert.equal(mapBodySelectors(css), "p { color: red; } #__df_content { background: blue; }");
  });

  it("maps body/html joined by a comma in a selector list", () => {
    assert.equal(mapBodySelectors("body, .card { margin: 0; }"), "#__df_content, .card { margin: 0; }");
  });

  it("maps descendant selectors — the exact case behind the grayscale bug", () => {
    assert.equal(mapBodySelectors("body img { filter: grayscale(1); }"), "#__df_content img { filter: grayscale(1); }");
  });

  it("does not touch unrelated identifiers containing body/html as a substring", () => {
    const css = ".body-text { color: red; } .htmlish { color: blue; }";
    assert.equal(mapBodySelectors(css), css);
  });

  it("leaves non-body/html rules completely unchanged", () => {
    const css = "[data-layer-id=\"x\"] { color: #111; font-weight: 700; }";
    assert.equal(mapBodySelectors(css), css);
  });
});
