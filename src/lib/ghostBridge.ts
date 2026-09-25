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
import { fetchDecryptedKey, fetchProviderKeys } from "./chatHistory";
import { getApiHeaders } from "./apiKey";
import { CHAT_PROVIDERS, defaultModelFor } from "./aiProviders";
import { fetchUserPrefs } from "./userPrefs";
import { ghost, type GhostMode } from "./ghostCursor";
import { runGhostAgent, type GhostAgentResult } from "./ghostAgent";
import { beginCreation, endCreation } from "./creationActivity";
import { GHOST_BRAIN_MAX_TOKENS } from "./agentRuntime";
import { preflightViaProxy, rotationHint, classifyPreflightFailure } from "./ghostPreflight";
import { appendTrace, ghostTraceEvent, type GhostTraceEvent } from "./ghostJobTrace";

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
  /** jsonb del job — acá vive el trace (REQ-025.1 Item 3). */
  result?: Record<string, unknown> | null;
}

/** Anuncia el ciclo del job al resto de la app (ChatFAB → burbuja). */
function emitJob(detail: { jobId: string; status: string; task?: string; note?: string; steps?: number }): void {
  try { window.dispatchEvent(new CustomEvent(JOB_EVENT, { detail })); } catch { /* noop */ }
}

/** Config LLM resuelta para un job — metadata honesta para el trace (Item 3). */
export interface GhostLlmInfo {
  provider: string;
  /** Modelo FINAL que se usará (ya saneado contra el lineup del provider). */
  model: string;
  /** Modelo que ESTABA configurado, cuando el saneamiento lo corrigió. */
  requestedModel: string | null;
  /** De dónde salió la key. BYOK: desencriptada del server. Platform: env del server. */
  keySource: "server" | "platform";
  /** Últimos 4 de la key (GET /api/keys — nunca la key ni el plaintext). */
  last4: string | null;
  /** REQ-028: capa que sirvió la IA — "platform" (freemium) o "byok" (la del usuario). */
  tier: "platform" | "byok";
}

interface GhostLlmResolution {
  llm: (system: string, user: string) => Promise<string>;
  info: GhostLlmInfo;
}

/** REQ-028 Item 4.2 — label honesto del badge según la capa que sirve la IA:
 *  "IA de Musa · quedan N" (freemium) o "Tu IA (provider)" (BYOK). El N lo
 *  reporta X-Musa-Quota-Remaining; antes de la 1ª respuesta queda en genérico. */
function badgeLabel(tier: GhostLlmInfo["tier"], provider: string, remaining: number | null): string {
  const base = tier === "platform"
    ? (remaining == null ? "IA de Musa (cuota gratis)" : `IA de Musa · quedan ${remaining}`)
    : `Tu IA (${CHAT_PROVIDERS.find(p => p.id === provider)?.label || provider})`;
  return `${base} — no toques nada`;
}

// ── Fuente de verdad de los roles (REQ-025.1 Item 1) ───────────────────────
// ORDEN DE PRECEDENCIA (uno solo, en este orden):
//   1. Server prefs (user_profiles.prefs.chatRoles, vía GET /api/account/me —
//      la MISMA fuente que escribe la tarjeta de roles del Dashboard y que
//      hidrata ChatFAB). Cache de 60s: el bridge reclama jobs cada 15s y
//      pegarle al server en cada tick no aporta nada.
//   2. localStorage("futuraria-chat-role-config") — fallback OPTIMISTA mientras
//      carga el server, offline o invitado. Nunca pisa al server: solo entra
//      si el server no respondió.
//   3. Defaults (deepseek + primer modelo real del lineup).
// Antes solo existía (2) y por eso el Ghost ignoraba lo guardado en el
// Dashboard — el falso "roté la key y sigue fallando".
const ROLES_CACHE_MS = 60000;
let prefsCache: { at: number; prefs: Record<string, unknown> } | null = null;

/** Prefs de cuenta (cache 60s). Falla → objeto vacío; nunca cachea el fallo. */
async function loadAccountPrefs(): Promise<Record<string, unknown>> {
  if (prefsCache && Date.now() - prefsCache.at < ROLES_CACHE_MS) return prefsCache.prefs;
  const prefs = await fetchUserPrefs();
  prefsCache = { at: Date.now(), prefs };
  return prefs;
}

async function loadChatRoles(): Promise<Record<string, unknown>> {
  const prefs = await loadAccountPrefs().catch(() => ({}) as Record<string, unknown>);
  const chatRoles = prefs.chatRoles && typeof prefs.chatRoles === "object" ? prefs.chatRoles : {};
  return chatRoles as Record<string, unknown>;
}

function readLocalRoles(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem("futuraria-chat-role-config");
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch { return {}; }
}

/** last4 del provider desde GET /api/keys (solo metadatos, nunca la key). */
async function last4For(providerId: string): Promise<string | null> {
  const keys = await fetchProviderKeys().catch(() => []);
  return keys.find(k => k.provider === providerId)?.last4 || null;
}

/**
 * Rol leader resuelto con la MISMA precedencia para preflight y ejecución:
 * server prefs → localStorage → defaults, con saneamiento contra el lineup.
 * `requestedModel` trae el modelo configurado cuando el saneamiento lo corrigió.
 */
function pickLeaderRole(chatRoles: Record<string, unknown>): {
  provider: string; model: string; requestedModel: string | null;
} {
  const local = readLocalRoles();
  const leader = (chatRoles.leader || local.leader || {}) as { provider?: unknown; model?: unknown };
  const provider = String(leader.provider || "deepseek");
  const prov = CHAT_PROVIDERS.find(p => p.id === provider) || CHAT_PROVIDERS[0];
  const configuredModel = String(leader.model || "");
  return {
    provider: prov.id,
    model: prov.models.includes(configuredModel) ? configuredModel : defaultModelFor(prov.id),
    requestedModel: prov.models.includes(configuredModel) ? null : (configuredModel || null),
  };
}

/**
 * Preflight BYOK (REQ-025.1 Item 2): validar la key del rol leader con un
 * ping mínimo (max_tokens 1 vía /api/llm — el MISMO camino que las llamadas
 * reales, así el ping valida exactamente la key+modelo que usará el job)
 * ANTES de reclamar el job. Devuelve null si el flag lo apaga: nunca bloquea
 * por una falla propia del preflight.
 *
 * Flag ghost_preflight_v1: prefs.ghost_preflight_v1 === false lo apaga por
 * usuario SIN redeploy (mismo PATCH de prefs que la tarjeta de roles) y
 * localStorage "futuraria-flag-ghost-preflight-v1" = "off" es el kill switch
 * de emergencia de esta pestaña. Default: activado.
 */
const PREFLIGHT_FLAG_LS = "futuraria-flag-ghost-preflight-v1";

function ghostPreflightEnabled(prefs: Record<string, unknown>): boolean {
  try {
    if (localStorage.getItem(PREFLIGHT_FLAG_LS) === "off") return false;
  } catch { /* private mode: el pref manda */ }
  return prefs.ghost_preflight_v1 !== false;
}

type PreflightOutcome =
  | { ok: true }
  | { ok: false; reasonCode: string; note: string; provider: string; model: string; keySource: string; last4: string | null };

async function preflightLeaderLlm(): Promise<PreflightOutcome | null> {
  const prefs = await loadAccountPrefs().catch(() => ({} as Record<string, unknown>));
  if (!ghostPreflightEnabled(prefs)) return null;
  const role = pickLeaderRole(
    prefs.chatRoles && typeof prefs.chatRoles === "object" ? (prefs.chatRoles as Record<string, unknown>) : {},
  );
  const prov = CHAT_PROVIDERS.find(p => p.id === role.provider);
  const last4 = await last4For(role.provider).catch(() => null);
  const result = await preflightViaProxy({ provider: role.provider, model: role.model, last4, headers: getApiHeaders() });
  if (result.ok) return { ok: true };
  return {
    ok: false,
    reasonCode: result.reasonCode,
    provider: result.provider,
    model: result.model,
    keySource: result.keySource,
    last4: result.last4,
    note: `Preflight BYOK falló (${result.reasonCode}) con ${result.provider}/${result.model}. Rotá la key o cambiá el provider del rol leader en ${rotationHint(result.provider, prov?.label)}. No se ejecutó nada.`,
  };
}

/**
 * MISMA resolución de LLM que el chat: rol leader (server prefs → localStorage
 * → defaults, ver precedencia arriba) + key desencriptada del server
 * (fetchDecryptedKey — nunca localStorage). Devuelve null si no hay key: el
 * job falla honesto, no a ciegas.
 *
 * REQ-028 Item 1: si el gate aceptó el run por la CAPA PLATAFORMA (job sin
 * BYOK del leader), result.tier === "platform" y el trace "accepted" trae el
 * provider/model REALES de la env del server. El bridge NO re-resuelve ni
 * toca BYOK: relaya con tier: "platform" y /api/llm pone la key del server.
 *
 * Saneamiento (REQ-025.1 Item 1.3): si el modelo configurado no está en el
 * lineup real del provider (p.ej. un modelo fantasma de un default viejo
 * sobreviviendo en localStorage), cae a defaultModelFor y LO REGISTRA en
 * info.requestedModel para que el job deje rastro de la corrección.
 */
async function resolveGhostLlm(
  job: GhostJobRow,
  /** REQ-028 Item 4.2 — cuota restante que el proxy reporta en cada respuesta
   *  de la capa plataforma (header X-Musa-Quota-Remaining). */
  onQuotaRemaining?: (remaining: number) => void,
): Promise<GhostLlmResolution | null> {
  const result = job.result && typeof job.result === "object" ? (job.result as Record<string, unknown>) : {};
  if (result.tier === "platform") {
    const accepted = Array.isArray(result.trace)
      ? (result.trace as Array<Record<string, unknown>>).find(e => e && e.ev === "accepted")
      : undefined;
    const provider = typeof accepted?.provider === "string" && accepted.provider ? accepted.provider : "zhipu";
    const model = typeof accepted?.model === "string" && accepted.model ? accepted.model : "glm-5.3-flash";
    const info: GhostLlmInfo = { provider, model, requestedModel: null, keySource: "platform", last4: null, tier: "platform" };
    const isAnthropic = provider === "anthropic";
    return {
      info,
      llm: async (system, user) => {
        // Mismo shape que la BYOK (thinking off para zhipu, presupuesto de
        // decisión del brain) pero tier plataforma: la key la pone el server.
        const body = isAnthropic
          ? { model, max_tokens: GHOST_BRAIN_MAX_TOKENS, system, messages: [{ role: "user", content: user }] }
          : { model, max_tokens: GHOST_BRAIN_MAX_TOKENS, messages: [{ role: "system", content: system }, { role: "user", content: user }], ...(provider === "zhipu" ? { thinking: { type: "disabled" } } : {}) };
        const resp = await fetch("/api/llm", {
          method: "POST",
          headers: getApiHeaders(),
          body: JSON.stringify({ provider, tier: "platform", body }),
        });
        if (!resp.ok) throw new Error(`LLM ${resp.status}: ${(await resp.text()).slice(0, 140)}`);
        // Number(null) === 0: distinguir "header ausente" de un 0 real.
        const remainingRaw = resp.headers.get("x-musa-quota-remaining");
        const remaining = remainingRaw == null ? NaN : Number(remainingRaw);
        if (Number.isFinite(remaining)) onQuotaRemaining?.(remaining);
        const data = await resp.json();
        return isAnthropic
          ? (data?.content || []).map((b: any) => b?.text || "").join("")
          : (data?.choices?.[0]?.message?.content || "");
      },
    };
  }
  const chatRoles = await loadChatRoles();
  const { provider, model, requestedModel } = pickLeaderRole(chatRoles);
  const prov = CHAT_PROVIDERS.find(p => p.id === provider) || CHAT_PROVIDERS[0];
  const key = await fetchDecryptedKey(prov.id).catch(() => null);
  if (!key) return null;
  const last4 = await last4For(prov.id).catch(() => null);
  const info: GhostLlmInfo = { provider: prov.id, model, requestedModel, keySource: "server", last4, tier: "byok" };
  const isAnthropic = prov.id === "anthropic";
  return {
    info,
    llm: async (system, user) => {
      // GLM-5.3 piensa por defecto: el brain decide mecánico → thinking off.
      // El bridge SOLO sirve decisiones del brain (runGhostAgent) → presupuesto
      // de decisión (512), no de generación.
      const body = isAnthropic
        ? { model, max_tokens: GHOST_BRAIN_MAX_TOKENS, system, messages: [{ role: "user", content: user }] }
        : { model, max_tokens: GHOST_BRAIN_MAX_TOKENS, messages: [{ role: "system", content: system }, { role: "user", content: user }], ...(prov.id === "zhipu" ? { thinking: { type: "disabled" } } : {}) };
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
    },
  };
}

/** Ejecuta un job reclamado y escribe el desenlace + trace en ghost_jobs. */
async function runGhostJob(job: GhostJobRow): Promise<void> {
  const sb = browserSupabase;
  if (!sb) return;
  // REQ-025.1 Item 3 — telemetría del job: trace en result.trace (jsonb, sin
  // migración). accepted lo escribió el MCP al insertar; acá: claimed →
  // llm_first_call → done|aborted|failed. Los flush se encadenan para que dos
  // escrituras en vuelo nunca pisen el trace entre sí.
  const sessionTrace: GhostTraceEvent[] = [];
  let flushChain: Promise<void> = Promise.resolve();
  const flushTrace = (extraFields: Record<string, unknown> = {}) => {
    flushChain = flushChain
      .then(async () => {
        await sb.from("ghost_jobs").update({
          result: appendTrace(job.result, extraFields, sessionTrace),
        }).eq("id", job.id);
      })
      .catch(() => { /* trace roto no puede romper el job */ });
    return flushChain;
  };
  // REQ-025.1 Item 1.3: si el modelo configurado no estaba en el lineup y el
  // saneamiento lo corrigió, la corrección viaja en el result del job.
  // Se asigna tras resolver la config (finish la cierra por referencia).
  let modelCorrection: { requested: string; used: string; note: string } | null = null;
  const finish = async (status: "done" | "aborted" | "failed", r: GhostAgentResult | null, error?: string) => {
    // Si el error vino del relay LLM ("LLM 402: ..."), el status upstream se
    // clasifica con el MISMO criterio del preflight — el trace queda legible.
    let reasonCode: string | undefined;
    if (error) {
      const m = /LLM (\d{3}):/.exec(error);
      if (m) reasonCode = classifyPreflightFailure(Number(m[1]), error.slice(m.index + m[0].length));
    }
    sessionTrace.push(ghostTraceEvent(status === "done" ? "done" : status === "aborted" ? "aborted" : "failed", {
      phase: r ? "agent" : "llm",
      ...(reasonCode ? { reasonCode } : {}),
      note: r?.note || error || undefined,
    }));
    await sb.from("ghost_jobs").update({
      status,
      result: appendTrace(job.result, {
        delivery: "tab",
        ...(r
          ? { note: r.note, steps: r.steps, sessionId: r.sessionId, lastObservation: r.lastObservation }
          : { error: error || "fallo desconocido" }),
        ...(modelCorrection ? { modelCorrection } : {}),
      }, sessionTrace),
      updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    emitJob({ jobId: job.id, status, task: job.task, note: r?.note || error, steps: r?.steps });
  };
  emitJob({ jobId: job.id, status: "running", task: job.task });
  beginCreation(); // gate de salida: la pestaña no muere con el job en vuelo
  // REQ-028 Item 4.2 — cada respuesta de la capa plataforma reporta cuota
  // restante; el badge lo refleja en vivo (noop si aún no hay badge).
  const resolution = await resolveGhostLlm(job, (remaining) => {
    if (resolution) ghost.setLabel(badgeLabel(resolution.info.tier, resolution.info.provider, remaining));
  });
  sessionTrace.push(ghostTraceEvent("claimed", resolution
    ? {
        provider: resolution.info.provider,
        model: resolution.info.model,
        keySource: resolution.info.keySource,
        last4: resolution.info.last4,
        tier: resolution.info.tier,
      }
    : { phase: "llm", note: "claim sin key para el rol leader" }));
  if (!resolution) {
    await finish("failed", null, "Sin key de LLM para el rol leader — abre el chat y guarda una key para que el ghost pueda decidir.");
    return;
  }
  const { llm, info: llmInfo } = resolution;
  modelCorrection = llmInfo.requestedModel
    ? { requested: llmInfo.requestedModel, used: llmInfo.model, note: "El modelo configurado no está en el lineup del proveedor — se usó el default (REQ-025.1 Item 1)." }
    : null;
  // REQ-028 Item 4.2 — el badge nombra la capa desde el arranque del teatro;
  // en plataforma el número exacto llega con el header de la 1ª respuesta.
  ghost.start(badgeLabel(llmInfo.tier, llmInfo.provider, null));
  void flushTrace(); // claimed persistente: si la pestaña muere a mitad, el trace dice hasta dónde llegó
  // Primera llamada LLM exitosa → evento llm_first_call (el "kernel arrancó").
  let firstCallLogged = false;
  const llmTraced = async (system: string, user: string) => {
    const out = await llm(system, user);
    if (!firstCallLogged) {
      firstCallLogged = true;
      sessionTrace.push(ghostTraceEvent("llm_first_call", { provider: llmInfo.provider, model: llmInfo.model, phase: "llm" }));
      void flushTrace();
    }
    return out;
  };
  // El modo del job manda SOLO durante su ejecución; el switch del dock
  // queda como estaba (es una preferencia del usuario, no del job).
  const prevMode = ghost.getMode();
  if (job.mode === "full" || job.mode === "teacher") ghost.setMode(job.mode);
  try {
    const r = await runGhostAgent({ task: job.task, llm: llmTraced });
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
    .select("id, user_id, workspace_id, task, mode, status, result")
    .eq("user_id", userId).eq("status", "queued")
    .order("created_at", { ascending: true }).limit(3);
  for (const job of (jobs || []) as GhostJobRow[]) {
    // REQ-025.1 Item 2 — preflight ANTES de reclamar: con key muerta el job
    // falla con reasonCode ANTES de mover el cursor. Es el defense-in-depth
    // del gate de ghost_perform (que ya rechaza antes de crear el job): si el
    // job se creó con el preflight apagado o la key murió entre accept y
    // claim, aquí no hay teatro ni gasto de LLM.
    //
    // REQ-028 Item 1 — job de capa plataforma: el gate YA validó el ping de
    // plataforma al aceptar el run, y el preflight BYOK del leader es
    // irrelevante acá (el usuario puede no tener key alguna — esa es la idea
    // del freemium). Saltarlo no abre agujero: el gate server-side mandó.
    const jobTier = job.result && typeof job.result === "object" ? (job.result as Record<string, unknown>).tier : undefined;
    const pf = jobTier === "platform" ? null : await preflightLeaderLlm().catch(() => null);
    if (pf && !pf.ok) {
      await sb.from("ghost_jobs").update({
        status: "failed",
        result: appendTrace(job.result, {
          delivery: "tab",
          error: pf.note,
          reasonCode: pf.reasonCode,
          provider: pf.provider,
          model: pf.model,
          keySource: pf.keySource,
          last4: pf.last4,
        }, [
          ghostTraceEvent("failed", {
            phase: "preflight",
            reasonCode: pf.reasonCode,
            provider: pf.provider,
            model: pf.model,
            keySource: pf.keySource,
            last4: pf.last4,
            note: pf.note,
          }),
        ]),
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);
      emitJob({ jobId: job.id, status: "failed", task: job.task, note: pf.note });
      continue; // sin claim: el job jamás entra en running ni toca el teatro
    }
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
