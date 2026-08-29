# REQ-024 — Auto-captura del trabajo de agentes en el Kanban (cero tokens)

**Fecha:** 2026-08-28
**Pedido:** Que el Kanban tenga MCPs para que las IAs documenten todo, sin gastar tokens extra de Renzo. "¿Habrá manera de que el sistema capture lo que han hecho los agentes o el mensaje o algo?"

## Decisión de diseño

1. **El prompt del usuario NO es capturable server-side** — nunca llega al servidor MCP (viaja usuario↔agente↔LLM). Lo más cercano ya existía: `harness_start_session` exige un `plan` corto al reclamar tarea.
2. **Captura server-side automática (lo nuevo):** tras cada tool de escritura exitosa, el servidor agrega UNA línea sanitizada al activity log de la tarea activa. Cero tokens para el agente.
3. **Allowlist curada, no "capturar todo":** solo tools de entregable. Un agente que refina un diseño llama `set_html` 10–20 veces; capturar cada write ahogaría el feed. La lista vive en `netlify/functions/work-capture.mjs` (`CAPTURED_TOOLS`, verificada contra `tools_catalog.json`): estructura/diseño (create_template, create_html_frame, create_html_carousel, create_frame, import_design, set_html, set_css, set_frame_layers), batch (apply_csv_to_frames, render_batch, batch_render_html), copywriting (add_content_idea, update_content), media (ai_generate_image, generate_image_video, generate_text_video, remove_background, separate_image_layers).
4. **Tool explícita `studio_add_comment`** para decisiones/bloqueos que la captura no puede expresar (~30 tokens, opcional).
5. **Fuera los polls (misma tanda):** el auto-refresh del Kanban y el poll de comentarios cada 30s se eliminaron — refresh manual con F5. El autosave no se tocó. Razón: con 9 usuarios el consumo real de invocaciones Netlify venía del polling, no de los agentes.

## Implementación por capa

| Capa | Archivo | Cambio |
|---|---|---|
| Módulo puro | `netlify/functions/work-capture.mjs` (NUEVO) | `shouldCaptureMethod` (allowlist) + `summarizeCapturedCall` (línea ids/nombres/conteos/tamaños, máx 500 chars, nunca cuerpo HTML/CSS ni credenciales). Sin dependencias, testeable en Node (mcp.mjs NO es importable fuera del esbuild de Netlify). |
| Dispatcher | `netlify/functions/mcp.mjs` | `captureAgentWork(method, params, userId)`: resuelve la ÚNICA tarea activa de la cuenta (`design_kanban_tasks.account_id` + status draft/design, misma query del hard rule de `harness_claim_feature`) e inserta en `design_kanban_activity_log` con `created_by: "auto"`, `from_status === to_status`. Protegido con `Promise.race` de 3s + try/catch: documentar jamás rompe el tool call ni agrega >3s de cola. Wiring `await captureAgentWork(...)` en ambos call sites autenticados (tools/call y método directo). |
| MCP tool | `netlify/functions/mcp.mjs` | `studio_add_comment` (schema + handler): nota ≤500 chars al activity log con `created_by: "mcp"`. Catálogo 250→251. |
| Hardening | `netlify/functions/mcp.mjs` | `studio_get_card` ahora limita activity log y agent time a 200 filas (las tarjetas con historial largo no inflan respuestas). |
| UI | `src/components/KanbanTab.tsx` | Filas del activity log con `from_status === to_status` se renderizan como nota (sin flechas), con badge 🤖 si `created_by === "auto"`. Fuera el auto-poll (estado `pollConfig`, `lastPollRef`, fetch de `task_queue_get_config` e intervalo). |
| Polls | `src/components/EditorV2.tsx` | Fuera el `setInterval` de comentarios (30s). Queda la carga inicial. Autosave intacto; render worker (10s) intacto — ya estaba gateado por `renderPollEnabledRef`. |
| QA | `QA/mcp-auto-capture.test.mjs` (NUEVO) | 4 tests: allowlist captura/salta, línea con tamaños sin cuerpos HTML, conteos batch, params raros sin throw y acotados. |
| QA fix | `QA/crm-insights.test.mjs` | Assertion obsoleta por `af004b4` (Cuenta fusionada en General): ahora espera 3 secciones + `AccountSection` dentro de General. Fallaba en main antes de este REQ. |

## Cobertura de la captura (Fase 0 verificada)

- OAuth browser: `auth.userId` = UUID de Supabase ✓ captura
- API key de workspace (`fdr_ws_`): `userId = workspace_api_keys.created_by` (UUID del creador) ✓ captura
- Admin key (`userId: "admin"`) y dev: no-UUID → early exit, sin captura

## Flujo resultante para un humano leyendo el Kanban

`plan` (harness_start_session) → 🤖 create_template "Post lanzamiento" · tpl_abc → 🤖 set_html · tpl_abc · fr_88 · html 3.2KB → 🤖 apply_csv_to_frames · tpl_abc · rows 12 · csv 8.1KB → transición design→review (ya se logueaba) → notas explícitas via studio_add_comment.

## Costo

- Netlify: 0 invocaciones extra (la captura viaja en el call existente); ~100ms de duración en writes capturados, acotado a 3s.
- Supabase: 1 SELECT + 1 INSERT por write capturado (requests ilimitados en free); filas de ~0.3KB.
- Tokens de agentes: 0 (la captura es server-side); `studio_add_comment` es opcional y deliberada.

## Notas

- Sin migración SQL: se reusan `design_kanban_tasks` y `design_kanban_activity_log` existentes.
- El toggle "auto-refresh" de Configuración → Kanban queda inerte en el cliente (el server config sigue existiendo); limpiarlo de la UI es cosmético y quedó pendiente.
- Si algún día se quiere capturar más/menos, es editar `CAPTURED_TOOLS` en work-capture.mjs + su test.
