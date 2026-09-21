/**
 * Webhooks — el contrato completo del lado determinista.
 *
 * Cubre el módulo PURO (services/webhookEvents.ts): catálogo de eventos,
 * política de reintentos, envelope saliente y firma HMAC. Es exactamente
 * lo que consumen N8N/Zapier/Make, así que cualquier drift aquí rompe
 * integraciones de terceros — por eso se testea sin tocar red ni DB.
 *
 * Run: node --experimental-strip-types --test --test-reporter tap QA/api-webhooks.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const eventsPath = "file://" + resolve(__dirname, "..", "api", "src", "services", "webhookEvents.ts");

const {
  WEBHOOK_EVENTS,
  WEBHOOK_EVENT_NAMES,
  WEBHOOK_EVENTS_LIST,
  isKnownEvent,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_DELAYS_MS,
  webhookBackoffMs,
  WEBHOOK_DELIVERY_RETENTION_DAYS,
  buildWebhookEnvelope,
  signWebhookPayload,
  verifyWebhookSignature,
} = await import(eventsPath);

describe("catálogo de eventos — la fuente de verdad que consume todo", () => {
  it("expone exactamente los 6 eventos documentados", () => {
    assert.deepEqual(WEBHOOK_EVENT_NAMES, [
      "template.created",
      "template.updated",
      "template.deleted",
      "version.created",
      "comment.created",
      "webhook.ping",
    ]);
  });

  it("cada evento trae label, description y sample para UI + docs", () => {
    for (const ev of WEBHOOK_EVENTS) {
      assert.ok(ev.label.length > 0, `${ev.name} sin label`);
      assert.ok(ev.description.length > 0, `${ev.name} sin description`);
      assert.equal(typeof ev.sample, "object", `${ev.name} sin sample`);
    }
  });

  it("los nombres siguen <recurso>.<verbo_pasado> (filtro de terceros)", () => {
    for (const name of WEBHOOK_EVENT_NAMES) {
      assert.match(name, /^[a-z]+\.[a-z]+(_[a-z]+)*$/, `nombre no-convencional: ${name}`);
    }
  });

  it("isKnownEvent y la lista plana de validación coinciden", () => {
    assert.ok(isKnownEvent("template.created"));
    assert.ok(!isKnownEvent("template.exploded"));
    assert.equal(WEBHOOK_EVENTS_LIST, WEBHOOK_EVENT_NAMES.join(", "));
  });
});

describe("política de reintentos — backoff que el cron de CF ejecuta", () => {
  it("5 intentos totales (1 inicial + 4 reintentos)", () => {
    assert.equal(WEBHOOK_MAX_ATTEMPTS, 5);
  });

  it("backoff 1m → 5m → 30m → 2h → 6h según intentos hechos", () => {
    assert.deepEqual(WEBHOOK_RETRY_DELAYS_MS, [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000]);
    assert.equal(webhookBackoffMs(0), 60_000);
    assert.equal(webhookBackoffMs(1), 300_000);
    assert.equal(webhookBackoffMs(2), 1_800_000);
    assert.equal(webhookBackoffMs(3), 7_200_000);
    assert.equal(webhookBackoffMs(4), 21_600_000);
  });

  it("clampea en vez de tirar con índices fuera de rango", () => {
    assert.equal(webhookBackoffMs(-3), 60_000);
    assert.equal(webhookBackoffMs(99), 21_600_000);
  });

  it("retención de log de entregas: 30 días", () => {
    assert.equal(WEBHOOK_DELIVERY_RETENTION_DAYS, 30);
  });
});

describe("envelope saliente — lo único que el receptor debe parsear", () => {
  it("forma completa: id evt_, event, timestamp ISO, workspaceId null por defecto", () => {
    const env = buildWebhookEnvelope("template.created", { id: "tpl_1", name: "X" });
    assert.match(env.id, /^evt_[0-9a-f]{20}$/);
    assert.equal(env.event, "template.created");
    assert.ok(!Number.isNaN(Date.parse(env.timestamp)));
    assert.equal(env.workspaceId, null);
    assert.deepEqual(env.data, { id: "tpl_1", name: "X" });
  });

  it("respeta workspaceId y eventId opcionales (idempotencia del sweep)", () => {
    const env = buildWebhookEnvelope("comment.created", { commentId: "c_9" }, { workspaceId: "ws_7", eventId: "evt_fijo" });
    assert.equal(env.workspaceId, "ws_7");
    assert.equal(env.id, "evt_fijo");
  });

  it("ids únicos entre llamadas (delivery-id != event-id nunca colisionan)", () => {
    const a = buildWebhookEnvelope("template.deleted", {}).id;
    const b = buildWebhookEnvelope("template.deleted", {}).id;
    assert.notEqual(a, b);
  });
});

describe("firma HMAC — esquema Stripe que N8N/Zapier verifican", () => {
  const secret = "whsec_test_0123456789abcdef";
  const timestamp = "2026-09-21T12:00:00.000Z";
  const rawBody = JSON.stringify({ id: "evt_x", event: "template.created", data: {} });

  it("firma '{timestamp}.{rawBody}' con HMAC-SHA256, prefijo sha256=", () => {
    const expected = "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
    assert.equal(signWebhookPayload(secret, timestamp, rawBody), expected);
  });

  it("verify round-trip con los tres headers correctos", () => {
    const sig = signWebhookPayload(secret, timestamp, rawBody);
    assert.ok(verifyWebhookSignature(secret, timestamp, rawBody, sig));
  });

  it("rechaza body manoseado (el caso de ataque real)", () => {
    const sig = signWebhookPayload(secret, timestamp, rawBody);
    const tampered = rawBody.replace("evt_x", "evt_evil");
    assert.ok(!verifyWebhookSignature(secret, timestamp, tampered, sig));
  });

  it("rechaza secreto viejo tras regenerar", () => {
    const sig = signWebhookPayload("whsec_viejo", timestamp, rawBody);
    assert.ok(!verifyWebhookSignature("whsec_nuevo", timestamp, rawBody, sig));
  });

  it("rechaza firma vacía o corrupta sin lanzar", () => {
    assert.ok(!verifyWebhookSignature(secret, timestamp, rawBody, ""));
    assert.ok(!verifyWebhookSignature(secret, timestamp, rawBody, "sha256=deadbeef"));
    assert.ok(!verifyWebhookSignature(secret, timestamp, rawBody, undefined));
  });

  it("el timestamp va ligado: moverlo invalida la firma (anti-replay)", () => {
    const sig = signWebhookPayload(secret, timestamp, rawBody);
    assert.ok(!verifyWebhookSignature(secret, "2026-09-21T12:00:01.000Z", rawBody, sig));
  });
});
