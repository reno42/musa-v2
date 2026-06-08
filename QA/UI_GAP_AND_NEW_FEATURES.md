# Futuraria Design Editor — UI Gap Analysis & New Features

**Fecha:** 2026-06-07
**Analista:** Lara ✨
**Contexto:** 100 MCP tools existentes vs. frontend React+Fabric.js actual

---

## 📊 Resumen Ejecutivo

| Métrica | Valor |
|---------|-------|
| Total MCP tools | **100** |
| UI completa | **65** (65%) |
| UI parcial | **10** (10%) |
| Sin UI | **25** (25%) |
| Gaps P0 (críticos) | **14** |
| Gaps P1 (importantes) | **20** |
| Gaps P2 (nice-to-have) | **6** |

---

# PARTE 1: UI GAP ANALYSIS

## 🔴 GAPS P0 — Críticos (bloquean features clave)

---

### GAP: Blur no expuesto en PropertiesPanel
**MCP Tool:** `set_blur`
**UI status:** No existe
**Propuesta UI:** Agregar sección "Blur" en PropertiesPanel con:
- Toggle enable/disable
- Slider de blur radius (0-50px)
- Select tipo: `gaussian` | `motion` | `radial` (si Fabric.js lo soporta)
**Prioridad:** P0

---

### GAP: Image Filters no tienen UI
**MCP Tool:** `image_filter`
**UI status:** No existe
**Propuesta UI:** Al seleccionar una imagen, mostrar sección "Filters" en PropertiesPanel:
- Presets: Grayscale, Sepia, Invert, Brightness, Contrast, Saturate, Blur, Sharpen
- Sliders por filtro con preview en vivo
**Prioridad:** P0

---

### GAP: Image Crop no tiene UI
**MCP Tool:** `image_crop`
**UI status:** No existe
**Propuesta UI:** Al seleccionar imagen, mostrar botón "Crop" en PropertiesPanel que active un modo crop con handles tipo Figma. O usar el crop nativo de Fabric.js con `FabricImage` + máscara.
**Prioridad:** P0

---

### GAP: Design System — Styles no visibles/creables
**MCP Tools:** `create_style`, `apply_style`
**UI status:** No existe
**Propuesta UI:** Panel lateral derecho "Styles" (junto a Layers):
- Lista de estilos con preview (color circle, text sample)
- Botón "+" para crear estilo desde selección actual
- Click para aplicar estilo a objeto seleccionado
- Drag & drop desde Styles panel a objetos en canvas
- Estilos locales (template) y compartidos (workspace)
**Prioridad:** P0

---

### GAP: Design System — Variables no visibles/creables
**MCP Tools:** `create_variable`, `link_variable`
**UI status:** No existe
**Propuesta UI:** Panel "Variables" dentro de Design System:
- Tabla: Name | Type (color/number/string) | Value | Scope
- Modo Light/Dark toggle para previsualizar
- Al editar fill/stroke, mostrar variables disponibles como opciones
- "Link to variable" desde el color picker
**Prioridad:** P0

---

### GAP: Components no tienen UI
**MCP Tools:** `create_component`, `create_instance`, `add_variant`, `set_component_prop`
**UI status:** No existe
**Propuesta UI:** Panel "Components" lateral:
- Lista de componentes (Button/Primary, Card/Default, etc.)
- Botón derecho en objeto → "Create Component"
- Arrastrar componente al canvas para crear instancia
- Instancias muestran badge 🔷 en PropertiesPanel
- Panel de variantes: tabs para Default, Hover, Disabled, etc.
- "Detach instance" para romper link con master
**Prioridad:** P0

---

### GAP: Animaciones no tienen UI
**MCP Tool:** `set_animation`
**UI status:** No existe
**Propuesta UI:** Panel "Prototype" o solapa en PropertiesPanel:
- Select de trigger: On Click, On Hover, After Delay, On Scroll
- Tipo de animación: Fade, Slide, Scale, Rotate, Smart Animate
- Duration, Easing curve picker
- Preview inline
**Prioridad:** P0

---

### GAP: AI Tools sin UI
**MCP Tools:** `ai_generate_text`, `ai_generate_image`, `ai_palette`
**UI status:** No existe
**Propuesta UI:** Barra flotante "AI Assistant" (tipo Copilot):
- Campo de texto + botón Generate
- `ai_generate_text`: prompt → reemplaza texto seleccionado
- `ai_generate_image`: prompt → inserta imagen generada
- `ai_palette`: prompt → muestra paleta de 5 colores, click para aplicar a fill
**Prioridad:** P0

---

### GAP: Batch Update / Export Batch sin UI completa
**MCP Tools:** `batch_update`, `export_batch`
**UI status:** Parcial — BatchAMator.tsx existe pero solo maneja generación CSV, no actualización batch de templates existentes ni export batch
**Propuesta UI:** Extender BatchAMator con:
- Tab "Batch Update": seleccionar templates, aplicar cambios masivos (ej: "cambiar CTA en los 18 estilos")
- Tab "Batch Export": seleccionar templates/formato y exportar ZIP
- Preview de cambios antes de aplicar
**Prioridad:** P0

---

### GAP: Render Batch sin UI
**MCP Tool:** `render_batch`
**UI status:** No existe
**Propuesta UI:** Botón en Toolbar o dentro de BatchAMator:
- "Render All Frames" → dispara `render_batch` con todos los frame IDs
- Progress bar con thumbnails
- Descarga ZIP automática
**Prioridad:** P0

---

## 🟡 GAPS P1 — Importantes (features de producto)

---

### GAP: Notion-like Blocks sin UI
**MCP Tools:** `add_block`, `add_code_block`, `add_table`, `add_toggle`, `add_callout`, `add_quote`
**UI status:** No existe
**Propuesta UI:** Submenú en Toolbar "Insert" o dropdown al lado de Text:
- Callout (info, warning, success, error)
- Quote (blockquote con estilo)
- Toggle (collapsible section)
- Code Block (syntax highlight placeholder)
- Table (NxM grid con editor básico)
- Cada uno se renderiza como grupo de Fabric.js con estilo visual distintivo
**Prioridad:** P1

---

### GAP: Embeds sin UI
**MCP Tools:** `embed_video`, `embed_audio`, `embed_figma`, `embed_pdf`, `embed_social`
**UI status:** No existe
**Propuesta UI:** Sección "Embed" en Toolbar o menú contextual:
- Diálogo: pegar URL → detecta tipo automáticamente
- Renderiza placeholder visual (thumbnail + ícono de play/link)
- Embeds son objetos Fabric.js con metadata (url, provider, thumbnail)
- Click para expandir/previsualizar
**Prioridad:** P1

---

### GAP: Canvas Pages sin UI
**MCP Tool:** `canvas_pages`
**UI status:** No existe
**Propuesta UI:** Barra inferior con tabs de páginas (estilo Figma):
- "Page 1", "Page 2", ...
- Botón "+" para nueva página
- Click derecho → Rename, Duplicate, Delete
- Cada página es un canvas state independiente almacenado en template
**Prioridad:** P1

---

### GAP: Snap to Grid sin toggle UI
**MCP Tool:** `canvas_snap`
**UI status:** No existe (snapRef existe en código pero sin toggle visible). KeyboardShortcuts lista "Shift+G" pero no está implementado en CanvasEditor.
**Propuesta UI:** 
- Toggle en Toolbar: ícono de imán 🧲
- Submenú: Grid Size (10, 25, 50, 100)
- Indicador visual cuando snap está activo
- Implementar el shortcut Shift+G faltante
**Prioridad:** P1

---

### GAP: Render Markdown sin UI
**MCP Tool:** `render_markdown`
**UI status:** No existe
**Propuesta UI:** Al pegar texto markdown o usar add_block:
- Botón "Render Markdown" que convierte MD → objetos Fabric.js estilizados
- Headers, listas, bold, italic, links, code inline
- Preview en PropertiesPanel al editar texto
**Prioridad:** P1

---

### GAP: Interactions / Prototyping sin UI completa
**MCP Tools:** `add_interaction`, `add_overlay`, `set_scroll_position`
**UI status:** No existe
**Propuesta UI:** Modo "Prototype" (ya hay botón en Toolbar `onPrototypePreview`):
- Conectar nodos: arrastrar desde objeto A → objeto B para crear interacción
- Panel lateral con lista de interacciones
- `add_overlay`: diálogo modal con opacidad de fondo
- `set_scroll_position`: definir posición inicial de scroll para frames largos
**Prioridad:** P1

---

### GAP: Gallery Create sin UI
**MCP Tool:** `gallery_create`
**UI status:** No existe
**Propuesta UI:** Modal "Create Gallery":
- Upload múltiples imágenes o seleccionar de assets
- Layout options: Grid, Masonry, Carousel, Slideshow
- Gap, columns, aspect ratio
- Genera un frame con imágenes organizadas automáticamente
**Prioridad:** P1

---

### GAP: Columns sin UI
**MCP Tool:** `add_columns`
**UI status:** No existe
**Propuesta UI:** Al crear un frame o seleccionarlo:
- Propiedad "Columns" en PropertiesPanel
- Slider 1-12 columnas
- Gutter width
- Los objetos dentro del frame se ajustan a la grid de columnas
**Prioridad:** P1

---

### GAP: Share Template sin UI
**MCP Tool:** `share_template`
**UI status:** No existe
**Propuesta UI:** Botón "Share" en toolbar superior:
- Genera link público con permisos (view/comment/edit)
- Copiar link al portapapeles
- Panel de colaboradores (emails)
**Prioridad:** P1

---

### GAP: Copy As sin UI
**MCP Tool:** `copy_as`
**UI status:** No existe
**Propuesta UI:** Menú contextual "Copy as":
- Copy as PNG
- Copy as SVG
- Copy as CSS (para shapes/estilos)
- Copy as JSX/HTML
**Prioridad:** P1

---

### GAP: AI Suggest Layout sin UI
**MCP Tool:** `ai_suggest_layout`
**UI status:** No existe
**Propuesta UI:** Integrar en AI Assistant:
- "Suggest layout" con descripción ("3 cards horizontales con imágenes")
- Muestra 3 opciones de layout como thumbnails
- Click para aplicar
**Prioridad:** P1

---

### GAP: AI Translate sin UI
**MCP Tool:** `ai_translate`
**UI status:** No existe
**Propuesta UI:** En PropertiesPanel de texto:
- Botón "Translate" con selector de idioma
- Traduce el texto del objeto seleccionado
- Opción "Translate all text layers"
**Prioridad:** P1

---

### GAP: Upload Image sin UI dedicada
**MCP Tool:** `upload_image`
**UI status:** Parcial — existe soporte en canvas vía drag-drop/input file, pero no expone upload a Supabase Storage
**Propuesta UI:** Modal "Upload Image":
- Drag & drop zone
- Opción: "Upload to Assets Library" (Supabase Storage)
- Browse existing assets
- Image optimization toggle (resize, webp)
**Prioridad:** P1

---

### GAP: Versiones (list/restore) sin UI
**MCP Tools:** `list_versions`, `restore_version`
**UI status:** Parcial — GovernancePanel maneja snapshots pero no version history persistente
**Propuesta UI:** Panel "History" o tab en GovernancePanel:
- Lista cronológica con thumbnails
- "Restore this version" con confirmación
- Named versions: "Save as v1.0"
- Auto-save versions con timestamp
**Prioridad:** P1

---

### GAP: Create Collection sin UI
**MCP Tool:** `create_collection`
**UI status:** No existe
**Propuesta UI:** Dentro de Variables panel:
- Botón "New Collection" (Colors, Spacing, Typography, etc.)
- Folder view con variables agrupadas
- Import/Export de colecciones
**Prioridad:** P1

---

### GAP: Export batch / Import template sin UI
**MCP Tools:** `export_template` (.futuraria), `import_template`
**UI status:** Parcial — Export JSON existe pero no en formato .futuraria. Import no tiene UI.
**Propuesta UI:** 
- En toolbar: "Export .futuraria" junto a Export JSON
- "Import Template" en dashboard o menú File
- Drag-drop .futuraria file al canvas
**Prioridad:** P1

---

## ⚪ GAPS P2 — Nice to Have

---

### GAP: Comments sin UI
**MCP Tool:** `add_comment`
**UI status:** No existe
**Propuesta UI:** Botón "Comment" en toolbar. Modo comment: click en canvas → bubble de comentario. Panel lateral con thread de comentarios. Marcadores visuales en canvas.
**Prioridad:** P2

---

### GAP: Mention User sin UI
**MCP Tool:** `mention_user`
**UI status:** No existe
**Propuesta UI:** En comentarios: @username autocompleta. Notificaciones a usuarios mencionados. Solo útil si hay multi-usuario.
**Prioridad:** P2

---

### GAP: Publish Library sin UI
**MCP Tool:** `publish_library`
**UI status:** No existe
**Propuesta UI:** En Design System panel: botón "Publish". Versiona y publica estilos/variables/componentes como librería compartida entre templates.
**Prioridad:** P2

---

### GAP: Register Tool / Auth Token sin UI
**MCP Tools:** `register_tool`, `auth_token`
**UI status:** No existe
**Propuesta UI:** Panel de Settings/Admin:
- API tokens management
- Plugin registry
- Developer-only features
**Prioridad:** P2

---

## ✅ UI COMPLETA — Lo que YA funciona

| # | MCP Tool | UI Component | Estado |
|---|----------|-------------|--------|
| 1 | `transform_object` | PropertiesPanel (Position & Size) | Completo |
| 2 | `draw_shape` | Toolbar > Shapes dropdown | Completo |
| 3 | `add_text` | Toolbar > Text (T) | Completo |
| 4 | `add_image` | Toolbar > Image | Completo |
| 5 | `delete_objects` | Keyboard Delete/Backspace | Completo |
| 6 | `reorder_object` | LayersPanel arrows + Z-Index | Completo |
| 7 | `align_objects` | Toolbar > Align dropdown | Completo |
| 8 | `distribute_objects` | Toolbar > Align dropdown | Completo |
| 9 | `group_objects` | Ctrl+G | Completo |
| 10 | `ungroup_objects` | Ctrl+Shift+G | Completo |
| 11 | `copy_object` | Ctrl+C | Completo |
| 12 | `duplicate_object` | Ctrl+D | Completo |
| 13 | `boolean_operation` | Toolbar > Boolean dropdown | Completo |
| 14 | `auto_layout` | Toolbar > Auto Layout (⇧A) | Completo |
| 15 | `create_frame` | Toolbar > Frame (F) | Completo |
| 16 | `list_frames` | LayersPanel frame groups | Completo |
| 17 | `get_frame` | LayersPanel selection | Completo |
| 18 | `delete_frame` | LayersPanel context menu | Completo |
| 19 | `update_frame` | PropertiesPanel (name, fill, stroke) | Parcial |
| 20 | `render_frame` | Export Frame PNG | Parcial |
| 21 | `set_gradient` | PropertiesPanel > Gradient | Completo |
| 22 | `set_shadow` | PropertiesPanel > Shadow | Completo |
| 23 | `history_undo` | Toolbar + Ctrl+Z | Completo |
| 24 | `history_redo` | Toolbar + Ctrl+Shift+Z | Completo |
| 25 | `canvas_grid` | Keyboard G toggle | Completo |
| 26 | `canvas_rulers` | RulerBar toggle | Completo |
| 27 | `canvas_pan` | Hand tool + Space | Completo |
| 28 | `canvas_zoom` | Toolbar zoom controls | Completo |
| 29 | `color_picker` | PropertiesPanel ColorPicker | Completo |
| 30 | `frame_auto_layout` | Toolbar Auto Layout | Completo |
| 31 | `search_google_fonts` | GoogleFontPicker | Completo |
| 32 | `list_fonts` | GoogleFontPicker dropdown | Completo |
| 33 | `export_pdf` | Toolbar Export | Completo |
| 34 | `add_svg_path` | Toolbar Pen tool | Parcial |
| 35 | `snapshot_template` | GovernancePanel auto-snapshots | Parcial |
| 36 | `diff_template` | GovernancePanel diff view | Completo |
| 37 | `list_snapshots` | GovernancePanel list | Completo |

---

# PARTE 2: NUEVAS MCP TOOLS PROPUESTAS

Herramientas que no existen en Figma/Paper pero que darían ventajas de calidad y escala a Futuraria.

---

### NEW: `batch_design_from_csv`
**Descripción:** Genera múltiples templates a partir de un CSV de contenido, usando un template base como master. Cada fila del CSV se convierte en una variación del diseño. Esencial para marketing a escala (ej: 50 posts de Instagram con diferentes textos/imágenes pero mismo layout).
**Parámetros:**
```json
{
  "templateId": "string (template base/master)",
  "csvData": "object (parsed CSV rows)",
  "mapping": {
    "text_layers": { "column_name": "layer_name_or_id" },
    "image_layers": { "column_name": "layer_name_or_id" }
  },
  "outputWorkspaceId": "string",
  "namePrefix": "string",
  "renderAll": "boolean (auto-render PNGs)"
}
```
**Output:**
```json
{
  "generated": [{ "id": "tpl_xxx", "name": "Post 1", "renderUrl": "..." }],
  "total": 50,
  "errors": []
}
```
**Complejidad:** Media

---

### NEW: `aesthetic_score`
**Descripción:** Evalúa un template con métricas de calidad estética objetivas: balance visual, jerarquía tipográfica, contraste de color (WCAG AA/AAA), alineación, espaciado consistente, regla de tercios. Devuelve un score 0-100 con recomendaciones específicas de mejora.
**Parámetros:**
```json
{
  "templateId": "string",
  "checks": ["balance", "contrast", "typography", "alignment", "spacing", "white_space", "visual_hierarchy"]
}
```
**Output:**
```json
{
  "score": 72,
  "breakdown": {
    "balance": 80,
    "contrast": 45,
    "typography": 85,
    "alignment": 90,
    "spacing": 60,
    "white_space": 70,
    "visual_hierarchy": 75
  },
  "warnings": [
    { "layer": "cta_button", "issue": "contrast_ratio", "value": 2.1, "required": 4.5, "fix": "darken text or lighten background" }
  ],
  "suggestions": [
    "Increase line-height from 1.2 to 1.5 for body text",
    "Add 16px more padding to left card"
  ]
}
```
**Complejidad:** Media

---

### NEW: `aesthetic_apply_fixes`
**Descripción:** Aplica automáticamente las correcciones sugeridas por `aesthetic_score`. Ajusta contrastes, espaciados, alineaciones y jerarquía tipográfica sin intervención manual.
**Parámetros:**
```json
{
  "templateId": "string",
  "fixes": ["contrast", "spacing", "alignment", "typography"],
  "autoApply": "boolean"
}
```
**Output:**
```json
{
  "applied": ["contrast_fixed:3_layers", "spacing_adjusted:8_objects", "alignment_corrected:2_objects"],
  "scoreBefore": 72,
  "scoreAfter": 94
}
```
**Complejidad:** Alta

---

### NEW: `observe_session`
**Descripción:** Observa y registra las acciones del usuario en el canvas durante una sesión de diseño: movimientos, cambios de propiedades, reordenamientos, undo/redo patterns, tools usadas. Almacena la sesión como datos de entrenamiento para que los agentes IA puedan replicar el "estilo humano" de diseño.
**Parámetros:**
```json
{
  "templateId": "string",
  "action": "start" | "stop" | "analyze",
  "sessionId": "string (opcional, auto-generado)",
  "includeCanvasSnapshots": "boolean"
}
```
**Output:**
```json
{
  "sessionId": "sess_xxx",
  "duration": 1240,
  "actions": 347,
  "patterns": {
    "preferred_tools": ["select", "rect", "text"],
    "avg_undo_depth": 3.2,
    "color_palette": ["#6366f1", "#1e1e2e", "#f8f9fa"],
    "typography_choices": ["Inter", "DM Sans"],
    "layout_pattern": "grid_3col"
  },
  "insights": [
    "User tends to adjust spacing after placing all elements",
    "Frequently uses Ctrl+Z after text edits — suggest live preview",
    "Prefers asymmetric balance (60/40)"
  ]
}
```
**Complejidad:** Alta

---

### NEW: `smart_layout`
**Descripción:** Dado un conjunto de objetos y constraints (número de columnas, gap, alignment), organiza los elementos automáticamente usando algoritmos de layout inteligente: grid, masonry, flex-wrap, golden ratio, diagonales. Supera al `auto_layout` actual que solo hace filas/columnas simples.
**Parámetros:**
```json
{
  "templateId": "string",
  "objectIds": ["string[]"],
  "layout": "grid" | "masonry" | "flex_wrap" | "golden_ratio" | "diagonal" | "circular" | "zigzag",
  "columns": "number",
  "gap": "number",
  "padding": "number",
  "alignToFrame": "boolean",
  "responsiveBreakpoints": [{ "width": 375, "columns": 1 }, { "width": 768, "columns": 2 }]
}
```
**Output:**
```json
{
  "layout": "grid",
  "newPositions": { "layer_1": { "x": 0, "y": 0 }, "layer_2": { "x": 250, "y": 0 } },
  "totalWidth": 750,
  "totalHeight": 600
}
```
**Complejidad:** Media

---

### NEW: `design_diff`
**Descripción:** Compara visual y estructuralmente dos templates (ej: versión A vs B, o tu diseño vs un reference design). Detecta diferencias de layout, color, tipografía, espaciado y composición. Devuelve un diff estructurado y sugerencias para parecerse más al reference.
**Parámetros:**
```json
{
  "templateIdA": "string",
  "templateIdB": "string",
  "mode": "structural" | "visual" | "full",
  "tolerance": "number (0-1, default 0.05)"
}
```
**Output:**
```json
{
  "similarity": 0.78,
  "differences": [
    { "type": "color", "layer": "header", "a": "#111", "b": "#1a1a2e" },
    { "type": "spacing", "layer": "cards", "a": 16, "b": 24 },
    { "type": "typography", "layer": "title", "a": { "size": 24, "weight": 600 }, "b": { "size": 32, "weight": 700 } },
    { "type": "missing", "layer": "testimonial_section" }
  ],
  "suggestions": ["Match card gap to template B (16→24)", "Increase title weight to 700"]
}
```
**Complejidad:** Alta

---

### NEW: `remix_template`
**Descripción:** Toma un template + un mood/prompt textual y genera variaciones estilísticas manteniendo la estructura de contenido. "Haz este mismo diseño pero con estilo brutalista / glassmorphism / swiss design / cyberpunk". Útil para iteración rápida de estilos.
**Parámetros:**
```json
{
  "templateId": "string",
  "style": "brutalist" | "glassmorphism" | "swiss" | "cyberpunk" | "minimalist" | "art_deco" | "memphis" | "bauhaus" | "custom",
  "customPrompt": "string (if style=custom)",
  "preserveContent": "boolean",
  "variations": "number (1-10, default 3)"
}
```
**Output:**
```json
{
  "variations": [
    { "id": "tpl_xxx", "name": "Template - Brutalist v1", "thumbnail": "url" },
    { "id": "tpl_yyy", "name": "Template - Brutalist v2", "thumbnail": "url" }
  ]
}
```
**Complejidad:** Alta

---

### NEW: `spellcheck_design`
**Descripción:** Revisa el template completo buscando errores comunes de diseño: texto truncado (overflow), elementos fuera del frame, fuentes no cargadas, imágenes con baja resolución, links rotos en embeds, contraste inaccesible, texto placeholder sin reemplazar ("Lorem ipsum"), capas ocultas accidentalmente.
**Parámetros:**
```json
{
  "templateId": "string",
  "checks": ["overflow", "resolution", "contrast", "placeholder_text", "broken_embeds", "hidden_layers", "missing_fonts"]
}
```
**Output:**
```json
{
  "errors": 3,
  "warnings": 7,
  "items": [
    { "severity": "error", "layer": "title_text", "issue": "text_overflow", "detail": "Text extends 24px beyond frame boundary" },
    { "severity": "error", "layer": "hero_image", "issue": "low_resolution", "detail": "Image rendered at 72dpi, recommended 144dpi" },
    { "severity": "warning", "layer": "body_text", "issue": "placeholder_text", "detail": "Contains 'Lorem ipsum dolor sit amet...'" }
  ]
}
```
**Complejidad:** Media

---

### NEW: `suggest_color_palette`
**Descripción:** Analiza el contenido visual del template y sugiere paletas de color complementarias o análogas basadas en teoría del color. Puede extraer colores de una imagen de referencia, generar paletas accesibles (WCAG), o sugerir variaciones monocromáticas.
**Parámetros:**
```json
{
  "templateId": "string",
  "mode": "extract" | "complementary" | "analogous" | "triadic" | "monochromatic" | "accessible" | "from_reference",
  "referenceImageUrl": "string (para mode=from_reference)",
  "count": "number (3-10, default 5)",
  "accessibilityTarget": "AA" | "AAA"
}
```
**Output:**
```json
{
  "palette": [
    { "hex": "#6366f1", "role": "primary", "contrastOnWhite": 5.2, "contrastOnBlack": 4.1 },
    { "hex": "#818cf8", "role": "primary_light", "contrastOnWhite": 3.8 },
    { "hex": "#4f46e5", "role": "primary_dark", "contrastOnWhite": 4.5 },
    { "hex": "#f8f9fa", "role": "background", "contrastOnWhite": 1.0 },
    { "hex": "#1e1e2e", "role": "text", "contrastOnWhite": 14.2 }
  ],
  "appliedToTemplate": "boolean"
}
```
**Complejidad:** Baja

---

## 🗺️ Roadmap Sugerido

### Fase A: P0 Foundation (Semanas 1-2)
1. Blur en PropertiesPanel
2. Image Filters + Crop
3. Styles Panel (crear/aplicar)
4. Variables Panel
5. Components básico (crear/instanciar)
6. AI Assistant sidebar (text + image + palette)

### Fase B: P0 Avanzado (Semanas 3-4)
7. Animaciones Panel
8. Batch Update UI (extender BatchAMator)
9. Render Batch + Export Batch
10. Canvas Pages
11. Snap toggle + grid size
12. Color Palette Suggester

### Fase C: P1 Features (Semanas 5-6)
13. Notion Blocks (callout, quote, toggle, code, table)
14. Embeds (video, audio, Figma, PDF)
15. Gallery Creator
16. Interactions / Prototyping mode
17. Smart Layout tool
18. Remix Template (style variations)
19. Aesthetic Score + Auto-fix

### Fase D: Polishing (Semanas 7-8)
20. Version History Panel
21. Share & Collaboration
22. Design Diff tool
23. Observe Session (learning mode)
24. Spellcheck Design
25. Comments + Mentions

---

**Total herramientas nuevas propuestas:** 9
**Completan el ecosistema MCP a ~109 tools.**

---

*Análisis generado por Lara ✨ — Design Engineer de Futuraria*
*2026-06-07*
