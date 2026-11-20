/**
 * REQ-076 — Flows residentes: sweep server-side de slots vencidos.
 *
 * Ejecuta flows con trigger {type:"schedule", serverResident:true} cuyo cron
 * venció en este slot (5 min). Idempotente: el requestId `cron:<flowId>:<slot>`
 * hace que un segundo intento devuelva el MISMO run (flows-runtime dedupe).
 *
 * Seguridad / costo:
 *  · Kill switch: FLOWS_RESIDENT_ENABLED=false apaga TODO el sweep (default ON
 *    pero cada flow es opt-in con serverResident:true).
 *  · Presupuesto duro por tick: RESIDENT_MAX_RUNS (default 5 runs/tick) — el
 *    resto queda para el próximo tick (el slot no se pierde: flowCronDue
 *    escanea lookback y el requestId dedupe evita dobles).
 *  · Demand check: cero flows residentes con schedule → 1 query y return.
 *  · Cada run aísla sus errores: un flow que explota no toca a los demás.
 *  · CPU: executeFlow hereda el deadline del runtime (LIMITS.runTimeoutMs);
 *    con pocas runs por tick quedamos lejos del límite de CPU del free plan.
 */

import { getSupabaseAdmin } from "../../../api/src/services/supabase.js";
import { createFlowsStore, flowCronDue } from "./flows-core.mjs";

const TABLE = "flows";
/** Runs máximos por tick (presupuesto CPU del plan free). */
const MAX_RUNS = Number(process.env.RESIDENT_MAX_RUNS || 5);

/**
 * Crea el runtime de flows igual que el MCP (mismo bridge de tools).
 * Import perezoso para no cargar mcp.mjs si el sweep está apagado.
 */
async function makeRuntime() {
  const mod = await import("./mcp.mjs");
  return mod.createFlowRuntimeForCron();
}

export async function sweepResidentFlows(now = new Date()) {
  const out = { scanned: 0, runs: 0, skipped_budget: 0, errors: [] };
  if (String(process.env.FLOWS_RESIDENT_ENABLED || "") === "false") {
    out.skipped = "FLOWS_RESIDENT_ENABLED=false";
    return out;
  }
  const sb = getSupabaseAdmin();
  if (!sb) {
    out.skipped = "sin supabase";
    return out;
  }
  // Demand check: solo flows habilitados con schedule + serverResident.
  let rows;
  try {
    const { data, error } = await sb
      .from(TABLE)
      .select("id, workspace_id, trigger, updated_at")
      .eq("enabled", true)
      .contains("trigger", { type: "schedule", serverResident: true })
      .limit(100);
    if (error) throw new Error(error.message);
    rows = data || [];
  } catch (e) {
    // contains() sobre JSON puede no indexar en PG viejos: fallback en JS.
    try {
      const { data, error } = await sb.from(TABLE).select("id, workspace_id, trigger, updated_at").eq("enabled", true).limit(500);
      if (error) throw new Error(error.message);
      rows = (data || []).filter((r) => r.trigger && r.trigger.type === "schedule" && r.trigger.serverResident === true);
    } catch (e2) {
      out.errors.push(`select: ${e2?.message || e2}`);
      return out;
    }
  }
  out.scanned = rows.length;
  if (!rows.length) return out;

  const store = createFlowsStore(sb);
  const runtime = await makeRuntime();

  for (const row of rows) {
    if (out.runs >= MAX_RUNS) {
      out.skipped_budget = (out.skipped_budget || 0) + rows.length - rows.indexOf(row);
      break;
    }
    try {
      const flow = await store.getFlow(row.id, row.workspace_id);
      if (!flow || !flow.enabled) continue;
      const trigger = flow.trigger && typeof flow.trigger === "object" ? flow.trigger : {};
      if (trigger.type !== "schedule" || trigger.serverResident !== true) continue;
      const last = await store.latestRun(flow.id);
      const verdict = flowCronDue(trigger, { lastRunAt: last?.started_at ?? null, anchorAt: flow.updated_at ?? null, now });
      if (!verdict.due || !verdict.slot) continue;
      const requestId = `cron:${flow.id}:${verdict.slot}`;
      const result = await runtime.runFlow(flow, { input: {}, requestId, waitUntil: null });
      out.runs += 1;
      const st = result?.status || "?";
      if (st !== "succeeded") out.errors.push(`${flow.id}: ${st}${result?.error ? ` ${String(result.error).slice(0, 160)}` : ""}`);
    } catch (e) {
      out.errors.push(`${row.id}: ${String(e?.message || e).slice(0, 160)}`);
    }
  }
  return out;
}
