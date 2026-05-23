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
