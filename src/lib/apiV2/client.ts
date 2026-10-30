// apiV2/client.ts — base del carril datos (REQ-070).
// Reenvía TODO por apiFetch (auth + retries + timeouts ya resueltos ahí).
// Las vistas del shell-v2 NUNCA hacen fetch propio: importan de los módulos apiV2.
import { apiFetch } from "../supabase";

export async function getData<T>(url: string): Promise<T> {
  return apiFetch<T>(url);
}

export async function postData<T>(url: string, body: unknown): Promise<T> {
  return apiFetch<T>(url, { method: "POST", body: JSON.stringify(body) });
}

export async function putData<T>(url: string, body: unknown): Promise<T> {
  return apiFetch<T>(url, { method: "PUT", body: JSON.stringify(body) });
}

export async function patchData<T>(url: string, body: unknown): Promise<T> {
  return apiFetch<T>(url, { method: "PATCH", body: JSON.stringify(body) });
}

export async function deleteData<T>(url: string): Promise<T> {
  return apiFetch<T>(url, { method: "DELETE" });
}
