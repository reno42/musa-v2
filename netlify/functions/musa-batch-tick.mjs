// ═══════════════════════════════════════════════════════════════
// musa-batch-tick.mjs — Hourly dispatcher for the Musa batch (v2.4)
// ═══════════════════════════════════════════════════════════════
//
// Scheduled function (netlify.toml, 0 * * * * = hourly). Scheduled
// functions are capped at 30 seconds and cannot be invoked by URL, so
// this tick NEVER runs the pipeline itself — its only job is to POST to
// the musa-batch BACKGROUND function (15-minute limit, native retry)
// and exit. The dispatch takes ~200ms; the 30s budget is never at risk.
//
// v2.4 SMART TICK — three kill switches run BEFORE any dispatch, so a
// disabled platform pays exactly 1 scheduled invocation/hour and ZERO
// background runs:
//   1. Env: MUSA_TICK_ENABLED=false (Netlify dashboard) → hard off.
//      Emergency lever that works even when Supabase is unreachable.
//   2. platform_config (key 'musa', value.musa_tick_enabled=false) →
//      the switch saved from Configuración → Plataforma (migración v27).
//   3. Demand check: if NO workspace has auto_process_enabled=true,
//      there is nothing for the batch to do → skip the dispatch.
// All Supabase checks fail-open (DB hiccup → old v2.2 behavior: dispatch).
//
// Why hourly: if a batch run fails on an outage that outlasts
// musa-batch's native retries (1 min → 2 min), the next tick retries
// on its own — full self-healing without human intervention. With the
// demand check, an idle platform self-heals into skipping instead.
// ═══════════════════════════════════════════════════════════════

const SITE_URL = (process.env.URL || process.env.DEPLOY_URL || "https://design.futuraria.com").replace(/\/$/, "");

const skipped = (reason) => {
  console.log(`[musa-batch-tick] skipped: ${reason}`);
  return { statusCode: 200, body: JSON.stringify({ ok: true, dispatched: false, skipped: reason }) };
};

export const handler = async () => {
  // Kill switch 1 — env var (dashboard-level emergency off, wins over all)
  if (process.env.MUSA_TICK_ENABLED === "false") return skipped("MUSA_TICK_ENABLED=false (env)");

  // Kill switch 2 (platform switch) + 3 (demand check) — fail-open
  try {
    const { getSupabaseAdmin } = await import("../../api/src/services/supabase.js");
    const sb = getSupabaseAdmin();
    if (sb) {
      // Pre-v27 DBs have no platform_config table → query errors → treat as
      // "not disabled" and fall through to the demand check.
      const { data: musa } = await sb.from("platform_config").select("value").eq("key", "musa").maybeSingle();
      if (musa?.value?.musa_tick_enabled === false) {
        return skipped("platform_config musa.musa_tick_enabled=false (Configuración → Plataforma)");
      }

      const { count, error } = await sb.from("workspace_config")
        .select("workspace_id", { count: "exact", head: true })
        .eq("auto_process_enabled", true);
      if (!error && (count || 0) === 0) {
        return skipped("no workspace has auto_process_enabled=true — nothing to process");
      }
    }
  } catch (e) {
    console.warn(`[musa-batch-tick] pre-checks failed (fail-open → dispatch): ${e?.message || e}`);
  }

  const url = SITE_URL + "/.netlify/functions/musa-batch-background";
  const headers = {};
  if (process.env.MUSA_BATCH_SECRET) headers["x-batch-secret"] = process.env.MUSA_BATCH_SECRET;

  try {
    // Background function: 202 = invocation accepted, the pipeline runs
    // in background. Await only the DISPATCH, never the pipeline.
    const res = await fetch(url, { method: "POST", headers, signal: AbortSignal.timeout(15000) });
    // Drain the (empty) body so the socket is released.
    try { await res.arrayBuffer(); } catch { /* ignore */ }

    if (res.status !== 202) {
      const msg = `[musa-batch-tick] dispatch FAILED: HTTP ${res.status} — is musa-batch-background deployed (the -background filename suffix is what opts a function into background mode)? Is MUSA_BATCH_SECRET set identically on both?`;
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
