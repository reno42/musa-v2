# PROMPT — Agente IDE: implementar REQ-027 Flows (flow builder MCP-first en Musa)

Copia y pega esto al agente con IDE (Qoder) trabajando en `C:\Users\Renzo\design-check` (repo reno42/design, rama main). El REQ y el motor de referencia YA ESTÁN en el repo — no inventes nada de cero.

---

## Tu tarea

Implementa **REQ-027** completo. Lee PRIMERO y OBLIGATORIamente:

1. `docs/requirements/REQ-027-flows-builder-mcp-first.md` — la especificación completa (alcance, schema SQL, tools MCP, UI, biblioteca, verificación). Este doc manda: si algo de este prompt contradice el REQ, gana el REQ.
2. `flows-engine/README.md` + `flows-engine/src/` — el motor de referencia YA PORTADO y probado en Node 22. Reutilízalo, no lo reescribas:
   - `automation-flow-engine.mjs` → motor: `executeNode`, `deepResolve`, `runFlow`, validators (`validateAutomationFlowStore`), SSRF-guard (`assertPublicHttps`, `blockedIp`), timeouts, límites de output
   - `automation-ai.mjs` → nodos IA (Gemini/DeepSeek/GLM, BYOK por HTTP)
   - `newsroom-pipeline.mjs` → pipeline noticias: RSS/Nitter → redactar → frames en Musa vía tools `musa__*`
   - `flows-mcp.mjs` → referencia de cómo se envuelve en MCP (stdio ahí; aquí será tools HTTP dentro de `/mcp`)

## Puntos de integración EXACTOS en el repo

- **Tabs**: `src/lib/appRoute.ts` → `WORKSPACE_TABS` (agrega `"flows"` entre `"contactos"` y `"configuracion"`; replica la validación de las demás tabs). `src/components/Dashboard.tsx` → lista de tabs con iconos (agrega Flows con el mismo patrón que Contactos; subs: `flows`, `library`, `runs`).
- **Grid estilo Archivos**: el grid de Mis Flows clona la lógica de Diseño → Archivos en Dashboard.tsx (cards, click → abre editor de flow en vez del editor de diseño; renombrar/duplicar/borrar; chip estado + último run).
- **MCP**: las tools nuevas van en `netlify/functions/mcp.mjs` (el endpoint `/mcp`; el Worker lo importa directo — ver `worker/index.js`). Auth: derivar `workspaceId` de la key de la request (mismo patrón que las tools existentes). NUNCA aceptar workspaceId del input.
- **Ruteo interno de nodos `template`**: el runtime llama a las tools internas existentes de Musa (`get_html_frames`, `create_template`, `import_design`, `upload_image`) — mira cómo lo hace `newsroom-pipeline.mjs` (`callMusa` + retry + unwrap del shape bruto `{content, isError}`; el contrato es devolver el shape MCP bruto, NO JSON pre-parseado).
- **Storage**: migración nueva `supabase_migrations_v58.sql` con `flows` + `flow_runs` (SQL completo en el REQ §3) + RLS por workspace + índice `(flow_id, started_at DESC)`. Aplícala al Supabase del proyecto al terminar (`secret key` en las vars existentes del repo).

## Orden de construcción (hazlo en este orden, verificando cada paso antes del siguiente)

1. **Migración v58** + validators portados de `flows-engine` (límites REQ: 20 flows/workspace, 40 nodos, 60 edges, grafo conexo, edges válidos).
2. **Tools MCP CRUD**: `flow_save`, `flow_list`, `flow_get`, `flow_delete`, `flow_history`, `flow_export`, `flow_import`, `flow_library_list`, `flow_library_instantiate`, `flow_run`. Schemas de input en Zod como las demás tools. Descripción de cada tool prompt-friendly (las IAs externas las leerán): incluye en `flow_run` el patrón de batches chicos (≤3 noticias por corrida; cargas grandes = varias corridas orquestadas por la IA) y en `flow_save` la firma `created_by: 'ai:<model>'` al crear.
3. **Runtime de ejecución** (`flow_run`): port de `executeNode`/`deepResolve` con los guards del engine (SSRF: bloquear IPs privadas, exigir HTTPS público; timeout por nodo; response limit 256KB). Nodos v1: `source_rss`, `source_nitter`, `source_http`, `ai`, `template`, `http`, `map`, `condition`, `text`, `report`. **Parser RSS propio y chico** (regex/DOM sobre el XML): `rss-parser` NO corre en Workers — no lo importes. Sin `node:fs` ni `node:child_process`: nada de filesystem en runtime (el store es Supabase).
4. **Nodo `template`**: clona el frame elegido (`{templateId, frameId}` en config) y aplica el contenido que llega de nodos previos (title/summary/imageUrl → slots del frame; imagen siempre `upload_image` → URL firmada, NUNCA base64 — pitfall conocido que corrompe templates).
5. **UI — Tab Flows**: Mis Flows (grid) → **Editor de flow**: canvas de nodos+edges (drag, conectar, borrar; la UI de referencia visual es el panel Automatizaciones del bridge xiaozhi-musa — canvas simple, no hace falta librería pesada; puede ser SVG absolute-positioned) + panel de propiedades del nodo (right panel estilo contextual del editor). Trigger manual/webhook/schedule (schedule = metadata informativa, SIN scheduler server-side — decisión de Ren, no lo implementes).
6. **Picker del nodo template (requisito clave de Ren)**: 2 niveles — (a) grid de archivos del workspace con thumbnails (mismo fetch que Diseño→Archivos), (b) al elegir archivo, lista SUS frames con `get_html_frames` (nombre + w×h) → click guarda `{templateId, frameId}`. Caso de uso a soportar: un archivo con post y story = 2 nodos template apuntando a frames distintos.
7. **Biblioteca**: `src/data/flowLibrary.ts` con los 10 presets del REQ §6 (JSON de flows sin credenciales; el de noticias = bandera: 2 RSS + ai redactor + 2 nodos template post/story + report). `flow_library_instantiate` clona al workspace.
8. **Ejecuciones** (sub-tab runs): tabla de `flow_runs` del workspace con detalle paso a paso (steps: nodeId, ok, ms, error).
9. **Export/Import**: botones en Mis Flows (descarga .json / pegar JSON), usando `flow_export`/`flow_import`.

## Reglas duras

- **MCP-first**: toda acción de la UI pasa por las tools del `/mcp` (la UI llama via `mcpCall` como hace el resto del dashboard). Cero lógica de negocio solo-en-UI.
- **Sin cron server-side.** El trigger schedule es metadata. Los horarios los disparan las IAs del usuario llamando `flow_run`.
- **Free-tier Workers**: nada de procesos largos; cada `flow_run` es UNA invocación corta (I/O-bound). Prohibido loops CPU-pesados sobre datasets grandes.
- **No tocar**: templates/frames existentes, el Calendario, el editor de diseños, `CanvasGuides.tsx`, `EditorV2.tsx` (salvo el mínimo si el router central lo exige — y avísalo en el reporte).
- **Commit por fase** (9 commits alineados al orden de arriba), mensajes descriptivos, SIN push (Ren revisa). Al final de cada fase: reporte de qué quedó, qué falta y cualquier desvío del REQ.
- Si el REQ y la realidad del código chocan (nombres, rutas, patrones que ya no existen), NO improvises: deja el hallazgo anotado en `docs/requirements/REQ-027-*.md` como sub-sección "Hallazgos del implementador" y sigue con lo que sí se puede.

## Verificación final (del REQ §"Verificación", obligatoria)

1. curl al `/mcp` con una key de workspace: `flow_save` (flujo de noticias con 1 feed BBC + 2 max) → `flow_run` → template creado en el workspace → `flow_history` con steps OK.
2. UI: pestaña Flows visible entre Contactos y Configuración; grid → click → editor; export → import OK.
3. Nodo template: archivo con 2 frames → flow con 2 nodos template (post + story) → ambos diseños creados.
4. Biblioteca: instantiate "Noticias" → flow clonado ejecutable.
5. Simulación de IA externa: con solo las tools (sin UI), listar, ejecutar, leer history, corregir (cambiar un feed) y re-guardar.
