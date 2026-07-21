const STORAGE_KEY = "futuraria-api-key";

/** Read the user's API key from localStorage. Returns empty string if not configured. */
export function getApiKey(): string {
  try { return localStorage.getItem(STORAGE_KEY) || ""; } catch { return ""; }
}

/** Save the user's API key to localStorage. */
export function setApiKey(key: string): void {
  try { localStorage.setItem(STORAGE_KEY, key); } catch {}
}

/** Remove the user's API key from localStorage. */
export function clearApiKey(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

/** Returns true if the user has configured an API key. */
export function hasApiKey(): boolean {
  return getApiKey().length > 0;
}

/** Build fetch headers including the API key from localStorage (if configured). */
export function getApiHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json; charset=utf-8" };
  const key = getApiKey();
  if (key) headers["x-api-key"] = key;
  if (extra) Object.assign(headers, extra);
  return headers;
}
