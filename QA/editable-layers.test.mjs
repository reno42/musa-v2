import assert from "node:assert/strict";
import test from "node:test";
import {
  assertEditableFrame,
  auditEditableFrame,
  buildEditableCanvasLayers,
  buildEditableFrameLayers,
  normalizeLayersFirstFrame,
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

test("moves full-frame solid paint to frame.background", () => {
  const result = normalizeLayersFirstFrame(
    `<div class="card"><p data-layer-id="copy" data-layer-name="Copy" data-layer-kind="text">Hello</p></div>`,
    `.card { width:1080px; height:1575px; background:#dded32; }\n.copy { color:#111; }`,
    { width: 1080, height: 1575, background: "#ffffff" },
  );

  assert.equal(result.background, "#dded32");
  assert.doesNotMatch(result.css, /background\s*:\s*#dded32/i);
  assert.match(result.html, /data-layer-kind="group"/);
  assert.match(result.html, /position:absolute/);
  assert.equal(result.audit.valid, true);
});

test("moves a solid body background to frame.background", () => {
  const result = normalizeLayersFirstFrame(
    `<p style="position:absolute;left:20px;top:30px">Hello</p>`,
    `body { width:1080px; height:1080px; background-color:rgb(221, 237, 50); }`,
    { width: 1080, height: 1080, background: "#ffffff" },
  );

  assert.equal(result.background, "rgb(221, 237, 50)");
  assert.doesNotMatch(result.css, /background-color/i);
  assert.match(result.css, /width\s*:\s*1080px/);
  assert.equal(result.audit.valid, true);
});

test("keeps a painted non-frame wrapper as an editable container", () => {
  const result = normalizeLayersFirstFrame(
    `<div class="card"><span>Visible card</span></div>`,
    `.card { position:absolute; left:20px; top:30px; width:300px; height:180px; background:#dded32; }`,
    { width: 1080, height: 1080 },
  );

  assert.equal(result.background, "#ffffff");
  assert.match(result.html, /data-layer-kind="container"/);
  assert.equal(result.audit.valid, true);
});

test("collapses rich-text descendants into one semantic text layer", () => {
  const result = normalizeLayersFirstFrame(
    `<p data-layer-id="body" data-layer-name="Body" data-layer-kind="text" style="position:absolute;left:20px;top:30px;width:300px;height:180px"><span data-layer-id="word" data-layer-kind="text">Hello</span><br data-layer-id="break" data-layer-kind="shape">world</p>`,
    "",
  );

  assert.equal((result.html.match(/data-layer-id=/g) || []).length, 1);
  assert.match(result.html, /<span>Hello<\/span><br>world/);
  assert.equal(result.audit.layerCount, 1);
});

test("normalizes SVG internals as one vector layer", () => {
  const result = normalizeLayersFirstFrame(
    `<svg data-layer-id="icon" data-layer-name="Icon" data-layer-kind="shape" style="position:absolute;left:10px;top:10px;width:40px;height:40px" viewBox="0 0 40 40"><path data-layer-id="path" d="M0 0h40v40z"/></svg>`,
    "",
  );

  assert.match(result.html, /data-layer-kind="svg"/);
  assert.equal((result.html.match(/data-layer-id=/g) || []).length, 1);
  assert.equal(result.audit.valid, true);
});

test("audit rejects painted structural groups and nested text layers", () => {
  const group = auditEditableFrame(
    `<div data-layer-id="group" data-layer-name="Group" data-layer-kind="group" style="position:absolute;left:0;top:0;width:100px;height:100px;background:red"></div>`,
    "",
    { allowGroups: true },
  );
  assert.equal(group.valid, false);
  assert.match(group.errors.join(" "), /owns visible paint/);

  const text = auditEditableFrame(
    `<p data-layer-id="copy" data-layer-name="Copy" data-layer-kind="text" style="position:absolute;left:0;top:0"><span data-layer-id="word" data-layer-name="Word" data-layer-kind="text">Hi</span></p>`,
    "",
    { allowGroups: true },
  );
  assert.equal(text.valid, false);
  assert.match(text.errors.join(" "), /rich-text content, not layers/);
});

test("audit rejects hidden canvas paint and pseudo-element objects", () => {
  const html = `<p data-layer-id="copy" data-layer-name="Copy" data-layer-kind="text" style="position:absolute;left:0;top:0">Hi</p>`;
  const audit = auditEditableFrame(html, `
    body { background: linear-gradient(red, blue); }
    [data-layer-id="copy"]::before { content:"★"; }
  `);

  assert.equal(audit.valid, false);
  assert.match(audit.errors.join(" "), /Canvas-level CSS owns visible paint/);
  assert.match(audit.errors.join(" "), /Pseudo-elements cannot own visible design content/);
});

test("normalizes the Archivo2 regression without inventing span or br layers", () => {
  const html = `<div class="card" data-layer-id="el_sd_card" data-layer-kind="group">
    <div class="bracket" data-layer-id="el_sd_num" data-layer-kind="text">[2]</div>
    <div class="body" data-layer-id="el_sd_body" data-layer-kind="text"><span>First line</span><br><span data-layer-id="bad_word">Second line</span><br data-layer-id="bad_break"></div>
    <div class="footer" data-layer-id="el_sd_foot" data-layer-kind="group"><div class="logo-mark" data-layer-id="el_sd_mark" data-layer-kind="text">S</div><div class="wordmark" data-layer-id="el_sd_word" data-layer-kind="text">Skilldose</div></div>
  </div>`;
  const css = `body{width:1080px;height:1575px;margin:0;padding:0}
    .card{width:1080px;height:1575px;position:relative;overflow:hidden;background:#dded32;color:#111}
    .card *,.card *::before,.card *::after{box-sizing:border-box;margin:0;padding:0}
    .bracket{position:absolute;left:96px;top:64px}
    .body{position:absolute;left:96px;top:400px;width:880px}
    .footer{position:absolute;left:96px;bottom:74px;display:flex}
    .logo-mark{width:38px;height:38px;border:4px solid #111}
    .wordmark{font-size:26px}`;

  const result = normalizeLayersFirstFrame(html, css, { width: 1080, height: 1575, background: "#ffffff" });

  assert.equal(result.background, "#dded32");
  assert.equal(result.audit.valid, true);
  assert.equal(result.audit.layerCount, 6);
  assert.doesNotMatch(result.html, /bad_word|bad_break/);
  assert.match(result.html, /data-layer-id="el_sd_body"[^>]*data-layer-kind="text"/);
  assert.match(result.html, /data-layer-id="el_sd_card"[^>]*data-layer-kind="group"/);
});
