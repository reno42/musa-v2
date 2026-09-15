/** Session cache of the LAST CONFIRMED account verdict from /api/account/me:
 *  whether the NDA is already accepted and onboarding is still pending. A
 *  refresh reuses it to enter the app immediately while the check re-runs in
 *  the background (stale-while-revalidate) — a transient API hiccup can no
 *  longer drop an already-verified tab into the "no pudimos verificar" wall.
 *
 *  NDA gate: the cache is written only AFTER the API confirmed the account,
 *  and it only ever unlocks the UI when the cached verdict says the NDA is
 *  already accepted — a pending or never-verified account always goes through
 *  the real check, so the wall is never bypassed by storage. Same envelope
 *  discipline as workspaceCache.ts.
 */

export const ACCOUNT_CHECK_CACHE_KEY = "futuraria-acct-check-v1";
export const ACCOUNT_CHECK_TTL_MS = 30 * 60 * 1000;

export type CachedAccountCheck = { ndaRequired: boolean; onboardingNeeded: boolean };

type CacheStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function availableStorage(storage?: CacheStorage): CacheStorage | null {
  if (storage) return storage;
  return typeof sessionStorage === "undefined" ? null : sessionStorage;
}

export function readAccountCheckCache(
  userId: string | undefined,
  options: { storage?: CacheStorage; now?: number; ttlMs?: number } = {},
): CachedAccountCheck | null {
  if (!userId) return null;
  const storage = availableStorage(options.storage);
  if (!storage) return null;
  try {
    const raw = storage.getItem(ACCOUNT_CHECK_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const now = options.now ?? Date.now();
    const ttlMs = options.ttlMs ?? ACCOUNT_CHECK_TTL_MS;
    const validTimestamp = Number.isFinite(parsed?.ts)
      && parsed.ts <= now + 60_000
      && now - parsed.ts <= ttlMs;
    const validScope = parsed?.version === 1 && parsed?.userId === userId;
    const data = parsed?.data;
    const validVerdict = Boolean(
      data
      && typeof data.ndaRequired === "boolean"
      && typeof data.onboardingNeeded === "boolean",
    );
    if (validTimestamp && validScope && validVerdict) {
      return { ndaRequired: data.ndaRequired, onboardingNeeded: data.onboardingNeeded };
    }
    storage.removeItem(ACCOUNT_CHECK_CACHE_KEY);
  } catch {
    try { storage.removeItem(ACCOUNT_CHECK_CACHE_KEY); } catch { /* best effort */ }
  }
  return null;
}

export function writeAccountCheckCache(
  userId: string | undefined,
  verdict: CachedAccountCheck,
  options: { storage?: CacheStorage; now?: number } = {},
): boolean {
  if (!userId || !verdict || typeof verdict.ndaRequired !== "boolean") return false;
  const storage = availableStorage(options.storage);
  if (!storage) return false;
  try {
    storage.setItem(ACCOUNT_CHECK_CACHE_KEY, JSON.stringify({
      version: 1,
      userId,
      data: { ndaRequired: verdict.ndaRequired, onboardingNeeded: verdict.onboardingNeeded === true },
      ts: options.now ?? Date.now(),
    }));
    return true;
  } catch { return false; }
}
