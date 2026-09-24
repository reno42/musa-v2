// ghostPreflight — REQ-025.1 Item 2: preflight BYOK del ghost.
//
// Ping mínimo al proveedor (max_tokens ~1) ANTES de reclamar/crear un job,
// para clasificar el fallo honesto en vez de descubrirlo a los 25 pasos con
// el cursor en pantalla. Clasificación por status del upstream:
//
//   BYOK_MISSING              sin key para el provider (404 "No key configured" del proxy)
//   BYOK_INVALID              401/403 — key inválida o revocada
//   BYOK_INSUFFICIENT_BALANCE 402 — saldo agotado (DeepSeek la usa para eso);
//                             también 429 con insufficient_quota (formato OpenAI)
//   BYOK_WRONG_ENDPOINT       404 que NO es ni "sin key" ni "modelo" (HTML,
//                             endpoint mal configurado)
//   MODEL_FORBIDDEN           404 que menciona el modelo (p.ej. "Model Not
//                             Exist" de DeepSeek / acceso al modelo denegado)
//   PROVIDER_RATE_LIMITED     429 (quota agotada va a BYOK_INSUFFICIENT_BALANCE)
//   PROVIDER_UNAVAILABLE      5xx, 502 del relay o red caída
//
// Resultado SIEMPRE { ok, provider, model, keySource, last4, reasonCode } —
// nunca plaintext, nunca headers. Este módulo es PURO y sin imports: lo
// consumen el browser (ghostBridge, vía proxy /api/llm) Y el server
// (netlify/functions/ghost-preflight.mjs, ping directo con la key
// descifrada) — una sola clasificación para ambos caminos.

export type GhostPreflightReasonCode =
  | "PREFLIGHT_OK"
  | "BYOK_MISSING"
  | "BYOK_INVALID"
  | "BYOK_INSUFFICIENT_BALANCE"
  | "BYOK_WRONG_ENDPOINT"
  | "MODEL_FORBIDDEN"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE";

export const GHOST_PREFLIGHT_REASON_CODES: GhostPreflightReasonCode[] = [
  "PREFLIGHT_OK",
  "BYOK_MISSING",
  "BYOK_INVALID",
  "BYOK_INSUFFICIENT_BALANCE",
  "BYOK_WRONG_ENDPOINT",
  "MODEL_FORBIDDEN",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
];

/** Techo del ping: la idea es fallar rápido, no competir con el LLM real. */
export const GHOST_PREFLIGHT_TIMEOUT_MS = 8000;

/**
 * Clasifica (status, body) de un ping/relay en un reasonCode. Puro — testeado
 * con mocks de los 7 códigos en QA/ghost-preflight.test.mjs.
 */
export function classifyPreflightFailure(status: number, bodyText: string): GhostPreflightReasonCode {
  const body = String(bodyText || "").slice(0, 2000);
  if (status >= 200 && status < 300) return "PREFLIGHT_OK";
  if (status === 401 || status === 403) return "BYOK_INVALID";
  if (status === 402) return "BYOK_INSUFFICIENT_BALANCE";
  if (status === 429) {
    // Formato OpenAI: quota AGOTADA llega como 429 insufficient_quota —
    // rota la key/recarga saldo, no "esperá un rato".
    if (/insufficient_quota|quota exceeded|billing/i.test(body)) return "BYOK_INSUFFICIENT_BALANCE";
    return "PROVIDER_RATE_LIMITED";
  }
  if (status === 404) {
    // 404 del relay /api/llm: no hay key para ese provider en el server.
    if (/no key configured/i.test(body)) return "BYOK_MISSING";
    // 404 del proveedor que menciona el modelo: modelo inexistente o sin acceso.
    if (/model/i.test(body)) return "MODEL_FORBIDDEN";
    return "BYOK_WRONG_ENDPOINT";
  }
  // 5xx, 502 del relay, 400 de provider desconocido, red: el proveedor no
  // pudo atender — nunca inventamos el porqué del lado del cliente.
  return "PROVIDER_UNAVAILABLE";
}

/**
 * Cuerpo del ping: el mismo shape que el cierre LLM del bridge (anthropic
 * lleva system como parámetro propio; zhipu piensa por defecto → off) pero
 * con max_tokens ~1: valida key+modelo gastando lo mínimo.
 */
export function buildPreflightBody(provider: string, model: string): Record<string, unknown> {
  if (provider === "anthropic") {
    return { model, max_tokens: 1, messages: [{ role: "user", content: "ping" }] };
  }
  return {
    model,
    max_tokens: 1,
    messages: [{ role: "user", content: "ping" }],
    ...(provider === "zhipu" ? { thinking: { type: "disabled" } } : {}),
  };
}

export interface GhostPreflightResult {
  ok: boolean;
  provider: string;
  model: string;
  /** De dónde salió la key. El preflight siempre valida la BYOK del server. */
  keySource: "server";
  /** Últimos 4 dígitos — nunca la key, nunca headers. */
  last4: string | null;
  reasonCode: GhostPreflightReasonCode;
  latencyMs: number;
}

interface PreflightViaProxyInput {
  provider: string;
  model: string;
  /** Headers con la sesión (getApiHeaders() en el browser). */
  headers?: Record<string, string>;
  last4?: string | null;
  /** Relay same-origin; inyectable para tests. */
  url?: string;
  post?: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<Response>;
  timeoutMs?: number;
}

/**
 * Ping por el MISMO camino que las llamadas reales del ghost (POST /api/llm,
 * que resuelve la BYOK descifrada server-side — la key nunca baja al browser).
 * El ping valida exactamente la key y el modelo que usará el job.
 */
export async function preflightViaProxy(input: PreflightViaProxyInput): Promise<GhostPreflightResult> {
  const t0 = Date.now();
  const base = {
    provider: input.provider,
    model: input.model,
    keySource: "server" as const,
    last4: input.last4 ?? null,
  };
  const post = input.post || fetch;
  const url = input.url || "/api/llm";
  try {
    const resp = await post(url, {
      method: "POST",
      headers: input.headers || { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ provider: input.provider, body: buildPreflightBody(input.provider, input.model) }),
      signal: AbortSignal.timeout(input.timeoutMs ?? GHOST_PREFLIGHT_TIMEOUT_MS),
    });
    const text = await resp.text();
    return { ...base, ok: resp.ok, reasonCode: classifyPreflightFailure(resp.status, text), latencyMs: Date.now() - t0 };
  } catch {
    // Timeout/red: no puedo distinguir más — honesto genérico.
    return { ...base, ok: false, reasonCode: "PROVIDER_UNAVAILABLE", latencyMs: Date.now() - t0 };
  }
}

/** Instrucción de rotación para el humano — el label del provider si se conoce. */
export function rotationHint(providerId: string, label?: string): string {
  return `Configuración → Invita IAs → ${label || providerId}`;
}
