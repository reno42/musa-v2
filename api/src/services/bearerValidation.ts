import crypto from "node:crypto";

type AuthClientLike = {
  auth: {
    getUser(token: string): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  };
};

// REQ-048: 120s (antes 10s) — los JWT de Supabase viven 1h y son stateless
// (la revocación nunca fue inmediata); re-validar contra el Auth server cada
// 10s cobraba un round-trip de red en prácticamente TODA llamada /api. Con 2
// min, un burst de arranque valida el token una sola vez y el resto sale del
// cache del isolate.
const AUTH_CACHE_TTL_MS = 120_000;
const AUTH_CACHE_MAX_ENTRIES = 256;
const cache = new Map<string, { userId: string; expiresAt: number }>();
const inFlight = new Map<string, Promise<string | null>>();

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function isAuthServiceFailure(error: unknown): boolean {
  const value = error as { status?: number; name?: string; message?: string } | null;
  const status = Number(value?.status);
  return status === 0
    || status >= 500
    || /retryable|fetch|network|timeout|econn|socket/i.test(`${value?.name || ""} ${value?.message || ""}`);
}

/** Collapse concurrent validations of one token into one Supabase Auth call. */
export async function validateBearerToken(authClient: AuthClientLike, bearer: string): Promise<string | null> {
  const cacheKey = tokenHash(bearer);
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.userId;
  if (cached) cache.delete(cacheKey);

  const pending = inFlight.get(cacheKey);
  if (pending) return pending;

  const validation = (async () => {
    const { data, error } = await authClient.auth.getUser(bearer);
    if (error) {
      if (isAuthServiceFailure(error)) throw error;
      return null;
    }
    if (!data.user) return null;
    if (cache.size >= AUTH_CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
    cache.set(cacheKey, { userId: data.user.id, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });
    return data.user.id;
  })();

  inFlight.set(cacheKey, validation);
  void validation.finally(() => {
    if (inFlight.get(cacheKey) === validation) inFlight.delete(cacheKey);
  }).catch(() => undefined);
  return validation;
}
