# 🔧 MCP Tool Catalog — Design Harness (HTML/CSS Engine)

> **Fecha:** 18 Junio 2026 | **Autor:** Lara  
> **Principio:** 100% MCP-first. Toda operación es una MCP tool. El editor UI es un cliente más del MCP.

---

## 📊 Resumen

| Categoría | Existentes | Nuevas | Total |
|-----------|:---:|:---:|:---:|
| Engine HTML/CSS | 3 | 10 | 13 |
| Template Engine | 0 | 5 | 5 |
| Batch Factory | 0 | 5 | 5 |
| Multi-Agent | 0 | 6 | 6 |
| Brand Guardian | 0 | 5 | 5 |
| Format Adaptation | 0 | 3 | 3 |
| Render & Export | 1 | 3 | 4 |
| Google Fonts | 2 | 2 | 4 |
| Assets | 1 | 2 | 3 |
| **Total nuevas** | | **41** | |

---

## 🟢 EXISTENTES — Ya funcionan con HTML engine

| Tool | Categoría | Qué hace |
|------|-----------|----------|
| `create_html_template` | Engine | Crea template HTML con initialHtml/initialCss |
| `set_html` | Engine | Reemplaza HTML (DOMPurify sanitizado) |
| `set_css` | Engine | Reemplaza CSS |
| `get_template` | Core | Obtiene template completo (incluye html/css/engine) |
| `update_template` | Core | Actualiza metadata del template |
| `delete_template` | Core | Elimina template |
| `duplicate_template` | Core | Clona template (con html/css si engine=html) |
| `list_templates` | Core | Lista templates con filtros |
| `export_template` | Core | Exporta .futuraria JSON |
| `import_template` | Core | Importa .futuraria JSON |
| `list_versions` | Core | Historial de versiones |
| `restore_version` | Core | Restaurar versión anterior |
| `search_google_fonts` | Fonts | Buscar en Google Fonts API |
| `preview_font` | Fonts | Preview de fuente con texto |
| `upload_image` | Assets | Subir imagen a Supabase Storage |
| `render_batch` | Render | Render batch (Fabric, necesita HTML mode) |

---

## 🔴 NUEVAS — Fase 1: Completar Engine (6 tools)

### Template Structure

| # | Tool | Params | Returns | UI equivalente |
|---|------|--------|---------|----------------|
| 1 | `get_template_structure` | `templateId` | `{dom: AST, cssRules: [], layers: [{id, tag, classes, dataAttrs}]}` | Panel Layers en EditorV2 |
| 2 | `select_element` | `templateId, layerId` | `{layerId, tag, classes, cssSelector, cssProperties, htmlSnippet}` | Click en iframe → panel de propiedades |
| 3 | `update_element` | `templateId, layerId, {html?, css?}` | Template actualizado | Editar en Monaco + click en elemento |
| 4 | `add_element` | `templateId, parentSelector, html, position` | Template actualizado | Botón "Add Element" en toolbar |
| 5 | `remove_element` | `templateId, layerId` | Template actualizado | Seleccionar + Delete |
| 6 | `reorder_element` | `templateId, layerId, newIndex` | Template actualizado | Drag & drop en Layers Panel |

---

## 🔴 NUEVAS — Fase 2: Template Engine (5 tools)

El agente aprende la estructura CSS de un template refinado por el humano.

| # | Tool | Params | Returns | UI equivalente |
|---|------|--------|---------|----------------|
| 7 | `analyze_template_structure` | `templateId` | `{layout: {type, direction, gaps}, palette: [hex], fonts: [family], hierarchy: [{tag, fontSize, fontWeight}], components: [{selector, role}]}` | Botón "Analyze" → panel de análisis |
| 8 | `extract_template_variables` | `templateId` | `{variables: [{name, type: 'text'|'image'|'color', selector, currentValue}], fixedSections: [selector]}` | Panel "Variables" con toggle fijo/variable |
| 9 | `create_template_variant` | `templateId, variables: {name: value}, name` | `{newTemplateId}` | Botón "Create Variant" → dialog de variables |
| 10 | `apply_variables` | `templateId, variables: {name: value}` | Template actualizado | Panel Variables → inputs editables → live preview |
| 11 | `save_as_recipe` | `templateId, recipeName, description` | `{recipeId}` | Botón "Save as Recipe" |

---

## 🔴 NUEVAS — Fase 3: Batch Factory (5 tools)

50-100 diseños desde template base + datos variables.

| # | Tool | Params | Returns | UI equivalente |
|---|------|--------|---------|----------------|
| 12 | `batch_create_variants` | `templateId, variables: [{name: value}], options: {prefix, startIndex}` | `{batchId, count, templateIds: []}` | Panel Batch → upload CSV → preview grid |
| 13 | `batch_render` | `batchId or templateIds[], format: 'png'|'webp', scale: 1|2` | `{jobId, status: 'queued', estimatedTime}` | Botón "Render All" → progress bar |
| 14 | `batch_status` | `batchId or jobId` | `{progress: {completed, total, failed}, results: [{templateId, url}]}` | Progress bar en tiempo real vía Supabase Realtime |
| 15 | `batch_cancel` | `batchId or jobId` | `{cancelled: true}` | Botón "Cancel" |
| 16 | `batch_export_zip` | `batchId, includeMetadata: bool` | `{zipUrl, expiresAt}` | Botón "Download All (ZIP)" |

---

## 🔴 NUEVAS — Fase 4: Multi-Agent Simultáneo (6 tools)

8-10 sub-agentes editando el mismo template en paralelo, visible en tiempo real.

| # | Tool | Params | Returns | UI equivalente |
|---|------|--------|---------|----------------|
| 17 | `claim_section` | `templateId, sectionId, agentId` | `{success, conflict?: {claimedBy, since}}` | Badge en panel Layers: "Editing by Agente 3" |
| 18 | `release_section` | `templateId, sectionId` | `{released: true}` | Badge desaparece |
| 19 | `list_sections` | `templateId` | `[{sectionId, claimedBy, html, css, status}]` | Panel Sections con avatares de agentes |
| 20 | `assemble_template` | `templateId` | Template con html/css mergeado de todas las secciones | Botón "Assemble" → preview final |
| 21 | `get_active_agents` | `templateId` | `[{agentId, sectionId, status, lastActivity}]` | Panel "Active Agents" con dots verdes |
| 22 | `broadcast_change` | `templateId, sectionId, html, css` | Emitido vía Supabase Realtime Broadcast | Preview se actualiza sin refresh |

---

## 🔴 NUEVAS — Fase 5: Brand Guardian (5 tools)

Validación automática de consistencia de marca.

| # | Tool | Params | Returns | UI equivalente |
|---|------|--------|---------|----------------|
| 23 | `register_brand` | `brandId, {colors: [hex], fonts: [family], logo: url, spacing: {unit, scale}, rules: [{selector, property, value}]}` | `{brandId}` | Panel Brand → formulario de registro |
| 24 | `validate_brand` | `templateId, brandId` | `{passed: bool, checks: [{rule, passed, expected, actual, message}]}` | Botón "Validate" → checklist verde/rojo |
| 25 | `check_contrast` | `templateId` | `{passes: bool, checks: [{selector, fg, bg, ratio, passesAA, passesAAA}]}` | Panel Accessibility → "Contraste: 4.2:1 ✅ AA" |
| 26 | `check_accessibility` | `templateId` | `{score, issues: [{selector, severity, description, suggestion}]}` | Panel "A11y Score: 92/100" |
| 27 | `get_brand` | `brandId` | `{colors, fonts, logo, spacing, rules}` | Panel Brand → vista de perfil |

---

## 🔴 NUEVAS — Fase 6: Format Adaptation (3 tools)

Un diseño → múltiples formatos.

| # | Tool | Params | Returns | UI equivalente |
|---|------|--------|---------|----------------|
| 28 | `detect_structure` | `templateId` | `{hero: {selector, bbox}, headline: {selector, text}, body: {selector, text}, cta: {selector, text}, logo: {selector, src}}` | Overlay en preview mostrando bounding boxes de cada componente |
| 29 | `adapt_format` | `templateId, targetFormat: 'story'|'banner'|'feed'` | `{newTemplateId, width, height}` | Dropdown "Adapt to" → Story / Banner / Feed |
| 30 | `adapt_all_formats` | `templateId` | `{square: templateId, story: templateId, banner: templateId, feed: templateId}` | Botón "Generate All Formats" → grid de 4 previews |

---

## 🔴 NUEVAS — Render & Export (3 tools)

| # | Tool | Params | Returns | UI equivalente |
|---|------|--------|---------|----------------|
| 31 | `render_html_template` | `templateId, format, scale` | `{url, width, height, sizeBytes}` | Botón "Export PNG" → download |
| 32 | `render_to_formats` | `templateId, formats: ['png','webp']` | `{png: url, webp: url}` | Botón "Export All" → multi-download |
| 33 | `optimize_image` | `imageUrl, quality, maxWidth` | `{optimizedUrl, originalSize, optimizedSize, reduction}` | Panel Export → toggle "Optimize" |

---

## 🔴 NUEVAS — Google Fonts (2 tools)

| # | Tool | Params | Returns | UI equivalente |
|---|------|--------|---------|----------------|
| 34 | `get_font_details` | `family` | `{family, category, variants: [weight], subsets: [latin], previewUrl}` | Panel Font Details → specimen |
| 35 | `add_font_to_template` | `templateId, family, weights` | Template con @import agregado al CSS | "Add to Template" en FontPicker |

---

## 🔴 NUEVAS — Assets (2 tools)

| # | Tool | Params | Returns | UI equivalente |
|---|------|--------|---------|----------------|
| 36 | `list_assets` | `templateId` | `[{url, type, dimensions, sizeBytes}]` | Panel Assets → grid de thumbnails |
| 37 | `replace_asset` | `templateId, selector, newImageUrl or newFile` | Template actualizado | Click derecho en imagen → "Replace" |

---

## 🎯 Prioridad de implementación

| Orden | Categoría | Tools | Imprescindible para |
|:---:|-----------|:---:|---------------------|
| 1 | Fase 1: Engine | 1-6 | Que el editor HTML sea usable por humanos |
| 2 | Fase 2: Template Engine | 7-11 | Que el agente pueda replicar diseños refinados |
| 3 | Fase 3: Batch | 12-16 | Que el agente pueda crear 50-100 diseños |
| 4 | Fase 4: Multi-Agent | 17-22 | Que múltiples agentes trabajen en paralelo |
| 5 | Google Fonts + Assets + Render | 34-37, 31-33 | Dependencias transversales de Fases 1-4 |
| 6 | Fase 5: Brand Guardian | 23-27 | Validación antes de publicar |
| 7 | Fase 6: Format Adaptation | 28-30 | Post → Story → Banner automático |

---

## 📐 Reglas de diseño MCP

1. **Toda tool es idempotente o tiene rollback** — si falla, no deja estado corrupto
2. **Toda tool devuelve `{success: bool, data?, error?}`** — patrón consistente
3. **Toda tool que modifica un template emite evento Supabase Realtime** — `template:{id}:changed`
4. **Los nombres de tools siguen `verbo_sustantivo`** — `create_`, `get_`, `set_`, `list_`, `batch_`, `adapt_`
5. **Toda tool tiene equivalente en UI** — no hay "solo código" ni "solo UI"

---

> ⚡ *Documentado por Lara — Futuraria · 18 Junio 2026*
