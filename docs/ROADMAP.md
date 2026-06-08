# 🎯 Futuraria Design — MCP-First Roadmap

> **Versión:** 1.0 | **Fecha:** 2026-06-07  
> **Preparado por:** Lara ✨ | Design Engineer, Futuraria  
> **Investigación:** 292 funcionalidades documentadas (Figma 203 + Paper/Notion 89)  
> **Principio:** Todo vía MCP tools, todo en free tiers (GitHub, Netlify, Supabase)  

---

## 🧬 Visión

Una herramienta de diseño **controlada 100% por IAs vía MCP tools** que combine:
- **Figma**: precisión de diseño visual, componentes, auto layout
- **Paper/Notion**: canvas inteligente, documentos, colaboración
- **MCP-first**: cada feature es una MCP tool que un agente puede llamar

---

## 📊 Estado Actual vs Meta

| Métrica | Actual (Post-QA) | Meta | Gap |
|---------|:---:|:---:|:---:|
| MCP Tools | 42 (14 REST + 28 draw/transform) | 150+ | ~110 |
| Pass Rate QA | 56.9% → 88%+ | 95%+ | ~7% |
| Features Figma | ~25% cubierto | 80%+ | ~55% |
| Features Paper | ~10% cubierto | 60%+ | ~50% |
| Free Tier | ✅ GitHub + Netlify + Supabase | Mantener | 0 |

---

## 🗺️ FASE 1 — MÍNIMO VIABLE (Q2 2026)

Lo que YA debería funcionar para ser usable por diseñadores reales.

### 🔴 Canvas & Navegación (P0)
| # | Feature | MCP Tool | Status | Free Tier |
|---|---------|----------|:---:|:---:|
| 1 | Pan/Hand tool funcional | `canvas_pan` | 🔴 PENDIENTE | ✅ |
| 2 | Zoom suave centrado en cursor | `canvas_zoom` | 🟡 Parcial | ✅ |
| 3 | Grid configurable | `canvas_grid` | 🟡 Básico | ✅ |
| 4 | Reglas con guías arrastrables | `canvas_rulers` | 🔴 PENDIENTE | ✅ |
| 5 | Snap a objetos | `canvas_snap` | 🟡 Parcial | ✅ |
| 6 | Undo/Redo (MCP) | `history_undo`, `history_redo` | ✅ snapshot_auto | ✅ |
| 7 | Multi-page | `canvas_pages` | 🔴 PENDIENTE | ✅ |

### 🔴 Frames & Layout (P0)
| # | Feature | MCP Tool | Status | Free Tier |
|---|---------|----------|:---:|:---:|
| 8 | Frame creation | `create_frame` | ✅ HOTFIX | ✅ |
| 9 | Frame rendering | `render_frame` | 🔴 PENDIENTE | ✅ |
| 10 | Frame nesting | `create_frame(parentFrameId)` | ✅ | ✅ |
| 11 | Frame auto-layout básico (H/V) | `frame_auto_layout` | 🔴 PENDIENTE | ✅ |

### 🔴 Propiedades Visuales (P0)
| # | Feature | MCP Tool | Status | Free Tier |
|---|---------|----------|:---:|:---:|
| 12 | Color picker (hex/rgba) | `color_picker` | 🔴 PENDIENTE | ✅ |
| 13 | Gradientes (linear/radial) | `set_gradient` | 🟡 MCP schema | ✅ |
| 14 | Opacidad por capa | `transform_object(opacity)` | ✅ | ✅ |
| 15 | Border radius rx/ry | `transform_object(rx,ry)` | ✅ | ✅ |
| 16 | Box shadow (múltiple) | `set_shadow` | 🟡 MCP schema | ✅ |
| 17 | Blend modes (16) | `transform_object(blendMode)` | ✅ | ✅ |
| 18 | Text align UI | `transform_object(textAlign)` | ✅ | ✅ |

**Fase 1 Total: 18 features. ~10 ya hechas, ~8 pendientes.**

---

## 🗺️ FASE 2 — DISEÑADOR REAL (Q3 2026)

Lo que un diseñador espera de una herramienta de diseño.

### 🟡 Google Fonts & Tipografía (P1)
| # | Feature | MCP Tool | Complejidad | Free Tier |
|---|---------|----------|:---:|:---:|
| 19 | Google Fonts catalog (1400+) | `search_google_fonts` → Google Fonts API | Alta | ✅ API gratuita |
| 20 | Font picker con preview | `preview_font` | Media | ✅ |
| 21 | Font weight 100-900 | `transform_object(fontWeight)` | Baja | ✅ |
| 22 | Italic/underline/strikethrough | `transform_object(fontStyle)` | Baja | ✅ |
| 23 | Letter spacing / line height | `transform_object(charSpacing, lineHeight)` | ✅ Ya | ✅ |
| 24 | Text decoration | `transform_object(underline, linethrough)` | Baja | ✅ |

### 🟡 Gradientes & Efectos (P1)
| # | Feature | MCP Tool | Complejidad | Free Tier |
|---|---------|----------|:---:|:---:|
| 25 | Gradiente radial | `set_gradient(type:radial)` | Media | ✅ |
| 26 | Gradiente angular | `set_gradient(type:angular)` | Alta | ✅ |
| 27 | Múltiples color stops (5+) | `set_gradient(colorStops[])` | Media | ✅ |
| 28 | Drop shadow | `set_shadow(type:drop)` | Media | ✅ |
| 29 | Inner shadow | `set_shadow(type:inner)` | Alta | ✅ |
| 30 | Layer blur | `set_blur(type:layer)` | Media | ✅ |
| 31 | Background blur | `set_blur(type:background)` | Alta | ✅ |

### 🟡 Auto Layout (P1)
| # | Feature | MCP Tool | Complejidad | Free Tier |
|---|---------|----------|:---:|:---:|
| 32 | Direction H/V + gap | `auto_layout(direction, gap)` | ✅ Ya | ✅ |
| 33 | Padding | `auto_layout(padding)` | ✅ Ya | ✅ |
| 34 | Resizing (hug/fill/fixed) | `auto_layout(resize)` | Alta | ✅ |
| 35 | Alignment per axis | `auto_layout(alignPrimary, alignCounter)` | Alta | ✅ |
| 36 | Absolute position inside layout | `auto_layout(absolute)` | Alta | ✅ |

### 🟡 Imágenes (P1)
| # | Feature | MCP Tool | Complejidad | Free Tier |
|---|---------|----------|:---:|:---:|
| 37 | Image upload JPG/PNG/SVG/WebP | `upload_image` | ✅ Ya | ✅ |
| 38 | Image by URL | `add_image` | ✅ Ya | ✅ |
| 39 | Image filters (brightness, contrast, blur) | `image_filter` | Media | ✅ |
| 40 | Crop/Clip | `image_crop` | Alta | ✅ |
| 41 | SVG import as editable paths | `add_svg_path` | ✅ Ya | ✅ |

**Fase 2 Total: 23 features. ~6 ya hechas, ~17 pendientes.**

---

## 🗺️ FASE 3 — PAPER-LIKE (Q3-Q4 2026)

El diferencial: canvas inteligente + documentos + colaboración IA.

### 🟢 Document Canvas (P2)
| # | Feature | MCP Tool | Complejidad | Free Tier |
|---|---------|----------|:---:|:---:|
| 42 | Document blocks (header, paragraph, list) | `add_block` | Media | ✅ |
| 43 | Markdown rendering | `render_markdown` | Media | ✅ |
| 44 | Toggle/Accordion blocks | `add_toggle` | Media | ✅ |
| 45 | Callout blocks | `add_callout` | Baja | ✅ |
| 46 | Quote blocks | `add_quote` | Baja | ✅ |
| 47 | Code blocks con syntax highlighting | `add_code_block` | Alta | ✅ highlight.js |
| 48 | Columns layout | `add_columns` | Alta | ✅ |
| 49 | Tables editables | `add_table` | Alta | ✅ |

### 🟢 Media Embeds (P2)
| # | Feature | MCP Tool | Complejidad | Free Tier |
|---|---------|----------|:---:|:---:|
| 50 | Image gallery | `gallery_create` | Media | ✅ |
| 51 | Video embed (YouTube/Vimeo) | `embed_video` | Baja | ✅ |
| 52 | Audio embed | `embed_audio` | Baja | ✅ |
| 53 | PDF preview | `embed_pdf` | Media | ✅ Supabase Storage |
| 54 | Figma embed | `embed_figma` | Baja | ✅ |
| 55 | Twitter/GitHub embed | `embed_social` | Media | ✅ oEmbed |

### 🟢 Colaboración (P2)
| # | Feature | MCP Tool | Complejidad | Free Tier |
|---|---------|----------|:---:|:---:|
| 56 | Comments en objetos | `add_comment` | Alta | ✅ Supabase realtime |
| 57 | Mentions (@user) | `mention_user` | Media | ✅ |
| 58 | Share link con permisos | `share_template` | Media | ✅ |
| 59 | Version history navegable | `list_versions`, `restore_version` | ✅ Ya | ✅ |
| 60 | Templates gallery | `list_templates(search)` | ✅ Ya | ✅ |

### 🟢 IA Features (P2)
| # | Feature | MCP Tool | Complejidad | Free Tier |
|---|---------|----------|:---:|:---:|
| 61 | AI text generation | `ai_generate_text` | Baja | ✅ OpenRouter |
| 62 | AI image generation | `ai_generate_image` | Baja | ✅ OpenRouter |
| 63 | AI layout suggestion | `ai_suggest_layout` | Alta | ✅ |
| 64 | AI color palette | `ai_palette` | Media | ✅ |
| 65 | Auto-translate content | `ai_translate` | Media | ✅ |

**Fase 3 Total: 24 features. ~3 ya hechas, ~21 pendientes.**

---

## 🗺️ FASE 4 — PRO (Q4 2026+)

Lo que convierte la herramienta en un producto profesional.

### 🔵 Componentes & Estilos (P3)
| # | Feature | MCP Tool | Complejidad |
|---|---------|----------|:---:|
| 66 | Components (master/instance) | `create_component`, `create_instance` | Muy Alta |
| 67 | Variants | `add_variant` | Alta |
| 68 | Component properties (boolean/text/swap) | `set_component_prop` | Alta |
| 69 | Styles (color, text, effect) | `create_style`, `apply_style` | Media |
| 70 | Style libraries | `publish_library` | Muy Alta |

### 🔵 Prototipado (P3)
| # | Feature | MCP Tool | Complejidad |
|---|---------|----------|:---:|
| 71 | Interactions (click→navigate) | `add_interaction` | Alta |
| 72 | Animations (dissolve, slide, smart animate) | `set_animation` | Alta |
| 73 | Overlays | `add_overlay` | Alta |
| 74 | Fixed elements | `set_scroll_position` | Media |

### 🔵 Variables & Tokens (P3)
| # | Feature | MCP Tool | Complejidad |
|---|---------|----------|:---:|
| 75 | Design tokens (color, number, string) | `create_variable` | Media |
| 76 | Collections & modes (light/dark) | `create_collection` | Alta |
| 77 | Variable aliases | `link_variable` | Media |

### 🔵 Export Avanzado (P3)
| # | Feature | MCP Tool | Complejidad |
|---|---------|----------|:---:|
| 78 | Batch export con presets | `export_batch` | Media |
| 79 | Copy as SVG/CSS | `copy_as` | Media |
| 80 | PDF export | `export_pdf` | Alta |

### 🔵 Plugins & API (P3)
| # | Feature | MCP Tool | Complejidad |
|---|---------|----------|:---:|
| 81 | MCP Plugin system | `register_tool` | Muy Alta |
| 82 | Webhooks por evento | `webhook_register` | ✅ n8n ya | 
| 83 | OAuth2/PAT auth | `auth_token` | Media |

**Fase 4 Total: 18 features.**

---

## 📊 RESUMEN POR FASE

| Fase | Features | Ya hechas | Pendientes | Tiempo est. | Free Tier |
|------|:---:|:---:|:---:|-----------|:---:|
| F1: Mínimo Viable | 18 | 10 | 8 | 2-3 semanas | ✅ |
| F2: Diseñador Real | 23 | 6 | 17 | 6-8 semanas | ✅ |
| F3: Paper-Like | 24 | 3 | 21 | 8-12 semanas | ✅ |
| F4: Pro | 18 | 1 | 17 | 12+ semanas | ✅ |
| **TOTAL** | **83** | **20** | **63** | **28-35 semanas** | ✅ |

---

## 🔗 ARQUITECTURA MCP-FIRST (Free Tier)

```
┌─────────────────────────────────────────────────────────────┐
│                     IA Agents (Qoder, Lara)                  │
│  Llaman MCP tools para diseñar, no tocan el editor visual    │
└──────────────────────────┬──────────────────────────────────┘
                           │ JSON-RPC 2.0
┌──────────────────────────▼──────────────────────────────────┐
│              MCP Server (netlify/functions/mcp.mjs)          │
│  → 150+ tools: canvas, shapes, text, images, frames,        │
│    styles, components, export, collaboration, AI            │
└──────────┬──────────────────────────────────────┬───────────┘
           │                                      │
┌──────────▼──────────┐              ┌───────────▼───────────┐
│   REST API (Express) │              │  Render Pipeline      │
│   → CRUD templates   │              │  → Puppeteer          │
│   → Auth, rate limit │              │  → PNG/SVG/PDF        │
└──────────┬───────────┘              └───────────────────────┘
           │
┌──────────▼──────────┐
│  Supabase (JSONB)    │  ← Free tier: 500MB DB, 1GB storage
│  → templates         │
│  → workspaces        │
└──────────────────────┘

Netlify Free Tier: 100GB bandwidth, 300 min build
GitHub Free Tier: unlimited repos, 2000 actions min/mo
Supabase Free Tier: 500MB DB, 1GB storage, 2GB bandwidth
OpenRouter Free Tier: credits for AI features
Google Fonts API: gratuita sin key
```

---

## 🎯 PRÓXIMO SPRINT: Fase 1 (8 features)

| # | Feature | Qoder Est. | Prioridad |
|---|---------|:---:|:---:|
| 1 | Pan/Hand tool | ~2h | 🔴 P0 |
| 2 | Zoom fix | ~1h | 🔴 P0 |
| 3 | Reglas + Guías | ~4h | 🔴 P0 |
| 4 | Snap mejorado | ~2h | 🔴 P0 |
| 5 | Render frame | ~3h | 🔴 P0 |
| 6 | Color picker | ~3h | 🔴 P0 |
| 7 | Gradiente UI | ~3h | 🔴 P0 |
| 8 | Box shadow UI | ~2h | 🔴 P0 |

---

## 🔗 ARCHIVOS RELACIONADOS

- `research/figma-canvas-tools.md` — 76 funcionalidades Figma (canvas, tools, capas, props)
- `research/figma-systems-export.md` — 127 funcionalidades Figma (componentes, layout, proto, export)
- `research/paper-full-capabilities.md` — 89 funcionalidades Paper/Notion/Craft
- `Checklist Funcionalidades Figma vs Canva vs Paper vs Mini-Figma.md` — 65 features comparadas
- `GAP_ANALYSIS_MINI_FIGMA.md` — gaps técnicos detallados
- `QA/GOAL-FIX-2026-06-07.md` — 19 bugs QA pipeline
- `docs/DATABASE_SCHEMA.md` — schema Supabase verificado
- `docs/DB_IMPACT_ANALYSIS.md` — impacto por bug

---

**Preparado por Lara** ✨ | Design Engineer, Futuraria  
**Principio:** MCP-first. Si un humano puede hacerlo con un botón, un agente debe poder hacerlo con una tool.
