// packages/editor/src/lib/supabase.ts
// Frontend uses API-proxy mode: all Supabase operations go through /api/* endpoints.
// The API key (generated via Settings Panel) is stored in localStorage and sent
// with every request as X-API-Key header.

import { createClient, SupabaseClient } from "@supabase/supabase-js";

const STORED_KEY = "futuraria_api_key";

/** Get the stored API key from localStorage (set via Settings Panel). */
export function getStoredApiKey(): string | null {
  try {
    return localStorage.getItem(STORED_KEY);
  } catch {
    return null;
  }
}

/** Store API key in localStorage. Called after key creation in Settings Panel. */
export function setStoredApiKey(key: string): void {
  try {
    localStorage.setItem(STORED_KEY, key);
  } catch {
    // localStorage unavailable (SSR, private browsing)
  }
}

/** Clear stored API key. */
export function clearStoredApiKey(): void {
  try {
    localStorage.removeItem(STORED_KEY);
  } catch {
    // localStorage unavailable
  }
}

/** Always returns null - offline mode. Frontend never talks to Supabase directly. */
export function getSupabase(): SupabaseClient | null {
  return null;
}

export { getSupabase as getSupabaseClient };

/** API fetch wrapper — includes stored API key if available. */
export async function apiFetch<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const apiKey = getStoredApiKey();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}
