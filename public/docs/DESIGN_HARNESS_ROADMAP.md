# 🎨 Design Harness — Roadmap Completo

> **Versión:** 1.0 | **Fecha:** 18 Junio 2026  
> **Autor:** Lara | **Repos:** `design-main`, `ObsidianRen/4-Diseno-Brand/`  
> **Principio:** Todo $0 freemium (GitHub + Netlify + Supabase).  
> **Real-time:** Supabase Realtime Broadcast + Presence, 200 conexiones, $0.

---

## 🧬 Visión

Herramienta de diseño donde **la IA crea el primer diseño, el humano refina, y múltiples sub-agentes trabajan en paralelo** — creando lotes de 50-100 diseños, adaptando formatos, exportando y publicando. Todo visible en tiempo real.

---

## 📊 Estado Actual

| Componente | Estado |
|------------|:------:|
| HTML/CSS Engine (EditorV2, Monaco, iframe) | ✅ Fase 0 completa |
| MCP Tools HTML (`create_html_template`, `set_html`, `set_css`) | ✅ |
| Render pipeline HTML | ⚠️ SVG foreignObject, no Puppeteer |
| DOMPurify en REST API | ❌ Solo en MCP |
| Elemento ↔ Código sincronización | ❌ Solo loguea |
| Google Fonts integrado al engine HTML | ❌ |
| Template Engine (aprender CSS, replicar) | ❌ |
| Batch Factory (CSV → 50 diseños) | ❌ |
| Multi-agente simultáneo (segmented editing) | ❌ |
| Brand Guardian (validación automática) | ❌ |
| Format Adaptation (post→story→banner) | ❌ |
| Export + Publicar (n8n → Meta) | 🟡 Content Machine existe |

---

## 🗺️ Fases

### Fase 1 — Completar HTML/CSS Engine (2-3 días Agent IDE)

Cerrar los gaps del PoC para que el editor sea usable.

| # | Tarea | Complejidad |
|---|-------|:---:|
| 1 | DOMPurify en PUT /api/templates/:id | Baja |
| 2 | Sincronizar Elemento ↔ Código (click iframe → scroll Monaco al selector) | Media |
| 3 | Sincronizar tipos en `src/shared/index.ts` (agregar engine, html, css) | Baja |
| 4 | Integrar GoogleFontPicker al engine HTML (Google Fonts en iframe + Monaco) | Media |
| 5 | Render con Puppeteer para engine HTML (reemplazar SVG foreignObject) | Alta |
| 6 | Guardar snapshot version history para HTML templates | Media |

### Fase 2 — Template Engine (3-5 días Agent IDE)

El agente aprende la estructura CSS de un template refinado por el humano y la replica con variables.

| # | Tarea | Descripción |
|---|-------|-------------|
| 1 | MCP tool: `analyze_template_structure` | Lee HTML+CSS, extrae: layout (flex/grid), paleta, fonts, jerarquía tipográfica, estructura de capas |
| 2 | MCP tool: `create_template_variant` | Replica estructura base con nuevas variables (copy, imágenes, colores) |
| 3 | MCP tool: `extract_template_variables` | Identifica qué partes del template son variables (texto, imágenes, colores) vs fijas (layout, fonts) |
| 4 | Skill: Template Extraction | Lara puede leer un template refinado y convertirlo en receta reutilizable |

### Fase 3 — Batch Factory (2-3 días Agent IDE)

El agente genera 50-100 diseños desde un template base + datos variables.

| # | Tarea | Descripción |
|---|-------|-------------|
| 1 | MCP tool: `batch_generate` | Recibe templateId + array de variables → genera N variantes HTML/CSS |
| 2 | MCP tool: `render_batch_html` | Renderiza N templates HTML a PNG/WebP en paralelo |
| 3 | MCP tool: `export_batch_zip` | Empaqueta N PNGs + metadatos en ZIP |
| 4 | Supabase Realtime: canal `batch:{templateId}` | Transmite progreso en tiempo real ("15/50 completado") |
| 5 | Skill: Batch Campaign | Lara ejecuta campaña completa: template → 50 variantes → render → exportar |

### Fase 4 — Multi-Agente Simultáneo (3-5 días Agent IDE)

Múltiples sub-agentes editan el mismo template en paralelo sin conflictos.

| # | Tarea | Descripción |
|---|-------|-------------|
| 1 | Supabase Realtime: canal `template:{id}` | Broadcast channel para cambios en tiempo real |
| 2 | Supabase Realtime: Presence | Muestra qué agente está editando qué sección |
| 3 | Segmented editing: `claim_section` tool | Agente reclama una sección (hero, body, footer). Otros agentes no tocan esa sección |
| 4 | EditorV2 real-time update | Escucha cambios vía Supabase Realtime → actualiza preview sin refresh |
| 5 | MCP tool: `assemble_sections` | Junta secciones de múltiples agentes en un HTML final |
| 6 | Skill: Multi-Agent Design | Lara orquesta 8-10 sub-agentes trabajando en secciones distintas |

### Fase 5 — Brand Guardian (1-2 días Agent IDE)

Validación automática de consistencia de marca antes de publicar.

| # | Tarea | Descripción |
|---|-------|-------------|
| 1 | MCP tool: `validate_brand` | Lee design system JSON → verifica colores, fuentes, logo, espaciado |
| 2 | MCP tool: `check_contrast` | Verifica contraste WCAG AA/AAA en texto sobre fondo |
| 3 | Skill: Brand Guardian | Corre validaciones antes de exportar, rechaza diseños que no cumplen |

### Fase 6 — Format Adaptation (2-3 días Agent IDE)

Un diseño → múltiples formatos automáticamente.

| # | Tarea | Descripción |
|---|-------|-------------|
| 1 | MCP tool: `adapt_format` | Reflow de 1:1 → 9:16 (story), 16:9 (banner), 4:5 (feed) |
| 2 | MCP tool: `detect_structure` | Analiza diseño y detecta: hero, headline, body, CTA, logo |
| 3 | Skill: Format Adaptation | Lara adapta un post cuadrado a todos los formatos de redes sociales |

---

## 📊 Resumen

| Fase | Qué | Días | Estado |
|------|-----|:---:|:------:|
| F0 | HTML/CSS Engine PoC | 2-3 | ✅ COMPLETO |
| F1 | Cerrar gaps Engine | 2-3 | 🔴 A EJECUTAR |
| F2 | Template Engine | 3-5 | ⬜ |
| F3 | Batch Factory | 2-3 | ⬜ |
| F4 | Multi-Agente Simultáneo | 3-5 | ⬜ |
| F5 | Brand Guardian | 1-2 | ⬜ |
| F6 | Format Adaptation | 2-3 | ⬜ |
| **Total** | | **13-21 días** | |

---

## 🏗️ Arquitectura Final

```
┌─────────────────────────────────────────────────┐
│  HUMAN DESIGNER                                   │
│  EditorV2 (Monaco + iframe)                      │
└──────────────────┬──────────────────────────────┘
                   │ GET/PUT /api/templates/:id
┌──────────────────▼──────────────────────────────┐
│  REST API (Netlify Functions, $0)                │
│  + DOMPurify + version history                   │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│  Supabase Postgres (templates en JSONB)          │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│  Supabase Realtime ($0)                          │
│  • Broadcast: cambios en tiempo real             │
│  • Presence: quién edita qué sección             │
│  • Sin refresh manual                            │
└──────────────────┬──────────────────────────────┘
     ┌─────────────┼─────────────┐
     ▼             ▼             ▼
┌─────────┐  ┌─────────┐  ┌─────────┐
│ AGENTE 1│  │ AGENTE 2│  │ AGENTE 3│  ...
│ Hero    │  │ Body    │  │ Batch   │
└────┬────┘  └────┬────┘  └────┬────┘
     └────────────┼────────────┘
                  ▼
┌─────────────────────────────────────────────────┐
│  ASSEMBLER → Puppeteer → PNG/WebP               │
│  BRAND GUARDIAN → Validación automática         │
│  EXPORT → n8n → Meta Business Suite             │
└─────────────────────────────────────────────────┘
```

---

> ⚡ *Documentado por Lara — Futuraria · 18 Junio 2026*
