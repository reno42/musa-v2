/**
 * Non-secret user preferences that follow the account across devices.
 *
 * Stored in user_profiles.prefs (JSONB, v36) and merged shallowly by
 * PATCH /api/account/me — each top-level key replaces its previous value
 * wholesale, so saving { chatRoles } never clobbers { nanoBananaModel }.
 *
 * Secrets deliberately do NOT live here: API keys go through the encrypted
 * /api/keys store (see chatHistory.ts / keys.mjs).
 */

import { apiFetch } from "./supabase";

export type UserPrefs = Record<string, unknown>;

/** Read the account's prefs. Returns {} when signed out or not yet stored. */
export async function fetchUserPrefs(): Promise<UserPrefs> {
  try {
    const res = await apiFetch<{ data?: { prefs?: UserPrefs } }>("/account/me");
    const prefs = res?.data?.prefs;
    return prefs && typeof prefs === "object" && !Array.isArray(prefs) ? prefs : {};
  } catch {
    return {};
  }
}

/**
 * Merge keys into the account's prefs (shallow: whole values per key).
 * Fire-and-forget friendly but rejects on failure so callers can surface it.
 */
export async function saveUserPrefs(partial: UserPrefs): Promise<void> {
  const res = await apiFetch<{ success?: boolean; error?: string; detail?: string }>("/account/me", {
    method: "PATCH",
    body: JSON.stringify({ prefs: partial }),
  });
  if (res?.success === false) throw new Error(res.detail || res.error || "No se pudo guardar las preferencias");
}
