// ghost-preflight — REQ-025.1 Item 2 (lado server): validar la BYOK del rol
// leader ANTES de que ghost_perform cree un job. Igual que el bridge en la
// pestaña, pero server-side: aquí la key descifrada NUNCA sale del proceso.
//
// La clasificación vive en el módulo puro compartido (src/lib/ghostPreflight.ts)
// — UN solo clasificador para el ping client-side (vía /api/llm) y este ping
// directo. El lineup de modelos viene de src/lib/aiProviders.ts (misma fuente
// que Dashboard/ChatFAB/bridge) — cero duplicación de defaults.
//
// Flag: prefs.ghost_preflight_v1 === false apaga el gate por usuario SIN
// redeploy (se cambia por PATCH /api/account/me prefs, la misma superficie de
// la tarjeta de roles). Default: activado.

import { getUserKey } from "./keys.mjs";
import { PROVIDER_ENDPOINTS } from "./musa-batch-core.mjs";
import { CHAT_PROVIDERS } from "../../src/lib/aiProviders.ts";
import { buildPreflightBody, classifyPreflightFailure, GHOST_PREFLIGHT_TIMEOUT_MS, rotationHint } from "../../src/lib/ghostPreflight.ts";
import { ghostTraceEvent } from "../../src/lib/ghostJobTrace.ts";

/**
 * Evento "accepted" del trace del job (REQ-025.1 Item 3) con los metadatos
 * del preflight — o la marca honesta de por qué NO corrió (flag/fail-open).
 */
export function acceptedTraceEvent(pf, role) {
  if (pf) {
    return ghostTraceEvent("accepted", {
      provider: pf.provider,
      model: pf.model,
      keySource: pf.keySource,
      last4: pf.last4,
      reasonCode: "PREFLIGHT_OK",
    });
  }
  if (role) {
    return ghostTraceEvent("accepted", { provider: role.provider, model: role.model, note: "preflight off (flag)" });
  }
  return ghostTraceEvent("accepted", { note: "preflight fail-open (prefs ilegibles)" });
}

/**
 * Rechazo estructurado de ghost_perform cuando el preflight falla: SOLO
 * metadatos (nunca plaintext) + reasonCode + instrucción de rotación.
 * El tool nunca falla raro — responde aceptando que NO encoló nada.
 */
export function preflightRejection(pf) {
  const hint = rotationHint(pf.provider, CHAT_PROVIDERS.find(p => p.id === pf.provider)?.label);
  return {
    accepted: false,
    delivery: "none",
    reasonCode: pf.reasonCode,
    provider: pf.provider,
    model: pf.model,
    keySource: pf.keySource,
    last4: pf.last4,
    latencyMs: pf.latencyMs,
    error: `Preflight BYOK falló (${pf.reasonCode}) con ${pf.provider}/${pf.model}${pf.last4 ? ` — key ****${pf.last4}` : " — sin key guardada"}. Rotá la key o cambiá el provider del rol leader en ${hint}. No se creó ningún job.`,
    note: `No encolé nada: la key del rol leader no sirve (${pf.reasonCode}). ${hint}`,
  };
}

/** Techo del ping server-side: la función Netlify tiene 10s de presupuesto. */
const SERVER_PING_TIMEOUT_MS = Math.min(GHOST_PREFLIGHT_TIMEOUT_MS, 6000);

/**
 * Resuelve el rol leader de las server prefs (la MISMA fuente que escribe la
 * tarjeta de roles del Dashboard y que lee el bridge en la pestaña) + el
 * estado del flag. Devuelve null si no se pudo leer prefs: en ese caso el
 * gate NO bloquea (fail-open — rechazar con el provider equivocado sería peor).
 */
export async function resolveLeaderRole(sb, userId) {
  const { data, error } = await sb.from("user_profiles").select("prefs").eq("id", userId).maybeSingle();
  if (error) return null;
  const prefs = data?.prefs && typeof data.prefs === "object" && !Array.isArray(data.prefs) ? data.prefs : {};
  const leader = prefs.chatRoles && typeof prefs.chatRoles === "object" ? (prefs.chatRoles.leader || {}) : {};
  const known = CHAT_PROVIDERS.find(p => p.id === leader.provider);
  const provider = known ? known.id : "deepseek";
  const lineup = CHAT_PROVIDERS.find(p => p.id === provider)?.models || [];
  // Modelo configurado si es un string no vacío; el lineup completo lo valida
  // el propio ping (un modelo inexistente responde 404 → MODEL_FORBIDDEN).
  const model = typeof leader.model === "string" && leader.model ? leader.model : (lineup[0] || "deepseek-chat");
  return {
    provider,
    model,
    preflightEnabled: prefs.ghost_preflight_v1 !== false,
  };
}

/**
 * Ping mínimo (max_tokens 1) al proveedor con la BYOK descifrada del usuario.
 * Devuelve SOLO metadatos — la key jamás aparece en el resultado.
 */
export async function preflightUserLlm({ userId, provider, model }) {
  const t0 = Date.now();
  const base = { provider, model, keySource: "server" };
  const endpoint = PROVIDER_ENDPOINTS[provider];
  if (!endpoint) return { ...base, ok: false, last4: null, reasonCode: "PROVIDER_UNAVAILABLE", latencyMs: Date.now() - t0 };

  const owned = await getUserKey(userId, provider).catch(() => null);
  const key = owned?.key || "";
  if (!key) return { ...base, ok: false, last4: null, reasonCode: "BYOK_MISSING", latencyMs: Date.now() - t0 };

  const headers = { "Content-Type": "application/json" };
  if (provider === "anthropic") {
    headers["x-api-key"] = key;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers["Authorization"] = `Bearer ${key}`;
  }
  try {
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(buildPreflightBody(provider, model)),
      signal: AbortSignal.timeout(SERVER_PING_TIMEOUT_MS),
    });
    const text = await upstream.text();
    return {
      ...base,
      ok: upstream.ok,
      last4: key.slice(-4),
      reasonCode: classifyPreflightFailure(upstream.status, text),
      latencyMs: Date.now() - t0,
    };
  } catch {
    return { ...base, ok: false, last4: key.slice(-4), reasonCode: "PROVIDER_UNAVAILABLE", latencyMs: Date.now() - t0 };
  }
}
