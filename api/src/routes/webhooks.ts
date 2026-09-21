/**
 * Webhooks Routes — user-managed outgoing webhooks
 * ──────────────────────────────────────────────────────────────
 * Every user can register hooks (URL + events + secret) and connect
 * Musa to N8N, Zapier, Make or anything that speaks HTTP. Deliveries
 * are POSTed as JSON envelopes signed with HMAC-SHA256
 * (x-musa-signature) and retried with backoff by the dispatch sweep.
 *
 * Account-level surface: workspace API keys (x-api-key, authType
 * "workspace_key") are rejected — a key belongs to one workspace,
 * hooks belong to the account.
 *
 * Database (Supabase, migration v54):
 *   platform_webhooks           → registrations (RLS: owner)
 *   platform_webhook_deliveries → delivery log (RLS: owner via join)
 *
 * @module routes/webhooks
 */

import { Router } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import {
  createWebhook, listWebhooks, getWebhook, updateWebhook, deleteWebhook,
  regenerateWebhookSecret, dispatchWebhook, sendTestWebhook,
  listDeliveries, retryDelivery, sweepWebhookDeliveries,
} from "../services/webhooks.js";
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_NAMES } from "../services/webhookEvents.js";

export const webhookRoutes = Router();

// Account-level: workspace keys cannot manage account webhooks.
webhookRoutes.use((req, res, next) => {
  if (req.auth?.authType === "workspace_key") {
    return res.status(403).json({ success: false, error: "Workspace API keys cannot access account-level webhooks" });
  }
  next();
});

const createSchema = z.object({
  label: z.string().min(1).max(80).optional(),
  url: z.string().url().refine(u => u.startsWith("http://") || u.startsWith("https://"), "La URL debe ser http(s)"),
  events: z.array(z.string()).min(1, "Suscribe al menos un evento"),
  workspaceId: z.string().max(64).nullish(),
  secret: z.string().min(16).max(200).optional(),
});

const updateSchema = z.object({
  label: z.string().min(1).max(80).optional(),
  url: z.string().url().optional(),
  events: z.array(z.string()).min(1).optional(),
  active: z.boolean().optional(),
});

/**
 * GET /api/webhooks — list the account's hooks.
 * @query {string} [includeSecret=1]  Reveal the signing secret (masked otherwise).
 */
webhookRoutes.get("/", async (req, res) => {
  try {
    const includeSecret = req.query.includeSecret === "1" || req.query.includeSecret === "true";
    const hooks = await listWebhooks(req.auth!.userId, { includeSecret });
    res.json({ success: true, data: hooks });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/webhooks/events — the event catalog (name/label/description/sample).
 * Powers the Settings UI and integration docs; the OpenAPI spec imports it too.
 */
webhookRoutes.get("/events", (_req, res) => {
  res.json({ success: true, data: WEBHOOK_EVENTS });
});

/**
 * POST /api/webhooks — register a hook. The signing secret comes back
 * once in full (also re-revealable via ?includeSecret=1).
 */
webhookRoutes.post("/", async (req, res) => {
  try {
    const parsed = createSchema.parse(req.body);
    const unknown = parsed.events.filter(e => !WEBHOOK_EVENT_NAMES.includes(e));
    if (unknown.length) {
      return res.status(400).json({ success: false, error: `Eventos desconocidos: ${unknown.join(", ")}. Válidos: ${WEBHOOK_EVENT_NAMES.join(", ")}` });
    }
    const hook = await createWebhook({
      userId: req.auth!.userId,
      label: parsed.label,
      url: parsed.url,
      events: parsed.events,
      workspaceId: parsed.workspaceId ?? null,
      secret: parsed.secret,
    });
    res.status(201).json({ success: true, data: hook });
  } catch (err: any) {
    res.status(err instanceof z.ZodError ? 400 : 500).json({ success: false, error: err.message });
  }
});

/** PATCH /api/webhooks/:id — update url/label/events/active. */
webhookRoutes.patch("/:id", async (req, res) => {
  try {
    const parsed = updateSchema.parse(req.body);
    const hook = await updateWebhook(req.params.id, req.auth!.userId, parsed);
    if (!hook) return res.status(404).json({ success: false, error: "Webhook no encontrado" });
    res.json({ success: true, data: hook });
  } catch (err: any) {
    res.status(err instanceof z.ZodError ? 400 : 500).json({ success: false, error: err.message });
  }
});

/** DELETE /api/webhooks/:id — remove the hook and its log (cascade). */
webhookRoutes.delete("/:id", async (req, res) => {
  try {
    const ok = await deleteWebhook(req.params.id, req.auth!.userId);
    if (!ok) return res.status(404).json({ success: false, error: "Webhook no encontrado" });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** POST /api/webhooks/:id/regenerate — rotate the signing secret. */
webhookRoutes.post("/:id/regenerate", async (req, res) => {
  try {
    const secret = await regenerateWebhookSecret(req.params.id, req.auth!.userId);
    if (!secret) return res.status(404).json({ success: false, error: "Webhook no encontrado" });
    res.json({ success: true, data: { secret } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/webhooks/:id/test — send a webhook.ping and wait for the
 * result (≤8s) so the UI can show status + response immediately.
 */
webhookRoutes.post("/:id/test", async (req, res) => {
  try {
    const hook = await getWebhook(req.params.id, req.auth!.userId);
    if (!hook) return res.status(404).json({ success: false, error: "Webhook no encontrado" });
    const { delivery } = await sendTestWebhook(hook);
    res.json({ success: true, data: delivery });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** GET /api/webhooks/:id/deliveries?limit=20 — recent delivery log. */
webhookRoutes.get("/:id/deliveries", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const deliveries = await listDeliveries(req.params.id, req.auth!.userId, limit);
    res.json({ success: true, data: deliveries });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** POST /api/webhooks/:id/deliveries/:deliveryId/retry — requeue + await attempt. */
webhookRoutes.post("/:id/deliveries/:deliveryId/retry", async (req, res) => {
  try {
    const delivery = await retryDelivery(req.params.id, req.params.deliveryId, req.auth!.userId);
    if (!delivery) return res.status(404).json({ success: false, error: "Entrega no encontrada" });
    res.json({ success: true, data: delivery });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/webhooks/dispatch — internal sweep endpoint.
 *
 * The Cloudflare cron trigger (wrangler.toml [triggers]) runs the
 * sweep IN-PROCESS via the worker's scheduled handler — it does not
 * go through this endpoint. This route remains for manual ops
 * (curl) and any external scheduler. Auth:
 * x-dispatch-secret === WEBHOOK_DISPATCH_SECRET
 * (constant-time). The global auth middleware lets this ONE path
 * through so ticks don't need a user session — the secret is the
 * credential. Returns what the sweep processed.
 */
webhookRoutes.post("/dispatch", (req, res) => {
  const expected = process.env.WEBHOOK_DISPATCH_SECRET;
  if (!expected) {
    return res.status(403).json({ success: false, error: "WEBHOOK_DISPATCH_SECRET no está configurado en este entorno" });
  }
  const provided = (req.headers["x-dispatch-secret"] as string) || "";
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ success: false, error: "x-dispatch-secret inválido" });
  }
  sweepWebhookDeliveries()
    .then(result => res.json({ success: true, data: result }))
    .catch((err: any) => res.status(500).json({ success: false, error: err?.message || "sweep failed" }));
});
