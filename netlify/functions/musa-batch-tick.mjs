// ═══════════════════════════════════════════════════════════════
// musa-batch-tick.mjs — Hourly dispatcher for the Musa batch (v2.2)
// ═══════════════════════════════════════════════════════════════
//
// Scheduled function (netlify.toml, 0 * * * * = hourly). Scheduled
// functions are capped at 30 seconds and cannot be invoked by URL, so
// this tick NEVER runs the pipeline itself — its only job is to POST to
// the musa-batch BACKGROUND function (15-minute limit, native retry)
// and exit. The dispatch takes ~200ms; the 30s budget is never at risk.
//
// Why hourly: if a batch run fails on an outage that outlasts
// musa-batch's native retries (1 min → 2 min), the next tick retries
// on its own — full self-healing without human intervention.
//
// The background function answers an immediate 202 (invocation queued).
// Anything else means the DISPATCH failed (function not deployed, bad
// secret) — logged loudly. Netlify does not retry scheduled functions,
// so the next hourly tick is the safety net.
// ═══════════════════════════════════════════════════════════════

const SITE_URL = (process.env.URL || process.env.DEPLOY_URL || "https://design.futuraria.com").replace(/\/$/, "");

export const handler = async () => {
  const url = SITE_URL + "/.netlify/functions/musa-batch";
  const headers = {};
  if (process.env.MUSA_BATCH_SECRET) headers["x-batch-secret"] = process.env.MUSA_BATCH_SECRET;

  try {
    // Background function: 202 = invocation accepted, the pipeline runs
    // in background. Await only the DISPATCH, never the pipeline.
    const res = await fetch(url, { method: "POST", headers, signal: AbortSignal.timeout(15000) });
    // Drain the (empty) body so the socket is released.
    try { await res.arrayBuffer(); } catch { /* ignore */ }

    if (res.status !== 202) {
      const msg = `[musa-batch-tick] dispatch FAILED: HTTP ${res.status} — is musa-batch deployed as a background function ([functions.musa-batch] background = true)? Is MUSA_BATCH_SECRET set identically on both?`;
      console.error(msg);
      return { statusCode: 502, body: JSON.stringify({ ok: false, error: msg }) };
    }
    console.log("[musa-batch-tick] dispatched musa-batch (202 accepted)");
    return { statusCode: 200, body: JSON.stringify({ ok: true, dispatched: true }) };
  } catch (e) {
    console.error(`[musa-batch-tick] dispatch error: ${e?.message || e}`);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: e?.message || String(e) }) };
  }
};
