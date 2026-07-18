import { getApiHeaders, getApiKey } from "./apiKey";

const API_BASE = "";

export async function apiFetch<T = any>(url: string, options?: RequestInit): Promise<T> {
  const fullUrl = url.startsWith("http") ? url : `${API_BASE}${url}`;
  const res = await fetch(fullUrl, {
    headers: getApiHeaders(),
    ...options,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}
