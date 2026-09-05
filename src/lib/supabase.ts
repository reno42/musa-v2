import { getApiHeaders } from "./apiKey.ts";

const API_BASE = "";
const DEFAULT_GET_RETRIES = 1;
const DEFAULT_TIMEOUT_MS = 11_000;
// A server route may translate an aborted Supabase REST call into 500. GETs
// remain safe to retry; writes never enter this retry path.
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const inFlightReads = new Map<string, Promise<unknown>>();

class ApiResponseError extends Error {}

export type ApiFetchOptions = RequestInit & {
  /** Extra attempts after the first one. Writes are never retried here. */
  retries?: number;
  /** Browser-side deadline for each attempt. */
  timeoutMs?: number;
  /** Concurrent identical GETs share one request unless explicitly disabled. */
  dedupe?: boolean;
};

function requestFingerprint(url: string, headers: Headers): string {
  // Do not retain bearer/API-key values in the map key. This small hash is
  // identity separation, not cryptography; entries only live while a GET is
  // in flight.
  let hash = 2166136261;
  const identity = [...headers.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${value}`)
    .join("\n");
  for (let i = 0; i < identity.length; i++) {
    hash ^= identity.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${url}::${hash >>> 0}`;
}

function retryDelay(attempt: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, attempt === 0 ? 300 : 800));
}

async function fetchAttempt(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const externalSignal = options.signal;
  let timedOut = false;
  const abortFromCaller = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromCaller();
  else externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("API request timed out", "TimeoutError"));
  }, timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new DOMException("API request timed out", "TimeoutError");
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", abortFromCaller);
  }
}

async function executeRequest<T>(
  fullUrl: string,
  options: RequestInit,
  retries: number,
  timeoutMs: number,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (options.signal?.aborted) throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    try {
      const res = await fetchAttempt(fullUrl, options, timeoutMs);
      if (!res.ok) {
        if (attempt < retries && RETRYABLE_STATUS.has(res.status)) {
          void res.body?.cancel().catch(() => undefined);
          await retryDelay(attempt);
          continue;
        }
        throw new ApiResponseError(await failureMessage(res));
      }
      // A 2xx without JSON means the SPA fallback (or a proxy) answered instead of
      // the API. Parsing it would surface V8's raw "Unexpected token '<'" —
      // useless to the user — so translate it into what actually happened.
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error(
          `El servidor respondió HTML en lugar de JSON para ${fullUrl}. `
          + "La API no está disponible en este entorno: levanta el servidor de API (:3001) "
          + "o usa dev:all / preview con proxy, y recarga.");
      }
      return res.json();
    } catch (error) {
      lastError = error;
      if (error instanceof ApiResponseError || options.signal?.aborted || attempt >= retries) throw error;
      await retryDelay(attempt);
    }
  }
  throw lastError;
}

export async function apiFetch<T = any>(url: string, options?: ApiFetchOptions): Promise<T> {
  const fullUrl = url.startsWith("http") ? url : `${API_BASE}${url}`;
  const headers = new Headers(getApiHeaders());
  new Headers(options?.headers).forEach((value, key) => headers.set(key, value));
  const { retries, timeoutMs, dedupe, ...requestOptions } = options || {};
  const method = (requestOptions.method || "GET").toUpperCase();
  const isRead = method === "GET" || method === "HEAD";
  const execute = () => executeRequest<T>(
      fullUrl,
      { ...requestOptions, method, headers },
      isRead ? Math.max(0, retries ?? DEFAULT_GET_RETRIES) : 0,
      Math.max(1_000, timeoutMs ?? DEFAULT_TIMEOUT_MS),
    );

  if (!isRead || dedupe === false || requestOptions.signal) return execute();
  const key = requestFingerprint(fullUrl, headers);
  const existing = inFlightReads.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const request = execute();
  inFlightReads.set(key, request);
  void request.finally(() => {
    if (inFlightReads.get(key) === request) inFlightReads.delete(key);
  }).catch(() => undefined);
  return request;
}

/**
 * The API answers every failure with { success: false, error } — and this used
 * to throw away the error and report the bare status. "API error: 500" is the
 * same sentence whether a column is missing, a key expired, or a workspace is
 * out of reach, so every report had to be diagnosed from scratch instead of
 * just read. The status stays on the front as a prefix; the reason follows.
 */
async function failureMessage(res: Response): Promise<string> {
  const status = `API error: ${res.status}`;
  try {
    const text = await res.text();
    if (!text) return status;
    try {
      const body = JSON.parse(text);
      const detail = body?.error || body?.message;
      if (detail) return `${status} — ${detail}`;
    } catch {
      // Not JSON: a proxy or the platform answered, not us. Keep it short —
      // an HTML error page is noise, not a message.
      const plain = text.trim();
      if (plain && !plain.startsWith("<") && plain.length <= 200) return `${status} — ${plain}`;
    }
  } catch {
    // Body already consumed or the connection died; the status is all there is.
  }
  return status;
}
