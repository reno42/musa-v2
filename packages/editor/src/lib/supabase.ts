const API_BASE = "http://localhost:3001";

export async function apiFetch<T = any>(url: string, options?: RequestInit): Promise<T> {
  const fullUrl = url.startsWith("http") ? url : `${API_BASE}${url}`;
  const res = await fetch(fullUrl, {
    headers: { "Content-Type": "application/json", "x-api-key": "dev-key" },
    ...options,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}
