/**
 * REQ-082 — Sweep server-side del inbox: cada 15 min trae mensajes nuevos
 * de TODOS los workspaces con cuentas conectadas. Mínimo costo: 1 query
 * (publisher_accounts) por tick; solo los con cuentas generan llamadas Graph.
 * Kill switch INBOX_SWEEP_ENABLED=false. Puerta cada-15-min en memoria del
 * isolate (los ticks del cron van cada 5; barre cuando min % 15 == 0 y no
 * barrió en ese slot — idempotencia por slot en platform_config).
 */

const SLOT_KEY = "inbox_sweep_last_slot";

function slotId(now = new Date()) {
  return `${now.toISOString().slice(0, 13)}:${Math.floor(now.getUTCMinutes() / 15)}`;
}

export async function tickInboxSweep(now = new Date()) {
  const out = { ran: false, reason: "" };
  try {
    if (String(process.env.INBOX_SWEEP_ENABLED || "") === "false") {
      out.reason = "INBOX_SWEEP_ENABLED=false";
      return out;
    }
    if (now.getUTCMinutes() % 15 !== 0) {
      out.reason = "no es slot de 15";
      return out;
    }
    const { getSupabaseAdmin } = await import("../../../api/src/services/supabase.js");
    const sb = getSupabaseAdmin();
    if (!sb) {
      out.reason = "sin supabase";
      return out;
    }
    const slot = slotId(now);
    const { data: row } = await sb.from("platform_config").select("value").eq("key", SLOT_KEY).maybeSingle();
    if (row?.value?.slot === slot) {
      out.reason = `sweep ${slot} ya hecho`;
      return out;
    }
    await sb.from("platform_config").upsert({ key: SLOT_KEY, value: { slot, at: now.toISOString() } }, { onConflict: "key" });
    // workspaces con cuentas conectadas (solo esos)
    const { data: accts } = await sb.from("publisher_accounts")
      .select("workspace_id").eq("status", "connected").limit(200);
    const wsIds = [...new Set((accts || []).map((a) => a.workspace_id))];
    const { sweepInbox } = await import("./inbox-core.mjs");
    const results = [];
    for (const ws of wsIds) {
      try {
        const r = await sweepInbox(sb, ws);
        results.push({ ws, convs: r.conversations, errors: r.errors.length });
      } catch (e) {
        results.push({ ws, error: String(e?.message || e).slice(0, 80) });
      }
    }
    out.ran = true;
    out.workspaces = wsIds.length;
    out.results = results;
  } catch (e) {
    out.reason = `error: ${String(e?.message || e).slice(0, 140)}`;
  }
  return out;
}
