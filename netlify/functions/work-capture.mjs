// REQ-024 — server-side auto-capture of agent work (zero tokens).
//
// Pure helpers used by mcp.mjs after a successful captured tool call: the
// dispatcher resolves the account's ONE active Kanban task (hard rule:
// ≤1 in draft/design per account) and appends a single sanitized line to its
// design_kanban_activity_log row (created_by "auto").
//
// This module must stay dependency-free and Node-testable: mcp.mjs itself is
// NOT importable outside Netlify's esbuild (its .js→.ts service imports only
// resolve there), so QA tests import THIS file directly.

// Curated allowlist — deliverable-level tools only (verified against
// tools_catalog.json). An agent refining a design calls set_html many times
// in one session; capturing every write would drown the card's activity feed.
// Extend here (and in QA/mcp-auto-capture.test.mjs) when a new deliverable-
// level tool ships. Read-only and lifecycle tools (list_*/get_*/harness_*)
// never capture: status transitions already log themselves.
const CAPTURED_TOOLS = new Set([
  // Structure / design writes
  "create_template",
  "create_html_frame",
  "create_html_carousel",
  "create_frame",
  "import_design",
  "set_html",
  "set_css",
  "set_frame_layers",
  // Batch outputs
  "apply_csv_to_frames",
  "render_batch",
  "batch_render_html",
  // Copywriting calendar
  "add_content_idea",
  "update_content",
  // Media generation
  "ai_generate_image",
  "generate_image_video",
  "generate_text_video",
  "remove_background",
  "separate_image_layers",
]);

export function shouldCaptureMethod(method) {
  return typeof method === "string" && CAPTURED_TOOLS.has(method);
}

const MAX_COMMENT = 500;

function truncate(text, max) {
  const s = String(text ?? "");
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)) + "…";
}

function fmtSize(bytes) {
  return bytes >= 1024 ? (bytes / 1024).toFixed(1) + "KB" : bytes + "B";
}

function firstDefined(source, keys) {
  for (const key of keys) {
    if (source && source[key] !== undefined && source[key] !== null && source[key] !== "") return source[key];
  }
  return null;
}

// One sanitized line: ids, names, counts and payload SIZES only. Never the
// user's prompt, never tool argument contents (HTML/CSS bodies), never
// credentials — same contract as harness_record_runtime_event.
export function summarizeCapturedCall(method, params) {
  const p = params && typeof params === "object" && !Array.isArray(params) ? params : {};
  const bits = [String(method)];

  const label = firstDefined(p, ["name", "title", "templateName", "frameName", "idea"]);
  if (label !== null) bits.push(`"${truncate(label, 60)}"`);

  for (const key of ["templateId", "frameId", "brandId", "cardId", "taskId", "contentId"]) {
    if (p[key]) bits.push(`${key} ${truncate(p[key], 14)}`);
  }

  const htmlLen = typeof p.html === "string" ? p.html.length : 0;
  const cssLen = typeof p.css === "string" ? p.css.length : 0;
  if (htmlLen > 0) bits.push("html " + fmtSize(htmlLen));
  if (cssLen > 0) bits.push("css " + fmtSize(cssLen));

  for (const key of ["frames", "count", "total", "rows"]) {
    const raw = p[key];
    const n = Array.isArray(raw) ? raw.length : Number(raw);
    if (Number.isInteger(n) && n > 0) bits.push(`${key} ${n}`);
  }

  const csvLen = typeof p.csv === "string" ? p.csv.length : 0;
  if (csvLen > 0) bits.push("csv " + fmtSize(csvLen));

  return truncate(bits.join(" · "), MAX_COMMENT);
}
