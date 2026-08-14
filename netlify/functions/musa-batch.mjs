// ═══════════════════════════════════════════════════════════════
// musa-batch.mjs — Scheduled Musa Daily Batch (Kanban pipeline v2)
// ═══════════════════════════════════════════════════════════════
//
// Triggered by:
//   1. Netlify Scheduled Functions (netlify.toml, 0 9 * * * = 9:00 UTC = 4:00 am Perú)
//   2. Manual/webhook: POST /.netlify/functions/musa-batch?secret=<MUSA_BATCH_SECRET>
//      (or with dryRun=1 / workspaceId=<id> query params for testing)
//
// What it does:
//   - Calls runDailyBatch() from musa-batch-core.mjs.
//   - Every enabled workspace (workspace_config.auto_process_enabled) gets
//     its enabled Kanban cards (design_kanban_tasks.enabled = true) advanced
//     one step by role: backlog/research/draft → leader, design → implementer,
//     review → reviewer (C1-C5 → done | feedback). feedback/done untouched.
//
// Why a dedicated scheduled function: the pipeline makes LLM calls and can
// run several minutes. Netlify scheduled functions have a ~15 min background
// limit vs the ~10s sync limit of the /mcp function (which only offers
// dryRun previews via process_daily_batch).
// ═══════════════════════════════════════════════════════════════

import { runDailyBatch } from "./musa-batch-core.mjs";

const MUSA_BATCH_SECRET = process.env.MUSA_BATCH_SECRET || "";

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

  try {
    const result = await runDailyBatch({ workspaceId, dryRun });
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, ...result }),
    };
  } catch (e) {
    console.error("[musa-batch] run failed:", e);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: e.message || String(e) }),
    };
  }
};
