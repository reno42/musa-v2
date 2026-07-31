# 🔬 Informe: Design Harness Competitivo — Futuraria Design vs. El Mercado

> **Autor:** Subagente de Investigación (Hermes Agent)
> **Fecha:** 30 Julio 2026
> **Objetivo:** Identificar gaps y ventajas competitivas del repositorio `design-main` frente al ecosistema global de herramientas de diseño con agentes/IA.
> **Repositorio analizado:** `C:/Users/Renzo/.openclaw/workspace/design-main/`

---

## 📊 Resumen Ejecutivo

Futuraria Design es un **editor WYSIWYG HTML/CSS + servidor MCP con 95+ tools para agentes IA** corriendo en infraestructura $0/mes (Netlify + Supabase). Está en un punto de inflexión: tiene el motor de render, el protocolo MCP, y la visión multi-agente, pero compite contra gigantes que están añadiendo IA a sus plataformas (Figma AI, Uizard Autodesigner, Motiff, Penpot MCP). La ventaja competitiva CLAVE es que Futuraria es el único que nació **agent-first desde el diseño de la API**, no como un add-on. Pero faltan features críticas de producto maduro.

---

## 1. 🏗️ Análisis del Repositorio `design-main`

### 1.1 Arquitectura General

```
Netlify Free ($0)
├── Frontend: React 18 + TS + Vite (SPA)
│   ├── EditorV2.tsx (1278 líneas) — Orquestador principal
│   ├── DesignFrame.tsx (2885 líneas) — Shadow DOM + motor de interacción
│   ├── InfiniteHtmlCanvas.tsx (913 líneas) — Canvas infinito con pan/zoom
│   └── 30+ componentes de UI (paneles, toolbar, exportación)
├── API: Express.js 4 + TypeScript (17 módulos de rutas)
│   └── netlify/functions/api.mjs (96 líneas) — Bridge Express→Netlify
├── MCP Server: netlify/functions/mcp.mjs (11763 líneas, 95+ tools)
│   └── JSON-RPC 2.0 sobre SSE, implementación custom (sin SDK oficial)
└── Persistencia: Dual-write (localStorage/in-memory → Supabase)
```

**Stack Técnico:**
| Capa | Tecnología | Costo |
|------|-----------|:---:|
| Render | Shadow DOM + iframe (HTML/CSS puro, **NO Fabric.js**) | $0 |
| Code | Monaco Editor (`@monaco-editor/react`) | $0 |
| Export | html2canvas (cliente), no Puppeteer | $0 |
| DB | Supabase PostgreSQL 500MB | $0 |
| Realtime | Supabase Realtime (WebSocket, 200 conexiones) | $0 |
| Fonts | Google Fonts API (94 fuentes catalogadas) | $0 |
| **TOTAL** | | **$0/mes** |

### 1.2 El Editor de Diseño (V2)

**Motor:** Shadow DOM en iframe. Cada frame es una "hoja de papel" con HTML+CSS aislados. No hay canvas de píxeles — es web nativo.

**Componentes clave:**

| Componente | Líneas | Función |
|-----------|--------|---------|
| `DesignFrame.tsx` | 2885 | Shadow DOM rendering + drag/resize + pen tool + path editing + hit testing + marquee selection |
| `InfiniteHtmlCanvas.tsx` | 913 | Canvas infinito pannable/zoomable, multi-frame, herramientas V/H/R/O/T/P |
| `EditorV2.tsx` | 1278 | Orquestador de estado, undo/redo (50 snapshots), auto-save, render worker |
| `HtmlContextualPanel.tsx` | 507 | Panel de propiedades: tipografía (8 props), color (3), spacing (4), layout (5), cambio de tag semántico (33 tags) |
| `HtmlLayersPanel.tsx` | 305 | Árbol de capas con drag-drop, group/ungroup, context menu |
| `CodePanel.tsx` | 170 | Monaco editor HTML/CSS tabs, sync bidireccional |
| `FloatingToolbar.tsx` | 216 | Tools V/H/R/O/T/P + frame presets + zoom + undo/redo |

**Capacidades del editor:**
- ✅ Canvas infinito con pan (Hand) y zoom (10%-400%) + Fit All
- ✅ Shadow DOM isolation — CSS no sangra entre frames
- ✅ Multi-frame artboard system (estilo Figma)
- ✅ Bidirectional sync: editar CSS → DOM se actualiza; drag elemento → CSS se actualiza
- ✅ Herramientas: Select, Hand, Rect, Circle, Triangle, Star, Polygon, Text, Pen, Pencil
- ✅ Path editing: mover/add/delete puntos, toggle smooth corner, split segment
- ✅ Pathfinder: Union, Subtract, Intersect, Exclude
- ✅ SVG import (upload + paste)
- ✅ Google Fonts integration (94 fuentes, @import auto-injection en Shadow DOM)
- ✅ Undo/Redo (50 snapshots, JSON serialization de frames[])
- ✅ Element properties via CSS regex manipulation

### 1.3 API MCP (95+ herramientas en 22 categorías)

**Protocolo:** JSON-RPC 2.0 custom sobre POST, con soporte para SSE. Compatible hacia atrás con llamadas directas.

**Categorías de tools:**

| # | Categoría | Tools | Estado |
|---|-----------|-------|--------|
| 1 | Workspaces | `list_workspaces`, `create_workspace` | ✅ |
| 2 | Templates CRUD | `list/create/get/update/delete/duplicate/export/import_template` + `create_html_template` | ✅ |
| 3 | Frames | `create/list/get/update/delete_frame` + HTML variants | ✅ |
| 4 | HTML Engine | `set_html`, `set_css`, `create/update/delete/get_html_frame` | ✅ |
| 5 | Structure | `get_template_structure`, `select_element` | ✅ |
| 6 | Element Ops | `update/add/remove/reorder_element`, `change_element_tag` | ✅ |
| 7 | Drawing | `draw_shape`, `draw_path`, `add_primitive`, `transform/group/align_elements` | ✅ |
| 8 | Fonts | `search_google_fonts`, `list_fonts`, `add_font_to_template`, `get_font_details`, `preview_font` | ✅ |
| 9 | AI Generation | `ai_generate_text/image`, `ai_palette`, `ai_suggest_layout`, `ai_translate`, `generate_from_prompt`, `enhance_template` | ✅ |
| 10 | Styles & Variables | `create_style`, `apply_style`, `create_variable/collection`, `link_variable`, `get/set_css_variable` | ✅ |
| 11 | Export & Render | `export_batch`, `copy_as`, `export_pdf`, `render_batch`, `render_html_template`, `render_to_formats` | ✅ |
| 12 | Batch Ops | `batch_update`, `batch_create_variants`, `batch_render_html`, `batch_status/cancel/export`, `publish_batch/status` | ✅ |
| 13 | Multi-Agent | `share_template`, `claim/release_section`, `list_sections`, `assemble_template`, `get_active_agents`, `subscribe/unsubscribe/broadcast` | ✅ |
| 14 | Brand Guardian | `register_brand`, `validate_brand`, `check_contrast/accessibility`, `auto_fix_brand` | ✅ |
| 15 | Format Adaptation | `detect_structure`, `adapt_format`, `adapt_all_formats`, `compare_adaptations` | ✅ |
| 16 | Assets | `color_picker`, `suggest_color_palette`, `search_stock_image`, `optimize_image`, `list_assets`, `replace_asset` | ✅ |
| 17 | Components | `create_component`, `create_instance`, `add_variant` | ⚠️ Deleted in cleanup |
| 18 | Advanced | `smart_layout`, `skill_clone`, `observe_session`, `publish_library` | ✅ |
| 19 | Plugin System | `register_tool`, `auth_token` | ✅ |
| 20 | Version History | `list_versions`, `restore_version` | ✅ |
| 21 | Comments | `add_comment`, `mention_user` | ⚠️ Deleted in cleanup |
| 22 | Recipes | `analyze_template_structure`, `extract_variables`, `create_variant`, `apply_variables`, `save_recipe` | ✅ |

**MCP Client Library (20 líneas):** `src/lib/mcpClient.ts` — JSON-RPC 2.0 helper compartido por todos los paneles UI.

### 1.4 Sistema de Templates/Frames

**Modelo de datos:**
```
Template → Frames[] → HTML/CSS/background/posición
         → top-level html/css (backward compat V1)
         → metadata (timestamps)
```

**Frame properties:**
- `id, name, x, y, width, height`
- `html, css, background`
- `layoutMode` (fixed/responsive)
- `clipsContent`, `constraints`, `padding`
- `contentHash`, `lastModifiedBy`, `lastModifiedAt`
- `objects[]` (legacy Fabric.js — deprecated)

**Operaciones:** CRUD completo vía MCP, REST, y UI. Rename inline. Duplicate. Drag para mover. Resize handles. Marquee select.

**Frame presets:** IG Square (1080×1080), IG Story (1080×1920), IG Feed (1080×1350), Banner (1920×1080), Twitter/X (1200×628).

### 1.5 Exportación y Renderizado

**Pipeline actual:**
1. **Client-side PNG:** `captureFrameToPng()` en EditorV2.tsx → Crea contenedor offscreen → Carga fuentes → html2canvas (scale 1-4x) → PNG blob → Download
2. **Self-rendering HTML:** `render.mjs` genera página HTML standalone con html2canvas CDN + auto-render + botón download
3. **Render Worker:** Polling cada 15s de `/api/render/queue/pending` → renderiza en cliente → upload completion
4. **MCP Export Helper:** `buildHtmlExportPage()` embebido en mcp.mjs

**Limitación crítica:** No hay Puppeteer/headless Chrome (el paquete excede el límite de 50MB de Netlify Functions). Toda renderización es client-side. Esto limita renders server-side en lote.

Formatos soportados: PNG, JPG, WebP, SVG, PDF, JSON (.futuraria).

### 1.6 Design Systems y Tokens

**Capacidades actuales:**
- ✅ CSS Variables: `get_css_variables`, `set_css_variable`, `create_variable`, `link_variable`
- ✅ Extract: `extract_variables` — detecta colores, fuentes y textos como variables
- ✅ Apply: `apply_variables` — reemplaza valores hardcodeados con `var(--name)`
- ✅ Design Artifacts: `generate_design_artifacts` → DESIGN.md + tokens.json + shared.css
- ✅ Export tokens: `export_design_tokens` → JSON con staleness check
- ✅ Lint: `lint_design` — verifica issues de diseño
- ✅ Brand System: `register_brand`, `validate_brand`, `check_contrast`, `check_accessibility`, `auto_fix_brand`, `generate_brand_manual`
- ✅ Color palette: `suggest_color_palette` (complementary, analogous, triadic, monochromatic)
- ✅ AI enhancement: `enhance_template`

**Lo que NO hay:**
- ❌ Design tokens nativos como entidad de base de datos (solo via CSS vars)
- ❌ Design token inheritance/theming (light/dark mode automático)
- ❌ Tipografía como token estructurado (font family + weight + line-height + letter-spacing)
- ❌ Espaciado como escala (4px grid, 8pt system)
- ❌ Animaciones/transiciones como tokens

### 1.7 El Patrón Harness Original (`ejemplo-harness-subagentes-main/`)

El ejemplo original es un **notepad CLI en Python** con patrón multi-agente:

**Estructura:**
```
feature_list.json     → Tareas con estado (pending/in_progress/done)
progress/current.md   → Estado de sesión actual
progress/history.md   → Bitácora append-only
docs/architecture.md  → "Qué significa buen trabajo"
docs/conventions.md   → Reglas de estilo
docs/verification.md  → Cómo verificar
CHECKPOINTS.md        → Criterios objetivos C1-C5
.claude/agents/       → Definiciones de subagentes
scripts/demo_orchestration.py → Demo Líder-Trabajador
```

**Principios que heredó design-main:**
1. **Una feature a la vez** — `harness_claim_feature` rechaza si ya hay task activa
2. **Anti-teléfono-descompuesto** — subagentes escriben resultados a DB, no circulan por chat
3. **Checkpoints C1-C5** — criterios objetivos de "done" que `harness_evaluate_checkpoint` verifica
4. **Divulgación progresiva** — agentes leen solo lo que necesitan
5. **Flush de contexto al 40%** — `harness_dump_context` vacía ventana a DB

**Roles implementados en design-main:** Leader (orquesta), Implementer (ejecuta 1 feature), Reviewer (verifica contra checkpoints), Explorer (investiga).

---

## 2. 🌐 Panorama Competitivo

### 2.1 Figma (API REST + Plugins)

| Aspecto | Detalle |
|---------|---------|
| **API** | REST API con OpenAPI spec pública. Endpoints: files, comments, users, projects, components, styles, variables, webhooks, activity logs, dev resources |
| **Autenticación** | OAuth2 + Personal Access Tokens + Plan Tokens |
| **Formato** | JSON representación del file. Cada layer/objeto es un "node". |
| **IA/Agentes** | ❌ NO tiene API MCP nativa. Figma AI (beta 2024) es UI-only. Los plugins NO pueden ser invocados por agentes externos. |
| **Variables API** | ✅ Endpoint dedicado para design tokens/variables (modos, colecciones) |
| **Dev Mode** | ✅ API para dev resources, codegen |
| **Webhooks** | ✅ Event-driven: file change, comment, version |
| **Rate Limits** | 120 req/min para endpoints estándar |
| **Gap principal** | NO es agent-first. La IA es un add-on en el UI, no una API programable para agentes. |

### 2.2 Uizard (Autodesigner — AI-first)

| Aspecto | Detalle |
|---------|---------|
| **Enfoque** | "Turn product ideas into concepts instantly with GenAI" |
| **AI Features** | Autodesigner 2.0 (prompt→multi-screen prototype), Screenshot Scanner (screenshot→mockup editable), Wireframe Scanner (hand-drawn→digital), Theme Generator |
| **API** | No pública documentada. Es SaaS cerrado. |
| **Componentes** | Modificación de componentes por prompt: "Select component → describe change → AI refines" |
| **Público** | PMs, founders, marketers — NO diseñadores profesionales principalmente |
| **Gap principal** | Sin API MCP. No es un harness para agentes — es una herramienta para humanos con AI assist. |

### 2.3 Motiff AI ("The Best UI Generator")

| Aspecto | Detalle |
|---------|---------|
| **Enfoque** | UI generation puro. "Focused on UI generation, built to deliver production-ready UI" |
| **Input** | 6+ modalidades: text, images, PDFs, markdown, wireframes, screenshots, PRDs |
| **Design Systems** | Preset stylings: Minimalist, Material Design, Ant Design, shadcn/ui |
| **AI** | Text→UI, Wireframe→UI, Screenshot→UI, PRD→UI |
| **API** | No pública. SaaS cerrado. |
| **Medición** | Dataset con 50+ industrias, 7+ workflows. Benchmarks propios. |
| **Gap principal** | No es un editor WYSIWYG ni un harness — es un generador. Sin API MCP. |

### 2.4 Penpot (Open Source + MCP Server)

| Aspecto | Detalle |
|---------|---------|
| **Enfoque** | "Full-stack design for every future. Built for designers, developers and AI agents." |
| **Open Source** | ✅ 57K+ GitHub stars. Self-host disponible. |
| **MCP Server** | ✅ Listado en menú "MCP Server". Integración nativa con agentes IA. |
| **AI Workflows** | "Seamlessly integrate any agent, any LLM, and any AI tooling directly into Penpot's core — code-to-design, design-to-code, design-to-design." |
| **Design Systems** | ✅ Design tokens, componentes, shared libraries |
| **Layout** | CSS Grid y Flex Layout nativos |
| **Formato** | Open file format (CSS, HTML, SVG, JSON) |
| **Plugins** | ✅ Ecosistema de plugins |
| **Gap principal** | MCP aún en early stage. Pero es el competidor más cercano a Futuraria en visión agent-first + open source. |

### 2.5 Canva (Developer Platform)

| Aspecto | Detalle |
|---------|---------|
| **API** | Canva Connect API + Apps SDK. REST + OAuth2. |
| **Capabilities** | Design creation, asset management, brand templates, content automation |
| **IA** | Magic Studio (AI features integradas en UI). No expuestas como API programable. |
| **Apps SDK** | JavaScript SDK para extender el editor Canva con apps interactivas |
| **Público** | Developers building integrations and apps |
| **Gap principal** | Orientado a apps y automaciones de marketing. No es un harness multi-agente ni expone IA vía API. |

### 2.6 Google Stitch (ex-Galileo AI)

| Aspecto | Detalle |
|---------|---------|
| **Enfoque** | "Design with AI" — Google's design tool. Frontend generation. |
| **API** | No pública. |
| **Gap principal** | Early stage, enfocado en generación, no en edición ni agentes. |

### 2.7 Otros competidores relevantes

| Herramienta | Enfoque | API | IA Agentes | MCP |
|------------|---------|:---:|:---:|:---:|
| **Diagram** | AI-powered design tools (acquired by Figma 2024) | ❌ | ✅ UI | ❌ |
| **Creatie** | AI design tool for marketing | ❌ | ✅ UI | ❌ |
| **Builder.io** | Headless CMS + Visual Editor + Figma plugin | ✅ | ✅ AI copilot | ❌ |
| **Plasmic** | Visual builder for React | ✅ | ❌ | ❌ |
| **Framer** | Design → publish websites | ✅ | ✅ AI generate | ❌ |
| **Webflow** | Visual web development | ✅ CMS API | ✅ AI assistant | ❌ |

---

## 3. 📊 Matriz Comparativa: Futuraria vs. Competidores

| Dimensión | Futuraria | Figma | Penpot | Motiff | Uizard |
|-----------|:---:|:---:|:---:|:---:|:---:|
| **Editor WYSIWYG** | ✅ HTML/CSS | ✅ Vector | ✅ Vector | ❌ (generador) | ✅ AI-driven |
| **API para agentes** | ✅ MCP 95+ tools | ⚠️ REST only | ✅ MCP (early) | ❌ | ❌ |
| **Agent-first** | ✅ Nació así | ❌ Add-on | 🟡 En progreso | ❌ | ❌ |
| **Multi-frame** | ✅ | ✅ | ✅ | N/A | ❌ |
| **Design tokens** | 🟡 CSS vars | ✅ Variables API | ✅ Design tokens | ✅ Preset DS | 🟡 Themes |
| **Brand guardian** | ✅ validate/auto-fix | ⚠️ Via plugins | 🟡 | ❌ | ❌ |
| **Multi-agente** | ✅ claim/section/lock | ❌ | 🟡 | ❌ | ❌ |
| **Realtime collab** | ✅ Supabase WS | ✅ WebSocket | ✅ WebSocket | ❌ | 🟡 |
| **Render server** | ❌ (client-side) | ✅ | ✅ | N/A | ❌ |
| **Batch generation** | ✅ CSV→N templates | ❌ | ❌ | ❌ | ❌ |
| **Format adaptation** | ✅ post→story→banner | ⚠️ Manual | ❌ | ❌ | ❌ |
| **Open source** | ✅ MIT | ❌ | ✅ MPL 2.0 | ❌ | ❌ |
| **Costo infra** | $0/mes | $15-75/seat | $0 self-host | Freemium | $12-39/seat |
| **Fonts** | 94 Google Fonts | 1400+ | Web fonts | ❌ | ❌ |
| **Prototyping** | ❌ (eliminado) | ✅ | ✅ | ❌ | ✅ |
| **Components** | ❌ (eliminado) | ✅ master/instance | ✅ | ❌ | ✅ |
| **SVG/Vector tools** | 🟡 Pen tool basic | ✅ Completo | ✅ Completo | ❌ | ❌ |
| **Auto-layout** | ❌ | ✅ | ✅ (Flex/Grid) | ❌ | ❌ |
| **Constraints** | ❌ | ✅ | ✅ | ❌ | ❌ |
| **Plugins** | 🟡 `register_tool` | ✅ 1000+ | ✅ | ❌ | ❌ |
| **Figma import** | ❌ | N/A | ✅ .fig | ❌ | ❌ |
| **PDF export** | ✅ jsPDF | ✅ | ✅ | ❌ | ❌ |
| **Version history** | ✅ 50 snapshots | ✅ 30 days | ✅ | ❌ | ❌ |

---

## 4. 🔴 GAPS CRÍTICOS — Lo que falta para ser competitivo

### 4.1 🔴 Gap 1: Renderizado Server-Side (Puppeteer)

**Problema:** 100% de renderizado es client-side (html2canvas). No se puede automatizar renders en lote sin un navegador abierto.

**Impacto:** El flujo "agente crea 50 templates → renderiza 50 PNGs" requiere un browser abierto. Sin server-side rendering, no es un verdadero harness autónomo.

**Solución propuesta:** Microservicio de render en Railway/Render con Puppeteer, o utilizar una API de screenshots como servicio (Urlbox, API Flash, ScreenshotAPI). O migrar a Cloudflare Workers con Browser Rendering.

### 4.2 🔴 Gap 2: Auto-Layout / Constraints (Flexbox/Grid Engine)

**Problema:** El editor carece de auto-layout (como Figma Auto Layout o CSS Flexbox visual). No hay constraints responsive.

**Impacto:** Sin auto-layout, la adaptación de formatos es frágil. El `adapt_format` reposiciona elementos absolutamente pero no "re-flow" layouts.

**Solución propuesta:** Implementar un sistema de layout modes en el engine: `position: absolute` (actual) + `display: flex` + `display: grid`. El panel contextual ya expone `display: flex/grid` pero no hay editor visual.

### 4.3 🔴 Gap 3: Components Master/Instance

**Problema:** El sistema de componentes fue eliminado en la limpieza de Junio 2026. Sin componentes reutilizables con instancias sincronizadas.

**Impacto:** Sin componentes, cada diseño es una copia única. Cambios en diseño requieren rehacer todas las variantes manualmente.

**Solución propuesta:** Reimplementar componentes como templates anidados con referencias. Master template → Instance frames con `componentRef`. Sincronización via content hash.

### 4.4 🔴 Gap 4: Prototipado Interactivo

**Problema:** Las tools de prototipado (`add_interaction`, `set_animation`, `add_overlay`, `set_scroll_position`) fueron eliminadas.

**Impacto:** Sin prototipado, Futuraria no compite en el flujo "diseñar → prototipar → validar". Es solo diseño estático.

**Solución propuesta:** Reimplementar prototipado usando el mismo Shadow DOM engine. Hotspots clickeables que navegan entre frames. Animaciones CSS via `@keyframes`.

### 4.5 🟡 Gap 5: Design Tokens como Entidad de Primer Nivel

**Problema:** Los tokens existen solo como CSS custom properties. No hay herencia, modos (light/dark), o colecciones tipográficas estructuradas.

**Impacto:** El sistema de brand guardian funciona pero es limitado sin un modelo de tokens formal.

**Solución propuesta:** Implementar un sistema de tokens estilo Figma Variables API o W3C Design Tokens spec (DTCG format). Colecciones con modos. Tipografía como token compuesto.

### 4.6 🟡 Gap 6: Plugins/Ecosistema

**Problema:** Solo existe `register_tool` para extender MCP. No hay un marketplace o sistema de plugins visual.

**Impacto:** Sin ecosistema, la plataforma no escala. Figma tiene 1000+ plugins.

**Solución propuesta:** Exponer una API de extensión que permita: (a) añadir paneles UI, (b) añadir tools MCP custom, (c) añadir formatos de export. Sandbox con iframe.

### 4.7 🟡 Gap 7: Tipografía Avanzada

**Problema:** Solo 94 Google Fonts catalogadas (Figma tiene 1400+). Sin variable fonts, kerning manual, o OpenType features.

**Solución propuesta:** Expandir catálogo a Google Fonts API completa (1500+). Agregar soporte para variable fonts (weight, width, slant axes).

### 4.8 🟡 Gap 8: Colaboración Visual Multiplayer

**Problema:** Realtime collaboration existe a nivel de datos (Supabase Broadcast) pero no hay cursores múltiples visibles en el editor.

**Impacto:** La experiencia multi-agente es "invisible" — los agentes editan pero el humano no ve cursores.

**Solución propuesta:** Implementar presencia visual: cursores de otros agentes/humanos en el canvas con nombres y colores. Ya existe `ActiveAgentsPanel` y `get_active_agents`.

### 4.9 🟢 Gap 9: Figma Import/Export

**Problema:** No hay importación de archivos .fig ni exportación a formato Figma-compatible.

**Impacto:** Los diseñadores que usan Figma no pueden migrar su trabajo.

**Solución propuesta:** Implementar import .fig via la especificación pública de Figma. Export via Figma REST API o Plugin API.

### 4.10 🟢 Gap 10: Vector Tools Avanzadas

**Problema:** El pen tool es básico comparado con Figma/Illustrator. Falta boolean operations complejas, vector networks, stroke alignment, dash patterns, arrowheads.

**Solución propuesta:** Expandir pathData engine con operaciones de curva adicionales. Implementar stroke panel completo.

---

## 5. ✅ VENTAJAS COMPETITIVAS — Lo que Futuraria hace MEJOR

### 5.1 Agent-First desde el Nacimiento
Ningún competidor expone **95+ tools via MCP nativo**. Futuraria es el único donde un agente IA puede:
- Crear templates/frames/elementos por API
- Modificar HTML/CSS programáticamente
- Renderizar y exportar desde MCP
- Validar marca y accesibilidad
- Adaptar formatos automáticamente
- Trabajar en paralelo con otros agentes

### 5.2 Multi-Agente Real
El sistema de `claim_section` + `assemble_template` + Supabase Realtime permite que múltiples agentes editen el MISMO template sin conflictos. Único en el mercado.

### 5.3 Costo $0
Infraestructura freemium completa. Netlify Free + Supabase Free = $0/mes. Escala hasta 125K requests/mes y 500MB de datos.

### 5.4 Batch Factory
El pipeline CSV → N templates → render → ZIP es único. Los competidores no tienen generación por lote programática.

### 5.5 Brand Guardian Automatizado
Validación de marca + WCAG contrast + accessibility + auto-fix via MCP. Los competidores requieren plugins o verificación manual.

### 5.6 Formato Abierto
.futuraria JSON + HTML/CSS puro. Sin vendor lock-in. Penpot también es abierto pero Futuraria es más ligero.

### 5.7 Shadow DOM Isolation
Cada frame es una Shadow DOM aislada. El CSS de un frame NUNCA afecta a otro. Más robusto que el CSS scoping de Figma.

---

## 6. 🗺️ Roadmap Recomendado

### Prioridad 1 (Crítico — próximos 30 días)
1. **Render server-side con Puppeteer** — deploy en Railway/Hetzner/Render
2. **Componentes master/instance** — reimplementar sistema de componentes
3. **Auto-layout visual** — editor drag-to-flexbox

### Prioridad 2 (Importante — 60 días)
4. **Prototipado interactivo** — hotspots + animaciones CSS
5. **Design tokens formales** — DTCG spec + modos light/dark
6. **Multiplayer visual** — cursores colaborativos

### Prioridad 3 (Deseable — 90 días)
7. **Plugin marketplace** — API de extensión + sandbox
8. **Figma import** — .fig parser
9. **Variable fonts + 1500+ Google Fonts**
10. **Vector tools avanzadas** — stroke panel, vector networks

---

## 7. 🧬 Conclusión

**Futuraria Design está en una posición única:** es el único design harness del mercado que nació agent-first con un protocolo MCP completo. Su arquitectura Shadow DOM + HTML/CSS puro es técnicamente superior al canvas de píxeles de Fabric.js, y su costo $0/mes lo hace accesible universalmente.

Sin embargo, está en una **carrera contra el tiempo**: Figma está añadiendo IA a su plataforma, Penpot está construyendo su MCP server, y herramientas como Motiff y Uizard están demostrando que la generación AI-driven es el futuro del diseño.

**La ventana de oportunidad es ahora.** Si Futuraria cierra los gaps críticos (render server-side, auto-layout, componentes) en los próximos 60 días, se posiciona como **el estándar open-source para diseño con agentes IA**. Si no, corre el riesgo de que los gigantes incorporen lo que hace único a Futuraria como un feature más.

---

> 📁 **Archivo generado:** `C:/Users/Renzo/.openclaw/workspace/design-main/INFORME_DESIGN_HARNESS_COMPETITIVO.md`
> 📊 **Fuentes:** 11,763 líneas de mcp.mjs, 2,894 líneas de ARCHITECTURE_V2.md, 423 líneas de FEATURE_INVENTORY.md, 7 competidores analizados, ejemplo-harness-subagentes original.
