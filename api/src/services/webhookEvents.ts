/**
 * Webhook Events Catalog & Delivery Math — PURE module
 * ──────────────────────────────────────────────────────────────
 * Zero imports: the QA suite (QA/api-webhooks.test.mjs) loads this
 * file directly under node --experimental-strip-types, and both the
 * webhooks service and the OpenAPI spec import the SAME catalog, so
 * the docs, the validation and the spec can never drift apart.
 *
 * Adding a new event = add one entry here + call dispatchWebhook()
 * where the event happens. The UI, the API validation and the docs
 * pick it up automatically.
 *
 * @module services/webhookEvents
 */

import crypto from "node:crypto";

export interface WebhookEventDef {
  /** Machine name sent as x-musa-event and in the envelope. */
  name: string;
  /** Human label for the Settings UI. */
  label: string;
  /** When it fires. */
  description: string;
  /** Shape of `data` inside the envelope (documentation only). */
  sample: Record<string, unknown>;
}

/**
 * The events the platform dispatches today. Keep names
 * `<resource>.<past_verb>` — N8N/Zapier/Make users filter on them.
 */
export const WEBHOOK_EVENTS: WebhookEventDef[] = [
  {
    name: "template.created",
    label: "Plantilla creada",
    description: "Se creó una plantilla nueva (editor, API o MCP).",
    sample: { id: "tpl_ab12cd34ef56", name: "Post IG — Lanzamiento", workspaceId: "ws_ab12cd34ef56", width: 1080, height: 1080, createdBy: "user-uuid" },
  },
  {
    name: "template.updated",
    label: "Plantilla actualizada",
    description: "Una plantilla cambió (guardado del editor, API o MCP). Se dispara con throttle: máximo 1 por minuto por plantilla.",
    sample: { id: "tpl_ab12cd34ef56", name: "Post IG — Lanzamiento", workspaceId: "ws_ab12cd34ef56", updatedAt: "2026-09-21T12:00:00.000Z" },
  },
  {
    name: "template.deleted",
    label: "Plantilla eliminada",
    description: "Una plantilla pasó a la papelera (soft delete).",
    sample: { id: "tpl_ab12cd34ef56", name: "Post IG — Lanzamiento", workspaceId: "ws_ab12cd34ef56", deletedAt: "2026-09-21T12:00:00.000Z" },
  },
  {
    name: "version.created",
    label: "Versión creada",
    description: "Un humano o agente guardó una versión del diseño (Ctrl+S / POST /versions).",
    sample: { templateId: "tpl_ab12cd34ef56", workspaceId: "ws_ab12cd34ef56", versionId: "v_42", label: "Guardado manual", author: "human:user-uuid", kind: "marked" },
  },
  {
    name: "comment.created",
    label: "Comentario creado",
    description: "Alguien comentó en una plantilla (incluye invitados móviles vía link /c/:id).",
    sample: { templateId: "tpl_ab12cd34ef56", workspaceId: "ws_ab12cd34ef56", commentId: "c_42", body: "El logo va más grande", author: "guest" },
  },
  {
    name: "webhook.ping",
    label: "Ping de prueba",
    description: "Evento de prueba del botón «Enviar test» — no se dispara por actividad real.",
    sample: { message: "Musa webhook test", webhookId: "wh_ab12cd34ef56" },
  },
];

export const WEBHOOK_EVENT_NAMES: string[] = WEBHOOK_EVENTS.map(e => e.name);

export function isKnownEvent(name: string): boolean {
  return WEBHOOK_EVENT_NAMES.includes(name);
}

/** Convenience for API validation error messages. */
export const WEBHOOK_EVENTS_LIST = WEBHOOK_EVENT_NAMES.join(", ");

// ── Delivery / retry policy ────────────────────────────────────

/** Max delivery attempts per webhook × event (1 initial + 4 retries). */
export const WEBHOOK_MAX_ATTEMPTS = 5;

/**
 * Backoff before attempt N+1, indexed by attempts already made.
 * 1m → 5m → 30m → 2h → 6h. Attempt 5 schedules beyond the max, so it
 * never runs — the row stays `failed` for the UI's Retry button.
 */
export const WEBHOOK_RETRY_DELAYS_MS: number[] = [
  60_000,        // 1 min
  300_000,       // 5 min
  1_800_000,     // 30 min
  7_200_000,     // 2 h
  21_600_000,    // 6 h
];

export function webhookBackoffMs(attemptsDone: number): number {
  const idx = Math.min(Math.max(attemptsDone, 0), WEBHOOK_RETRY_DELAYS_MS.length - 1);
  return WEBHOOK_RETRY_DELAYS_MS[idx];
}

/** Deliveries older than this are purged lazily by the sweep. */
export const WEBHOOK_DELIVERY_RETENTION_DAYS = 30;

// ── Envelope & signature ───────────────────────────────────────

export interface WebhookEnvelope {
  id: string;
  event: string;
  timestamp: string;
  workspaceId: string | null;
  data: Record<string, unknown>;
}

/** The exact JSON body POSTed to the destination URL. */
export function buildWebhookEnvelope(
  event: string,
  data: Record<string, unknown>,
  opts?: { workspaceId?: string | null; eventId?: string },
): WebhookEnvelope {
  return {
    id: opts?.eventId || `evt_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`,
    event,
    timestamp: new Date().toISOString(),
    workspaceId: opts?.workspaceId ?? null,
    data,
  };
}

/**
 * HMAC-SHA256 signature sent in `x-musa-signature`.
 * Sign `"{timestamp}.{rawBody}"` with the webhook secret — the Stripe
 * scheme: it binds the timestamp, so replaying an old body fails the
 * tolerance check on the receiver.
 */
export function signWebhookPayload(secret: string, timestamp: string, rawBody: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

/** Verify on the receiver side (documented snippet, also used in tests). */
export function verifyWebhookSignature(secret: string, timestamp: string, rawBody: string, signature: string): boolean {
  const expected = signWebhookPayload(secret, timestamp, rawBody);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
