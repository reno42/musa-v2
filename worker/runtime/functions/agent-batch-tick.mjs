/**
 * REQ-080 F1 — Tick diario del Musa Batch (agente productor).
 *
 * El pipeline (musa-batch-background: leader/implementer/reviewer por card,
 * LLM, piezas en borrador) ya existía — este módulo SOLO lo despierta una vez
 * al día desde el cron cada 5 min del worker. Antes el tick horario era una
 * scheduled function de Netlify que no migró a CF.
 *
 * Diseño:
 *  · Puerta diaria en platform_config (key 'agent_batch_last_day'): corre
 *    UNA vez por día UTC (06:00-06:05 Lima). El resto de los 287 ticks del
 *    día: 1 query y return.
 *  · Opt-in real: runDailyBatch ya solo procesa workspaces con
 *    auto_process_enabled=true — sin esa config el workspace NUNCA es
 *    tocado. Kill switch global AGENT_BATCH_ENABLED=false además.
 *  · Dispara por fetch interno al propio endpoint background (con
 *    x-batch-secret si MUSA_BATCH_SECRET está seteado), igual que hacía el
 *    tick de Netlify: el pipeline corre en su propio contexto (202 + bg).
 *  · Fail-open total: cualquier error se loguea y no tumbla el cron.
 */

const LAST_DAY_KEY = "agent_batch_last_day";

/** Hora objetivo: 11:00 UTC = 06:00 America/Lima. */
function inDailyWindow(now = new Date()) {
  return now.getUTCHours() === 11 && now.getUTCMinutes() < 5;
}

export async function tickAgentBatch(now = new Date()) {
  const out = { ran: false, reason: "" };
  try {
    if (String(process.env.AGENT_BATCH_ENABLED || "") === "false") {
      out.reason = "AGENT_BATCH_ENABLED=false";
      return out;
    }
    if (!inDailyWindow(now)) {
      out.reason = "fuera de ventana (11:00-11:04 UTC)";
      return out;
    }
    const { getSupabaseAdmin } = await import("../../../api/src/services/supabase.js");
    const sb = getSupabaseAdmin();
    if (!sb) {
      out.reason = "sin supabase";
      return out;
    }
    // Puerta diaria: upsert con guard de fecha (solo el primer tick del día gana).
    const today = now.toISOString().slice(0, 10);
    const { data: row, error } = await sb
      .from("platform_config")
      .select("value")
      .eq("key", LAST_DAY_KEY)
      .maybeSingle();
    if (error) {
      out.reason = `platform_config: ${error.message}`;
      return out;
    }
    if (row?.value?.day === today) {
      out.reason = `ya corrió hoy (${today})`;
      return out;
    }
    const { error: upErr } = await sb
      .from("platform_config")
      .upsert({ key: LAST_DAY_KEY, value: { day: today, at: now.toISOString() } }, { onConflict: "key" });
    if (upErr) {
      out.reason = `upsert: ${upErr.message}`;
      return out;
    }
    // Disparo: POST interno al endpoint background (202 inmediato, pipeline en bg).
    const origin = process.env.MUSA_SELF_ORIGIN || "https://musaworks.com";
    const headers = { "Content-Type": "application/json" };
    if (process.env.MUSA_BATCH_SECRET) headers["x-batch-secret"] = process.env.MUSA_BATCH_SECRET;
    const res = await fetch(`${origin}/api/musa-batch-background`, { method: "POST", headers, body: "{}" }).catch((e) => {
      throw new Error(`fetch interno: ${e?.message || e}`);
    });
    out.ran = res.status === 202 || res.ok;
    out.status = res.status;
    if (!out.ran) out.reason = `dispatch respondió ${res.status}`;
  } catch (e) {
    out.reason = `error: ${String(e?.message || e).slice(0, 160)}`;
  }
  return out;
}
