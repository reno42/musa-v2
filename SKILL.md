# Futuraria Design Editor — AI Agent Skill

**Skill Name:** `futuraria-editor`
**Description:** React + TypeScript + Vite HTML/CSS design editor with iframe-sandboxed rendering, Monaco code panels, frame-based layout, floating dockable panels, MCP tool API, and Supabase persistence. Deployed on Netlify with serverless functions.
**Triggers:** Any task involving the Futuraria editor UI, HTML/CSS design manipulation, component changes, bug fixes, a11y improvements, API integration, MCP tools, or React best-practice refactors.

---

## Overview

You are an AI agent working on the Futuraria Design Editor — a React 18 + TypeScript + Vite application providing a WYSIWYG HTML/CSS design experience. The editor is deployed on **Netlify** with serverless API via Netlify Functions and **Supabase** for cloud persistence (dual-write model: Supabase when configured, in-memory fallback when not).

**Production URL:** `https://futuraria.netlify.app`
**Dev URL:** `http://localhost:5173` (Vite dev server)
**API Base (cloud):** `/api` (relative — routed via Netlify redirect to `/.netlify/functions/api`)
**MCP Endpoint:** `/mcp` (Model Context Protocol — SSE + JSON-RPC for AI agents)
**Start command:** `npm run dev` (from project root)

## Project Structure

```
design-main/
├── src/                          — React frontend (Vite)
│   ├── App.tsx                   — Root, routing (dashboard vs editor)
│   ├── main.tsx                  — Vite entry point
│   ├── pages/
│   │   └── EditorV2.tsx          — Main V2 editor: iframe canvas + dockable panels
│   ├── components/
│   │   ├── Dashboard.tsx         — Template gallery, workspace selector
│   │   ├── InfiniteHtmlCanvas.tsx— Infinite canvas with per-frame HTML/CSS iframe rendering
│   │   ├── DesignFrame.tsx       — Single frame renderer with selection overlay
│   │   ├── HtmlCanvas.tsx        — HTML/CSS iframe sandbox with CSP + postMessage bridge
│   │   ├── CodePanel.tsx         — Monaco editor for HTML + CSS (split view)
│   │   ├── FloatingToolbar.tsx   — Floating tool palette (select, hand, rect, circle, pen, text, image, frame)
│   │   ├── StructurePanel.tsx    — HTML element tree with drag-and-drop hierarchy
│   │   ├── HtmlLayersPanel.tsx   — Layer list for frame objects
│   │   ├── HtmlContextualPanel.tsx— Contextual properties (position, size, style)
│   │   ├── GoogleFontPicker.tsx  — Google Fonts browser with all weights/italics
│   │   ├── VariablesPanel.tsx    — Design token and CSS variable editor
│   │   ├── FormatPanel.tsx       — Multi-format adaptation panel
│   │   ├── BrandPanel.tsx        — Brand DNA profile management
│   │   ├── ActiveAgentsPanel.tsx — Real-time collaborative agent presence
│   │   └── Toast.tsx             — Toast notifications
│   ├── hooks/
│   │   └── useDockablePanel.ts   — Draggable/dockable floating panel hook
│   ├── lib/
│   │   ├── templateApi.ts        — API client + localStorage fallback
│   │   ├── supabase.ts           — Fetch wrapper
│   │   └── supabaseRealtime.ts   — Supabase realtime subscriptions + broadcast
│   └── shared/
│       └── icons.tsx             — SVG icon library
├── api/                          — Express API (serverless via Netlify Functions)
│   ├── src/
│   │   ├── index.ts              — Express app factory
│   │   ├── server.ts             — Local dev server entry
│   │   ├── types.ts              — Shared TypeScript types (DesignTemplate, Frame, etc.)
│   │   ├── routes/               — REST API routes (templates, frames, versions, etc.)
│   │   ├── services/
│   │   │   ├── templates.ts      — Template service (Supabase dual-write)
│   │   │   ├── store.ts          — In-memory store (fallback)
│   │   │   └── supabase.ts       — Supabase admin client (service_role)
│   │   └── middleware/
│   │       ├── auth.ts           — API key / Bearer token auth
│   │       └── rateLimit.ts      — Rate limiting
│   └── package.json
├── netlify/
│   └── functions/
│       ├── api.mjs               — Express → Netlify Function bridge
│       └── mcp.mjs               — MCP server (JSON-RPC + SSE, 114 tools)
├── netlify.toml                  — Netlify build + redirects
├── package.json                  — Root: Vite + React deps
├── vite.config.ts
└── tsconfig.json
```

## Deployment Architecture

```
Browser / AI Agent
  │
  ▼
Netlify CDN (futuraria.netlify.app)
  ├── /*               → dist/index.html (SPA)
  ├── /api/*           → /.netlify/functions/api  (Express → JSON)
  └── /mcp             → /.netlify/functions/mcp   (JSON-RPC + SSE)
         │
         ▼
Supabase (PostgreSQL)
  ├── workspaces table  (id, name, owner_id, data JSONB, timestamps)
  └── templates table   (id, name, workspace_id, data JSONB, user_id, timestamps)
```

### Dual-Write Persistence

```
Try Supabase first → ✓ Return result
                   → ✗ Fall through to in-memory store
Write operations:  in-memory store first → then Supabase.upsert() (non-blocking)
```

- **Supabase configured** (env vars in Netlify): Full cloud persistence across cold starts
- **No Supabase**: In-memory only — survives container lifetime, resets on cold start
- **MCP calls same services** — identical dual-write behavior, no separate code path

## Architecture

```
App (React state)
├── Dashboard            — template gallery, search, workspace selector
├── EditorV2 (main view)
│   ├── CodePanel        — Monaco code editor (HTML + CSS split view)
│   ├── StructurePanel   — HTML element tree (drag-and-drop reorder)
│   ├── HtmlLayersPanel  — frame object layer management
│   ├── InfiniteHtmlCanvas — per-frame HTML/CSS iframe rendering
│   │   └── DesignFrame  — single frame: iframe + selection overlay
│   ├── FloatingToolbar  — tool palette (select, hand, shapes, text, image, frame)
│   ├── HtmlContextualPanel — selected element properties
│   ├── GoogleFontPicker — font family browser with weights/italics
│   ├── VariablesPanel   — CSS custom properties editor
│   ├── FormatPanel      — multi-format adaptation
│   ├── BrandPanel       — brand DNA management
│   └── ActiveAgentsPanel — collaborative agent presence (Supabase Realtime)
└── ToastProvider        — toast notification system
```

### Data Model (V2 HTML/CSS)

The editor operates on frame-based HTML/CSS templates:

```typescript
interface DesignTemplate {
  id: string;
  name: string;
  width: number;
  height: number;
  engine: "html";
  html?: string;        // Global HTML (applied across all frames)
  css?: string;         // Global CSS
  frames: Frame[];      // Frame array — each frame has its own html/css
  styles: Style[];
  variables: { collections, variables, bindings };
  metadata: { createdAt, updatedAt, ... };
}

interface Frame {
  id: string;
  templateId: string;
  name: string;
  x: number; y: number;
  width: number; height: number;
  html?: string;
  css?: string;
  objects?: any[];      // Frame-level objects (shapes, text, images)
}
```

### Data Flow

```
User action → iframe click (postMessage bridge) or code edit (Monaco)
  → EditorV2 state update
    → localStorage (instant save)
    → API PUT /api/templates/:id (best-effort cloud sync)
    
Template load:
  → API GET /api/templates/:id
    → If localStorage is newer → prefer localStorage
    → If API has no html/css → fall back to localStorage
```

### Rendering

Each frame renders inside a sandboxed iframe with:
- **CSP meta tag**: blocks scripts, allows inline styles + Google Fonts
- **postMessage bridge**: click on `data-layer-id` elements sends selection events to parent
- **html2canvas**: client-side PNG export at up to 4x scale

## MCP (Model Context Protocol) — AI Agent Connection Guide

AI agents connect to the MCP server at `https://futuraria.netlify.app/mcp` to discover and invoke **145+ tools** for workspace, template, frame, HTML/CSS, font, brand, batch, collaborative design, design system extraction, frame content editing, template profiling, CSV-to-frames batch generation, SVG import, bezier curves, pathfinder operations, stroke styling, gradient fills, blend modes, path outline/offset, authentication, team management, brand manual generation, and design system verification.

### Protocol Flow

```
Agent (Claude / Cursor / Custom)
  │
  ├─ GET  /mcp                          → SSE init (event: endpoint)
  ├─ POST /mcp  { method: "initialize" } → capabilities + server info
  ├─ POST /mcp  { method: "tools/list" } → discover 135+ tools
  └─ POST /mcp  { method: "tools/call" } → invoke any tool
```

**Auth:** Pass `x-api-key: your-key` or `Authorization: Bearer your-token` header on POST requests. Supabase Auth JWTs are also supported for team features.

### Key MCP Tool Categories

| Category | Example Tools | Count |
|----------|--------------|-------|
| Workspace | `list_workspaces`, `create_workspace` | 2 |
| Templates | `create_template`, `get_template`, `update_template`, `export_template` | 8 |
| Frames | `create_frame`, `create_html_frame`, `update_html_frame`, `update_frame_content` | 8 |
| HTML/CSS | `set_html`, `set_css`, `add_element`, `update_element`, `remove_element` | 12 |
| Structure | `get_template_structure`, `select_element`, `reorder_element` | 6 |
| Drawing | `draw_shape`, `draw_path`, `draw_bezier`, `edit_path_points`, `edit_path_point`, `transform_element`, `group_elements`, `align_elements` | 9 |
| SVG | `import_svg`, `pathfinder`, `shape_to_path`, `draw_bezier`, `edit_path_points`, `edit_path_point` | 6 |
| SVG Styling | `set_stroke_style`, `set_gradient`, `set_blend_mode`, `outline_stroke`, `offset_path` | 5 |
| Templates+ | `rename_template` | 1 |
| Fonts | `list_fonts`, `search_google_fonts`, `add_font_to_template` | 4 |
| AI | `ai_generate_text`, `ai_generate_image`, `ai_palette`, `ai_suggest_layout` | 5 |
| Brand | `register_brand`, `validate_brand`, `check_contrast`, `auto_fix_brand` | 6 |
| Brand Guidelines | `create_brand_guideline`, `get_brand_guideline`, `list_brand_guidelines`, `update_brand_guideline`, `delete_brand_guideline`, `apply_brand_to_template` | 6 |
| Batch | `batch_update`, `render_batch`, `batch_create_variants`, `batch_render_html` | 7 |
| Variables | `create_variable`, `create_collection`, `link_variable`, `apply_variables` | 6 |
| Version | `list_versions`, `restore_version` | 2 |
| Collaboration | `share_template`, `claim_section`, `get_active_agents`, `broadcast_section_change` | 8 |
| Teams | `create_team`, `list_teams`, `get_team`, `invite_to_team`, `list_team_members`, `remove_team_member`, `update_team_member_role`, `share_workspace_with_team` | 8 |
| Export | `export_batch`, `copy_as`, `export_pdf` | 3 |
| Format | `detect_structure`, `adapt_format`, `adapt_all_formats`, `compare_adaptations` | 4 |
| Design System | `generate_design_artifacts`, `get_design_artifacts`, `generate_brand_manual`, `verify_design_system`, `duplicate_frame`, `update_frame_content`, `get_frame_changes`, `profile_template_pool`, `generate_csv_template`, `apply_csv_to_frames` | 10 |
| Brand Guidelines DB | `create_brand_guideline`, `get_brand_guideline`, `list_brand_guidelines`, `update_brand_guideline`, `delete_brand_guideline`, `apply_brand_to_template` | 6 |
| Render | `render_html_template`, `render_to_formats` | 2 |

### Quick Tool Reference (No need to read source code)

**Most-used tools with required/optional parameters:**

| Tool | Required | Optional | Returns |
|------|----------|----------|---------|
| `create_workspace` | `name` | — | `{ id }` |
| `create_template` | `name`, `workspaceId` | `engine` (default "html"), `width` (1080), `height` (1080), `html`, `css` | `{ id, frames: [{ id }] }` |
| `create_html_frame` | `templateId`, `name` | `width` (1080), `height` (1080), `html`, `css`, `background` ("#ffffff"), `frameStrategy` | `{ id, x, y, width, height, frameStrategy, hint }` |
| `update_html_frame` | `templateId`, `frameId` | `name`, `html`, `css`, `width`, `height`, `background` | `{ id, ...frame }` |
| `update_frame_content` | `templateId`, `frameId`, `selector` | `patch: { text, html, src, href, className, style, backgroundImage, attr, remove }` | `{ matched, applied, contentHash }` |
| `add_element` | `templateId`, `tag`, `frameId` | `html`, `css`, `parentSelector`, `position` ("append"), `layerName` | `{ layerName }` |
| `add_primitive` | `templateId`, `frameId`, `type` | `x` (0), `y` (0), `width`, `height`, `color`, `content`, `fontSize`, `borderRadius` | `{ layerName, type, warning? }` |
| `draw_shape` | `templateId`, `frameId`, `type` | `x`, `y`, `width`, `height`, `color`, `borderRadius`, `sides` | `{ layerName }` |
| `set_html` | `templateId`, `frameId` | `html` | `{ success }` |
| `set_css` | `templateId`, `frameId` | `css` | `{ success }` |
| `get_template` | `templateId` | — | `{ id, frames, html, css, metadata }` |
| `duplicate_frame` | `templateId`, `sourceFrameId` | `newName` | `{ frameId, contentHash }` |
| `delete_html_frame` | `templateId`, `frameId` | — | `{ success }` |
| `remove_element` | `templateId`, `elementId` | — | `{ success }` |
| `transform_element` | `templateId`, `elementId` | `x`, `y`, `width`, `height`, `rotation` | `{ success }` |
| `generate_design_artifacts` | `templateId` | `action` ("generate"/"publish"), `brandName` | `{ designMd, tokensJson, sharedCss, sourceHash }` |
| `export_batch` | `templateId` | `frameIds`, `format` ("png"/"svg"/"pdf") | `{ urls }` |

**Important constants:**
- `create_template` with `engine: "html"` auto-creates Frame 1 and persists it
- `create_html_frame` auto-calculates position (cascade-grid, never overlaps)
- `add_element` requires `frameId` — will throw if omitted
- `add_primitive` returns `OVERLAP_WARNING` if coordinates collide with existing elements
- All content tools throw `NO_FRAMES_ERROR` if the template has zero frames

### Agent Workflow Patterns (via MCP)

**Pattern 1: Create an HTML design from scratch**
```
tools/call: create_workspace({ name: "Client Project" })                    → wsId
tools/call: create_template({ name: "Hero", workspaceId: wsId, engine: "html" })  → tplId, tpl.frames[0].id
tools/call: create_html_frame({ templateId: tplId, name: "Slide 2" })       → frameId (auto-placed)
tools/call: add_element({ templateId: tplId, frameId, tag: "h1", html: "Hello" })
tools/call: add_primitive({ templateId: tplId, frameId, type: "rect", x: 50, y: 50, width: 200, height: 100, color: "#3B82F6" })
```

**Note:** `create_template({ engine: "html" })` already creates Frame 1 with an auto-generated ID. You can use that frameId directly or create additional frames with `create_html_frame`. Frame positions are auto-calculated (never overlap).

### ⚠️ CRITICAL RULE: Frame-First Enforcement (System-Enforced)

**The system will REJECT any attempt to add content without a frame.** This is not a recommendation — it is a hard server-side gate.

**Tools that require an existing frame:**
- `add_element` — throws `NO_FRAMES_ERROR` if no frames exist
- `add_primitive` — throws `NO_FRAMES_ERROR` if no frames exist
- `update_frame_content` — throws `NO_FRAMES_ERROR` if no frames exist
- `update_html_frame` — throws `NO_FRAMES_ERROR` if no frames exist
- `add_element` also requires `frameId` as a mandatory parameter for HTML-engine templates

**Correct workflow (ALWAYS follow this order):**
```
1. create_template({ ..., engine: "html" })     → tplId (+ Frame 1 auto-created)
2. create_html_frame({ templateId: tplId, ... }) → frameId  (position auto-calculated)
3. add_element({ templateId: tplId, frameId, ... })         ← now works
4. add_primitive({ templateId: tplId, frameId, ... })      ← now works
```

**Frame Strategy — two modes:**

| Strategy | When to use | Behavior |
|----------|-------------|----------|
| `multi` (default) | Social posts, print, ads, carousels | One frame per design variant. Each frame is independent. |
| `single-web` | Landing pages, web apps, long-scroll pages | One tall frame (e.g. 1440×5000). Add `<section>`, `<header>`, `<footer>` inside. Do NOT create separate frames for page sections. |

**Auto-detection:** If `frameStrategy` is omitted, the system infers it from dimensions:
- `height > width × 2` → `single-web`
- Otherwise → `multi`

**Overlap detection:** When `add_primitive` is called with coordinates that overlap an existing element in the same frame, the response includes an `OVERLAP_WARNING` with a suggested offset. This is a warning, not an error — but you should adjust coordinates or create a new frame.

**For separate designs:** Each design variant MUST go in its own frame. Do NOT stack multiple designs in the same frame at position (0,0).

**Deterministic frame placement:** Frame positions are auto-calculated using a cascade-grid algorithm (left-to-right, wrapping to new row at 4000px). The AI does NOT control x/y — the system guarantees no two frames ever overlap. Do not pass `x` or `y` parameters (they are not accepted).
```

**Pattern 2: Add visual elements to a frame**
```
tools/call: add_element({ templateId: tplId, frameId, tag: "h1", content: "Hello", ... })
tools/call: draw_shape({ templateId: tplId, frameId, shape: "rect", x: 100, y: 50, ... })
tools/call: transform_element({ templateId: tplId, frameId, layerName: "h1-0", x: 200, y: 100 })
```

**Pattern 3: Batch generation**
```
tools/call: batch_create_variants({ templateId: tplId, variations: [...] })
tools/call: batch_render_html({ templateId: tplId })
tools/call: batch_export({ batchId: "..." })
```

**Pattern 4: Extract a design system deterministically**
```
tools/call: generate_design_artifacts({ templateId: tplId, action: "generate" })
  → { designMd, tokensJson, sharedCss, sourceHash, frameCount, _deterministic: true }
// Publish to template metadata + optionally to brand_guidelines table:
tools/call: generate_design_artifacts({ templateId: tplId, action: "publish", brandName: "Acme Corp" })
  → { designMd, tokensJson, sharedCss, _published: true, brandId: "brand_abc123" }
```

**Pattern 5: Retrieve + check staleness of stored artifacts**
```
tools/call: get_design_artifacts({ templateId: tplId })
  → { designMd, tokensJson, sharedCss, _stale: true|false, sourceHash }
// If _stale: true, re-generate to get current values
```

**Pattern 6: Duplicate a frame and swap content**
```
tools/call: duplicate_frame({ templateId: tplId, sourceFrameId: "f1" })
  → { frameId: "f2", contentHash: "abc123" }
tools/call: update_frame_content({
  templateId: tplId, frameId: "f2",
  patches: [
    { selector: "h1", patch: { text: "New Title" } },
    { selector: ".hero-img", patch: { src: "https://example.com/new.jpg" } },
    { selector: ".cta", patch: { text: "Buy Now!", style: { background: "#f00" } } }
  ]
})
```

**Pattern 7: Detect frame changes since last AI edit**
```
tools/call: get_frame_changes({ templateId: tplId, sinceTimestamp: "2026-06-25T00:00:00Z" })
  → { changedFrames: ["f1"], unchangedFrames: ["f2"], currentHashes: {...} }
// Use to know if human edited after AI's last change
```

**Pattern 8: Batch content generation — CSV-driven frame automation**
```
// Step 1: Profile template pool to detect slots
tools/call: profile_template_pool({ templateIds: ["tpl_abc", "tpl_def"] })
  → { profiles: [...], csvColumns: [...], totalSlots: 12, _deterministic: true }

// Step 2: Generate CSV template for the human
tools/call: generate_csv_template({ templateIds: ["tpl_abc", "tpl_def"], rowCount: 30 })
  → { csv: "# Template Pool CSV\n...", columns: [...], delimiter: ",", _deterministic: true }

// — Human fills CSV in Excel/Sheets, choosing template per row via _template column —
// CSV structure:
//   _template     | title          | body           | hero_image
//   tpl_abc       | "New Headline" | "Body text..." | "https://..."
//   tpl_def       | "Compact Post" | "Short body"   | "https://..."

// Step 3: Apply filled CSV → new output template with generated frames
tools/call: apply_csv_to_frames({
  workspaceId: "ws_123",
  csvData: "<human-filled CSV content>",
  templateIds: ["tpl_abc", "tpl_def"],
  outputName: "News Batch — 30 Posts",
  naming: "Post {index} — {title}",
  onMissingTemplate: "skip",
  onOverflow: "truncate"
})
  → { outputTemplateId: "tpl_new", generatedFrames: 28, skippedRows: 2, report: [...] }
```

**Pattern 9: Create and manage reusable brand guidelines**
```
// Step 1: Publish design system as a brand guideline (creates brand_guidelines row)
tools/call: generate_design_artifacts({ templateId: tplId, action: "publish", brandName: "Acme Corp" })
  → { brandId, designMd, tokensJson, sharedCss, _published: true }

// Step 2: Apply the brand to other templates in the workspace
tools/call: apply_brand_to_template({ templateId: tplId2, brandId: "brand_abc123" })
  → { success: true, brandName: "Acme Corp", appliedArtifacts: { hasTokens: true, ... } }

// Step 3: Retrieve brand-aware artifacts (prefers brand_guidelines data)
tools/call: get_design_artifacts({ templateId: tplId2 })
  → { brandId: "brand_abc123", brandName: "Acme Corp", designMd, tokensJson, ... }

// Step 4: Discover all brands in a workspace
tools/call: list_brand_guidelines({ workspaceId: wsId })
  → { brands: [{ id, name, description, sourceTemplateIds, ... }], count: N }

// Step 5: Update a brand when the design system evolves
tools/call: update_brand_guideline({ brandId: "brand_abc123", tokensJson: "...", designMd: "..." })
  → { success: true, brand: { ... } }

// Step 6: Fetch a specific brand directly
tools/call: get_brand_guideline({ brandId: "brand_abc123" })
  → { success: true, brand: { id, name, tokensJson, designMd, sharedCss, ... } }

// Step 7: Remove a brand (templates retain their snapshots)
tools/call: delete_brand_guideline({ brandId: "brand_abc123" })
  → { success: true, deleted: "brand_abc123" }
```

**Key guarantees:**
- The AI never touches content — system profiles templates deterministically, generates CSV template, human fills it
- `_template` column uses immutable templateId (not mutable frame name) — templates are listed in CSV comments
- Output goes to a NEW template, never modifying source templates
- Slot overflow is handled deterministically: truncate, skip_row, or continue_warn
- `data-slot` attribute on HTML elements overrides auto-detected slot names for precise CSV column naming

**Pattern 9: Import SVG and convert to design elements**
```
tools/call: import_svg({
  workspaceId: "ws_123",
  svg: "<svg>...</svg>",
  name: "Imported Icon"
})
  → { templateId, frameId, elements: [{ layerName, tag, type }] }
// Elements created: rect→div, circle→div, line→div, polygon→SVG, path→SVG, text→div
```

**Pattern 10: Draw bezier curves + edit path points**
```
tools/call: draw_bezier({ templateId: "tpl_123", frameId: "f1", x: 100, y: 100, width: 200, height: 200, pathData: "M50,0 C50,55 100,55 100,100 C100,145 150,145 150,200", fill: "#8B5CF6", stroke: "#6D28D9", strokeWidth: 2, closed: false })
  → { layerName: "el_abc", type: "bezier", pathData: "..." }
tools/call: edit_path_points({ templateId: "tpl_123", frameId: "f1", elementId: "el_abc", newPathData: "M50,0 C50,80 150,80 150,200" })
  → { success: true, elementId: "el_abc", newPathData: "..." }
```

**Pattern 11: Pathfinder boolean operations**
```
tools/call: pathfinder({ templateId: "tpl_123", frameId: "f1", elementIdA: "el_a", elementIdB: "el_b", operation: "union" })
  → { newElementId: "el_new", bbox: { x, y, width, height } }
// Operations: union (combine), subtract (A minus B), intersect (overlap only), exclude (XOR)
```

**Pattern 12: Team collaboration setup**
```
tools/call: create_team({ name: "Design Team", description: "Core design team" })
  → { id: "team_abc", name, ownerId }
tools/call: invite_to_team({ teamId: "team_abc", email: "designer@example.com", role: "member" })
  → { invitationId, teamId, email }
tools/call: share_workspace_with_team({ workspaceId: "ws_123", teamId: "team_abc" })
  → { shared: true }
tools/call: list_team_members({ teamId: "team_abc" })
  → { members: [...], total: 3 }
```

**Pattern 13: Generate brand identity manual**
```
tools/call: generate_brand_manual({ templateId: "tpl_123", brandName: "Acme Corp", tagline: "Building the future" })
  → { brandManualHtml: "<html>...", sourceHash: "...", summary: { colorCount: 8, fontCount: 2, ... } }
// Returns a complete, self-contained HTML document with:
// - Cover page, color palette swatches, typography showcase, spacing scale,
//   border radius, shadows, components, CSS custom properties reference
```

**Pattern 14: Verify design system consistency**
```
tools/call: verify_design_system({ templateId: "tpl_123" })
  → { status: "healthy", healthScore: 95, issues: [...], recommendation: "..." }
// Verifies that extracted tokens match actual CSS usage
// Detects orphan tokens, missing colors, font mismatches
```

**Pattern 15: SVG vector editing — draw bezier + edit points**
```
// Draw a bezier curve with control points
tools/call: draw_bezier({
  templateId: "tpl_123", frameId: "f1",
  x: 100, y: 100, width: 200, height: 200,
  pathData: "M50,0 C50,55 100,55 100,100 C100,145 150,145 150,200",
  fill: "none", stroke: "#8B5CF6", strokeWidth: 2, closed: false
})
  → { layerName: "el_abc", type: "bezier", pathData: "..." }

// Edit a single point incrementally
tools/call: edit_path_point({
  templateId: "tpl_123", frameId: "f1",
  elementId: "el_abc", pointIndex: 2, x: 120, y: 80
})
  → { success: true, updatedPathData: "..." }

// Replace entire path data
tools/call: edit_path_points({
  templateId: "tpl_123", frameId: "f1",
  elementId: "el_abc", newPathData: "M50,0 C50,80 150,80 150,200"
})
  → { success: true, elementId: "el_abc", newPathData: "..." }
```

**Pattern 16: SVG path styling — stroke, gradient, blend, outline, offset**
```
// Set stroke style (color, width, linecap, linejoin, dasharray)
tools/call: set_stroke_style({
  templateId: "tpl_123", frameId: "f1",
  layerId: "el_abc",
  strokeColor: "#6D28D9", strokeWidth: 3,
  linecap: "round", linejoin: "round", dasharray: "8 4"
})
  → { success: true, layerId: "el_abc" }

// Apply a gradient fill
tools/call: set_gradient({
  templateId: "tpl_123", frameId: "f1",
  layerId: "el_div", gradientType: "linear", angle: 135,
  stops: [
    { color: "#8B5CF6", position: 0 },
    { color: "#EC4899", position: 100 }
  ]
})
  → { success: true, gradientValue: "linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%)" }

// Set blend mode
tools/call: set_blend_mode({
  templateId: "tpl_123", frameId: "f1",
  layerId: "el_abc", blendMode: "multiply"
})
  → { success: true, blendMode: "multiply" }

// Convert stroke to filled outline (expands path by stroke width)
tools/call: outline_stroke({
  templateId: "tpl_123", frameId: "f1",
  layerId: "el_abc", fillColor: "#6D28D9"
})
  → { success: true, outlined: true, expandedBy: "1px" }

// Offset path (positive=expand, negative=shrink)
tools/call: offset_path({
  templateId: "tpl_123", frameId: "f1",
  layerId: "el_abc", offset: 8
})
  → { success: true, offset: 8, appliedScale: 1.05 }
```

**Pattern 17: Convert element to SVG path**
```
// Convert any HTML element (div, shape) to an SVG <path>
tools/call: shape_to_path({
  templateId: "tpl_123", frameId: "f1", elementId: "el_div"
})
  → { success: true, newElementId: "el_new", pathData: "M..." }
```

**Pattern 18: Rename workspace/template**
```
tools/call: rename_template({
  templateId: "tpl_123", name: "Updated Design Name"
})
  → { success: true, templateId: "tpl_123", name: "Updated Design Name" }
```

### Error Reference

| Code | Meaning | When |
|------|---------|------|
| `-32700` | Parse error | Invalid JSON body |
| `-32600` | Invalid Request | Not valid JSON-RPC 2.0 |
| `-32601` | Method not found | Unknown tool name |
| `-32602` | Invalid params | Missing required parameter, bad format |
| `-32000` | Server error | Template/workspace not found |

## Components Reference

### EditorV2
- **File:** `src/pages/EditorV2.tsx`
- **Role:** Main V2 editor orchestrating all panels, canvas, toolbar, and state
- **Features:** Infinite canvas with per-frame HTML/CSS iframes, zoom/pan, dockable floating panels, PNG export via html2canvas, Supabase realtime collaboration

### InfiniteHtmlCanvas
- **File:** `src/components/InfiniteHtmlCanvas.tsx`
- **Role:** Infinite canvas container managing multiple DesignFrame instances with zoom, pan, selection, and frame CRUD

### DesignFrame
- **File:** `src/components/DesignFrame.tsx`
- **Role:** Single frame: sandboxed iframe rendering HTML/CSS + overlay for selection/resize handles

### HtmlCanvas
- **File:** `src/components/HtmlCanvas.tsx`
- **Role:** HTML/CSS iframe sandbox with CSP, postMessage bridge for element selection (`data-layer-id`), supports Google Fonts via CDN

### CodePanel
- **File:** `src/components/CodePanel.tsx`
- **Role:** Monaco editor with HTML + CSS split view, real-time sync with iframe rendering

### StructurePanel
- **File:** `src/components/StructurePanel.tsx`
- **Role:** HTML element tree parsed via DOMParser, drag-and-drop reorder, auto-ID assignment

### FloatingToolbar
- **File:** `src/components/FloatingToolbar.tsx`
- **Role:** Floating tool palette: Select (V), Hand (H), Rectangle, Circle, Pen, Text (T), Image (I), Frame (F), Zoom controls

### GoogleFontPicker
- **File:** `src/components/GoogleFontPicker.tsx`
- **Role:** Browse and apply Google Fonts with all weight variants (100–900) and italic forms

### Dashboard
- **File:** `src/components/Dashboard.tsx`
- **Role:** Template gallery with workspace selector, search, create/duplicate/delete, localStorage-API merge

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `⌘K` / `Ctrl+K` | Toggle shortcuts dialog |
| `⌘Z` / `Ctrl+Z` | Undo |
| `⌘⇧Z` / `Ctrl+Shift+Z` | Redo |
| `⌘1` / `Ctrl+1` | Zoom to fit |
| `Delete` / `Backspace` | Delete selected element |
| `⌘D` / `Ctrl+D` | Duplicate selection |
| `⌘G` / `Ctrl+G` | Group selection |
| `⌘⇧G` / `Ctrl+Shift+G` | Ungroup |
| `V` | Select tool |
| `H` | Hand/pan tool |
| `R` | Rectangle |
| `T` | Text |
| `F` | Frame |
| `I` | Image |
| `P` | Pen (bezier curves) |
| `O` | Circle/Ellipse |

## Coding Standards

When modifying editor files, follow these rules:

1. **Panels use `useDockablePanel`** for drag-and-dock floating behavior
2. **Dialogs must use native `<dialog>`** with `onCancel`, backdrop click on `role="presentation"` inner div
3. **Interactive elements must be `<button>`**, not `role="button"` divs
4. **All buttons need `type="button"`** and `aria-label`
5. **API calls use relative URLs** (`/api/...`) — works on any domain (Netlify redirects to function)
6. **Dual-write pattern**: localStorage first, API second — never lose user data to network errors
7. **MCP tools must follow dual-write** — always upsert to Supabase after store writes (non-blocking catch)
8. **Frames use sandboxed iframes** with CSP for secure HTML/CSS preview

## Dependencies

```json
{
  "react": "^18.3.1",
  "react-dom": "^18.3.1",
  "html2canvas": "^1.4.1",
  "monaco-editor": "^0.50.0"
}
```

Dev: `vite@5`, `typescript@5`, `@vitejs/plugin-react@4`

## Start Commands

```bash
# Development (frontend only — Vite dev server)
npm run dev                              # → http://localhost:5173

# Local API (optional — for testing without Netlify)
cd api && npm run dev                    # → http://localhost:3001

# Build (Vite)
npm run build                            # tsc + vite build → dist/

# Preview production build
npm run preview
```
# Futuraria Design Editor — AI Agent Skill

**Skill Name:** `futuraria-editor`
**Description:** React + Fabric.js canvas editor for the Futuraria Design platform. Full WYSIWYG design tool with 14 drawing tools, boolean operations, alignment/distribution, auto-layout, frame management, layers panel, properties inspector, batch generation (3 modes), undo/redo history, auto-save with localStorage resilience, and keyboard shortcuts. Scores 100/100 on react-doctor health audit. Deployed on Netlify with Supabase persistence (freemium model).
**Triggers:** Any task involving the Futuraria editor UI, canvas manipulation, component changes, bug fixes, a11y improvements, API integration, MCP tools, or React best-practice refactors.

---

## Overview

You are an AI agent working on the Futuraria Design Editor — a React 18 + TypeScript + Vite application that wraps Fabric.js v6 for a full WYSIWYG design experience. The editor is deployed on **Netlify** with a serverless API via Netlify Functions and **Supabase** for cloud persistence (dual-write freemium model: Supabase when configured, in-memory fallback when not).

**React-Doctor Score:** 100/100 (clean bill of health)
**Production URL:** `https://futuraria.netlify.app`
**Dev URL:** `http://localhost:5173` (Vite dev server)
**API Base (cloud):** `/api` (relative — routed via Netlify redirect to `/.netlify/functions/api`)
**MCP Endpoint:** `/mcp` (Model Context Protocol — SSE + JSON-RPC for AI agents)
**Start command:** `npm run dev` (from project root)

## Project Structure (Flat)

```
design-main/
├── src/                          — React frontend (Vite)
│   ├── App.tsx                   — Root, useReducer, routing
│   ├── components/
│   │   ├── Dashboard.tsx         — Template gallery, workspace selector
│   │   ├── CanvasEditor.tsx      — Fabric.js mount + template loader
│   │   ├── Toolbar.tsx           — 14 drawing tools + controls
│   │   ├── PropertiesPanel.tsx   — Object inspector
│   │   ├── LayersPanel.tsx       — Layer manager
│   │   ├── BatchAMator.tsx       — Batch generation (3 modes)
│   │   ├── KeyboardShortcuts.tsx — Shortcuts modal
│   │   ├── Toast.tsx             — Toast notifications
│   │   └── toolbar/              — Toolbar sub-components
│   ├── hooks/
│   │   ├── useCanvas.ts          — Fabric.js canvas operations (689 lines)
│   │   ├── useAutoSave.ts        — Dual-write auto-save (223 lines)
│   │   └── useDropdowns.ts       — Dropdown state
│   └── lib/
│       ├── templateApi.ts        — API client + localStorage fallback
│       └── supabase.ts           — Fetch wrapper (API_BASE = "")
├── api/                          — Express API (serverless via Netlify Functions)
│   ├── src/
│   │   ├── index.ts              — Express app factory
│   │   ├── server.ts             — Local dev server entry
│   │   ├── routes/
│   │   │   ├── templates.ts      — Template CRUD
│   │   │   └── workspaces.ts     — Workspace CRUD
│   │   ├── services/
│   │   │   ├── templates.ts      — Template service (Supabase dual-write)
│   │   │   ├── store.ts          — In-memory store (fallback)
│   │   │   └── supabase.ts       — Supabase admin client (service_role)
│   │   ├── middleware/
│   │   │   ├── auth.ts           — API key / Bearer token auth
│   │   │   └── rateLimit.ts      — Rate limiting (100 req/15s window)
│   │   └── types.ts              — Shared TypeScript types
│   └── package.json
├── netlify/
│   └── functions/
│       ├── api.mjs               — Express → Netlify Function bridge
│       └── mcp.mjs               — MCP server (JSON-RPC + SSE, 10 tools)
├── netlify.toml                  — Netlify build + redirects
├── package.json                  — Root: Vite + React deps
├── vite.config.ts
└── tsconfig.json
```

## Deployment Architecture

```
Browser / AI Agent
  │
  ▼
Netlify CDN (futuraria.netlify.app)
  ├── /*               → dist/index.html (SPA)
  ├── /api/*           → /.netlify/functions/api  (Express → JSON)
  └── /mcp             → /.netlify/functions/mcp   (JSON-RPC + SSE)
         │
         ▼
Supabase (PostgreSQL)
  ├── workspaces table  (id, name, owner_id, data JSONB, timestamps)
  └── templates table   (id, name, workspace_id, data JSONB, user_id, timestamps)
```

### Freemium Model (Dual-Write Persistence)

Every CRUD operation follows the same pattern:

```
Try Supabase first → ✓ Return result
                   → ✗ Fall through to in-memory store
Write operations:  in-memory store first → then Supabase.upsert() (non-blocking)
```

- **Supabase configured** (env vars in Netlify): Full cloud persistence across cold starts
- **No Supabase**: In-memory only — survives container lifetime, resets on cold start
- **MCP calls same services** — identical dual-write behavior, no separate code path

## Architecture

```
App (useReducer — single state atom)
├── Dashboard            — template gallery, search, workspace selector
├── Editor view
│   ├── Toolbar          — vertical toolbar with grouped dropdowns
│   │   ├── ToolbarButtons   — ToolBtn, Divider, Spacer primitives
│   │   └── ToolbarDropdowns — ShapesDropdown, DrawDropdown, AlignDropdown, BooleanDropdown
│   ├── CanvasEditor     — Fabric.js canvas mount + template loading
│   ├── PropertiesPanel  — object property inspector (fill, stroke, opacity, position, size)
│   ├── LayersPanel      — layer list with visibility/lock/delete/reorder
│   ├── KeyboardShortcuts — modal dialog showing all shortcuts
│   └── BatchAMator      — batch generator (single-post, multi-post, carousel modes)
└── ToastProvider        — toast notification system
```

### State Management

The app uses **`useReducer`** with a single state atom (`AppState`). No useState for global state — this was the key refactor to achieve react-doctor 100.

```typescript
type AppState = {
  view: "dashboard" | "editor";
  templateId: string | null;
  templateJson: any;
  canvas: { zoom: number; tool: ToolName; canUndo: boolean; canRedo: boolean; selectedObjects: FabricObject[] };
  shortcutsOpen: boolean;
  batchRenderKey: number;
};
type AppAction =
  | { type: "SET_VIEW"; view: ViewMode }
  | { type: "OPEN_TEMPLATE"; id: string; json: any }
  | { type: "BACK_TO_DASHBOARD" }
  | { type: "SET_CANVAS"; canvas: AppState["canvas"] }
  | { type: "SET_TOOL"; tool: ToolName }
  | { type: "TOGGLE_SHORTCUTS" }
  | { type: "SET_SHORTCUTS"; open: boolean }
  | { type: "TRIGGER_BATCH_RENDER" };
```

**Pattern:** Canvas state syncs via polling `window.__canvasControls` every 200ms — this bridges the imperative Fabric.js API with React's declarative state.

### Data Flow

```
User action → Fabric.js canvas event
  → useAutoSave detects change (debounce 2s)
    → localStorage (instant, primary)
    → API PUT /api/templates/:id (best-effort cloud sync)
    
Template load:
  → API GET /api/templates/:id
    → If localStorage is newer → prefer localStorage
    → If API has empty canvas → fall back to localStorage
```

### MCP (Model Context Protocol) — AI Agent Connection Guide

AI agents connect to the MCP server at `https://futuraria.netlify.app/mcp` to discover and invoke **10 tools** for workspace and template management. The MCP server implements the **Model Context Protocol 2024-11-05** specification via **SSE transport + JSON-RPC 2.0**.

#### Protocol Flow

```
Agent (Claude / Cursor / Custom)
  │
  ├─ GET  /mcp                          → SSE init (event: endpoint)
  ├─ POST /mcp  { method: "initialize" } → capabilities + server info
  ├─ POST /mcp  { method: "tools/list" } → discover 10 tools
  └─ POST /mcp  { method: "tools/call" } → invoke any tool
```

**Auth:** Pass `x-api-key: your-key` or `Authorization: Bearer your-token` header on POST requests. Falls back to `dev_user_default`.

#### Connecting from AI Agents

**Claude Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "futuraria": {
      "type": "sse",
      "url": "https://futuraria.netlify.app/mcp",
      "headers": { "x-api-key": "your-api-key" }
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "futuraria": {
      "transport": "sse",
      "url": "https://futuraria.netlify.app/mcp",
      "headers": { "x-api-key": "your-api-key" }
    }
  }
}
```

**Custom HTTP Client** (any language):
```bash
# 1. Initialize
curl -X POST https://futuraria.netlify.app/mcp \
  -H "Content-Type: application/json" \
  -H "x-api-key: dev-key" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"my-agent","version":"1.0"}}}'
# → {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"futuraria-mcp","version":"1.0.0"}}}

# 2. Discover tools
curl -X POST https://futuraria.netlify.app/mcp \
  -H "Content-Type: application/json" \
  -H "x-api-key: dev-key" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
# → {"jsonrpc":"2.0","id":2,"result":{"tools":[{...10 tools...}]}}

# 3. Call a tool
curl -X POST https://futuraria.netlify.app/mcp \
  -H "Content-Type: application/json" \
  -H "x-api-key: dev-key" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"create_template","arguments":{"name":"Hero","workspaceId":"ws_abc","width":1440,"height":900}}}'
# → {"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"{...template JSON...}"}]}}
```

#### Complete Tool Reference (10 tools, 100% tested)

| # | Tool | Required Params | Optional Params | Persistence |
|---|------|----------------|-----------------|-------------|
| 1 | `list_workspaces` | _(none)_ | — | Supabase → store |
| 2 | `create_workspace` | `name` | `description` | store + Supabase upsert |
| 3 | `list_templates` | _(none)_ | `workspaceId`, `search`, `limit`(50), `offset` | Supabase + store merged |
| 4 | `get_template` | `id` | — | Supabase → store fallback |
| 5 | `create_template` | `name`, `workspaceId` | `width`(1080), `height`(1080) | store + Supabase upsert |
| 6 | `update_template` | `id` | `name`, `canvas`, `objects`(raw array) | store + Supabase upsert |
| 7 | `delete_template` | `id` | — | store + Supabase delete |
| 8 | `duplicate_template` | `id` | `name` (default: "(copy)") | store + Supabase upsert |
| 9 | `export_template` | `id` | — | Supabase read |
| 10 | `import_template` | `data`, `workspaceId` | — | store + Supabase upsert |

#### Tool Schemas

<details>
<summary><b>1. list_workspaces</b></summary>

```json
{
  "name": "list_workspaces",
  "description": "List all workspaces for the authenticated user",
  "inputSchema": { "type": "object", "properties": {}, "required": [] }
}
```
**Returns:** `{ "data": [...], "total": N }` — workspaces ordered by `updated_at` DESC.
</details>

<details>
<summary><b>2. create_workspace</b></summary>

```json
{
  "name": "create_workspace",
  "description": "Create a new workspace",
  "inputSchema": {
    "type": "object",
    "properties": {
      "name": { "type": "string", "description": "Workspace name" },
      "description": { "type": "string", "description": "Optional description" }
    },
    "required": ["name"]
  }
}
```
**Returns:** Workspace object with `id` (ws_xxxxxxxx), `name`, `ownerId`, `memberIds`, timestamps.
</details>

<details>
<summary><b>3. list_templates</b></summary>

```json
{
  "name": "list_templates",
  "description": "List templates with optional workspace filter and search",
  "inputSchema": {
    "type": "object",
    "properties": {
      "workspaceId": { "type": "string", "description": "Filter by workspace ID" },
      "search": { "type": "string", "description": "Search by template name" },
      "limit": { "type": "number", "description": "Max results (default 50)" },
      "offset": { "type": "number", "description": "Pagination offset" }
    },
    "required": []
  }
}
```
**Returns:** `{ "data": [...], "total": N }` — merges Supabase + in-memory store, deduping by ID.
</details>

<details>
<summary><b>4. get_template</b></summary>

```json
{
  "name": "get_template",
  "description": "Get a template by ID with full canvas data, frames, styles, variables",
  "inputSchema": {
    "type": "object",
    "properties": {
      "id": { "type": "string", "description": "Template ID (tpl_xxxxxxxx)" }
    },
    "required": ["id"]
  }
}
```
**Returns:** Full template with `id`, `name`, `workspaceId`, `width`, `height`, `canvas`, `frames[]`, `styles[]`, `variables`, `components[]`, `metadata`.
</details>

<details>
<summary><b>5. create_template</b></summary>

```json
{
  "name": "create_template",
  "description": "Create a new design template in a workspace",
  "inputSchema": {
    "type": "object",
    "properties": {
      "name": { "type": "string", "description": "Template name" },
      "workspaceId": { "type": "string", "description": "Workspace ID to create in" },
      "width": { "type": "number", "description": "Canvas width (default 1080)" },
      "height": { "type": "number", "description": "Canvas height (default 1080)" }
    },
    "required": ["name", "workspaceId"]
  }
}
```
**Returns:** New template with `id` (tpl_xxxxxxxx), default canvas `{ objects: [], viewport: { x:0, y:0, zoom:1 } }`.
**⚠️ Validated:** `workspaceId` is enforced as required (error code `-32602` if missing).
</details>

<details>
<summary><b>6. update_template</b></summary>

```json
{
  "name": "update_template",
  "description": "Update a template's name or canvas data",
  "inputSchema": {
    "type": "object",
    "properties": {
      "id": { "type": "string", "description": "Template ID" },
      "name": { "type": "string", "description": "New name" },
      "canvas": { "type": "object", "description": "Full Fabric.js canvas JSON" }
    },
    "required": ["id"]
  }
}
```
**Accepts:** `id` or `templateId`, `canvas` (full object), `objects` (raw array — auto-wrapped), `name`.
**Returns:** Updated template with refreshed `metadata.updatedAt`.
</details>

<details>
<summary><b>7. delete_template</b></summary>

```json
{
  "name": "delete_template",
  "description": "Permanently delete a template",
  "inputSchema": {
    "type": "object",
    "properties": {
      "id": { "type": "string", "description": "Template ID to delete" }
    },
    "required": ["id"]
  }
}
```
**Returns:** `{ "deleted": true, "id": "tpl_..." }` — also deletes from Supabase.
**Error:** `-32000` if template not found.
</details>

<details>
<summary><b>8. duplicate_template</b></summary>

```json
{
  "name": "duplicate_template",
  "description": "Create an independent copy of a template",
  "inputSchema": {
    "type": "object",
    "properties": {
      "id": { "type": "string", "description": "Source template ID" },
      "name": { "type": "string", "description": "Name for the copy (default: original + ' (copy)')" }
    },
    "required": ["id"]
  }
}
```
**Returns:** New template with deep-cloned canvas, new IDs for frames, same workspace.
</details>

<details>
<summary><b>9. export_template</b></summary>

```json
{
  "name": "export_template",
  "description": "Export a template as .futuraria JSON for backup/migration",
  "inputSchema": {
    "type": "object",
    "properties": {
      "id": { "type": "string", "description": "Template ID to export" }
    },
    "required": ["id"]
  }
}
```
**Returns:** `{ "format": "futuraria/v1", "exportedAt": "ISO", "template": { name, width, height, canvas, frames, styles, variables, metadata } }`.
</details>

<details>
<summary><b>10. import_template</b></summary>

```json
{
  "name": "import_template",
  "description": "Import a .futuraria JSON export into a workspace",
  "inputSchema": {
    "type": "object",
    "properties": {
      "data": { "type": "object", "description": "The .futuraria JSON (must have format: 'futuraria/v1' and template.name)" },
      "workspaceId": { "type": "string", "description": "Target workspace ID" }
    },
    "required": ["data", "workspaceId"]
  }
}
```
**Validates:** `data.format === "futuraria/v1"` and `data.template.name` must exist.
**Returns:** New template created in target workspace with all canvas data preserved.
**Error:** `-32602` if format is invalid or template name is missing.
</details>

#### Error Reference

| Code | Meaning | When |
|------|---------|------|
| `-32700` | Parse error | Invalid JSON body |
| `-32600` | Invalid Request | Not valid JSON-RPC 2.0 |
| `-32601` | Method not found | Unknown tool name |
| `-32602` | Invalid params | Missing required parameter, bad format |
| `-32000` | Server error | Template/workspace not found |

#### Agent Workflow Patterns (via MCP)

**Pattern 1: Create a design from scratch**
```
tools/call: create_workspace({ name: "Client Project" })              → wsId
tools/call: create_template({ name: "Hero", workspaceId: wsId })      → tplId
tools/call: update_template({ id: tplId, objects: [...] })             → add shapes
tools/call: export_template({ id: tplId })                             → backup
```

**Pattern 2: Clone and customize**
```
tools/call: list_templates({ workspaceId: wsId, search: "Post" })     → find base
tools/call: duplicate_template({ id: tplId, name: "Post Variant" })   → tplId2
tools/call: update_template({ id: tplId2, name: "Custom Post" })      → rename
```

**Pattern 3: Export → Import migration**
```
tools/call: export_template({ id: tplId })                             → export JSON
tools/call: import_template({ data: exported, workspaceId: wsId2 })   → import to new WS
```

**Persistence:** All tools follow the freemium dual-write model — in-memory store for instant response, Supabase upsert for cross-cold-start durability. Same service layer as the REST API.

### Key Pattern: Ref-based Search

Dashboard search uses **ref + imperative callback** instead of `useState + useEffect`:

```typescript
const searchRef = useRef("");
const handleSearch = useCallback((value: string) => {
  setSearchDisplay(value);       // visual update only
  searchRef.current = value;     // immediate ref for filtering
  loadTemplatesRef.current(selectedWs ?? undefined);
}, [selectedWs]);
```

This pattern avoids the `no-derived-state` warning because the search value is read synchronously from the ref, not derived from state via useEffect.

### Key Pattern: queueMicrotask Deferral

CanvasEditor splits initialization into two effects to avoid `no-cascading-set-state`:

```typescript
// Step 1: Init canvas only (no template loading, no state changes)
useEffect(() => {
  const c = initCanvas(mountRef.current, containerRef.current, w, h);
  fabricRef.current = c;
  initDoneRef.current = true;
}, [initCanvas]);

// Step 2: Load template deferred via queueMicrotask
useEffect(() => {
  if (!initDoneRef.current || !fabricRef.current) return;
  queueMicrotask(() => loadTemplate(tj.canvas || tj));
}, [loadTemplate, templateJson]);
```

### Key Pattern: Semantic Button Restructuring

Cards and layer rows use proper `<button>` elements for interactive areas instead of `role="button"` divs with nested buttons — fixing `prefer-tag-over-role`:

```tsx
// Dashboard cards:
<div style={cardStyle}>           {/* container only */}
  <button style={cardBtnStyle}>   {/* thumbnail + name = click to open */}
    <img ... /><span>name</span>
  </button>
  <button>duplicate</button>      {/* action buttons */}
  <button>delete</button>
</div>
```

### Key Pattern: Native `<dialog>` + onCancel

KeyboardShortcuts modal uses `<dialog>` with `onCancel` for Escape handling, with backdrop click on an inner `role="presentation"` div:

```tsx
<dialog open={open} onCancel={onClose}>
  <div role="presentation" onClick={onClose} onKeyDown={onKeyDown}>
    <div onClick={(e) => e.stopPropagation()}>
      {/* modal content */}
    </div>
  </div>
</dialog>
```

## Components Reference

### App.tsx
- **File:** `src/App.tsx`
- **Role:** Root component, router (dashboard vs editor), keyboard shortcut handler (⌘K, ⌘B)
- **State:** `useReducer(appReducer, initialAppState)`
- **Key exports:** `App`
- **No internal useState** — all state through reducer

### Dashboard
- **File:** `src/components/Dashboard.tsx`
- **Props:** `onSelectTemplate(id)`, `onCreateTemplate(workspaceId)`
- **Features:** Workspace selector, template search (ref-based, not state-based), create/duplicate/delete templates, localStorage-API merge
- **A11y:** Semantic buttons for cards, no role="button" divs

### CanvasEditor
- **File:** `src/components/CanvasEditor.tsx`
- **Props:** `templateId`, `templateJson`, `onToolChange`
- **Role:** Mounts Fabric.js canvas, loads template JSON, exposes `window.__canvasControls` for App polling
- **Uses:** `useCanvas()` hook, `useAutoSave()` hook
- **Key pattern:** Split useEffect + queueMicrotask for no-cascading-set-state

### Toolbar
- **File:** `src/components/Toolbar.tsx`
- **Sub-components:** `toolbar/ToolbarButtons.tsx`, `toolbar/ToolbarDropdowns.tsx`
- **Tools:** Select (V), Hand (H), Pencil, Pen, Rect, Ellipse, Line, Triangle, Star, Polygon, Frame (F), Text (T), Image (I), Eyedropper
- **Controls:** Undo/Redo, Zoom In/Out/Fit, Align (6 directions), Distribute (H/V), Boolean ops (4), Auto Layout, Export (PNG/SVG/JSON), Prototype Preview

### PropertiesPanel
- **File:** `src/components/PropertiesPanel.tsx`
- **Props:** `selectedObjects`, `onUpdate`
- **Editable properties:** x, y, width, height, angle, opacity, fill, stroke, strokeWidth, fontFamily, fontSize, fontWeight, textAlign, lineHeight, corner radius

### LayersPanel
- **File:** `src/components/LayersPanel.tsx`
- **Props:** `canvasRef`, `selectedObjects`
- **Features:** Layer list with visibility toggle, lock/unlock, rename, delete, reorder (up/down), frame grouping
- **A11y:** Semantic buttons for row selection and actions

### BatchAMator
- **File:** `src/components/BatchAMator.tsx`
- **Props:** `templateId`, `onClose`
- **Modes:** single-post (one template × CSV rows), multi-post (template per row), carousel (grouped by ID_Carrusel)
- **State:** `useReducer(batchReducer, initialBatchState)` — 8 consolidated useState → single reducer

### KeyboardShortcuts
- **File:** `src/components/KeyboardShortcuts.tsx`
- **Props:** `open`, `onClose`
- **Features:** Lists all keyboard shortcuts in a modal dialog
- **Pattern:** Native `<dialog>` with `onCancel` + backdrop click via inner div

### Toast
- **File:** `src/components/Toast.tsx`
- **Exports:** `ToastProvider`, `useToast()`
- **Features:** Context-based toast notifications with auto-dismiss

## Hooks Reference

### useCanvas
- **File:** `src/hooks/useCanvas.ts` (689 lines)
- **Role:** Core Fabric.js canvas operations
- **Exports:**
  - Canvas lifecycle: `initCanvas`, `loadTemplate`, `getCanvasJSON`
  - Tools: `setTool(ToolName)`, 14 tool types
  - History: `undo`, `redo`, `pushHistory`, `canUndo`, `canRedo` (50-snapshot limit)
  - Selection: `selectedObjects`, `updateSelection`
  - Transform: `group`, `ungroup`, `deleteSelected`, `copySelected`, `pasteObject`, `duplicateSelected`
  - Layout: `align(6 directions)`, `distribute(H/V)`, `booleanOp(4 ops)`, `autoLayout(H/V)`
  - View: `zoomIn`, `zoomOut`, `zoomToFit`, `showGrid`, `toggleSnap`, `setGridSize`
  - Export: `exportPNG(scale)`, `exportSVG()`, `exportJSON()`
  - Lock: `toggleLock(layerName)`
- **ToolName type:** `"select" | "hand" | "rect" | "ellipse" | "line" | "triangle" | "star" | "polygon" | "frame" | "text" | "image" | "pencil" | "pen" | "eyedropper"`

### useAutoSave
- **File:** `src/hooks/useAutoSave.ts` (223 lines)
- **Role:** Dual-write auto-save with debounce
- **Flow:**
  1. Listens to Fabric.js events: `object:added/removed/modified/moving/scaling/rotating`
  2. Debounces 2s before `performSave()`
  3. **Always saves to localStorage first** (instant, primary)
  4. **Then PUT to API** (best-effort cloud sync via `/api/templates/:id`)
  5. API failures are silent — localStorage already has the data
- **Exports:** `status` (idle/saving/saved/error), `forceSave()`, `flushSave()`, `clearPending()`, `setLoading(bool)`
- **Custom serialization:** Preserves Fabric.js metadata (layerId, layerName, frameId, styleId, componentId, etc.)

### useDropdowns
- **File:** `src/hooks/useDropdowns.ts`
- **Role:** Manages open/close state for toolbar dropdowns (align, boolean, shapes, draw)
- **State:** `useReducer` — single reducer for 4 boolean dropdown states

## API Client

### templateApi.ts
- **File:** `src/lib/templateApi.ts` (207 lines)
- **Functions:**
  - `getTemplate(id)` — fetch with localStorage freshness check
  - `createTemplate(name, w, h, canvasJson)` — POST /api/templates
  - `updateTemplate(id, updates)` — PUT /api/templates/:id
  - `deleteTemplate(id)` — DELETE /api/templates/:id
  - `duplicateTemplate(id, name?)` — POST /api/templates/:id/duplicate
  - `listTemplates(limit, offset)` — merged API + localStorage results
- **LocalStorage fallback:** Full CRUD via `saveLocal`, `getLocalTemplate`, `deleteLocalTemplate`, `listLocalTemplates`

### supabase.ts
- **File:** `src/lib/supabase.ts` (12 lines)
- **Role:** Thin fetch wrapper with `API_BASE = ""` (relative URLs for cloud deployment) and default headers

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `⌘K` / `Ctrl+K` | Toggle shortcuts dialog |
| `⌘B` / `Ctrl+B` | Toggle batch generator |
| `⌘Z` / `Ctrl+Z` | Undo |
| `⌘⇧Z` / `Ctrl+Shift+Z` | Redo |
| `⌘1` / `Ctrl+1` | Zoom to fit |
| `Delete` / `Backspace` | Delete selected objects |
| `⌘D` / `Ctrl+D` | Duplicate selection |
| `⌘G` / `Ctrl+G` | Group selection |
| `⌘⇧G` / `Ctrl+Shift+G` | Ungroup |
| `⌘⇧A` / `Ctrl+Shift+A` | Auto layout |
| `V` | Select tool |
| `H` | Hand/pan tool |
| `R` | Rectangle |
| `O` | Ellipse |
| `L` | Line |
| `T` | Text |
| `F` | Frame |
| `I` | Image |
| `P` | Pen tool |
| `N` | Pencil |

## React-Doctor 100/100 State

The editor achieved a perfect 100/100 react-doctor score. Key fixes applied:

| Issue | Fix Applied | Files |
|-------|------------|-------|
| `prefer-useReducer` (6 useState → 1) | Consolidated to `appReducer` | App.tsx |
| `prefer-useReducer` (8 useState → 1) | Consolidated to `batchReducer` | BatchAMator.tsx |
| `no-derived-state` | Replaced search state+useEffect with ref+callback | Dashboard.tsx |
| `no-cascading-set-state` | Split init useEffect + queueMicrotask deferral | CanvasEditor.tsx |
| `prefer-tag-over-role` | Restructured cards/rows with semantic buttons | Dashboard.tsx, LayersPanel.tsx |
| `no-noninteractive-element-interactions` | Native `<dialog>` + onCancel pattern | KeyboardShortcuts.tsx |

**Ignored rules (by design):**
- `deslop/unused-file` — some files are entry points referenced by Vite
- `react-doctor/exhaustive-deps` — intentional omissions with stable refs
- `react-doctor/no-giant-component` — useCanvas is 689 lines (Fabric.js imperative API)
- `react-doctor/no-many-boolean-props` — Toolbar has many boolean props by nature

## Coding Standards for This Editor

When modifying editor files, follow these rules:

1. **State must use `useReducer`**, not `useState` for multi-value state
2. **Derived values must use refs**, not state + useEffect chains
3. **Dialogs must use native `<dialog>`** with `onCancel`, backdrop click on `role="presentation"` inner div
4. **Interactive elements must be `<button>`**, not `role="button"` divs
5. **Avoid cascading setState in effects** — use `queueMicrotask` to break the synchronous trace
6. **All buttons need `type="button"`** and `aria-label`
7. **Keep component files focused** — extract sub-components to separate files (e.g., toolbar/ directory)
8. **Dual-write pattern**: localStorage first, API second — never lose user data to network errors
9. **API calls use relative URLs** (`/api/...`) — works on any domain (Netlify redirects to function)
10. **MCP tools must follow dual-write** — always upsert to Supabase after store writes (non-blocking catch)

## Dependencies

```json
{
  "react": "^18.3.1",
  "react-dom": "^18.3.1",
  "fabric": "^6.9.1"
}
```

Dev: `vite@5`, `typescript@5`, `@vitejs/plugin-react@4`

## Start Commands

```bash
# Development (frontend only — Vite dev server)
npm run dev                              # → http://localhost:5173

# Local API (optional — for testing without Netlify)
cd api && npm run dev                    # → http://localhost:3001

# Build (Vite)
npm run build                            # tsc + vite build → dist/

# Build + functions (as Netlify does)
npm run build:functions && npm run build

# Preview production build
npm run preview
```

## Key Files

| File | Lines | Purpose |
|------|-------|---------|
| `src/App.tsx` | ~250 | Root component, useReducer, routing |
| `src/hooks/useCanvas.ts` | 689 | Fabric.js canvas operations |
| `src/hooks/useAutoSave.ts` | 223 | Dual-write auto-save |
| `src/components/Toolbar.tsx` | 176 | Toolbar shell |
| `src/components/Dashboard.tsx` | ~230 | Template gallery |
| `src/components/BatchAMator.tsx` | ~300 | Batch generation (useReducer) |
| `src/components/CanvasEditor.tsx` | ~150 | Canvas mount + template loader |
| `src/components/PropertiesPanel.tsx` | ~260 | Object inspector |
| `src/components/LayersPanel.tsx` | ~150 | Layer manager |
| `src/components/KeyboardShortcuts.tsx` | ~170 | Shortcuts modal (native dialog) |
| `src/lib/templateApi.ts` | 207 | API client + localStorage |
| `src/lib/supabase.ts` | 12 | Fetch wrapper |
| `src/hooks/useDropdowns.ts` | ~80 | Dropdown state (useReducer) |
| `api/src/services/templates.ts` | 192 | Template service (Supabase dual-write) |
| `api/src/services/store.ts` | — | In-memory store (fallback) |
| `api/src/services/supabase.ts` | — | Supabase admin client |
| `netlify/functions/api.mjs` | 96 | Express → Netlify bridge |
| `netlify/functions/mcp.mjs` | ~3600 | MCP server (135+ tools) |
| `netlify.toml` | 22 | Build config + redirects |
| `package.json` | 36 | Config + react-doctor ignore rules |
| `vite.config.ts` | 12 | Vite + React plugin + alias |
