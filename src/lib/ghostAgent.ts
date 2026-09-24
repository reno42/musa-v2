// ghostAgent — FASE 2: EL loop agéntico del ghost, UI-free (REPORTE_MIRA_
// fase2_ghost.md Parte 2). Vivo aquí para que DOS capas de presentación lo
// usen sin duplicar lógica:
//
//   · ChatFAB ("muéstrame cómo…") → mapea el resultado a burbujas del chat.
//   · ghostBridge (jobs de ghost_perform vía MCP) → escribe el resultado
//     en ghost_jobs + evento para el chat.
//
// La Capa LLM se INYECTA (mismo contrato GhostLlm del brain): cada caller
// resuelve proveedor/modelo/key como le corresponda. El teatro (ghost) y el
// decisor (decideStep) son los mismos singletons siempre — un solo fantasma,
// un solo cerebro. Los pasos se loguean a chatfab_decisions con session_id
// ghost_* (fire-and-forget: un log roto no puede romper la coreografía).

import { mcpCall } from "./mcpClient";
import { ghost, GhostAbortedError } from "./ghostCursor";
import { observeUI, uiToText } from "./uiObserver";
import { decideStep, GHOST_MAX_STEPS, type GhostLlm } from "./ghostBrain";

export interface GhostAgentResult {
  /** done = tarea cumplida; budget = 25 pasos sin terminar; aborted; error. */
  status: "done" | "budget" | "aborted" | "error";
  /** Nota honesta del resultado (nota del brain, motivo del abort o error). */
  note: string;
  /** Pasos ejecutados (incluyen los que fallaron). */
  steps: number;
  /** Historial "paso N: … — ✓/falló" para evidencia. */
  history: string[];
  /** Última observación de UI (evidencia para el reporte de budget). */
  lastObservation: string;
  /** session_id usado en chatfab_decisions (ghost_<ts>). */
  sessionId: string;
  durationMs: number;
}

export interface GhostAgentHooks {
  /** Después de cada paso ejecutado con éxito (para UI viva si existe). */
  onProgress?: (stepNo: number, describe: string, thought: string) => void;
}

/** Telemetría de pasos — misma tabla que el gate, session propia del ghost. */
function ghostLog(sessionId: string, message: string, toolUsed?: string, latencyMs?: number): void {
  void mcpCall("chatfab_log_decision", {
    session_id: sessionId,
    message,
    tool_used: toolUsed || null,
    router_verdict: "llm",
    resolved_by: "llm",
    latency_ms: latencyMs ?? null,
  }).catch(() => {});
}

/**
 * Corre la coreografía: observar → decidir → actuar con teatro → log →
 * repetir. Cap duro GHOST_MAX_STEPS. NUNCA lanza por fallos de la tarea:
 * todo termina en un GhostAgentResult honesto (done/budget/aborted/error).
 */
export async function runGhostAgent(opts: {
  task: string;
  llm: GhostLlm;
  signal?: AbortSignal;
  hooks?: GhostAgentHooks;
}): Promise<GhostAgentResult> {
  const { task, llm, signal, hooks } = opts;
  const sessionId = `ghost_${Date.now()}`;
  const t0 = Date.now();
  const history: string[] = [];
  let aborted = false;
  let abortUnsub: (() => void) | null = null;
  const result = (status: GhostAgentResult["status"], note: string): GhostAgentResult => ({
    status, note, steps: history.length, history,
    lastObservation: uiToText(observeUI()).slice(0, 400),
    sessionId, durationMs: Date.now() - t0,
  });
  ghost.start();
  abortUnsub = ghost.onAbort(() => { aborted = true; });
  try {
    for (let i = 0; i < GHOST_MAX_STEPS; i++) {
      if (signal?.aborted) throw new GhostAbortedError();
      ghost.assertLive();
      const decision = await decideStep(llm, { task, uiText: uiToText(observeUI()), history });
      const d = decision.step;
      if (d.action === "done") {
        const note = d.note || task;
        ghostLog(sessionId, `[ghost done tras ${i} pasos] ${d.note || ""}`, undefined, Date.now() - t0);
        return result("done", note);
      }
      const stepNo = i + 1;
      let describe = "";
      try {
        if (d.action === "click") {
          const el = document.querySelector<HTMLElement>(d.selector);
          if (!el) throw new Error(`elemento no encontrado: ${d.selector}`);
          describe = `click ${d.selector}`;
          await ghost.click(el);
        } else if (d.action === "type") {
          const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(d.selector);
          if (!el) throw new Error(`input no encontrado: ${d.selector}`);
          describe = `type "${d.text.slice(0, 40)}" en ${d.selector}`;
          await ghost.type(el, d.text);
        } else {
          describe = `scroll ${d.direction || "down"}`;
          await ghost.scroll(null, d.direction || "down");
        }
        history.push(`paso ${stepNo}: ${describe} — ✓`);
        hooks?.onProgress?.(stepNo, describe, decision.thought);
        ghostLog(sessionId, `[ghost paso ${stepNo}/${GHOST_MAX_STEPS}] ${describe} (${decision.thought})`, `ghost_${d.action}`);
      } catch (e: any) {
        if (e instanceof GhostAbortedError || aborted) throw e;
        history.push(`paso ${stepNo}: ${d.action} falló — ${String(e?.message || e).slice(0, 120)}`);
        ghostLog(sessionId, `[ghost paso ${stepNo} falló] ${String(e?.message || e).slice(0, 200)}`, `ghost_${d.action}`);
      }
    }
    // Presupuesto agotado (Parte 2/5): honesto, sin loop infinito.
    const r = result("budget", `Llegué al límite de ${GHOST_MAX_STEPS} pasos sin terminar "${task}".`);
    ghostLog(sessionId, "[ghost] límite de pasos alcanzado", undefined, Date.now() - t0);
    return r;
  } catch (e: any) {
    if (e instanceof GhostAbortedError || aborted) {
      ghostLog(sessionId, "[ghost] abortado por el usuario", undefined, Date.now() - t0);
      return result("aborted", "La coreografía se canceló por el usuario.");
    }
    const msg = String(e?.message || e).slice(0, 200);
    ghostLog(sessionId, `[ghost error] ${msg}`, undefined, Date.now() - t0);
    return result("error", msg);
  } finally {
    if (abortUnsub) abortUnsub();
    ghost.done();
  }
}
