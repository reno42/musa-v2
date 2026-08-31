# REQ-017 — Calendario: drag & drop, Archivo editable/clickeable y loop agente completo

**Fecha:** 2026-08-27 · **Estado:** implementado (commit siguiente a 19ea497)

## Problema

1. Mover una pieza del calendario a otro día exigía editar el campo Fecha en la
   hoja — la interacción natural (arrastrar) no existía.
2. La columna Archivo mostraba "abrir diseño" (no editable) O un input de
   enlace (no abrible), nunca ambas cosas.
3. El loop "IA propone calendario → humano aprueba → IA diseña todo con el
   estilo de una referencia y adjunta los ids" era posible con las herramientas
   de REQ-016 pero ninguna guía se lo enseñaba a un agente nuevo.

## Solución

- **Drag & drop** (ContentTab): cada pieza es `draggable`; soltar sobre una
   celda hace `PATCH scheduled_date` con el mismo patch optimista de la hoja.
   Feedback: pieza al 35% de opacidad, celda destino con outline punteado, y
   hint textual en la barra del mes.
- **Columna Archivo**: input monoespaciado edita `template_id` + botón `↗`
   que llama `onOpenTemplate` (abre el editor sin salir de la hoja). Deshabilitado
   sin id.
- **Playbook `content-calendar`** (docs/GRAPH_PLAYBOOK_CONTENT_CALENDAR.md,
   272 líneas): DAG contexto → propuesta (`add_content_idea` con copy borrador,
   status `idea`) → **compuerta humana** (drag & drop / hoja / ajustes vía
   `update_content`) → extracción de estilo (`get_design_system`) → lote de
   diseños (`create_template` + `import_design` + `lint_design` ≥ 80) → adjuntar
   (`update_content { templateId }`) → verificación (`list_calendar_entries`).
   Registrado en: enum de `get_playbook`, mapa PLAYBOOKS, índice de
   `get_agent_guide`, índice de `initialize._agentGuide`, tabla de intents de
   SKILL.md y `mcp.json`.
- Corregidas 8 cadenas desactualizadas que mandaban a "Settings → API Keys"
   (pestaña eliminada en af004b4): ahora "Settings → API MCP → Crear clave".

## Seguridad

Sin nuevas rutas ni tablas. El drag & drop y el input de Archivo usan los
endpoint REST ya existentes (`PATCH /api/content/:id`) con RLS vigente; el
playbook solo documenta herramientas ya autorizadas por `authorizeMcpCall`.

## Verificación

- `node --check netlify/functions/mcp.mjs` ✓
- `public/.well-known/mcp.json` parsea como JSON válido ✓
- `npm run build` verde (tsc + vite; copy-skill publica SKILL.md y el playbook) ✓
- En producción: arrastrar una pieza a otro día y refrescar; pegar un
  templateId en Archivo y pulsar ↗; y desde cualquier IA conectada:
  `get_playbook({ name: "content-calendar" })`.
