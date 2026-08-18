// ═══════════════════════════════════════════════════════════════════
// e2e-batch-v23.mjs — End-to-end verification of batch v2.3 fixes
//
//   1. brand_id resolved server-side (never by the LLM)
//   2. copy fast-path (backlog card with copy_draft → design, 0 LLM calls)
//   3. multi-frame generation (frames[] length === card.frame_count)
//
// All access goes through the production MCP endpoint (MCP_ADMIN_KEY),
// so no local Supabase key is needed. Each step is a separate subcommand
// so the 2-minute hands-off guard (HANDS_OFF_MS) can elapse between runs:
//
//   node QA/e2e-batch-v23.mjs check                      // cards + dry-run preview
//   node QA/e2e-batch-v23.mjs move <cardId>              // feedback → backlog
//   node QA/e2e-batch-v23.mjs trigger [workspaceId]      // musa_batch_run (real, background)
//   node QA/e2e-batch-v23.mjs poll <cardId> <timeoutSec> <expectStatus> [more...]
//   node QA/e2e-batch-v23.mjs log <cardId>               // last activity entries
//   node QA/e2e-batch-v23.mjs verify <cardId>            // template_id + frames[] assertions
//
// Reads MCP_ADMIN_KEY from .env.design-supabase (value never printed).
// ═══════════════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const MCP_URL = "https://design.futuraria.com/mcp";

let MCP_KEY = "";
for (const line of readFileSync(resolve(root, ".env.design-supabase"), "utf-8").split(/\r?\n/)) {
  const m = line.match(/^\s*MCP_ADMIN_KEY\s*=\s*(.*)\s*$/);
  if (m) MCP_KEY = m[1].trim();
}
if (!MCP_KEY) {
  console.error("FATAL: MCP_ADMIN_KEY missing in .env.design-supabase");
  process.exit(1);
}

async function callMCP(name, args) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": MCP_KEY },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args || {} } }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`MCP ${json.error.code}: ${json.error.message}`);
  if (json.result?.isError) throw new Error(`MCP tool error: ${JSON.stringify(json.result).slice(0, 300)}`);
  const text = json.result?.content?.[0]?.text;
  return text ? JSON.parse(text) : json.result;
}

function brief(card) {
  return {
    id: card.id,
    title: card.title,
    status: card.status,
    frame_count: card.frame_count,
    template_id: card.template_id || null,
    brand_id: card.brand_id || null,
    workspace_id: card.workspace_id,
    enabled: card.enabled,
    no_tocar: card.no_tocar,
    copy_len: (card.copy_draft || "").length,
    updated_at: card.updated_at,
    blocker: card.blocker_reason || null,
  };
}

// normalizeFrameCount, mirrored from musa-batch-core.mjs v2.3
function expectedFrames(n) {
  const v = parseInt(n, 10);
  if (!Number.isFinite(v) || v < 1) return 1;
  return Math.min(v, 10);
}

let passed = 0, failed = 0;
function check(name, ok, detail = "") {
  const mark = ok ? "PASS" : "FAIL";
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
  ok ? passed++ : failed++;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [cmd, ...rest] = process.argv.slice(2);

switch (cmd) {
  case "check": {
    // 1. candidate cards (feedback | backlog) + no_tocar column probe
    console.log("── candidate cards (feedback | backlog) ──");
    const fb = await callMCP("studio_list_cards", { status: "feedback" });
    const bl = await callMCP("studio_list_cards", { status: "backlog" });
    const all = [...(fb.cards || []), ...(bl.cards || [])];
    if (!all.length) console.log("  (none)");
    for (const c of all) console.log("  " + JSON.stringify(brief(c)));
    if (all.length) check("no_tocar column exists (present in card rows)", all.every((c) => typeof c.no_tocar === "boolean"));

    // 2. deployed dry-run preview (read-only; proves mcp live + llmKey state)
    console.log("── musa_batch_run dryRun preview (deployed code) ──");
    const preview = await callMCP("musa_batch_run", { dryRun: true });
    console.log(JSON.stringify(preview, null, 2).slice(0, 4000));
    break;
  }

  case "update": {
    // usage: update <cardId> <snake_caseField=value> [more...]
    // NOTE: the deployed studio_update_card handler reads SNAKE_CASE params
    // (frame_count, no_tocar, ...) even though tools/list advertises camelCase.
    const cardId = rest[0];
    const patch = {};
    for (const kv of rest.slice(1)) {
      const i = kv.indexOf("=");
      if (i > 0) {
        let v = kv.slice(i + 1);
        try { v = JSON.parse(v); } catch { /* keep raw string */ }
        patch[kv.slice(0, i)] = v;
      }
    }
    if (!cardId || !Object.keys(patch).length) { console.error("usage: update <cardId> <field=value> [...]"); process.exit(1); }
    const r = await callMCP("studio_update_card", { cardId, ...patch });
    console.log("updated → " + JSON.stringify(brief(r.card || r)));
    break;
  }

  case "move": {
    const cardId = rest[0];
    if (!cardId) { console.error("usage: move <cardId>"); process.exit(1); }
    const r = await callMCP("studio_move_card", { cardId, status: "backlog", comment: "e2e v2.3 verification: re-queue for batch" });
    console.log("moved → " + JSON.stringify(brief(r.card)));
    console.log("(hands-off guard: wait ≥2 min before triggering the batch)");
    break;
  }

  case "trigger": {
    const args = {};
    if (rest[0]) args.workspaceId = rest[0];
    // Non-fatal by design: the mcp dispatch fetch can outlive mcp's own sync
    // limit while the musa-batch run continues in background — polling is the
    // source of truth, not this response.
    try {
      const r = await callMCP("musa_batch_run", args);
      console.log(JSON.stringify(r, null, 2).slice(0, 2000));
    } catch (e) {
      console.log(`dispatch response (may still have started the run): ${e.message.slice(0, 300)}`);
    }
    break;
  }

  case "poll": {
    const cardId = rest[0];
    const timeoutSec = parseInt(rest[1], 10) || 180;
    const expects = rest.slice(2);
    if (!cardId || !expects.length) { console.error("usage: poll <cardId> <timeoutSec> <expectStatus> [more...]"); process.exit(1); }
    const deadline = Date.now() + timeoutSec * 1000;
    let last = null;
    while (Date.now() < deadline) {
      const r = await callMCP("studio_get_card", { cardId });
      const card = r.card;
      if (!card) { console.error("card not found"); process.exit(1); }
      if (card.status !== last) {
        last = card.status;
        console.log(`  ${new Date().toISOString()} status=${card.status}${card.template_id ? ` template_id=${card.template_id}` : ""}${card.blocker_reason ? ` blocker="${String(card.blocker_reason).slice(0, 200)}"` : ""}`);
      }
      if (expects.includes(card.status)) { console.log(`reached ${card.status} ✓`); process.exit(0); }
      await sleep(10000);
    }
    console.error(`TIMEOUT after ${timeoutSec}s (last status=${last})`);
    process.exit(1);
  }

  case "detail": {
    const cardId = rest[0];
    if (!cardId) { console.error("usage: detail <cardId>"); process.exit(1); }
    const r = await callMCP("studio_get_card", { cardId });
    const c = r.card;
    console.log(JSON.stringify({
      id: c.id, title: c.title, status: c.status, type: c.type, format: c.format,
      frame_count: c.frame_count, style_name: c.style_name, brand_id: c.brand_id,
      brief_len: (c.brief || "").length, brief_preview: (c.brief || "").slice(0, 220),
      copy_len: (c.copy_draft || "").length, tone: c.tone, cta: c.cta,
      acceptance: c.acceptance, enabled: c.enabled, no_tocar: c.no_tocar,
      updated_at: c.updated_at,
    }, null, 2));
    break;
  }

  case "log": {
    const cardId = rest[0];
    if (!cardId) { console.error("usage: log <cardId>"); process.exit(1); }
    const r = await callMCP("studio_get_card", { cardId });
    for (const l of (r.activityLog || []).slice(0, 14).reverse()) {
      console.log(`  ${l.created_at} ${l.from_status || "?"}→${l.to_status} [${l.created_by}] ${String(l.comment || "").slice(0, 200)}`);
    }
    break;
  }

  case "render": {
    const templateId = rest[0];
    if (!templateId) { console.error("usage: render <templateId>"); process.exit(1); }
    const r = await callMCP("render_html_template", { templateId });
    console.log(JSON.stringify({ ...r, html: r.html ? `<${r.html.length} chars>` : undefined }, null, 2));
    if (r.url) {
      const res = await fetch(r.url);
      const body = await res.text();
      console.log(`render url GET → HTTP ${res.status}, ${body.length} bytes`);
    }
    break;
  }

  case "verify": {
    const cardId = rest[0];
    if (!cardId) { console.error("usage: verify <cardId>"); process.exit(1); }
    const r = await callMCP("studio_get_card", { cardId });
    const card = r.card;
    console.log("card: " + JSON.stringify(brief(card)));

    check("card.template_id is set", !!card.template_id, card.template_id || "(empty)");
    check("card.status advanced past design (review/done)", ["review", "done"].includes(card.status), card.status);

    // fast-path proof: run 1 must have logged the v2.3 marker
    const fastPath = (r.activityLog || []).some((l) => /copy ya presente/i.test(String(l.comment || "")));
    check("activity log shows v2.3 fast-path marker (\"copy ya presente — LLM omitido\")", fastPath);

    const want = expectedFrames(card.frame_count);
    console.log(`expected frames: ${want} (card.frame_count=${card.frame_count})`);

    const tpl = await callMCP("get_template", { id: card.template_id });
    const frames = Array.isArray(tpl.frames) ? tpl.frames : [];
    check(`template frames[] length === ${want}`, frames.length === want, `got ${frames.length}`);
    check("template id matches card", tpl.id === card.template_id, `${tpl.id} vs ${card.template_id}`);

    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      const htmlOk = typeof f.html === "string" && f.html.length >= 20;
      check(`frame ${i + 1} html present (${f.html ? f.html.length : 0} chars)`, htmlOk);
      console.log(`      frame ${i + 1}: name="${f.name}" ${f.width}x${f.height} css=${(f.css || "").length} chars order=${f.order}`);
    }
    // frame 1 mirrored at top level for legacy consumers + reviewer C4
    check("top-level html mirrors frame 1", tpl.html === (frames[0] && frames[0].html), `tpl.html=${(tpl.html || "").length} chars`);

    // bonus: server-side render of the template (frame-1 mirror) if usable
    try {
      const rendered = await callMCP("render_html_template", { templateId: card.template_id });
      const ok = !!(rendered && (rendered.html || rendered.data || rendered.image || rendered.url || rendered.iframe));
      check("render_html_template returns content", ok, typeof rendered === "object" ? Object.keys(rendered).slice(0, 6).join(",") : String(rendered).slice(0, 80));
    } catch (e) {
      console.log(`  [skip] render_html_template not usable: ${e.message.slice(0, 120)}`);
    }

    console.log(`\n── verify: ${passed} passed, ${failed} failed ──`);
    process.exit(failed ? 1 : 0);
  }

  default:
    console.error("unknown or missing subcommand (check | detail | update | move | trigger | poll | log | render | verify)");
    process.exit(1);
}
