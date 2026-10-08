# REQ-040 — Flows: pausa con reanudación por agente (wait/resume + wake event-driven)

**Fecha:** 2026-10-07 · **Estado:** propuesto · **Prioridad:** alta
**Reportado por:** Ren
**Extiende:** REQ-027-flows-builder-mcp-first.md (los nodos `wait_webhook`/`approval` y `flow_resume` YA existen y fueron probados en producción: run pausa → `flow_resume` con resumeToken continúa el MISMO runId).

## Problema

El nodo de pausa deja el run en `status:"waiting"` con un resumeToken, pero
NADIE avisa al agente que debe reanudarlo. Hoy las opciones son malas:

1. El agente poll-erea `flow_history` cada X minutos → quema tokens en
   conversaciones vacías (Ren: "imagino que eso cuesta tokens" — correcto).
2. El usuario queda esperando de → si da play y el agente no está mirando,
   el run expira con WAIT_EXPIRED.

## Solución: push, no pull

Cuando un run entra en `waiting`, el server DISPARA un webhook saliente
("wake") hacia una URL que el workspace registra. Ese webhook despierta al
agente (Hermes ya tiene webhook-subscriptions: POST entrante → sesión de
agente con el payload como contexto). El agente redacta y llama
`flow_resume`. Costo idle = CERO: el agente solo existe cuando hay un run
esperando.

Flujo completo:

```
flow_run → nodos → wait_webhook → run "waiting"
                                └→ POST wake (HMAC) → URL del workspace
                                     └→ Hermes abre sesión con {runId, resumeToken,...}
                                          └→ agente lee steps, redacta
                                          └→ flow_resume(resumeToken, payload)
                                               └→ run continúa → template → done
```

Para `kind:"approval"` el mismo wake sirve, pero el destino es el HUMANO:
Hermes reenvía la pregunta a Ren (Telegram) y reanuda con su decisión.

## Alcance v1

### 1. Config de wake (server)

Migración v-next (columna jsonb, sin tabla nueva):

```sql
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS flows_wake jsonb;
-- shape: {url, secret, enabled, createdAt}
-- url: HTTPS público; secret: para HMAC (generado por server si no viene)
```

Tools MCP nuevas:

| Tool | Input | Hace |
|---|---|---|
| `flow_wake_set` | `{url?, enabled?, secret?}` | registra/actualiza la URL de wake del workspace (secret se genera solo si falta; NUNCA se devuelve completo, solo últimos 4) |
| `flow_wake_get` | `{}` | `{enabled, url, secretHint}` |
| `flow_wake_test` | `{}` | POST de prueba a la URL con payload sample → devuelve el HTTP status que respondió |

### 2. Disparo del wake (server, en el runtime de flow_run)

- Punto exacto: cuando el run pasa a `status:"waiting"` (nodo
  `wait_webhook` o `approval` acepta la pausa), después de persistir el run.
- POST a `flows_wake.url` con:

```json
{
  "type": "flow_wait",
  "workspaceId": "ws_...",
  "flowId": "flow_...",
  "flowName": "PB·Evento 2 — Countdown",
  "runId": "run_...",
  "nodeId": "w1",
  "kind": "webhook" | "approval",
  "message": "mensaje del nodo",
  "resumeToken": "rw_...",
  "expiresAt": "2026-10-08T01:50:35.524Z"
}
```

- Header de firma: `X-Musa-Signature: hex(hmac_sha256(secret, body))` — el
  receptor verifica antes de actuar (anti-falsificación del endpoint).
- Envío fire-and-forget con `waitUntil()` + 3 reintentos backoff (1s/5s/25s).
  Si agota: SOLO log — no bloquea ni falla el run. El fallback de
  descubrimiento es el filtro de `flow_history` (§3).
- Si `flows_wake.enabled = false` o no hay URL: comportamiento actual (nada).

### 3. `flow_history` con filtro de estado (server)

- Nuevo input opcional `status` (`"waiting"` es el caso de uso). Devuelve
  solo esos runs, con el mismo shape. Sirve de fallback barato (1 llamada
  lista solo pausados) y para el sub-tab de UI.
- Índice: `CREATE INDEX flow_runs_status_idx ON flow_runs(workspace_id, status, started_at DESC);`

### 4. Lado agente (Hermes) — NO es código del repo, es configuración

Documentado en este REQ para que quede en un solo lugar; el implementador NO
lo construye, solo lo respeta en el contrato del payload:

- Suscripción: POST entrante verificado (HMAC) → sesión de agente con el
  payload como contexto.
- Política por `kind`:
  - `webhook` → agente lee `flow_get` + steps del run, produce el contenido
    que pide el `message`, llama `flow_resume(resumeToken, payload)`.
  - `approval` → agente NOTIFICA a Ren (Telegram) con el mensaje y opciones;
    reanuda con `approved` según su respuesta. Si no responde antes de
    `expiresAt`, no hace nada (el run expira solo, ya soportado).
- Idempotencia: si el run ya no está waiting (resume doble), `flow_resume`
  falla → el agente lo ignora sin error ruidoso.

### 5. UI mínima (opcional, barata)

- En Configuración del workspace: campo URL de wake + toggle (usa las tools
  del §1 vía mcpCall — cero lógica nueva).
- En sub-tab Ejecuciones: filtro por estado con chip "waiting" destacado
  (los runs pausados son la señal de "requiere atención").

## Fuera de alcance v1

- Reintentos del WAKE vía cola persistente (Durable Objects/queues): los 3
  reintentos en-process bastan; el filtro `status:"waiting"` es la red.
- Múltiples URLs de wake por workspace (una sola; routing fino lo hace el
  receptor).
- Que el server redacte o decida nada: el server SOLO notifica.
- Cron server-side: sigue PROHIBIDO (decisión REQ-027 de Ren, no revivirla).

## Verificación

1. `flow_wake_set` con webhook.site (o similar) → `flow_run` de un flow con
   `wait_webhook` → llega POST firmado con resumeToken y expiresAt.
2. `X-Musa-Signature` verificable con el secret (hex hmac-sha256 del body).
3. `flow_wake_test` devuelve el status de respuesta del endpoint.
4. `flow_history {status:"waiting"}` lista solo el run pausado.
5. E2E real: flow pausado → wake recibido → `flow_resume` con el token →
   run termina `success` → `flow_history` ya NO lo lista como waiting.
6. Sin URL configurada: todo funciona como hoy (cero regresión).

## Hallazgos del implementador

1. **Repo**: el prompt decía `C:\Users\Renzo\design-check`, pero ese working
   copy NO tiene REQ-027 (cero `flow_run`/`flow_resume`/`flow_history`, cero
   tabla `flow_runs`). El código vivo de Flows vive en
   `C:\Users\Renzo\.openclaw\workspace\design-main` — el MISMO repo
   (reno42/design, main) con el estado local más avanzado. Se implementó ahí
   (regla del prompt: "no inventes nada de cero"; "sigue con lo posible").
2. **Sin Zod**: las tools de este repo usan `inputSchema` JSON hand-written +
   validación manual (patrón de la casa). No se introdujo Zod solo para esto.
3. **`workspaceId` derivado de la key**: las API keys son de USUARIO, pero
   las workspace keys traen `auth.workspaceId` (checkAuth → api_keys).
   flow_wake_* usa ESE valor (nunca el input) cuando `authType === "workspace_key"`;
   con sesión de browser o admin key el workspaceId pasa explícito y pasa el
   gate estándar `canAccessWorkspace` (viewer para get, editor para set/test).
   La inyección en `authorizeMcpCall` hace que el gate corra en ambos casos.
4. **Secret show-once**: "NUNCA se devuelve completo, solo últimos 4" es
   imposible de cuadrar con un secret generado por el server que nadie vio
   (el receptor no podría verificar el HMAC). Se siguió el precedente del
   webhook de flow (REQ-027): el secret generado se muestra COMPLETO una sola
   vez (en el flow_wake_set que lo crea); `flow_wake_get` SIEMPRE devuelve
   solo el hint. Si el workspace ya tiene secret (o lo pasa el usuario),
   solo hint.
5. **Reintentos con criterio**: 4xx definitivo (400/401/403/404…) NO reintenta
   — la misma firma y el mismo body no van a cambiar el resultado. Solo 408,
   429 y 5xx consumen el backoff 1s/5s/25s.
6. **`waitUntil()`**: el handler de mcp.mjs era `async (event)` (sin context).
   Ahora es `async (event, context)` y entrega `context.waitUntil` al runtime.
   Donde el host no lo expone (webhook de flows en api/ sobre el Worker), el
   wake corre como promesa flotante con catch — log-only, igual de seguro
   para el run (que ya está persistido).
7. **Migraciones**: v68 = columna `flows_wake` (fase 1); v69 = índice
   `(workspace_id, status, started_at DESC)` de flow_history (fase 3) — una
   por fase para que cada commit sea desplegable solo.
