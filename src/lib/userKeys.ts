/**
 * Client-side API for server-side BYOK key management.
 *
 * Keys are NEVER stored in localStorage — they go through the encrypted
 * /api/keys endpoint. The browser only ever knows whether a key is
 * configured and which model is selected.
 */

import { getApiHeaders } from "./apiKey";

export type KeyConfig = {
  configured: boolean;
  model: string | null;
};

export type KeyStatusMap = Record<string, KeyConfig>;

/**
 * Fetch all configured provider keys for the current user.
 * Returns a map: { [provider]: { configured, model } }.
 * Never includes the actual key value.
 */
export async function fetchKeyStatuses(): Promise<KeyStatusMap> {
  const res = await fetch("/api/keys", {
    headers: getApiHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch key statuses (${res.status})`);
  }
  return res.json();
}

/**
 * Save (encrypt + store) a provider key with an optional model.
 */
export async function saveProviderKey(
  provider: string,
  key: string,
  model?: string | null,
): Promise<void> {
  const res = await fetch(`/api/keys/${encodeURIComponent(provider)}`, {
    method: "PUT",
    headers: getApiHeaders(),
    body: JSON.stringify({ key, model: model || null }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to save key (${res.status})`);
  }
}

/**
 * Remove a provider key.
 */
export async function deleteProviderKey(provider: string): Promise<void> {
  const res = await fetch(`/api/keys/${encodeURIComponent(provider)}`, {
    method: "DELETE",
    headers: getApiHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Failed to delete key (${res.status})`);
  }
}
