# 🎯 /goal — Qoder Sprint: UI Gaps + Ghost System + Clone Skills

> **Fecha:** 2026-06-07 22:00 GMT-5 | **Preparado por:** Lara ✨
> **Repo:** `design-main/` → GitHub: `reno42/design`
> **Contexto:** 100 MCP tools existen. 25 no tienen UI. El concepto de "fantasmas" + clone skills está definido.
> **Meta:** Todo visible en UI + IA aprende del humano.

---

## 🗄️ DATABASE CONTEXT
- Supabase: `npdycbfhtcccznbndrkl.supabase.co`
- Schema: JSONB-hybrid, 2 tablas (templates, workspaces)
- CERO migraciones requeridas. Todo va en `data` JSONB o `metadata.*`
- Schema docs: `docs/DATABASE_SCHEMA.md`

---

## 🗺️ SPRINT 1 — UI GAPS P0 (14 gaps críticos)

### 1.1 Blur en PropertiesPanel
**Archivo:** `src/components/PropertiesPanel.tsx`
**MCP Tool:** `set_blur`
**Qué hacer:** Agregar sección "Blur" con toggle + slider 0-50px + tipo (gaussian/motion). Solo visible para objetos seleccionados.
**Tiempo:** ~1h

### 1.2 Image Filters en PropertiesPanel
**Archivo:** `src/components/PropertiesPanel.tsx`
**MCP Tool:** `image_filter`
**Qué hacer:** Sección "Filters" visible al seleccionar imagen. Presets: Grayscale, Sepia, Brightness, Contrast, Saturate, Blur. Sliders con preview.
**Tiempo:** ~1.5h

### 1.3 Image Crop UI
**Archivo:** `src/components/PropertiesPanel.tsx`, `src/hooks/useCanvas.ts`
**MCP Tool:** `image_crop`
**Qué hacer:** Botón "Crop" en imagen seleccionada → activa modo crop con handles arrastrables.
**Tiempo:** ~2h

### 1.4 Panel de Styles
**Archivo:** NUEVO `src/components/StylesPanel.tsx`
**MCP Tools:** `create_style`, `apply_style`
**Qué hacer:** Panel lateral "Styles" con lista de estilos, preview (color/typography), botón + para crear desde selección, click para aplicar, drag & drop.
**Tiempo:** ~3h

### 1.5 Panel de Variables
**Archivo:** NUEVO `src/components/VariablesPanel.tsx`
**MCP Tools:** `create_variable`, `create_collection`, `link_variable`
**Qué hacer:** Tabla Name|Type|Value|Scope + modo Light/Dark. Integrar con color picker para "Link to variable".
**Tiempo:** ~3h

### 1.6 Panel de Components
**Archivo:** NUEVO `src/components/ComponentsPanel.tsx`
**MCP Tools:** `create_component`, `create_instance`, `add_variant`, `set_component_prop`
**Qué hacer:** Panel lateral con lista de componentes, crear desde selección, arrastrar al canvas, variantes como tabs, detach instance.
**Tiempo:** ~4h

### 1.7 Panel de Prototype (Animations + Interactions)
**Archivo:** NUEVO `src/components/PrototypePanel.tsx`
**MCP Tools:** `set_animation`, `add_interaction`, `add_overlay`, `set_scroll_position`
**Qué hacer:** Panel "Prototype" con timeline simple, lista de interacciones, previsualización de animaciones (dissolve, slide, fade), overlay settings.
**Tiempo:** ~4h

### 1.8 Embeds en Toolbar
**Archivo:** `src/components/Toolbar.tsx`
**MCP Tools:** `embed_video`, `embed_audio`, `embed_figma`, `embed_pdf`, `embed_social`
**Qué hacer:** Botón "Embed" en Toolbar → dropdown con opciones (YouTube, Figma, PDF, Audio, Social). Modal para URL.
**Tiempo:** ~2h

### 1.9 Document Blocks en Toolbar
**Archivo:** `src/components/Toolbar.tsx`
**MCP Tools:** `add_block`, `add_code_block`, `add_table`, `add_columns`, `add_toggle`, `add_callout`, `add_quote`, `render_markdown`
**Qué hacer:** Botón "Block" → menú: Text, Header, Code, Table, Columns, Callout, Toggle, Quote, Markdown.
**Tiempo:** ~2h

### 1.10 Canvas Pages UI
**Archivo:** `src/components/CanvasEditor.tsx` o NUEVO `src/components/PagesPanel.tsx`
**MCP Tool:** `canvas_pages`
**Qué hacer:** Panel de páginas tipo Figma (sidebar izquierdo o superior). Add, rename, reorder, delete, switch.
**Tiempo:** ~2h

### 1.11 Canvas Snap toggle visible
**Archivo:** `src/components/Toolbar.tsx`
**MCP Tool:** `canvas_snap`
**Qué hacer:** Toggle "Snap" en Toolbar con dropdown: snapToGrid, snapToObject, threshold. El código ya tiene `snapRef` y `toggleSnap` — solo falta el botón.
**Tiempo:** ~0.5h

### 1.12 History Timeline (expandir GovernancePanel)
**Archivo:** `src/components/GovernancePanel.tsx`
**MCP Tools:** `history_undo`, `history_redo`
**Qué hacer:** Agregar botones Undo/Redo visibles en GovernancePanel. Mostrar últimos 5 estados con preview.
**Tiempo:** ~1h

### 1.13 AI Tools UI
**Archivo:** NUEVO `src/components/AIPanel.tsx`
**MCP Tools:** `ai_generate_text`, `ai_generate_image`, `ai_palette`, `ai_suggest_layout`, `ai_translate`
**Qué hacer:** Panel "AI" con: text prompt → genera texto/imagen en canvas, botón "Suggest Layout", "Generate Palette", "Translate". Toggle para colocar resultado en canvas automáticamente.
**Tiempo:** ~3h

### 1.14 Gallery UI
**Archivo:** `src/components/Toolbar.tsx`
**MCP Tool:** `gallery_create`
**Qué hacer:** Botón "Gallery" → modal: URLs de imágenes, columnas, gap, caption toggle → crear grid en canvas.
**Tiempo:** ~1h

**Sprint 1 Total: ~30h (14 gaps)**

---

## 👻 SPRINT 2 — GHOST SYSTEM (6 tools nuevas)

### 2.1 `ghost_show` — Overlay visual de snapshots
**Archivo:** `netlify/functions/mcp.mjs` + `src/hooks/useCanvas.ts`
**Descripción:** Superpone el último snapshot (human o IA) como capa translúcida en el canvas. El diseñador ve su último diseño como "fantasma" mientras la IA trabaja encima.
**Parámetros:** `templateId`, `type` ("human"|"ia"|"system"), `opacity` (0.1-0.5), `color` (tint)
**Output:** `{ ghostLayerId, snapshotId, timestamp, objectCount }`
**Complejidad:** Media | **Tiempo:** ~2h

### 2.2 `ghost_diff` — Diff visual coloreado
**Archivo:** `netlify/functions/mcp.mjs`
**Descripción:** Compara el estado actual del canvas contra el último snapshot humano. Devuelve diff con colores: verde = lo que agregó la IA, rojo = lo que eliminó la IA, amarillo = lo que modificó.
**Parámetros:** `templateId`, `baselineSnapshotId` (default: último human)
**Output:** `{ added: [...], deleted: [...], modified: [...], visualDiff: url }`
**Complejidad:** Media | **Tiempo:** ~2h

### 2.3 `ghost_merge` — Merge humano + IA
**Archivo:** `netlify/functions/mcp.mjs`
**Descripción:** Toma cambios de un snapshot y los fusiona con el estado actual. "Quiero lo que hizo la IA pero conservando mi header y footer."
**Parámetros:** `templateId`, `sourceSnapshotId`, `keepLayerNames[]`, `discardLayerNames[]`
**Output:** `{ merged, kept: [...], discarded: [...], conflicts: [...] }`
**Complejidad:** Alta | **Tiempo:** ~3h

### 2.4 `ghost_timeline` — Línea de tiempo visual
**Archivo:** `netlify/functions/mcp.mjs`
**Descripción:** Devuelve timeline completo de snapshots con mini-thumbnails para navegación visual tipo Time Machine.
**Parámetros:** `templateId`, `limit`
**Output:** `{ timeline: [{ snapshotId, type, trigger, timestamp, thumbnailUrl, objectCount }] }`
**Complejidad:** Media | **Tiempo:** ~1.5h

### 2.5 `ghost_compare` — Side-by-side comparison
**Archivo:** `netlify/functions/mcp.mjs`
**Descripción:** Render de dos snapshots lado a lado para comparación visual. Útil para mostrarle al cliente "antes vs después".
**Parámetros:** `templateId`, `snapshotIdA`, `snapshotIdB`
**Output:** `{ comparisonUrl, differences, similarityScore }`
**Complejidad:** Media | **Tiempo:** ~2h

### 2.6 Ghost visual layer en frontend
**Archivo:** `src/hooks/useCanvas.ts` + `src/components/GovernancePanel.tsx`
**Descripción:** Integrar los ghosts visualmente: botón "Show Ghost" en GovernancePanel, render de capa translúcida en canvas, toggle human/IA ghost, diff mode con colores.
**Tiempo:** ~3h

**Sprint 2 Total: ~13.5h (6 tools + frontend)**

---

## 🧬 SPRINT 3 — CLONE SKILLS (4 tools)

### 3.1 `skill_extract` — Extraer patrones de diseño
**Archivo:** `netlify/functions/mcp.mjs`
**Descripción:** Analiza un template (o múltiples) y extrae patrones de diseño del humano: paleta de colores, tipografía, espaciado, preferencias de layout, proporciones, densidad visual.
**Parámetros:** `templateIds[]`, `name`
**Output:**
```json
{
  "skillId": "skill_xxx",
  "patterns": {
    "palette": ["#1a1a2e", "#FF6B4A", "#e4e4f0", "#8888aa"],
    "typography": { "headings": "Syne", "body": "Inter", "scale": [72, 28, 20, 14] },
    "spacing": { "gap": 24, "padding": 120, "sectionGap": 80 },
    "layout": { "preferred": "asymmetric", "columns": 3, "alignment": "left" },
    "effects": { "shadows": "subtle", "blur": 0, "blendModes": [] },
    "ratios": { "heroTextWidth": 0.6, "cardWidth": 380 }
  },
  "rules": ["Usa Syne para títulos >28px", "Padding lateral siempre 120px", ...]
}
```
**Complejidad:** Alta | **Tiempo:** ~3h

### 3.2 `skill_clone` — Crear clon de estilo
**Archivo:** `netlify/functions/mcp.mjs`
**Descripción:** Crea una skill reutilizable a partir de los patrones extraídos. La skill se almacena en `tpl.metadata.clonedSkills[]` y puede aplicarse a otros templates.
**Parámetros:** `templateId`, `skillName`, `description`, `patterns` (de skill_extract)
**Output:** `{ skillId, skillName, rules, created }`
**Complejidad:** Media | **Tiempo:** ~2h

### 3.3 `skill_apply` — Aplicar clon a template
**Archivo:** `netlify/functions/mcp.mjs`
**Descripción:** Aplica una skill clonada a un template. Recorre los objetos y ajusta: colores a la paleta, tipografía, espaciado, proporciones según las reglas extraídas. Modo "strict" (cumplimiento total) o "adaptive" (respeta contenido, adapta estilo).
**Parámetros:** `templateId`, `skillId`, `mode` ("strict"|"adaptive"), `targetLayers[]` (opcional, solo ciertas capas)
**Output:** `{ applied: true, changes: [...], warnings: [...] }`
**Complejidad:** Alta | **Tiempo:** ~3h

### 3.4 `brand_analyze` + `brand_apply`
**Archivo:** `netlify/functions/mcp.mjs`
**Descripción:** `brand_analyze`: analiza múltiples templates (ej: todos los posts de Futuraria) para extraer ADN de marca global. `brand_apply`: aplica reglas de marca a cualquier template.
**Parámetros analyze:** `templateIds[]`, `brandName`
**Parámetros apply:** `templateId`, `brandId`, `strictness` (0-1)
**Output analyze:** `{ brandId, brandDNA: { colors, typography, spacing, logo, tone }, confidence }`
**Output apply:** `{ applied, scoreBefore, scoreAfter }`
**Complejidad:** Alta | **Tiempo:** ~3h

**Sprint 3 Total: ~11h (4 tools)**

---

## 🆕 SPRINT 4 — NUEVAS TOOLS (9 tools del gap analysis)

### 4.1 `batch_design_from_csv`
**Archivo:** `netlify/functions/mcp.mjs`
**Descripción:** Lee CSV/JSON con datos y genera múltiples templates automáticamente usando una plantilla base. Ej: 100 posts de Instagram desde un CSV con título, subtítulo, imagen.
**Parámetros:** `templateId` (plantilla), `dataSource` (CSV URL o JSON array), `fieldMapping[]`, `outputWorkspaceId`
**Complejidad:** Alta | **Tiempo:** ~3h

### 4.2 `aesthetic_score`
**Archivo:** `netlify/functions/mcp.mjs`
**Descripción:** Analiza un template y devuelve score de calidad estética 0-100 basado en: balance visual, contraste, alineación, jerarquía, consistencia, uso de espacio.
**Parámetros:** `templateId`
**Output:** `{ score, breakdown: { balance, contrast, alignment, hierarchy, consistency, spacing }, suggestions }`
**Complejidad:** Media | **Tiempo:** ~2h

### 4.3 `design_lint`
**Archivo:** `netlify/functions/mcp.mjs`
**Descripción:** Linter de diseño visual. Detecta: objetos desalineados, espaciado inconsistente, contraste insuficiente, fuentes inconsistentes, jerarquía visual pobre, objetos fuera de bounds.
**Parámetros:** `templateId`, `rules[]`
**Output:** `{ issues: [{ severity, layer, message, fix }], score, passRate }`
**Complejidad:** Media | **Tiempo:** ~2h

### 4.4 `observe_session` (streaming)
**Archivo:** `netlify/functions/mcp.mjs`
**Descripción:** Start/stop/analyze observación de sesión humana. Registra acciones del usuario y extrae patrones.
**Parámetros:** `templateId`, `action` ("start"|"stop"|"analyze")
**Complejidad:** Alta | **Tiempo:** ~3h

### 4.5 `smart_layout`
**Archivo:** `netlify/functions/mcp.mjs`
**Descripción:** Layouts avanzados: grid, masonry, golden ratio, circular, zigzag, flex-wrap.
**Parámetros:** `templateId`, `objectIds[]`, `layout`, `columns`, `gap`
**Complejidad:** Media | **Tiempo:** ~2h

### 4.6 `remix_template`
**Archivo:** `netlify/functions/mcp.mjs`
**Descripción:** Variaciones estilísticas de un template: brutalist, glassmorphism, swiss, cyberpunk, minimalist, art_deco, bauhaus.
**Parámetros:** `templateId`, `style`, `variations` (1-10)
**Complejidad:** Alta | **Tiempo:** ~3h

### 4.7 `design_diff`
**Archivo:** `netlify/functions/mcp.mjs`
**Descripción:** Compara dos templates estructural y visualmente.
**Parámetros:** `templateIdA`, `templateIdB`, `mode`
**Complejidad:** Alta | **Tiempo:** ~2h

### 4.8 `suggest_color_palette`
**Archivo:** `netlify/functions/mcp.mjs`
**Descripción:** Genera paletas de color basadas en teoría del color: complementary, analogous, triadic, monochromatic + mood-based.
**Parámetros:** `baseColor`, `type`, `count`
**Complejidad:** Baja | **Tiempo:** ~0.5h

### 4.9 `auto_polish`
**Archivo:** `netlify/functions/mcp.mjs`
**Descripción:** Aplica correcciones automáticas: alinear, distribuir, normalizar espaciado, mejorar contraste.
**Parámetros:** `templateId`, `aggressiveness` (0-1)
**Complejidad:** Media | **Tiempo:** ~1.5h

**Sprint 4 Total: ~19h (9 tools)**

---

## 📊 ESTIMADO TOTAL

| Sprint | Items | Tiempo | Tipo |
|--------|:-----:|--------|------|
| S1: UI Gaps P0 | 14 gaps | ~30h | Frontend |
| S2: Ghost System | 6 tools + UI | ~13.5h | MCP + Frontend |
| S3: Clone Skills | 4 tools | ~11h | MCP |
| S4: New Tools | 9 tools | ~19h | MCP |
| **TOTAL** | **33 items** | **~73.5h** | |

---

## 🔗 ORDEN DE IMPLEMENTACIÓN

1. **Sprint 1 (UI Gaps):** Primero porque todo lo demás depende de que el humano pueda VER lo que pasa
2. **Sprint 2 (Ghosts):** El sistema de fantasmas — la IA puede "ver" lo que hizo el humano
3. **Sprint 3 (Clone Skills):** La IA aprende del humano y replica su estilo
4. **Sprint 4 (New Tools):** Batch design, aesthetic quality, smart layout, remix

---

## ⚠️ REGLAS

- CERO migraciones de BD
- CERO dependencias nuevas
- Todo MCP-first: cada feature es una tool que un agente puede llamar
- Commits atómicos: 1 por feature/gap
- NO romper el autosave dual-write (`useAutoSave.ts`)
- Preservar el GovernancePanel existente

---

**Preparado por Lara** ✨ | Design Engineer, Futuraria
**Referencias:**
- `QA/UI_GAP_AND_NEW_FEATURES.md` — análisis completo
- `QA/REPORTE-SPRINT-F2-F4-2026-06-07.md` — estado 100 tools
- `docs/ROADMAP.md` — roadmap 83 features
- `docs/DATABASE_SCHEMA.md` — schema Supabase

---

# 📋 PLAN DE IMPLEMENTACIÓN — Qoder (Agente IA)

> **Audiencia:** Lara ✨ para revisión  
> **Fecha:** 7 Junio 2026 23:00 GMT-5  
> **Scope:** Sprint 1 — UI Gaps P0 (14 gaps)  
> **Principio:** Todo visible en UI. Commits atómicos. Cero migraciones.

---

## 🗺️ ARQUITECTURA ACTUAL — PUNTO DE PARTIDA

```
App.tsx (layout principal)
├── Toolbar.tsx (izquierda, 193 líneas)
│   ├── ToolbarButtons.tsx (botones base)
│   └── ToolbarDropdowns.tsx (dropdowns: shapes, draw, align, boolean)
├── CanvasEditor.tsx (centro, 306 líneas)
│   └── useCanvas.ts (hook, 993 líneas — toda la lógica del canvas)
├── PropertiesPanel.tsx (derecha, 863 líneas)
│   ├── Section (collapsible sections)
│   ├── Row (labeled input)
│   ├── ColorPicker (hex/rgba + alpha)
│   ├── GradientEditor (linear/radial stops)
│   └── ShadowEditor (presets + toggle + sliders)
├── LayersPanel.tsx (derecha, 601 líneas)
├── GovernancePanel.tsx (overlay modal, 226 líneas)
├── BatchAMator.tsx (overlay modal)
├── Dashboard.tsx (vista home)
├── KeyboardShortcuts.tsx (overlay modal)
└── Toast.tsx (provider de notificaciones)
```

**Comunicación App ↔ Canvas:** `window.__canvasControls` (polling 200ms en App.tsx)

**Comunicación App ↔ MCP:** `apiFetch("/mcp", ...)` con JSON-RPC 2.0

**Patrón de componentes:** Inline styles (sin Tailwind/CSS modules). Collapsible `<Section>` con `<Row>` inputs.

---

## 📊 EVALUACIÓN DE COMPLEJIDAD REAL

Tras analizar el código existente, ajusto estimaciones:

| # | Gap | Archivos | Est. Lara | Est. Qoder | Justificación |
|---|-----|----------|:---------:|:----------:|--------------|
| 1.1 | Blur | PropertiesPanel.tsx | 1h | **0.5h** | Ya existe ShadowEditor como patrón. Solo copiar + cambiar props. |
| 1.2 | Image Filters | PropertiesPanel.tsx | 1.5h | **1h** | Sliders simples. No requiere canvas custom rendering. |
| 1.3 | Image Crop | PropertiesPanel.tsx + useCanvas.ts | 2h | **1.5h** | Modo crop con handles en useCanvas ya tiene patrones de herramientas. |
| 1.4 | Styles Panel | NUEVO StylesPanel.tsx | 3h | **2h** | Panel simple: fetch styles del JSONB, render lista, botón crear/aplicar. |
| 1.5 | Variables Panel | NUEVO VariablesPanel.tsx | 3h | **2.5h** | UI de tabla + colecciones + link. Lógica más compleja. |
| 1.6 | Components Panel | NUEVO ComponentsPanel.tsx | 4h | **3h** | Lista + crear desde selección + arrastrar instancias. |
| 1.7 | Prototype Panel | NUEVO PrototypePanel.tsx | 4h | **3h** | Timeline + interactions + animations + overlay. El más complejo. |
| 1.8 | Embeds Toolbar | Toolbar.tsx | 2h | **1.5h** | Dropdown con modal URL. Patrón existente en dropdowns. |
| 1.9 | Doc Blocks Toolbar | Toolbar.tsx | 2h | **1.5h** | Dropdown con sub-tipos. Similar a Embeds. |
| 1.10 | Canvas Pages | NUEVO PagesPanel.tsx | 2h | **1.5h** | Panel simple. Lista de páginas con add/rename/switch. |
| 1.11 | Snap Toggle | Toolbar.tsx | 0.5h | **0.25h** | Solo agregar un botón toggle. `snapRef` ya existe en useCanvas. |
| 1.12 | History Timeline | GovernancePanel.tsx | 1h | **0.75h** | Agregar botones Undo/Redo + últimos 5 estados. Panel ya existe. |
| 1.13 | AI Panel | NUEVO AIPanel.tsx | 3h | **2h** | Form con prompts. Llamadas MCP simples. |
| 1.14 | Gallery UI | Toolbar.tsx | 1h | **0.75h** | Modal con inputs: URLs, columns, gap. |
| **TOTAL** | | | **30h** | **~22.25h** | |

---

## 🔧 PLAN DETALLADO POR GAP

### GAP 1.1 — Blur en PropertiesPanel

**Archivo:** `src/components/PropertiesPanel.tsx`  
**MCP tool:** `set_blur`  
**Commit:** `feat(ui): blur section in PropertiesPanel`

**Implementación:**
```tsx
// Nueva sección "Blur" después de Shadow, similar al ShadowEditor:
// - Toggle enable/disable (commit "filters[0].blur")
// - Slider 0-50 con input numérico  
// - Select tipo: Gaussian | Motion
//   - Si Motion: aparece angle slider (0-360°)
// - Solo visible cuando obj.type === "image" o permitido en cualquier objeto
// - Usa Fabric.js filters API: new fabric.Image.filters.Blur({ blur })
```

**Condición de visibilidad:** `!isFrameType` (se muestra para cualquier objeto no-frame)

**Props a leer del objeto:**
- `obj.filters?.[0]?.blur` → valor actual
- `obj.filters?.[0]?.type` → "gaussian" | "motion"

**UX Details:**
- El slider va de 0 a 50 con step 0.5
- Input numérico al lado para precisión
- Toggle grande "Enable Blur ✓" / "Disabled" como el de Shadow
- Si blur = 0 o no existe → toggle off

---

### GAP 1.2 — Image Filters en PropertiesPanel

**Archivo:** `src/components/PropertiesPanel.tsx`  
**MCP tool:** `image_filter`  
**Commit:** `feat(ui): image filters section in PropertiesPanel`

**Implementación:**
```tsx
// Nueva sección "Filters" visible SOLO cuando obj.type es imagen:
// - Row de presets: Grayscale | Sepia | Warm | Cool | Vivid
// - Sliders individuales (0-2 rango, step 0.05):
//   Brightness (0.5-1.5, default 1)
//   Contrast (0.5-1.5, default 1)
//   Saturation (0-2, default 1)
//   Hue Rotate (-180 a 180)
//   Blur (0-10)
// - Botón "Reset All" al fondo
// - Toggle Grayscale / Toggle Sepia como botones independientes
// - Toggle Invert
//
// API de Fabric.js:
//   obj.filters = []
//   obj.filters.push(new fabric.Image.filters.Brightness({ brightness: v }))
//   obj.applyFilters()
```

**Condición de visibilidad:** `obj.type === "image"`

**Props a leer del objeto:**
- `obj.filters[]` — array de filtros aplicados
- Cada filtro tiene `.type` (Brightness, Contrast, Saturation, Blur, Grayscale, Sepia, HueRotation, Invert)

**UX Details:**
- Cada slider muestra su valor actual numéricamente
- Los presets aplican múltiples filtros a la vez
- "Reset All" limpia `obj.filters = []` y llama `obj.applyFilters()`

---

### GAP 1.3 — Image Crop UI

**Archivos:** `src/components/PropertiesPanel.tsx`, `src/hooks/useCanvas.ts`  
**MCP tool:** `image_crop`  
**Commit:** `feat(ui): image crop mode with drag handles`

**Implementación:**
```tsx
// En PropertiesPanel → nueva sección "Crop" visible solo en imágenes:
// - Botón "Enter Crop Mode" que:
//   1. Guarda clipPath actual si existe
//   2. Crea cropRect (rectángulo semitransparente con handles)
//   3. Cambia tool temporalmente a modo crop
//
// En useCanvas → nuevo tool mode "crop":
// - Handles en esquinas del cropRect para arrastrar
// - Click fuera → "Apply Crop" (crea clipPath)
// - Escape → "Cancel Crop" (restaura estado original)
// - Mientras está en crop mode: overlay oscuro fuera del cropRect
//
// cropRect se renderiza como Rect con:
//   fill: 'rgba(0,0,0,0.3)'
//   stroke: '#6366f1'
//   strokeWidth: 2
//   strokeDashArray: [6, 4]
//   hasControls: true (handles en esquinas)
//   lockRotation: true
//   lockScalingFlip: true
//
// Al aplicar: obj.set({ cropX, cropY, width, height })
```

**Condición de visibilidad:** `obj.type === "image"`

**Estado en useCanvas:**
- `cropModeRef` — si está activo
- `cropTargetRef` — referencia a la imagen siendo cropeada
- `cropRectRef` — referencia al rect de crop

---

### GAP 1.4 — Panel de Styles

**Archivo:** NUEVO `src/components/StylesPanel.tsx`  
**MCP tools:** `create_style`, `apply_style`  
**Commit:** `feat(ui): StylesPanel with create/apply style`

**Implementación:**
```tsx
// Panel de 240px de ancho, mismo estilo que PropertiesPanel.
// Props:
//   templateId: string | null
//   selectedObjects: FabricObject[]
//   onUpdate: () => void
//
// Layout:
// ┌─────────────────────────────┐
// │ STYLES              [+ New] │ ← Header con botón crear
// ├─────────────────────────────┤
// │ ┌─────────────────────┐     │
// │ │ Heading H1          │     │ ← Style card con preview
// │ │ Text · 72px · Bold  │     │   color+typography en miniatura
// │ │ [Apply] [Delete]    │     │
// │ └─────────────────────┘     │
// │ ┌─────────────────────┐     │
// │ │ Card Shadow         │     │
// │ │ Effect · blur 8     │     │
// │ │ [Apply] [Delete]    │     │
// │ └─────────────────────┘     │
// └─────────────────────────────┘
//
// Botón [+ New]:
//   - Requiere selectedObjects.length === 1
//   - Abre modal: "Style Name" input
//   - Llama MCP: create_style(templateId, name, type, sourceLayerName)
//   - Refresca lista de styles desde get_template
//
// Botón [Apply]:
//   - Requiere selectedObjects.length >= 1
//   - Llama MCP: apply_style(templateId, styleId, targetLayerNames)
//   - onUpdate() para refrescar canvas
//
// Datos desde: get_template → tpl.styles[]
// Cada style: { id, name, type, properties: { fill, fontSize, fontFamily, ... } }
```

**Integración en App.tsx:**
```tsx
// Agregar después de LayersPanel:
<StylesPanel
  templateId={templateId}
  selectedObjects={selectedObjects}
  onUpdate={() => callCanvas("pushHistory")}
/>
```

---

### GAP 1.5 — Panel de Variables

**Archivo:** NUEVO `src/components/VariablesPanel.tsx`  
**MCP tools:** `create_variable`, `create_collection`, `link_variable`  
**Commit:** `feat(ui): VariablesPanel with collections and tokens`

**Implementación:**
```tsx
// Panel de 260px (más ancho, necesita espacio para tabla).
// Props:
//   templateId: string | null
//   selectedObjects: FabricObject[]
//   onUpdate: () => void
//
// Layout:
// ┌───────────────────────────────────┐
// │ VARIABLES       [+Var] [+Coll]   │ ← Header
// ├───────────────────────────────────┤
// │ Mode: [Light ▾]                  │ ← Selector de modo
// ├───────────────────────────────────┤
// │ Collection: Colors               │ ← Grupo collapsible
// │ ┌──────┬────────┬──────┬──────┐  │
// │ │ Name │  Type  │ Light│ Dark │  │ ← Tabla
// │ │──────┼────────┼──────┼──────│  │
// │ │primary│ color  │#cba6│#f5c2 │  │
// │ │bg     │ color  │#1e1e│#fafafa│ │
// │ └──────┴────────┴──────┴──────┘  │
// ├───────────────────────────────────┤
// │ Collection: Spacing              │
// │ ...                              │
// └───────────────────────────────────┘
//
// Al seleccionar un objeto:
// - En cada propiedad de color (Fill, Stroke, Shadow color):
//   botón "🔗" → dropdown con variables de tipo color
//   Al seleccionar → llama link_variable(variableId, targetLayerName, property)
//
// Botón [+Var]:
//   - Modal: Name, Type (color/number/string), Value, Collection
//   - Llama create_variable(templateId, name, type, value, collectionId)
//
// Botón [+Coll]:
//   - Modal: Name, Modes (comma-separated)
//   - Llama create_collection(templateId, name, modes)
//
// Datos desde: get_template → tpl.variables.collections[], tpl.variables.variables[]
```

**Integración en App.tsx:**
```tsx
// Stackear con PropertiesPanel o como tab:
// Opción A: Tab en el mismo espacio que PropertiesPanel ("Properties" | "Variables")
// Opción B: Panel separado debajo de PropertiesPanel (scroll independiente)
// Recomiendo Opción A: tabs para no saturar de paneles.
```

**Decisión de arquitectura:** Modificar `PropertiesPanel` para tener tabs: `Properties | Variables | Styles`. Esto evita 3 paneles verticales saturando el lado derecho. Si Lara prefiere paneles separados, se cambia.

---

### GAP 1.6 — Panel de Components

**Archivo:** NUEVO `src/components/ComponentsPanel.tsx`  
**MCP tools:** `create_component`, `create_instance`, `add_variant`, `set_component_prop`  
**Commit:** `feat(ui): ComponentsPanel with master/instance workflow`

**Implementación:**
```tsx
// Panel de 260px.
// Props:
//   templateId: string | null
//   selectedObjects: FabricObject[]
//   canvasRef: React.RefObject<Canvas | null>
//   onUpdate: () => void
//
// Layout:
// ┌──────────────────────────────┐
// │ COMPONENTS       [+ Create] │ ← Header
// ├──────────────────────────────┤
// │ ┌──────────────────────┐     │
// │ │ ◈ Button             │     │ ← Component card
// │ │ 2 objects · 3 vars   │     │
// │ │ [Add Variant] [Inst] │     │
// │ │ ┌ Variants ──────┐   │     │
// │ │ │ Primary (swap) │   │     │
// │ │ │ Secondary      │   │     │
// │ │ └────────────────┘   │     │
// │ └──────────────────────┘     │
// └──────────────────────────────┘
//
// Botón [+ Create]:
//   - Requiere selectedObjects.length >= 1
//   - Modal: Name, Description
//   - Llama create_component(templateId, name, objectIds)
//
// Botón [Inst] (Create Instance):
//   - Llama create_instance(templateId, componentId, x, y)
//   - Posición: centro del viewport o donde el usuario clickea
//
// Botón [Add Variant]:
//   - Modal: Variant Name, Properties override (key:value pairs)
//   - Llama add_variant(templateId, componentId, name, overrides)
//
// Al seleccionar instancia en canvas:
//   - Mostrar "Instance of [ComponentName]" en PropertiesPanel header
//   - Botón "Detach Instance" → convierte a objetos sueltos
```

**Integración en App.tsx:** como panel derecho adicional o como tab.

---

### GAP 1.7 — Panel de Prototype

**Archivo:** NUEVO `src/components/PrototypePanel.tsx`  
**MCP tools:** `set_animation`, `add_interaction`, `add_overlay`, `set_scroll_position`  
**Commit:** `feat(ui): PrototypePanel with interactions and animations`

**Implementación:**
```tsx
// Panel de 280px (el más ancho, necesita espacio para timeline).
// Props:
//   templateId: string | null
//   frames: any[]  // lista de frames existentes
//   selectedObjects: FabricObject[]
//   onUpdate: () => void
//
// Layout con TABS: Interactions | Animations | Overlay
//
// TAB 1 — Interactions:
// ┌──────────────────────────────────┐
// │ [+ Add Interaction]             │
// ├──────────────────────────────────┤
// │ Frame A → Frame B               │
// │ onClick · dissolve · 400ms      │
// │ [Edit] [Delete]                │
// ├──────────────────────────────────┤
// │ Frame B → Frame C               │
// │ onHover · push · 300ms          │
// └──────────────────────────────────┘
//
// Modal "Add Interaction":
//   Source: [Frame A ▾]
//   Trigger: [onClick ▾] (onClick/onHover/onPress/onDelay)
//   Action: [navigate ▾] (navigate/overlay/scroll/back/close)
//   Target: [Frame B ▾]
//   Transition: [dissolve ▾] (dissolve/slideIn/slideOut/push/smartAnimate/fade)
//   Duration: [400] ms
//   Easing: [easeInOut ▾]
//   Delay: [0] ms
//
// TAB 2 — Animations:
// ┌──────────────────────────────────┐
// │ [+ Add Animation]               │
// ├──────────────────────────────────┤
// │ Frame A                          │
// │ fade · 500ms · easeInOut        │
// │ [Preview] [Edit] [Delete]       │
// └──────────────────────────────────┘
//
// Modal "Add Animation":
//   Object: [auto-detect from selection ▾]
//   Type: [fade ▾]
//   Direction: [both ▾] (in/out/both)
//   Duration: [500] ms
//   Easing: [easeInOut ▾]
//   Delay: [0] ms
//
// TAB 3 — Overlay:
// ┌──────────────────────────────────┐
// │ Configure Overlay for Frame A   │
// ├──────────────────────────────────┤
// │ Position: [center ▾]            │
// │ Backdrop: [✓] enabled           │
// │ Backdrop Color: [#000000]       │
// │ Close on Backdrop: [✓]          │
// │ Manual X: [ ] | Manual Y: [ ]  │
// └──────────────────────────────────┘
```

**Datos desde:** get_template → `tpl.metadata.interactions[]`, `tpl.metadata.animations[]`, `frame.metadata.overlay`

---

### GAP 1.8 — Embeds en Toolbar

**Archivo:** `src/components/Toolbar.tsx` + NUEVO `src/components/toolbar/EmbedsDropdown.tsx`  
**MCP tools:** `embed_video`, `embed_audio`, `embed_figma`, `embed_pdf`, `embed_social`  
**Commit:** `feat(ui): embed dropdown in Toolbar (YouTube, Figma, PDF, Audio, Social)`

**Implementación:**
```tsx
// Nuevo componente EmbedsDropdown (patrón: igual que ShapesDropdown):
// - Botón en Toolbar con ícono de embed (svg)
// - Al click → dropdown con opciones:
//   🎬 Video (YouTube/Vimeo)
//   🎵 Audio (SoundCloud/Spotify)
//   📄 PDF
//   ⬡ Figma
//   🐦 Social (Twitter/GitHub/Instagram/LinkedIn)
//
// Al seleccionar una opción → modal con:
//   - Input: URL del recurso
//   - Preview: thumbnail si es video, icono si es PDF/Figma
//   - Botón "Embed"
//
// Al confirmar → llama MCP via apiFetch:
//   embed_video(templateId, url)
//   embed_audio(templateId, url)
//   etc.
//
// El resultado incluye x, y donde se colocó el placeholder.
```

**Integración en Toolbar.tsx:**
- Agregar prop: `onEmbed: (url: string, type: string) => void`
- Agregar prop: `templateId: string | null`
- Insertar `<EmbedsDropdown>` después del botón Image, antes del Divider

---

### GAP 1.9 — Document Blocks en Toolbar

**Archivo:** `src/components/Toolbar.tsx` + NUEVO `src/components/toolbar/BlocksDropdown.tsx`  
**MCP tools:** `add_block`, `add_code_block`, `add_table`, `add_columns`, `add_toggle`, `add_callout`, `add_quote`, `render_markdown`  
**Commit:** `feat(ui): blocks dropdown in Toolbar (text, code, table, callout, etc.)`

**Implementación:**
```tsx
// Nuevo componente BlocksDropdown:
// - Botón "Block" con ícono de documento
// - Dropdown con opciones:
//   📝 Text Block
//   📰 Header
//   💻 Code Block
//   📊 Table
//   📑 Columns
//   💬 Callout
//   ▸ Toggle
//   ❝ Quote
//   📋 Markdown Import
//
// Cada opción abre un modal específico:
//
// Text Block / Header: input de texto + selector de tipo
// Code Block: textarea de código + input de lenguaje
// Table: inputs para headers (comma-separated), rows (JSON)
// Columns: inputs para columnTexts (JSON array), headers
// Callout: selector de tipo (info/warning/tip/note/success/error), título, texto
// Toggle: título, contenido, expanded checkbox
// Quote: texto, autor, fuente
// Markdown: textarea para pegar markdown
//
// Cada modal confirma → llama MCP correspondiente
```

**Integración en Toolbar.tsx:**
- Agregar prop: `templateId: string | null`
- Agregar prop: `onBlockAdd: () => void` (para refrescar canvas)
- Insertar `<BlocksDropdown>` después de Embeds

---

### GAP 1.10 — Canvas Pages UI

**Archivo:** NUEVO `src/components/PagesPanel.tsx`  
**MCP tool:** `canvas_pages`  
**Commit:** `feat(ui): PagesPanel for multi-page canvas navigation`

**Implementación:**
```tsx
// Panel horizontal en la parte superior del canvas (tipo Figma).
// O panel izquierdo estrecho debajo del Toolbar.
// Props:
//   templateId: string | null
//   onPageChange: (pageId: string) => void
//
// Layout (horizontal superior):
// ┌─────────────────────────────────────────────┐
// │ [+ Page]  [Page 1 ▾] [Page 2] [Page 3]    │
// └─────────────────────────────────────────────┘
//
// Cada tab de página:
// - Click → activa esa página (cambia canvas.objects)
// - Doble click → rename
// - Click derecho / botón X → delete (si hay >1 página)
// - Drag & drop para reordenar
//
// Botón [+ Page]:
//   - Modal: Page Name
//   - Llama canvas_pages(templateId, action: "add", name)
//
// Datos desde: get_template → tpl.metadata.pages[]
// Cada page: { id, name, canvas: { objects, background }, order }
//
// Al cambiar de página:
//   1. Guardar canvas actual en la página activa
//   2. Cargar canvas de la nueva página
//   3. Esto implica guardar/restaurar el JSON del canvas en metadata
```

**Complejidad oculta:** Cambiar de página requiere serializar el canvas actual y deserializar el nuevo. Esto impacta `useCanvas.ts` y el ciclo de autosave. Se necesita un método `switchPage(pageId)` en `useCanvas.ts`.

**Integración en App.tsx:** como barra horizontal entre el top-bar y el canvas.

---

### GAP 1.11 — Canvas Snap Toggle

**Archivo:** `src/components/Toolbar.tsx`  
**MCP tool:** `canvas_snap`  
**Commit:** `feat(ui): snap toggle button in Toolbar`

**Implementación:**
```tsx
// Botón simple en Toolbar, cerca de los botones de zoom:
// - Icono: imán 🧲
// - Toggle visual: background verde cuando activo, gris cuando inactivo
// - Al click → toggle snapRef.current en useCanvas
// - Label: "Snap" con shortcut "⇧S"
//
// Ya existe snapRef en useCanvas.ts (línea 51).
// Solo falta:
//   1. Exponer toggleSnap en window.__canvasControls
//   2. Pasar prop onToggleSnap a Toolbar
//   3. Renderizar botón
//
// Expandir con dropdown al hacer click derecho / long press:
//   - ☐ Snap to Grid
//   - ☐ Snap to Objects
//   - Threshold: [8px ▾]
// Llama MCP canvas_snap para actualizar metadata.
```

---

### GAP 1.12 — History Timeline en GovernancePanel

**Archivo:** `src/components/GovernancePanel.tsx`  
**MCP tools:** `history_undo`, `history_redo`  
**Commit:** `feat(ui): undo/redo buttons and recent states in GovernancePanel`

**Implementación:**
```tsx
// Agregar en la parte superior del panel (debajo del header):
//
// ┌─────────────────────────────────┐
// │ ◀ Undo  |  Redo ▶             │ ← Botones Undo/Redo MCP
// ├─────────────────────────────────┤
// │ Recent States:                 │
// │ 22:15 · 12 objects · 2 frames │ ← Último estado
// │ 22:14 · 10 objects · 2 frames │ ← Penúltimo
// │ 22:10 · 8 objects · 1 frame   │
// │ 22:05 · 5 objects · 1 frame   │
// │ 22:00 · 0 objects · 0 frames  │
// └─────────────────────────────────┘
//
// Botón Undo:
//   - Llama MCP history_undo(templateId)
//   - onRestore() → refresca canvas
//
// Botón Redo:
//   - Llama MCP history_redo(templateId)
//   - onRestore() → refresca canvas
//
// Los "Recent States" se obtienen de list_snapshots con limit=5.
// Ya se cargan en el panel actual, solo agregar la sección visual.
```

**Cambios en GovernancePanel.tsx:**
- Agregar botones Undo/Redo inmediatamente después del header
- Agregar sección "Recent States" con los últimos 5 snapshots en formato compacto
- Cada estado muestra hora + conteo de objetos/frames

---

### GAP 1.13 — AI Tools UI

**Archivo:** NUEVO `src/components/AIPanel.tsx`  
**MCP tools:** `ai_generate_text`, `ai_generate_image`, `ai_palette`, `ai_suggest_layout`, `ai_translate`  
**Commit:** `feat(ui): AIPanel with text/image generation and design AI tools`

**Implementación:**
```tsx
// Panel de 260px accesible desde un botón en top-bar.
// Props:
//   templateId: string | null
//   onUpdate: () => void
//
// Layout con TABS: Generate | Analyze | Translate
//
// TAB 1 — Generate:
// ┌──────────────────────────────────┐
// │ Generate Text                   │
// │ ┌────────────────────────┐      │
// │ │ Write a hero headline  │      │ ← Prompt input
// │ │ for a SaaS landing...  │      │
// │ └────────────────────────┘      │
// │ ☐ Place on canvas at X: Y:     │
// │ [Generate Text]                │
// ├──────────────────────────────────┤
// │ Generate Image                  │
// │ Prompt: [                    ] │
// │ Style: [photorealistic ▾]      │
// │ [Generate Image]               │
// ├──────────────────────────────────┤
// │ Generate Palette                │
// │ Theme: [ocean sunset]          │
// │ Colors: [6 ▾]                  │
// │ [Generate Palette]             │
// └──────────────────────────────────┘
//
// TAB 2 — Analyze:
// ┌──────────────────────────────────┐
// │ Suggest Layout                  │
// │ Aspect: [alignment ▾]          │
// │ [Analyze Layout]               │
// │ ┌─ Results ───────────────┐    │
// │ │ Score: 78/100            │    │
// │ │ Issues:                  │    │
// │ │ • Text too small (12px)  │    │
// │ │ • Low contrast (2.1:1)   │    │
// │ │ • Elements misaligned    │    │
// │ └──────────────────────────┘    │
// └──────────────────────────────────┘
//
// TAB 3 — Translate:
// ┌──────────────────────────────────┐
// │ Translate                       │
// │ Source text:                    │
// │ ┌────────────────────────┐      │
// │ │ Hello world             │      │
// │ └────────────────────────┘      │
// │ ☐ Use selected object text     │
// │ To: [Spanish ▾]                │
// │ [Translate]                    │
// └──────────────────────────────────┘
```

**Integración en App.tsx:**
- Botón "🤖 AI" en top-bar (junto a Home, Shortcuts, Batch, Timeline)
- Abre AIPanel como overlay o panel derecho adicional

---

### GAP 1.14 — Gallery UI

**Archivo:** `src/components/Toolbar.tsx` (modal inline o componente separado)  
**MCP tool:** `gallery_create`  
**Commit:** `feat(ui): gallery creation modal with image URLs and grid config`

**Implementación:**
```tsx
// Botón "Gallery" en Toolbar (cerca de Image, Embeds, Blocks).
// Al click → modal:
//
// ┌──────────────────────────────────┐
// │ Create Gallery              [✕] │
// ├──────────────────────────────────┤
// │ Images:                         │
// │ ┌────────────────────────┐      │
// │ │ https://picsum.pho...  │ [✕] │ ← Lista de URL inputs
// │ │ https://picsum.pho...  │ [✕] │   con botón remove
// │ │                        │      │
// │ └────────────────────────┘      │
// │ [+ Add Image URL]               │
// ├──────────────────────────────────┤
// │ Columns: [3 ▾] (1-6)           │
// │ Image Width: [200] px          │
// │ Image Height: [200] px         │
// │ Gap: [16] px                   │
// ├──────────────────────────────────┤
// │ Captions:                       │
// │ ☐ Show captions below images   │
// ├──────────────────────────────────┤
// │ [Create Gallery]                │
// └──────────────────────────────────┘
//
// Al confirmar → llama MCP gallery_create(templateId, images, columns, ...)
```

**Integración en Toolbar.tsx:** como botón independiente.

---

## 📦 PLAN DE COMMITS (14 commits atómicos)

| # | Commit message | Archivos |
|---|---------------|----------|
| 1 | `feat(ui): blur section in PropertiesPanel (set_blur MCP tool)` | PropertiesPanel.tsx |
| 2 | `feat(ui): image filters section in PropertiesPanel (image_filter MCP tool)` | PropertiesPanel.tsx |
| 3 | `feat(ui): image crop mode with drag handles (image_crop MCP tool)` | PropertiesPanel.tsx, useCanvas.ts |
| 4 | `feat(ui): StylesPanel with create and apply style (create_style, apply_style MCP)` | StylesPanel.tsx (NEW), App.tsx |
| 5 | `feat(ui): VariablesPanel with collections and tokens (create_variable, create_collection, link_variable MCP)` | VariablesPanel.tsx (NEW), App.tsx |
| 6 | `feat(ui): ComponentsPanel with master/instance workflow (create_component, create_instance, add_variant, set_component_prop MCP)` | ComponentsPanel.tsx (NEW), App.tsx |
| 7 | `feat(ui): PrototypePanel with interactions, animations, overlay (set_animation, add_interaction, add_overlay, set_scroll_position MCP)` | PrototypePanel.tsx (NEW), App.tsx |
| 8 | `feat(ui): embed dropdown in Toolbar (embed_video, embed_audio, embed_figma, embed_pdf, embed_social MCP)` | Toolbar.tsx, EmbedsDropdown.tsx (NEW), App.tsx |
| 9 | `feat(ui): blocks dropdown in Toolbar (add_block, add_code_block, add_table, add_columns, add_toggle, add_callout, add_quote, render_markdown MCP)` | Toolbar.tsx, BlocksDropdown.tsx (NEW), App.tsx |
| 10 | `feat(ui): PagesPanel for multi-page canvas navigation (canvas_pages MCP)` | PagesPanel.tsx (NEW), useCanvas.ts, App.tsx |
| 11 | `feat(ui): snap toggle button in Toolbar (canvas_snap MCP)` | Toolbar.tsx, useCanvas.ts, App.tsx |
| 12 | `feat(ui): undo/redo buttons and recent states in GovernancePanel (history_undo, history_redo MCP)` | GovernancePanel.tsx |
| 13 | `feat(ui): AIPanel with text/image generation and design analysis (ai_generate_text, ai_generate_image, ai_palette, ai_suggest_layout, ai_translate MCP)` | AIPanel.tsx (NEW), App.tsx |
| 14 | `feat(ui): gallery creation modal in Toolbar (gallery_create MCP)` | Toolbar.tsx, App.tsx |

---

## 🔗 DEPENDENCIAS ENTRE GAPS

```
G1 (Blur) ──── independiente
G2 (Filters) ─ independiente (mismo archivo que G1 pero sección distinta)
G3 (Crop) ──── independiente (toca useCanvas.ts)
G4 (Styles) ── independiente (nuevo archivo)
G5 (Vars) ──── independiente (nuevo archivo)
G6 (Comps) ── independiente (nuevo archivo)
G7 (Proto) ── independiente (nuevo archivo)
G8 (Embeds) ─ depende de App.tsx (nuevas props en Toolbar)
G9 (Blocks) ─ depende de App.tsx (nuevas props en Toolbar)
G10 (Pages) ─ depende de useCanvas.ts (nuevo método switchPage)
G11 (Snap) ── depende de useCanvas.ts + App.tsx
G12 (History) ─ independiente (solo GovernancePanel)
G13 (AI) ──── independiente (nuevo archivo)
G14 (Gallery) ─ depende de App.tsx (nuevas props en Toolbar)
```

**Orden recomendado de implementación:**
```
1→2→3 (PropertiesPanel, sin conflictos)
4→5→6→7 (paneles nuevos, independientes)
8→9→11→14 (Toolbar, agrupar cambios en Toolbar)
10 (Pages, el más complejo)
12→13 (finales, sin dependencias)
```

---

## 🔌 INTEGRACIÓN MCP EN FRONTEND

Todas las llamadas MCP desde los nuevos componentes usarán el mismo patrón que GovernancePanel:

```ts
// Helper existente en GovernancePanel.tsx — extraer a lib/mcpClient.ts
async function mcpCall(method: string, params: Record<string, any>) {
  const res = await apiFetch("/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || "MCP error");
  return json.result;
}
```

**Plan:** Extraer `mcpCall` a `src/lib/mcpClient.ts` para reutilizar en todos los nuevos paneles.

---

## ⚠️ RIESGOS Y MITIGACIONES

| Riesgo | Probabilidad | Mitigación |
|--------|:-----------:|-----------|
| Demasiados paneles derechos saturan UI | Alta | Usar tabs en PropertiesPanel (Properties/Variables/Styles). Solo Components y Prototype como paneles extras o modales. |
| Canvas pages requiere refactor de useCanvas | Alta | Implementar switchPage como serialización/deserialización del JSON del canvas. No cambia la estructura de datos, solo guarda/carga. |
| Image crop mode interfiere con otras tools | Media | Implementar como tool mode "crop" que bloquea otras interacciones. Escape para cancelar. |
| Llamadas MCP desde frontend sin feedback | Media | Usar Toast provider existente para errores. Mostrar "Loading..." en botones durante llamadas. |
| GovernancePanel ya tiene snapshots — conflicto con History | Baja | Los snapshots son del sistema MCP (persisten en DB). Undo/Redo son del canvas local (historyRef en useCanvas). Complementarios, no conflictivos. |

---

## 🎯 DEFINICIÓN DE "DONE" POR GAP

Cada gap se considera completo cuando:
1. ✅ El componente/elemento UI renderiza correctamente en el editor
2. ✅ La interacción del usuario dispara la MCP tool correspondiente
3. ✅ El resultado de la MCP tool es visible en el canvas (tras refresh)
4. ✅ No hay errores en consola
5. ✅ No rompe el autosave (useAutoSave sigue funcionando)
6. ✅ El commit tiene mensaje descriptivo siguiendo conventional commits

---

**Plan preparado por Qoder** | 7 Junio 2026 23:00 GMT-5  
**Próximo paso:** Lara revisa este plan. Al aprobar, ejecuto Sprint 1 secuencialmente.
