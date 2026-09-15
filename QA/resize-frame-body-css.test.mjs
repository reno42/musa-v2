import assert from "node:assert/strict";
import test from "node:test";
import { resizeFrameBodyCss } from "../src/lib/resizeFrameBodyCss.ts";

test("rewrites width/height inside a pinned body rule", () => {
  const css = "body {\n  font-family: 'Inter', system-ui, sans-serif;\n  position: relative;\n  width: 1080px;\n  height: 1080px;\n  margin: 0;\n  background-color: #ffffff;\n  overflow: hidden;\n}";
  const out = resizeFrameBodyCss(css, 1920, 1080);
  assert.match(out, /width: 1920px/);
  assert.match(out, /height: 1080px/);
  assert.doesNotMatch(out, /width: 1080px/);
  // Other declarations survive.
  assert.match(out, /font-family: 'Inter'/);
  assert.match(out, /margin: 0/);
  assert.match(out, /background-color: #ffffff/);
  assert.match(out, /overflow: hidden/);
});

test("rewrites both width and height when the frame grows and shrinks", () => {
  const css = "body { width: 800px; height: 600px; }";
  assert.match(resizeFrameBodyCss(css, 1920, 1080), /width: 1920px; height: 1080px/);
  assert.match(resizeFrameBodyCss(css, 500, 400), /width: 500px; height: 400px/);
});

test("handles html+body combined selectors and multi-rule css", () => {
  const css = "html, body { margin: 0; width: 1080px; height: 1080px; }\n.title { width: 100px; }";
  const out = resizeFrameBodyCss(css, 1920, 1080);
  assert.match(out, /width: 1920px/);
  // Non-body rules must keep their own width.
  assert.match(out, /\.title \{ width: 100px; \}/);
});

test("body rule without width/height is left untouched (nothing added)", () => {
  const css = "body { margin: 0; color: red; }";
  assert.equal(resizeFrameBodyCss(css, 1920, 1080), css);
});

test("css without html/body rules returns unchanged", () => {
  const css = ".card { width: 1080px; height: 1080px; }";
  assert.equal(resizeFrameBodyCss(css, 1920, 1080), css);
});

test("max-width/min-width and custom props are not modified", () => {
  const css = "body { max-width: 1080px; min-height: 500px; --frame-w: 1080px; width: 1080px; height: 1080px; }";
  const out = resizeFrameBodyCss(css, 1920, 1080);
  assert.match(out, /max-width: 1080px/);
  assert.match(out, /min-height: 500px/);
  assert.match(out, /--frame-w: 1080px/);
  assert.match(out, /width: 1920px/);
  assert.match(out, /height: 1080px/);
});

test("empty css returns unchanged", () => {
  assert.equal(resizeFrameBodyCss("", 1920, 1080), "");
});

test("wires resizeFrameBodyCss into handleFrameResize (regression guard)", async () => {
  const { readFile } = await import("node:fs/promises");
  const editor = await readFile(new URL("../src/pages/EditorV2.tsx", import.meta.url), "utf8");
  assert.match(editor, /import \{ resizeFrameBodyCss \} from "\.\.\/lib\/resizeFrameBodyCss";/);
  assert.match(editor, /css: resizeFrameBodyCss\(f\.css, w, h\)/);
});
