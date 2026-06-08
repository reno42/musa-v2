# 🎯 /goal — Qoder Sprint 5: UI for Sprints 3-4

> **Fecha:** 2026-06-07 22:58 GMT-5 | **Preparado por:** Lara ✨
> **Repo:** `design-main/` → GitHub: `reno42/design`
> **Contexto:** 119 MCP tools existen. 100 tienen UI (Sprint 1). 5 ghost tools tienen UI (Sprint 2). 14 tools de Sprints 3-4 NO tienen UI.
> **Meta:** Crear 5 paneles UI que expongan las 14 tools restantes, integrarlos en App.tsx.

---

## 📊 STATE OF THE UNION

| Sprint | Tools | UI Status |
|--------|-------|-----------|
| Sprint 1 | 100 tools | ✅ UI completa (19 archivos, 15 commits) |
| Sprint 2 | 5 ghost tools | ✅ GhostPanel.tsx existe |
| Sprint 3 | 5 clone skills | ❌ SIN UI |
| Sprint 4 | 9 new tools | ❌ SIN UI |
| **Sprint 5** | **14 tools** | **🎯 Este sprint** |

### Herramientas sin UI:

**Sprint 3 — Clone Skills (5):**
- `skill_extract` — analiza template(s), extrae patrones de diseño
- `skill_clone` — crea skill clonada reutilizable
- `skill_apply` — aplica skill clonada a un template
- `brand_analyze` — extrae brand DNA de múltiples templates
- `brand_apply` — aplica brand DNA a un template

**Sprint 4 — New Tools (9):**
- `batch_design_from_csv` — genera templates en lote desde CSV/JSON
- `aesthetic_score` — score de calidad 0-100 con breakdown por categoría
- `design_lint` — linter de diseño con issues cliqueables
- `observe_session` — graba/analiza sesiones humanas
- `smart_layout` — 6 algoritmos de layout avanzados
- `remix_template` — 7 estilos de variación de templates
- `design_diff` — diff estructural entre dos templates
- `suggest_color_palette` — 6 tipos de armonía cromática + moods
- `auto_polish` — correcciones automáticas con slider de aggressiveness

---

## 🗄️ DATABASE CONTEXT

- Supabase: `npdycbfhtcccznbndrkl.supabase.co`
- Schema JSONB-hybrid: tablas `templates`, `workspaces`
- **CERO migraciones requeridas.** Todo va en `metadata.*` (JSONB) o in-memory stores (`globalThis.__brand_profiles`, `globalThis.__observe_sessions`)
- MCP tools ya implementadas en `netlify/functions/mcp.mjs` — solo falta la UI

---

## 🔧 PATRONES DE CÓDIGO

### mcpCall
```typescript
import { mcpCall } from "../lib/mcpClient";

const result = await mcpCall("skill_extract", { templateId, useAi: true });
```

### Props estándar de panel
```typescript
interface PanelProps {
  templateId: string | null;
  onClose: () => void;
  onUpdate?: () => void;       // si refresca el canvas
  selectedObjects?: any[];      // si necesita selección actual
}
```

### Integración en App.tsx (patrón ref-toggle)
```typescript
// 1. Declarar ref + setState trigger
const panelOpenRef = useRef(false);
const [, setPanelKey] = useState(0);

// 2. Botón en top-bar
<button onClick={() => { panelOpenRef.current = !panelOpenRef.current; setPanelKey(n => n + 1); }}
  style={topBtn}>🧬 Skills</button>

// 3. Render condicional al final, después de los modales existentes
{panelOpenRef.current && <SkillPanel templateId={templateId} onClose={() => { panelOpenRef.current = false; setPanelKey(n => n + 1); }} />}
```

### Estilos (convención del proyecto)
- Inline styles (sin Tailwind/CSS modules/Styled Components)
- Dark theme: fondo `#0d0d16`, bordes `#1c1c26`, texto `#c4c4d4`
- Botones: mini-botones con `fontSize: 10`, `borderRadius: 4`, `padding: "3px 8px"`
- Selectores: flex row con botones toggle (tipo pestañas pequeñas)
- Sliders: `accentColor: "#818cf8"`
- Paneles overlay: posición fixed, centrado, con backdrop oscuro

### Estructura de archivos
```
src/components/
├── GhostPanel.tsx          ← YA existe ✅
├── SkillPanel.tsx          ← NUEVO 🆕
├── BatchPanel.tsx          ← NUEVO 🆕 (reemplaza/aumenta BatchAMator.tsx)
├── QualityPanel.tsx        ← NUEVO 🆕
├── CreativePanel.tsx       ← NUEVO 🆕
```

---

## 📋 PLAN DE IMPLEMENTACIÓN

---

### COMMIT 1/5: `feat(ui): SkillPanel — Clone Skills UI (skill_extract, skill_clone, skill_apply, brand_analyze, brand_apply)`

**Archivo:** NUEVO `src/components/SkillPanel.tsx`

**Props:**
```typescript
interface SkillPanelProps {
  templateId: string | null;
  onClose: () => void;
  onUpdate: () => void;
}
```

**Diseño:** Panel overlay modal (como AIPanel.tsx) con tabs internos:

```
┌─────────────────────────────────────────┐
│  🧬 Clone Skills                    ✕   │
├─────────────────────────────────────────┤
│  [Extract] [Clone] [Apply] [Brand]      │
├─────────────────────────────────────────┤
│  ← contenido cambia según tab →         │
│                                          │
│  ── Saved Skills ──                     │
│  │ Brutalist Dark  │ 3 patterns  [▶]   │
│  │ Swiss Minimal   │ 5 patterns  [▶]   │
│  └──────────────────────────────────────│
└─────────────────────────────────────────┘
```

**Tab 1 — Extract:**
- Input: templateId (pre-llenado con el actual)
- Text input opcional: "Skill Name"
- Toggle: "Use AI semantic analysis"
- Botón "🔍 Extract Patterns" → `mcpCall("skill_extract", { templateId, name, useAi })`
- Resultado: preview de patterns extraídos (palette swatches, fonts, spacing scale, etc.)
- Botón "Save as Skill" → pre-llena el tab Clone con los patterns

**Tab 2 — Clone:**
- Input: Skill Name, Description
- Textarea/JSON editor para patterns (pre-llenado desde Extract o manual)
- Input: sourceTemplateId (provenance)
- Botón "🧬 Clone Skill" → `mcpCall("skill_clone", { templateId, skillName, description, patterns, rules, sourceTemplateId })`
- Feedback: skillId generado + confirmación

**Tab 3 — Apply:**
- Select/Dropdown: Skill ID o Skill Name (fetch de `template.metadata.clonedSkills[]` o del estado local)
- Radio group: Mode (strict | adaptive)
- Botón "▶ Apply Skill" → `mcpCall("skill_apply", { templateId, skillId, mode })`
- Resultado: change log por layer (colores cambiados, fuentes swap, spacing ajustes)
- Botón "Refresh Canvas" → `onUpdate()`

**Tab 4 — Brand:**
- Sub-tabs: [Analyze] [Apply]

  **Analyze:**
  - Multi-select: template IDs (fetch de workspace para lista)
  - Input: brandName
  - Toggle: "Use AI"
  - Botón "🔬 Analyze Brand" → `mcpCall("brand_analyze", { templateIds, brandName, useAi })`
  - Resultado: brand DNA preview (top 6 colores, top 3 fonts, spacing median, confidence score)

  **Apply:**
  - Select: brand DNA (de la caché local después de analyze)
  - Slider: aggressiveness 0-1 (default 0.8)
  - Botón "🎯 Apply Brand" → `mcpCall("brand_apply", { templateId, brandDNA, aggressiveness })`
  - Resultado: before/after compliance scores + change summary
  - Botón "Refresh Canvas"

**Saved Skills sidebar (siempre visible):**
- Mini-lista de skills clonadas en el template actual
- Fetch desde `template.metadata.clonedSkills[]` vía `getTemplate(templateId)`
- Cada skill muestra: nombre, descripción (1 línea), cantidad de patterns
- Click en skill → pre-selecciona en tab Apply

**Tiempo estimado:** ~3h

---

### COMMIT 2/5: `feat(ui): BatchPanel — CSV/JSON batch design UI (batch_design_from_csv)`

**Archivo:** NUEVO `src/components/BatchPanel.tsx`

**Nota:** `BatchAMator.tsx` YA existe pero es un batch renderer de posts (single-post, multi-post, carousel) que usa su propia lógica sin llamar `batch_design_from_csv`. Este NUEVO panel es complementario — expone la MCP tool `batch_design_from_csv` que ya está implementada.

**Props:**
```typescript
interface BatchPanelProps {
  templateId: string | null;
  onClose: () => void;
}
```

**Diseño:** Panel overlay modal con 3 pasos:

```
┌──────────────────────────────────────────┐
│  📦 Batch Design                     ✕   │
├──────────────────────────────────────────┤
│  Step 1: Data Source                     │
│  ┌──────────────────────────────────┐    │
│  │ [📁 Upload CSV]  [🔗 Paste URL]  │    │
│  │                                  │    │
│  │ O paste JSON inline:             │    │
│  │ ┌──────────────────────────────┐ │    │
│  │ │ [{"title":"Post 1",...},...] │ │    │
│  │ └──────────────────────────────┘ │    │
│  └──────────────────────────────────┘    │
│                                          │
│  Step 2: Field Mapping                   │
│  CSV Header → Layer Name                 │
│  ┌──────────────────────────────────┐    │
│  │ title      → [Title Layer ▼]     │    │
│  │ subtitle   → [Subtitle Layer ▼]  │    │
│  │ image_url  → [Image Layer ▼]     │    │
│  │ [+ Add Mapping]                  │    │
│  └──────────────────────────────────┘    │
│                                          │
│  Step 3: Generate                        │
│  Base Template: [actual]                 │
│  Name Template: Post - {title}           │
│  ┌──────────────────────────────────┐    │
│  │ [⚡ Generate {N} Templates]       │    │
│  └──────────────────────────────────┘    │
│                                          │
│  ── Preview (first 5 rows) ──            │
│  │ row 1: Post - Hello World     ✅     │
│  │ row 2: Post - Foo Bar         ✅     │
│  └──────────────────────────────────────│
└──────────────────────────────────────────┘
```

**Step 1 — Data Source:**
- Input type selector: CSV Upload | CSV URL | JSON Inline
- CSV Upload: `<input type="file" accept=".csv">` → FileReader → parse con Papa Parse (built-in simple parser o usar el que ya tiene BatchAMator como referencia)
- CSV URL: text input para URL → `mcpCall("batch_design_from_csv", { baseTemplateId, csvUrl, ... })`
- JSON Inline: textarea → parse JSON → pasar como `data` param

**Step 2 — Field Mapping:**
- Detectar column headers del CSV/JSON automáticamente
- Para cada header, mostrar dropdown con los layer names del template actual
- Los layer names se obtienen del `templateJson` (objects del canvas)
- Guardar mapeo en estado: `{ [columnName]: layerName }`

**Step 3 — Generate:**
- Mostrar base template (el templateId actual)
- Name template input con placeholder: `Post - {title}` (usa placeholders entre llaves)
- Botón "Generate N Templates" → `mcpCall("batch_design_from_csv", { baseTemplateId, csvUrl o data, fieldMapping, outputWorkspaceId, nameTemplate })`
- Durante generación: spinner + progreso
- Resultado: lista de template IDs generados con status per-row
- Preview: tabla con primeros 5 resultados (nombre, status, ID)

**Preview de resultados:**
- Tabla: Row # | Template Name | Status | Template ID
- Status icons: ✅ success, ⚠️ warning, ❌ error
- Hover en error → tooltip con mensaje
- Botón "Open in Dashboard" para ver en dashboard

**Tiempo estimado:** ~2.5h

---

### COMMIT 3/5: `feat(ui): QualityPanel — Design quality tools (aesthetic_score, design_lint, auto_polish, suggest_color_palette)`

**Archivo:** NUEVO `src/components/QualityPanel.tsx`

**Props:**
```typescript
interface QualityPanelProps {
  templateId: string | null;
  onClose: () => void;
  onUpdate: () => void;
}
```

**Diseño:** Panel overlay modal con 4 tabs:

```
┌──────────────────────────────────────────┐
│  ✨ Quality Tools                    ✕   │
├──────────────────────────────────────────┤
│  [Score] [Lint] [Polish] [Palette]       │
├──────────────────────────────────────────┤
│  ← contenido cambia según tab →         │
└──────────────────────────────────────────┘
```

**Tab 1 — Aesthetic Score:**
- Toggle: "Use AI semantic analysis"
- Botón "📊 Analyze Design" → `mcpCall("aesthetic_score", { templateId, useAi })`
- Display: score circular grande (0-100) con gradiente de color:
  - 0-39: rojo (#f87171)
  - 40-59: amarillo (#fbbf24)
  - 60-79: azul (#60a5fa)
  - 80-100: verde (#4ade80)

- Breakdown visual con 6 barras horizontales:
```
  Balance     ████████████████░░░░  78/100
  Contrast    ██████████░░░░░░░░░░  52/100
  Alignment   ████████████████████  89/100
  Hierarchy   ████████████░░░░░░░░  65/100
  Consistency ██████████████████░░  82/100
  Spacing     ██████████░░░░░░░░░░  48/100
```

- AI insights (si useAi=true): texto explicativo de la evaluación semántica
- Botón "Re-analyze" para refrescar

**Tab 2 — Design Lint:**
- Select: strictness (relaxed | normal | strict) — default "normal"
- Botón "🔍 Lint Design" → `mcpCall("design_lint", { templateId, strictness })`
- Resultado: lista de issues cliqueables

```
  ┌────────────────────────────────────────┐
  │ Issues Found: 5  Pass Rate: 73%        │
  ├────────────────────────────────────────┤
  │ 🔴 ERROR   │ "Title" is 3.2px off-grid │
  │            │ Fix: snap to nearest 8px  │
  │            │ [Fix] [Select Layer]      │
  ├────────────────────────────────────────┤
  │ 🟡 WARNING │ Font inconsistency: 5     │
  │            │ fonts found in 12 layers  │
  │            │ Suggested: Roboto         │
  ├────────────────────────────────────────┤
  │ 🔵 INFO    │ "Subtitle" text size 10px │
  │            │ below 12px minimum        │
  └────────────────────────────────────────┘
```

- Cada issue muestra:
  - Severity icon (🔴 error, 🟡 warning, 🔵 info)
  - Layer name afectado
  - Mensaje descriptivo
  - Sugerencia de fix
  - Botones: [Fix] (si la tool tiene auto-fix) y [Select Layer] (para resaltar en canvas)

- Filtros rápidos: "All" | "Errors Only" | "Warnings Only"
- Summary bar: Pass Rate con barra de progreso

**Tab 3 — Auto Polish:**
- Slider: aggressiveness 0-1 (default 0.7)
  ```
  Gentle ▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░ Aggressive
        0.7
  ```
- Toggles:
  - ☑ Align to grid (grid size: [8] px)
  - ☑ Boost contrast (WCAG AA)
  - ☑ Normalize spacing
- Botón "✨ Polish Design" → `mcpCall("auto_polish", { templateId, aggressiveness, alignToGrid, gridSize, boostContrast })`
- Resultado: before/after aesthetic scores side by side:
  ```
  Before: 52/100  →  After: 81/100  (+29 🎉)
  ```
- Change log: lista de correcciones aplicadas
  ```
  ✓ Snapped "Title" to grid (3.2px → 0px)
  ✓ Boosted "Subtitle" contrast (luminance 18% → 42%)
  ✓ Normalized spacing across 8 objects
  ```
- Botón "Refresh Canvas" → `onUpdate()`

**Tab 4 — Color Palette:**
- Color picker: base color (hex input + native color input)
- Select: harmony type
  - complementary (180°)
  - analogous (±30°)
  - triadic (±120°)
  - monochromatic (varied S/L)
  - split-complementary
  - tetradic
- Select: count (2-8, default depende del tipo)
- Select: mood
  - vibrant | muted | dark | light | pastel | professional
- Botón "🎨 Generate Palette" → `mcpCall("suggest_color_palette", { baseColor, type, count, mood })`
- Preview: swatches grid con:
  - Cada color como círculo/rectángulo con el hex debajo
  - Role semántico debajo del hex (primary, secondary, accent, etc.)
  - Click en swatch → copia hex al portapapeles + mini toast "Copied #3B82F6!"
  - Botón "Apply to Template" → podría crear un style con esta palette

**Tiempo estimado:** ~3.5h

---

### COMMIT 4/5: `feat(ui): CreativePanel — Creative tools UI (smart_layout, remix_template, design_diff, observe_session)`

**Archivo:** NUEVO `src/components/CreativePanel.tsx`

**Props:**
```typescript
interface CreativePanelProps {
  templateId: string | null;
  selectedObjects: any[];
  onClose: () => void;
  onUpdate: () => void;
}
```

**Diseño:** Panel overlay modal con 4 tabs:

```
┌──────────────────────────────────────────┐
│  🎨 Creative Tools                   ✕   │
├──────────────────────────────────────────┤
│  [Layout] [Remix] [Diff] [Observe]       │
├──────────────────────────────────────────┤
│  ← contenido cambia según tab →         │
└──────────────────────────────────────────┘
```

**Tab 1 — Smart Layout:**
- Select: layout algorithm
  - Grid (📐) | Masonry (🧱) | Golden Ratio (φ) | Circular (⭕) | Zigzag (⚡) | Flex-Wrap (📏)
- Cada layout muestra una mini-preview ilustrativa:
  - Grid: dots en grid 3x3
  - Masonry: columnas de altura variable
  - Golden Ratio: espiral de Fibonacci
  - Circular: dots en círculo
  - Zigzag: línea en zigzag
  - Flex-Wrap: dots wrapping

- Opciones dinámicas según layout:
  - Grid/Masonry: columns [3], gap [16] px
  - Golden Ratio: startX [0], startY [0]
  - Circular: radius [300] px, startX, startY
  - Zigzag: amplitude [40] px, gap [16] px
  - Flex-Wrap: maxWidth [canvas width], gap [16] px

- Opcional: "Target specific layers" → multi-select de layer names del canvas
- Botón "🎯 Apply Layout" → `mcpCall("smart_layout", { templateId, targetLayerNames, layout, columns, gap, startX, startY, radius, amplitude, maxWidth })`
- Botón "Refresh Canvas" → `onUpdate()`

**Tab 2 — Remix Template:**
- Grid de 7 estilos con preview card cada uno:
  ```
  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
  │█████████│ │▓▓░░░░░░│ │▪▪▪▪▪▪▪▪▪│ │▒▒▒▒▒▒▒▒▒│
  │█████████│ │▓▓░░░░░░│ │▪▪  ▪▪  ▪│ │ ▒▒ ▒▒ ▒▒│
  │  BRUTAL │ │  GLASS  │ │  SWISS  │ │CYBERPUNK│
  └─────────┘ └─────────┘ └─────────┘ └─────────┘
  ┌─────────┐ ┌─────────┐ ┌─────────┐
  │         │ │══╗ ╔══╗ │ │▚▚▚▚▚▚▚▚▚│
  │ MINIMAL │ │ART DECO │ │ BAUHAUS │
  └─────────┘ └─────────┘ └─────────┘
  ```

- Cada card muestra:
  - Nombre del estilo
  - Mini-preview abstracto del estilo (colores característicos como fondo)
  - Hover: descripción del estilo (ej: "High contrast, raw textures, bold typography")
  - Selected: border highlight (#818cf8) + checkmark

- Select: number of variations (1-5, default 1)
- Botón "🎭 Remix" → `mcpCall("remix_template", { templateId, style, count })`
- Loading: spinner con mensaje "Generando variaciones..."
- Resultado: lista de templates generados con link "Open" para abrir en editor

**Tab 3 — Design Diff:**
- Dos selects: Template A (baseline, default=actual) | Template B (comparison)
  - Fetch lista de templates del workspace vía `apiFetch("/api/templates?workspaceId=...")`
  - Cada select muestra: thumbnail (si existe), nombre, fecha de update

- Botón "🔍 Compare" → `mcpCall("design_diff", { templateIdA, templateIdB })`

- Resultado: vista side-by-side (o stacked en panel estrecho):
  ```
  ┌────────────────────────────────────────┐
  │  Similarity Score: 73%                  │
  │  ██████████████████░░░░░░░░            │
  ├────────────────────────────────────────┤
  │  Template A (baseline)                 │
  │  Objects: 15  Types: rect(5), text(3)… │
  │  Fonts: Inter(6), Roboto(3)            │
  ├────────────────────────────────────────┤
  │  Template B (comparison)               │
  │  Objects: 18  Types: rect(6), text(4)… │
  │  Fonts: Inter(7), Montserrat(2)        │
  └────────────────────────────────────────┘
  ```

- Lista de diferencias capa por capa:
  - Layer name | Status (added/modified/removed/moved)
  - Color coding: verde/amarillo/rojo (mismo patrón que GhostPanel diff)
  - Si hay cambios de posición: "Moved from (100,200) to (150,250)"

**Tab 4 — Observe Session:**
- Estado actual: indicador de grabación (🔴 REC / ⚪ IDLE)

- Botones:
  - "▶ Start Recording" → `mcpCall("observe_session", { action: "start", userId, templateId })`
  - "⏹ Stop Recording" → `mcpCall("observe_session", { action: "stop", userId })`
  - "📊 Analyze" → `mcpCall("observe_session", { action: "analyze", userId })`

- Durante grabación:
  - Badge pulsante "🔴 RECORDING" en rojo
  - Contador de eventos en tiempo real (polling cada 2s o evento vía window)

- Resultado de Analyze:
  ```
  ┌────────────────────────────────────────┐
  │  Session Analysis                       │
  ├────────────────────────────────────────┤
  │  Duration: 12m 34s                      │
  │  Total Events: 47                       │
  │                                         │
  │  Most Used Tools:                       │
  │  ████████████ set_fill      14 calls    │
  │  ██████ set_position        7 calls    │
  │  ████ canvas_zoom           4 calls    │
  │                                         │
  │  Action Breakdown:                      │
  │  mcpTool: 32 (68%)                     │
  │  canvasAction: 12 (26%)                │
  │  navigation: 3 (6%)                    │
  │                                         │
  │  Workflow Timeline:                     │
  │  00:00 → create_rectangle               │
  │  01:23 → set_fill                       │
  │  02:45 → set_position                   │
  │  ...                                    │
  │                                         │
  │  Insights:                              │
  │  • You tend to adjust colors after      │
  │    positioning objects                  │
  │  • Most frequent action: set_fill       │
  └────────────────────────────────────────┘
  ```

**Tiempo estimado:** ~4h

---

### COMMIT 5/5: `feat(ui): integrate Sprint 5 panels into App.tsx`

**Archivo:** `src/components/App.tsx` (modificar existente)

**Cambios:**

1. **Imports** — agregar los 4 nuevos componentes:
```typescript
import { SkillPanel } from "./components/SkillPanel";
import { BatchPanel } from "./components/BatchPanel";
import { QualityPanel } from "./components/QualityPanel";
import { CreativePanel } from "./components/CreativePanel";
```

2. **Refs + trigger states** — agregar antes de los refs existentes:
```typescript
const skillsOpenRef = useRef(false);
const [, setSkillsKey] = useState(0);
const batchPanelOpenRef = useRef(false);
const [, setBatchPanelKey] = useState(0);
const qualityOpenRef = useRef(false);
const [, setQualityKey] = useState(0);
const creativeOpenRef = useRef(false);
const [, setCreativeKey] = useState(0);
```

3. **Top-bar buttons** — agregar en el `<div style={{ position: "absolute", top: 8, left: 8, ... }}>`:
```tsx
<button type="button" onClick={() => { skillsOpenRef.current = !skillsOpenRef.current; setSkillsKey(n => n + 1); }} style={topBtn}>🧬 Skills</button>
<button type="button" onClick={() => { batchPanelOpenRef.current = !batchPanelOpenRef.current; setBatchPanelKey(n => n + 1); }} style={topBtn}>📦 Batch</button>
<button type="button" onClick={() => { qualityOpenRef.current = !qualityOpenRef.current; setQualityKey(n => n + 1); }} style={topBtn}>✨ Quality</button>
<button type="button" onClick={() => { creativeOpenRef.current = !creativeOpenRef.current; setCreativeKey(n => n + 1); }} style={topBtn}>🎨 Creative</button>
```

4. **Modal renders** — agregar después de los modales existentes:
```tsx
{skillsOpenRef.current && <SkillPanel templateId={templateId} onClose={() => { skillsOpenRef.current = false; setSkillsKey(n => n + 1); }} onUpdate={() => callCanvas("pushHistory")} />}
{batchPanelOpenRef.current && <BatchPanel templateId={templateId} onClose={() => { batchPanelOpenRef.current = false; setBatchPanelKey(n => n + 1); }} />}
{qualityOpenRef.current && <QualityPanel templateId={templateId} onClose={() => { qualityOpenRef.current = false; setQualityKey(n => n + 1); }} onUpdate={() => callCanvas("pushHistory")} />}
{creativeOpenRef.current && <CreativePanel templateId={templateId} selectedObjects={selectedObjects} onClose={() => { creativeOpenRef.current = false; setCreativeKey(n => n + 1); }} onUpdate={() => callCanvas("pushHistory")} />}
```

**Tiempo estimado:** ~0.5h

---

## 📊 ESTIMADO TOTAL

| Commit | Panel | Tools expuestas | Tiempo |
|--------|-------|----------------|:------:|
| 1/5 | SkillPanel.tsx | skill_extract, skill_clone, skill_apply, brand_analyze, brand_apply | ~3h |
| 2/5 | BatchPanel.tsx | batch_design_from_csv | ~2.5h |
| 3/5 | QualityPanel.tsx | aesthetic_score, design_lint, auto_polish, suggest_color_palette | ~3.5h |
| 4/5 | CreativePanel.tsx | smart_layout, remix_template, design_diff, observe_session | ~4h |
| 5/5 | App.tsx | Integración de los 4 paneles | ~0.5h |
| **TOTAL** | **4 nuevos archivos + 1 modificado** | **14 tools** | **~13.5h** |

---

## 📐 ARQUITECTURA RESULTANTE (post-Sprint 5)

```
App.tsx
├── Toolbar.tsx
├── CanvasEditor.tsx
├── PropertiesPanel.tsx
├── LayersPanel.tsx
├── Dashboard.tsx
│
├── Overlay modals (toggle desde top-bar):
│   ├── KeyboardShortcuts.tsx
│   ├── BatchAMator.tsx          ← existente (batch renderer)
│   ├── ComponentsPanel.tsx      ← existente
│   ├── PrototypePanel.tsx       ← existente
│   ├── AIPanel.tsx              ← existente
│   ├── GhostPanel.tsx           ← existente (inline, no overlay)
│   ├── GovernancePanel.tsx      ← existente
│   ├── SkillPanel.tsx           ← NUEVO 🆕
│   ├── BatchPanel.tsx           ← NUEVO 🆕
│   ├── QualityPanel.tsx         ← NUEVO 🆕
│   └── CreativePanel.tsx        ← NUEVO 🆕
│
├── Top-bar buttons:
│   ← Home  ⌨ Shortcuts  ⚡ Batch  📦 Components  ▶ Prototype
│     🤖 AI Tools  🕐 Timeline
│     🧬 Skills  📦 Batch  ✨ Quality  🎨 Creative  ← NUEVOS 🆕
│
└── Comunicación: mcpCall + window.__canvasControls
```

---

## ⚠️ REGLAS

1. **CERO migraciones de DB** — Supabase no se toca. Todo va en metadata JSONB o in-memory stores
2. **CERO dependencias nuevas** — No `npm install` nada. Usar solo lo que ya está en `package.json`
3. **Commits atómicos** — 1 commit por panel (5 commits total)
4. **Usar `mcpCall` de `lib/mcpClient.ts`** — Import existente, no reimplementar
5. **NO romper `useAutoSave.ts`** — Los paneles no deben interferir con el autosave dual-write
6. **Tipos TypeScript** — `npx tsc --noEmit --skipLibCheck` debe pasar con 0 errores
7. **Estilo consistente** — Inline styles, dark theme, misma paleta que los paneles existentes
8. **NO tocar `netlify/functions/mcp.mjs`** — Las tools YA están implementadas, solo se crea UI

---

## 🔗 REFERENCIAS

- `QA/SPRINT-3-DELIVERY-REPORT.md` — specs de las 5 clone skill tools
- `QA/SPRINT-4-DELIVERY-REPORT.md` — specs de las 9 new tools
- `QA/GOAL-SPRINT-UI-GHOSTS-SKILLS.md` — goal original que definió los sprints
- `QA/FINAL-SPRINTS-2-3-4-REPORT.md` — estado actual post-sprints 2-4
- `netlify/functions/mcp.mjs` — implementaciones MCP (lines ~1650-1860 + ~5400-6800)
- `src/lib/mcpClient.ts` — helper JSON-RPC 2.0
- `src/components/GhostPanel.tsx` — patrón de referencia para paneles inline
- `src/components/AIPanel.tsx` — patrón de referencia para paneles overlay con tabs
- `src/App.tsx` — integración de paneles (ref-toggle pattern)

---

**Preparado por Lara** ✨ | Design Engineer, Futuraria
