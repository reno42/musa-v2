/** Stale-while-revalidate cache for dashboard panes (kanban, content, marcas).
 *
 *  Same contract as templateCache.ts: a versioned envelope scoped to
 *  user + workspace, TTL-bounded, best-effort (every failure = cache miss).
 *
 *  NDA gate: every pane using this lives INSIDE Dashboard, which App.tsx only
 *  mounts after the wall — cached rows can never render before acceptance.
 *
 *  The payload is caller-shaped (arrays or {cards, columns}); validation is
 *  intentionally shallow because every pane revalidates from the network on
 *  mount anyway — the cache only needs to look fresh, never to be trusted.
 */

export const PANE_CACHE_PREFIX = "futuraria-pane-cache-v1";
export const PANE_CACHE_TTL_MS = 30 * 60 * 1000;

type CacheStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function availableStorage(storage?: CacheStorage): CacheStorage | null {
  if (storage) return storage;
  return typeof localStorage === "undefined" ? null : localStorage;
}

function paneCacheKey(pane: string, userId: string, workspaceId: string): string {
  return `${PANE_CACHE_PREFIX}:${pane}:${encodeURIComponent(userId)}:${encodeURIComponent(workspaceId)}`;
}

export function readPaneCache<T>(
  pane: string,
  userId: string | undefined,
  workspaceId: string | undefined,
  options: { storage?: CacheStorage; now?: number; ttlMs?: number } = {},
): T | null {
  if (!userId || !workspaceId) return null;
  const storage = availableStorage(options.storage);
  if (!storage) return null;
  try {
    const raw = storage.getItem(paneCacheKey(pane, userId, workspaceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const now = options.now ?? Date.now();
    const ttlMs = options.ttlMs ?? PANE_CACHE_TTL_MS;
    const validTimestamp = Number.isFinite(parsed?.ts)
      && parsed.ts <= now + 60_000
      && now - parsed.ts <= ttlMs;
    const validScope = parsed?.version === 1
      && parsed?.pane === pane
      && parsed?.userId === userId
      && parsed?.workspaceId === workspaceId;
    if (validTimestamp && validScope && parsed?.data != null) return parsed.data as T;
    storage.removeItem(paneCacheKey(pane, userId, workspaceId));
  } catch {
    try { storage.removeItem(paneCacheKey(pane, userId, workspaceId)); } catch { /* best effort */ }
  }
  return null;
}

export function writePaneCache<T>(
  pane: string,
  userId: string | undefined,
  workspaceId: string | undefined,
  data: T,
  options: { storage?: CacheStorage; now?: number } = {},
): boolean {
  if (!userId || !workspaceId) return false;
  const storage = availableStorage(options.storage);
  if (!storage) return false;
  try {
    storage.setItem(paneCacheKey(pane, userId, workspaceId), JSON.stringify({
      version: 1,
      pane,
      userId,
      workspaceId,
      data,
      ts: options.now ?? Date.now(),
    }));
    return true;
  } catch { return false; }
}
