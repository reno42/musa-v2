import assert from "node:assert/strict";
import test from "node:test";
import {
  assertEditableFrame,
  auditEditableFrame,
  buildEditableCanvasLayers,
  buildEditableFrameLayers,
} from "../netlify/functions/editable-layers.mjs";

test("builds a flat, explicitly positioned layer document", () => {
  const result = buildEditableFrameLayers([
    { id: "background", name: "Background", kind: "shape", x: 0, y: 0, width: 1080, height: 1080, style: { background: "#111827" } },
    { id: "hero_title", name: "Hero title", kind: "text", x: 80, y: 120, width: 800, height: 160, text: "Luxury <scale>", tag: "h1", style: { fontSize: 72, lineHeight: 1.05 } },
  ]);

  assert.deepEqual(result.layerIds, ["background", "hero_title"]);
  assert.match(result.html, /data-layer-kind="shape"/);
  assert.match(result.html, /Luxury &lt;scale&gt;/);
  assert.equal((result.html.match(/data-layer-id=/g) || []).length, 2);
  assert.match(result.css, /left: 80px/);
  assert.match(result.css, /width: 800px/);
  assert.equal(auditEditableFrame(result.html, result.css).valid, true);
});

test("rejects accidental compound layers instead of guessing how to ungroup them", () => {
  const html = `<div data-layer-id="card" data-layer-name="Card" data-layer-kind="shape"><h2>Title</h2><p>Body</p></div>`;
  const css = `[data-layer-id="card"] { position:absolute; left:10px; top:10px; width:300px; height:200px; }`;
  const audit = auditEditableFrame(html, css);

  assert.equal(audit.valid, false);
  assert.match(audit.errors.join(" "), /contains child elements/);
  assert.throws(() => assertEditableFrame(html, css), /set_frame_layers/);
});

test("requires explicit intent before accepting groups", () => {
  const html = `<div data-layer-id="group" data-layer-name="Group" data-layer-kind="group"><p data-layer-id="copy" data-layer-name="Copy" data-layer-kind="text">Hello</p></div>`;
  const css = `[data-layer-id="group"] { position:absolute; left:10px; top:10px; width:300px; height:200px; }`;

  assert.equal(auditEditableFrame(html, css).valid, false);
  assert.equal(auditEditableFrame(html, css, { allowGroups: true }).valid, true);
});

test("rejects layers without independent coordinates", () => {
  const html = `<p data-layer-id="copy" data-layer-name="Copy" data-layer-kind="text">Hello</p>`;
  const audit = auditEditableFrame(html, "");

  assert.equal(audit.valid, false);
  assert.match(audit.errors.join(" "), /position:absolute/);
  assert.match(audit.errors.join(" "), /left and top/);
});

test("builds root canvas objects with explicit null frame ownership", () => {
  const [object] = buildEditableCanvasLayers([
    { id: "working_copy", name: "Working copy", kind: "text", x: 1400, y: 120, width: 480, height: 80, text: "Outside frame" },
  ]);

  assert.equal(object.frameId, null);
  assert.equal(object.x, 1400);
  assert.equal(object.y, 120);
  assert.equal(object.kind, "text");
  assert.match(object.css, /left: 0px/);
  assert.match(object.html, /Outside frame/);
});
