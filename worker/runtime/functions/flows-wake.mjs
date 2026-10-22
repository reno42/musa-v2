// REQ-040 — flows-wake: webhook saliente ("wake") cuando un run entra en
// status:"waiting". Push, no pull: el server avisa en el instante exacto de la
// pausa (el receptor —p.ej. Hermes— abre sesión de agente con el payload y
// llama flow_resume con el resumeToken). Aquí vive SOLO pegamento de red:
// firma HMAC, reintentos backoff y lectura de la config del workspace
// (workspaces.flows_wake, migración v68). El engine no sabe que el wake
// existe: flows-runtime llama scheduleFlowWake DESPUÉS de persistir el run y
// NUNCA lo espera — el wake jamás bloquea ni falla un run.
//
// Decisión REQ-027 que esto respeta: sin cron server-side. Si el wake se
// agota (3 reintentos), el fallback de descubrimiento es
// flow_history {status:"waiting"} — solo log, nunca error ruidoso.

import crypto from "node:crypto";
import { assertPublicHttps, guardedFetch } from "./flows-sources.mjs";

// Backoff REQ-040 §2: 3 reintentos (1s / 5s / 25s) tras el intento inicial.
export const WAKE_BACKOFF_MS = [1_000, 5_000, 25_000];
const WAKE_TIMEOUT_MS = 10_000;
const WAKE_SECRET_BYTES = 24; // 48 chars hex — mismo orden que el webhook de flow

/** Secreto HMAC del wake. Lo genera el server cuando el workspace aún no
 *  tiene uno (flow_wake_set sin secret); el receptor lo guarda para verificar
 *  X-Musa-Signature. */
export function newWakeSecret() {
  return crypto.randomBytes(WAKE_SECRET_BYTES).toString("hex");
}

/** El secret JAMÁS se devuelve completo: hint = últimos 4 (mismo criterio que
 *  las keys fdr_ws_...). */
export function wakeSecretHint(secret) {
  const value = String(secret ?? "");
  return value.length >= 4 ? `•••${value.slice(-4)}` : null;
}

/** X-Musa-Signature: hex(hmac_sha256(secret, body)) — el receptor verifica
 *  ANTES de actuar (anti-falsificación del endpoint). Body = el string exacto
 *  que viaja en el POST. */
export function signWakeBody(secret, body) {
  return crypto.createHmac("sha256", String(secret ?? "")).update(String(body)).digest("hex");
}

/** Normaliza la columna flows_wake (jsonb) a {url, secret, enabled, createdAt}
 *  o null si no hay config usable. enabled default true — solo enabled:false
 *  explícito apaga (REQ: "enabled = false o no hay URL → nada"). */
export function normalizeWakeConfig(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  const secret = typeof raw.secret === "string" ? raw.secret.trim() : "";
  if (!url || !secret) return null;
  return {
    url,
    secret,
    enabled: raw.enabled !== false,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : null,
  };
}

/** Payload EXACTO del REQ-040 §2 — el contrato que Hermes consume. El server
 *  no redacta ni decide: entrega {resumeToken, message, kind,...} y nada más. */
export function wakePayload({ workspaceId, flow, runId, wait }) {
  return {
    type: "flow_wait",
    workspaceId,
    flowId: flow.id,
    flowName: flow.name ?? "",
    runId,
    nodeId: wait.nodeId,
    kind: wait.kind,
    message: String(wait.message ?? ""),
    // REQ-042 ai_task: el título de la tarea IA viaja en el push (aditivo —
    // los receptores existentes ignoran campos extra).
    ...(wait.title ? { title: wait.title } : {}),
    resumeToken: wait.resumeToken,
    expiresAt: wait.expiresAt ?? null,
  };
}

async function readWakeConfig(sb, workspaceId) {
  const { data, error } = await sb.from("workspaces").select("flows_wake").eq("id", workspaceId).maybeSingle();
  if (error || !data) return null;
  return normalizeWakeConfig(data.flows_wake);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** POST firmado con reintentos backoff. Devuelve el resultado del ÚLTIMO
 *  intento — el caller decide si es silencioso (wake) o reportable (test). */
export async function dispatchWake(url, secret, body, { log = () => {} } = {}) {
  const signature = signWakeBody(secret, body);
  let lastStatus = null;
  let lastError = null;
  for (let attempt = 0; attempt <= WAKE_BACKOFF_MS.length; attempt++) {
    if (attempt > 0) await sleep(WAKE_BACKOFF_MS[attempt - 1]);
    try {
      const res = await guardedFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-musa-signature": signature, "user-agent": "Musa-Flows-Wake/1" },
        body,
      }, { timeoutMs: WAKE_TIMEOUT_MS });
      lastStatus = res.status;
      // 2xx = entregado. 4xx = el receptor lo rechazó: reintentar no cambia
      // nada (misma firma, mismo body) — salvo 408/429 (transitorios).
      const transient = res.status === 408 || res.status === 429 || res.status >= 500;
      if (res.status >= 200 && res.status < 300) return { delivered: true, status: res.status, attempts: attempt + 1, error: null };
      if (!transient) break;
      lastError = `HTTP ${res.status}`;
    } catch (error) {
      lastError = String(error?.message ?? error).slice(0, 300);
    }
  }
  log(`[flows-wake] POST agotado (${lastError ?? `HTTP ${lastStatus}`}) — el run sigue waiting; fallback: flow_history status:"waiting"`);
  return { delivered: false, status: lastStatus, attempts: WAKE_BACKOFF_MS.length + 1, error: lastError };
}

/** Punto de enganche del runtime (flows-runtime tras persistir waiting).
 *  Fire-and-forget REAL: retorna inmediatamente; la entrega corre en una
 *  promesa flotante o vía waitUntil del host (Netlify/Workers). Sin config →
 *  no-op. JAMÁS lanza: un wake roto no puede romper un run. */
export function scheduleFlowWake({ sb, flow, runId, wait, workspaceId, waitUntil, log = (m) => console.log(m) } = {}) {
  try {
    if (!sb || !flow || !wait?.resumeToken) return false;
    const task = (async () => {
      const config = await readWakeConfig(sb, workspaceId || flow.workspace_id);
      if (!config || !config.enabled) return;
      const body = JSON.stringify(wakePayload({ workspaceId: workspaceId || flow.workspace_id, flow, runId, wait }));
      await dispatchWake(config.url, config.secret, body, { log });
    })();
    const guarded = task.catch((error) => log(`[flows-wake] error (silencioso): ${String(error?.message ?? error).slice(0, 300)}`));
    if (typeof waitUntil === "function") waitUntil(guarded);
    return true;
  } catch (error) {
    log(`[flows-wake] schedule error (silencioso): ${String(error?.message ?? error).slice(0, 300)}`);
    return false;
  }
}

/** flow_wake_test: POST de prueba firmado (mismo camino que el wake real) →
 *  el status HTTP que respondió el endpoint. Sincrónico: la tool reporta. */
export async function runWakeTest({ sb, workspaceId, log = (m) => console.log(m) } = {}) {
  const config = await readWakeConfig(sb, workspaceId);
  if (!config) return { ok: false, configured: false, status: null, error: "Sin URL de wake configurada (flow_wake_set primero)." };
  if (!config.enabled) return { ok: false, configured: true, status: null, error: "El wake está deshabilitado (flow_wake_set enabled:true)." };
  const body = JSON.stringify({ type: "flow_wake_test", workspaceId, at: new Date().toISOString(), note: "POST de prueba desde flow_wake_test (Musa Flows REQ-040)." });
  const result = await dispatchWake(config.url, config.secret, body, { log });
  return { ok: result.delivered, configured: true, status: result.status, attempts: result.attempts, error: result.error };
}

/** Valida la URL al SETEARLA (mismo guard SSRF que los nodos http): una URL
 *  mala debe morir en flow_wake_set, no a las 3am en el wake. */
export async function assertWakeUrl(value) {
  return assertPublicHttps(value);
}
