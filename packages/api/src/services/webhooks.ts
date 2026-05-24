/**
 * Webhooks Service
 * ──────────────────────────────────────────────────────────────
 * Registration, listing, deletion, and dispatch of webhooks.
 * Fire-and-forget POST with HMAC-SHA256 signatures for
 * verification. Each webhook is dispatched in parallel with
 * a 10-second timeout.
 *
 * @module services/webhooks
 *
 * Database (Supabase: webhooks table):
 *   - id TEXT PK, url TEXT, events TEXT[], secret TEXT,
 *     user_id UUID, active BOOLEAN, created_at TIMESTAMPTZ
 *
 * Supported events:
 *   template.created | template.updated | render.complete |
 *   render.failed | version.created | comment.created |
 *   layer.updated | style.created | component.created
 *
 * Dispatch format:
 *   POST <url> { event, payload, timestamp }
 *   Headers: X-Futuraria-Event, X-Futuraria-Delivery,
 *            X-Futuraria-Signature=sha256=<hex>
 */

import { v4 as uuid } from "uuid";
import { getSupabase } from "./supabase";

interface WebhookEntry {
  id: string;
  url: string;
  events: string[];
  secret?: string;
  active: boolean;
  createdAt: string;
}

// In-memory fallback
const memoryStore = new Map<string, WebhookEntry>();

/**
 * Register a new webhook URL with event subscriptions.
 * Generates a unique ID and inserts in Supabase or in-memory.
 *
 * @param url       Destination endpoint
 * @param events    Subscribed event names (or '*' for all)
 * @param secret    Optional HMAC signing secret
 * @param userId    Owner user ID (FK → auth.users)
 * @returns         WebhookEntry with generated id
 *
 * DB: INSERT INTO webhooks (id, url, events, secret, user_id, active)
 */
export async function registerWebhook(url: string, events: string[], secret?: string, userId?: string): Promise<WebhookEntry> {
  const entry: WebhookEntry = {
    id: `wh_${uuid().slice(0, 8)}`,
    url,
    events,
    secret,
    active: true,
    createdAt: new Date().toISOString(),
  };

  const db = getSupabase();
  if (db) {
    const row: any = {
      id: entry.id,
      url: entry.url,
      events: entry.events,
      secret: entry.secret,
      active: entry.active,
    };
    if (userId) row.user_id = userId;
    await db.from("webhooks").insert(row);
  } else {
    memoryStore.set(entry.id, entry);
  }

  return entry;
}

/**
 * List all active webhooks, optionally filtered by user.
 *
 * @param userId  Optional user filter
 * @returns       Active webhooks in creation order (newest first)
 *
 * DB: SELECT * FROM webhooks WHERE active = true [AND user_id = :uid]
 */
export async function listWebhooks(userId?: string): Promise<WebhookEntry[]> {
  const db = getSupabase();
  if (db) {
    let query = db.from("webhooks").select("*").eq("active", true).order("created_at", { ascending: false });
    if (userId) query = query.eq("user_id", userId);
    const { data } = await query;
    return (data || []).map((r: any) => ({
      id: r.id,
      url: r.url,
      events: r.events,
      secret: r.secret,
      active: r.active,
      createdAt: r.created_at,
    }));
  }
  return Array.from(memoryStore.values());
}

/**
 * Delete a webhook registration (hard delete).
 *
 * @param id      Webhook ID (wh_xxxxxxxx)
 * @param userId  Optional owner check
 * @returns       true if deleted
 *
 * DB: DELETE FROM webhooks WHERE id = :id [AND user_id = :uid]
 */
export async function deleteWebhook(id: string, userId?: string): Promise<boolean> {
  const db = getSupabase();
  if (db) {
    let query = db.from("webhooks").delete().eq("id", id);
    if (userId) query = query.eq("user_id", userId);
    const { error } = await query;
    return !error;
  }
  return memoryStore.delete(id);
}

/**
 * Fire all matching webhooks for an event (fire-and-forget).
 * Dispatches in parallel with 10s timeout per webhook.
 * Non-blocking: failures are logged but never thrown.
 *
 * @param event   Event name (e.g., 'render.complete')
 * @param payload Data to send in the webhook body
 *
 * @webhook headers:
 *   X-Futuraria-Event       → event name
 *   X-Futuraria-Delivery    → unique delivery ID (dlv_xxxxxxxx)
 *   X-Futuraria-Signature   → sha256=<hmac hex> (if secret set)
 *
 * @webhook body:
 *   { event: string, payload: any, timestamp: ISO8601 }
 *
 * External calls: fetch(POST) to each registered webhook URL
 */
export async function fireWebhooks(event: string, payload: any): Promise<void> {
  const allWebhooks = await listWebhooks();
  const matching = allWebhooks.filter((w) => w.events.includes(event) || w.events.includes("*"));

  for (const webhook of matching) {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Futuraria-Event": event,
        "X-Futuraria-Delivery": `dlv_${uuid().slice(0, 8)}`,
      };

      if (webhook.secret) {
        // HMAC-SHA256 signature
        const crypto = await import("crypto");
        const signature = crypto.createHmac("sha256", webhook.secret)
          .update(JSON.stringify(payload))
          .digest("hex");
        headers["X-Futuraria-Signature"] = `sha256=${signature}`;
      }

      const res = await fetch(webhook.url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          event,
          payload,
          timestamp: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        console.warn(`[WEBHOOK] ${webhook.url} responded ${res.status}`);
      }
    } catch (err: any) {
      console.error(`[WEBHOOK] Failed to reach ${webhook.url}:`, err.message);
    }
  }
}
