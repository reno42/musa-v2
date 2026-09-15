/** Boot cache for the Dashboard shell: the workspace list plus the last
 *  active id, kept in sessionStorage so a refresh paints the selector and
 *  starts pane fetches WITHOUT waiting for /api/workspaces. Revalidated on
 *  every mount — the network list always overwrites this.
 *
 *  NDA gate: reads and writes happen inside Dashboard, which App.tsx mounts
 *  only after the wall — the cache never short-circuits the legal check.
 *  Same envelope discipline as templateCache.ts / paneCache.ts.
 */

export const WORKSPACE_CACHE_KEY = "futuraria-ws-boot-v1";
export const WORKSPACE_CACHE_TTL_MS = 30 * 60 * 1000;

export type CachedWorkspace = { id: string; name: string; slug?: string };
export type CachedWorkspaces = { workspaces: CachedWorkspace[]; activeId: string | null };

type CacheStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const EMPTY: CachedWorkspaces = { workspaces: [], activeId: null };

function availableStorage(storage?: CacheStorage): CacheStorage | null {
  if (storage) return storage;
  return typeof sessionStorage === "undefined" ? null : sessionStorage;
}

export function readWorkspaceCache(
  userId: string | undefined,
  options: { storage?: CacheStorage; now?: number; ttlMs?: number } = {},
): CachedWorkspaces {
  if (!userId) return EMPTY;
  const storage = availableStorage(options.storage);
  if (!storage) return EMPTY;
  try {
    const raw = storage.getItem(WORKSPACE_CACHE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw);
    const now = options.now ?? Date.now();
    const ttlMs = options.ttlMs ?? WORKSPACE_CACHE_TTL_MS;
    const validTimestamp = Number.isFinite(parsed?.ts)
      && parsed.ts <= now + 60_000
      && now - parsed.ts <= ttlMs;
    const validScope = parsed?.version === 1 && parsed?.userId === userId;
    const workspaces = parsed?.workspaces;
    const validList = Array.isArray(workspaces) && workspaces.length > 0
      && workspaces.every((w: unknown) => {
        const ws = w as Partial<CachedWorkspace> | null;
        return Boolean(ws && typeof ws.id === "string" && typeof ws.name === "string");
      });
    if (validTimestamp && validScope && validList) {
      const list = workspaces as CachedWorkspace[];
      // A cached activeId that no longer exists in the list would make every
      // pane fetch a dead workspace before revalidation lands.
      const activeId = typeof parsed.activeId === "string" && list.some(w => w.id === parsed.activeId)
        ? parsed.activeId
        : null;
      return { workspaces: list, activeId };
    }
    storage.removeItem(WORKSPACE_CACHE_KEY);
  } catch {
    try { storage.removeItem(WORKSPACE_CACHE_KEY); } catch { /* best effort */ }
  }
  return EMPTY;
}

export function writeWorkspaceCache(
  userId: string | undefined,
  workspaces: CachedWorkspace[],
  activeId: string | null,
  options: { storage?: CacheStorage; now?: number } = {},
): boolean {
  if (!userId || !Array.isArray(workspaces) || workspaces.length === 0) return false;
  const storage = availableStorage(options.storage);
  if (!storage) return false;
  try {
    storage.setItem(WORKSPACE_CACHE_KEY, JSON.stringify({
      version: 1,
      userId,
      workspaces,
      activeId: activeId && workspaces.some(w => w.id === activeId) ? activeId : null,
      ts: options.now ?? Date.now(),
    }));
    return true;
  } catch { return false; }
}
