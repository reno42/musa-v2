/**
 * The agent's transcript, synced to the account rather than the browser.
 *
 * It lived in localStorage alone, which is per-browser-profile — so the same
 * account on a phone, a second browser, or after clearing site data met an
 * agent with no memory of anything said before. The storage was per device
 * and the agent is per person.
 *
 * localStorage is still written, as an offline cache: the conversation renders
 * instantly on load and survives a signed-out or disconnected session. The
 * server is the source of truth whenever it answers.
 */

import { apiFetch } from "./supabase";

export interface StoredMessage {
  role: string;
  content: string;
  ts?: number;
  meta?: Record<string, unknown>;
}

/** Server rows carry meta separately; the UI wants one flat object. */
function fromRow(row: any): StoredMessage {
  return {
    role: String(row.role || "assistant"),
    content: String(row.content ?? ""),
    ts: Number(row.ts) || undefined,
    ...(row.meta && typeof row.meta === "object" ? row.meta : {}),
  };
}

/**
 * Reads the conversation for the signed-in user.
 *
 * Returns null — not an empty array — when the server could not answer, so the
 * caller can tell "you have no messages" from "we could not ask", and keep
 * showing the local copy instead of blanking a real conversation.
 */
export async function fetchRemoteHistory(limit = 200): Promise<StoredMessage[] | null> {
  try {
    const res = await apiFetch<{ success?: boolean; data?: any[] }>(
      `/api/chat/messages?limit=${limit}`,
    );
    if (!res?.success || !Array.isArray(res.data)) return null;
    return res.data.map(fromRow);
  } catch {
    return null;
  }
}

/**
 * Appends turns to the account's history.
 *
 * Fire-and-forget on purpose: a chat that will not answer because its history
 * write failed is worse than a history with a gap. Failures are logged, not
 * surfaced.
 */
export async function appendRemoteHistory(
  messages: StoredMessage[],
  workspaceId?: string | null,
): Promise<void> {
  if (!messages.length) return;
  try {
    await apiFetch("/api/chat/messages", {
      method: "POST",
      body: JSON.stringify({
        workspaceId: workspaceId || null,
        messages: messages.map(({ role, content, ts, ...meta }) => ({
          role, content, ts: ts || Date.now(), meta,
        })),
      }),
    });
  } catch (err) {
    console.warn("[chat] no se pudo guardar el historial:", err);
  }
}

export async function clearRemoteHistory(): Promise<void> {
  try {
    await apiFetch("/api/chat/messages", { method: "DELETE" });
  } catch (err) {
    console.warn("[chat] no se pudo limpiar el historial:", err);
  }
}

/** Which model the user picked, so that follows them across devices too. */
export async function fetchRemotePreferences<T = unknown>(): Promise<T | null> {
  try {
    const res = await apiFetch<{ success?: boolean; data?: T }>("/api/chat/preferences");
    return res?.success ? (res.data ?? null) : null;
  } catch {
    return null;
  }
}

export async function saveRemotePreferences(roleConfig: unknown): Promise<void> {
  try {
    await apiFetch("/api/chat/preferences", {
      method: "PUT",
      body: JSON.stringify({ roleConfig }),
    });
  } catch (err) {
    console.warn("[chat] no se pudo guardar la preferencia de modelo:", err);
  }
}
