# 🔌 APIs & Webhooks — Conecta Musa con lo que quieras

> **Autor:** Renzo Perez Bartra / Futuraria · **Infra:** Cloudflare Workers + Supabase
> **Spec OpenAPI:** `GET /api/openapi.json` · **Sección UI:** Configuración → **APIs/Webhooks**

---

## 📑 Índice

1. [Qué es esto](#1-qué-es-esto)
2. [Autenticación](#2-autenticación)
3. [Base URL y convenciones](#3-base-url-y-convenciones)
4. [Catálogo de endpoints](#4-catálogo-de-endpoints)
5. [OpenAPI (Postman, Insomnia, Make)](#5-openapi-postman-insomnia-make)
6. [Webhooks salientes — cómo funcionan](#6-webhooks-salientes--cómo-funcionan)
7. [Catálogo de eventos](#7-catálogo-de-eventos)
8. [Verificar la firma HMAC (obligatorio en producción)](#8-verificar-la-firma-hmac-obligatorio-en-producción)
9. [Reintentos, entregas y logs](#9-reintentos-entregas-y-logs)
10. [Recetas: N8N](#10-recetas-n8n)
11. [Recetas: Zapier](#11-recetas-zapier)
12. [Recetas: Make](#12-recetas-make)
13. [Arquitectura interna (Cloudflare + Supabase)](#13-arquitectura-interna-cloudflare--supabase)
14. [Deployment checklist (Cloudflare / Supabase)](#14-deployment-checklist-cloudflare--supabase)
15. [Troubleshooting](#15-troubleshooting)

---

## 1. Qué es esto

Toda la plataforma Musa es una API. Cualquier usuario puede:

- **Consumir la REST API** con su propia clave (`x-api-key`) o su sesión (`Bearer`) para crear workspaces, plantillas, frames, versiones y renders desde código, scripts, agentes o herramientas no-code.
- **Registrar webhooks salientes**: Musa POSTea un JSON firmado a la URL que el usuario elija **cada vez que pasa algo** en su cuenta (plantilla creada, comentario nuevo, versión guardada…). Con eso conecta Musa a **N8N, Zapier, Make** o su propio backend sin escribir una línea de glue code.

Gestión 100% self-service en **Configuración → APIs/Webhooks** (sub-sección con dos pestañas: `API` y `Webhooks`).

---

## 2. Autenticación

Todos los endpoints `/api/*` (salvo healthcheck, spec OpenAPI y catálogo de eventos) requieren credenciales. Dos formas, válidas en paralelo:

| Método | Header | Qué es | Cómo se obtiene |
|---|---|---|---|
| **Clave de workspace — scope REST** | `x-api-key: fdr_ws_…` | Clave opaca asociada a UN workspace, con rol `editor` o `viewer` y scope `kind: rest` — solo `/api/*` | Configuración → APIs/Webhooks → «Crear clave» |
| **Clave de workspace — scope MCP** | `x-api-key: fdr_ws_…` | El llavero completo de agentes: abre el MCP y también `/api/*` (los tools del MCP reenvían la clave a la API por dentro) | Invita IAs, o tool MCP `create_api_key` |
| **Sesión de usuario** | `Authorization: Bearer <access_token>` | El mismo JWT de Supabase que usa el editor | Login normal; el token vive en la sesión del navegador |

Reglas de tenancy (las dos formas pasan por los mismos checks):

- La clave `fdr_ws_…` **solo ve el workspace al que pertenece**. Un `viewer` no puede escribir.
- Los **webhooks son de la cuenta** (no del workspace): las claves `fdr_ws_…` **no pueden gestionarlos** (responden `403`) — solo tu sesión puede. Sí pueden disparar los eventos que alimentan esos webhooks.
- La clave revocada o expirada responde `401` con `reason: key_revoked | key_expired` inmediatamente.
- **Llaveros separados (v55):** una clave `kind: rest` (creada en APIs/Webhooks) **no abre el MCP** — responde `401 reason: key_wrong_scope`. Las claves `kind: mcp` (Invita IAs) siguen válidas en ambos; las filas anteriores a v55 se comportan como `mcp`.

**Rate limit:** el API aplica un rate limit global por IP (middleware `rateLimit`). Para automatización pesada usa backoff ante `429`.

---

## 3. Base URL y convenciones

- **Base URL:** tu dominio de Cloudflare (p. ej. `https://design.futuraria.com`). En local: `http://localhost:5173` (el dev server de Vite proxya `/api/*` a la app Express).
- **Content-Type:** siempre `application/json; charset=utf-8`.
- **Formato de respuesta estándar:**

```json
{ "success": true,  "data": { … } }
{ "success": false, "error": "mensaje legible", "reason": "error_code" }
```

- IDs: workspaces `ws_…`, plantillas `tpl_…`, frames `frame_…`, webhooks `wh_…`, entregas `UUID`, eventos `evt_…`.

---

## 4. Catálogo de endpoints

### Meta (público, sin credenciales)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/health` | Healthcheck |
| GET | `/api/health/storage` | ¿Supabase conectado? modo `supabase` / `memory` |
| GET | `/api/openapi.json` | Spec OpenAPI 3.1 completa |
| GET | `/api/webhooks/events` | Catálogo de eventos de webhook |

### Workspaces

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/workspaces` | Lista tus workspaces |
| POST | `/api/workspaces` | `{ name, description? }` |
| PUT | `/api/workspaces/:id` | Renombra / describe |
| DELETE | `/api/workspaces/:id` | Elimina (cascada plantillas) |

### Plantillas

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/templates?limit&offset&search` | Lista paginada |
| POST | `/api/templates` | `{ workspaceId, name?, width?, height? }` |
| GET | `/api/templates/:id` | Plantilla completa (frames, canvas) |
| PUT | `/api/templates/:id` | Actualiza name/canvas/frames/html/css |
| DELETE | `/api/templates/:id` | Papelera (soft delete) |
| PUT | `/api/templates/:id/restore` | Restaura de papelera |
| DELETE | `/api/templates/:id/permanent` | Purga definitivo |

### Frames, versiones, render

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/templates/:id/frames` | Lista frames |
| POST | `/api/templates/:id/frames` | `{ name, x, y, width, height, fill? }` |
| GET/POST | `/api/templates/:id/versions` | Historial / snapshot nuevo |
| GET | `/api/templates/:id/render/:frameId` | HTML autónomo con botones PNG/JPG/SVG |

### Webhooks (gestión — requiere sesión)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/webhooks?includeSecret=1` | Lista (secreto enmascarado salvo `includeSecret=1`) |
| POST | `/api/webhooks` | `{ label?, url, events[], workspaceId? }` → devuelve `secret` |
| PATCH | `/api/webhooks/:id` | `{ label?, url?, events?, active? }` |
| DELETE | `/api/webhooks/:id` | Elimina hook + log (cascade) |
| POST | `/api/webhooks/:id/regenerate` | Rota el secreto de firma |
| POST | `/api/webhooks/:id/test` | Envía `webhook.ping` y espera el resultado (≤8s) |
| GET | `/api/webhooks/:id/deliveries?limit=20` | Log de entregas, más recientes primero |
| POST | `/api/webhooks/:id/deliveries/:deliveryId/retry` | Reencola y reintenta ya |

### Interno (ops)

| Método | Ruta | Credencial | Descripción |
|---|---|---|---|
| POST | `/api/webhooks/dispatch` | header `x-dispatch-secret` = `WEBHOOK_DISPATCH_SECRET` | Ejecuta el sweep de entregas vencidas (el cron de Cloudflare lo corre en el propio Worker **in-process**; este endpoint queda para operación manual: `curl`). |

---

## 5. OpenAPI (Postman, Insomnia, Make)

`GET /api/openapi.json` (público) devuelve una spec **OpenAPI 3.1 curada** con los esquemas principales, los dos security schemes (`x-api-key` y `Bearer`) y la lista de eventos como `enum`. Extensiones propias:

- `x-webhook-events`: catálogo completo con samples.
- `x-webhook-signature`: esquema de firma (header, algoritmo, headers auxiliares).

Import directo: Postman → *Import → link*; Insomnia → *Import from URL*; Make lo consume al configurar clientes HTTP.

---

## 6. Webhooks salientes — cómo funcionan

```
evento (p. ej. template.created)
        │
        ▼
routes/*.ts  →  dispatchWebhook(event, data, { workspaceId })
        │              1. SELECT hooks activos con el evento
        │              2. filtra por workspace (hook.workspaceId)
        │              3. INSERT platform_webhook_deliveries (pending)
        │              4. primer intento inmediato vía waitUntil (CF)
        ▼
entrega: POST url destino
  Headers:
    Content-Type: application/json
    User-Agent: Musa-Webhooks/1.0
    x-musa-event: template.created
    x-musa-delivery: <delivery id>
    x-musa-timestamp: <ISO 8601>
    x-musa-signature: sha256=<hex HMAC-SHA256>
  Body (idéntico a lo firmado):
    { "id": "evt_…", "event": "template.created",
      "timestamp": "…", "workspaceId": "ws_…" | null,
      "data": { … } }
        │
        ├─ 2xx  → status success, fin.
        └─ otro/timeout → status failed → reintentos del cron (§9)
```

Tu receptor **debe responder 2xx rápido** (<8s: ese es el timeout por intento). Si tu flujo es pesado (renderizar, llamar LLMs), responde `202` y procesa en cola.

---

## 7. Catálogo de eventos

Fuente de verdad: `api/src/services/webhookEvents.ts` (la UI y la spec se generan del mismo catálogo). Filtro por evento en la creación del webhook; `webhook.ping` solo sale del botón «Enviar test».

| Evento | Cuándo se dispara | `data` |
|---|---|---|
| `template.created` | Plantilla nueva (editor, API o MCP) | `{ id, name, workspaceId, width, height, createdBy }` |
| `template.updated` | Guardado de plantilla — **throttle 1/min por plantilla** | `{ id, name, workspaceId, updatedAt }` |
| `template.deleted` | A papelera | `{ id, name, workspaceId, deletedAt }` |
| `version.created` | Ctrl+S / POST `/versions` (humanos y agentes) | `{ templateId, workspaceId, versionId, label, author, kind }` |
| `comment.created` | Comentario en editor **o invitado móvil** (`/c/:id`) | `{ templateId, workspaceId, commentId, body, frameId, source, author? }` |
| `webhook.ping` | Solo «Enviar test» | `{ message, webhookId }` |

---

## 8. Verificar la firma HMAC (obligatorio en producción)

Esquema estilo Stripe: se firma `"{timestamp}.{rawBody}"` con el secreto `whsec_…` del webhook. El timestamp firmado permite rechazar replays.

**Node.js**

```js
import crypto from "node:crypto";

export function verifyMusa(req, rawBody, secret, toleranceMs = 5 * 60_000) {
  const timestamp = req.headers["x-musa-timestamp"];
  const signature = req.headers["x-musa-signature"] || "";
  if (Math.abs(Date.now() - Date.parse(timestamp)) > toleranceMs) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected); const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

> ⚠️ Necesitas el **raw body** (sin re-serializar). En Express: `express.json({ verify: (req,res,buf) => { req.rawBody = buf; } })`.

**Python**

```python
import hmac, hashlib, time
def verify(secret, timestamp, raw_body, signature, tolerance=300):
    if abs(time.time() * 1000 - parse_ts(timestamp)) > tolerance * 1000: return False
    expected = "sha256=" + hmac.new(secret.encode(), f"{timestamp}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
```

**N8N** — nodo **Function** después del Webhook (usa `Webhook Raw Body` o `$json` del nodo raw):

```js
const crypto = await import('crypto');
const expected = 'sha256=' + crypto.createHmac('sha256', $vars.MUSA_SECRET)
  .update(`${$json.headers['x-musa-timestamp']}.${$json.rawBody}`).digest('hex');
return [{ json: { ok: expected === $json.headers['x-musa-signature'] } }];
```

---

## 9. Reintentos, entregas y logs

Cada entrega vive en `platform_webhook_deliveries` y aparece en **Configuración → APIs/Webhooks → Webhooks → Ver entregas**.

- **Estados:** `pending` → `success` | `failed`.
- **Reintentos automáticos** (cron de Cloudflare cada 5 min): backoff **1m → 5m → 30m → 2h → 6h**, máximo **5 intentos**. Vencidos los intentos, la entrega queda `failed` con el botón **Reintentar**.
- **Botón Reintentar:** reencola al momento y muestra el resultado del intento.
- **Test en vivo:** «Enviar test» espera el primer intento (≤8s) y te dice el HTTP de respuesta o el error exacto.
- **Retención:** el sweep purga entregas con más de **30 días** (lazy, 10% de los sweeps).
- **Filtrado por workspace:** al crear el webhook puedes marcar «Solo eventos de este workspace»; el hook con `workspace_id NULL` recibe todo.

---

## 10. Recetas: N8N

**Recibir eventos de Musa (Musa → N8N)**

1. Crea un Workflow con nodo **Webhook** → método `POST`, copia la **Production URL**.
2. Musa → Configuración → APIs/Webhooks → **Webhooks** → crea con esa URL y tus eventos.
3. Pulsa **Enviar test** en Musa: llega la ejecución de prueba a N8N y ves el payload (`body.event`, `body.data…`).
4. Añade un nodo **IF** con `{{ $json.body.event }}` si suscribiste varios eventos.
5. Valida la firma con el snippet del §8 (nodo Function) antes de confiar en el payload.

**Operar Musa desde N8N (N8N → Musa)**

1. Credentials → **Header Auth**: `Name: x-api-key`, `Value: fdr_ws_…` (la clave vive en Invita IAs / APIs/Webhooks).
2. Nodo **HTTP Request** → pega la credencial → URL `https://TU-DOMINIO/api/templates` → method `POST` → body JSON `{ "workspaceId": "ws_…", "name": "Post IG", "width": 1080, "height": 1080 }`.
3. Respuesta: `data.id` es el `tpl_…` para encadenar frames o renders.

---

## 11. Recetas: Zapier

**Recibir eventos (Musa → Zapier)**

1. Zap → Trigger **Webhooks by Zapier → Catch Hook** → copia la *custom webhook URL*.
2. Musa → APIs/Webhooks → crea el webhook con esa URL + eventos.
3. **Enviar test** en Musa → Zapier muestra el payload y deja mapear campos (`body.data.name`, …).
4. Continúa el Zap con la acción que quieras (Slack, Sheets, CRMs…).

**Operar Musa (Zapier → Musa)**

1. Action → **Webhooks by Zapier → POST**.
2. URL `https://TU-DOMINIO/api/…`, *Payload Type* `json`, *Data* los campos del recurso.
3. *Headers*: `x-api-key | fdr_ws_…` y `Content-Type | application/json`.

---

## 12. Recetas: Make

**Recibir eventos (Musa → Make)**

1. Scenario → módulo **Webhooks → Custom webhook** → copia la URL.
2. Regístrala en Musa (APIs/Webhooks) con tus eventos → **Enviar test** → Make detecta la estructura.
3. Añade el filtro `event = template.created` (o el que uses) justo después del webhook.

**Operar Musa (Make → Musa)**

1. Módulo **HTTP → Make a request**.
2. URL `https://TU-DOMINIO/api/…`, method según endpoint, *Headers*: `x-api-key: fdr_ws_…`.
3. *Body type*: `application/x-www-form-urlencoded` NO — usa **raw / application/json** con el JSON del endpoint.

---

## 13. Arquitectura interna (Cloudflare + Supabase)

Todo corre en **Cloudflare Workers** (no hay funciones propietarias de Netlify en esta feature):

```
Cloudflare Worker (design-futuraria)
├─ fetch handler
│   ├─ /api/*           → Express app vía express-shim (Hono)
│   │    └─ /api/webhooks/*      → routes/webhooks.ts (gestión + test + deliveries)
│   │    └─ /api/openapi.json    → routes/openapi.ts (spec pública)
│   └─ bridge: globalThis.__musaWaitUntil = ctx.waitUntil
│        → el primer intento de entrega sobrevive a la respuesta (≤30s)
└─ scheduled handler (cron */5 * * * *, wrangler.toml [triggers])
     ├─ kill switches: WEBHOOK_DISPATCH_SECRET / WEBHOOKS_TICK_ENABLED=false
     ├─ demand check (cero entregas vencidas → skip, fail-open)
     └─ sweepWebhookDeliveries() IN-PROCESS (mismo isolate, sin self-HTTP)

Supabase (Postgres)
├─ platform_webhooks           (RLS: owner; API escribe con service-role)
└─ platform_webhook_deliveries (RLS: owner vía join; retención 30 días)
```

- **Cola durable:** la entrega se materializa como fila ANTES del intento. Si el isolate muere, el cron retoma la fila — no se pierde nada.
- **Nunca bloquea al usuario:** `dispatchWebhook` traga sus errores (solo `console.warn`); un webhook caído jamás falla un guardado.
- **Migración:** `supabase_migrations_v54.sql` (idempotente).

---

## 14. Deployment checklist (Cloudflare / Supabase)

### Supabase (una vez)

1. Ejecuta `supabase_migrations_v54.sql` en la **production DB** (SQL Editor → Run). Es idempotente.
2. Verifica: `SELECT count(*) FROM platform_webhooks;` (debe responder 0 sin error).
3. **Sube `.migration-version` a `v54`** — el prebuild (`check-migrations.mjs`) avisa mientras la versión registrada quede atrás.

### Cloudflare (una vez)

1. **Secret** del Worker (`wrangler secret put` o dashboard → Workers → design-futuraria → Settings → Variables):
   - `WEBHOOK_DISPATCH_SECRET` — cadena larga aleatoria (`openssl rand -hex 32`). **Sin ella el cron no-op y no hay reintentos** (la primera entrega sí funciona).
   - Opcional: `WEBHOOKS_TICK_ENABLED=false` para apagar el sweep de emergencia.
2. **Cron trigger:** ya está declarado en `wrangler.toml` (`[triggers] crons = ["*/5 * * * *"]`). Se crea solo con el deploy:
   ```bash
   npx wrangler deploy
   ```
   Verifica en el dashboard: Workers → design-futuraria → **Triggers → Cron Triggers** → `*/5 * * * *`.
3. Prueba el cron: dashboard → Workers → design-futuraria → **Logs** (o `wrangler tail`) → espera un tick → debe loguear `[webhooks-cron] skipped: nada vencido` o `sweep: N procesadas…`.

### Verificación end-to-end (5 min)

1. UI → Configuración → **APIs/Webhooks** → pestaña Webhooks → crea un webhook con la URL de un RequestBin/webhook.site y el evento `template.created`.
2. Pulsa **Enviar test** → debe decir `Test entregado ✓ (HTTP 200)` y el bin muestra el envelope + headers `x-musa-*`.
3. Crea una plantilla en el editor → a los segundos el bin recibe `template.created`.
4. Apunta el webhook a una URL caída → «Ver entregas» → la entrega queda `failed` y los reintentos aparecen cada backoff; pulsa **Reintentar** para forzar.

---

## 15. Troubleshooting

| Síntoma | Causa probable | Arreglo |
|---|---|---|
| `401 reason: key_not_found` con `x-api-key` | Clave mal copiada / de otro deploy | Regenera en Invita IAs; verifica el dominio |
| `401 reason: key_wrong_scope` al llamar al MCP | Clave REST (APIs/Webhooks) usada contra `/mcp` | Crea la clave en Invita IAs (scope `mcp`) o usa el endpoint REST correcto |
| `403 Workspace API keys cannot access account-level webhooks` | Gestión de webhooks con `fdr_ws_…` | Usa tu **sesión** (navegador) para gestionar webhooks |
| El test dice `Timeout después de 8s` | El receptor responde lento o cuelga | Responde 2xx primero, procesa en cola |
| Entregas `pending` para siempre | `WEBHOOK_DISPATCH_SECRET` sin setear en el Worker | Setea el secret (§14) — el cron está en no-op |
| `401 x-dispatch-secret inválido` al curl `/dispatch` | Secret distinto entre tu curl y el Worker | Usa el mismo valor del secret del Worker |
| Firma no valida en tu receptor | Raw body re-serializado o secreto viejo | §8 (raw body) y **Regenerar secreto** sincroniza ambos lados |
| N8N recibe el test pero no los eventos reales | Usaste la **test URL** del nodo Webhook | Registra la **Production URL** en Musa |
| Zapier no muestra el payload | No se envió el test desde Musa | Pulsa **Enviar test** en la pestaña Webhooks |

---

**Archivos de la feature:** `api/src/services/webhookEvents.ts` · `api/src/services/webhooks.ts` · `api/src/routes/webhooks.ts` · `api/src/routes/openapi.ts` · `worker/index.js` (scheduled + waitUntil bridge) · `wrangler.toml` ([triggers]) · `supabase_migrations_v54.sql` · `src/components/ApiWebhooksSection.tsx` · `QA/api-webhooks.test.mjs`
