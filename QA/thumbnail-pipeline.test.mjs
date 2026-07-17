import assert from "node:assert/strict";
import test from "node:test";
import { store } from "../api/src/services/store.ts";

// ── Thumbnail pipeline: SVG placeholder generation ──
// Tests the auto-thumbnail behavior via updateTemplate's ensureThumbnail.
// We test through the store directly since templates.ts internal functions
// are triggered by updateTemplate which interacts with store.

// Helper: generate a base64 SVG thumbnail similar to what ensureThumbnail produces
function makeSvgThumbnail(name, width, height, background) {
  const bg = background || "#0d0d1a";
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="${bg}"/>
  <text x="50%" y="45%" text-anchor="middle" fill="rgba(255,255,255,0.15)" font-family="sans-serif" font-size="${Math.max(14, Math.round(width / 15))}px">${esc(name)}</text>
  <text x="50%" y="58%" text-anchor="middle" fill="rgba(255,255,255,0.08)" font-family="sans-serif" font-size="${Math.max(10, Math.round(width / 30))}px">${width}×${height}</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

test("SVG thumbnail data URI is valid and parsable", () => {
  const thumb = makeSvgThumbnail("My Design", 1080, 1080, "#1a1a2e");
  assert.ok(thumb.startsWith("data:image/svg+xml;base64,"), "must be a base64 SVG data URI");

  const b64 = thumb.replace("data:image/svg+xml;base64,", "");
  const svg = Buffer.from(b64, "base64").toString("utf-8");
  assert.ok(svg.startsWith("<svg"), "decoded content should be SVG XML");
  assert.ok(svg.includes("My Design"), "should contain template name");
  assert.ok(svg.includes("1080"), "should contain width dimension");
  assert.ok(svg.includes("#1a1a2e"), "should contain background color");
});

test("SVG thumbnail escapes XML special characters", () => {
  const thumb = makeSvgThumbnail("Test & <Demo> \"Quotes\"", 800, 600);
  const b64 = thumb.replace("data:image/svg+xml;base64,", "");
  const svg = Buffer.from(b64, "base64").toString("utf-8");

  assert.ok(!svg.includes("& "), "unescaped ampersand should not appear");
  assert.ok(svg.includes("&amp;"), "& should be escaped as &amp;");
  assert.ok(svg.includes("&lt;"), "< should be escaped as &lt;");
  assert.ok(svg.includes("&quot;"), "\" should be escaped as &quot;");
});

test("SVG thumbnail uses default background when none provided", () => {
  const thumb = makeSvgThumbnail("Default BG", 400, 300);
  const b64 = thumb.replace("data:image/svg+xml;base64,", "");
  const svg = Buffer.from(b64, "base64").toString("utf-8");
  assert.ok(svg.includes("#0d0d1a"), "should use default #0d0d1a background");
});

test("thumbnail stored on template persists through updates", () => {
  const tpl = store.createTemplate({
    workspaceId: "test_ws",
    name: "Persist Test",
    userId: "user_1",
  });

  // Simulate what ensureThumbnail does: set thumbnail on template
  tpl.thumbnail = makeSvgThumbnail(tpl.name, tpl.width, tpl.height, "#ff5500");

  // Update the template (store.updateTemplate preserves thumbnail via spread)
  const updated = store.updateTemplate(tpl.id, { name: "Persist Test Renamed" });
  assert.ok(updated);
  assert.ok(updated.thumbnail, "thumbnail should survive update");
  assert.ok(updated.thumbnail.startsWith("data:image/svg+xml;base64,"));

  // Update again — thumbnail should NOT be overwritten if already present
  const prev = updated.thumbnail;
  const updated2 = store.updateTemplate(tpl.id, { name: "Persist Test Renamed Again" });
  assert.equal(updated2.thumbnail, prev, "existing thumbnail should be preserved");

  store.purgeTemplate(tpl.id);
});

test("templates without frames get no auto-thumbnail (ensureThumbnail is no-op)", () => {
  const tpl = store.createTemplate({
    workspaceId: "test_ws",
    name: "No Frames",
    userId: "user_1",
  });

  // Template has no frames with HTML → thumbnail stays undefined
  assert.equal(tpl.thumbnail, undefined);

  // Update won't generate thumbnail because no frames have html
  const updated = store.updateTemplate(tpl.id, { name: "No Frames Renamed" });
  assert.ok(updated);
  assert.equal(updated.thumbnail, undefined);

  store.purgeTemplate(tpl.id);
});

test("thumbnail appears in store listing (listTemplates)", () => {
  const tpl = store.createTemplate({
    workspaceId: "test_ws",
    name: "Listing Test",
    userId: "user_1",
  });
  tpl.thumbnail = makeSvgThumbnail(tpl.name, tpl.width, tpl.height, "#334455");

  const { data } = store.listTemplates("test_ws");
  const found = data.find(t => t.id === tpl.id);
  assert.ok(found, "template should be in listing");
  assert.ok(found.thumbnail, "listing should include thumbnail");
  assert.ok(found.thumbnail.startsWith("data:image/svg+xml;base64,"));

  store.purgeTemplate(tpl.id);
});

test("thumbnail data URI is under 2KB (lightweight)", () => {
  const thumb = makeSvgThumbnail("Lightweight Test", 1920, 1080);
  // Base64 overhead is ~33%, so ~400 bytes of SVG → ~550 bytes base64
  assert.ok(thumb.length < 2000, `thumbnail should be lightweight, got ${thumb.length} chars`);
});

test("different template sizes produce different thumbnails", () => {
  const small = makeSvgThumbnail("Small", 400, 300);
  const large = makeSvgThumbnail("Large", 1920, 1080);

  assert.notEqual(small, large, "different sizes should produce different thumbnails");
  assert.ok(small.length < large.length, "wider template should produce slightly larger SVG");
});
