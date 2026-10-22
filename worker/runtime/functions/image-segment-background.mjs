// ═══════════════════════════════════════════════════════════════════
// image-segment-background.mjs — calado/segmentación (BACKGROUND)
// ═══════════════════════════════════════════════════════════════════
//
// ONNX inference (u2netp / MobileSAM / CLIPSeg) cannot run inside
// /api/* — the api.mjs Express adapter kills requests at 9s and the
// models take 1-15s of CPU each. Same architecture as musa-batch
// (v2.3): the `-background` FILENAME SUFFIX opts this handler into
// Netlify's background functions — every HTTP call gets an immediate
// empty 202, then this handler runs for up to 15 minutes. Its response
// body never reaches the caller; results land in the `segment_jobs`
// table (polled by REST /api/segment/* and MCP segment_status).
//
// Invocation modes (both authenticated by x-batch-secret when
// MUSA_BATCH_SECRET or SEGMENT_SECRET is configured):
//   ?jobId=<id>   process that specific job row (the normal path —
//                 inserted by REST/MCP just before dispatching here)
//   (no params)   sweep queued jobs older than 15s (self-healing for
//                 dispatches that died between row-insert and fetch).
//                 Every invocation sweeps, so orphaned jobs are picked
//                 up by the next job's run — no scheduler needed.
//
// Error policy (musa-batch convention):
//   - Transient (502/503, connect, timeout, network): 500 → Netlify's
//     native retries (1 min, then 2 min) re-run this handler; the job
//     claim in segment_jobs is status-guarded, so a retry after a
//     completed job is a no-op.
//   - Permanent (bad input, missing model, unknown kind): the job row
//     is already marked error by segment-core; return 200 so Netlify
//     does not burn retries on it.
// ═══════════════════════════════════════════════════════════════════

async function loadSegmentationEngine() {
  // El motor ONNX usa APIs de Node y sólo se carga cuando una ruta de
  // segmentación se invoca. Así el Worker puede arrancar aunque esta
  // capacidad no esté disponible en el runtime edge.
  return import("../segment/segment-core.mjs");
}

const SEGMENT_SECRET = process.env.SEGMENT_SECRET || process.env.MUSA_BATCH_SECRET || "";

// Transient (infrastructure) failure signatures — worth a native retry.
// Business errors (unknown kind, bad URL, missing weights) are written
// to the job row as status=error and never reach this handler's catch.
const TRANSIENT_ERROR_RE = /(50[234])|upstream|connect|econn|timeout|timed[\s-]*out|fetch[\s-]*failed|socket|network|enotfound|relation .+ does not exist/i;

function isTransientError(e) {
  const hay = [e?.message, e?.code, e?.details, String(e?.cause || "")].filter(Boolean).join(" ");
  return TRANSIENT_ERROR_RE.test(hay);
}

export const handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  // Auth: the caller already received its empty 202 by the time this
  // runs — a 401 would only pollute the logs. Return 200 (no native
  // retries wasted on unauthorized calls) and do nothing.
  if (SEGMENT_SECRET) {
    const provided = event.headers["x-batch-secret"] || event?.queryStringParameters?.secret || "";
    if (provided !== SEGMENT_SECRET) {
      console.error("[image-segment] unauthorized call (bad or missing x-batch-secret)");
      return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: "Unauthorized (x-batch-secret)" }) };
    }
  }

  const startedAt = Date.now();
  const jobId = event?.queryStringParameters?.jobId || "";
  try {
    const { processJobById, sweepQueuedJobs } = await loadSegmentationEngine();
    const results = [];
    if (jobId) {
      results.push({ mode: "job", ...(await processJobById(jobId)) });
    }
    // Always sweep: catches orphaned queued jobs (dispatch died between
    // row-insert and fetch) and stale running claims from dead invocations.
    results.push(...(await sweepQueuedJobs()).map(r => ({ mode: "sweep", ...r })));
    const ran = results.filter(r => !r.skipped).length;
    console.log(`[image-segment] ${jobId ? `job ${jobId} + ` : ""}sweep done in ${Date.now() - startedAt}ms (${ran} processed)`);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, durationMs: Date.now() - startedAt, results }),
    };
  } catch (e) {
    const transient = isTransientError(e);
    console.error(`[image-segment] failed in ${Date.now() - startedAt}ms (${transient ? "transient" : "permanent"}): ${e?.message || e}`);
    return {
      // 500 → Netlify native retry re-invokes this handler; the status-
      // guarded claim makes re-processing safe. Permanent errors return
      // 200 (the job row already carries the error for the poller).
      statusCode: transient ? 500 : 200,
      headers,
      body: JSON.stringify({ ok: false, transient, durationMs: Date.now() - startedAt, error: e?.message || String(e) }),
    };
  }
};
