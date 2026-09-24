// ghostBridge — FASE 2 (Parte 6): puente pestaña ↔ MCP para ghost_perform.
//
// El MCP no puede sostener una coreografía de minutos en una función
// síncrona (Decisión A del plan aprobado), así que cuando llega
// ghost_perform con pestaña abierta: inserta un job en ghost_jobs y esta
// capa en la pestaña lo ejecuta con el MISMO loop agéntico (ghostAgent),
// el MISMO teatro (ghostCursor) y el MISMO cerebro (ghostBrain):
//
//   1. Heartbeat en ghost_presence (mount + cada 15s) — es lo que el MCP
//      lee para saber si hay "cuerpo en escena" (<30s = pestaña abierta).
//   2. Suscripción postgres_changes a ghost_jobs del usuario + polling de
//      reserva en cada tick (Realtime puede perder eventos; el poll no).
//   3. Runner: reclama el job (queued→running con guard de carrera), corre
//      runGhostAgent con la MISMA config LLM del chat (rol leader, key del
//      server) y escribe done/aborted/failed + resultado en la fila.
//   4. Avisa al chat con un evento `futuraria:ghost-job` — ChatFAB lo
//      escucha y lo cuenta como burbuja. El chat es LA interfaz (Parte 0).
//
// Se monta UNA vez global en App.tsx (sirve en dashboard y editor).

import { browserSupabase } from "./supabaseClient";
import { fetchDecryptedKey } from "./chatHistory";
import { getApiHeaders } from "./apiKey";
import { CHAT_PROVIDERS } from "./aiProviders";
import { ghost, type GhostMode } from "./ghostCursor";
import { runGhostAgent, type GhostAgentResult } from "./ghostAgent";
import { beginCreation, endCreation } from "./creationActivity";
import { GHOST_BRAIN_MAX_TOKENS } from "./agentRuntime";

const HEARTBEAT_MS = 15000;
const JOB_EVENT = "futuraria:ghost-job";

/** El bridge vive UNA vez por pestaña, igual que el fantasma. */
let started = false;
let starting = false;

interface GhostJobRow {
  id: string;
  user_id: string;
  workspace_id: string | null;
  task: string;
  mode: GhostMode;
  status: "queued" | "running" | "done" | "aborted" | "failed";
}

/** Anuncia el ciclo del job al resto de la app (ChatFAB → burbuja). */
function emitJob(detail: { jobId: string; status: string; task?: string; note?: string; steps?: number }): void {
  try { window.dispatchEvent(new CustomEvent(JOB_EVENT, { detail })); } catch { /* noop */ }
}

/**
 * MISMA resolución de LLM que el chat: rol leader de `futuraria-chat-role-config`
 * + key desencriptada del server (fetchDecryptedKey — nunca localStorage).
 * Devuelve null si no hay key: el job falla honesto, no a ciegas.
 */
async function resolveGhostLlm(): Promise<((system: string, user: string) => Promise<string>) | null> {
  let provider = "deepseek";
  let model = "";
  try {
    const raw = localStorage.getItem("futuraria-chat-role-config");
    if (raw) {
      const parsed = JSON.parse(raw);
      provider = String(parsed?.leader?.provider || provider);
      model = String(parsed?.leader?.model || "");
    }
  } catch { /* default deepseek */ }
  const prov = CHAT_PROVIDERS.find(p => p.id === provider) || CHAT_PROVIDERS[0];
  const key = await fetchDecryptedKey(prov.id).catch(() => null);
  if (!key) return null;
  const isAnthropic = prov.id === "anthropic";
  return async (system, user) => {
    const usedModel = model || prov.defaultModel;
    // GLM-5.3 piensa por defecto: el brain decide mecánico → thinking off.
    // El bridge SOLO sirve decisiones del brain (runGhostAgent) → presupuesto
    // de decisión (512), no de generación.
    const body = isAnthropic
      ? { model: usedModel, max_tokens: GHOST_BRAIN_MAX_TOKENS, system, messages: [{ role: "user", content: user }] }
      : { model: usedModel, max_tokens: GHOST_BRAIN_MAX_TOKENS, messages: [{ role: "system", content: system }, { role: "user", content: user }], ...(prov.id === "zhipu" ? { thinking: { type: "disabled" } } : {}) };
    // Proxy same-origin /api/llm: mismo camino que el chat — z.ai y otros
    // bloquean fetch directo del browser, y la key descifrada queda server-side.
    const resp = await fetch("/api/llm", {
      method: "POST",
      headers: getApiHeaders(),
      body: JSON.stringify({ provider: prov.id, body }),
    });
    if (!resp.ok) throw new Error(`LLM ${resp.status}: ${(await resp.text()).slice(0, 140)}`);
    const data = await resp.json();
    return isAnthropic
      ? (data?.content || []).map((b: any) => b?.text || "").join("")
      : (data?.choices?.[0]?.message?.content || "");
  };
}

/** Ejecuta un job reclamado y escribe el desenlace en ghost_jobs. */
async function runGhostJob(job: GhostJobRow): Promise<void> {
  const sb = browserSupabase;
  if (!sb) return;
  const finish = async (status: "done" | "aborted" | "failed", r: GhostAgentResult | null, error?: string) => {
    await sb.from("ghost_jobs").update({
      status,
      result: r
        ? { delivery: "tab", note: r.note, steps: r.steps, sessionId: r.sessionId, lastObservation: r.lastObservation }
        : { delivery: "tab", error: error || "fallo desconocido" },
      updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    emitJob({ jobId: job.id, status, task: job.task, note: r?.note || error, steps: r?.steps });
  };
  emitJob({ jobId: job.id, status: "running", task: job.task });
  beginCreation(); // gate de salida: la pestaña no muere con el job en vuelo
  const llm = await resolveGhostLlm();
  if (!llm) {
    await finish("failed", null, "Sin key de LLM para el rol leader — abre el chat y guarda una key para que el ghost pueda decidir.");
    return;
  }
  // El modo del job manda SOLO durante su ejecución; el switch del dock
  // queda como estaba (es una preferencia del usuario, no del job).
  const prevMode = ghost.getMode();
  if (job.mode === "full" || job.mode === "teacher") ghost.setMode(job.mode);
  try {
    const r = await runGhostAgent({ task: job.task, llm });
    if (r.status === "done") await finish("done", r);
    else if (r.status === "aborted") await finish("aborted", r);
    else if (r.status === "budget") await finish("failed", r);
    else await finish("failed", r);
  } catch (e: any) {
    await finish("failed", null, String(e?.message || e).slice(0, 200));
  } finally {
    endCreation(); // gate liberado en done/aborted/failed/throw
    ghost.setMode(prevMode);
  }
}

/** Reclama jobs en cola con guard de carrera (queued→running condicional). */
async function claimQueuedJobs(userId: string): Promise<void> {
  const sb = browserSupabase;
  if (!sb) return;
  const { data: jobs } = await sb.from("ghost_jobs")
    .select("id, user_id, workspace_id, task, mode, status")
    .eq("user_id", userId).eq("status", "queued")
    .order("created_at", { ascending: true }).limit(3);
  for (const job of (jobs || []) as GhostJobRow[]) {
    // El update condicional ES el lock: si otra pestaña lo reclamó antes,
    // el where no matchea y aquí no se ejecuta dos veces.
    const { data: claimed } = await sb.from("ghost_jobs")
      .update({ status: "running", updated_at: new Date().toISOString() })
      .eq("id", job.id).eq("status", "queued")
      .select("id").maybeSingle();
    if (claimed) await runGhostJob(job);
  }
}

/**
 * Arranca el bridge (idempotente). Sin Supabase o sin sesión es un noop:
 * el ghost_perform del MCP responderá "sin pestaña" y degradará a headless.
 */
export function startGhostBridge(): void {
  if (started || starting || typeof window === "undefined") return;
  const sb = browserSupabase;
  if (!sb) return;
  starting = true;
  void (async () => {
    const { data: sessionData } = await sb.auth.getSession();
    const user = sessionData?.session?.user;
    if (!user?.id) { starting = false; return; } // sin sesión: se reintenta en SIGNED_IN
    started = true;
    starting = false;
    const userId = user.id;
    const heartbeat = async () => {
      try {
        await sb.from("ghost_presence").upsert({
          user_id: userId,
          page: `${window.location.pathname}${window.location.search}`.slice(0, 300),
          updated_at: new Date().toISOString(),
        });
      } catch { /* offline: el MCP verá presencia vencida y degrada solo */ }
    };
    void heartbeat();
    void claimQueuedJobs(userId); // catch-up: jobs encolados con la pestaña cerrada
    const poll = window.setInterval(() => {
      void heartbeat();
      void claimQueuedJobs(userId);
    }, HEARTBEAT_MS);
    // Realtime entrega el job al instante; el poll de arriba es red de seguridad.
    const channel = sb
      .channel(`ghost-jobs:${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "ghost_jobs", filter: `user_id=eq.${userId}` }, (payload: any) => {
        const row = payload?.new as GhostJobRow | undefined;
        if (row?.id && row.status === "queued") void claimQueuedJobs(userId);
      })
      .subscribe();
    // Al cerrar la pestaña el heartbeat deja de refrescarse: en <30s el MCP
    // ya ve "sin pestaña". Limpieza explícita por educación (HMR, SPA nav).
    window.addEventListener("pagehide", () => {
      window.clearInterval(poll);
      try { sb.removeChannel(channel); } catch { /* noop */ }
    });
  })();
}
