/**
 * Contratos MCP ↔ superficies humanas del editor. Corre:
 * node --experimental-strip-types --test QA/mcp-editor-surfaces.test.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(ROOT + path, "utf8");
const mcp = read("worker/runtime/functions/mcp.mjs");
const editor = read("src/pages/EditorV2.tsx");
const videoEditor = read("src/pages/VideoProjectEditor.tsx");
const workerRenderer = read("worker/runtime/functions/render.mjs");

test("presentation_open y editor_open están publicados y validan el recurso antes de devolver enlaces", () => {
  for (const name of ["presentation_open", "editor_open"]) {
    assert.match(mcp, new RegExp(`name: "${name}"`));
    assert.match(mcp, new RegExp(`case "${name}"`));
  }
  assert.match(mcp, /presentationUrl: `\$\{editorUrl\}&present=1&presentationFrame=/);
  assert.match(mcp, /surface must be design, video, or photo/);
  assert.match(mcp, /photo mode requires frameId and layerId together/);
});

test("los deep links de presentación y selector de editor son consumidos por el editor", () => {
  assert.match(editor, /params\.get\("present"\) !== "1"/);
  assert.match(editor, /params\.get\("presentationFrame"\)/);
  assert.match(editor, /setPresentationOpen\(true\)/);
  assert.match(editor, /url\.searchParams\.delete\("presentationFrame"\)/);
  assert.match(editor, /if \(view === "video"\) setVideoModeOpen\(true\)/);
  assert.match(editor, /else setPhotoFramePickerOpen\(true\)/);
});

test("video_render usa el mismo exportador de navegador que el botón visible", () => {
  assert.match(mcp, /delivery: "browser"/);
  assert.match(mcp, /video-render=1&video-format=/);
  assert.match(videoEditor, /params\.get\("video-render"\) !== "1"/);
  assert.match(videoEditor, /void exportVideo\(\{ format, scale \}\)/);
  assert.match(videoEditor, /exportStandaloneVideo\(store\.getSnapshot\(\), \{ \.\.\.options, onProgress: setExportProgress \}\)/);
});

test("los renderizadores MCP normalizan las fuentes antes de serializar CSS", () => {
  assert.match(mcp, /import \{ repairMalformedFontDeclarations \} from "\.\.\/\.\.\/\.\.\/src\/lib\/fontFamily\.ts"/);
  assert.match(mcp, /const css = repairMalformedFontDeclarations\(frame\.css \|\| ""\)/);
  assert.match(mcp, /const normalizedFrames = frames\.map\(f => \(\{ \.\.\.f, css: repairMalformedFontDeclarations\(f\.css \|\| ""\) \}\)\)/);
  assert.match(workerRenderer, /import \{ repairMalformedFontDeclarations \} from "\.\.\/\.\.\/\.\.\/src\/lib\/fontFamily\.ts"/);
  assert.match(workerRenderer, /const cssContent = repairMalformedFontDeclarations\(tpl\._frameCss \|\| tpl\.css \|\| ""\)/);
  assert.match(workerRenderer, /const css = repairMalformedFontDeclarations\(f\.css \|\| ""\)/);
});
