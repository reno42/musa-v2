import { getApiHeaders, getApiKey } from "./apiKey";

const API_BASE = "";

export async function apiFetch<T = any>(url: string, options?: RequestInit): Promise<T> {
  const fullUrl = url.startsWith("http") ? url : `${API_BASE}${url}`;
  const headers = new Headers(getApiHeaders());
  new Headers(options?.headers).forEach((value, key) => headers.set(key, value));
  const res = await fetch(fullUrl, {
    ...options,
    headers,
  });
  if (!res.ok) throw new Error(await failureMessage(res));
  return res.json();
}

/**
 * The API answers every failure with { success: false, error } — and this used
 * to throw away the error and report the bare status. "API error: 500" is the
 * same sentence whether a column is missing, a key expired, or a workspace is
 * out of reach, so every report had to be diagnosed from scratch instead of
 * just read. The status stays on the front as a prefix; the reason follows.
 */
async function failureMessage(res: Response): Promise<string> {
  // Gateway failures (Netlify 502/503/504) answer with an HTML page and no
  // JSON detail — the old bare "API error: 502" was impossible to trace
  // after the fact. The x-nf-request-id header is the only key that finds
  // the exact invocation in the Netlify Functions log, so keep it visible.
  const nfId = res.headers?.get?.("x-nf-request-id");
  const status = `API error: ${res.status}${nfId ? ` (nf:${nfId})` : ""}`;
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
