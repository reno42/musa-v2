import { store } from "./store.js";
import type { Webhook } from "../types.js";

export async function registerWebhook(
  url: string, events: string[], userId: string, secret?: string
): Promise<Webhook> {
  return store.registerWebhook({ url, events, userId, secret });
}

export async function listWebhooks(userId: string): Promise<Webhook[]> {
  return store.listWebhooks(userId);
}

export async function deleteWebhook(id: string, userId: string): Promise<boolean> {
  return store.deleteWebhook(id, userId);
}

export async function dispatchWebhook(event: string, payload: any) {
  const hooks = [...store.webhooks.values()].filter(
    w => w.active && w.events.includes(event)
  );
  for (const hook of hooks) {
    try {
      await fetch(hook.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event, payload, timestamp: new Date().toISOString() }),
      });
    } catch (err) {
      console.warn(`[webhooks] Dispatch failed ${event} → ${hook.url}:`, err);
    }
  }
}
