# 🔧 MCP Tool Catalog — Design Harness v2 (Análisis Completo)

> **Fecha:** 18 Junio 2026, 13:50 GMT-5 | **Autor:** Lara  
> **Principio:** 100% MCP-first. Toda operación es una MCP tool. El editor UI es un cliente más del MCP.

---

## 📊 Resumen

| Categoría | Existentes | Existentes (necesitan adaptación HTML) | Nuevas | Total |
|-----------|:---:|:---:|:---:|:---:|
| Engine HTML/CSS | 3 | 2 | 8 | 13 |
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
| **Total** | **18** | **5** | **53** | **76** |

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
| `ai_generate_image` | Genera imagen |
| `ai_palette` | Sugiere paleta de colores |
| `ai_suggest_layout` | Sugiere layout |
| `ai_translate` | Traduce contenido |

### Brand (existentes, adaptables)
| Tool | Qué hace | Necesita |
|------|----------|----------|
| `brand_analyze` | Analiza uso de marca en template | Adaptar para HTML engine |
| `brand_apply` | Aplica marca a template | Adaptar para HTML engine |

### Batch (existente, adaptable)
| Tool | Qué hace | Necesita |
|------|----------|----------|
| `batch_design_from_csv` | Crea variantes desde CSV | Adaptar para HTML engine |

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
