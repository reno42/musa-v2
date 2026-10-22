// ═══════════════════════════════════════════════════════════════
// harness-cron.mjs — Scheduled harness runner
// ═══════════════════════════════════════════════════════════════
//
// Triggered by:
//   1. Cloudflare Worker cron trigger
//   2. External webhook POST /harness-cron with secret header
//   3. Manual: curl -X POST https://design.futuraria.com/harness-cron
//
// What it does:
//   - Reads harness_cronjobs WHERE enabled = true AND next_run_at <= now()
//   - For each due cronjob:
//       1. Creates a task in design_kanban_tasks from task_template
//       2. Calls the MCP /mcp endpoint as the account (with stored fdr_ws_ key)
//          to act as implementer + reviewer
//       3. Updates last_run_at and next_run_at
//
// All cloud. No local state.
// ═══════════════════════════════════════════════════════════════

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const MCP_ENDPOINT =
  (process.env.URL || "https://design.futuraria.com") + "/mcp";
const HARNESS_CRON_SECRET = process.env.HARNESS_CRON_SECRET || "";

function getSupabaseAdmin() {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false },
  });
}

// Compute next run from a cron expression (simplified — supports standard 5-field cron).
// For full cron parsing, the project should add the `cron-parser` package.
function nextRunFromCron(expr, from = new Date()) {
  // Minimal implementation: supports "M H * * *" (day of month + hour pattern)
  // For anything more complex, return now + 24h as a safe fallback.
  try {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) return new Date(from.getTime() + 86400000);
    const [minStr, hourStr, domStr, , ] = parts;
    const next = new Date(from);
    next.setSeconds(0, 0);
    const targetMin = minStr === "*" ? next.getMinutes() : parseInt(minStr, 10);
    const targetHour = hourStr === "*" ? next.getHours() : parseInt(hourStr, 10);
    next.setMinutes(targetMin, 0, 0);
    next.setHours(targetHour, 0, 0);
    if (next <= from) next.setDate(next.getDate() + 1);
    return next;
  } catch {
    return new Date(from.getTime() + 86400000);
  }
}

// Helper: call the MCP /mcp endpoint as the account.
async function callMcp(method, params, accountApiKey) {
  const resp = await fetch(MCP_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": accountApiKey,
    },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  if (!resp.ok) {
    throw new Error(`MCP ${method} HTTP ${resp.status}: ${await resp.text()}`);
  }
  const json = await resp.json();
  if (json?.error) throw new Error(`MCP ${method} error: ${json.error.message}`);
  const text = json?.result?.content?.[0]?.text;
  return text ? JSON.parse(text) : json?.result || {};
}

// Run a single cronjob end-to-end.
async function runCronjob(sb, cron) {
  console.log(`[harness-cron] running ${cron.id} (${cron.name}) for account ${cron.account_id}`);

  // 1. Create the task from template
  const taskId = "card_cron_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
  const tpl = cron.task_template || {};
  const { data: task, error: terr } = await sb.from("design_kanban_tasks").insert({
    id: taskId,
    account_id: cron.account_id,
    title: tpl.title || cron.name,
    workspace_id: cron.workspace_id || tpl.workspaceId || null,
    brand_id: cron.brand_id || tpl.brandId || null,
    type: tpl.type || cron.feature_type || "post",
    format: tpl.format || null,
    status: "backlog",
    priority: tpl.priority || 2,
    brief: tpl.brief || null,
    tone: tpl.tone || null,
    cta: tpl.cta || null,
    acceptance: tpl.acceptance || [],
    tags: ["cron", cron.id],
    cronjob_id: cron.id,
    created_by: "harness-cron",
  }).select().single();
  if (terr) throw new Error("Task create failed: " + terr.message);

  // 2. Decrypt the account API key (stored as plain in v1; encrypt in production)
  if (!cron.encrypted_api_key) {
    // Can't act on the task without a key — leave it in backlog for the human.
    console.log(`[harness-cron] no api key for ${cron.id}; task ${taskId} left in backlog`);
    await sb.from("design_kanban_activity_log").insert({
      id: "log_" + Date.now().toString(36) + "_cr" + cron.id.slice(-4),
      task_id: taskId,
      to_status: "backlog",
      comment: "Created by cronjob; no api_key set so task waits for manual processing.",
      created_by: "harness-cron",
    });
    return { taskId, status: "backlog_pending_human" };
  }

  // 3. Drive the full harness lifecycle via MCP using the account's key
  const key = cron.encrypted_api_key;
  try {
    // Claim
    await callMcp("harness_claim_feature", { taskId }, key);
    // Start implementer session
    const sess = await callMcp(
      "harness_start_session",
      { taskId, role: "implementer", agentName: "harness-cron", plan: tpl.brief || "Cron-driven execution" },
      key
    );
    const sessionId = sess.session?.id;
    if (sessionId) {
      await callMcp("harness_log_entry", {
        sessionId,
        entryType: "progress",
        content: `Cron ${cron.id} auto-started session. Template: ${JSON.stringify(tpl)}`,
      }, key);
    }
    // Note: the actual design work (set_html, set_css, create_frame) is task-specific
    // and typically requires an LLM to drive it. The cron leaves the task in draft
    // for the human or the chat-leader to drive the rest. This file is the trigger
    // and orchestrator scaffold, not the LLM itself.
    return { taskId, sessionId, status: "draft_pending_llm" };
  } catch (e) {
    console.error(`[harness-cron] MCP flow failed for ${cron.id}:`, e.message);
    // Release the task so it doesn't block the account
    try {
      await callMcp("harness_release_feature", { taskId, toStatus: "feedback", reason: "Cron auto-flow failed: " + e.message }, key);
    } catch (_) { /* ignore */ }
    return { taskId, status: "failed", error: e.message };
  }
}

export const handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  // Auth check for webhook invocation (Netlify scheduled invokes bypass this)
  const isScheduled = event.headers["x-worker-scheduled"] === "scheduled" || event?.queryStringParameters?.scheduled === "1";
  if (!isScheduled) {
    const provided = event.headers["x-cron-secret"] || event?.queryStringParameters?.secret || "";
    if (HARNESS_CRON_SECRET && provided !== HARNESS_CRON_SECRET) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: "Unauthorized. Provide x-cron-secret header matching HARNESS_CRON_SECRET." }) };
    }
  }

  const sb = getSupabaseAdmin();
  if (!sb) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Supabase not configured" }) };
  }

  const now = new Date().toISOString();
  const { data: dueCrons, error } = await sb.from("harness_cronjobs")
    .select("*")
    .eq("enabled", true)
    .or(`next_run_at.is.null,next_run_at.lte.${now}`);

  if (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "DB error: " + error.message }) };
  }

  const results = [];
  for (const cron of dueCrons || []) {
    try {
      const result = await runCronjob(sb, cron);
      results.push({ cronId: cron.id, ...result });
    } catch (e) {
      results.push({ cronId: cron.id, error: e.message });
    }
    // Schedule next run
    const next = nextRunFromCron(cron.schedule, new Date());
    await sb.from("harness_cronjobs").update({
      last_run_at: now,
      next_run_at: next.toISOString(),
    }).eq("id", cron.id);
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      ok: true,
      processedAt: now,
      dueCount: (dueCrons || []).length,
      results,
    }),
  };
};
