# GRAPH PLAYBOOK — Flows (pipelines dentro de Musa)

> Cuándo cargar este playbook: el usuario pide crear, ejecutar, programar o
> corregir un **flow** (pipeline determinista de Musa), o pide que un flow
> "le pase la voz" a un agente para redactar y continuar (humano-en-el-loop).

## 1. Qué es un flow

Pipeline de nodos que corre server-side: fuentes (RSS/Nitter/HTTP) → IA BYOK
o pausa-de-agente → plantillas del propio usuario → reporte. Se crea y se
opera 100% por tools MCP (`flow_save`, `flow_run`, `flow_history`, …) — la UI
es un cliente más. Un flow de noticias completo toma 2-3 min y ~200 tokens de
orquestación.

## 2. Camino rápido (60 segundos)

1. `flow_library_list` → elige preset (`preset_noticias` es la bandera).
2. `flow_library_instantiate {presetId}` → flow borrador con `pendingConfig`.
3. Resuelve el pending: (a) nodo `template` con `{templateId, frameId}` del
   usuario (list_templates → get_template para ver frames), (b) credencial IA
   con `flow_credentials_set {type:"ai_provider", provider, secret}` y su
   `credentialId` en el nodo `ai`.
4. `flow_save` (mismo `id`, con todo configurado) → `flow_run {flowId}`.
5. `flow_history {flowId}` → steps OK → los frames clonados viven en el
   template indicado en el output del nodo template.

## 3. Contrato de nodos (el server valida y rechaza)

Nodo: `{id, type, label?, enabled?, onError:"stop"|"continue", retry?:0-5, config, position}`.

| Tipo | Config clave | Notas |
|---|---|---|
| `source_rss` | `{url, limit?}` | Los feeds mueren seguido; `onError:"continue"` y retry 1-2 |
| `source_nitter` | `{username, instanceUrl, limit?}` | Instancias públicas caen; prueba varias |
| `source_http` | `{url, listPath?, credentialId?, pagination?}` | JSON APIs; pagination `{maxPages≤10, nextPath}` |
| `ai` | `{provider, model, prompt, credentialId, maxItems?, responseFormat?, schema?}` | Único fan-in además de report; schema ≤2KB |
| `agent` | `{credentialId, prompt, tools?≤8, maxIterations?≤8}` | Loop agéntico BYOK, NO es el agente externo |
| `template` | `{templateId, frameId, format, maxItems?}` | Clona el frame EXACTO; imagen = URL pública, NUNCA base64 |
| `map` | `{value}` | **TRAMPA:** value es OBJETO `{"k":"{{input.x}}"}`, no string |
| `condition`/`switch` | `{path, operator, value}` / `{path, rules≤8}` | Edges con `when:"true"/"false"` o label/fallback |
| `wait_webhook` | `{timeoutMinutes, message?}` | PAUSA el run — ver §5 |
| `approval` | `{message?, timeoutMinutes?}` | Pausa esperando decisión humana |
| `http` | `{url, method?, body?, credentialId?}` | Webhook saliente, POST a terceros |
| `loop`/`merge`/`sort`/`dedupe`/`aggregate`/`limit`/`compare` | — | Utilidades sin código |
| `code` | `{js}` | JS puro, sin `node:*` |
| `subflow` | `{flowId, inputs?}` | Reusa otro flow (nunca `tool:{tool:"flow_*"}` — rechazado) |
| `text`/`report`/`note`/`group` | — | report = fan-in resumen; note/group solo visuales |

Edges: `[{from, to, when?}]`. Cualquier nodo acepta `when:"error"` (rama de
fallback si el nodo falla). Grafo conexo obligatorio.

Placeholders: `{{input.x}}` `{{steps.ID.y}}` `{{item.x}}` `{{vars.v}}`
`{{static.k}}` (storage persistente: `flow_static_data_get/set`).

## 4. Reglas duras (ignorar = rechazo o gasto)

1. **Sin secretos en config** — `credentialId` siempre (`flow_credentials_set`).
2. **Batches chicos** (3-5 items por corrida). Carga grande = VARIAS
   `flow_run` orquestadas por ti; cada run es 1 invocación corta (free-tier CPU).
3. **Idempotencia**: `requestId` con patrón `cron:<flowId>:<slot-de-5-min>` —
   reintentar no duplica el run (mismo requestId = mismo runId).
4. **Rate cap**: 240 runs/flow/hora; 429 = espera el slot siguiente, no
   reintentar en loop.
5. **Sin cron server-side**: trigger `schedule` es metadata declarativa. Si el
   usuario pide horario, programa TÚ el cron en tu runtime y llama `flow_run`
   cuando dispare (`flow_due_check` dice si el slot vence).
6. `enabled:true` exige TODO configurado; `enabled:false` guarda borrador.

## 5. Humano-en-el-loop: el flow le pasa la voz al agente (REQ-040)

Cuando el nodo de redacción lo debe hacer TU agente (no una key BYOK),
sustituye el nodo `ai` por `wait_webhook`:

```
source_rss → wait_webhook{message:"Redacta 3 hot takes…", timeoutMinutes:120}
          → template{...} → report
```

Qué pasa al dar play (verificado E2E en producción):

1. El run llega al `wait_webhook` y queda `status:"waiting"`.
2. El server hace **POST firmado** a la URL de wake del workspace:
   - Header `X-Musa-Signature: hex(hmac_sha256(secret, body))`
   - Body: `{type:"flow_wait", workspaceId, flowId, flowName, runId, nodeId,
     kind:"webhook"|"approval", message, resumeToken, expiresAt}`
   - Verifica la firma con el secret antes de actuar (anti-falsificación).
3. El agente receptor lee `flow_get` + `flow_history`, produce el contenido
   que pide `message`, y llama `flow_resume {resumeToken, payload}` → el
   MISMO run continúa (mismo runId) hacia template y report.
4. Para `kind:"approval"` el destino es el HUMANO: reenvía `message` al
   usuario y reanuda con `flow_resume {resumeToken, approved:true|false, note}`.

Setup de la URL de wake:

- `flow_wake_set {url, enabled:true}` → el secret se muestra **UNA vez** —
  cópialo; `flow_wake_get` después solo devuelve `secretHint` (últimos 4).
- `flow_wake_test` → POST de prueba firmado, devuelve el status HTTP que
  respondió el receptor. Úsalo siempre tras configurar.
- **Push, no pull**: NUNCA poll-ees `flow_history` esperando pausas. El wake
  es el evento; `flow_history {status:"waiting"}` es solo el fallback manual
  (1 llamada lista solo los runs pausados que piden acción).
- Si el agente no responde antes de `expiresAt`, el run expira marcado
  WAIT_EXPIRED — red de seguridad, no es error del flow.

Ejemplo vivo: flow "Chisme de X → hot takes (Ren's review)" — sin nodo `ai`;
el humano da play, el agente redacta 3 takes y el flow genera los frames solo.

## 6. Debug (flow_history primero, siempre)

- `flow_history` trae steps con `ok:false` y `error:{code,message}` por nodo.
  Corrige la config EXACTA del nodo, `flow_save` mismo `id`, `flow_run` de nuevo.
- 401/403 = credencial sin acceso o key revocada → `flow_credentials_set` de nuevo.
- RSS vacío = el feed murió → cambia la URL. Nitter caído = con
  `onError:"continue"` el run sigue con las otras fuentes.
- Output de steps es JSON STRING truncado — parsea antes de leer (ej. el
  `templateId` para limpieza).
- Pausa esperando = `flow_history {status:"waiting"}` (o el wake en tu receptor).
- `delete_template` es SOFT delete (`deleted_at`) — la limpieza real purga
  versions primero, luego rows.

## 7. Errores comunes y su fix en una línea

| Error | Fix |
|---|---|
| `VALIDATION: El nodo map necesita un objeto en config.value` | `map.value` va como objeto, no string |
| `AI_SCHEMA` | El output de la IA no cumplió el schema — afloja el schema o sube maxOutputTokens |
| `CREDENTIAL_MISSING` | Asigna credentialId al nodo y guarda |
| `WAIT_EXPIRED` | Nadie reanudó a tiempo → flow_run de nuevo (o baja el timeout) |
| `429` | Rate cap — espera el slot siguiente |
| Frames corruptos tras template | Alguna imagen iba base64 — usa URL pública |
