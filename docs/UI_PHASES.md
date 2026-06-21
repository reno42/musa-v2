# EditorV2 UI Evolution — Phase Plan

## Vision
Transform EditorV2 from a grid-based code editor into a professional design tool that looks and feels like Figma/Illustrator, with a visual-first semantic-tagging workflow inspired by Webflow.

**Core principle**: A human adds visual primitives (shapes, text), styles them by dragging/resizing/coloring, then applies semantic HTML tags. The code updates in real-time. AI agents can "see" the design through the generated semantic HTML.

---

## Phase A — UI Overhaul: Floating Panels + Icon-Only Tools

**Goal**: Full-bleed infinite canvas with floating glass panels. Icon-only buttons. Collapsible code panel.

### A1. Missing SVG Icons
Add to `src/shared/icons.tsx`: AlignLeft, AlignCenter, AlignRight, Pen, Rectangle, FlexRow, FlexCol, ChevronDown, ChevronLeft, ChevronRight, EyeOff, Copy, Button (UI element).

### A2. Layout Migration
**From**: CSS flexbox grid (top bar → toolbars → code panel | canvas | properties)
**To**: Full-bleed canvas as the entire viewport, with floating panels positioned absolutely over it.

```
┌──────────────────────────────────────────────────────────┐
│ ── slim top bar ──────────────────────────────────────── │
│                                                          │
│  ┌─ ┐                                    ┌────────────┐ │
│  │ T│   ┌─────────────────────────┐      │ Properties │ │
│  │ o│   │                         │      │ (floating) │ │
│  │ o│   │     INFINITE CANVAS     │      │            │ │
│  │ l│   │     (full viewport)     │      │            │ │
│  │ s│   │                         │      └────────────┘ │
│  └─ ┘   └─────────────────────────┘                      │
└──────────────────────────────────────────────────────────┘
```

### A3. Code Panel (Slide-In)
- Slides in from the left edge
- When open: pushes the canvas horizontally (canvas shrinks)
- When closed: canvas occupies full width
- Toggle: `</>` icon button on the left edge
- Width: 380px

### A4. Left Toolbar (Floating)
- Vertical strip, positioned fixed at left:20px, top:80px
- Glass panel (blur, rounded, semi-transparent)
- Icon-only tools:
  - Select (V) — cursor icon
  - Hand (H) — hand icon
  - Rectangle (R) — rectangle icon
  - Circle (O) — circle icon
  - Text (T) — type icon
  - Frame (+) — dropdown with presets (IG Square, Story, Banner, Twitter)
  - Divider
  - Undo/Redo
  - Divider
  - Zoom In / Zoom Out / Zoom %

### A5. Top Bar (Slim)
- Height: 40px, solid dark background
- Left: ← Dashboard icon + Project name
- Center: Frame info (name · dimensions)
- Right: icon-only buttons for panel tabs (Props, Struct, Vars, Brand, Format, Agents), Font picker, Export (PNG/JSON dropdown), Duplicate, Delete

### A6. Right Properties Panel (Floating)
- Positioned fixed at right:20px, top:80px
- Glass panel, 260px wide
- Accordion sections with icon tabs at the top:
  - Properties (sliders icon) — contextual element properties
  - Structure (layout icon) — DOM tree
  - Variables (DNA icon) — CSS variables
  - Brand (palette icon) — brand tokens
  - Format (file icon) — export settings
  - Agents (bot icon) — active AI agents
- Each tab is icon-only; clicking toggles that panel section

### Accent Color
- Primary: `#c8b898` (beige), configurable via CSS custom property `--accent`
- Active selection: `#3B82F6` (blue)

---

## Phase B — Visual-First Insert + Semantic Tagging

**Goal**: Humans add visual primitives, not HTML tags. Semantic meaning is applied after creation.

### B1. Visual Primitives System
Replace the current InsertToolbar (which inserts `<h1>`, `<p>`, `<button>`) with 4 primitives:

| Primitive | Canvas Action | Generated HTML |
|-----------|--------------|----------------|
| **Text Block** | Click on canvas → contenteditable text | `<div data-layer-id="...">Text</div>` |
| **Rectangle** | Click-drag to draw | `<div data-layer-id="..."></div>` |
| **Circle** | Click-drag to draw | `<div data-layer-id="..." style="border-radius:50%"></div>` |
| **Image** | Click to place (placeholder) | `<img data-layer-id="..." />` |

Each primitive gets:
- A unique `data-layer-id` for CSS selector targeting
- Default visual styles (color, size, etc.)
- No semantic HTML tag initially — just `<div>` or `<img>`

### B2. Semantic Tag System
After creating a visual primitive, the user can apply a semantic tag via the contextual panel:

**Available tags**: div, section, article, nav, header, footer, main, aside, button, a, h1-h6, p, span, label, input, form, ul, ol, li

**How it works**:
1. User selects an element on canvas
2. Contextual panel shows current tag (default: `div`)
3. User picks a new tag from dropdown
4. Code updates: `<div>` → `<button>` (preserves all visual styles)
5. For grouping: user selects multiple elements → "Group as section"

**Generated code example**:
```html
<!-- Before tagging -->
<div data-layer-id="abc123" style="padding:12px 24px; background:#3B82F6; border-radius:8px;">
  Click me
</div>

<!-- After tagging as "button" -->
<button data-layer-id="abc123" style="padding:12px 24px; background:#3B82F6; border-radius:8px; border:none; cursor:pointer;">
  Click me
</button>
```

### B3. Canvas Click-to-Add
When a primitive tool is active (Rectangle, Circle, Text):
- Cursor changes to crosshair
- Click (or click-drag for shapes) on the canvas inside the active frame
- Element is created at click position
- HTML is appended to frame's HTML string
- CSS gets a new rule for the element's styles
- Element appears immediately in the Shadow DOM
- Code panel updates in real-time

### B4. Frame Presets Dropdown
- Single `+` icon in the left toolbar
- Click opens a dropdown with preset sizes
- Presets: IG Square (1080×1080), IG Story (1080×1920), Banner (1920×1080), Twitter (1200×628), Custom

---

## Phase C — Drawing Tools (Future)

**Goal**: Full Figma/Illustrator-level drawing tools with real-time code sync.

### C1. Rectangle/Ellipse Tool
- Click-drag on canvas to draw
- Shift constrains to square/circle
- Creates positioned `<div>` with exact pixel dimensions
- Resize handles after creation

### C2. Text Tool
- Click to place insertion point
- Type inline (contenteditable within Shadow DOM)
- Font, size, weight, color — all editable via contextual panel
- Creates `<div>` with text content

### C3. Pen/Bezier Tool
- Click to add straight points
- Click-drag for bezier curves
- Creates SVG `<path>` element
- Point editing after creation

### C4. Selection + Transform
- 8 resize handles (corners + midpoints)
- Rotation handle above top-center
- Multi-select with shift-click
- Group (Ctrl+G) / Ungroup (Ctrl+Shift+G)

### C5. Smart Guides + Alignment
- Snap to nearby edges/centers while dragging
- Alignment buttons (left, center, right, top, middle, bottom)
- Distribute spacing

### C6. Live Code Sync
- Every visual operation → HTML/CSS update
- Code panel shows changes in real-time
- AI agents see the current state via MCP

---

## MCP Integration

### Phase A+B MCP Tools
| Tool | Purpose |
|------|---------|
| `add_element` | Add visual primitive to frame (type: rect/circle/text/image) |
| `set_element_tag` | Apply semantic tag to an existing element |
| `create_template` | Extended with `engine=html` |
| `update_template` | Extended with html/css/frames |
| `create_html_frame` | Add frame with preset dimensions |
| `update_html_frame` | Modify frame content/dimensions |
| `delete_html_frame` | Remove a frame |
| `get_html_frames` | List all frames |

### Phase C MCP Tools (Future)
| Tool | Purpose |
|------|---------|
| `draw_shape` | Create rectangle/ellipse at position with dimensions |
| `draw_path` | Create SVG path from point data |
| `transform_element` | Move/resize/rotate an element |
| `group_elements` | Group multiple elements |
| `align_elements` | Align/distribute selected elements |
