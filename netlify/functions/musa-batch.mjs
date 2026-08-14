// ═══════════════════════════════════════════════════════════════
// musa-batch.mjs — Scheduled Musa Batch (Kanban pipeline v2.1)
// ═══════════════════════════════════════════════════════════════
//
// Triggered by:
//   1. Netlify Scheduled Functions (netlify.toml, 0 * * * * = hourly).
//      Hourly cadence = self-healing: if a run fails on a long Supabase
//      outage, the next hour retries on its own.
//   2. Manual/webhook: GET /.netlify/functions/musa-batch?secret=<MUSA_BATCH_SECRET>
//      (with workspaceId / dryRun query params). mcp.mjs musa_batch_run
//      uses this path fire-and-forget.
//
// What it does:
//   - Calls runDailyBatch() from musa-batch-core.mjs.
//   - Every enabled workspace (workspace_config.auto_process_enabled) gets
//     its enabled Kanban cards (design_kanban_tasks.enabled = true) advanced
//     ONE step by role: backlog/research/draft → leader, design → implementer,
//     review → reviewer (C1-C5 → done | feedback). feedback/done untouched.
//     Status guards on every write make repeated/overlapping runs safe.
//
// Resilience (v2.1):
//   - RETRY INSIDE THE HANDLER: Netlify does NOT retry failed scheduled
//     functions, so transient infrastructure errors (Supabase 503, upstream
//     connect errors, timeouts, network failures) are retried with a
//     growing backoff (2 → 4 → 8 min; 14 min of waits + attempt time fits
//     the ~15 min scheduled-function limit).
//   - Business errors (missing config, invalid card) are NOT retried.
//   - On exhausted retries: HTTP 500 with a summary body (lands in Netlify
//     logs) + best-effort Telegram "batch no pudo correr" to workspaces
//     with notify_on_complete = true.
// ═══════════════════════════════════════════════════════════════

import { runDailyBatch } from "./musa-batch-core.mjs";

const MUSA_BATCH_SECRET = process.env.MUSA_BATCH_SECRET || "";

// 1 initial attempt + these 3 retries.
const RETRY_DELAYS_MS = [2 * 60_000, 4 * 60_000, 8 * 60_000];

// Transient (infrastructure) failure signatures — worth retrying. Anything
// else (missing env, business logic) is permanent: retrying only burns the
// run window. False positives are cheap: the pipeline is idempotent (one
// step per card, status-guarded writes).
const TRANSIENT_ERROR_RE = /(50[234])|upstream|connect|econn|timeout|timed[\s-]*out|fetch[\s-]*failed|socket|network|enotfound/i;

function isTransientError(e) {
  const hay = [e?.message, e?.code, e?.details, String(e?.cause || "")].filter(Boolean).join(" ");
  return TRANSIENT_ERROR_RE.test(hay);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Best-effort "batch could not run" Telegram ping to every workspace with
// notify_on_complete. If Supabase is the thing that's down, this silently
// no-ops — nothing to read the config from until it recovers.
async function notifyBatchFailure(error) {
  try {
    const { getSupabaseAdmin } = await import("../../api/src/services/supabase.js");
    const { sendTelegram } = await import("./telegram-notify.mjs");
    const sb = getSupabaseAdmin();
    if (!sb) return;
    const { data: configs } = await sb.from("workspace_config")
      .select("workspace_id, notify_chat_id")
      .eq("notify_on_complete", true)
      .not("notify_chat_id", "is", null);
    const msg = `🚨 Musa batch: no pudo correr tras agotar los reintentos (${String(error?.message || error).slice(0, 200)}). La próxima corrida horaria reintenta sola.`;
    for (const c of configs || []) {
      try {
        await sendTelegram(c.notify_chat_id, msg);
      } catch { /* per-chat best-effort */ }
    }
  } catch { /* best-effort — Supabase may be the outage itself */ }
}

export const handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  // Auth: Netlify scheduled invocations carry x-netlify: scheduled.
  // Manual/webhook invocations must provide the secret (when configured).
  const isScheduled = event.headers["x-netlify"] === "scheduled" || event?.queryStringParameters?.scheduled === "1";
  if (!isScheduled && MUSA_BATCH_SECRET) {
    const provided = event.headers["x-batch-secret"] || event?.queryStringParameters?.secret || "";
    if (provided !== MUSA_BATCH_SECRET) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: "Unauthorized. Provide x-batch-secret header matching MUSA_BATCH_SECRET." }) };
    }
  }

  const dryRun = event?.queryStringParameters?.dryRun === "1" || event?.queryStringParameters?.dryRun === "true";
  const workspaceId = event?.queryStringParameters?.workspaceId || null;

  // dryRun never retries: it is a fast query-only preview, and callers
  // (mcp.mjs musa_batch_run) await its response within the sync limit.
  const delays = dryRun ? [] : RETRY_DELAYS_MS;
  const startedAt = Date.now();
  let lastError = null;

  for (let attempt = 1; attempt <= delays.length + 1; attempt++) {
    try {
      const result = await runDailyBatch({ workspaceId, dryRun });
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true, attempts: attempt, durationMs: Date.now() - startedAt, ...result }),
      };
    } catch (e) {
      lastError = e;
      const transient = isTransientError(e);
      console.error(`[musa-batch] attempt ${attempt}/${delays.length + 1} failed (${transient ? "transient" : "permanent"}): ${e?.message || e}`);
      const delayMs = delays[attempt - 1];
      if (delayMs === undefined || !transient) break; // out of retries, or business error
      console.log(`[musa-batch] retrying in ${Math.round(delayMs / 60000)} min`);
      await sleep(delayMs);
    }
  }

  // Retries exhausted. Only transient (outage) failures ping Telegram:
  // permanent config errors already surface in logs/results and would
  // otherwise spam once per hour.
  const transient = isTransientError(lastError);
  if (transient) await notifyBatchFailure(lastError);
  return {
    statusCode: 500,
    headers,
    body: JSON.stringify({
      ok: false,
      transient,
      attempts: delays.length + 1,
      durationMs: Date.now() - startedAt,
      error: lastError?.message || String(lastError),
    }),
  };
};
