# GRAPH PLAYBOOK — Flows (pipelines dentro de Musa)

> Cuándo cargar este playbook: el usuario pide crear, ejecutar, programar o
> corregir un **flow** (pipeline determinista de Musa), o pide que un flow
> "le pase la voz" a un agente para redactar y continuar (humano-en-el-loop).

## 1. Qué es un flow

Pipeline de nodos que corre server-side: fuentes (RSS/Nitter/HTTP) → IA BYOK
o pausa-de-agente → plantillas/recetas del propio usuario → reporte. Se crea y
se opera 100% por tools MCP (`flow_save`, `flow_run`, `flow_history`, …) — la
UI es un cliente más. Un flow de noticias completo toma 2-3 min y ~200 tokens
de orquestación.

## 2. Camino rápido (60 segundos)

1. `flow_library_list` → elige preset. Los presets con **receta inline**
   (`recipe` en el nodo template) llegan VIVOS: solo falta la credencial IA.
   Los demás quedan desconfigurados a propósito (tu template+frame, tus keys).
2. `flow_library_instantiate {presetId}` → flow borrador con `pendingConfig`
   (vacío = listo para activar).
3. Resuelve el pending: (a) nodo `template` con `{templateId, frameId}` del
   usuario (list_templates → get_template para ver frames), (b) credencial IA
   con `flow_credentials_set {type:"ai_provider", provider, secret}` y su
   `credentialId` en el nodo `ai`.
4. `flow_save` (mismo `id`, con todo configurado) → `flow_run {flowId}`.
5. `flow_history {flowId}` → steps OK → los frames clonados viven en el
   template indicado en el output del nodo template.

**Inputs declarados (mini-form):** `flow_save` acepta
`inputs:[{key, label?, type?: text|textarea|number|date, required?, default?} ≤12]`
— al ejecutar, el engine aplica defaults y exige los `required` sobre
`{{input.x}}` (falta uno → `INPUT_REQUIRED` antes de ejecutar). Úsalo para
flows que el humano lanza con datos propios (evento, tema, cuenta).

## 3. Contrato de nodos (el server valida y rechaza)

Nodo: `{id, type, label?, enabled?, onError:"stop"|"continue", retry?:0-5, config, position}`.

| Tipo | Config clave | Notas |
|---|---|---|
| `source_rss` | `{url, limit?}` | Los feeds mueren seguido; `onError:"continue"` y retry 1-2 |
| `source_nitter` | `{username, instanceUrl, limit?}` | Instancias públicas caen; prueba varias |
| `source_http` | `{url, listPath?, credentialId?, pagination?}` | JSON APIs; pagination `{maxPages≤10, nextPath}` |
| `ai` | `{provider, model, prompt, credentialId, maxItems?, responseFormat?, schema?, webSearch?}` | Único fan-in además de report; schema ≤2KB; `webSearch:true` = búsqueda nativa del proveedor (los 8 cubiertos: gemini, anthropic, openai, deepseek, glm, kimi, qwen, openrouter — corre con la cuenta del proveedor) |
| `ai_task` | `{prompt, title?, timeoutMinutes? 1-1440 (default 240), requiredKeys?≤12}` | TERCERA pausa: encarga trabajo a la IA CLIENTE conectada (no a un proveedor server-side) — ver §5 |
| `agent` | `{credentialId, prompt, tools?≤8, maxIterations?≤8}` | Loop agéntico BYOK, NO es el agente externo |
| `template` | `{templateId, frameId, format, maxItems?, extraValues?≤16}` O `recipe:{width, height, html≤64KB, css, background?}` | Clona el frame EXACTO o usa receta inline; `extraValues` sustituye `{{token}}` arbitrarios (los del nodo pisan los del item); imagen = URL pública, NUNCA base64 |
| `map` | `{value}` | **TRAMPA:** value es OBJETO `{"k":"{{input.x}}"}`, no string. También acepta array o `{{steps.id.y}}` que resuelva a array (split out → `{items}`, máx 100) |
| `condition`/`switch` | `{path, operator, value}` / `{path, rules≤8}` | Edges con `when:"true"/"false"` o label/fallback |
| `wait_webhook` | `{timeoutMinutes 1-1440 (default 60), message?}` | PAUSA el run — ver §5 y §9 |
| `approval` | `{message?, timeoutMinutes?}` | Pausa esperando decisión humana |
| `http` | `{url, method?, body?, credentialId?}` | Webhook saliente, POST a terceros |
| `tool` | `{tool, args?, perItem?}` | Llama una tool de la paleta Musa (P0-P2; `flow_*` rechazado — usa `subflow`); `perItem:true` = UNA llamada POR item del upstream (máx 25 llamadas/run) |
| `loop`/`merge`/`sort`/`dedupe`/`aggregate`/`limit`/`compare` | — | Utilidades sin código |
| `code` | `{js}` | JS puro, sin `node:*` |
| `subflow` | `{flowId, inputs?}` | Reusa otro flow |
| `preview` | `{title?}` | Visualiza el resultado: colócalo al final, añade `view{kind}` acotada |
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

## 5. Humano-en-el-loop: tres pausas, tres públicos

Los nodos de pausa DETIENEN el run (`status:"waiting"` + `wait.resumeToken`)
y lo reanuda `flow_resume {resumeToken, payload}` — el MISMO runId continúa.

| Nodo | Quién atiende | Cómo se entera | Cómo reanuda |
|---|---|---|---|
| `wait_webhook` | TU agente (webhook receptor) | **Wake firmado** del server (abajo) | `flow_resume {resumeToken, payload}` |
| `ai_task` | TU IA cliente conectada al harness | `flow_ai_tasks` (bandeja: `{runId, title, message=briefing, resumeToken}`) | `flow_ai_complete {resumeToken, payload}` (alias guiado de flow_resume) |
| `approval` | El HUMANO | El agente le reenvía `message` | `flow_resume {resumeToken, approved:true|false, note}` |

### Wake event-driven (REQ-040, verificado E2E en producción)

Al entrar en waiting, el server POSTea a la URL de wake del workspace:

- Header `X-Musa-Signature: hex(hmac_sha256(secret, body))` — verifica la
  firma antes de actuar.
- Body: `{type:"flow_wait", workspaceId, flowId, flowName, runId, nodeId,
  kind, message, resumeToken, expiresAt}`.
- `kind:"webhook"` → tu agente lee `flow_get` + steps, produce lo que pide
  `message`, reanuda. `kind:"approval"` → el destino es el humano.

Setup: `flow_wake_set {url, enabled:true}` → el secret se muestra **UNA vez**
(cópialo; `flow_wake_get` después solo da `secretHint` últimos 4) →
`flow_wake_test` confirma entrega (devuelve el status HTTP del receptor).
**Push, no pull**: NUNCA poll-ees esperando pausas — el wake es el evento;
`flow_history {status:"waiting"}` es solo el fallback manual (1 llamada,
solo runs pausados). Sin respuesta antes de `expiresAt` → WAIT_EXPIRED (red
de seguridad, no error del flow).

### ai_task y requiredKeys (REQ-042)

- El briefing viaja en `wait.message` + `title` — el `message` ES la
  instrucción que el flow dejó para tu IA.
- `payload` de entrega es la SALIDA del nodo: lotes →
  `payload:{copys:[{fecha,gancho,cuerpo,cta,hashtags},...]}` (OBJETO con el
  array anidado — un array en el tope se rechaza) y el downstream lo lee como
  `{{steps.<id>.copys}}`. Atajo textual: `result:"..."` se entrega como `{result}`.
- `requiredKeys:["copys",...]` en el nodo: si tu payload no trae las claves,
  la espera NO se consume — sigue waiting con el MISMO token, con
  `payloadRejected` + `missingKeys`. Corrige y reintenta.
- Ejemplo vivo: flow "Chisme de X → hot takes (Ren's review)" y los presets
  "Copys en lote con TU IA (sin key)" / "Copys en lote → calendario + cards".

## 6. Biblioteca (presets vivos y desconfigurados)

`preset_noticias` (bandera — 2 RSS + redactor + post+story) ·
`preset_noticias_tech_en` · `preset_vigilancia` · `preset_chisme_x` ·
`preset_monitor_precio` · `preset_seo_geo` · `preset_testimonio` ·
`preset_calendario` · `preset_newsletter` · `preset_manual_marca` (receta
viva) · `preset_investigacion_web` (research con webSearch) ·
`preset_evento_recordatorio` (receta viva) · `preset_copys_lote` (calendario
+ cards) · `preset_copys_lote_ia` (sin key — usa ai_task) · `preset_blank`.

## 7. Debug (flow_history primero, siempre)

- `flow_history` trae steps con `ok:false` y `error:{code,message}` por nodo.
  Corrige la config EXACTA del nodo, `flow_save` mismo `id`, `flow_run` de nuevo.
- 401/403 = credencial sin acceso o key revocada → `flow_credentials_set` de nuevo.
- RSS vacío = el feed murió → cambia la URL. Nitter caído = con
  `onError:"continue"` el run sigue con las otras fuentes.
- Output de steps es JSON STRING truncado — parsea antes de leer (ej. el
  `templateId` para limpieza).
- Pausa esperando = `flow_history {status:"waiting"}`, el wake en tu receptor,
  o la bandeja `flow_ai_tasks` para ai_task.
- Pinning (debug): `flow_run` acepta `input.__pins = {nodeId: <salida congelada>}`
  — el nodo NO se ejecuta y usa esa salida.
- Tokens visibles sin valor en el frame = faltó `extraValues` para ese token.
- `delete_template` es SOFT delete (`deleted_at`) — la limpieza real purga
  versions primero, luego rows.

## 8. Errores comunes y su fix en una línea

| Error | Fix |
|---|---|
| `VALIDATION: El nodo map necesita un objeto en config.value` | `map.value` va como objeto, no string |
| `INPUT_REQUIRED` | El flow declara inputs required — pásalos en `flow_run {input:{...}}` |
| `AI_SCHEMA` | El output de la IA no cumplió el schema — afloja el schema o sube maxOutputTokens |
| `CREDENTIAL_MISSING` | Asigna credentialId al nodo y guarda |
| `WAIT_EXPIRED` | Nadie reanudó a tiempo → flow_run de nuevo (o sube el timeoutMinutes) |
| payload rechazado en ai_task | Faltan `requiredKeys` — el token sigue vivo, reentrega completo |
| `429` | Rate cap — espera el slot siguiente |
| Frames corruptos tras template | Alguna imagen iba base64 — usa URL pública |
| Tokens `{{...}}` visibles en el frame | Añade `extraValues:{token:valor}` en el nodo template |

## 9. wait_webhook para captura de leads (REQ-048)

El patrón FOMO+leads: el flow publica la pieza del evento, entra en
`wait_webhook` y tu receptor (webhook de registro) reanuda con
`flow_resume {resumeToken, payload}` por cada lead — nombre/email/canal viajan
en el `payload` y el downstream los lee como `{{steps.<id>.<clave>}}`.

- **Default 60 min** — corto a propósito. Para captura de un evento de un día
  súbela en el nodo: `config.timeoutMinutes` acepta **1-1440** (720 = media
  jornada, 1440 = 24 h). Regla razonable para eventos: ≥ la mitad de la
  duración del evento.
- **Al expirar** el resumeToken muere: un `flow_resume` tardío responde
  `WAIT_EXPIRED` y el run no continúa. Re-lanza `flow_run` — los leads ya
  capturados no se pierden (viven en tu receptor/CRM); el run solo continuaba
  el pipeline con ellos.
- El wake (§5) avisa a tu agente al ENTRAR en waiting — push, no pull. La
  bandeja de runs distingue `● IA conectada` de `● Sin IA conectada` para
  saber si alguien va a atender la pausa antes de que venza.

