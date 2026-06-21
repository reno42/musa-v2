# 🎯 /goal — Design Harness: Implementación Completa

> **De:** Lara | **Para:** Agent IDE Act | **Fecha:** 18 Junio 2026  
> **Repo:** `design-main` | **Leer antes:** `docs/MCP_TOOL_CATALOG_V2.md`, `docs/DESIGN_HARNESS_ROADMAP.md`  
> **NO TOCAR:** Editor Fabric.js, MCP tools Fabric.js, auth, templates viejos

---

## 📋 Orden de ejecución

### 🔴 FASE 1: Completar Engine HTML/CSS (2-3 días)

#### 1.1 DOMPurify en REST API
- **Archivo:** `api/src/routes/templates.ts`
- En el handler PUT, si `body.engine === "html"` y viene `html`, sanitizar con DOMPurify antes del `updateTemplate`
- Crear archivo `api/src/shared/sanitize.ts` con la config de DOMPurify (misma que MCP)

#### 1.2 Elemento ↔ Código sincronización
- **Archivos:** `src/components/HtmlCanvas.tsx`, `src/pages/EditorV2.tsx`, `src/components/CodePanel.tsx`
- Click en iframe → `postMessage({layerId})` → `handleSelectElement` busca el selector CSS → Monaco hace `revealLineInCenter`
- Si el elemento no tiene `data-layer-id`, buscar ancestro más cercano

#### 1.3 Render Puppeteer para HTML engine
- **Archivo:** `netlify/functions/render.mjs` o `netlify/functions/render-html.mjs`
- Para `engine === "html"`: usar `page.setContent(fullHtml)` + `page.screenshot({type:'png'})`
- Esperar Google Fonts: `waitUntil: 'networkidle0'`
- Si Chromium no cabe en Netlify Functions (>50MB), mantener SVG foreignObject como fallback explícito
- **Endpoint:** `POST /api/render/html/:templateId`

#### 1.4 MCP tools Fase 1 (6 nuevas + 2 adaptaciones)
```yaml
NUEVAS:
  get_template_structure: { params: [templateId], returns: {dom, cssRules, elements} }
  select_element: { params: [templateId, elementId], returns: {tag, classes, cssProperties, htmlSnippet} }
  update_element: { params: [templateId, elementId, {html?, css?}], returns: updated template }
  add_element: { params: [templateId, parentSelector, tag, html, css, position], returns: updated template }
  remove_element: { params: [templateId, elementId], returns: updated template }
  reorder_element: { params: [templateId, elementId, newIndex], returns: updated template }
  get_css_variables: { params: [templateId], returns: [{name, value, scope}] }
  set_css_variable: { params: [templateId, name, value, scope], returns: updated template }

ADAPTAR:
  brand_analyze: adaptar para leer template.html/css en vez de canvas.objects
  brand_apply: adaptar para escribir CSS custom properties en vez de objetos Fabric
```

#### 1.5 Google Fonts
- Integrar `GoogleFontPicker.tsx` (ya existe) a la toolbar de EditorV2
- MCP: `add_font_to_template` — inserta @import en CSS + `<link>` en iframe srcDoc
- MCP: `get_font_details` — retorna variantes, subsets, cssImport listo para usar

#### 1.6 Sincronizar tipos
- `src/shared/index.ts`: agregar `engine`, `html`, `css` al tipo DesignTemplate
- Asegurar que `packages/shared/types.ts` y `api/src/types.ts` estén alineados

#### 1.7 Version history para HTML
- En PUT handler: si html o css cambiaron, guardar snapshot con `{html, css, timestamp}`
- `list_versions` debe devolver versiones de HTML también

---

### 🔴 FASE 2: Template Engine + Recipes (3-5 días)

#### 2.1 Tabla recipes en Supabase
```sql
CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  workspace_id TEXT,
  structure JSONB NOT NULL, -- layout, colors, typography, slots, fixedCss
  template_html TEXT,
  template_css TEXT,
  preview_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 2.2 MCP tools Fase 2 (5 nuevas)
```yaml
analyze_template_structure:
  params: [templateId]
  returns: {
    layout: {type, direction, gap, padding},
    colors: [{hex, role, selector}],
    typography: [{family, size, weight, lineHeight, selector, role}],
    components: [{tag, selector, role}],
    dimensions: {width, height}
  }
  lógica: leer html+css, detectar flex/grid, extraer valores de color/font-size vía regex/CSS parser

extract_variables:
  params: [templateId]
  returns: {
    texts: [{name, selector, currentValue, maxLength}],
    images: [{name, selector, currentSrc, dimensions}],
    colors: [{name, selector, currentValue}],
    fixedSections: [{selector, content}]
  }

create_variant:
  params: [templateId, {texts: {name: value}, images: {name: url}, colors: {name: hex}}, name]
  returns: {newTemplateId}
  lógica: clonar template, reemplazar valores en html/css según variables

apply_variables:
  params: [templateId, variables]
  returns: updated template + emite evento Supabase Realtime
  lógica: igual que create_variant pero sobre el mismo template

save_recipe:
  params: [templateId, name, description]
  returns: {recipeId, structure, variables, previewUrl}
  lógica: analyze_template_structure + extract_variables → INSERT en recipes
```

#### 2.3 API routes para recipes
- `POST/GET/PUT/DELETE /api/recipes`
- `POST /api/recipes/:id/execute` → crea template desde recipe + variables

---

### 🔴 FASE 3: Batch Factory (2-3 días)

#### 3.1 Tabla batch_jobs en Supabase
```sql
CREATE TABLE IF NOT EXISTS batch_jobs (
  id TEXT PRIMARY KEY,
  template_id TEXT,
  recipe_id TEXT,
  status TEXT DEFAULT 'queued', -- queued|running|completed|failed|cancelled
  total_count INTEGER,
  completed_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  results JSONB DEFAULT '[]',
  errors JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
```

#### 3.2 MCP tools Fase 3 (5 nuevas + 1 adaptación)
```yaml
batch_create_variants:
  params: [templateId or recipeId, variables: [{...}], options: {prefix, startIndex, concurrency}]
  returns: {batchId, totalCount, templateIds: []}
  lógica: para cada set de variables, ejecutar create_variant. Máximo 5 concurrentes.

batch_render_html:
  params: [batchId or templateIds[], format: 'png'|'webp', scale: 1|2]
  returns: {jobId, status, estimatedTime}
  lógica: renderizar cada template a PNG vía render_html_template. Emitir progreso vía Supabase Realtime.

batch_status:
  params: [batchId or jobId]
  returns: {progress: {completed, total, failed}, results: [{templateId, renderUrl, sizeBytes}]}

batch_cancel:
  params: [batchId or jobId]
  returns: {cancelled: true}

batch_export:
  params: [batchId or templateIds[], format: 'zip'|'urls', includeMetadata: bool]
  returns: {downloadUrl or urls: [], expiresAt}

ADAPTAR:
  batch_design_from_csv: adaptar para engine HTML, usar recipe como base
```

#### 3.3 n8n Publishing Bridge
- MCP: `publish_batch` → POST a n8n webhook con `{images: [url], channels: [], caption, schedule}`
- n8n workflow: recibe → programa en Meta Business Suite / X API / LinkedIn

---

### 🔴 FASE 4: Multi-Agent Simultáneo (3-5 días)

#### 4.1 Supabase Realtime config
- Habilitar Realtime en el proyecto Supabase
- Configurar canal `template:{id}:changes` (Broadcast)
- Configurar canal `template:{id}:presence` (Presence)

#### 4.2 Tabla section_locks
```sql
CREATE TABLE IF NOT EXISTS section_locks (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  acquired_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE(template_id, section_id)
);
```

#### 4.3 MCP tools Fase 4 (8 nuevas)
```yaml
claim_section:
  params: [templateId, sectionId, agentId, ttlSeconds]
  returns: {success, lockId, expiresAt, conflict?: {claimedBy, since}}

release_section:
  params: [templateId, sectionId, lockId]

list_sections:
  params: [templateId]
  returns: [{sectionId, claimedBy, html, css, status, updatedAt}]

assemble_template:
  params: [templateId]
  returns: template con html/css mergeado de todas las secciones

get_active_agents:
  params: [templateId]
  returns: [{agentId, sectionId, status, startedAt, lastBeat}]

subscribe_template:
  params: [templateId, channelType]
  returns: {channelId, endpoint}
  lógica: suscribir al canal Supabase Realtime

unsubscribe_template:
  params: [channelId]

broadcast_section_change:
  params: [channelId, sectionId, html, css, agentId]
  lógica: emitir vía Supabase Realtime Broadcast
```

#### 4.4 EditorV2 real-time
- Al abrir template, suscribirse a `template:{id}:changes`
- Al recibir broadcast, actualizar preview sin refresh
- Panel "Active Agents" en sidebar con dots verdes

---

### 🟡 FASE 5: Brand Guardian (1-2 días)

#### 5.1 MCP tools Fase 5 (5 nuevas)
```yaml
register_brand:
  params: [{brandId, name, colors, fonts, logo, spacing, rules}]
  returns: {brandId}
  storage: JSONB en tabla brands o en workspace metadata

validate_brand:
  params: [templateId, brandId]
  returns: {passed, score, checks: [{rule, passed, expected, actual, selector, message}]}
  lógica: comparar css del template contra brand rules

check_contrast:
  params: [templateId]
  returns: {passes, elements: [{selector, fg, bg, ratio, passesAA, passesAAA, suggestion}]}

check_accessibility:
  params: [templateId]
  returns: {score, issues: [{selector, severity, type, description, wcag, suggestion}]}

auto_fix_brand:
  params: [templateId, brandId, autoFix: ['colors','fonts','spacing']]
  returns: template corregido + {fixesApplied: [...]}
```

---

### 🟡 FASE 6: Format Adaptation (2-3 días)

#### 6.1 MCP tools Fase 6 (4 nuevas)
```yaml
detect_structure:
  params: [templateId]
  returns: {regions: [{name, selector, boundingBox, content}]}
  lógica: analizar html/css para detectar hero, headline, body, cta, logo

adapt_format:
  params: [templateId, {width, height, name}]
  returns: {newTemplateId}
  lógica: reflow del layout manteniendo contenido, cambiando dimensiones

adapt_all_formats:
  params: [templateId, formats: [{name, width, height}]]
  returns: {results: [{format, templateId, previewUrl}]}

compare_adaptations:
  params: [templateIds: []]
  returns: {sideBySide: [{format, previewUrl}]}
```

---

### 🔴 Render & Export (compartido entre fases)

#### 7.1 MCP tools Render (3 nuevas + 1 adaptación)
```yaml
render_html_template:
  params: [templateId, {format: 'png'|'webp'|'jpg', scale: 1|2, quality: 85}]
  returns: {url, width, height, sizeBytes, format}

render_to_formats:
  params: [templateId, formats: ['png','webp','jpg']]
  returns: {formats: [{format, url, sizeBytes}]}

optimize_image:
  params: [imageUrl, {format: 'webp', quality: 85, maxWidth}]
  returns: {optimizedUrl, originalBytes, optimizedBytes, reduction}

ADAPTAR:
  render_batch: adaptar para engine HTML
```

---

### 🔴 Assets (3 nuevas)
```yaml
list_assets:
  params: [templateId or workspaceId]
  returns: [{url, type, filename, dimensions, sizeBytes}]

replace_asset:
  params: [templateId, selector, newUrl]
  returns: updated template

search_stock_image:
  params: [query, orientation, color]
  returns: [{url, thumb, author, license}]
  api: Unsplash API (gratis, 50 req/hora) o Pexels API
```

---

### 🔴 AI Generation (2 nuevas)
```yaml
generate_from_prompt:
  params: [prompt, {width, height}, brandId?, style?]
  returns: {templateId, previewUrl}
  lógica: prompt → Gemini/GPT → html+css → create_html_template → preview

enhance_template:
  params: [templateId, instruction: string]
  returns: updated template
  lógica: template actual + instruction → Gemini/GPT → html+css modificado → update_template
```

---

## 🚫 NO TOCAR

- ❌ CanvasEditor.tsx (editor Fabric.js)
- ❌ MCP tools Fabric.js existentes
- ❌ Sistema de auth, workspaces
- ❌ Templates con engine=fabric

---

## ✅ Criterios de éxito por fase

**F1:** PUT sanitiza HTML. Click iframe → Monaco scroll. Puppeteer render PNG. Google Fonts en iframe.

**F2:** `analyze_template_structure` devuelve layout+colors+fonts. `create_variant` replica diseño con nuevas variables. `save_recipe` persiste receta.

**F3:** `batch_create_variants` genera 50 templates. `batch_render_html` renderiza 50 PNGs. Progreso vía Supabase Realtime.

**F4:** 2 agentes editan secciones distintas sin conflicto. Editor muestra cambios sin refresh. Panel "Active Agents" funcional.

**F5:** `validate_brand` detecta colores/fuentes incorrectos. `check_contrast` reporta ratios WCAG.

**F6:** `adapt_format` convierte square→story→banner. Preview grid muestra 4 formatos.

---

> ⚡ *Lara — 18 Junio 2026*
