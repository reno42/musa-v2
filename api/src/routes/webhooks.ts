/**
 * Webhooks Routes
 * ──────────────────────────────────────────────────────────────
 * Management of webhook registrations. Webhooks are triggered
 * by internal events (template.created, render.complete, etc.)
 * and dispatched by the webhooks service via HMAC-SHA256.
 *
 * @module routes/webhooks
 *
 * Database (Supabase: webhooks table):
 *   - id TEXT PK           → hook identifier
 *   - url TEXT             → destination URL
 *   - events TEXT[]        → subscribed event names
 *   - secret TEXT          → HMAC signing secret (auto-generated)
 *   - user_id UUID         → owner (FK → auth.users)
 *   - active BOOLEAN       → toggle without deleting
 *   - created_at TIMESTAMPTZ
 *
 * Events dispatched (see services/webhooks.ts):
 *   template.created | template.updated | render.complete |
 *   render.failed | version.created | comment.created |
 *   layer.updated | style.created | component.created
 */

import { Router } from "express";
import { registerWebhook, listWebhooks, deleteWebhook } from "../services/webhooks.js";
import { validate, webhookSchema } from "../middleware/index.js";

export const webhookRoutes = Router();

webhookRoutes.use((req, res, next) => {
  if (req.auth?.authType === "workspace_key") {
    return res.status(403).json({ success: false, error: "Workspace API keys cannot access account-level webhooks" });
  }
  next();
});

/**
 * POST /api/webhooks
 * ──────────────────────────────────────────────────────────────
 * Register a new webhook. Returns the auto-generated signing
 * secret in the initial response only.
 *
 * @body {string}   url              Destination URL
 * @body {string[]} events           Event names to subscribe to
 * @body {string}   [secret]         Custom secret (auto-generated if omitted)
 *
 * @returns {201} { success, data: { id, url, events, secret } }
 *
 * DB: INSERT INTO webhooks
 */
webhookRoutes.post("/", validate(webhookSchema), async (req, res) => {
  try {
    const { url, events, secret } = req.body;
    const hook = await registerWebhook(url, events, req.auth!.userId, secret);
    res.status(201).json({ success: true, data: hook });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/webhooks
 * ──────────────────────────────────────────────────────────────
 * List all webhooks for the authenticated user.
 *
 * @returns {200} { success, data: Webhook[] }
 *
 * DB: SELECT * FROM webhooks WHERE user_id = :userId
 */
webhookRoutes.get("/", async (req, res) => {
  try {
    const hooks = await listWebhooks(req.auth!.userId);
    res.json({ success: true, data: hooks });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/webhooks/:id
 * ──────────────────────────────────────────────────────────────
 * Remove a webhook registration.
 *
 * @param {string} id  Webhook ID
 *
 * DB: DELETE FROM webhooks WHERE id = :id
 */
webhookRoutes.delete("/:id", async (req, res) => {
  try {
    await deleteWebhook(req.params.id, req.auth!.userId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
