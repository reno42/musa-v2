// ghostLlmChain — REQ-028 Item 1: cadena de resolución LLM del Ghost.
//
//   CAPA 1 — IA de plataforma (freemium con cuota, Item 2): env del server
//            (OPENROUTER_API_KEY / ZHIPU_API_KEY) → glm-5.3-flash thinking off.
//   CAPA 2 — BYOK del usuario: key del rol leader desencriptada server-side
//            (getUserKey) — su key manda SIEMPRE que exista; la plataforma
//            no gasta ni interviene.
//   CAPA 3 — Rechazo honesto: tier "none" con reasonCode accionable
//            (PLATFORM_LLM_UNAVAILABLE = config del operador; Item 2 agrega
//            FREEMIUM_QUOTA_EXHAUSTED cuando la cuota gratis se agotó).
//
// resolveGhostChain(userId) → { tier, provider, model, headers, extraBody,
// keyLast4, endpoint, leader, reasonCode?, detail? } — el MISMO contrato para
// el gate de ghost_perform (mcp.mjs) y el relay /api/llm (routes/llmProxy.ts).
//
// IMPORTS SIN CICLOS: este módulo NO importa musa-batch-core.mjs (los
// endpoints llegan como parámetro — misma tabla que PROVIDER_ENDPOINTS) ni
// ghost-preflight.mjs (que importa musa-batch-core). La lectura de prefs del
// rol leader vive acá en vez de reusar resolveLeaderRole de ghost-preflight
// por esa misma razón (10 líneas, mismo shape, mismo flag default).
//
// keys.mjs va con import DINÁMICO: su import estático de
// api/src/services/supabase.js no resuelve bajo node ESM puro (el bundler lo
// mapea a .ts, Node no) — lazy lo mantiene testeable con fake inyectable.

import { CHAT_PROVIDERS } from "../../src/lib/aiProviders.ts";
import { buildPreflightBody, classifyPreflightFailure } from "../../src/lib/ghostPreflight.ts";

/** getUserKey real, cargado solo cuando se usa (ver nota de imports). */
async function defaultGetUserKey(userId, provider) {
  const { getUserKey } = await import("./keys.mjs");
  return getUserKey(userId, provider);
}

/** Techo del ping de plataforma: el gate corre dentro del presupuesto de la
 *  función (10s) — igual criterio que el ping BYOK de ghost-preflight.mjs. */
export const PLATFORM_PING_TIMEOUT_MS = 6000;

/**
 * Capa 1 pura: pick de LLM de plataforma desde env — la MISMA cadena y los
 * MISMOS defaults que resolveTextLlm de musa-batch-core.mjs (que desde REQ-028
 * delega acá en vez de duplicar la lógica). null si el server no tiene env key.
 */
export function pickPlatformLlm(endpoints, env = process.env) {
  if (env.OPENROUTER_API_KEY) {
    return {
      provider: "openrouter",
      endpoint: endpoints.openrouter,
      model: env.OPENROUTER_TEXT_MODEL || "openai/gpt-6-sol",
      headers: { "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
      extraBody: {},
    };
  }
  if (env.ZHIPU_API_KEY) {
    return {
      provider: "zhipu",
      endpoint: endpoints.zhipu,
      model: env.ZHIPU_TEXT_MODEL || "glm-5.3-flash",
      headers: { "Authorization": `Bearer ${env.ZHIPU_API_KEY}`, "Content-Type": "application/json" },
      extraBody: { thinking: { type: "disabled" } },
    };
  }
  return null;
}

/**
 * Prefs del rol leader (server prefs — la MISMA fuente que la tarjeta de
 * roles del Dashboard) + el flag del feature. Lee user_profiles.prefs una
 * sola vez y devuelve null si no se pudo leer: el gate decide fail-open.
 * Flag ghost_platform_llm_v1 (REQ-028): prefs.ghost_platform_llm_v1 === false
 * lo apaga por usuario SIN redeploy (mismo PATCH de prefs del preflight).
 */
export async function readLeaderPrefs(sb, userId) {
  const { data, error } = await sb.from("user_profiles").select("prefs").eq("id", userId).maybeSingle();
  if (error) return null;
  const prefs = data?.prefs && typeof data.prefs === "object" && !Array.isArray(data.prefs) ? data.prefs : {};
  const leader = prefs.chatRoles && typeof prefs.chatRoles === "object" ? (prefs.chatRoles.leader || {}) : {};
  const known = CHAT_PROVIDERS.find(p => p.id === leader.provider);
  const provider = known ? known.id : "deepseek";
  const lineup = known?.models || CHAT_PROVIDERS[0]?.models || [];
  const model = typeof leader.model === "string" && leader.model ? leader.model : (lineup[0] || "deepseek-chat");
  return {
    provider,
    model,
    platformEnabled: prefs.ghost_platform_llm_v1 !== false,
  };
}

/**
 * Cadena completa plataforma → BYOK → none (REQ-028 Item 1).
 *
 * Devuelve SIEMPRE metadatos — la key de plataforma (env) y la BYOK van solo
 * en headers y jamás se loguean. tiers:
 *   "byok"     — el usuario tiene key del rol leader: SU IA manda, cuota
 *                intacta, la plataforma no interviene.
 *   "platform" — sin BYOK pero el server tiene env key y el flag está on.
 *                La cuota (Item 2) la cobra el gate al aceptar el run.
 *   "none"     — nada disponible: reasonCode + detail honesto para el rechazo.
 */
export async function resolveGhostChain(userId, { sb, endpoints, env = process.env, getUserKey = defaultGetUserKey } = {}) {
  if (!sb || !endpoints) return null;
  const leaderPrefs = await readLeaderPrefs(sb, userId).catch(() => null);

  // CAPA 2 primero en la decisión: la BYOK del leader manda SIEMPRE (§1 —
  // "su key manda siempre y la plataforma no gasta ni interviene").
  const leader = {
    provider: leaderPrefs?.provider || "deepseek",
    model: leaderPrefs?.model || "deepseek-chat",
  };
  const owned = await getUserKey(userId, leader.provider).catch(() => null);
  if (owned?.key) {
    const headers = { "Content-Type": "application/json" };
    if (leader.provider === "anthropic") {
      headers["x-api-key"] = owned.key;
      headers["anthropic-version"] = "2023-06-01";
    } else {
      headers["Authorization"] = `Bearer ${owned.key}`;
    }
    return {
      tier: "byok",
      leader,
      provider: leader.provider,
      model: leader.model,
      endpoint: endpoints[leader.provider] || null,
      headers,
      extraBody: leader.provider === "zhipu" ? { thinking: { type: "disabled" } } : {},
      keyLast4: owned.key.slice(-4),
    };
  }

  // CAPA 1: plataforma — solo si el flag del usuario no la apagó.
  if (leaderPrefs && !leaderPrefs.platformEnabled) {
    return {
      tier: "none",
      reasonCode: "PLATFORM_LLM_UNAVAILABLE",
      detail: "ghost_platform_llm_v1 está apagado en tus preferencias (prefs).",
      leader,
    };
  }
  const platform = pickPlatformLlm(endpoints, env);
  if (!platform) {
    return {
      tier: "none",
      reasonCode: "PLATFORM_LLM_UNAVAILABLE",
      detail: "El server no tiene ZHIPU_API_KEY ni OPENROUTER_API_KEY (config del operador, no tu culpa).",
      leader,
    };
  }
  return {
    tier: "platform",
    leader,
    provider: platform.provider,
    model: platform.model,
    endpoint: platform.endpoint,
    headers: platform.headers,
    extraBody: platform.extraBody,
    keyLast4: null, // la key es del server — nunca hay last4 de usuario que mostrar
  };
}

/**
 * Ping mínimo (max_tokens 1) al LLM de plataforma con la env key — valida el
 * camino REAL que usará el job antes de cobrar cuota ni crear nada. Igual que
 * preflightUserLlm: devuelve solo metadatos, jamás la key.
 */
export async function pingPlatformLlm(platform, timeoutMs = PLATFORM_PING_TIMEOUT_MS) {
  const t0 = Date.now();
  const base = { provider: platform.provider, model: platform.model, keySource: "platform" };
  if (!platform.endpoint) return { ...base, ok: false, reasonCode: "PLATFORM_LLM_UNAVAILABLE", latencyMs: Date.now() - t0 };
  try {
    const upstream = await fetch(platform.endpoint, {
      method: "POST",
      headers: platform.headers,
      body: JSON.stringify({ ...buildPreflightBody(platform.provider, platform.model), ...platform.extraBody }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await upstream.text();
    return {
      ...base,
      ok: upstream.ok,
      reasonCode: upstream.ok ? "PREFLIGHT_OK" : classifyPreflightFailure(upstream.status, text),
      status: upstream.status,
      latencyMs: Date.now() - t0,
    };
  } catch {
    return { ...base, ok: false, reasonCode: "PLATFORM_LLM_UNAVAILABLE", latencyMs: Date.now() - t0 };
  }
}
