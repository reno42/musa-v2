// ═══════════════════════════════════════════════════════════════
// musa-batch-background.mjs — Musa Batch pipeline (Kanban v2.3, BACKGROUND)
// ═══════════════════════════════════════════════════════════════
//
// ARCHITECTURE (v2.3 — Netlify Background Function):
//   Scheduled functions have a 30-second execution limit and cannot be
//   invoked by URL, so the LLM pipeline cannot live in one. This
//   function runs as a BACKGROUND function instead — opted in by the
//   `-background` FILENAME SUFFIX (Netlify's actual mechanism; the
//   `[functions.musa-batch] background = true` config key we used in
//   v2.2 was a no-op, which left the function answering SYNCHRONOUSLY:
//   callers waited for the full pipeline, their fetch aborts killed
//   long runs mid-LLM, and multi-frame generations never finished):
//     - URL-invocable: every HTTP call gets an immediate empty 202 and
//       this handler runs in the background for up to 15 minutes. The
//       handler's own response NEVER reaches the HTTP caller — it only
//       lands in the Netlify function logs.
//     - No native retries: background functions are not re-invoked on
//       error. Transient errors return 500 for the logs, and the hourly
//       musa-batch-tick is the self-healing safety net.
//     - Real results are delivered via Supabase (card status/activity/
//       checkpoints) and Telegram (notify_on_complete), never via HTTP.
//
// Consumers (both must send x-batch-secret when MUSA_BATCH_SECRET is set):
//   1. musa-batch-tick — scheduled function (hourly, 0 * * * *) that
//      only dispatches here. The hourly cadence self-heals failed runs
//      (background functions have no native retries).
//   2. mcp.mjs musa_batch_run — the Kanban "Ejecutar batch" button.
//      It POSTs here, checks the 202, and answers {started:true/false}
//      with the real dispatch result.
//
// Error policy:
//   - Transient infra failures (Supabase 503 / upstream connect /
//     timeout / network): return 500 → logged; the next hourly tick
//     re-runs. Cards already advanced are skipped on re-run (every
//     write is status-guarded), and the 2-minute hands-off guard keeps
//     an immediate re-run from double-stepping freshly-touched cards.
//   - Business errors (missing config, invalid data, bad secret):
//     return 200 {ok:false} → no point retrying a config error
//     (it only burns execution credits).
//
// Credits note: background functions bill per execution time. A run
// with no pending cards finishes in seconds — the 24 hourly ticks/day
// stay cheap; only real pipeline work costs.
// ═══════════════════════════════════════════════════════════════

import { runDailyBatch } from "./musa-batch-core.mjs";

const MUSA_BATCH_SECRET = process.env.MUSA_BATCH_SECRET || "";

// Transient (infrastructure) failure signatures — worth a native retry.
// Anything else (missing env, business logic) is permanent: retrying
// only burns credits. False positives are cheap: the pipeline is
// idempotent (one step per card, status-guarded writes).
const TRANSIENT_ERROR_RE = /(50[234])|upstream|connect|econn|timeout|timed[\s-]*out|fetch[\s-]*failed|socket|network|enotfound/i;

function isTransientError(e) {
  const hay = [e?.message, e?.code, e?.details, String(e?.cause || "")].filter(Boolean).join(" ");
  return TRANSIENT_ERROR_RE.test(hay);
}

// Best-effort "batch failure" Telegram ping to every workspace with
// notify_on_complete. If Supabase is the outage itself, this silently
// no-ops. NOTE: fires once per failed invocation — during a hard outage
// the native retries (1/2 min) may send up to 3 pings per hourly tick.
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
    const msg = `🚨 Musa batch: falla transitoria (${String(error?.message || error).slice(0, 200)}). Reintento automático en curso; si persiste, la corrida horaria siguiente lo reintenta sola.`;
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

  // Auth: this function is URL-invocable now, so EVERY call must carry
  // the secret when MUSA_BATCH_SECRET is configured (callers:
  // musa-batch-tick and mcp.mjs musa_batch_run — both send x-batch-secret).
  // NOTE: as a background function the caller already received its empty
  // 202 before this check runs — this status code only shows up in the
  // function logs. It returns 200 (not 401) so Netlify does NOT waste
  // native retries on unauthorized calls.
  if (MUSA_BATCH_SECRET) {
    const provided = event.headers["x-batch-secret"] || event?.queryStringParameters?.secret || "";
    if (provided !== MUSA_BATCH_SECRET) {
      console.error("[musa-batch] unauthorized call (bad or missing x-batch-secret)");
      return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: "Unauthorized (x-batch-secret)" }) };
    }
  }

  const dryRun = event?.queryStringParameters?.dryRun === "1" || event?.queryStringParameters?.dryRun === "true";
  const workspaceId = event?.queryStringParameters?.workspaceId || null;

  const startedAt = Date.now();
  try {
    const result = await runDailyBatch({ workspaceId, dryRun });
    // The HTTP caller never sees this body (the 202 already went out) —
    // it is for the Netlify function logs. Real results went to Supabase
    // + Telegram. dryRun via URL is therefore a logs-only debugging aid;
    // the UI's dry run is served inline by mcp.mjs musa_batch_run.
    console.log(`[musa-batch] ok in ${Date.now() - startedAt}ms (dryRun=${dryRun})`);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, durationMs: Date.now() - startedAt, ...result }),
    };
  } catch (e) {
    const transient = isTransientError(e);
    console.error(`[musa-batch] failed in ${Date.now() - startedAt}ms (${transient ? "transient" : "permanent"}): ${e?.message || e}`);
    if (transient) {
      // 500 → Netlify native retry (1 min, then 2 min). If those also
      // fail, the hourly musa-batch-tick keeps trying: full self-healing.
      await notifyBatchFailure(e);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ ok: false, transient: true, durationMs: Date.now() - startedAt, error: e?.message || String(e) }),
      };
    }
    // Permanent/business error: 200 so Netlify does NOT retry 3x.
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: false, transient: false, durationMs: Date.now() - startedAt, error: e?.message || String(e) }),
    };
  }
};
