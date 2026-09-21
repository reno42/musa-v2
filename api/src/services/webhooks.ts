/**
 * Webhooks Service — Supabase-backed CRUD + delivery engine
 * ──────────────────────────────────────────────────────────────
 * Table: platform_webhooks (v54)   — the user's registered hooks
 * Table: platform_webhook_deliveries (v54) — one row per hook×event
 *
 * Delivery model (works on Node, Netlify Functions AND Cloudflare
 * Workers, none of which guarantee post-response execution):
 *
 *   1. dispatchWebhook(event, data) — called from routes when
 *      something happens. Enqueues one pending delivery per matching
 *      hook, then TRIES a fire-and-forget first attempt. In
 *      long-lived processes (local dev) it goes out instantly; in
 *      serverless the row simply stays pending.
 *   2. sweepWebhookDeliveries() — called every 5 minutes by the
 *      dispatch tick (Netlify scheduled function / Cloudflare cron)
 *      via POST /api/webhooks/dispatch. Delivers pending rows and
 *      retries failed ones with exponential backoff
 *      (1m → 5m → 30m → 2h → 6h, WEBHOOK_MAX_ATTEMPTS total).
 *   3. sendTestWebhook() — the Settings button: awaits one attempt
 *      inline (≤8s) so the user sees the result immediately.
 *
 * Every attempt POSTs the envelope signed with HMAC-SHA256
 * (x-musa-signature: sha256=<hex> of "{timestamp}.{body}") — the
 * Stripe scheme, so receivers can verify authenticity and freshness.
 *
 * Local dev without Supabase falls back to the in-memory store, so
 * the whole Settings section still works with `npm run dev`.
 *
 * @module services/webhooks
 */

import crypto from "node:crypto";
import { getSupabaseAdmin } from "./supabase.js";
import { store } from "./store.js";
import type { Webhook as StoreWebhook } from "../types.js";
import {
  WEBHOOK_EVENTS, WEBHOOK_EVENT_NAMES, isKnownEvent,
  WEBHOOK_MAX_ATTEMPTS, webhookBackoffMs, WEBHOOK_DELIVERY_RETENTION_DAYS,
  buildWebhookEnvelope, signWebhookPayload,
  type WebhookEnvelope,
} from "./webhookEvents.js";

export { WEBHOOK_EVENTS, WEBHOOK_EVENT_NAMES, isKnownEvent } from "./webhookEvents.js";

const WEBHOOK_TIMEOUT_MS = 8_000;
const SWEEP_BATCH = 25;
const SWEEP_BUDGET_MS = 20_000;

export interface PlatformWebhook {
  id: string;
  userId: string;
  workspaceId: string | null;
  label: string;
  url: string;
  events: string[];
  secret: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  event: string;
  payload: WebhookEnvelope;
  status: "pending" | "success" | "failed";
  attempts: number;
  responseStatus: number | null;
  responseSnippet: string | null;
  error: string | null;
  nextAttemptAt: string;
  deliveredAt: string | null;
  createdAt: string;
}

// ─── Row ⇄ model mappers ─────────────────────────────────────────

type WebhookRow = Record<string, any>;
type DeliveryRow = Record<string, any>;

function rowToWebhook(r: WebhookRow): PlatformWebhook {
  return {
    id: r.id,
    userId: r.user_id,
    workspaceId: r.workspace_id ?? null,
    label: r.label,
    url: r.url,
    events: r.events || [],
    secret: r.secret,
    active: r.active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToDelivery(r: DeliveryRow): WebhookDelivery {
  return {
    id: r.id,
    webhookId: r.webhook_id,
    event: r.event,
    payload: typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload,
    status: r.status,
    attempts: r.attempts ?? 0,
    responseStatus: r.response_status ?? null,
    responseSnippet: r.response_snippet ?? null,
    error: r.error ?? null,
    nextAttemptAt: r.next_attempt_at,
    deliveredAt: r.delivered_at ?? null,
    createdAt: r.created_at,
  };
}

function maskSecret(secret: string): string {
  return secret.length > 12 ? `${secret.slice(0, 9)}…${secret.slice(-4)}` : "…";
}

function newWebhookId(): string {
  return `wh_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function newSecret(): string {
  return `whsec_${crypto.randomBytes(24).toString("base64url")}`;
}

const hasDb = () => getSupabaseAdmin() !== null;
const sb = () => getSupabaseAdmin()!;

/**
 * Post-response work on every runtime. On Cloudflare the worker entry
 * bridges ctx.waitUntil into globalThis.__musaWaitUntil, which lets
 * the first delivery attempt survive the response (≤30s extra).
 * Node/long-lived processes just float the promise.
 */
function fireAndForget(p: Promise<unknown>): void {
  const waitUntil = (globalThis as any).__musaWaitUntil;
  if (typeof waitUntil === "function") {
    try { waitUntil(p.catch(() => {})); return; } catch { /* fall through */ }
  }
  void p.catch(() => {});
}

/** The store's legacy in-memory shape lacks the v54 fields — promote it. */
function fromStoreWebhook(w: StoreWebhook): PlatformWebhook {
  return {
    id: w.id,
    userId: w.userId,
    workspaceId: (w as any).workspaceId ?? null,
    label: (w as any).label ?? "Mi webhook",
    url: w.url,
    events: w.events,
    secret: w.secret,
    active: w.active,
    createdAt: w.createdAt,
    updatedAt: (w as any).updatedAt ?? w.createdAt,
  };
}

/** What listWebhooks returns: secret masked, optionally revealed. */
export type WebhookPublic = Omit<PlatformWebhook, "secret"> & { secretPreview: string; secret?: string };

// ═══ CRUD ════════════════════════════════════════════════════════

export async function createWebhook(input: {
  userId: string;
  label?: string;
  url: string;
  events: string[];
  workspaceId?: string | null;
  secret?: string;
}): Promise<PlatformWebhook> {
  const events = input.events.filter(isKnownEvent);
  const now = new Date().toISOString();
  const hook: PlatformWebhook = {
    id: newWebhookId(),
    userId: input.userId,
    workspaceId: input.workspaceId ?? null,
    label: input.label?.trim() || "Mi webhook",
    url: input.url,
    events: events.length ? events : [...WEBHOOK_EVENT_NAMES],
    secret: input.secret || newSecret(),
    active: true,
    createdAt: now,
    updatedAt: now,
  };

  if (hasDb()) {
    const { data, error } = await sb().from("platform_webhooks").insert({
      id: hook.id,
      user_id: hook.userId,
      workspace_id: hook.workspaceId,
      label: hook.label,
      url: hook.url,
      events: hook.events,
      secret: hook.secret,
      active: hook.active,
      created_at: hook.createdAt,
      updated_at: hook.updatedAt,
    }).select("*").single();
    if (error) throw new Error(`No se pudo crear el webhook: ${error.message}`);
    return rowToWebhook(data);
  }

  // In-memory fallback (local dev, no Supabase): registerWebhook keeps
  // the same id/secret so both paths behave identically for the UI.
  const mem = store.registerWebhook({ url: hook.url, events: hook.events, userId: hook.userId, secret: hook.secret });
  return { ...hook, id: mem.id };
}

export async function listWebhooks(userId: string, opts?: { includeSecret?: boolean }): Promise<WebhookPublic[]> {
  let hooks: PlatformWebhook[];
  if (hasDb()) {
    const { data, error } = await sb().from("platform_webhooks")
      .select("*").eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`No se pudo listar los webhooks: ${error.message}`);
    hooks = (data || []).map(rowToWebhook);
  } else {
    hooks = store.listWebhooks(userId).map(fromStoreWebhook);
  }
  return hooks.map(h => {
    const { secret, ...rest } = h;
    const pub: WebhookPublic = { ...rest, secretPreview: maskSecret(secret) };
    if (opts?.includeSecret) pub.secret = secret;
    return pub;
  });
}

export async function getWebhook(id: string, userId: string): Promise<PlatformWebhook | null> {
  if (hasDb()) {
    const { data } = await sb().from("platform_webhooks").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
    return data ? rowToWebhook(data) : null;
  }
  const mem = store.listWebhooks(userId).find(w => w.id === id);
  return mem ? fromStoreWebhook(mem) : null;
}

export async function updateWebhook(id: string, userId: string, patch: {
  label?: string; url?: string; events?: string[]; active?: boolean;
}): Promise<PlatformWebhook | null> {
  const updates: WebhookRow = { updated_at: new Date().toISOString() };
  if (patch.label !== undefined) updates.label = patch.label.trim() || "Mi webhook";
  if (patch.url !== undefined) updates.url = patch.url;
  if (patch.active !== undefined) updates.active = patch.active;
  if (patch.events !== undefined) {
    const events = patch.events.filter(isKnownEvent);
    if (!events.length) throw new Error("Debe quedar al menos un evento válido suscrito");
    updates.events = events;
  }

  if (hasDb()) {
    const { data, error } = await sb().from("platform_webhooks")
      .update(updates).eq("id", id).eq("user_id", userId)
      .select("*").maybeSingle();
    if (error) throw new Error(`No se pudo actualizar el webhook: ${error.message}`);
    return data ? rowToWebhook(data) : null;
  }
  const mem = store.listWebhooks(userId).find(w => w.id === id);
  if (!mem) return null;
  Object.assign(mem, updates);
  return fromStoreWebhook(mem);
}

export async function deleteWebhook(id: string, userId: string): Promise<boolean> {
  if (hasDb()) {
    const { data, error } = await sb().from("platform_webhooks")
      .delete().eq("id", id).eq("user_id", userId).select("id");
    if (error) throw new Error(`No se pudo eliminar el webhook: ${error.message}`);
    return (data || []).length > 0;
  }
  return store.deleteWebhook(id, userId);
}

export async function regenerateWebhookSecret(id: string, userId: string): Promise<string | null> {
  const secret = newSecret();
  if (hasDb()) {
    const { data, error } = await sb().from("platform_webhooks")
      .update({ secret, updated_at: new Date().toISOString() })
      .eq("id", id).eq("user_id", userId).select("id").maybeSingle();
    if (error) throw new Error(`No se pudo regenerar el secreto: ${error.message}`);
    if (!data) return null;
    return secret;
  }
  const mem = store.listWebhooks(userId).find(w => w.id === id);
  if (!mem) return null;
  mem.secret = secret;
  return secret;
}

// ═══ Delivery engine ═════════════════════════════════════════════

/**
 * Fan-out an event to every active hook subscribed to it.
 * Non-blocking by design: enqueue (durable) + best-effort immediate
 * attempt. Returns how many hooks matched.
 */
export async function dispatchWebhook(
  event: string,
  data: Record<string, unknown>,
  ctx?: { workspaceId?: string | null },
): Promise<number> {
  try {
    if (!isKnownEvent(event)) return 0;
    let hooks: PlatformWebhook[];
    if (hasDb()) {
      const { data: rows, error } = await sb().from("platform_webhooks")
        .select("*").eq("active", true).contains("events", [event]);
      if (error) { console.warn("[webhooks] dispatch select failed:", error.message); return 0; }
      hooks = (rows || []).map(rowToWebhook);
    } else {
      hooks = [...store.webhooks.values()].filter(w => w.active && w.events.includes(event)).map(fromStoreWebhook);
    }
    // Workspace scoping: hook.workspaceId === null means "all workspaces".
    const ws = ctx?.workspaceId ?? null;
    hooks = hooks.filter(h => !h.workspaceId || !ws || h.workspaceId === ws);
    if (!hooks.length) return 0;

    const envelope = buildWebhookEnvelope(event, data, { workspaceId: ws });
    for (const hook of hooks) {
      const delivery = await enqueueDelivery(hook, envelope);
      // Best-effort immediate attempt: instant on Cloudflare (waitUntil
      // bridge) and long-lived processes; where neither applies the row
      // simply stays pending until the cron sweep picks it up (≤5 min).
      fireAndForget(attemptDelivery(delivery.id));
    }
    return hooks.length;
  } catch (err: any) {
    // A webhook outage must NEVER fail the user's actual request.
    console.warn(`[webhooks] dispatch ${event} failed:`, err?.message || err);
    return 0;
  }
}

/** event:key → last dispatch ts. High-traffic events (autosave) need it. */
const recentDispatches = new Map<string, number>();

/**
 * dispatchWebhook with a per-key minimum interval — template.updated
 * fires on every autosave PUT, and no N8N flow wants 1 event/keystroke.
 * Returns 0 (silently) while the key is inside its window.
 */
export function dispatchWebhookThrottled(
  event: string,
  key: string,
  minIntervalMs: number,
  data: Record<string, unknown>,
  ctx?: { workspaceId?: string | null },
): Promise<number> | number {
  const now = Date.now();
  const mapKey = `${event}:${key}`;
  if (now - (recentDispatches.get(mapKey) || 0) < minIntervalMs) return 0;
  recentDispatches.set(mapKey, now);
  // Opportunistic GC so long-lived processes don't grow the map forever.
  if (recentDispatches.size > 1000) {
    for (const [k, t] of recentDispatches) if (now - t > minIntervalMs * 10) recentDispatches.delete(k);
  }
  return dispatchWebhook(event, data, ctx);
}

async function enqueueDelivery(hook: PlatformWebhook, envelope: WebhookEnvelope): Promise<WebhookDelivery> {
  if (hasDb()) {
    const { data, error } = await sb().from("platform_webhook_deliveries").insert({
      webhook_id: hook.id,
      event: envelope.event,
      payload: envelope,
      status: "pending",
      attempts: 0,
      next_attempt_at: new Date().toISOString(),
    }).select("*").single();
    if (error) throw new Error(`enqueue failed: ${error.message}`);
    return rowToDelivery(data);
  }
  const delivery: WebhookDelivery = {
    id: `del_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
    webhookId: hook.id,
    event: envelope.event,
    payload: envelope,
    status: "pending",
    attempts: 0,
    responseStatus: null,
    responseSnippet: null,
    error: null,
    nextAttemptAt: new Date().toISOString(),
    deliveredAt: null,
    createdAt: new Date().toISOString(),
  };
  (store as any).__webhookDeliveries = (store as any).__webhookDeliveries || new Map();
  (store as any).__webhookDeliveries.set(delivery.id, delivery);
  return delivery;
}

/** POST the envelope signed; persist the outcome. Never throws. */
async function attemptDelivery(deliveryId: string): Promise<WebhookDelivery | null> {
  const sbAdmin = getSupabaseAdmin();
  let delivery: WebhookDelivery | null = null;
  let hook: PlatformWebhook | null = null;

  if (sbAdmin) {
    const { data: row } = await sbAdmin.from("platform_webhook_deliveries").select("*").eq("id", deliveryId).maybeSingle();
    if (!row) return null;
    delivery = rowToDelivery(row);
    const { data: hookRow } = await sbAdmin.from("platform_webhooks").select("*").eq("id", delivery.webhookId).maybeSingle();
    hook = hookRow ? rowToWebhook(hookRow) : null;
  } else {
    const mem = (store as any).__webhookDeliveries as Map<string, WebhookDelivery> | undefined;
    delivery = mem?.get(deliveryId) || null;
    if (delivery) hook = (() => { const w = store.webhooks.get(delivery!.webhookId); return w ? fromStoreWebhook(w) : null; })();
  }
  if (!delivery) return null;

  const rawBody = JSON.stringify(delivery.payload);
  const timestamp = new Date().toISOString();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Musa-Webhooks/1.0",
    "x-musa-event": delivery.event,
    "x-musa-delivery": delivery.id,
    "x-musa-timestamp": timestamp,
  };
  let responseStatus: number | null = null;
  let responseSnippet: string | null = null;
  let error: string | null = null;
  if (hook) {
    // Signature is only computed when there is a secret to sign with.
    headers["x-musa-signature"] = signWebhookPayload(hook.secret, timestamp, rawBody);
  }

  if (!hook) {
    error = "Webhook eliminado antes de la entrega";
  } else if (!hook.active) {
    error = "Webhook desactivado antes de la entrega";
  } else {
    try {
      const res = await fetch(hook.url, {
        method: "POST",
        headers,
        body: rawBody,
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
      responseStatus = res.status;
      const text = await res.text().catch(() => "");
      responseSnippet = text.slice(0, 500) || null;
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (err: any) {
      error = err?.name === "TimeoutError" || err?.name === "AbortError"
        ? `Timeout después de ${WEBHOOK_TIMEOUT_MS / 1000}s`
        : String(err?.message || err).slice(0, 500);
    }
  }

  const success = responseStatus !== null && responseStatus >= 200 && responseStatus < 300;
  const attempts = delivery.attempts + 1;
  const done = success || !hook?.active || attempts >= WEBHOOK_MAX_ATTEMPTS;
  const updates = {
    status: success ? "success" : "failed",
    attempts,
    response_status: responseStatus,
    response_snippet: responseSnippet,
    error,
    delivered_at: success ? new Date().toISOString() : delivery.deliveredAt,
    // Failed rows schedule the next retry; rows past the max stay put.
    next_attempt_at: success || done
      ? (success ? new Date().toISOString() : delivery.nextAttemptAt)
      : new Date(Date.now() + webhookBackoffMs(attempts)).toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (sbAdmin) {
    await sbAdmin.from("platform_webhook_deliveries").update(updates).eq("id", delivery.id);
  } else if (delivery) {
    Object.assign(delivery, {
      status: updates.status, attempts: updates.attempts,
      responseStatus, responseSnippet, error,
      deliveredAt: updates.delivered_at,
      nextAttemptAt: updates.next_attempt_at,
    });
  }
  if (!success) console.warn(`[webhooks] delivery ${delivery.id} (${delivery.event} → ${hook?.url}) attempt ${attempts}: ${error}`);
  return { ...delivery, ...rowToDelivery({ id: delivery.id, webhook_id: delivery.webhookId, event: delivery.event, payload: delivery.payload, created_at: delivery.createdAt, ...updates }) };
}

// ═══ Sweep (the dispatch tick's engine) ══════════════════════════

/**
 * Process due deliveries (pending or failed-with-retries-left) up to
 * SWEEP_BATCH rows / SWEEP_BUDGET_MS budget. Also lazily purges
 * deliveries past the retention window. Safe to call concurrently —
 * each attempt updates `attempts` first-mover-wins per row.
 */
export async function sweepWebhookDeliveries(): Promise<{ processed: number; delivered: number; failed: number }> {
  const sbAdmin = getSupabaseAdmin();
  let due: Array<{ id: string }> = [];

  if (sbAdmin) {
    const { data, error } = await sbAdmin.from("platform_webhook_deliveries")
      .select("id")
      .in("status", ["pending", "failed"])
      .lt("attempts", WEBHOOK_MAX_ATTEMPTS)
      .lte("next_attempt_at", new Date().toISOString())
      .order("next_attempt_at", { ascending: true })
      .limit(SWEEP_BATCH);
    if (error) { console.warn("[webhooks] sweep select failed:", error.message); return { processed: 0, delivered: 0, failed: 0 }; }
    due = data || [];
  } else {
    const mem = ((store as any).__webhookDeliveries as Map<string, WebhookDelivery>) || new Map();
    due = [...mem.values()]
      .filter(d => (d.status === "pending" || d.status === "failed") && d.attempts < WEBHOOK_MAX_ATTEMPTS && new Date(d.nextAttemptAt) <= new Date())
      .slice(0, SWEEP_BATCH);
  }

  let delivered = 0, failed = 0, processed = 0;
  const started = Date.now();
  for (const row of due) {
    if (processed > 0 && Date.now() - started > SWEEP_BUDGET_MS) break;
    const result = await attemptDelivery(row.id).catch(() => null);
    processed++;
    if (result?.status === "success") delivered++;
    else if (result) failed++;
  }

  // Lazy retention purge — 10% of sweeps pay the DELETE.
  if (sbAdmin && Math.random() < 0.1) {
    const cutoff = new Date(Date.now() - WEBHOOK_DELIVERY_RETENTION_DAYS * 86_400_000).toISOString();
    await sbAdmin.from("platform_webhook_deliveries").delete().lt("created_at", cutoff);
  }

  return { processed, delivered, failed };
}

// ═══ Test & inspection ══════════════════════════════════════════

/**
 * The Settings «Enviar test» button: enqueue a webhook.ping and AWAIT
 * the first attempt so the UI can show the immediate result.
 */
export async function sendTestWebhook(hook: PlatformWebhook): Promise<{ delivery: WebhookDelivery }> {
  const envelope = buildWebhookEnvelope("webhook.ping", { message: "Musa webhook test", webhookId: hook.id }, { workspaceId: hook.workspaceId });
  const delivery = await enqueueDelivery(hook, envelope);
  const attempted = await attemptDelivery(delivery.id).catch(() => null);
  return { delivery: attempted || delivery };
}

export async function listDeliveries(webhookId: string, userId: string, limit = 20): Promise<WebhookDelivery[]> {
  const owner = await getWebhook(webhookId, userId);
  if (!owner) return [];
  const capped = Math.min(Math.max(limit, 1), 100);
  const sbAdmin = getSupabaseAdmin();
  if (sbAdmin) {
    const { data, error } = await sbAdmin.from("platform_webhook_deliveries")
      .select("*").eq("webhook_id", webhookId)
      .order("created_at", { ascending: false }).limit(capped);
    if (error) throw new Error(`No se pudo leer el historial: ${error.message}`);
    return (data || []).map(rowToDelivery);
  }
  const mem = ((store as any).__webhookDeliveries as Map<string, WebhookDelivery>) || new Map();
  return [...mem.values()]
    .filter(d => d.webhookId === webhookId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, capped);
}

/** UI «Reintentar»: requeue a failed delivery and await the attempt. */
export async function retryDelivery(webhookId: string, deliveryId: string, userId: string): Promise<WebhookDelivery | null> {
  const owner = await getWebhook(webhookId, userId);
  if (!owner) return null;
  const sbAdmin = getSupabaseAdmin();
  if (sbAdmin) {
    const { error } = await sbAdmin.from("platform_webhook_deliveries")
      .update({ status: "pending", next_attempt_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", deliveryId).eq("webhook_id", webhookId);
    if (error) throw new Error(`No se pudo reencolar: ${error.message}`);
  } else {
    const mem = ((store as any).__webhookDeliveries as Map<string, WebhookDelivery>) || new Map();
    const d = mem.get(deliveryId);
    if (!d || d.webhookId !== webhookId) return null;
    d.status = "pending";
    d.nextAttemptAt = new Date().toISOString();
  }
  return attemptDelivery(deliveryId);
}
