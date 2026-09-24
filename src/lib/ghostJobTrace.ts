// ghostJobTrace — REQ-025.1 Item 3: telemetría mínima del job del ghost.
//
// Cada job deja en ghost_jobs.result (jsonb — SIN migración de tablas) un
// trace legible: el próximo fallo se diagnostica con 1 query, no adivinando.
//
//   result.trace = [
//     { t, ev: "accepted",       provider, model, keySource, last4 }   ← MCP (insert)
//     { t, ev: "claimed",        provider, model, keySource, last4 }   ← bridge (claim)
//     { t, ev: "llm_first_call", provider, model }                        ← bridge (1er LLM ok)
//     { t, ev: "done"|"failed",  phase, reasonCode, note }                ← bridge (desenlace)
//   ]
//
// Módulo PURO y sin imports (mismo criterio que ghostPreflight.ts): el MCP
// (mjs) y el bridge (ts) comparten shape sin duplicar lógica.

export type GhostTraceEventName = "accepted" | "claimed" | "llm_first_call" | "done" | "aborted" | "failed";

export interface GhostTraceEvent {
  /** ISO timestamp del evento. */
  t: string;
  ev: GhostTraceEventName;
  /** Etapa del ciclo donde pasó: "preflight" | "llm" | "agent" | "unknown". */
  phase?: string;
  reasonCode?: string;
  provider?: string;
  model?: string;
  keySource?: string;
  last4?: string | null;
  note?: string;
}

/** Evento nuevo con timestamp — ignora campos undefined/null vacíos. */
export function ghostTraceEvent(ev: GhostTraceEventName, fields: Omit<Partial<GhostTraceEvent>, "t" | "ev"> = {}): GhostTraceEvent {
  const base: GhostTraceEvent = { t: new Date().toISOString(), ev };
  const rest = Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined && v !== null && v !== ""),
  );
  return { ...base, ...rest };
}

/**
 * Mergea eventos + campos extra sobre un result existente SIN pisar lo que
 * ya había (el "accepted" que escribió el MCP sobrevive a los updates del
 * bridge). Si el result previo no es un objeto, arranca limpio.
 */
export function appendTrace(
  baseResult: unknown,
  extraFields: Record<string, unknown>,
  events: GhostTraceEvent[],
): Record<string, unknown> {
  const base = baseResult && typeof baseResult === "object" && !Array.isArray(baseResult)
    ? baseResult as Record<string, unknown>
    : {};
  const prevTrace = Array.isArray(base.trace) ? base.trace : [];
  return { ...base, ...extraFields, trace: [...prevTrace, ...events] };
}
