# Tools de Musa como nodos de Flow — Catálogo y propuesta

- **Fecha**: 2026-10-07
- **Estado**: PROPUESTA (no implementado). Complementa `FLOW_BUILDER_GAP_VS_N8N_V2.md`.
- **Pregunta que responde**: si quisiéramos exponer las tools que Musa ya tiene (374 en el catálogo) para usarlas dentro de los flows, ¿cuáles agregaríamos? Respuesta corta: **todas las que tienen sentido headless, en 4 tandas por prioridad, más una lista explícita de excluidas con motivo.**

---

## 1. Lo que ya existe hoy (base sobre la que se construye)

El motor de flows ya puede llamar tools de Musa por tres vías:

1. **Nodo `template`**: llama `get_html_frames`, `create_template` y rellena frames HTML por item — el primer puente producción engine→MCP.
2. **Nodo `agent`**: loop de tool-use real. Recibe `config.tools` (allowlist de hasta 8 nombres), y el modelo decide llamarlas turno a turno (`{"tool":"x","args":{...}}`), con memoria opcional (`flow_history`) y `maxIterations <= 8`.
3. **`createFlowToolBridge()`** ([mcp.mjs](netlify/functions/mcp.mjs)): dispatch sintético con auth de admin que reusa el MISMO `handleMethod` de `/mcp` — una sola implementación, cero drift. El tenant viaja explícito en cada llamada (`workspaceId`/`templateId`).

Nodos actuales del engine: `source_rss`, `source_nitter`, `source_http`/`http` (con credenciales bearer/api_key/basic/oauth2), `map`, `condition`, `text`, `report`, `ai`, `agent`, `template`, `sort`, `dedupe`, `aggregate`, `limit`, `merge`, `wait`, `wait_webhook`/`approval`, `code`. Triggers: `manual`, `schedule` (flow_due_check), `webhook`.

**Conclusión**: no hace falta inventar un mecanismo nuevo; hace falta (a) un nodo genérico determinista `musa`, (b) nodos curados para los casos de mayor valor, y (c) una allowlist gobernable.

## 2. Arquitectura propuesta (tres capas)

### 2.1 Nodo genérico `musa` (el 80% del valor con un solo caso nuevo)

```text
{ id: "m1", type: "musa", label: "Responder DM",
  config: {
    tool: "reply_social",
    args: { messageId: "{{inbox[0].id}}", text: "{{ia.respuesta}}" },
    output: "json"            // parsea content[0].text; si es array → { items }
  } }
```

- `config = deepResolve(node.config, context)` ya interpola `{{...}}` con la salida de nodos anteriores — cero trabajo extra.
- El output JSON de la tool entra al pipeline como cualquier nodo (filtra con `condition`, transforma con `sort`/`limit`, decide con `ai`).
- Es el equivalente del "Execute Command / HTTP Request" de n8n pero contra el propio Musa.

### 2.2 Nodos curados (azúcar para los flows frecuentes)

Igual que `template` hoy: un caso en `executeNode` con schema propio, validación amable, mapping fijo de entrada/salida y previsualización en el editor. Se reservan para las ~15 tools que formarán el 90% de los flows reales (sección 4, prioridad P0).

### 2.3 Nodo `agent` con allowlist ampliada (el 20% creativo)

El nodo agent ya existe; la mejora es solo de gobernanza: una constante `FLOW_AGENT_TOOLS` con las tools de lectura/búsqueda seguras para que la IA las use como "manos" (buscar stock, consultar marca, leer inbox) sin poder escribir fuera del workspace del run.

### 2.4 Salvaguardas no negociables

1. **Tenant forzado**: el bridge es admin sintético; el nodo `musa` debe SOBREESCRIBIR `args.workspaceId = workspaceId del run` y rechazar cualquier override. Igual para `templateId` (validar `resolveTemplateWorkspace`, como hace el nodo `template`).
2. **Allowlist por tiers** (`FLOW_TOOL_ALLOWLIST` en flows-core): una tool solo es invocable si su tier está habilitado; lo excluido en la sección 9 no pasa nunca.
3. **Idempotencia de escrituras**: clave de dedupe `(flowId, nodeId, runId, hash(args))` para `reply_social`, `publish_content`, `create_crm_*` — los webhooks y schedules reintentan, y publicar dos veces el mismo reply es el peor fallo posible.
4. **Presupuesto por run**: nuevo límite `LIMITS.maxToolCallsPerRun` (sugerido: 25) y las tools caras (`render_batch`, `video_export`, `process_daily_batch`) consumen más del presupuesto de `deadline`.
5. **Auditoría**: `flow_history` ya guarda steps; añadir `{ tool, argsSinSecretos, duración }` al step del nodo `musa`.
6. **Errores accionables**: mapear los errores MCP (`-32602` validación, permisos, etc.) a `flowCode` del estilo existente (`MUSA_TOOL_INVALID`, `MUSA_TOOL_DENIED`, `MUSA_TOOL_RATE`).
7. **Credenciales**: los args nunca aceptan claves; lo que requiere secret va por `flow_credentials` (ya existe la infraestructura).

---

## 3. Criterios de prioridad

| Tier | Significado |
|---|---|
| **P0** | Headless-ready hoy + alto valor de automatización + barato. Primera tanda. |
| **P1** | Alto valor con salvaguardas (idempotencia, coste) o dependencia menor. Segunda tanda. |
| **P2** | Útil pero pesado (rendido async), nicho, o requiere patrón de polling. Tercera tanda. |
| **P3** | Esperar a demanda real; CRUD que un humano hace mejor en UI. |
| **EXCL** | No se expone a flows. Motivo en la sección 9. |

"Headless-ready" = la tool no depende de una sesión de canvas del editor ni de un flujo OAuth interactivo.

---

## 4. Social y contenido (12 tools) — el mejor caso de uso de flows

| Tool | Enfoque | Uso típico en flow | Tier |
|---|---|---|---|
| `list_social_inbox` | Curado | Trigger de proceso: leer bandeja, filtrar no respondidos | **P0** |
| `reply_social` | Curado (idempotente) | Responder con el texto que redactó un nodo `ai` | **P0** |
| `capture_social_contact` | Curado (idempotente) | Comentario/DM → contacto del CRM automático | **P0** |
| `publish_content` | Curado (idempotente) | Publicar el carrusel/render que generó el flow | **P0** |
| `add_content_idea` | Curado | Capturar ideas al calendario desde webhooks/IRL | **P0** |
| `list_calendar_entries` | Curado | Leer el calendario para decidir qué publicar hoy | **P0** |
| `update_content` | musa | Reagendar/editar contenido en pipelines de publicación | P1 |
| `list_social_accounts` | musa / agent | Resolver accountIds para publish/reply | P1 |
| `get_attribution_report` | Curado | Reporte semanal → notify por http/Slack | P1 |
| `list_campaign_report` | musa | Métricas de campaña dentro de reportes | P1 |
| `delete_content` | musa | Despublicar (destructivo, con `dryRun` primero) | P3 |
| `set_publish_defaults` | — | Config de cuenta, no acción de flow | EXCL |

**Flow estrella**: webhook/schedule → `list_social_inbox` → `ai` clasifica y redacta → `capture_social_contact` → `reply_social` → `report`.

## 5. CRM / contactos (10 tools) — el segundo pilar

| Tool | Enfoque | Uso típico en flow | Tier |
|---|---|---|---|
| `create_crm_contact` | Curado (idempotente) | Lead de webhook/formulario → CRM | **P0** |
| `create_crm_deal` | Curado (idempotente) | Crear deal al capturar lead caliente | **P0** |
| `log_interaction` | Curado (idempotente) | Registrar cada touchpoint automático | **P0** |
| `get_crm_overview` | Curado | Pipeline digest diario/semanal → report | **P0** |
| `list_crm_deals` | Curado | Filtrar deals por etapa para seguimiento automático | P1 |
| `list_interactions` | musa | Historial de un contacto para dar contexto al `ai` | P1 |
| `update_crm_deal` | musa | Mover etapa cuando el flow detecta señal | P1 |
| `create_crm_contact` duplicado de captura social | — | (ver `capture_social_contact`) | — |
| `update_crm_contact` | musa | Enriquecer datos tras terceros | P2 |
| `update_crm_deliverable` | musa | Marcar entregables al renderizar/publicar | P2 |
| `update_crm_brand` | musa | Vincular marca al pipeline | P3 |

## 6. Copywriting (4 tools)

| Tool | Enfoque | Uso típico | Tier |
|---|---|---|---|
| `list_copy_recipes` | musa / agent | Que el `ai` elija receta vigente antes de redactar | P1 |
| `create_copy_recipe` | musa | Guardar receta aprendida por el flow (con approval humano) | P3 |
| `update_copy_recipe` | musa | — | P3 |
| `delete_copy_recipe` | musa | — | P3 |

Nota: la redacción en sí la hace el nodo `ai` con `ai_generate_text` por debajo; no hace falta exponer la tool.

## 7. Design — plantillas, frames, HTML (la familia grande)

### 7.1 Render y export (lo que cierra el círculo generar→archivo)

| Tool | Enfoque | Uso típico | Tier |
|---|---|---|---|
| `render_batch` | Curado (caro, presupuestado) | Render masivo de frames → PNG/JPG para publicar | **P0** |
| `batch_render_html` | Curado (caro) | Variante HTML del render masivo | **P0** |
| `export_frame` | Curado | Export de UN frame (previews, thumbnails) | P1 |
| `render_frame_png` | Curado | PNG puntual de un frame | P1 |
| `render_to_formats` | musa | Mismo diseño → varias salidas | P1 |
| `render_html_template` | musa | Snapshot HTML de una pieza | P2 |
| `export_template` | musa | Empaquetar diseño terminado | P1 |
| `export_pdf` | musa | Deck → PDF (entregables) | P1 |
| `export_batch` | musa | Export en lote | P2 |
| `copy_as` | musa | Duplicar a otro formato/tamaño | P2 |

### 7.2 Lectura e introspección (combustible del nodo `agent`)

| Tool | Enfoque | Uso típico | Tier |
|---|---|---|---|
| `list_templates` | musa | Descubrir templateIds dinámicamente | P1 |
| `find_templates` | musa | Buscar por tag/nombre dentro del flow | P1 |
| `get_template` | musa | Estado de una pieza para condicionales | P1 |
| `get_template_structure` | musa | Estructura de slots antes de rellenar | P1 |
| `list_frames` / `get_frame` | musa | Resolver frameIds (el nodo `template` ya lo hace internamente) | P1 |
| `get_html_frames` | Curado | Ya en producción vía nodo `template` | P1 |
| `analyze_template_structure` | musa | Auditoría de estructura en pipelines de marca | P2 |
| `list_workspace_texts` / `list_all_texts` | musa | Inventario de textos para traducir/personalizar | P2 |
| `get_file_meta` / `set_file_meta` | musa | Metadatos de pipeline (campaña, estado) | P2 |
| `query_design_graph` | musa | Consultas GraphForge desde flows | P2 |
| `get_metrics` | musa | Métricas de uso en reportes | P3 |
| `list_fonts` / `list_assets` | musa | Inventario para validaciones | P2 |

### 7.3 Edición headless de HTML (personalización determinista)

| Tool | Enfoque | Uso típico | Tier |
|---|---|---|---|
| `edit_text_content` | Curado | Swap de textos por item (mail-merge visual) | P1 |
| `update_element` / `add_element` | Curado | Inyectar datos en slots por selector | P1 |
| `set_html` / `set_css` | Curado | Templating crudo controlado por `code` + `musa` | P1 |
| `get_css_variables` / `set_css_variable` | musa | Tematizar por marca en pipelines | P1 |
| `extract_variables` / `apply_variables` | musa | Datos → variables de plantilla → aplicar | P1 |
| `remove_element` / `reorder_element` / `change_element_tag` | musa | Cirugía menor de plantilla | P2 |
| `add_primitive` | musa | Insertar primitivas | P2 |
| `assemble_template` | musa | Ensamblar template desde secciones | P2 |
| `create_html_frame` / `update_html_frame` | musa | Superficies nuevas en pipelines de generación | P1 |
| `delete_html_frame` | musa | Limpieza (destructivo) | P3 |
| `create_html_template` | musa | Plantilla desde cero en flows generativos | P2 |
| `create_html_carousel` | Curado | Carrusel IG desde items del flow | P1 |
| `create_deck` | musa | Deck desde items | P2 |
| `enhance_template` | musa | Mejora asistida | P2 |
| `create_frame` / `duplicate_frame` / `update_frame_content` / `get_frame_changes` | musa | Gestión de frames | P2 |
| `delete_frame` | musa | (destructivo) | P3 |
| `create_template` / `duplicate_template` / `update_template` / `rename_template` | musa | CRUD ya usado internamente por el nodo `template` | P2 |
| `delete_template` | musa | Limpieza de piezas temporales (destructivo) | P3 |
| `list_versions` / `diff_versions` | musa | QA de cambios entre runs de generación | P2 |
| `list_snapshots` / `save_version` | musa | Puntos de control en pipelines largos | P3 |
| `restore_version` | musa | Rollback programático (destructivo, con approval) | P3 |
| `tag_template` / `untag_template` | musa | Organización automática por campaña | P2 |
| `update_thumbnail` / `upload_cover_image` | musa | Portadas automáticas | P3 |
| `smart_layout` | musa | Re-layout asistido | P2 |
| `import_template` / `import_svg` | musa | Ingesta de plantillas externas | P2 |
| `save_recipe` / `list_recipes` / `get_recipe` / `create_from_recipe` | musa | Recetas de diseño reutilizables | P2 |
| `create_from_plantilla` | musa | Instanciar desde plantilla base | P2 |
| `profile_template_pool` / `generate_csv_template` / `apply_csv_to_frames` / `list_batch_templates` | Curado | CSV → frames (mail-merge masivo de catálogo) | P1 |
| `create_chart` | Curado | Chart desde datos del flow (reportes visuales automáticos) | P1 |

### 7.4 Vector, formas, máscaras (38 tools)

Estas tools operan sobre el estado de diseño del template. Son válidas headless vía MCP, pero en flows solo aportan en pipelines generativos muy específicos. Veredicto: **P3 vía nodo `musa`**, ninguna curada, y con la regla de que el nodo `agent` NO las recibe (las decide mal sin contexto visual).

`draw_shape`, `draw_path`, `draw_bezier`, `edit_path_points`, `edit_path_point`, `shape_to_path`, `pathfinder`, `offset_path`, `outline_stroke`, `set_stroke_style`, `set_gradient`, `set_pattern_fill`, `set_blend_mode`, `set_corner_radius`, `transform_element`, `group_elements`, `align_elements`, `set_paint`, `create_mask_from_path`, `invert_mask`, `fill_mask`, `mask_brush`, `generate_svg`, `generate_ui_components`, `lock_element`, `hide_element`, `set_frame_layers`, `set_canvas_layers`, `create_variable`, `link_variable`, `set_pseudo_state`, `copy_style`, `paste_style`.

| Excepciones con más sentido en flow | Tier |
|---|---|
| `vectorize_image` (photo→vector en pipelines de activos) | P2 |
| `remove_background` (limpieza de imágenes para composiciones) | P1 |

## 8. Assets, fuentes, stock, iconos

| Tool | Enfoque | Uso típico | Tier |
|---|---|---|---|
| `search_stock_image` | Curado / agent | Encontrar foto de stock para la pieza del día | P1 |
| `upload_image` | Curado | Subir asset descargado en el pipeline | P1 |
| `optimize_image` | Curado | Optimizar antes de publicar | P1 |
| `replace_asset` | musa | Swap de asset en plantillas | P2 |
| `delete_asset` | musa | (destructivo) | P3 |
| `search_icons` / `get_icon_svg` / `insert_icon` | musa | Iconografía automática por tema | P2 |
| `search_illustrations` / `get_illustration_svg` / `resolve_icon_hints` | musa | Ilustración/stock vectorial | P2 |
| `get_font_details` / `add_font_to_template` | musa | Fuentes en pipelines generativos | P3 |
| `search_google_fonts` / `match_font` / `preview_font` | musa | Matching tipográfico | P2 |
| `match_color` / `suggest_color_palette` | musa | Paleta desde imagen/referencia | P2 |
| `font_list_custom` | musa | Inventario de fuentes custom | P3 |
| `font_upload_custom` / `font_delete_custom` / `font_usage_custom` | musa | CRUD de fuentes | P3 |

## 9. Brands y design systems — QA automático de marca (el otro gran caso)

| Tool | Enfoque | Uso típico | Tier |
|---|---|---|---|
| `validate_brand` | Curado (gate) | Cada pieza generada pasa por el validador antes de publicar | **P0** |
| `lint_design` | Curado (gate) | Lint + `condition` = publicar solo si pasa | **P0** |
| `check_contrast` / `check_accessibility` | Curado (gate) | Accesibilidad como condición del pipeline | P1 |
| `get_brands` / `resolve_brand` / `get_brand_playbook` | musa / agent | Contexto de marca para el `ai`/`agent` | P1 |
| `apply_brand` / `apply_brand_to_template` | Curado | Aplicar tokens de marca a lo generado | P1 |
| `auto_fix_brand` | musa | Autocorrección (con approval si es publicada) | P2 |
| `get_brand_graph` | musa | Relaciones de marca | P2 |
| `get_design_system` / `extract_design_system` | musa | Extraer DS de una pieza | P2 |
| `verify_design_system` / `export_design_tokens` | musa | Verificación y export de tokens | P2 |
| `generate_design_artifacts` / `get_design_artifacts` / `generate_brand_manual` | musa | Manuales de marca programados | P2 |
| `create_design_system_from_asset` | musa | DS desde asset de referencia | P2 |
| `create_brand_guideline` / `list_brand_guidelines` / `get_brand_guideline` | musa | Consulta y alta de guías | P2 |
| `update_brand_guideline` / `delete_brand_guideline` / `restore_brand_guideline` / `merge_brand_guidelines` | musa | CRUD de guías | P3 |
| `get_brand_strategy` / `update_brand_strategy` | musa | Estrategia | P3 |
| `add_frame_to_brand` | musa | — | P3 |
| `diff_brand_tokens` / `resolve_brand_token_proposal` | musa | Drift de tokens entre marcas | P3 |
| `replicate_brand_strategy` | musa | Clonar estrategia | P3 |
| `register_brand` | musa | Alta de marca (mejor en UI; flow solo para migraciones) | P3 |
| `get_active_styles` / `set_style_lock` / `find_duplicate_styles` / `download_style_template` | musa | Higiene de estilos | P3 |
| `detect_structure` | musa | Estructura de referencia | P2 |
| `adapt_format` / `adapt_all_formats` / `compare_adaptations` | Curado | Una pieza → story/feed/reel (grid semanal) | P1 |
| `text_metrics` / `diff_overlay` | musa | QA tipográfico y de fidelidad | P2 |
| `read_note` / `search_notes` / `brain_digest` | musa / agent | Contexto de las notas del workspace | P2 |

## 10. Photo (18 tools)

| Tool | Enfoque | Uso típico | Tier |
|---|---|---|---|
| `photo_list_assets` | Curado | Inventario fotográfico para pipelines de contenido | P1 |
| `photo_open_session` | Curado | Abrir sesión de edición headless | P1 |
| `photo_create_variant` | Curado | Variantes automáticas (formatos/crops por red) | P1 |
| `photo_apply_preset` | Curado | Preset de marca en lote | P1 |
| `photo_apply_operation` / `photo_update_operation` / `photo_remove_operation` | musa | Edición paramétrica encadenada | P2 |
| `photo_create_mask` / `photo_update_mask` | musa | Máscaras para composición | P2 |
| `photo_restore_version` / `photo_compare_versions` | musa | Control de versiones | P3 |
| `photo_compose_get` | musa | Leer composición | P2 |
| `photo_compose_add_layer` / `photo_compose_update_layer` / `photo_compose_reorder_layers` / `photo_compose_duplicate_layer` | musa | Composición por capas | P3 |
| `photo_compose_delete_layer` / `photo_compose_set_layer_mask` / `photo_compose_clear` | musa | Limpieza de composición | P3 |
| `separate_image_layers` / `separate_image_layers_check` | musa (async con check) | Separación en capas (patrón poll) | P2 |
| `segment_status` / `segment_click` | musa | Estado de segmentación (soporte interno de `remove_background`) | P2 |
| `image_to_design` | musa | Foto → pieza de diseño | P2 |
| `generate_from_prompt` | musa | Alias de generación de imagen | P2 |
| `ai_generate_image` | Curado | Imagen IA dentro de pipelines visuales | P1 |

## 11. Motion / video (13 tools)

| Tool | Enfoque | Uso típico | Tier |
|---|---|---|---|
| `list_animation_presets` / `get_animation` | musa / agent | Elegir preset según contenido | P2 |
| `set_animation` / `apply_transition` | musa | Animar piezas generadas | P2 |
| `list_video_effects` / `set_take_effects` / `set_layer_effect` | musa | Efectos de video | P3 |
| `set_video_project` / `set_video_media` / `set_video_text` / `set_video_audio` / `set_video_reel` | musa | Composición de reel programática | P2 |
| `video_export` | Curado (caro, async) | Render final de video/reel | P2 |
| `generate_text_video` | musa | Texto→video | P2 |
| `generate_image_video` / `generate_image_video_check` | musa (async) | Imagen→video con polling | P2 |

## 12. AI creativa (las que NO son el nodo `ai`)

| Tool | Enfoque | Uso típico | Tier |
|---|---|---|---|
| `ai_translate` | Curado | Una pieza → N idiomas (multinacional) | P1 |
| `ai_palette` / `ai_suggest_layout` | musa | Sugerencias dentro de pipelines de marca | P2 |
| `ai_generate_text` | — | Ya cubierto por el nodo `ai` | (cubierto) |
| `ai_connect_prompts` | — | Config, no acción | EXCL |

## 13. Import (Figma y archivos) — patrón async obligatorio

| Tool | Enfoque | Uso típico | Tier |
|---|---|---|---|
| `import_design` / `import_design_source` | musa (async) | Ingesta de diseños externos | P2 |
| `import_figma_design` / `import_figma_file` | musa (async) | Figma → Musa programático | P2 |
| `create_design_upload` / `convert_design_upload` / `retry_design_import` / `commit_design_import` | musa (async) | Pipeline de subida en pasos | P2 |
| `get_design_import_status` | Curado (poll) | Nodo de polling hasta terminal | P2 |
| `figma_connection` | — | OAuth interactivo, no cabe en flow | EXCL |

## 14. Batch, colas y operaciones

| Tool | Enfoque | Uso típico | Tier |
|---|---|---|---|
| `task_queue_add` | Curado | Encolar trabajo pesado sin bloquear el deadline del run | P1 |
| `task_queue_list` | musa | Vigilar cola desde reportes | P2 |
| `process_daily_batch` | musa (caro) | Lote diario disparado por schedule | P2 |
| `musa_batch_run` | musa (caro) | Lote ad-hoc orquestado por flow | P2 |
| `task_queue_get_config` / `task_queue_update_config` | — | Config del sistema | EXCL |
| `platform_get_status` | musa | Health-check dentro de flows de watchdog | P3 |
| `platform_update_config` | — | Config del sistema | EXCL |
| `get_dashboard_summary` / `list_pending_actions` / `get_recent_activity` | musa | Digest diario del workspace al canal del equipo | P2 |
| `get_weekly_report_csv` | Curado | Reporte semanal CSV → `http` (email/Slack) | P1 |

## 15. Comentarios y colaboración

| Tool | Enfoque | Uso típico | Tier |
|---|---|---|---|
| `comment_add` | Curado | Dejar nota automática en piezas generadas ("hecho por flow X, run Y") | P1 |
| `comment_list` / `comment_resolve` / `comment_reply` | musa | Triaje de feedback: comments → condiciones → ajustes | P2 |
| `share_design` | musa | Link de share en pipelines de entrega | P2 |
| `subscribe_template` / `unsubscribe_template` / `broadcast_section_change` / `claim_section` / `release_section` | — | Colaboración realtime de sesión | EXCL |

## 16. Flows llamando flows (self)

| Tool | Enfoque | Uso típico | Tier |
|---|---|---|---|
| `flow_run` / `flow_resume` | Curado | **Sub-flows** (Execute Workflow de n8n): util flows compartidas | P1 |
| `flow_library_list` / `flow_library_instantiate` | musa | Autoprovisionar flows desde presets (con approval) | P2 |
| `flow_list` / `flow_get` / `flow_history` | musa / agent | Estado e historial para watchdogs y memoria de agents (ya usado) | P1 |
| `flow_save` / `flow_delete` / `flow_import` / `flow_export` | musa | IaC de flows (con approval humano) | P3 |
| `flow_due_check`, `flow_credentials_list`, `flow_credentials_set`, `flow_credentials_delete`, `flow_static_data_get`, `flow_static_data_set`, `flow_webhook_rotate`, `flow_oauth2_connect` | — | Son el propio sistema (triggers, credenciales, static data, OAuth), no nodos | EXCL self |

## 17. Excluidos explícitos (con motivo)

| Grupo | Tools | Motivo |
|---|---|---|
| Cuenta y config | `list_workspaces`, `create_workspace` (DISABLED), `update_workspace`, `manage_invites`, `manage_webhooks`, `manage_chat_history`, `update_profile`, `manage_onboarding`, `manage_byok_keys`, `whoami`, `get_nda_status`, `set_publish_defaults`, `list_workspace_integrations`, `call_workspace_mcp`, `trash_files` | El flow ya corre fijado a UN workspace; la config de cuenta es decisión humana. `call_workspace_mcp` permitiría llamadas MCP externas arbitrarias desde un flow (superficie de riesgo sin caso de uso probado; candidato futuro con allowlist de egress). La basura se elimina en UI. |
| Claves y auth | `create_api_key`, `revoke_api_key`, `list_api_keys`, `verify_api_key`, `auth_token` | Secretos jamás en args de flow (invariante ya documentado). |
| Infra agéntica | `harness_get_context`, `harness_list_features`, `harness_list_orphaned_tasks`, `harness_claim_feature`, `harness_release_feature`, `harness_start_session`, `harness_log_entry`, `harness_dump_context`, `harness_get_entries`, `harness_healthcheck`, `harness_evaluate_checkpoint`, `harness_submit_for_review`, `harness_complete_feature`, `harness_record_runtime_event`, `harness_get_runtime_events`, `harness_list_sessions`, `harness_finish_session`, `harness_list_cronjobs`, `harness_create_cronjob`, `harness_toggle_cronjob`, `harness_report_error`, `harness_list_errors` | Son el harness de agentes IDE; un flow no debe reclamar features ni sesiones del harness. |
| Kanban del studio | `studio_create_card`, `studio_list_cards`, `studio_move_card`, `studio_get_card`, `studio_update_card`, `studio_delete_card`, `studio_add_comment`, `studio_log_agent_time`, `studio_list_models` | Tablero del harness; escribirlo desde un flow rompería la regla de una feature activa por cuenta. |
| Infra agéntica (otros) | `register_tool`, `skill_clone`, `observe_session`, `get_active_agents`, `chatfab_log_decision`, `ghost_perform` | Registro de tools, clonación de skills y sesiones del harness de agentes; no son pasos de negocio. |
| Sesión de editor | `canvas_select_move`, `canvas_undo_redo`, `canvas_copy_paste`, `canvas_context_menu`, `select_element`, `color_picker` | Requieren canvas/estado de UI del editor; en flows no hay sesión visual. |
| Docs de agente | `get_playbook`, `get_agent_guide`, `get_editor_guide`, `list_agent_roles` | Contexto para IAs conversacionales, no acciones de pipeline (el `agent` puede llevarlo en su system prompt). |
| OAuth interactivo | `figma_connection` | Requiere navegador del usuario; el patrón correcto es conectar una vez en UI y que el flow use la conexión. |
| Ops/soporte | `storage_health`, `report_bug`, `get_nda_status` | No son pasos de negocio. |

---

## 18. Totales y lectura rápida

| Tier | Aprox. | Contenido |
|---|---|---|
| P0 (curados primera tanda) | 14 | inbox/reply/captura/publish/calendario/ideas, CRM contacto+deal+interacción+overview, `render_batch`+`batch_render_html`, `validate_brand`+`lint_design` |
| P1 | ~45 | export/render unitarios, CSV→frames, adapt formats, apply brand, stock/imagen IA, edición HTML headless, chart, translate, comments, reportes, sub-flow, task_queue_add |
| P2 | ~80 | photo paramétrica, video compose, imports Figma con polling, vector selecto, CRUD menor, iconos/fuentes/paletas, composición |
| P3 | ~35 | versiones, CRUD de guías/recetas/estrategia, destructivos, higiene de estilos |
| EXCL | ~55 | cuenta, claves, harness/studio, canvas/sesión, docs de agente, OAuth interactivo, realtime, self-flow interno |
| (cubierto) | ~2 | `ai_generate_text` (nodo `ai`), `get_html_frames`/`create_template` (nodo `template`) |

## 19. Plan de implementación por fases

- **Fase A — "nodo musa + P0"** (1–2 días): caso `musa` en `executeNode` con `FLOW_TOOL_ALLOWLIST` tiered, tenant forzado, `LIMITS.maxToolCallsPerRun`, idempotencia de escrituras, mapeo de errores. Habilitar los 14 P0. Test req028 + smoke (un flow real inbox→reply en 3011 con fixture).
- **Fase B — "P1 de producción"**: export/render unitarios, CSV→frames, `adapt_all_formats`, `apply_brand`, gates de marca como `condition`, `ai_translate`, `comment_add`, sub-flow (`flow_run`), `task_queue_add`. Editor: selector de tool con schema inyectado desde el catálogo.
- **Fase C — "pesados y async"**: photo paramétrica, video compose + `video_export`, imports Figma con nodo de polling (`musa_wait` reusando el patrón de `wait_webhook`), `process_daily_batch`, `query_design_graph`.
- **Fase D — "a demanda"**: P3 solo cuando exista un flow real que lo pida; nada se expone por completitud.

## 20. Recetas de ejemplo (texto, no config final)

1. **Inbox → CRM → respuesta**: `webhook` → `musa:list_social_inbox` → `condition` (no respondidos) → `ai` (clasifica intención + redacta) → `musa:capture_social_contact` → `musa:log_interaction` → `musa:reply_social` → `report`.
2. **Carrusel semanal de marca**: `schedule lunes 09:00` → `musa:list_calendar_entries` → `ai` (5 copys) → `musa:create_html_carousel` → `musa:apply_brand` → `musa:validate_brand` + `musa:lint_design` → `condition` (pasa?) → `musa:render_batch` → `musa:publish_content` (programado) → `musa:comment_add`.
3. **Lead webhook → pipeline**: `webhook` → `condition` (campos completos) → `musa:create_crm_contact` → `musa:create_crm_deal` → `ai` (score + copy de primer touch) → `musa:log_interaction` → `http` (aviso a Slack del equipo).

## 21. Límites honestos de esta propuesta

- Las tools de sesión de editor (canvas/vector fino) seguirán siendo territorio de la IA en el editor, no de flows — y está bien así.
- Las tools async (imports, video) requieren el patrón poll; sin él, el deadline del run las mata a mitad.
- El coste real lo ponen los renders y las llamadas de IA; `maxToolCallsPerRun` y presupuestos por nodo son obligatorios, no opcionales.
- La idempotencia de escrituras sociales/CRM es la pieza más delicada: sin ella, cada reintento de webhook publica duplicado.
