# 🔧 MCP Tool Catalog — Design Harness v2 (Análisis Completo)

> **Fecha:** 18 Junio 2026, 13:50 GMT-5 | **Autor:** Lara  
> **Principio:** 100% MCP-first. Toda operación es una MCP tool. El editor UI es un cliente más del MCP.

---

## 📊 Resumen

| Categoría | Existentes | Existentes (necesitan adaptación HTML) | Nuevas | Total |
|-----------|:---:|:---:|:---:|:---:|
| Engine HTML/CSS | 3 | 2 | 8 | 13 |
| SVG Vector & Path Editing | 0 | 0 | 9 | 9 |
| Template Engine + Recipes | 3 | 0 | 5 | 8 |
| Batch Factory | 1 | 1 | 5 | 7 |
| Multi-Agent + Realtime | 0 | 0 | 8 | 8 |
| Brand Guardian | 2 | 0 | 5 | 7 |
| Format Adaptation | 0 | 0 | 4 | 4 |
| Render & Export | 1 | 1 | 3 | 5 |
| Google Fonts | 2 | 1 | 2 | 5 |
| Assets & Media | 1 | 0 | 3 | 4 |
| AI Generation | 5 | 0 | 2 | 7 |
| n8n / Publishing Bridge | 0 | 0 | 2 | 2 |
| UI Components (sin MCP) | — | — | 6 | 6 |
| **Total** | **18** | **5** | **62** | **85** |

---

## Matriz MCP / UI — verificación de evidencias 2026-09-24

> Esta tabla corrige una clasificación anterior que mezclaba tres afirmaciones
> distintas: que una operación esté registrada como MCP, que haya un control UI
> y que esa operación haya sido ejecutada en QA. No son equivalentes.
>
> **MCP Sí** significa que hay una tool registrada en `netlify/functions/mcp.mjs`
> y `tools_catalog.json` de este checkout; no prueba que la versión actualmente
> desplegada la incluya. **UI visible** significa que se vio directamente en la
> sesión autenticada de Musa el 2026-09-24. **UI no verificada** no significa
> que la UI no exista. Las filas son solamente capacidades que quedaron sin
> ejecutar en las rondas de dogfood.

| Módulo | Pendiente de QA | MCP del checkout | UI actual | Por qué no se ejecutó / qué falta |
|---|---|:---:|:---:|---|
| Diseño | Publicar comentario y cambiar permisos/compartir | No | Visible | `Comentarios` y `Compartir` son botones del editor, pero no hay tool MCP de comentario ni share en el catálogo. Publicar/alterar permisos necesita autorización y, para colaboración real, otra cuenta. |
| Diseño | Exportar/importar y validar un archivo descargado | Sí (`export_pdf`, `export_frame`, `export_template`, `import_template`) | Visible | No se descargó ni importó para no crear/sobrescribir datos; la integridad de bytes necesita acceso al archivo de descarga. |
| Diseño | Gradient, blend, stroke y pattern fill | Sí (`set_gradient`, `set_blend_mode`, `set_stroke_style`, `set_pattern_fill`) | UI no verificada por control específico | Se verificó el panel Props, pero no cada control de elemento. `set_pattern_fill` existe solo en este checkout hasta un deploy; no se afirma que producción lo tenga. |
| Diseño | Filtros, crop, shadow y blur | No MCP dedicado catalogado | UI no verificada por control específico | No se encontró una tool con esos nombres en el catálogo local y no se recorrieron todos los controles de elemento; esto no prueba ausencia de UI. |
| Diseño | Agrupar, pathfinder y máscara | Parcial: Sí (`group_elements`, `pathfinder`, `create_mask_from_path`); no hay `ungroup` MCP catalogado | UI no verificada | No se operó sobre el archivo QA. La ausencia de `ungroup` es del catálogo MCP, no una afirmación de que no haya UI. |
| Diseño | Bloquear/reordenar/renombrar capas y visibilidad | No para capa individual | UI no verificada | No hay tool MCP específica de capa en el catálogo; el panel Layers no se recorrió en esta revisión. |
| Diseño | Consola JS, resize de ventana e integridad binaria de descargas | No aplica | Fuera de Musa | Son capacidades del navegador/harness, no MCP ni UI de Musa. Hacen falta DevTools, control de resize y acceso a descargas. |
| Copywriting | Responder por Zernio y capturar autor al CRM | Sí (`reply_social`, `capture_social_contact`) | Visible | La Bandeja muestra textarea, `Responder` y `Capturar al CRM`. No se envió respuesta ni capturó un autor real: son acciones externas/crean CRM. |
| Copywriting | Publicar/programar contenido | Sí (`publish_content`) | Visible | Se vio `Publicar`; no se ejecutó porque publica o programa destinos reales. |
| Copywriting | Arrastrar una pieza del calendario | Sí (`update_content`) | Visible | No se movió una pieza real. Falta una pieza QA aislada o autorización para reprogramar una existente. |
| Copywriting | Importar/exportar calendario | No MCP dedicado de import/export de calendario | Visible | Hay botones `Importar` y `Exportar`; no se usaron para no importar datos ni descargar archivos. Hace falta un CSV QA para importar. |
| Copywriting | Navegación atrás/adelante, resize e inspección de descarga | No aplica | Fuera de Musa | Son pruebas del navegador, no controles ni MCP de Copywriting. |
| Contactos | Capturar desde Bandeja y comprobar deduplicación/timeline | Sí (`list_social_inbox`, `capture_social_contact`, `list_interactions`) | Visible fuera de Contactos | La UI está en Copywriting > Bandeja, no en la navegación CRM visible. Falta un item QA de Zernio o permiso explícito para capturar un autor real. |
| Contactos | Registrar/borrar interacción QA y editar/reabrir contacto QA | Sí (`log_interaction`, `update_crm_contact`) | UI no verificada por acción | No se alteraron contactos reales; falta un contacto QA. No hay `delete_crm_contact` en el catálogo para limpieza MCP. |
| Contactos | Cinco fichas distintas, incluidas leads Zernio | Sí para lectura (`get_crm_overview`) | Visible | Solo había tres personas disponibles durante QA. Faltan al menos dos contactos no reales/de prueba, incluido un lead Zernio si se quiere cubrir ese caso. |
| Contactos | Importación CSV y borrar contacto QA | No MCP dedicado | UI no verificada por acción | No se importó ni borró. Hace falta CSV/contacto QA y confirmación antes de cualquier eliminación. |
| Inicio | Ejecutar batch del Kanban | No MCP dedicado de “Ejecutar batch” | Visible | El control `Ejecutar batch` está visible; puede mutar 55 tareas y consumir LLM. Requiere OK explícito para esa ejecución. |
| Inicio | CSV e importación del Kanban | No MCP dedicado | Visible | Ambos controles están visibles; no se importó ni descargó. Hace falta un CSV QA y autorización si la importación cambia el tablero. |
| Inicio | Eliminar la tarea QA tras comprobarla | Sí (`studio_delete_card`) | UI no verificada por acción | No se abrió el flujo de eliminación. Sólo se debe hacer sobre una tarjeta `QA_` y con confirmación antes del borrado. |
| Inicio | Reporte semanal y verificar el archivo | Sí para CSV (`get_weekly_report_csv`) | Visible, deshabilitado | El control `Reporte semanal` estaba deshabilitado en la UI; no se pudo solicitar ni validar una descarga. |
| Inicio | Enlaces cruzados a Diseño/CRM/Copywriting | Sí para datos relacionados (`studio_get_card`, `get_dashboard_summary`) | UI no verificada por destino | No se siguieron enlaces de tarjetas reales para evitar cambiar su contexto; falta una tarjeta QA con referencias seguras. |

---

## 🟢 EXISTENTES — Ya funcionan

### Core CRUD
| Tool | Qué hace |
|------|----------|
| `list_templates` | Lista con filtros, search, paginación |
| `get_template` | Obtiene template completo (html/css/engine) |
| `create_template` | Crea (Fabric por defecto) |
| `create_html_template` | Crea HTML con initialHtml/initialCss |
| `update_template` | Actualiza metadata + canvas |
| `delete_template` | Elimina |
| `duplicate_template` | Clona (incluyendo html/css si engine=html) |
| `export_template` | Exporta .futuraria JSON |
| `import_template` | Importa .futuraria JSON |
| `list_versions` | Historial de versiones |
| `restore_version` | Restaurar versión anterior |

### Workspace
| Tool | Qué hace |
|------|----------|
| `list_workspaces` | Lista workspaces |
| `create_workspace` | Crea |

### HTML Engine (Fase 0)
| Tool | Qué hace |
|------|----------|
| `set_html` | Reemplaza HTML (DOMPurify) |
| `set_css` | Reemplaza CSS |
| `render_batch` | Render batch (necesita HTML mode) |

### AI Generation (existentes, reutilizables)
| Tool | Qué hace |
|------|----------|
| `ai_generate_text` | Genera copy |
| `ai_generate_image` | Genera o edita imagen (Nano Banana, Gemini) |
| `ai_palette` | Sugiere paleta de colores |
| `ai_suggest_layout` | Sugiere layout |
| `ai_translate` | Traduce contenido |
| `separate_image_layers` | Separa imagen en capas (Seedream 5.0 Pro, async) |
| `separate_image_layers_check` | Consulta estado de separación (gratis; devuelve capas con bounding box para posicionar exacto) |

### Brand (existentes, adaptables)
| Tool | Qué hace | Necesita |
|------|----------|----------|
| `brand_analyze` | Analiza uso de marca en template | Adaptar para HTML engine |
| `brand_apply` | Aplica marca a template | Adaptar para HTML engine |

### Batch (existente, adaptable)
| Tool | Qué hace | Necesita |
|------|----------|----------|
| `batch_design_from_csv` | Crea variantes desde CSV | Adaptar para HTML engine |
| `extract_design_system` | Extrae sistema de diseño completo desde uno o múltiples templates. Multi-template: mergea paletas, tipografía, spacing, componentes. Rellena colores semánticos faltantes (success/warning/error/info). Descubre componentes estructurales (botón, card, input). Output: tokens.json DTCG + shared.css + DESIGN.md. Determinístico: mismo input → mismo output. | ✅ Implementado |


### Design System Extraction

| Tool | Description |
|------|-------------|
| `extract_design_system` | Analyze N templates, merge colors/typography/spacing/radii/shadows. Derive missing semantic colors (success/error/warning/info) from accent hue. Discover structural components (rounded+text=button, img+heading+p=card, input=form). Fallback to palette-defaults. Output: tokens.json, shared.css, DESIGN.md, style fingerprint. |


### Render (existente, adaptable)
| Tool | Qué hace | Necesita |
|------|----------|----------|
| `render_batch` | Render batch actual | Agregar modo HTML |

### Fonts
| Tool | Qué hace | Necesita |
|------|----------|----------|
| `search_google_fonts` | Buscar fonts | Adaptar a iframe engine |
| `preview_font` | Preview de fuente | Adaptar a iframe engine |

### Assets
| Tool | Qué hace |
|------|----------|
| `upload_image` | Subir a Storage |

---

## 🔴 NUEVAS — Fase 1: Engine HTML/CSS (8 tools + 2 adaptaciones)

Tools que hacen al editor HTML usable por humanos Y por agentes.

| # | Tool | Params | Returns | UI |
|---|------|--------|---------|----|
| 1 | `get_template_structure` | `templateId` | `{dom: AST, cssRules: [{selector, properties}], elements: [{id, tag, cssSelector, bbox}]}` | Panel Layers |
| 2 | `select_element` | `templateId, elementId` | `{elementId, tag, classes, cssProperties, htmlSnippet}` | Click en iframe → propiedades |
| 3 | `update_element` | `templateId, elementId, {html?, css?}` | Template actualizado | Editar CSS en panel |
| 4 | `add_element` | `templateId, parentSelector, tag, html, css, position` | Template actualizado | Botón "+ Element" |
| 5 | `remove_element` | `templateId, elementId` | Template actualizado | Seleccionar + Delete |
| 6 | `reorder_element` | `templateId, elementId, newIndex` | Template actualizado | Drag & drop en Layers |
| 7 | `get_css_variables` | `templateId` | `[{name, value, scope}]` | Panel CSS Variables |
| 8 | `set_css_variable` | `templateId, name, value, scope` | Template actualizado | Editar variable en panel |
| — | `brand_analyze` 🔄 | Adaptar para leer html/css en vez de canvas.objects | | |
| — | `brand_apply` 🔄 | Adaptar para escribir CSS custom properties en vez de objetos Fabric | | |

---

## 🟢 IMPLEMENTADAS — SVG Vector & Path Editing (9 tools)

> **Estado:** ✅ Implementadas en `netlify/functions/mcp.mjs` (~Julio 2026).  
> **Dependencia:** `svg-path-commander` v2.2.1 (npm).  
> **UI:** Bezier pen tool, point editing overlay, gradient builder, snap/guides, rotation handle, outline/offset buttons integrados en `HtmlContextualPanel.tsx`.

### Drawing & Bezier

| # | Tool | Params | Returns | UI |
|---|------|--------|---------|----|
| S1 | `draw_bezier` | `templateId, frameId, points: [{x,y,handleIn?,handleOut?}], fill?, stroke?, layerName?, closed?` | Template actualizado con path SVG | FloatingToolbar → Pen (P), drag crea handles, Alt rompe simetría |
| S2 | `draw_path` | `templateId, frameId, pathData, fill?, stroke?, strokeWidth?, layerName?` | Template actualizado con elemento path | Click en canvas con Pen activo |

### Point Editing

| # | Tool | Params | Returns | UI |
|---|------|--------|---------|----|
| S3 | `edit_path_points` | `templateId, frameId, layerId, points: [{x,y,handleIn?,handleOut?}]` | Template actualizado con path modificado | Point editing overlay: círculos SVG + líneas de control, drag anchors y handles |
| S4 | `edit_path_point` | `templateId, frameId, layerId, pointIndex, x, y, handleIn?, handleOut?` | Template actualizado con punto individual modificado | Click + drag en anchor circle |

### SVG Import & Conversion

| # | Tool | Params | Returns | UI |
|---|------|--------|---------|----|
| S5 | `import_svg` | `templateId, frameId, svg, x?, y?, width?, height?` | Elementos SVG parseados al template | File upload / drag & drop SVG |
| S6 | `shape_to_path` | `templateId, frameId, elementId` | Elemento convertido a `<path>` con `d="..."` | Botón "Convert to Path" en HtmlContextualPanel |

### Pathfinder (Boolean Operations)

| # | Tool | Params | Returns | UI |
|---|------|--------|---------|----|
| S7 | `pathfinder` | `templateId, frameId, operation: 'union'\|'subtract'\|'intersect'\|'exclude', layerIds: [id1, id2]` | Path resultante de la operación booleana | Botones Union/Subtract/Intersect/Exclude en HtmlContextualPanel |

### Stroke & Path Styling

| # | Tool | Params | Returns | UI |
|---|------|--------|---------|----|
| S8 | `outline_stroke` | `templateId, frameId, layerId, strokeWidth?, fillColor?` | Stroke convertido a path relleno (expande el path usando `svg-path-commander` transform scale desde bbox center) | Botón "⬢ Outline Stroke" en HtmlContextualPanel → Stroke |
| S9 | `offset_path` | `templateId, frameId, layerId, offset` | Path escalado (inset/outset usando `svg-path-commander` transform scale desde bbox center). Offset positivo = outset, negativo = inset | Botones "⊖ Inset" (-4px) y "⊕ Outset" (+4px) en HtmlContextualPanel → Stroke |

### Gradient, Blend & Pattern

| # | Tool | Params | Returns | UI |
|---|------|--------|---------|----|
| S10 | `set_gradient` | `templateId, frameId, layerId, type: 'linear'\|'radial'\|'conic', angle?, stops: [{color, offset}], colors?` | Elemento con fill gradiente SVG/HTML | Gradient builder en HtmlContextualPanel (tipo, ángulo scrub, color stops max 4, preview bar) |
| S11 | `set_blend_mode` | `templateId, frameId, layerId, mode: 'normal'\|'multiply'\|'screen'\|'overlay'\|'darken'\|'lighten'\|'color-dodge'\|'color-burn'\|'hard-light'\|'soft-light'\|'difference'\|'exclusion'\|'hue'\|'saturation'\|'color'\|'luminosity'` | Elemento con `mix-blend-mode` aplicado | Dropdown blend mode en HtmlContextualPanel |
| S12 | `set_stroke_style` | `templateId, frameId, layerId, stroke?, strokeWidth?, strokeLinecap?, strokeLinejoin?, strokeDasharray?` | Elemento con atributos de stroke | Sección Stroke en HtmlContextualPanel (color, width, cap, join, dash pattern) |
| S13 | `set_pattern_fill` | `templateId, frameId, layerId, pattern: 'dots'\|'grid'\|'diagonal-lines'\|'checkerboard'\|'none', color?, backgroundColor?, size?, angle?` | CSS `background-image`, `background-size` y `background-position` persistidos | Sin control visual dedicado; disponible para agentes MCP. |

### Transform & Alignment

| # | Tool | Params | Returns | UI |
|---|------|--------|---------|----|
| S14 | `transform_element` | `templateId, frameId, layerId, x?, y?, width?, height?, scaleX?, scaleY?, angle?, opacity?` | Elemento transformado (CSS rotate + scale) | Rotation handle + resize handles en DesignFrame overlay; snap/guides (8px threshold, edge + center) |
| S15 | `align_elements` | `templateId, frameId, layerIds, direction: 'left'\|'right'\|'top'\|'bottom'\|'center-h'\|'center-v'\|'distribute-h'\|'distribute-v'` | Elementos alineados | Align buttons en HtmlContextualPanel |
| S16 | `group_elements` | `templateId, frameId, layerIds, groupName?` | Elementos agrupados en `<g>` | Botón Group (Ctrl+G) + ungroup en HtmlLayersPanel |

---

## 🔴 NUEVAS — Fase 2: Template Engine + Recipes (5 tools)

El agente aprende la estructura CSS y la replica con variables.

| # | Tool | Params | Returns | UI |
|---|------|--------|---------|----|
| 9 | `analyze_template_structure` | `templateId` | `{layout: {type, direction, gap, padding}, colors: [{hex, role, selector}], typography: [{family, size, weight, lineHeight, selector, role}], components: [{tag, selector, role: 'hero'|'headline'|'body'|'cta'|'logo'}], dimensions: {width, height}}` | Panel "Structure Analysis" |
| 10 | `extract_variables` | `templateId` | `{texts: [{name, selector, currentValue, maxLength}], images: [{name, selector, currentSrc, dimensions}], colors: [{name, selector, currentValue}], fixedSections: [{selector, content}]}` | Panel "Variables" con toggle |
| 11 | `create_variant` | `templateId, variables: {texts?, images?, colors?}, name` | `{newTemplateId}` | "Create Variant" dialog |
| 12 | `apply_variables` | `templateId, variables` | Template actualizado + evento realtime | Panel Variables → live preview |
| 13 | `save_recipe` | `templateId, name, description` | `{recipeId, structure, variables, previewUrl}` | "Save as Recipe" |

**Receta (Recipe) — formato JSON:**
```json
{
  "recipeId": "rec_xxx",
  "name": "Post Instagram - Futuraria",
  "description": "Post cuadrado 1080x1080 con gradiente de marca",
  "layout": { "type": "flex", "direction": "column", "gap": "24px" },
  "colors": [
    { "role": "background", "selector": "body", "variable": "--bg" },
    { "role": "primary", "selector": "h1", "variable": "--primary" }
  ],
  "typography": [
    { "role": "headline", "selector": "h1", "family": "Syne", "size": "48px", "weight": 700 }
  ],
  "slots": [
    { "role": "hero", "selector": ".hero", "type": "image" },
    { "role": "headline", "selector": "h1", "type": "text", "maxLength": 80 },
    { "role": "cta", "selector": ".cta", "type": "text", "maxLength": 30 }
  ],
  "fixedCss": "...",
  "templateHtml": "..."
}
```

---

## 🔴 NUEVAS — Fase 3: Batch Factory (5 tools + 1 adaptación)

| # | Tool | Params | Returns | UI |
|---|------|--------|---------|----|
| 14 | `batch_create_variants` | `templateId or recipeId, variables: [{texts?, images?, colors?}], options: {prefix, startIndex, concurrency: 5}` | `{batchId, totalCount, templateIds: [], status: 'queued'}` | Panel Batch → upload CSV → preview grid |
| 15 | `batch_render_html` | `batchId or templateIds[], format, scale` | `{jobId, status, estimatedTime}` | "Render All" button |
| 16 | `batch_status` | `batchId or jobId` | `{progress: {completed, total, failed, errors}, results: [{templateId, renderUrl, sizeBytes}]}` | Progress bar en vivo |
| 17 | `batch_cancel` | `batchId or jobId` | `{cancelled: true, completedBeforeCancel}` | "Cancel" button |
| 18 | `batch_export` | `batchId or templateIds[], format: 'zip'\|'urls', includeMetadata` | `{downloadUrl or urls: [], expiresAt}` | "Download ZIP" or grid |
| — | `batch_design_from_csv` 🔄 | Adaptar para engine HTML + usar recipe como base | | |

---

## 🔴 NUEVAS — Fase 4: Multi-Agent + Realtime (8 tools)

Múltiples agentes editando en paralelo, visible en tiempo real desde el editor.

| # | Tool | Params | Returns | UI |
|---|------|--------|---------|----|
| 19 | `claim_section` | `templateId, sectionId, agentId, ttlSeconds` | `{success, lockId, expiresAt, conflict?: {claimedBy, since}}` | Badge "Editing by Agente 3" |
| 20 | `release_section` | `templateId, sectionId, lockId` | `{released: true}` | Badge disappears |
| 21 | `list_sections` | `templateId` | `[{sectionId, claimedBy, html, css, status, updatedAt}]` | Panel Sections con avatares |
| 22 | `assemble_template` | `templateId` | Template con html/css mergeado de todas las secciones | Botón "Assemble" → preview |
| 23 | `get_active_agents` | `templateId` | `[{agentId, sectionId, status, startedAt, lastBeat}]` | Panel "Active" con dots |
| 24 | `subscribe_template` | `templateId, channelType: 'changes'\|'presence'\|'all'` | `{channelId, endpoint}` | Conexión automática al abrir editor |
| 25 | `unsubscribe_template` | `channelId` | `{unsubscribed: true}` | Cerrar editor |
| 26 | `broadcast_section_change` | `channelId, sectionId, html, css, agentId` | Emitido vía Supabase Realtime Broadcast | Preview se actualiza sin refresh |

**Supabase Realtime canales por template:**
```
template:{id}:changes    → Broadcast → html/css changes
template:{id}:presence   → Presence  → agentes activos
template:{id}:batch      → Broadcast → progreso de batch
```

---

## 🔴 NUEVAS — Fase 5: Brand Guardian (5 tools)

| # | Tool | Params | Returns | UI |
|---|------|--------|---------|----|
| 27 | `register_brand` | `{brandId, name, colors: [{name, hex, role}], fonts: [{family, role}], logo: {url, variants: [{format, url}]}, spacing: {unit, scale}, rules: [{selector, property, expected, severity}]}` | `{brandId}` | Panel Brand → form |
| 28 | `validate_brand` | `templateId, brandId` | `{passed: bool, score: %, checks: [{rule, passed, expected, actual, selector, message}]}` | Checklist verde/rojo |
| 29 | `check_contrast` | `templateId` | `{passes: bool, elements: [{selector, fg, bg, ratio, passesAA, passesAAA, suggestion}]}` | Panel A11y con ratios |
| 30 | `check_accessibility` | `templateId` | `{score, issues: [{selector, severity, type, description, wcag, suggestion}]}` | "A11y: 92/100" |
| 31 | `auto_fix_brand` | `templateId, brandId, autoFix: ['colors','fonts','spacing']` | Template corregido + `{fixesApplied: []}` | Botón "Auto-Fix" |

---

## 🔴 NUEVAS — Fase 6: Format Adaptation (4 tools)

| # | Tool | Params | Returns | UI |
|---|------|--------|---------|----|
| 32 | `detect_structure` | `templateId` | `{regions: [{name: 'hero'|'headline'|'body'|'cta'|'logo', selector, boundingBox, content}]}` | Overlay de bounding boxes |
| 33 | `adapt_format` | `templateId, targetFormat: {width, height, name}` | `{newTemplateId, width, height, changes: [{region, from, to}]}` | Dropdown "Story/Banner/Feed" |
| 34 | `adapt_all_formats` | `templateId, formats: [{name, width, height}]` | `{results: [{format, templateId, previewUrl}]}` | Grid de 4 previews |
| 35 | `compare_adaptations` | `templateIds: []` | `{sideBySide: [{format, previewUrl}]}` | Vista comparativa |

---

## 🔴 NUEVAS — Render & Export (3 tools + 1 adaptación)

| # | Tool | Params | Returns | UI |
|---|------|--------|---------|----|
| 36 | `render_html_template` | `templateId, {format, scale, quality}` | `{url, width, height, sizeBytes, format}` | "Export PNG" |
| 37 | `render_to_formats` | `templateId, formats: ['png','webp','jpg']` | `{formats: [{format, url, sizeBytes}]}` | "Export All" |
| 38 | `optimize_image` | `imageUrl, {format, quality, maxWidth}` | `{optimizedUrl, originalBytes, optimizedBytes, reduction}` | Toggle "Optimize" |
| — | `render_batch` 🔄 | Adaptar para engine HTML en vez de Fabric | | |

---

## 🔴 NUEVAS — Google Fonts (2 tools + 1 adaptación)

| # | Tool | Params | Returns | UI |
|---|------|--------|---------|----|
| 39 | `get_font_details` | `family` | `{family, category, variants, subsets, previewUrl, cssImport}` | Panel Font Details |
| 40 | `add_font_to_template` | `templateId, family, weights: [400,700]` | Template con @import + CSS snippet en Monaco | "Add Font" button |
| — | `search_google_fonts` 🔄 | Adaptar para insertar @import en CSS del template | | |

---

## 🔴 NUEVAS — Assets (3 tools)

| # | Tool | Params | Returns | UI |
|---|------|--------|---------|----|
| 41 | `list_assets` | `templateId or workspaceId` | `[{url, type, filename, dimensions, sizeBytes}]` | Panel Assets → thumbnails |
| 42 | `replace_asset` | `templateId, selector, newUrl` | Template actualizado | Click derecho → Replace |
| 43 | `search_stock_image` | `query, orientation, color` | `[{url, thumb, author, license}]` | Unsplash/Pexels picker |

---

## 🔴 NUEVAS — AI Generation (2 tools)

| # | Tool | Params | Returns | UI |
|---|------|--------|---------|----|
| 44 | `generate_from_prompt` | `prompt, format: {width, height}, brandId?, style?` | `{templateId, previewUrl}` | "Generate" input + preview |
| 45 | `enhance_template` | `templateId, instruction: "add a gradient background" \| "make it more minimal" \| "add a CTA button"` | Template actualizado | "Enhance" button |

---

## 🔴 NUEVAS — n8n / Publishing Bridge (2 tools)

| # | Tool | Params | Returns | UI |
|---|------|--------|---------|----|
| 46 | `publish_batch` | `batchId or renderUrls[], channels: ['meta_instagram','meta_facebook','x','linkedin'], schedule: 'now' \| ISO timestamp, caption?` | `{jobId, status, scheduled}` | Botón "Publish" → channel selector |
| 47 | `publish_status` | `jobId` | `{channels: [{name, status, url, error?}]}` | Status badges |

**Flujo n8n:**
```
batch_export → [PNG URLs] → POST n8n webhook → Meta Graph API / X API / LinkedIn API
```

---

## 🖥️ UI Components — Sin MCP equivalente directo

Componentes del editor que no son tools pero son necesarios para la experiencia humana:

| # | Componente | Estado | Descripción |
|---|-----------|:---:|-------------|
| U1 | **Template Gallery** | ⚠️ Parcial | Grid de templates con thumbnails, filtros por engine/fecha/workspace, search |
| U2 | **Batch Progress Panel** | ❌ | Progress bar en vivo, grid de mini-previews generándose, estimado de tiempo |
| U3 | **Active Agents Panel** | ❌ | Sidebar mostrando agentes conectados, qué sección editan, dots verdes |
| U4 | **Structure Analysis Panel** | ❌ | Vista de árbol del DOM, bounding boxes coloreadas por rol detectado |
| U5 | **Brand Panel** | ⚠️ | Perfil de marca, paleta, fuentes, reglas. Editable. Ya existe parcialmente |
| U6 | **Format Preview Grid** | ❌ | 4 previews lado a lado (square, story, banner, feed) para comparar |

---

## ⚠️ Gaps Transversales

Cosas que no son MCP tools ni UI components, pero son necesarios:

| # | Gap | Fase |
|---|-----|:---:|
| G1 | **Recipe storage en Supabase** — tabla `recipes` con JSONB para estructura, variables, CSS | F2 |
| G2 | **Batch job queue** — Supabase tabla `batch_jobs` con status, progress, results JSONB | F3 |
| G3 | **Locks table en Supabase** — `section_locks` con templateId, sectionId, agentId, TTL | F4 |
| G4 | **Supabase Realtime config** — Habilitar Broadcast + Presence en el proyecto, suscribir canales | F4 |
| G5 | **Puppeteer render server** — Si Netlify Functions no puede con Chromium (~130MB), evaluar Railway $5/mo | F1 |
| G6 | **DOMPurify config unificada** — Misma config en MCP y REST API, mismo archivo shared | F1 |
| G7 | **n8n webhook de publishing** — Recibe `{images: [url], channels: [], caption, schedule}` → publica | F3 |

---

## 📐 Flujo Completo (humano ↔ IA ↔ batch ↔ publish)

```
PROMPT
  │
  ▼
generate_from_prompt ──→ TEMPLATE BASE (agente crea)
  │
  ▼
EDITOR V2 (humano refina CSS, colores, fuentes, layout)
  │
  ▼
analyze_template_structure ──→ save_recipe ──→ RECIPE (JSON)
  │
  ├──→ batch_create_variants (50-100 desde CSV + recipe)
  │         │
  │         ▼
  │    validate_brand ──→ auto_fix_brand ──→ render_batch ──→ optimize_image
  │         │
  │         ▼
  │    batch_export (ZIP o URLs)
  │         │
  │         ▼
  │    publish_batch ──→ n8n ──→ Meta / X / LinkedIn
  │
  ├──→ adapt_all_formats (square → story → banner → feed)
  │         │
  │         ▼
  │    render_to_formats → export
  │
  └──→ MULTI-AGENT MODE
            │
            ▼
       claim_section (8 agentes, 8 secciones distintas)
            │
            ▼
       assemble_template → validate_brand → render
```

## 🟢 IMPLEMENTADAS — Calado, Máscaras y Selección de imágenes (8 tools)

> **Estado:** ✅ Implementadas en `netlify/functions/mcp.mjs` + `api/src/routes/segmentation.ts` (Agosto 2026).  
> **Mecanismo de máscara (F1):** el path SVG cerrado es la fuente de verdad — tag `data-mask-for="<imgLayerId>"` + `data-mask-mode="include|exclude"`. La aplicación es 100% no destructiva: `clip-path: path("evenodd,…")` (Chrome-first) o `mask-image: url("data:image/svg+xml;base64,…")` autocontenida cuando hay inversión/pinceles. Sin refs `url(#id)`.  
> **Inferencia (F2/F3):** ONNX local en el background function `image-segment-background` (u2netp ~4.5MB, MobileSAM ~40MB, CLIPSeg int8 ~100MB) — **0 tokens de LLM** en todo el flujo. Tabla `segment_jobs` (queued→running→done|error).

### Máscaras vectoriales (F1)

| # | Tool | Params | Returns | UI |
|---|------|--------|---------|----|
| M1 | `create_mask_from_path` | `templateId, frameId, targetImageLayerId, pathElementId? \| pathData?(+x,y,width,height), mode? include\|exclude` | Path enmascarando el `<img>` (capa creada si se da `pathData`) | Context menu sobre path cerrado encima de imagen → **Crear selección** |
| M2 | `invert_mask` | `templateId, frameId, imageLayerId` | Máscara invertida (include↔exclude, re-bake CSS) | Context menu → **Invertir selección** |
| M3 | `fill_mask` | `templateId, frameId, imageLayerId, fill` | `div` detrás del img con el clip del sujeto + color/gradiente | Context menu → **Rellenar selección** (color picker inline) |
| M4 | `edit_path_points` 🔄 | `templateId, frameId, elementId, newPathData` | Path actualizado + **re-bake automático** si tiene `data-mask-for` | Pen/point editing (P/C) — la máscara sigue el path |

```bash
# Crear selección: el exterior del path desaparece (include)
curl -s -X POST https://…netlify.app/mcp \
  -H "Content-Type: application/json" \
  -d '{"method":"tools/call","params":{"name":"create_mask_from_path","arguments":{"templateId":"tpl_…","frameId":"fr_…","targetImageLayerId":"img_1","pathElementId":"path_7","mode":"include"}}}'
# → { content: [{ type: "text", text: "Mask created: path_7 → img_1 (include)" }] }
```

### Borrador sobre imagen (F4)

| # | Tool | Params | Returns | UI |
|---|------|--------|---------|----|
| M5 | `mask_brush` | `templateId, frameId, imageLayerId, strokes: [{points:[{x,y}], size?, mode? erase\|restore}]` | Trazos baked en máscara data-URI (acumulados en `data-mask-brushes`) | Herramienta **Borrador** (E) — arrastrar enmascara, Alt restaura, [ ] tamaño |

```bash
curl -s -X POST https://…netlify.app/mcp -H "Content-Type: application/json" \
  -d '{"method":"tools/call","params":{"name":"mask_brush","arguments":{"templateId":"tpl_…","frameId":"fr_…","imageLayerId":"img_1","strokes":[{"points":[{"x":10,"y":10},{"x":30,"y":25}],"size":24,"mode":"erase"}]}}}'
```

### Quitar fondo + Selección por IA (F3/F2/F2b)

| # | Tool | Params | Returns | UI |
|---|------|--------|---------|----|
| M6 | `remove_background` | `assetId? \| url?, workspaceId?, applyTo?{templateId,frameId,layerId}` | `{jobId, result: {cutoutUrl, maskUrl, svgPath, bbox, width, height}}` — idempotente por asset | Botón **Quitar fondo** en HtmlContextualPanel (swap + Restaurar vía `data-orig-src`) |
| M7 | `segment_click` | `assetId? \| url?, points?:[{x,y,neg?}], box?, prompt?, imageWidth?, imageHeight?, workspaceId?, applyTo?` | Ídem — SAM con clics **o** CLIPSeg con `prompt` (toma precedencia) | Herramienta **Varita** (W) — clic positivo, Alt+clic negativo, doble clic/Enter aplica; flyout de texto para CLIPSeg |
| M8 | `segment_status` | `jobId` | `{status: queued\|running\|done\|error, result?}` — poll del job | Loader inline (Segmentando…) |

```bash
# Quitar fondo (u2netp, ~1-3s warm) — la respuesta trae el resultado completo
curl -s -X POST https://…netlify.app/mcp -H "Content-Type: application/json" \
  -d '{"method":"tools/call","params":{"name":"remove_background","arguments":{"assetId":"ast_123","applyTo":{"templateId":"tpl_…","frameId":"fr_…","layerId":"img_1"}}}}'

# Varita SAM: un punto positivo (0.5,0.5) + uno negativo (Alt+clic)
# … name:"segment_click", arguments:{"url":"https://…/foto.jpg","points":[{"x":0.5,"y":0.5},{"x":0.1,"y":0.9,"neg":true}],"workspaceId":"ws_…"}

# Varita texto (CLIPSeg): segmenta "la persona" — sin puntos
# … name:"segment_click", arguments:{"url":"https://…/foto.jpg","prompt":"la persona","workspaceId":"ws_…"}

# Si el job sigue corriendo (>8s, cold start con descarga de modelo):
# … name:"segment_status", arguments:{"jobId":"seg_…"}
```

**Respuesta completa de un job done** (`result_json`):
```json
{
  "cutoutUrl": "https://…/ast_456.png",   // PNG con alpha
  "maskUrl":   "https://…/ast_457.png",   // máscara binaria
  "svgPath":   { "d": "M10 20 L… Z", "dNorm": "M0.1 0.2 L… Z", "bbox": { "x": 0, "y": 0, "width": 800, "height": 600 }, "subpaths": 1 },
  "width": 800, "height": 600
}
```

### Pitfalls

| Pitfall | Detalle | Solución |
|---------|---------|----------|
| **UTF-8 en bash** | Payloads con acentos/ñ (`"la persona"` está OK, pero `"círculo"` o `"camión"` se corrompen si el shell no los escapa) | Mandar el payload con `ensure_ascii=True` (Python) o escapar a `\uXXXX` en bash; nunca pegar texto acentuado crudo en `-d '{…}'` |
| Cold start | Primer job descarga el modelo del bucket `ml-models` (40–150MB) → tarda más de 8s | El MCP devuelve `jobId` + `hint`; poll con `segment_status(jobId)` |
| CLIPSeg es lento | 5–15s CPU en int8 | Usar SAM por clics si hay un punto conocido; CLIPSeg solo para selección semántica |
| `clip-path: path()` | Requiere Chrome ≥123 (Chrome-first OK) | Fallback: máscara SVG data-URI autocontenida (ya se usa con inversión/pinceles) |
| Máscara en frame origin | El svg de máscara se pine a `left:0;top:0` del frame (1×1 overflow:visible) con `d` en coords del frame | No reposicionar el svg a mano — editar solo el `d` del path (`edit_path_points`) |
| 0 LLM verificable | El flujo no llama ningún endpoint de LLM | Verificable en logs del job (`kind` + `input_url`) y en `segment-core.mjs` — solo `onnxruntime-web` (WASM) |

---

## 🎬 ANIMACIÓN & VIDEO (F0/F1) — IMPLEMENTADAS (20 Ago 2026)

> Fuente de verdad: `docs/ANIMATION_VIDEO_EXPORT_SPEC.md` + `shared/animationSchema.ts`.
> Una sola fuente: el esquema JSON `frame.animation` → compila a WAAPI (preview) y al mismo sampler (export). 0 tokens LLM, 0 binarios pesados.

| Tool | Qué hace |
|------|----------|
| `set_animation` | Escribe/edita `frame.animation` (esquema completo, o atajo `presetIds`+`presetLayerId`, o parches `durationSec`/`loop`; `clear:true` elimina). Normaliza con `normalizeAnimation` |
| `get_animation` | Lee el esquema + `stats` (clips por capa, timeline, transitions, hasAnimation) |
| `list_animation_presets` | Catálogo: 10 presets (fade-in, slide-in-up, zoom-in, blur-in, rotate, pop, float, typewriter…), easings (incl. `spring(damping,stiffness)`) y props animables |
| `apply_transition` | Transición del frame origen → siguiente (`fade\|slide\|zoom\|wipe`, 0.1–5s). Reemplaza la transición previa al mismo target |

**No expuestas (postergadas):** `render_video` / `render_video_status` — F2 requiere Chromium en la función (~50–60MB > límite de 50MB del zip). El export vive 100% en el navegador (F1: WebCodecs+webmMuxer frame-perfect, fallback MediaRecorder → WebM/MP4) desde el panel Animation del editor.

**Persistencia:** sin migración — `frame.animation` viaja dentro de `templates.data` (JSONB) con el upsert existente.

---

## 🛠️ PLATAFORMA, CUOTA & LÍMITES (v27)

### Tools nuevas
| Tool | Qué hace | Auth |
|------|----------|------|
| `platform_get_status` | Lee switches globales: `musa_tick_enabled` (kill switch del dispatcher horario del batch, en `platform_config`) y `monthly_mcp_quota` (cuota MCP mensual por workspace, 0 = ilimitado). Reporta también si el override de emergencia `MUSA_TICK_ENABLED=false` (env) está activo — gana sobre el switch de DB. | Admin key o dueño de workspace |
| `platform_update_config` | Escribe esos switches. `musaTickEnabled=false` detiene el dispatch horario (el botón «Ejecutar batch» del Kanban sigue funcionando). `monthlyMcpQuota` cambia la cuota al instante (cache 5 min se invalida). Solo campos enviados cambian. | Admin key o dueño de workspace |

### Telemetría de uso (fail-open)
- Cada `tools/call` autenticado con `workspaceId` suma 1 a `workspace_usage` (mes UTC, atómico vía RPC `increment_workspace_usage`) y al superar la cuota responde error `-32000` con el contador usado (`X / quota`).
- Sin migración v27 aplicada: no cuenta ni bloquea (la API nunca se cae por telemetría).

### Cambios en tools existentes
- `task_queue_get_config` → devuelve además `usage: { month, mcp_calls, items_generated, quota }` y las columnas `kanban_autorefresh_enabled` / `kanban_autorefresh_seconds`.
- `task_queue_update_config` → semántica de **merge** (solo los campos enviados se escriben; antes reescribía la fila completa) y acepta `kanbanAutoRefresh` (bool) + `kanbanPollSeconds` (15/30/60/120).

> Ver `docs/CAPACIDAD_FREEMIUM.md` para el análisis de cuántos usuarios aguanta el stack con estos límites.

---

## 🕸️ GRAFOS CONSULTABLES & RÉPLICA DE MARCA (v28)

### Tools nuevas

| Tool | Qué hace | Params clave |
|------|----------|--------------|
| `get_brand_playbook` | Digest consultable de UNA marca (la contracara de datos del grafo visual `get_brand_graph`): design system (templateId, colores, fuentes, styleFingerprint), inventario completo con categoría/campaña/tipo de contenido, subconjunto `replicable` (Plantillas + Archivos) y counts. Es LA tool para «revisá toda la lógica que hicimos para la marca X». | `workspaceId`, `brandId` o `brandName` |
| `replicate_brand_strategy` | Clona la lógica de marca A sobre marca B: construye el playbook de A, verifica el design system de B (si no tiene, encola primero una tarjeta de extracción con `extract_design_system`) y crea una tarjeta Kanban por archivo replicable (`design_kanban_tasks`, status `backlog`, tags `replica`/`brand:<B>`/`from:<tplA>`, brief con link al diseño fuente). Idempotente: archivos ya replicados se saltean. | `workspaceId`, `sourceBrandId`, `targetBrandId`, `maxCards` (1–30, default 15), `dryRun` |

### Flujo recomendado (para cualquier IA: chat interno, Claude, Codex…)

```
1. get_brand_graph(workspaceId)                  → IDs de marcas
2. get_brand_playbook(workspaceId, marcaA)       → qué existe y qué es replicable
3. replicate_brand_strategy(…, dryRun:true)      → previsualizar el plan
4. replicate_brand_strategy(…)                   → tarjetas en backlog
5. musa_batch_run(workspaceId)                   → procesar ya (o esperar el cron horario)
```

Las dos tools están en el catálogo estándar (`tools/list`) y en la lista del chat interno, así que cualquier cliente MCP las descubre solo.

### platform_get_status (v28)

Ahora también devuelve `plan` (referencia del plan Netlify free: 125K invocaciones/mes, ~1.488 del cron fijo, 100 GB) y `platform_usage` (sumatoria real de `workspace_usage` del mes corriente, todas las cuentas) — alimenta el panel **Configuración → 📊 Límites y consumo**, con proyección a fin de mes por ritmo actual.

---

## 🎯 Orden de ejecución

| Orden | Fase | Tools | Depende de |
|:---:|------|:---:|---|
| 1 | F1 Engine | 1-8, G6, G5 | — |
| 2 | F2 Template Engine + Recipes | 9-13, G1 | F1 |
| 3 | Google Fonts + Assets + AI | 39-45 | F1 |
| 4 | Render & Export | 36-38 | F1, G5 |
| 5 | F3 Batch Factory | 14-18, G2, G7 | F2, Render |
| 6 | F4 Multi-Agent | 19-26, G3, G4 | F1 |
| 7 | F5 Brand Guardian | 27-31 | F1 |
| 8 | F6 Format Adaptation | 32-35 | F1, F2 |
| 9 | n8n Publishing Bridge | 46-47 | F3, G7 |

---

> ⚡ *Documentado por Lara — Futuraria · 18 Junio 2026 13:50 GMT-5*
