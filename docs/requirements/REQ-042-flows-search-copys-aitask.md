# REQ-042 — Flows: webSearch nativo en los 8 proveedores, copys en lote y ai_task (la IA cliente del usuario)

Fecha: 2026-10-09 · Estado: implementado (local) · Origen: OK explícito de Ren: "dale has todo, debe ser compatible para cloudflare y supabase en freemium", con dos correcciones que gobiernan el diseño: (1) la búsqueda web la hace CADA proveedor con SU clave y SU cuota; (2) la "IA" que atiende tareas NO es un proveedor server-side — es la IA CLIENTE que el usuario tiene conectada al harness MCP (Claude/Chatgpt/Codex/Hermes/OpenClaw/Replit/Cursor).

## 1. Objetivo

Tres piezas de una misma historia: el flow investiga en la web (A), produce copys en lote y los materializa en calendario + cards (C), y cuando el trabajo requiere "su" IA, el flow DEJA EL ENCARGO a la IA cliente del usuario en vez de gastar tokens de un proveedor (B). Todo en Cloudflare Workers + Supabase **freemium**, sin migraciones nuevas.

## 2. A — webSearch nativo (cada proveedor con su cuota)

`ai.config.webSearch?: bool` opt-in. Cero keys de búsqueda propias: la cuota es la del usuario en SU proveedor.

- **openai / deepseek**: Responses API (`/responses`) con `tools:[{type:"web_search"}]`; prompt viaja como `input`, system como `instructions`, cap `max_output_tokens`. Extracción `responsesOutputText` (shape `output[]`, items `message`) + fallback `output_text`; usage `input_tokens/output_tokens`.
- **glm**: `body.tools = [{type:"web_search", web_search:{enable:true}}]` en el MISMO request.
- **qwen** (compatible-mode): `enable_search:true` + `search_options:{forced_search:true}`.
- **kimi**: search-then-generate — POST `/tools/search_pro` `{text_query (prompt 0-400), limit:5, timeout_seconds:20}` → digest (`kimiSearchDigest`) inyectado al prompt con instrucción de citar fuentes `[n]`; sin resultados degrada con gracia. El builtin `$web_search` se retira 2026-10-20 y NO se usa.
- **gemini / anthropic / openrouter**: ya existían (google_search · web_search_20250305 · plugin web).
- El rechazo `AI_CONFIG` para los 5 directos **desapareció**: los 8 cubiertos.

## 3. C — copys en lote (calendario + cards)

- `tool.config.perItem?: bool` — una llamada POR item del upstream (cap `maxItemsPerTemplateNode`=5); los args leen `{{item.x}}`; 0 items → 0 llamadas; el dedupe de escritura (flow, nodo, args) aplica por item (anti doble publicación).
- `map.config.value` admite objeto (un item), array literal o UN placeholder exacto `{{steps.id.y}}` que resuelva a array — el "split out". El executor envuelve en `{items}` (cap 100) para que el downstream itere item a item.
- Curación de paleta corregida: `add_content_idea` traía un campo `text` inexistente; ahora `{scheduledDate, topic, copy}` contra el schema real (scheduledDate+topic requeridos).
- `preset_copys_lote`: inputs (tema/cantidad/fechaInicio/tono) → `ai` json (schema array de copys) → `map` split out → `add_content_idea` porItem + `template` RECETA 1080×1350 por copy (tokens gancho/cuerpo/cta/hashtags/fecha) → reporte.
- **Fix de engine (bug desde REQ-027)**: `executeNode` pre-resolvía `node.config` con `deepResolve` y `{{item.x}}` colapsaba a `""` ANTES de que el executor per-item lo leyera — el modo per-item del nodo ai JAMÁS se disparaba. Los executors per-item (ai y tool) leen ahora las plantillas crudas de `node.config`.

## 4. B — ai_task: la pausa que despierta a la IA CLIENTE

- **Tercer tipo de pausa** (`kind:"ai"` junto a webhook/approval): el run SE DETIENE y el briefing viaja en `wait.message` (prompt ya RESUELTO con placeholders) + `wait.title`. NO llama a ningún proveedor: el encargo lo atiende la IA cliente conectada al harness MCP. Una fila waiting no cuesta cómputo (freemium).
- `config`: `prompt` (requerido si el flow está activo, ≤20k), `title?` ≤120, `timeoutMinutes` 1-1440 (default **240** — la IA llega cuando el humano la despierta). Prohibido dentro de loop (WAIT_IN_LOOP heredado).
- **`flow_ai_tasks` (NUEVA)** `{workspaceId}` — la bandeja: runs `waiting` con `pending_state.kind==="ai"` vigentes → `[{runId, flowId, flowName, nodeId, nodeLabel, title, message, resumeToken, expiresAt, startedAt}]`. Arma la lista SIN releer la definición (el briefing ya vive en `pending_state`).
- **`flow_ai_complete` (NUEVA)** `{resumeToken, payload|result}` — entrega y continúa el MISMO run: valida `kind==="ai"` (si no, error claro → flow_resume), `result:"..."` se entrega como `{result}`, payload-array en el tope se RECHAZA con error (los arrays van anidados: `payload:{copys:[…]}`); el contrato `{value}` de `waitOutput` queda como red de seguridad para flow_resume.
- Estado persistido enriquecido (`pending_state`): `message` (slice 2000), `title`, `nodeLabel`, `flowName`.
- Wake (REQ-040) aditivo: el POST firmado puede traer `title` (los receptores viejos ignoran el campo).
- `flow_run` responde la `_note` correcta según kind y `wait` incluye `title`; `flow_resume` también reanuda ai_task (alias guiado); `flow_history` expone `waitingKind` + `title` en waiting (badges).
- `NODE_TYPES`: `ai_task` (29 tipos). Paleta del editor: «Tarea para tu IA» (utilidades, config `{prompt, title, timeoutMinutes:240}`), NODE_META color `#a5b4fc`.
- **`preset_copys_lote_ia`** (normie, SIN key): brief → `ai_task` encarga a la IA cliente (el briefing enseña a entregar con `flow_ai_complete` y `payload:{copys:[{fecha,gancho,cuerpo,cta,hashtags}…]}`) → `map` split out `{{steps.aitask1.copys}}` → calendario porItem + card por copy (misma receta) → reporte.

## 5. Herramientas afectadas

| Tool | Cambio |
|---|---|
| `flow_ai_tasks` | NUEVA — bandeja de tareas para la IA cliente |
| `flow_ai_complete` | NUEVA — entrega + resume guiado (381 tools en total) |
| `flow_run` | `_note` por kind; `wait` trae `title` para ai_task |
| `flow_resume` | doc: también reanuda pausas ai_task |
| `flow_history` | `waitingKind` + `title` en runs waiting |

## 6. Storage (Supabase freemium)

**CERO migraciones**: `resume_token` + `pending_state` (v64) ya persisten las pausas; el wake ya era push. CF Workers: jsonb viaja en la fila, sin cambios.

## 7. Decisiones

- **D1 ai_task = pausa, no proveedor**: corrección explícita de Ren ("ya te dije que no es la IA de Musa"). La IA del usuario trabaja con SU suscripción y TODAS las tools MCP; Musa no paga tokens ni expone keys.
- **D2 reutilizar las pausas v64**: cero migración, el wake funciona gratis desde el día 1; flow_ai_tasks es un filtro barato sobre flow_runs waiting.
- **D3 payload objeto explícito**: rechazar arrays en el tope con error claro enseña el contrato (más "explícito" que envolver en silencio).
- **D4 default 240 min**: ventana generosa para que el humano despierte a su IA; la expiración sigue el camino común (WAIT_EXPIRED).
- **D5 búsqueda nativa por proveedor** (parte A): la misma IA del nodo investiga — sin accounts de búsqueda nuevas ni proxy propio.

## 8. QA

`QA/req042-search-calendar-aitask.test.mjs` — 20 tests (P042-1..20): A = Responses/glm/qwen/kimi + cobertura de los 8 sin rechazo viejo; C = tiers/flags de calendario, curación de args, perItem runtime (N llamadas/cap/0 items/dedupe), split out en validación, preset, fix per-item de ai; B = validación ai_task (prompt/timeout/title), pausa con kind:"ai" + briefing resuelto + estado enriquecido, resume con `payload:{copys}` que continúa solo (split out → calendario por item), preset sin key; Anexo = requiredKeys (validación + gate del runtime + superficie mcp), onStep (contrato del engine + wiring del runtime), feedback en vivo y pausa visible en la UI. Regresión: req027 (15 presets + NODE_TYPES 29) + req040 + req041 — **121 tests verdes**.

## 9. Anexo post-B (ronda picky de Ren)

Tres mejoras sobre B, mismas restricciones (freemium, cero migraciones, sin cron):

- **`ai_task.config.requiredKeys?: string[]`** (≤12): claves que el payload de la IA cliente DEBE traer (p. ej. `["copys"]`). El gate vive en `resumeFlowRun` ANTES de marcar el run `running`: si falta una clave (o llega vacía — `""`/`[]` cuentan como faltantes), el run **SIGUE esperando con el MISMO token** — la fila no se toca (cero escrituras) y la respuesta trae `payloadRejected:true + missingKeys:[…]` con `_note` accionable; `flow_ai_complete` y `flow_resume` ambas la exponen. Explícito > continuar el flow con una salida vacía.
- **Feedback en vivo del canvas**: el engine ya notificaba cada nodo vía `deps.onStep`; el runtime ahora lo cablea para **persistir steps por nodo** (`runFlow` y `resumeFlowRun`, un updateRun chico por nodo, ≤25/run — solo gasta MIENTRAS ejecuta, cero cron). El editor envuelve TODOS sus puntos de run (`trackRun`): sondea `flow_history` (1.5s) mientras `flow_run` vuela y pinta el canvas — nodo en ejecución **verde** con anillo + "…", al pasar **✓ verde**, al fallar **✗ roja** con tooltip del error exacto **y ahí se queda** hasta el próximo run. El resultado final SIEMPRE gana al sondeo.
- **La pausa es visible**: el modal de resultado renderiza la espera (badge por kind — «Tarea para tu IA»/aprobación/webhook), el briefing (`wait.message/title`), el `resumeToken` copiable y la expiración; los historiales (tab + editor) muestran chip del tipo de espera (`waitingKind` + `title`). Antes el normie no veía que su IA tenía un encargo.
