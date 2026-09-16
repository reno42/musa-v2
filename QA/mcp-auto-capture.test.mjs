import test from "node:test";
import assert from "node:assert/strict";
import { shouldCaptureMethod, summarizeCapturedCall } from "../netlify/functions/work-capture.mjs";

test("REQ-024: the curated allowlist captures deliverables and skips reads", () => {
  const captured = [
    "create_template", "create_html_frame", "create_html_carousel", "create_frame",
    "import_design", "set_html", "set_css", "set_frame_layers", "create_chart",
    "apply_csv_to_frames", "render_batch", "batch_render_html",
    "add_content_idea", "update_content",
    "ai_generate_image", "generate_image_video", "generate_text_video",
    "remove_background", "separate_image_layers",
  ];
  for (const m of captured) assert.equal(shouldCaptureMethod(m), true, `should capture ${m}`);

  const skipped = [
    "studio_list_cards", "studio_get_card", "list_templates", "get_template",
    "search_templates", "harness_claim_feature", "harness_log_entry",
    "studio_add_comment", "tools/list", "ping", undefined, "", null,
  ];
  for (const m of skipped) assert.equal(shouldCaptureMethod(m), false, `should skip ${m}`);
});

test("REQ-024: the summary carries names/ids/sizes, never HTML/CSS bodies", () => {
  const s = summarizeCapturedCall("set_html", {
    templateId: "tpl_abc123",
    frameId: "fr_88",
    html: "<div>" + "x".repeat(3300) + "</div>",
  });
  assert.ok(s.includes("set_html"), s);
  assert.ok(s.includes("tpl_abc123"), s);
  assert.ok(s.includes("fr_88"), s);
  assert.ok(s.includes("html 3.2KB"), s);
  assert.ok(!s.includes("xxxxx"), "must never embed the html body");
  assert.ok(s.length <= 500, s);
});

test("REQ-024: css sizes and batch row/csv counts land in one line", () => {
  const s = summarizeCapturedCall("apply_csv_to_frames", {
    templateId: "tpl_1",
    rows: [{}, {}, {}],
    csv: "a".repeat(2048),
    css: "y".repeat(100),
  });
  assert.ok(s.includes("rows 3"), s);
  assert.ok(s.includes("csv 2.0KB"), s);
  assert.ok(s.includes("css 100B"), s);
  assert.ok(!s.includes("aaaaa"), s);
});

test("REQ-024: weird params never throw and stay bounded", () => {
  assert.doesNotThrow(() => summarizeCapturedCall("set_html", null));
  assert.doesNotThrow(() => summarizeCapturedCall("set_html", [1, 2]));
  assert.doesNotThrow(() => summarizeCapturedCall("set_html", { html: 42, frames: "x" }));
  const s = summarizeCapturedCall("create_template", { name: "N".repeat(900), frames: 3 });
  assert.ok(s.length <= 500, s);
  assert.ok(s.includes("frames 3"), s);
});
