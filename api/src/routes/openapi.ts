/**
 * OpenAPI 3.1 spec — GET /api/openapi.json
 * ──────────────────────────────────────────────────────────────
 * A curated, machine-readable description of the public REST API so
 * users can import Musa into Postman, Insomnia, Make or Zapier
 * without hand-writing schemas. Curated (not auto-generated): it
 * documents the resources an external automation actually consumes,
 * with stable summaries instead of the full internal model.
 *
 * The webhook event catalog is imported from webhookEvents.ts, so
 * spec and reality can't drift.
 *
 * @module routes/openapi
 */

import { Router } from "express";
import { WEBHOOK_EVENTS } from "../services/webhookEvents.js";

export const openApiRoutes = Router();

const okJson = (description: string, schemaRef?: string) => ({
  description,
  content: { "application/json": { schema: schemaRef ? { $ref: schemaRef } : { type: "object" } } },
});

const envelope = (dataSchema: object) => ({
  type: "object",
  properties: { success: { type: "boolean" }, data: dataSchema, error: { type: "string" } },
  required: ["success"],
});

const errorResponses = {
  "401": okJson("Sin credenciales o credenciales inválidas"),
  "403": okJson("Sin acceso al recurso (rol o tenancy)"),
  "500": okJson("Error interno"),
};

function listOp(tag: string, summary: string, dataSchema: object) {
  return {
    tags: [tag],
    summary,
    responses: { "200": { description: "OK", content: { "application/json": { schema: envelope(dataSchema) } } }, ...errorResponses },
  };
}

openApiRoutes.get("/openapi.json", (_req: any, res: any) => {
  const webhookEventEnum = WEBHOOK_EVENTS.map(e => e.name);

  const spec = {
    openapi: "3.1.0",
    info: {
      title: "Musa (Futuraria Design) — Public API",
      version: "1.0.0",
      description:
        "REST API de Musa: automatiza workspaces, plantillas, frames, renders y webhooks desde N8N, Zapier, Make o tu propio código.\n\n" +
        "Autenticación: envía `x-api-key: <workspace key>` (crea la clave en Configuración → APIs/Webhooks o Invita IAs) " +
        "o `Authorization: Bearer <access token>` con tu sesión.\n\n" +
        "Los webhooks salientes POSTean sobres JSON firmados con HMAC-SHA256 en `x-musa-signature`. " +
        "Documentación completa: /docs/API_WEBHOOKS.md",
      contact: { name: "Futuraria", url: "https://futuraria.com" },
    },
    servers: [{ url: "/", description: "Este despliegue" }],
    tags: [
      { name: "Workspaces" }, { name: "Templates" }, { name: "Frames" },
      { name: "Render" }, { name: "Webhooks" }, { name: "Meta" },
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key" },
        BearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
      schemas: {
        TemplateSummary: {
          type: "object",
          properties: {
            id: { type: "string" }, workspaceId: { type: "string" }, name: { type: "string" },
            width: { type: "number" }, height: { type: "number" },
            metadata: { type: "object", properties: { createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" } } },
          },
        },
        Frame: {
          type: "object",
          properties: {
            id: { type: "string" }, templateId: { type: "string" }, name: { type: "string" },
            x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" },
          },
        },
        Webhook: {
          type: "object",
          properties: {
            id: { type: "string" }, label: { type: "string" }, url: { type: "string", format: "uri" },
            events: { type: "array", items: { type: "string", enum: webhookEventEnum } },
            active: { type: "boolean" },
            secretPreview: { type: "string", description: "Secreto enmascarado (usa ?includeSecret=1 para revelarlo)" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        WebhookEnvelope: {
          type: "object",
          description: "Cuerpo exacto que Musa POSTea a tu URL",
          properties: {
            id: { type: "string", description: "evt_… único por evento" },
            event: { type: "string", enum: webhookEventEnum },
            timestamp: { type: "string", format: "date-time" },
            workspaceId: { type: ["string", "null"] },
            data: { type: "object", additionalProperties: true },
          },
        },
      },
    },
    security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
    paths: {
      "/api/health": { get: { tags: ["Meta"], summary: "Healthcheck", security: [], responses: { "200": okJson("OK") } } },
      "/api/workspaces": {
        get: { ...listOp("Workspaces", "Lista tus workspaces", { type: "array", items: { type: "object" } }) },
        post: {
          tags: ["Workspaces"], summary: "Crea un workspace",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["name"], properties: { name: { type: "string" }, description: { type: "string" } } } } } },
          responses: { "201": { description: "Creado", content: { "application/json": { schema: envelope({ type: "object" }) } } }, ...errorResponses },
        },
      },
      "/api/templates": {
        get: listOp("Templates", "Lista plantillas (paginado)", { type: "array", items: { $ref: "#/components/schemas/TemplateSummary" } }),
        post: {
          tags: ["Templates"], summary: "Crea una plantilla",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string" }, name: { type: "string" }, width: { type: "number" }, height: { type: "number" } } } } } },
          responses: { "201": { description: "Creada", content: { "application/json": { schema: envelope({ $ref: "#/components/schemas/TemplateSummary" }) } } }, ...errorResponses },
        },
      },
      "/api/templates/{id}": {
        get: { tags: ["Templates"], summary: "Obtiene una plantilla (con frames y canvas)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK", content: { "application/json": { schema: envelope({ type: "object" }) } } }, "404": okJson("No encontrada"), ...errorResponses } },
        put: { tags: ["Templates"], summary: "Actualiza una plantilla (nombre, canvas, frames, html, css…)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], requestBody: { content: { "application/json": { schema: { type: "object" } } } }, responses: { "200": { description: "Actualizada", content: { "application/json": { schema: envelope({ type: "object" }) } } }, ...errorResponses } },
        delete: { tags: ["Templates"], summary: "Papelera (soft delete)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": okJson("Eliminada"), ...errorResponses } },
      },
      "/api/templates/{id}/frames": {
        get: listOp("Frames", "Lista los frames de la plantilla", { type: "array", items: { $ref: "#/components/schemas/Frame" } }),
        post: {
          tags: ["Frames"], summary: "Crea un frame",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["name", "x", "y", "width", "height"], properties: { name: { type: "string" }, x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" }, fill: { type: "string" } } } } } },
          responses: { "201": { description: "Creado", content: { "application/json": { schema: envelope({ $ref: "#/components/schemas/Frame" }) } } }, ...errorResponses },
        },
      },
      "/api/templates/{id}/render/{frameId}": {
        get: { tags: ["Render"], summary: "Renderiza un frame (HTML autónomo con PNG/JPG/SVG embebido)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }, { name: "frameId", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "HTML de render", content: { "text/html": {} } }, ...errorResponses } },
      },
      "/api/templates/{id}/versions": {
        get: listOp("Templates", "Historial de versiones (metadata)", { type: "array", items: { type: "object" } }),
        post: { tags: ["Templates"], summary: "Crea una versión (snapshot del estado actual)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "201": okJson("Creada"), ...errorResponses } },
      },
      "/api/webhooks": {
        get: {
          tags: ["Webhooks"], summary: "Lista tus webhooks",
          parameters: [{ name: "includeSecret", in: "query", schema: { type: "string", enum: ["1", "true"] }, description: "Revela el secreto de firma (por defecto enmascarado)" }],
          responses: { "200": { description: "OK", content: { "application/json": { schema: envelope({ type: "array", items: { $ref: "#/components/schemas/Webhook" } }) } } }, ...errorResponses },
        },
        post: {
          tags: ["Webhooks"], summary: "Registra un webhook",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["url", "events"], properties: { label: { type: "string" }, url: { type: "string", format: "uri" }, events: { type: "array", minItems: 1, items: { type: "string", enum: webhookEventEnum } }, workspaceId: { type: "string", nullable: true, description: "Filtra eventos a un workspace (null = todos)" } } } } } },
          responses: { "201": { description: "Creado", content: { "application/json": { schema: envelope({ $ref: "#/components/schemas/Webhook" }) } } }, ...errorResponses },
        },
      },
      "/api/webhooks/{id}": {
        patch: { tags: ["Webhooks"], summary: "Actualiza url/label/events/active", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], requestBody: { content: { "application/json": { schema: { type: "object", properties: { label: { type: "string" }, url: { type: "string", format: "uri" }, events: { type: "array", items: { type: "string" } }, active: { type: "boolean" } } } } } }, responses: { "200": okJson("Actualizado"), ...errorResponses } },
        delete: { tags: ["Webhooks"], summary: "Elimina el webhook y su log", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": okJson("Eliminado"), ...errorResponses } },
      },
      "/api/webhooks/{id}/test": {
        post: { tags: ["Webhooks"], summary: "Envía un webhook.ping y espera el resultado", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Resultado de la entrega", content: { "application/json": { schema: envelope({ type: "object" }) } } }, ...errorResponses } },
      },
      "/api/webhooks/{id}/deliveries": {
        get: listOp("Webhooks", "Historial de entregas (recientes primero)", { type: "array", items: { type: "object" } }),
      },
      "/api/webhooks/events": {
        get: { tags: ["Webhooks"], summary: "Catálogo de eventos disponibles", security: [], responses: { "200": okJson("OK") } },
      },
    },
    "x-webhook-events": WEBHOOK_EVENTS,
    "x-webhook-signature": {
      header: "x-musa-signature",
      scheme: "sha256=HMAC_SHA256(secret, '{timestamp}.{rawBody}')",
      headers: ["x-musa-event", "x-musa-delivery", "x-musa-timestamp"],
    },
  };

  res.setHeader("Cache-Control", "public, max-age=300");
  res.json(spec);
});
