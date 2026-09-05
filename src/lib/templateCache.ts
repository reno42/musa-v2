export const LEGACY_TEMPLATE_CACHE_KEY = "futuraria-tpl-cache-v1";
export const TEMPLATE_CACHE_PREFIX = "futuraria-tpl-cache-v2";
export const TEMPLATE_CACHE_TTL_MS = 30 * 60 * 1000;

type CacheStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type CacheableTemplate = { id: string; workspaceId: string };

function availableStorage(storage?: CacheStorage): CacheStorage | null {
  if (storage) return storage;
  return typeof localStorage === "undefined" ? null : localStorage;
}

export function templateCacheKey(userId: string, workspaceId: string): string {
  return `${TEMPLATE_CACHE_PREFIX}:${encodeURIComponent(userId)}:${encodeURIComponent(workspaceId)}`;
}

/** v1 had no owner/workspace identity, so displaying or migrating it is unsafe. */
export function clearLegacyTemplateCache(storage?: CacheStorage): void {
  try { availableStorage(storage)?.removeItem(LEGACY_TEMPLATE_CACHE_KEY); } catch { /* best effort */ }
}

export function readTemplateCache<T extends CacheableTemplate>(
  userId: string | undefined,
  workspaceId: string | undefined,
  options: { storage?: CacheStorage; now?: number; ttlMs?: number } = {},
): T[] {
  if (!userId || !workspaceId) return [];
  const storage = availableStorage(options.storage);
  if (!storage) return [];
  const key = templateCacheKey(userId, workspaceId);
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const now = options.now ?? Date.now();
    const ttlMs = options.ttlMs ?? TEMPLATE_CACHE_TTL_MS;
    const validTimestamp = Number.isFinite(parsed?.ts)
      && parsed.ts <= now + 60_000
      && now - parsed.ts <= ttlMs;
    const validScope = parsed?.version === 2
      && parsed?.userId === userId
      && parsed?.workspaceId === workspaceId;
    const validTemplates = Array.isArray(parsed?.data)
      && parsed.data.every((item: unknown) => {
        const template = item as Partial<CacheableTemplate> | null;
        return Boolean(template
          && typeof template.id === "string"
          && template.workspaceId === workspaceId);
      });
    if (validTimestamp && validScope && validTemplates) return parsed.data as T[];
    storage.removeItem(key);
  } catch {
    try { storage.removeItem(key); } catch { /* best effort */ }
  }
  return [];
}

export function writeTemplateCache<T extends CacheableTemplate>(
  userId: string | undefined,
  workspaceId: string | undefined,
  data: T[],
  options: { storage?: CacheStorage; now?: number } = {},
): boolean {
  if (!userId || !workspaceId || data.some(template => template.workspaceId !== workspaceId)) return false;
  const storage = availableStorage(options.storage);
  if (!storage) return false;
  try {
    storage.setItem(templateCacheKey(userId, workspaceId), JSON.stringify({
      version: 2,
      userId,
      workspaceId,
      data,
      ts: options.now ?? Date.now(),
    }));
    return true;
  } catch { return false; }
}
