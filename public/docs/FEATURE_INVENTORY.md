# Futuraria — Feature Inventory

> **Date**: 2026-06-26 (updated after legacy cleanup)
> **MCP Tools**: ~95 active tool definitions with live handlers
> **Build**: tsc 0 errors · vite clean

## Columns

| Column | Meaning |
|---|---|
| **Feature** | Name of the functionality |
| **What it does** | Brief description |
| **MCP** | ✅ = AI agent can use it via MCP tool · ❌ = no MCP tool |
| **UI** | ✅ = human can use it via EditorV2/Dashboard UI · ❌ = no UI button/panel |
| **Status** | **Current** = active in EditorV2 pipeline · **MCP-only** = designed to be AI-only |

---

## 1. Workspace Management

| Feature | What it does | MCP | UI | Status |
|---|---|---|---|---|
| List workspaces | Get all workspaces | ✅ `list_workspaces` | ✅ Dashboard dropdown | Current |
| Create workspace | Create new workspace | ✅ `create_workspace` | ✅ Dashboard "+ Workspace" | Current |
| Rename workspace | Rename via upsert | ✅ `create_workspace` | ✅ Dashboard double-click dropdown option | Current |

## 2. Template Management

| Feature | What it does | MCP | UI | Status |
|---|---|---|---|---|
| List templates | List all, filter by workspace/search | ✅ `list_templates` | ✅ Dashboard grid | Current |
| Get template | Fetch single template with frames | ✅ `get_template` | ✅ Auto-loads on open | Current |
| Create template | Create blank HTML template | ✅ `create_html_template` | ✅ Dashboard "+ HTML" | Current |
| Update template | Update name, dimensions, content | ✅ `update_template` | ✅ EditorV2 auto-save | Current |
| Delete template | Delete a template | ✅ `delete_template` | ✅ Dashboard trash icon | Current |
| Duplicate template | Clone a template | ✅ `duplicate_template` | ✅ Dashboard duplicate button | Current |
| Export template (JSON) | Download as .futuraria.json | ✅ `export_template` | ✅ Export menu → "Export as JSON" | Current |
| Import template (JSON) | Upload .futuraria.json | ✅ `import_template` | ✅ Topbar upload button | Current |

## 3. Frames (Canvases inside a Template)

| Feature | What it does | MCP | UI | Status |
|---|---|---|---|---|
| Create frame | Add a new frame with preset sizes | ✅ `create_html_frame` | ✅ FloatingToolbar "+ Frame" dropdown | Current |
| Update frame | Change frame name, width, height | ✅ `update_html_frame` | ✅ Topbar double-click inline rename | Current |
| Delete frame | Remove frame from template | ✅ `delete_html_frame` | ✅ Topbar trash button | Current |
| Duplicate frame | Clone a frame | ✅ `duplicate_frame` | ✅ Topbar copy button (Ctrl+D) | Current |
| Get all frames | List frames in a template | ✅ `get_html_frames` | ✅ Internal auto-render | Current |
| Update frame content | Set HTML/CSS of a frame | ✅ `update_frame_content` | ✅ CodePanel HTML/CSS editor | Current |
| Get frame changes | Diff frame content (with sourceHash) | ✅ `get_frame_changes` | ❌ MCP-only | MCP-only |

## 4. Elements (HTML nodes inside frames)

| Feature | What it does | MCP | UI | Status |
|---|---|---|---|---|
| Add element | Add div/h1/p/button/img/span | ✅ `add_element` | ✅ InsertToolbar (toggleable via topbar "+") | Current |
| Add primitive | Click-to-place rect/circle/text | ✅ `add_primitive` | ✅ FloatingToolbar click-to-place | Current |
| Remove element | Delete element by layer-id | ✅ `remove_element` | ✅ Layers panel trash icon | Current |
| Duplicate element | Clone element in frame | ❌ (client-side) | ✅ Layers panel duplicate button | Current |
| Update element | Change attributes/styles | ✅ `update_element` | ✅ HtmlContextualPanel | Current |
| Transform element | Move, resize, rotate | ✅ `transform_element` | ✅ Canvas drag + ContextualPanel | Current |
| Reorder element | Change z-index / DOM order | ✅ `reorder_element` | ✅ Element ops bar ↑↓⤒⤓ buttons | Current |
| Group elements | Wrap elements in a container | ✅ `group_elements` | ✅ Element ops bar "Group" button | Current |
| Align elements | Align left/center/right | ✅ `align_elements` | ✅ Element ops bar align buttons | Current |
| Change element tag | Convert `<div>` → `<section>` etc. | ✅ `change_element_tag` | ✅ ContextualPanel tag dropdown | Current |
| Set HTML (raw) | Replace entire frame HTML | ✅ `set_html` | ✅ CodePanel HTML editor | Current |
| Set CSS (raw) | Replace entire frame CSS | ✅ `set_css` | ✅ CodePanel CSS editor | Current |
| Select element | Programmatic selection | ✅ `select_element` | ✅ Canvas click + Layers click | Current |
| Copy element as | Copy as HTML/CSS/JSON to clipboard | ✅ `copy_as` | ✅ Element ops bar HTML/CSS/JSON buttons | Current |

## 5. Drawing & Vector Shapes

| Feature | What it does | MCP | UI | Status |
|---|---|---|---|---|
| Draw shape | Draw rect/circle/triangle/star/polygon as SVG `<path>` | ✅ `draw_shape` | ✅ FloatingToolbar R/O/G/S/N + drag | Current |
| Draw freehand path | Draw SVG path with pen tool | ✅ `draw_path` | ✅ FloatingToolbar Pen (P) | Current |
| Draw bezier curve | Draw curved path | ✅ `draw_bezier` | ✅ Pen tool auto-curve on toggle | Current |
| Shape → path | Convert CSS shape to editable SVG path | ✅ `shape_to_path` | ❌ MCP-only | MCP-only |
| Edit path points | Insert/delete/move/toggle path points | ✅ `edit_path_point` / `edit_path_points` | ❌ No vertex drag UI | MCP-only |
| Pathfinder (boolean) | Union/subtract/intersect/exclude two paths | ✅ `pathfinder` | ✅ FloatingToolbar pathfinder dropdown | Current |
| Multi-select elements | Ctrl+click to select multiple | N/A internal | ✅ Layers panel ctrl+click | Current |

## 6. SVG Import

| Feature | What it does | MCP | UI | Status |
|---|---|---|---|---|
| Import SVG | Parse SVG → HTML frame with positioned elements | ✅ `import_svg` | ✅ SvgImportDialog (Upload + Paste tabs, live preview) | Current |

## 7. Typography & Fonts

| Feature | What it does | MCP | UI | Status |
|---|---|---|---|---|
| List Google Fonts | Browse 1500+ Google Fonts | ✅ `list_fonts` | ✅ GoogleFontPicker dropdown | Current |
| Search Google Fonts | Search by name/filter | ✅ `search_google_fonts` | ✅ GoogleFontPicker search | Current |
| Preview font | Render text sample in a font | ✅ `preview_font` | ✅ GoogleFontPicker preview | Current |
| Get font details | Get font metadata, weights, subsets | ✅ `get_font_details` | ❌ Auto-used internally | MCP-only |
| Add font to template | Inject `@import` for a Google Font | ✅ `add_font_to_template` | ✅ GoogleFontPicker select | Current |

## 8. Design System & Tokens

| Feature | What it does | MCP | UI | Status |
|---|---|---|---|---|
| Generate design artifacts | Produce DESIGN.md, tokens.json, shared.css | ✅ `generate_design_artifacts` | ✅ Topbar "DS" download button | Current |
| Get design artifacts | Retrieve artifacts (with staleness check) | ✅ `get_design_artifacts` | ❌ MCP-only | MCP-only |
| Export design tokens | Export CSS variables as JSON tokens | ✅ `export_design_tokens` | ✅ Topbar "Dna X" button | Current |
| Get CSS variables | List all `--var` custom properties | ✅ `get_css_variables` | ✅ VariablesPanel | Current |
| Set CSS variable | Create/update a CSS variable | ✅ `set_css_variable` | ✅ VariablesPanel inline edit | Current |
| Create variable | Alias for set_css_variable | ✅ `create_variable` | ✅ VariablesPanel | Current |
| Link variable | Bind element property to a variable | ✅ `link_variable` | ❌ MCP-only | MCP-only |
| Extract variables | Auto-extract colors/fonts as variables | ✅ `extract_variables` | ✅ Topbar refresh + VariablesPanel "Extract" | Current |
| Apply variables | Replace hardcoded values with var() refs | ✅ `apply_variables` | ✅ Topbar link + VariablesPanel "Apply" | Current |
| Get design system | Full design system report | ✅ `get_design_system` | ❌ MCP-only | MCP-only |
| Verify design system | Check system consistency | ✅ `verify_design_system` | ❌ MCP-only | MCP-only |
| Lint design | Check design for issues | ✅ `lint_design` | ✅ Topbar wand button | Current |
| Enhance template | AI-suggested improvements | ✅ `enhance_template` | ✅ Topbar sparkle button | Current |
| Generate UI components | Create buttons/cards/navbars | ✅ `generate_ui_components` | ❌ MCP-only | MCP-only |
| Smart layout toggle | Switch between smart/fixed layout | ✅ `smart_layout` | ✅ Element ops bar Smart/Fixed toggle | Current |

## 9. Brand System

| Feature | What it does | MCP | UI | Status |
|---|---|---|---|---|
| Save brand | Extract colors/fonts from CSS, save as recipe | ✅ `register_brand` | ✅ BrandPanel "💾 Save as Brand" | Current |
| List brands | Get all saved brands | ✅ `get_brands` | ✅ BrandPanel "📂 Load Brands" | Current |
| Apply brand | Inject `--color-brand-N` / `--font-brand-N` CSS vars | ✅ `apply_brand` | ✅ BrandPanel "🎨 Apply" per brand | Current |
| Validate brand | Check template against brand rules | ✅ `validate_brand` | ✅ BrandPanel "Validate Brand" | Current |
| Check contrast | WCAG contrast ratios | ✅ `check_contrast` | ✅ BrandPanel "Check Contrast" | Current |
| Check accessibility | WCAG compliance score | ✅ `check_accessibility` | ✅ BrandPanel "Check Accessibility" | Current |
| Auto-fix brand | Auto-correct violations | ✅ `auto_fix_brand` | ✅ BrandPanel "🔧 Auto-Fix Brand" | Current |
| Generate brand manual | Produce brand guideline .md document | ✅ `generate_brand_manual` | ✅ BrandPanel "📖 Brand Manual" | Current |
| Suggest color palette | Generate palette (complementary, triadic, etc.) | ✅ `suggest_color_palette` | ✅ BrandPanel "🎨 Suggest Palette" | Current |

## 10. Layout & Structure

| Feature | What it does | MCP | UI | Status |
|---|---|---|---|---|
| Detect structure | Identify hero/headline/body/cta regions | ✅ `detect_structure` | ❌ MCP-only | MCP-only |
| Analyze template structure | Get DOM tree structure | ✅ `analyze_template_structure` | ✅ StructurePanel "Analyze" | Current |
| Get template structure | Get element-level structure | ✅ `get_template_structure` | ✅ StructurePanel list | Current |
| Smart layout (grid/masonry) | Auto-arrange elements | ✅ `smart_layout` | ✅ Element ops bar Smart/Fixed toggle | Current |
| Color picker | Pick color from canvas | ✅ `color_picker` | ✅ ContextualPanel color inputs | Current |

## 11. Format Adaptation

| Feature | What it does | MCP | UI | Status |
|---|---|---|---|---|
| Adapt format | Resize template to new dimensions | ✅ `adapt_format` | ✅ FormatPanel format buttons | Current |
| Adapt all formats | Batch resize to multiple formats | ✅ `adapt_all_formats` | ✅ FormatPanel (all buttons) | Current |
| Compare adaptations | Side-by-side comparison | ✅ `compare_adaptations` | ❌ MCP-only | MCP-only |

## 12. Rendering & Export

| Feature | What it does | MCP | UI | Status |
|---|---|---|---|---|
| Render HTML template | Produce downloadable HTML/PNG | ✅ `render_html_template` | ❌ MCP-only | MCP-only |
| Render to formats | Render to PNG/Jpg/WebP | ✅ `render_to_formats` | ❌ MCP-only | MCP-only |
| Export frame (PNG/JPG) | Client-side canvas capture | N/A (client-side) | ✅ Export menu → PNG/JPG | Current |
| Export frame (SVG) | Client-side SVG export | N/A (client-side) | ✅ Export menu → SVG | Current |
| Export frame (PDF) | Client-side jsPDF export | N/A (client-side) | ✅ Export menu → PDF | Current |
| Export all frames (PNG/JPG/SVG/PDF) | Batch client-side export | N/A (client-side) | ✅ Export menu → "All Frames" | Current |
| Export JSON | Download template as JSON | ✅ `export_template` | ✅ Export menu → "Export as JSON" | Current |
| Export design tokens | Download tokens.json | ✅ `export_design_tokens` | ✅ Topbar "Dna X" button | Current |
| Render batch | Render multiple templates | ✅ `render_batch` | ❌ MCP-only | MCP-only |
| Background render worker | Auto-process pending render jobs | ✅ `batch_render_html` | ✅ Internal auto-poll | Current |
| Optimize image | Compress image (stub) | ✅ `optimize_image` | ❌ Stub | MCP-only |

## 13. Assets & Images

| Feature | What it does | MCP | UI | Status |
|---|---|---|---|---|
| Upload image | Upload image, get URL | ✅ `upload_image` | ✅ ImageUploadModal | Current |
| List assets | Browse uploaded assets | ✅ `list_assets` | ✅ ImageUploadModal gallery | Current |
| Delete asset | Remove uploaded image | ✅ `delete_asset` | ❌ MCP-only | MCP-only |
| Replace asset | Swap image URL | ✅ `replace_asset` | ❌ MCP-only | MCP-only |
| Search stock image | Search Unsplash/Pexels | ✅ `search_stock_image` | ❌ Not implemented | MCP-only |

## 14. Versioning & History

| Feature | What it does | MCP | UI | Status |
|---|---|---|---|---|
| List versions | Get template version history | ✅ `list_versions` | ✅ Right panel → History tab | Current |
| Restore version | Roll back to a version | ✅ `restore_version` | ✅ History panel "Restore" button | Current |

## 15. Recipes & Automation

| Feature | What it does | MCP | UI | Status |
|---|---|---|---|---|
| Save recipe | Save template config as reusable recipe | ✅ `save_recipe` | ✅ Topbar tag button | Current |
| List recipes | Browse saved recipes | ✅ `list_recipes` | ✅ Dashboard "Recipes" tab | Current |
| Get recipe | Fetch single recipe | ✅ `get_recipe` | ✅ Internal | Current |
| Create from recipe | Execute recipe → new template | ✅ `create_from_recipe` | ✅ Dashboard recipe "Use" button | Current |
| Generate CSV template | Create data-driven template | ✅ `generate_csv_template` | ❌ MCP-only | MCP-only |
| Apply CSV to frames | Bind CSV data to frames | ✅ `apply_csv_to_frames` | ❌ MCP-only | MCP-only |

## 16. AI Generation

| Feature | What it does | MCP | UI | Status |
|---|---|---|---|---|
| Generate from prompt | Create template from text description | ✅ `generate_from_prompt` | ❌ MCP-only | MCP-only |
| AI generate text | Generate copy/headlines | ✅ `ai_generate_text` | ❌ MCP-only | MCP-only |
| AI generate image | Generate/edit image via Nano Banana | ✅ `ai_generate_image` | ✅ Editor 🍌 button | Nano Banana (Gemini) |
| AI palette | Suggest color palette via AI | ✅ `ai_palette` | ❌ MCP-only | MCP-only |
| AI suggest layout | Suggest layout improvements | ✅ `ai_suggest_layout` | ❌ MCP-only | MCP-only |
| AI translate | Translate text in template | ✅ `ai_translate` | ❌ MCP-only | MCP-only |

## 17. Collaboration (Active subset)

| Feature | What it does | MCP | UI | Status |
|---|---|---|---|---|
| Active agents | See who's editing | ✅ `get_active_agents` | ✅ ActiveAgentsPanel | Current |
| Realtime subscribe | Listen for live changes | ✅ `subscribe_template` | ✅ Internal auto | Current |
| Unsubscribe | Stop listening | ✅ `unsubscribe_template` | ✅ Internal auto | Current |
| Broadcast section change | Push change via Realtime | ✅ `broadcast_section_change` | ✅ Internal auto | Current |
| Observe session | Observe an editing session | ✅ `observe_session` | ❌ MCP-only | MCP-only |
| Assemble template | Assemble template from parts | ✅ `assemble_template` | ❌ MCP-only | MCP-only |
| Profile template pool | Analyze template pool diversity | ✅ `profile_template_pool` | ❌ MCP-only | MCP-only |

## 18. Internal / Infrastructure Tools

| Feature | What it does | MCP | UI | Status |
|---|---|---|---|---|
| Auth token | Manage auth tokens | ✅ `auth_token` | ❌ | MCP-only |
| Register tool | Register a custom tool | ✅ `register_tool` | ❌ | MCP-only |
| Skill clone | Clone a skill | ✅ `skill_clone` | ❌ | MCP-only |

## 19. Editor Canvas Controls

| Feature | What it does | MCP | UI | Status |
|---|---|---|---|---|
| Undo / Redo | History navigation | N/A (client-side) | ✅ FloatingToolbar buttons + Ctrl+Z | Current |
| Zoom in/out/fit | Canvas zoom controls | N/A (client-side) | ✅ FloatingToolbar zoom controls | Current |
| Pan canvas | Drag to pan | N/A (client-side) | ✅ Hand tool (H) + middle-click | Current |
| Code panel | Direct HTML/CSS editing | N/A (client-side) | ✅ CodePanel (Ctrl+/) | Current |
| Layers panel | Element tree, select/delete/duplicate | N/A (client-side) | ✅ HtmlLayersPanel | Current |
| Contextual panel | Style properties of selected element | N/A (client-side) | ✅ HtmlContextualPanel | Current |
| Font picker | Browse and apply Google Fonts | N/A (client-side) | ✅ GoogleFontPicker dropdown | Current |
| Keyboard shortcuts | V/H/R/O/T/P/Ctrl+Z/Ctrl+D/Del | N/A (client-side) | ✅ Global hotkeys | Current |
| Frame auto-save | Debounced persistence to Supabase | N/A (client-side) | ✅ Auto-save indicator | Current |

---

## Summary Statistics

| Category | Count |
|---|---|
| **Total MCP tools (active)** | ~95 |
| **Total features with UI** | ~70 |
| **MCP-only (by design)** | ~25 |
| **Deleted legacy tools** | 34 |
| **Deleted orphaned UI components** | 8 |

### Legend
- **Current** — Active and usable in EditorV2 right now
- **MCP-only** — Intentionally AI-only; no human UI needed (backend operations, code generation, etc.)

### Deleted in this cleanup (2026-06-26)
34 placebo/dead MCP tools + 8 orphaned UI component files removed:
- **Components & Styles** (5): create_component, create_instance, create_style, apply_style, create_collection
- **Batch & Variants** (8): batch_update, batch_create_variants, batch_from_recipe, batch_export, batch_status, batch_cancel, create_variant, add_variant
- **Teams & Collaboration** (14): create_team, list_teams, get_team, list_team_members, remove_team_member, update_team_member_role, invite_to_team, share_workspace_with_team, share_template, claim_section, release_section, list_sections, add_comment, mention_user
- **Prototyping** (4): add_interaction, set_animation, add_overlay, set_scroll_position
- **Publishing** (3): publish_library, publish_batch, publish_status
- **Orphaned UI files** (8): ComponentsPanel, PrototypePanel, BatchPanel, GovernancePanel, SkillPanel, CreativePanel, AIPanel, QualityPanel



🔬 Auditoría Completa: Feature Set Actual vs Adobe Illustrator

Audité TODO el código post-implementación. Aquí el inventario real:

────────────────────────────────────────────────────────────────────────────────

### ✅ IMPLEMENTADO (funcional)

┌─────────────────────────────────────┬────┬─────┬───────────────────────────────────────────────┐
│ Feature                             │ UI │ MCP │ Notas                                         │
├─────────────────────────────────────┼────┼─────┼───────────────────────────────────────────────┤
│ Shapes → SVG <path>                 │ ✅ │ ✅  │ Incluye shape_to_path MCP tool                │
│ (triangle/star/polygon)             │    │     │                                               │
├─────────────────────────────────────┼────┼─────┼───────────────────────────────────────────────┤
│ Pen tool                            │ ✅ │ ✅  │ Click-to-place, Enter finaliza, cierra paths  │
│                                     │    │     │ con Z                                         │
├─────────────────────────────────────┼────┼─────┼───────────────────────────────────────────────┤
│ pathData.ts parser/serializer       │ ✅ │ —   │ Parsea M, L, C, S, Q, T, A, Z + variantes     │
│                                     │    │     │ relativas                                     │
├─────────────────────────────────────┼────┼─────┼───────────────────────────────────────────────┤
│ Pathfinder                          │ ✅ │ ✅  │ Botones en FloatingToolbar, multi-select (2   │
│ (Union/Subtract/Intersect/Exclude)  │    │     │ elementos)                                    │
├─────────────────────────────────────┼────┼─────┼───────────────────────────────────────────────┤
│ SVG Import dialog                   │ ✅ │ ✅  │ Upload file + Paste code, preview, nombre     │
│                                     │    │     │ editable                                      │
├─────────────────────────────────────┼────┼─────┼───────────────────────────────────────────────┤
│ Frame rename                        │ ✅ │ ✅  │ Double-click → inline edit → Enter            │
├─────────────────────────────────────┼────┼─────┼───────────────────────────────────────────────┤
│ Template rename                     │ ✅ │ ✅  │ Dashboard double-click + botón Rename         │
├─────────────────────────────────────┼────┼─────┼───────────────────────────────────────────────┤
│ Workspace rename                    │ ❌ │ —   │ Sigue pendiente                               │
├─────────────────────────────────────┼────┼─────┼───────────────────────────────────────────────┤
│ Auto-thumbnails                     │ ✅ │ —   │ iframe a 0.15x con HTML/CSS real, live        │
│                                     │    │     │ preview                                       │
├─────────────────────────────────────┼────┼─────┼───────────────────────────────────────────────┤
│ Brand Panel                         │ ✅ │ ✅  │ Save/Load/Apply Brand, Brand Manual download, │
│                                     │    │     │ contrast/a11y checks, auto-fix, palette       │
│                                     │    │     │ suggest                                       │
├─────────────────────────────────────┼────┼─────┼───────────────────────────────────────────────┤
│ MCP get_brands / apply_brand /      │ —  │ ✅  │ get_brands y register_brand usan tabla        │
│ register_brand                      │    │     │ recipes (no brands)                           │
├─────────────────────────────────────┼────┼─────┼───────────────────────────────────────────────┤
│ UI Generator MCP                    │ —  │ ✅  │ generate_ui_components existe: buttons,       │
│                                     │    │     │ cards, nav, forms, hero con CSS custom        │
│                                     │    │     │ properties                                    │
├─────────────────────────────────────┼────┼─────┼───────────────────────────────────────────────┤
│ Export PNG/JPG/SVG/PDF              │ ✅ │ ✅  │ Single frame + all frames                     │
├─────────────────────────────────────┼────┼─────┼───────────────────────────────────────────────┤
│ Key Visuals/Recipes                 │ ✅ │ ✅  │ Save template as recipe, batch from recipe    │
├─────────────────────────────────────┼────┼─────┼───────────────────────────────────────────────┤
│ Render queue                        │ ✅ │ ✅  │ MCP export_batch + browser render worker      │
├─────────────────────────────────────┼────┼─────┼───────────────────────────────────────────────┤
│ Image upload                        │ ✅ │ ✅  │ Modal + Supabase storage                      │
├─────────────────────────────────────┼────┼─────┼───────────────────────────────────────────────┤
│ Version history                     │ ✅ │ ✅  │ list_versions / restore_version               │
├─────────────────────────────────────┼────┼─────┼───────────────────────────────────────────────┤
│ Google Fonts                        │ ✅ │ ✅  │ Picker + font details                         │
└─────────────────────────────────────┴────┴─────┴───────────────────────────────────────────────┘

────────────────────────────────────────────────────────────────────────────────

### ⚠️ PARCIAL (existe el plan, implementado a medias)

┌─────────────────┬──────────────────────────────────────────────────────────────────────────────┐
│ Feature         │ Qué falta                                                                    │
├─────────────────┼──────────────────────────────────────────────────────────────────────────────┤
│ Bezier pen tool │ pathData.ts soporta C/S/Q, el parser está listo, pero la UI del pen tool     │
│                 │ solo produce L (rectas). No hay drag para crear bezier handles.              │
├─────────────────┼──────────────────────────────────────────────────────────────────────────────┤
│ Point editing   │ onEditPathPoints prop existe, edit_path_point MCP tool está registrada, pero │
│ overlay         │ no hay overlay visual con anchors ni bezier handles draggables en el canvas  │
├─────────────────┼──────────────────────────────────────────────────────────────────────────────┤
│ UI Generator    │ El MCP generate_ui_components existe y funciona, pero no hay botón en la UI  │
│ button          │ (ni en BrandPanel, ni en toolbar)                                            │
├─────────────────┼──────────────────────────────────────────────────────────────────────────────┤
│ Convert to Path │ Triangle/star/polygon ya SON paths. Pero rect/circle siguen siendo <div>. D3 │
│                 │ (Convert to Path button) se deferreó.                                        │
└─────────────────┴──────────────────────────────────────────────────────────────────────────────┘

────────────────────────────────────────────────────────────────────────────────

### ❌ ILUSTRADOR TIENE — NOSOTROS NO

Ordenado por prioridad para nuestro caso de uso (diseño web HTML/CSS, no ilustración vectorial
pura):

#### 🔴 Críticos (bloquean workflows core)

┌───┬─────────────────────┬─────────────────────────────────────────┬────────────────────────────┐
│ # │ Feature Illustrator │ Nuestro gap                             │ Impacto                    │
├───┼─────────────────────┼─────────────────────────────────────────┼────────────────────────────┤
│ 1 │ Pen Tool con curvas │ Solo líneas rectas. No se crean curvas  │ Sin esto, la pen tool es   │
│   │ Bezier              │ C/Q/S con handles                       │ inútil para dibujo real.   │
│   │                     │                                         │ El parser ya existe —      │
│   │                     │                                         │ falta la interacción de    │
│   │                     │                                         │ drag                       │
├───┼─────────────────────┼─────────────────────────────────────────┼────────────────────────────┤
│ 2 │ Point/Anchor        │ Sin overlay visual. No se pueden mover  │ Sin esto, el pathfinder +  │
│   │ Editing (Direct     │ puntos, ajustar handles,                │ pen tool están             │
│   │ Selection + Anchor  │ añadir/quitar/convertir puntos          │ incompletos: el humano no  │
│   │ Point tools)        │                                         │ puede refinar lo que la IA │
│   │                     │                                         │ o el pathfinder producen   │
├───┼─────────────────────┼─────────────────────────────────────────┼────────────────────────────┤
│ 3 │ Gradients (linear,  │ Ni UI ni MCP. El HtmlContextualPanel    │ Esencial para diseño       │
│   │ radial)             │ menciona "gradient" en comentarios pero │ moderno. Un botón CTA sin  │
│   │                     │ no implementa. No hay background:       │ gradient es 2010           │
│   │                     │ linear-gradient(...) tooling            │                            │
└───┴─────────────────────┴─────────────────────────────────────────┴────────────────────────────┘

#### 🟠 Altos (limitan calidad de output)

┌───┬──────────────────────────┬─────────────────────────────────────────────────────────────────┐
│ # │ Feature Illustrator      │ Nuestro gap                                                     │
├───┼──────────────────────────┼─────────────────────────────────────────────────────────────────┤
│ 4 │ Stroke styling (caps,    │ SVG paths tienen stroke-width básico. Sin control de            │
│   │ joins, dash arrays,      │ stroke-linecap, stroke-linejoin, stroke-dasharray               │
│   │ alignment)               │                                                                 │
├───┼──────────────────────────┼─────────────────────────────────────────────────────────────────┤
│ 5 │ Blend modes (multiply,   │ mix-blend-mode CSS no está expuesto en UI ni MCP                │
│   │ screen, overlay...)      │                                                                 │
├───┼──────────────────────────┼─────────────────────────────────────────────────────────────────┤
│ 6 │ Convert Shape to Path    │ D3 se deferreó. Sin esto, rects y circles no pueden entrar al   │
│   │ (rect/circle → <path>)   │ pathfinder ni al point editing                                  │
├───┼──────────────────────────┼─────────────────────────────────────────────────────────────────┤
│ 7 │ Outline Stroke           │ Convierte stroke en path rellenable. No existe. Limita lo que   │
│   │                          │ pathfinder puede hacer con paths que tienen stroke              │
├───┼──────────────────────────┼─────────────────────────────────────────────────────────────────┤
│ 8 │ Offset Path              │ Crear versión expandida/contraída de un path. Muy usado para    │
│   │                          │ iconos, badges, versiones responsive                            │
├───┼──────────────────────────┼─────────────────────────────────────────────────────────────────┤
│ 9 │ Shape Builder Tool       │ Diferente de pathfinder. Es interactivo: arrastras entre        │
│   │                          │ regiones y unifica/recorta visualmente. Pathfinder nuestro es   │
│   │                          │ declarativo (seleccionás dos, elegís operación)                 │
└───┴──────────────────────────┴─────────────────────────────────────────────────────────────────┘

#### 🟡 Medios (nice-to-have)

┌────┬──────────────────────────────────┬────────────────────────────────────────────────────────┐
│ #  │ Feature Illustrator              │ Nuestro gap                                            │
├────┼──────────────────────────────────┼────────────────────────────────────────────────────────┤
│ 10 │ Free Transform (rotate, shear,   │ Tenemos drag/resize. No rotate/shear/reflect en UI     │
│    │ reflect with UI)                 │ (aunque CSS transform sí lo soporta)                   │
├────┼──────────────────────────────────┼────────────────────────────────────────────────────────┤
│ 11 │ Type on Path                     │ Texto que sigue una curva. No implementado             │
├────┼──────────────────────────────────┼────────────────────────────────────────────────────────┤
│ 12 │ Snap/Guides/Smart Guides         │ Sin grid, sin snap a punto, sin guías. El infinite     │
│    │                                  │ canvas es un espacio vacío                             │
├────┼──────────────────────────────────┼────────────────────────────────────────────────────────┤
│ 13 │ Copy/Paste Style                 │ onCopyStyle/onPasteStyle props existen pero no         │
│    │                                  │ implementadas                                          │
├────┼──────────────────────────────────┼────────────────────────────────────────────────────────┤
│ 14 │ Eye Dropper                      │ MCP color_picker existe pero no hay UI de cuentagotas  │
├────┼──────────────────────────────────┼────────────────────────────────────────────────────────┤
│ 15 │ Workspace rename                 │ H2 del plan — se marcó como hecho pero sigue sin       │
│    │                                  │ implementar                                            │
└────┴──────────────────────────────────┴────────────────────────────────────────────────────────┘

