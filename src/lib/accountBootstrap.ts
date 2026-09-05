import type { Session } from "@supabase/supabase-js";

export type BootstrapPayload = {
  data?: { personalWorkspaceId?: string };
  error?: string;
};

type BootstrapOptions = {
  fetchImpl?: typeof fetch;
  retries?: number;
  timeoutMs?: number;
};

const completed = new Map<string, BootstrapPayload>();
const inFlight = new Map<string, Promise<BootstrapPayload>>();
const TRANSIENT_STATUS = new Set([408, 425, 429, 502, 503, 504]);
class BootstrapResponseError extends Error {}

function pause(attempt: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, attempt === 0 ? 300 : 800));
}

async function attemptBootstrap(
  session: Session,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Bootstrap timed out", "TimeoutError")), timeoutMs);
  try {
    return await fetchImpl("/api/account/bootstrap", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: "{}",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Account bootstrap is idempotent but relatively expensive. Supabase emits an
 * INITIAL_SESSION event after getSession(), so without this guard the same
 * page load starts it twice. Successful results stay cached for the lifetime
 * of the page; failures are released so a later auth event can recover.
 */
export function bootstrapAccountSession(
  session: Session,
  options: BootstrapOptions = {},
): Promise<BootstrapPayload> {
  const userId = session.user.id;
  const cached = completed.get(userId);
  if (cached) return Promise.resolve(cached);
  const pending = inFlight.get(userId);
  if (pending) return pending;

  const fetchImpl = options.fetchImpl ?? fetch;
  const retries = Math.max(0, options.retries ?? 2);
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? 8_000);
  const request = (async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await attemptBootstrap(session, fetchImpl, timeoutMs);
        if (!response.ok) {
          const body = await response.json().catch(() => ({})) as BootstrapPayload;
          const error = new BootstrapResponseError(body.error || `Bootstrap error: ${response.status}`);
          if (attempt >= retries || !TRANSIENT_STATUS.has(response.status)) throw error;
          lastError = error;
        } else {
          const payload = await response.json() as BootstrapPayload;
          completed.set(userId, payload);
          return payload;
        }
      } catch (error) {
        lastError = error;
        if (error instanceof BootstrapResponseError || attempt >= retries) throw error;
      }
      await pause(attempt);
    }
    throw lastError;
  })();

  inFlight.set(userId, request);
  void request.finally(() => {
    if (inFlight.get(userId) === request) inFlight.delete(userId);
  }).catch(() => undefined);
  return request;
}
