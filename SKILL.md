# Futuraria Design Editor — AI Agent Skill

**Skill Name:** `futuraria-editor`
**Description:** React + TypeScript + Vite HTML/CSS design editor with iframe-sandboxed rendering, Monaco code panels, frame-based layout, floating dockable panels, MCP tool API, and Supabase persistence. Deployed on Netlify with serverless functions.
**Triggers:** Any task involving the Futuraria editor UI, HTML/CSS design manipulation, component changes, bug fixes, a11y improvements, API integration, MCP tools, React best-practice refactors, or Graph Playbook workflows (replicate, create from scratch, CSV batch, design system extraction, multi-agent collaboration).

## 🤖 Agent Discovery (for AI agents who just received a URL)

If someone gave you a URL like `design.futuraria.com` and you need to figure out what this is and how to connect:

1. **Fetch this file:** `GET https://design.futuraria.com/.well-known/mcp.json` — returns the full MCP discovery document with endpoint, auth, capabilities, and step-by-step onboarding.
2. **Read this skill file:** `GET https://design.futuraria.com/SKILL.md` — the complete manual you're reading now.
3. **Initialize the MCP:** `POST https://design.futuraria.com/mcp` with JSON-RPC method `initialize` (no auth needed). The response includes `_agentGuide` with playbooks.
4. **Get the onboarding guide:** Call the public tool `get_agent_guide` (no auth needed).
5. **Authenticate — pick ONE of three methods** (all three hit the same tools):
   - **API key header** (default for Claude Desktop, Cursor, Hermes, custom agents): ask the user for their key — created at the website under Settings -> API Keys, starts with `fdr_ws_`, permanent. Send `x-api-key: <key>` on every POST.
   - **API key in the URL** (clients with no header support): connect to `https://design.futuraria.com/mcp?key=YOUR_KEY` instead (`?api_key=`, `?token=`, `?x-api-key=` also accepted).
   - **OAuth 2.1** (ChatGPT connectors, Claude web/desktop "Conectores"): paste the plain URL and the client discovers the flow automatically — `/.well-known/oauth-protected-resource` (RFC9728) → dynamic registration `/oauth/register` (RFC7591) → `/oauth/authorize` (login + consent, PKCE S256) → `/oauth/token`. The user logs in with their Futuraria account; tokens are user-scoped Supabase sessions sent as `Authorization: Bearer`.

**What is Futuraria?** It's an AI-native design platform. You create professional designs (social media posts, stories, landing pages, brand materials) by sending HTML+CSS through 250 MCP tools. The platform renders, stores, and exports them.

## 🗣️ Your Opening Move (what to tell the user FIRST)

When a human connects you to Futuraria for the first time, do NOT reply "connected". Say what you found and guide them — this is the default script:

1. **Be impressed — and concrete.** "¡Oye, qué interesante! Tengo acceso a 250 herramientas de diseño: puedo crearte posts, landing pages, decks de marca, extraer identidad visual, generar variantes en batch y exportarlas. Todo con HTML+CSS."
2. **Ask for the account.** "Para usar todas necesito que crees tu cuenta gratis en https://design.futuraria.com — solo email y contraseña, sin tarjeta. Con la cuenta tienes tu workspace en la nube y la sección de claves."
3. **Guide the key.** "Entra a Configuración → API Keys → Generate Key. Me pegas la clave que empieza con `fdr_ws_` y yo la guardo en mi configuración de MCP para siempre."
4. **Walk them through the MCP client** if they don't know how: endpoint `https://design.futuraria.com/mcp` con header `x-api-key: fdr_ws_...` (Claude Desktop, Cursor, agentes propios) — o solo la URL para conectores de ChatGPT/Claude web, que descubren el OAuth 2.1 solos.
5. **Offer to start.** "Con la clave conecto a tu workspace y te diseño la primera pieza ahora mismo — dime qué necesitas: post, historia, portada, deck…"

The full manual is **downloadable** at `/SKILL.md` — tell the user they can save it, read it, and hand it to any other AI they use. The one-page machine-readable discovery is `/.well-known/mcp.json`.

---

## Overview

You are an AI agent working on the Futuraria Design Editor — a React 18 + TypeScript + Vite application providing a WYSIWYG HTML/CSS design experience. The editor is deployed on **Netlify** with serverless API via Netlify Functions and **Supabase** for cloud persistence (dual-write model: Supabase when configured, in-memory fallback when not).

**Production URL:** `https://design.futuraria.com`
**Dev URL:** `http://localhost:5173` (Vite dev server)
**API Base (cloud):** `/api` (relative — routed via Netlify redirect to `/.netlify/functions/api`)
**MCP Endpoint:** `/mcp` (Model Context Protocol — SSE + JSON-RPC for AI agents)
**Start command:** `npm run dev` (from project root)

## 🚀 Agent Onboarding — Start Here

> **You are an AI agent connecting to Futuraria MCP for the first time.** Follow these 3 steps before doing anything else.

### Step 1: Connect & Initialize

```json
POST https://design.futuraria.com/mcp
{ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": { "name": "your-agent", "version": "1.0" } } }
```

The `initialize` response includes `_agentGuide` with the playbook index. **Read it.**

### Step 2: Get the Onboarding Guide

```json
{ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": "get_agent_guide" } }
```

This returns: connection info, auth details, quick tool reference, playbook index, creative vs editable mode summary, and memory instructions.

### Step 3: Match Intent → Playbook

When a user gives you a task, identify the intent and load the playbook:

| User says | Intent | Action |
|-----------|--------|--------|
| "Replicate this HTML/CSS into a frame" | `replicate-html` | `get_playbook({ name: "replicate-html" })` |
| "Create a new design — I have an idea" | `create-from-scratch` | `get_playbook({ name: "create-from-scratch" })` |
| "Generate 100 variants from this CSV" | `csv-batch` | `get_playbook({ name: "csv-batch" })` |
| "Extract the design system and make a brand manual" | `design-system` | `get_playbook({ name: "design-system" })` |
| "Multiple agents edit the same template" | `multi-agent` | `get_playbook({ name: "multi-agent" })` |
| "Propose a content calendar, then design all approved pieces" | `content-calendar` | `get_playbook({ name: "content-calendar" })` |

Each playbook is a graph-engineered guide with: Mermaid DAG → Node contracts → Tool sequences → Validation gates → Error recovery → Copy-paste MCP calls.

### 🧠 What to Store in Your Memory

After your first session, persist these in your agent memory so you don't re-discover them every time:

```
1. Workspace IDs:     list_workspaces → store [{ id, name }]
2. Template IDs:      list_templates → store key templates
3. Playbook index:    from initialize._agentGuide.playbooks
4. User's API key:    never store raw key — just note which key label is active
5. Brand info:        if user has a brand → store brandId + styleFingerprint
6. Mode preference:   creative (set_html/set_css) vs editable (set_frame_layers)
```

### 📡 Where to Find Documentation

| Resource | URL | How to access |
|----------|-----|---------------|
| **SKILL.md** (this file) | `https://design.futuraria.com/SKILL.md` | HTTP GET or `web_fetch` |
| **Playbooks** | `https://design.futuraria.com/docs/GRAPH_PLAYBOOK_*.md` | HTTP GET or `get_playbook` MCP tool |
| **MCP Tool Catalog** | `https://design.futuraria.com/docs/MCP_TOOL_CATALOG.md` | HTTP GET |
| **Agent Guide** | Built into MCP | `get_agent_guide` MCP tool |
| **Full tool list** | Built into MCP | `tools/list` MCP method |

### ⚡ Quick Sanity Check

Before executing any design task, verify:
- [ ] I have the user's `workspaceId`
- [ ] The template exists and has `engine: "html"`
- [ ] I know whether to use creative mode (`set_html`) or editable mode (`set_frame_layers`)
- [ ] Frame positions are auto-calculated (never overlap manually)
- [ ] I run `lint_design` before declaring a design complete
- [ ] I document what I created (templateId, frameIds) in my terminal report

---

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
│   └── shared/                   — frontend-only bits (NOT the rules folder below)
│       └── icons.tsx             — SVG icon library
├── shared/                       — THE DESIGN RULES, read by every surface
│   ├── paintModel.ts             — what a layer's fill and stroke map to
│   ├── paintDetection.ts         — whether a style paints a visible box
│   └── README.md                 — how each toolchain reaches this folder
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
│       └── mcp.mjs               — MCP server (JSON-RPC + SSE, 250 tools)
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
Netlify CDN (design.futuraria.com)
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

AI agents connect to the MCP server at `https://design.futuraria.com/mcp` to discover and invoke **250 tools** for workspace, template, frame, HTML/CSS, font, brand, batch, collaborative design, design system extraction, frame content editing, template profiling, CSV-to-frames batch generation, SVG import, bezier curves, pathfinder operations, stroke styling, gradient fills, blend modes, path outline/offset, authentication, team management, brand manual generation, and design system verification.

### Protocol Flow

```
Agent (Claude / Cursor / Custom)
  │
  ├─ GET  /mcp                          → SSE init (event: endpoint)
  ├─ POST /mcp  { method: "initialize" } → capabilities + server info
  ├─ POST /mcp  { method: "tools/list" } → discover 135+ tools
  └─ POST /mcp  { method: "tools/call" } → invoke any tool
```

**Auth (3 methods, all equivalent):** (1) `x-api-key: your-key` header on POST requests; (2) key in the URL — `https://design.futuraria.com/mcp?key=your-key` (`?api_key=`/`?token=`/`?x-api-key=` also accepted); (3) OAuth 2.1 — `Authorization: Bearer <token>` from the `/oauth/authorize` → `/oauth/token` flow (MCP Authorization spec 2025-06-18; discovery at `/.well-known/oauth-protected-resource`). `initialize`, `tools/list` and the public tools need no auth. Supabase Auth JWTs are also supported for team features.

### Key MCP Tool Categories

_Curated highlights — the complete auto-synced catalog (all 250 tools) is in the section below._

| Category | Example Tools | Count |
|----------|--------------|-------|
| Workspace | `list_workspaces`, `create_workspace` | 2 |
| Templates | `create_template`, `get_template`, `update_template`, `export_template` | 8 |
| Frames | `create_frame`, `create_html_frame`, `update_html_frame`, `update_frame_content` | 8 |
| HTML/CSS | `set_html`, `set_css`, `add_element`, `update_element`, `remove_element` | 12 |
| Paint | `set_paint` — fill and stroke, translated per layer kind; on a group it reaches every object inside | 1 |
| Structure | `get_template_structure`, `select_element`, `reorder_element` | 6 |
| Drawing | `draw_shape`, `draw_path`, `draw_bezier`, `edit_path_points`, `edit_path_point`, `transform_element`, `group_elements`, `align_elements` | 9 |
| SVG | `import_svg`, `pathfinder`, `shape_to_path`, `draw_bezier`, `edit_path_points`, `edit_path_point` | 6 |
| SVG Styling | `set_stroke_style`, `set_gradient`, `set_blend_mode`, `outline_stroke`, `offset_path` | 5 |
| Templates+ | `rename_template` | 1 |
| Fonts | `list_fonts`, `search_google_fonts`, `add_font_to_template` | 4 |
| AI | `ai_generate_text`, `ai_generate_image`, `ai_palette`, `ai_suggest_layout` | 5 |
| Brand | `register_brand`, `validate_brand`, `check_contrast`, `auto_fix_brand` | 6 |
| Brand Guidelines | `create_brand_guideline`, `get_brand_guideline`, `list_brand_guidelines`, `update_brand_guideline`, `delete_brand_guideline`, `apply_brand_to_template` | 6 |
| Style Library | `get_active_styles`, `set_style_lock`, `find_duplicate_styles`, `merge_brand_guidelines`, `download_style_template` | 5 |
| Batch | `batch_update`, `render_batch`, `batch_create_variants`, `batch_render_html` | 7 |
| Variables | `create_variable`, `create_collection`, `link_variable`, `apply_variables` | 6 |
| Version | `list_versions`, `save_version`, `restore_version`, `diff_versions` | 4 |
| Collaboration | `share_template`, `claim_section`, `get_active_agents`, `broadcast_section_change` | 8 |
| Teams | `create_team`, `list_teams`, `get_team`, `invite_to_team`, `list_team_members`, `remove_team_member`, `update_team_member_role`, `share_workspace_with_team` | 8 |
| Export | `export_batch`, `copy_as`, `export_pdf` | 3 |
| Format | `detect_structure`, `adapt_format`, `adapt_all_formats`, `compare_adaptations` | 4 |
| Design System | `create_deck`, `generate_design_artifacts`, `get_design_artifacts`, `generate_brand_manual`, `verify_design_system`, `extract_design_system`, `duplicate_frame`, `update_frame_content`, `get_frame_changes`, `profile_template_pool`, `generate_csv_template`, `apply_csv_to_frames` | 12 |
| Brand Guidelines DB | `create_brand_guideline`, `get_brand_guideline`, `list_brand_guidelines`, `update_brand_guideline`, `delete_brand_guideline`, `apply_brand_to_template`, `get_active_styles`, `set_style_lock`, `find_duplicate_styles`, `merge_brand_guidelines`, `download_style_template` | 11 |
| Render | `render_html_template`, `render_to_formats` | 2 |

<!-- TOOL_CATALOG_AUTO_START -->
### Complete Tool Catalog (auto-synced)

> **Total: 250 tools.** This section is generated by `npm run sync:skill` (scripts/sync-skill-tools.mjs) directly from `netlify/functions/mcp.mjs` — exactly what `tools/list` returns, in alphabetical order. Do not edit by hand; edit the MCP server and re-run.

- `adapt_all_formats` — Adapt template to multiple format sizes at once
- `adapt_format` — Adapt template to a new format/size maintaining content
- `add_content_idea` — Add a content IDEA to the calendar: a content_calendar row with status='idea' and empty copy. Requires scheduledDate (YYYY-MM-DD) and topic; channels/kind/campaign/notes optional. The idea shows up in Calendario and Contenidos immediately. Draft the actual copy later with update_content, following the workspace's copy recipes (list_copy_recipes).
- `add_element` — Add one independent HTML layer. REQUIRES frameId. Keep parentSelector='body' for normal design objects and give the layer explicit position/left/top/width/height in css. Prefer set_frame_layers when creating several objects; nesting is reserved for intentional components/groups. A layer has a fill and a stroke and no background: set_paint picks the right property for you (background-color on a div, fill on an SVG shape, color on a text) and on a group paints every object inside rather than a box behind them.
- `add_font_to_template` — Add a Google Font to template CSS with @import and suggested snippet
- `add_frame_to_brand` — Duplicate a frame from a source template into a brand's Design System template. The source template and frame are NOT modified — a copy is inserted into the DS file. This is the 'click plin' operation: add a design to the Brand Library without altering the original.
- `add_primitive` — Add a visual primitive (rectangle, circle, or text block) to a specific frame in an HTML template. Creates the element with a data-layer-id and matching CSS rule using attribute selectors, following the visual-first design model.
- `ai_generate_image` — Generate or edit an image with Google's Nano Banana models (Gemini native image generation). Prompt-only creates a new image from scratch; pass imageBase64 to EDIT that image guided by the prompt. Needs a Google Gemini API key — the SAME key as image_to_design: passed as geminiApiKey, the user's BYOK key, or GEMINI_API_KEY on the server.
- `ai_generate_text` — Generate AI text content using OpenRouter (GPT-4o-mini). Requires OPENROUTER_API_KEY env var. Optionally adds generated text to canvas.
- `ai_palette` — Generate a color palette (5-7 colors) based on a theme, mood, or description using AI. Requires OPENROUTER_API_KEY.
- `ai_suggest_layout` — Analyze the current template canvas and suggest layout improvements (alignment, spacing, hierarchy). Requires OPENROUTER_API_KEY.
- `ai_translate` — Translate text on the canvas or supplied text to another language using AI. Requires OPENROUTER_API_KEY.
- `align_elements` — Align multiple elements along an axis. Supports left/center/right (horizontal) and top/middle/bottom (vertical) alignment.
- `analyze_template_structure` — Analyze template html/css to detect layout type, colors, typography, components, and dimensions
- `apply_brand` — Apply a saved brand's colors and fonts as CSS custom properties to a template
- `apply_brand_to_template` — Link a template to a brand guideline. Sets the template's brandId and copies the brand's designArtifacts (tokensJson, designMd, sharedCss) onto the template for immediate use. AI agents can then use get_design_artifacts to retrieve brand-aware design data.
- `apply_csv_to_frames` — Apply CSV data to generate frames from a template pool. Each row becomes a frame in a NEW output template. The system duplicates the chosen template and fills slots with CSV values. Empty cells are skipped. Deterministic — no AI content generation, no summarization. Returns per-row report.
- `apply_transition` — Set how THIS frame hands over to the next frame in the exported video: fade | slide | zoom | wipe. Lives on the from-frame's animation; replaces any existing transition to the same target frame.
- `apply_variables` — Apply variable replacements directly to an existing template
- `assemble_template` — Merge all section html/css into a complete template
- `auth_token` — Create a Personal Access Token (PAT) for API authentication. Tokens support scoped permissions (read, write, admin) and optional expiry. Used for headless API access and CI/CD pipelines.
- `auto_fix_brand` — Automatically fix colors, fonts, and spacing to match brand
- `batch_render_html` — Render multiple HTML templates to PNG
- `broadcast_section_change` — Broadcast a section change via Supabase Realtime
- `call_workspace_mcp` — Call a tool on an enabled MCP connection owned by this workspace. BYOK credentials stay server-side.
- `change_element_tag` — Change the HTML tag of an existing element (semantic tagging). The element keeps its data-layer-id, styles, and content. Use this to apply semantic meaning (e.g. change div to nav, h1, button, etc.) after creating visual primitives.
- `check_accessibility` — Score template accessibility and list issues with WCAG references
- `check_contrast` — Calculate WCAG contrast ratios for all text elements
- `claim_section` — Claim a section/frame for exclusive editing (soft lock, 60s TTL). Returns 409 if already claimed by another agent.
- `color_picker` — Color utilities: parse hex/rgba/hsl, generate complementary/analogous/triadic palettes, create light-dark shade gradients. Pure computation, no canvas required.
- `comment_add` — Add a comment pin on the canvas. Auto-creates a Kanban task unless createKanbanTask is false. When the template is a Brand Manual (is_brand_manual=true), comment_type defaults to 'documentation' instead of 'feedback'.
- `comment_list` — List comments for a template, optionally filtered by frame and status.
- `comment_reply` — Reply to an existing comment (threading).
- `comment_resolve` — Mark a comment as resolved.
- `compare_adaptations` — Compare multiple format adaptations side by side
- `copy_as` — Copy a layer or selection as code: SVG markup, CSS styles, or JSON representation. Useful for developer handoff.
- `copy_style` — Copy all CSS properties from one element. Returns the CSS declarations as a string that can be pasted onto another element.
- `create_api_key` — Create a workspace-scoped API key for agent access. The raw key is returned once.
- `create_brand_guideline` — Create a new brand guideline. Automatically creates a Design System template file (is_brand_manual=true) for the brand. Use this to create a brand from scratch; to extract styles from a design, prefer generate_design_artifacts(action: 'publish').
- `create_copy_recipe` — Create a writing recipe in the account's library (type: hook | tono | framework | otro). Saved recipes are personal — only this user sees them; the 10 factory defaults are shared and read-only. When the user asks you to research frameworks/hooks online and save them for future copies, this is the tool. Keep content self-contained: instructions + one worked example, so any AI can apply it later without extra context (a bare name is valid, but fill the content when you have it).
- `create_deck` — Create a complete 1920x1080 presentation deck in ONE call. The generated cover is always the first frame, so total frames = 1 cover + slides.length. Use create_html_carousel instead for social or custom dimensions. Deterministic scaffolding places frames side by side, adds page numbering, and keeps title/body fonts consistent. CSS vars available in slide css: --deck-brand, --deck-bg, --deck-ink, --deck-muted, --deck-title-font, --deck-body-font. Returns templateId + editorUrl.
- `create_frame` — Create a frame (artboard) inside a template for grouping/containing objects
- `create_from_recipe` — Create a new template from a saved recipe, applying optional variable substitutions
- `create_html_carousel` — Create one multi-frame HTML carousel at custom dimensions in a single validated call. Use this for social carousels and any multi-frame design that is not a 1920x1080 presentation. Frames are persisted side by side with exactly the requested width and height.
- `create_html_frame` — Create an HTML frame. For importing designs from Gemini/ChatGPT/Claude (complete HTML+CSS document), use import_design — it's the single-tool entry point that auto-parses documents and handles everything. For editable component designs, create the frame empty and call set_frame_layers. Raw html/css must satisfy the flat editability contract. Position is auto-calculated so frames never overlap.
- `create_html_template` — Create a new HTML/CSS design template with optional initial HTML and CSS
- `create_mask_from_path` — Turn a CLOSED SVG path into a non-destructive mask over an <img> layer. The path stays the editable source of truth (tagged data-mask-for/data-mask-mode; edit_path_points re-bakes automatically). mode 'include' clips the image to inside the path (exterior removed); 'exclude' hides the inside and keeps the exterior. Give pathElementId of an existing path layer (from draw_bezier), or raw pathData in frame coordinates to create the layer on the fly.
- `create_template` — Create a new design template in a workspace. ALWAYS pass engine='html'. For designs from Gemini/ChatGPT/Claude (complete HTML+CSS), use import_design instead — it auto-parses the document and handles everything in one call. For editable component designs, create the empty template and call set_frame_layers. Returns template with .id and .frames[0].id.
- `create_variable` — Create a design token variable (color, number, string) that can be bound to layer properties and reused across templates.
- `create_workspace` — DISABLED — Agents must not create their own workspaces. Use list_workspaces to find the user's existing workspace. This tool always returns an error directing agents to use the user's workspace.
- `delete_asset` — Delete an asset from storage and database
- `delete_brand_guideline` — Soft-delete a brand guideline. The brand moves to the trash (deleted_at set) and can be restored. Set cascadeDs=true to also soft-delete the brand's Design System template file. When cascadeDs is false/omitted, the DS template survives as a regular design file under the user's default brand.
- `delete_content` — Delete a calendar entry (idea or content) by id.
- `delete_copy_recipe` — Delete a writing recipe by id. Only personal recipes can be deleted — factory defaults (isDefault=true) are shared by every account and cannot be removed.
- `delete_frame` — Delete a frame and all its contained objects
- `delete_html_frame` — Delete an HTML frame from a template. Cannot delete the last remaining frame.
- `delete_template` — Permanently delete a template
- `detect_structure` — Detect layout regions (hero, headline, body, cta) from template
- `diff_versions` — Show WHAT changed between two versions of a design, frame by frame, returning the before and after HTML/CSS. Use after get_frame_changes tells you a frame changed and you need to understand the human's edit. Omit 'toVersionId' to compare a stored version against the design as it is right now.
- `download_style_template` — Returns a DTCG-format tokens JSON template for external AI tools (Gemini, ChatGPT). The human fills each $value with data from images/screenshots, then uploads the .json via Style Library → Upload or create_brand_guideline MCP tool. The format is identical to what generateTokensJson() produces, ensuring fingerprint compatibility.
- `draw_bezier` — Create an SVG path with cubic (C) or quadratic (Q) bezier curves. Supports smooth curves (S, T), absolute arcs (A), and combined commands. Returns the layer-id of the created path element.
- `draw_path` — Create an SVG path element (pen/line drawing). Accepts SVG path data string and bounding box dimensions.
- `draw_shape` — Draw a shape with exact dimensions at a specific position. Supports: rect, circle, triangle, star (5-point), polygon (with configurable sides). Triangle uses CSS clip-path. Star and polygon use SVG elements.
- `duplicate_frame` — Duplicate an existing frame exactly (HTML, CSS, dimensions, layoutMode). Returns the new frame ID. Use with update_frame_content to swap text/images in the copy.
- `duplicate_template` — Create an independent copy of a template
- `edit_path_point` — Incrementally edit a single point in an SVG path. Move a point by index, toggle smooth/corner, delete a point, or insert a new point. No need to regenerate the full d-attribute.
- `edit_path_points` — Edit the d-attribute (path data) of an existing SVG path element. Use to move, add, or remove points in a path. Returns the updated path data.
- `edit_text_content` — Change text by data-layer-id. Pass frameId for text inside a frame; omit it for a root canvas object whose persisted frameId is null.
- `enhance_template` — Modify/enhance a template following a natural language instruction
- `export_batch` — Batch export frames or layers as PNG/SVG with configurable presets (scale, suffix, format). Renders via the render pipeline.
- `export_design_tokens` — Export design tokens as CSS :root block and/or DTCG JSON (Design Tokens Community Group format). For Figma, Storybook, or design system portability.
- `export_frame` — Export a frame as SVG (native, importable into Figma/Illustrator) or PDF. For PNG, use render_html_template.
- `export_pdf` — Export the entire template or specific frames as a PDF document via the render pipeline.
- `export_template` — Export a template as .futuraria JSON for backup/migration
- `extract_design_system` — Analyze one or more templates and extract a complete design system deterministically. Multi-template: merges color palettes, typography, spacing, radii, shadows across all templates. Fills missing semantic colors (success green, warning amber, error red, info blue) derived from the palette. Discovers structural components: rounded rect+text→button, img+heading+p→card, input→form field. Falls back to palette-defaults when nothing found. Outputs full extraction with DTCG tokens, shared.css, and brand manual. Zero AI opinion — same input → same output every time. Frame selection: NO frameIds → style of ALL frames merged (use when the user only names the file); frameIds → style of ONLY those frames (use when the user names file + frame).
- `extract_variables` — Extract replaceable content (texts, images, colors, fixed sections) from template
- `fill_mask` — Fill the masked subject of an image with a colour: the image gets an exclude mask (the subject becomes a hole) and a div clipped to the subject shape is placed behind it, painted with the fill colour or gradient. Delete that div layer to remove the fill.
- `find_duplicate_styles` — Scan brand guidelines in a workspace and group them by style fingerprint. Returns groups of visually identical styles that can be merged. Use this to detect when multiple brand guidelines share the same design tokens.
- `find_templates` — Find templates by tags (exact match) and optional workspace filter. Pass similarTo with a template ID to sort results by style similarity. This is the core query for the design graph.
- `generate_brand_manual` — Generate a comprehensive brand identity manual in HTML format. Extracts colors, typography, spacing, components, and assets from the template, then produces a polished, printable brand guide with color swatches, type scale showcase, spacing reference, and component library.
- `generate_csv_template` — Generate a CSV template with columns matching profiled slots across a template pool. Includes _template column with immutable templateId values and human-readable names in comments. Ready for Excel/Sheets. Deterministic.
- `generate_design_artifacts` — Deterministically extract DESIGN.md, tokens.json, and shared.css from the actual frame HTML/CSS. No AI summarization — pure code extraction. Returns colors, typography, spacing, components, images, and constraint facts.
- `generate_from_prompt` — Generate an HTML/CSS template from a text prompt using AI
- `generate_image_video` — Submit a RunwayML image-to-video task (Gen-4 / Gen-4.5): animates ONE image into a 2-10s mp4 (median 1-3 min). ASYNC — returns a taskId immediately; poll it with generate_image_video_check until status 'completed'. Key resolution: runwayApiKey param → user's BYOK key (provider 'runway') → RUNWAY_API_KEY env.
- `generate_image_video_check` — Poll a generate_image_video / generate_text_video task. Without persist: returns { status } while processing ('PENDING'/'THROTTLED'/'RUNNING'), { status: 'POLL_ERROR' } on transient hiccups (429/5xx — retry, don't abort), or { status: 'SUCCEEDED', tempUrl } when the video is ready. With persist:true (call ONCE after SUCCEEDED, optionally passing tempUrl to skip the status GET): downloads the mp4 and returns { status: 'completed', videoUrl, persistent } — persistent:true means it was re-uploaded to the design-assets bucket (Runway's own output URLs expire); on persistence failure persistent:false and the temporary URL is returned with a warning. Terminal failures throw. Free — never counted against the workspace monthly quota.
- `generate_svg` — Generate SVG vector art from a text prompt using Quiver AI. Inserts the result as a vector layer (data-layer-kind="svg") in the specified frame. Requires a Quiver API key configured in AI Settings (server-side encrypted). Non-streaming — returns the final SVG(s) directly.
- `generate_text_video` — Submit a RunwayML text-to-video task (Gen-4 / Gen-4.5): generates a 2-10s mp4 from a text prompt ALONE — no input image, the model invents the whole scene. Describe subject, setting, motion, camera move and style. ASYNC — returns a taskId immediately; poll it with generate_image_video_check until status 'completed'. Key resolution: runwayApiKey param → user's BYOK key (provider 'runway') → RUNWAY_API_KEY env.
- `generate_ui_components` — Generate a standardized UI component kit (buttons, cards, nav, forms, hero) from the current design system tokens. Each component is an editable frame element using CSS custom properties from the brand.
- `get_active_agents` — List agents currently editing this template
- `get_active_styles` — Retrieve the active (locked) styles for a workspace. When styles are locked, AI agents MUST use these styles for all design work. Returns the locked brand guidelines with their tokens. Call this BEFORE designing anything.
- `get_agent_guide` — Get the agent onboarding guide — a summary of how to work with Futuraria MCP effectively. Call this as your second step after initialize. Returns: connection info, auth details, quick tool reference, playbook index, creative vs editable mode guide, memory instructions, and a 3-step getting-started checklist.
- `get_animation` — Read a frame's animation schema plus a summary (stats): clips per layer, timeline, transitions. hasAnimation:false means the frame is static.
- `get_brand_graph` — Returns the brand hierarchy tree for the Red de Marcas force-directed graph (workspace → brands → Design System / Plantillas / Assets / Archivos → items)
- `get_brand_guideline` — Retrieve a brand guideline by ID. Returns the full record including tokensJson, designMd, and sharedCss. Use this to load a brand's design system for use in an agent workflow.
- `get_brand_playbook` — Queryable digest of ONE brand's design logic: design system (color/font tokens + style fingerprint), full file inventory (category, campaign, content kind) and the subset of files that are replicable for another brand. This is the tool for 'revisá toda la lógica que hicimos para la marca X' — get_brand_graph returns the visual tree instead, this returns data a model can act on.
- `get_brands` — List all saved brands with colors, fonts, and metadata, scoped to one workspace
- `get_css_variables` — Extract all CSS custom properties (variables) from a template's stylesheet
- `get_design_artifacts` — Retrieve stored design artifacts (DESIGN.md, tokens.json, shared.css) for a template. Auto-generates if not yet created. Includes staleness check (sourceHash) to detect if frames changed since last generation.
- `get_design_system` — Read the full design system (tokens, components, brand, frames) before designing. Returns JSON + CSS :root block with all design tokens, component inventory, and frame metadata.
- `get_file_meta` — Get curated metadata for a template: brand, tags, theme, format, file_type, cover_image_url, obsidian_link. Returns null if no metadata has been set yet for this template.
- `get_font_details` — Get font metadata including variants, subsets, and CSS import URL
- `get_frame` — Get a single frame by ID
- `get_frame_changes` — Detect which frames changed since a known hash. The AI passes its last-known sourceHash or per-frame hashes, and gets back what changed with attribution (human vs agent). Enables iterative co-editing without stale overwrites.
- `get_html_frames` — List all HTML frames in a template with their HTML/CSS content, dimensions, and positions.
- `get_icon_svg` — Returns a single icon's real SVG source (same pipeline as insert_icon) WITHOUT writing it into any template — for a caller that needs the raw markup itself, e.g. to place it as a standalone canvas object outside any frame.
- `get_illustration_svg` — Returns an unDraw illustration's real SVG source as an editable vector layer (data-layer-kind="svg"), with no external dependency at export time. Use search_illustrations to find slugs.
- `get_metrics` — Get activity metrics aggregated by day. Returns design operations count, frames created, templates created, and breakdown by actor (IA vs human vs system). Useful for activity calendars and dashboards.
- `get_playbook` — Retrieve a full graph-playbook by name. Call this after seeing the playbook index in the initialize response or get_agent_guide. Returns the complete markdown content of the playbook with DAG diagrams, node contracts, phase-by-phase tool guides, validation gates, error recovery paths, and copy-paste MCP call sequences.
- `get_recipe` — Get a single recipe by ID with full HTML/CSS template data
- `get_template` — Get a template by ID with full canvas data, frames, styles, variables
- `get_template_structure` — Parse an HTML template and return its DOM tree, CSS rules, and element list
- `group_elements` — Group multiple elements inside a wrapper div. The wrapper gets a new data-layer-id and the children keep their own ids.
- `harness_claim_feature` — Atomically claim a task for this agent. Sets status to 'draft' (in_progress). Fails with code -32000 if there is already an active task for the account (hard rule: only ONE in_progress at a time per account, mirroring init.sh's check). On success, returns the full task with acceptance.
- `harness_complete_feature` — Reviewer-only completion gate. Requires an active reviewer session, a real harness_submit_for_review marker from the implementer, and fresh passing C1-C5 checkpoints.
- `harness_create_cronjob` — Create a scheduled cronjob that auto-creates and processes tasks. Requires a cron schedule, a task template, and the account's fdr_ws_ api key (stored encrypted_api_key) so the cron runner can authenticate to MCP.
- `harness_dump_context` — Extract current context (decisions, learnings, state) into harness_entries as a context_dump. Frees the context window. The next agent (or next session of the same agent) reads it via harness_get_context. Critical for >40% context usage.
- `harness_evaluate_checkpoint` — Record pass/fail for a checkpoint (C1-C5) on a task. Reviewer calls this once per checkpoint while reviewing. Implementation stores result in harness_checkpoints AND in design_kanban_tasks.checkpoint_json.
- `harness_finish_session` — CAS-close an active/paused session. completed is reviewer-only; implementers must call harness_submit_for_review so the review-cycle marker is recorded.
- `harness_get_context` — Bootstrap context for an agent session. Returns the agent definition (labor + protocol + hard_rules), and when workspaceId is provided: active styles, brand guidelines, and recent templates. Use this BEFORE doing any work — it replaces reading many files. For the leader, this is step 0 and returns everything needed for context validation (step 0.5).
- `harness_get_entries` — Read bitácora entries for a session. Used by reviewers to audit implementer work, and by leaders to recover context after a flush. Returns entries in reverse chronological order.
- `harness_get_runtime_events` — Read sanitized runtime events for one authorized session using a monotonic cursor.
- `harness_healthcheck` — Cloud equivalent of init.sh. Verifies: (1) MCP reachable, (2) Supabase reachable, (3) harness tables exist, (4) design_kanban_tasks reachable, (5) optional lint_design on a template. Returns ok: true|false and per-check details. The reviewer MUST call this before approving.
- `harness_list_cronjobs` — List scheduled cronjobs for the account. Returns enabled and disabled jobs with their schedule, last_run_at, and next_run_at.
- `harness_list_errors` — Retrieve recent error logs from harness_error_logs. Use after a cascade to see what actually failed and why.
- `harness_list_features` — List Kanban tasks eligible for work (the cloud equivalent of feature_list.json). Returns pending tasks with acceptance criteria. The leader picks ONE. Filtering by status is supported — defaults to backlog.
- `harness_list_sessions` — List authorized harness sessions for a task, optionally filtered by status.
- `harness_log_entry` — Append to the bitácora (anti-teléfono-descompuesto). Subagents write results HERE, not in chat. The leader reads references, not content. Every meaningful step should be logged: plan, progress, blocker, exploration, verdict.
- `harness_record_runtime_event` — Append one sanitized, idempotent runtime transition for a harness session. Never send prompts, tool arguments, HTML/CSS, or credentials.
- `harness_release_feature` — Release the lock on a claimed task (set to 'feedback' or 'backlog'). Use when blocked or pausing.
- `harness_report_error` — Registra un error en Supabase (harness_error_logs) para análisis interno. Usar cuando cualquier tool falle.
- `harness_start_session` — Start a new harness session for an agent working on a task. Returns a minimal context_summary built from the agent definition + acceptance + recent entries — subagents get only what they need (anti-context-degradation).
- `harness_submit_for_review` — Implementer signals work is ready for review. Sets task status to 'review' and logs the submission. The leader then launches a reviewer.
- `harness_toggle_cronjob` — Enable, disable, or delete a cronjob.
- `hide_element` — Hide or show a layer/element in a frame. Hidden elements get display:none and are invisible on the canvas.
- `image_to_design` — Convert an image (base64) into HTML/CSS using AI vision and inject it into a frame. Defaults to the first frame. Needs a Google Gemini API key — either passed as geminiApiKey, or configured server-side as GEMINI_API_KEY.
- `import_design` — Import a complete design from HTML+CSS (from Gemini, ChatGPT, Claude, or any AI). This is the ONE tool for importing designs — handles both combined document and separate html/css. Accepts EITHER a 'document' field (complete HTML with inline <style> tags — the tool auto-extracts body HTML and CSS) OR separate 'html' + 'css' fields. Auto-creates a frame if frameId is omitted. Auto-detects dimensions from CSS body { width/height }. No editability enforcement — use this for posters, landing pages, social media designs, and any design where visual fidelity matters more than per-element editing. ICONS: any <div data-icon-hint="name" data-icon-color="#hex" style="position:absolute;left:Xpx;top:Ypx;width:Npx;height:Npx;"></div> in the imported HTML is automatically swapped for the real Phosphor SVG — if the source HTML uses emoji or hand-drawn icon glyphs instead, tell whoever generated it to use this placeholder convention instead so icons render reliably. Returns { templateId, frameId, htmlLength, cssLength, detectedWidth, detectedHeight }.
- `import_svg` — Import SVG content (string or URL) and convert into an editable HTML frame. Parses SVG elements (rect, circle, path, text, polygon, line) and maps them to positioned HTML/CSS with data-layer-id attributes. Creates a new template with one frame containing the result.
- `import_template` — Import a .futuraria JSON export into a workspace
- `insert_icon` — Insert an icon into a frame as a real inline <svg> layer (data-layer-kind="svg") — a first-class editable vector shape, not a webfont glyph, so it always renders in exports/PNG/PDF with no external CDN dependency. Returns the layerId of the inserted element.
- `invert_mask` — Flip an existing path mask on an image: include becomes exclude and vice versa (the CSS re-bakes between clip-path and an inverted SVG mask). The image's pixels are never touched.
- `link_variable` — Bind a design token variable to a layer property, so the property value tracks the variable.
- `lint_design` — Run quality heuristics on a frame's HTML/CSS. Returns score (0-100), issues with severity, and layout-specific rules. Adapts to frame's layoutMode (fixed vs responsive).
- `list_all_texts` — Extract ALL text content from design frames and root canvas objects. Root objects return frameId=null so the data table can distinguish them without adding a visible label in Layers. Auto-tags missing layer IDs and returns template, frame/location, brand, and campaign metadata.
- `list_animation_presets` — Catalog of animation presets (fade-in, slide-in, zoom-in, pop, float, typewriter, ...), easing presets (incl. spring(damping,stiffness)) and animatable props. Use before set_animation to pick preset ids, easings and prop names.
- `list_api_keys` — List all active API keys. Keys are masked for security (only last 4 chars shown).
- `list_assets` — List uploaded assets for a template or workspace
- `list_assets` — List all uploaded assets with optional workspace and search filters
- `list_batch_templates` — List all templates that contain {{slot}} placeholders or data-slot attributes — i.e. templates ready for CSV batch generation. Returns template ID, name, slot count, and slot names. Use to discover which templates can be used with apply_csv_to_frames or the REST batch API.
- `list_brand_guidelines` — List brand guideline summaries in a workspace. Artifacts are omitted by default to protect agent context. Set includeDeleted=true to see trashed brands. After discovery, prefer get_brand_guideline for one exact style.
- `list_calendar_entries` — List content_calendar entries — the single table behind the Calendario, Contenidos and Reportes views. Filter by date window (from/to, YYYY-MM-DD), status (idea|diseño|aprobación|programado|publicado) and kind (organic|ad). Use it to see what is already planned before adding ideas, or to find entries whose copy is still empty (an idea without copy is the normal state of a raw idea).
- `list_copy_recipes` — List the account's WRITING recipes: 10 factory-default frameworks (AIDA, PAS, StoryBrand…) shared by every account plus personal recipes saved by THIS user. Read them BEFORE drafting a copy so it follows the user's voice, and mention which recipes you applied. Recipes with isDefault=true are read-only. These are copy_recipes (instructional text) — for design recipes / key visuals use list_recipes instead.
- `list_fonts` — List fonts used in a template with usage counts, sizes, and weights
- `list_frames` — List all frames in a template
- `list_recipes` — List all saved recipes (key visuals) with optional workspace and search filters
- `list_snapshots` — List in-memory auto-snapshots of a template (newest first): id, type (ia|human|system), trigger, timestamp, frameCount. Pass an id to restore_version's versionId to roll back. Warm-invocation only — durable history is list_versions.
- `list_templates` — List templates with optional workspace filter and search
- `list_versions` — List all saved versions of a template for undo/restore
- `list_workspace_integrations` — List enabled MCP and model API connections for a workspace without exposing credentials.
- `list_workspaces` — List all workspaces for the authenticated user
- `lock_element` — Lock or unlock a layer/element in a frame. Locked elements cannot be selected or moved on the canvas (pointer-events: none).
- `mask_brush` — F4: paint non-destructive brush strokes on an image's mask. Each stroke is a trail of points in IMAGE-LOCAL px (0,0 = the img layer's top-left corner), a brush size and a mode (erase = black = remove, restore = white = bring back). Strokes accumulate in data-mask-brushes on the img and bake into a self-contained data-URI mask; calling again with more strokes edits non-destructively. If the image has no mask yet, a full-rect include mask is created automatically. Editing the mask path with edit_path_points re-bakes the strokes too.
- `merge_brand_guidelines` — Merge multiple brand guidelines into one canonical record. Transfers all sourceTemplateIds from the source brands to the target, then deletes the sources. The target brand retains its ID and gets the combined template references.
- `musa_batch_run` — One-click trigger: dispatch the Musa batch for a workspace NOW instead of waiting for the hourly tick. Validates the dispatch to the musa-batch BACKGROUND function (Netlify 202 = accepted) and returns { started: true } immediately — the leader/implementer/reviewer pipeline then runs in background for up to 15 min (watch the Kanban cards advance). A failed dispatch returns started:false with the real error. Non-admin callers can only trigger their own workspace (workspaceId is validated/forced). With dryRun:true it instead awaits and returns the full dry-run preview inline (no LLM cost).
- `observe_session` — Record and analyze human design sessions to extract workflow patterns. Actions: 'start' begins recording, 'stop' finalizes and saves, 'analyze' extracts patterns (most-used tools, typical workflow, common adjustments). Stored in global in-memory session store.
- `offset_path` — Create an offset (inset/outset) version of an SVG path. Positive offset expands outward, negative offset shrinks inward. Uses svg-path-commander pathOffset().
- `optimize_image` — Optimize image to WebP with configurable quality and max width
- `outline_stroke` — Convert an SVG stroke to a filled outline path. Uses svg-path-commander to expand the stroke into a filled shape. Useful for boolean operations and advanced path editing.
- `paste_style` — Apply copied CSS properties to a target element. Merges the provided style declarations into the element's existing CSS rule. A layer has a fill and a stroke and no background: set_paint picks the right property for you (background-color on a div, fill on an SVG shape, color on a text) and on a group paints every object inside rather than a box behind them.
- `pathfinder` — Perform boolean operations (union, subtract, intersect, exclude) on two SVG path elements. Creates a new merged SVG element and removes the originals.
- `platform_get_status` — PLATFORM TOOL (admin key or workspace owner only). Read platform-level switches and limits: musa_tick_enabled (hourly batch dispatcher kill switch, stored in platform_config, migration v27) and monthly_mcp_quota (per-workspace MCP calls/month, 0 = unlimited). Also reports whether the env-level MUSA_TICK_ENABLED=false emergency override is active (it wins over the DB switch).
- `platform_update_config` — PLATFORM TOOL (admin key or workspace owner only). Update platform-level switches and limits. musaTickEnabled=false stops the hourly musa-batch-tick from dispatching the batch (the manual 'Ejecutar batch' button in the Kanban keeps working). monthlyMcpQuota sets the per-workspace monthly MCP call quota (0 = unlimited, default: 5000); it takes effect immediately. Idempotent; only provided fields change.
- `preview_font` — Render a font preview on the canvas showing the font family name at large size and a sample pangram in that typeface.
- `process_daily_batch` — Dry-run preview of the Musa batch. The real pipeline runs in the musa-batch BACKGROUND function (netlify.toml), dispatched hourly by the musa-batch-tick scheduled function and on demand by musa_batch_run; it advances every enabled Kanban card one step (leader/implementer/reviewer). This sync method only supports dryRun:true (no LLM cost). To actually RUN the batch now, call musa_batch_run instead.
- `profile_template_pool` — Profile multiple templates to detect content slots (text, image, richtext, cta), estimate text capacity (maxChars), classify layout type, and compute CSV column schema. Supports data-slot attribute for explicit slot naming. Deterministic — no AI involved.
- `query_design_graph` — Query the design knowledge graph. Returns nodes (templates with metadata) and edges (connections via shared brand/tags). Filter by workspace, brand, tag, or format to explore design patterns.
- `register_brand` — Register a brand with colors, fonts, logo, spacing rules
- `register_tool` — Register a custom MCP tool (plugin) dynamically. Third-party tools can extend the MCP server with new functionality. Tools are validated and added to the runtime tool registry.
- `release_section` — Release a section/frame claim previously acquired with claim_section.
- `remove_background` — Remove the background of an image with u2netp (local ONNX, zero LLM tokens): the result is a PNG with alpha (cutoutUrl) plus a mask PNG and a traced SVG path. Give assetId (a workspace asset) or a direct url. Dispatches a background job and polls ~8s; u2netp usually finishes in 1-3s warm. If the job is still running you get a jobId — poll it with segment_status(jobId). With applyTo {templateId, frameId, layerId} the target <img> layer's src is swapped to the cutout (original kept in data-orig-src). Idempotent per asset: re-running returns the existing cutout.
- `remove_element` — Remove an HTML element by data-layer-id. Pass frameId for a framed layer; omit it for a root canvas object or legacy top-level HTML.
- `rename_template` — Rename a template (workspace). Updates the template name in the database.
- `render_batch` — Render multiple templates to HTML+PNG in one call. Returns render URLs for each.
- `render_html_template` — Render an HTML template to PNG/WebP/JPG format
- `render_to_formats` — Render template to multiple formats at once
- `reorder_element` — Change the position of an element within its parent
- `replace_asset` — Replace an image src in template HTML with a new URL
- `replicate_brand_strategy` — Clones brand A's design logic onto brand B: builds A's playbook (files, campaigns, design system), checks B has a design system (queues an extraction card first if not) and creates one Kanban card per A replicable file — each card tells the pipeline to rebuild that design with B's identity. Cards land in backlog tagged ['replica', 'brand:<B>', 'from:<sourceTpl>'] (idempotent: already-replicated sources are skipped) so the Musa batch or agents process them. dryRun:true previews the plan without creating anything. Recommended flow: get_brand_playbook on the source brand first.
- `resolve_icon_hints` — Swaps every <div data-icon-hint="name" data-icon-color="#hex" style="position:absolute;left:Xpx;top:Ypx;width:Npx;height:Npx;"></div> placeholder in the given HTML for the real Phosphor SVG (same pipeline as insert_icon/image_to_design/import_design). Use this when you're handed raw HTML (e.g. pasted from an external chat) that already follows the icon-hint convention and you need it resolved before applying — does not touch any template, purely a text transform.
- `restore_brand_guideline` — Restore a soft-deleted brand guideline from the trash. Also restores the brand's Design System template if it was soft-deleted.
- `restore_version` — Restore a template to a previously saved version. The current state is snapshotted first, so a restore can itself be undone.
- `revoke_api_key` — Revoke an API key by its ID. The key becomes invalid immediately.
- `save_recipe` — Analyze template structure and save as a reusable recipe in Supabase
- `save_version` — Save the design's current state as a permanent version in the history. Call this BEFORE making a batch of edits so the previous state can be restored and diffed.
- `search_google_fonts` — Search and browse 94 Google Fonts by name or category (sans-serif, serif, display, handwriting, monospace). Returns family name, category, available weight variants, and the Google Fonts CSS URL. Use this to discover fonts for your designs before applying via add_text fontFamily or transform_object fontFamily.
- `search_icons` — Search icons by name/keyword/category across multiple MIT-licensed libraries (Phosphor, Lucide, Tabler, plus Simple Icons for brand/social logos) for variety. NEVER use an emoji character as a substitute for an icon in a design — always search here first and insert the real result with insert_icon. Returns icon names to pass to insert_icon (not raw HTML — insert_icon embeds it as a real inline <svg>, which is the only reliable way to ship an icon in an exported design).
- `search_illustrations` — Search unDraw illustrations (MIT licensed, free for commercial use, no attribution required) — full scenes/spot illustrations, a different vocabulary than single-concept UI icons. Returns slugs to pass to get_illustration_svg.
- `search_stock_image` — Search for stock images via Unsplash/Pexels API
- `segment_click` — Segment an image with MobileSAM from click prompts or CLIPSeg from a text prompt (local ONNX, zero LLM tokens): every point runs through ONE encoder pass, and the mask comes back as a cutout PNG (alpha), a mask PNG and a traced SVG path (dNorm normalized 0..1 over the image). Points: x/y either normalized 0..1 or px with imageWidth/imageHeight; neg=true marks a background point (Alt+click in the UI). prompt (e.g. "la persona") runs CLIPSeg text mode instead and takes precedence over points/box. Dispatches a background job and polls ~8s; if it is still running you get a jobId — poll it with segment_status(jobId). With applyTo {templateId, frameId, layerId} the traced mask is applied to the target <img> layer as a non-destructive mask path (F1 mechanism: editable with edit_path_points, re-bakes).
- `segment_status` — Poll a segmentation job by id (remove_background / segment_click / segment_text). Done jobs carry result_json: cutoutUrl (PNG alpha), maskUrl, svgPath (boundary trace with bbox), image dims.
- `select_element` — Get details about a specific element by its data-layer-id
- `separate_image_layers` — Submit a Seedream 5.0 Pro (WaveSpeedAI) layer-decomposition task: splits ONE image into a base image + up to 16 transparent layers (median ~77s). ASYNC — returns a predictionId immediately; poll it with separate_image_layers_check until status 'completed'. Key resolution: wavespeedApiKey param → user's BYOK key (provider 'wavespeed') → WAVESPEED_API_KEY env.
- `separate_image_layers_check` — Poll a separate_image_layers task. Returns { status } while processing ('created'/'processing') or { status: 'completed', outputs: [image URLs], layers: [{ url, name, size, boundingBox }] } when done — first entry is the base/background image (full canvas, no box), the rest are transparent element crops; boundingBox.normalized is [x0,y0,x1,y1] on a 0-1000 canvas scale (absolute = output px) and locates each element so the original composition can be rebuilt at exact positions/sizes. Terminal failures throw. Also polls any other WaveSpeedAI prediction id. Free — never counted against the workspace monthly quota.
- `set_animation` — Set or edit a frame's animation — the single JSON source of truth (timeline + clips + tweens + transitions) that compiles to WAAPI preview in the editor and to browser-side video export. Sanitized with normalizeAnimation (never throws on partial input). Shortcut: pass presetIds + presetLayerId to apply catalog presets instead of a full schema. Pass clear:true to remove the animation.
- `set_blend_mode` — Set the CSS mix-blend-mode on an element. Controls how the element blends with its backdrop (multiply, screen, overlay, etc.).
- `set_canvas_layers` — Create independently editable objects on the document canvas, outside every frame. Use this for working assets, copy, images, SVGs, and shapes that should remain visible in the editor but must not appear in frame exports. Every object is persisted with frameId=null; no visible 'unframed' label is added.
- `set_css` — Replace the CSS stylesheet of a frame. Prefer import_design for importing complete designs (Gemini/ChatGPT/Claude output) — it handles the full document in one call. Use set_css only when you need to update CSS independently from HTML. A layer has a fill and a stroke and no background: set_paint picks the right property for you (background-color on a div, fill on an SVG shape, color on a text) and on a group paints every object inside rather than a box behind them.
- `set_css_variable` — Set or update a CSS custom property value in the template's stylesheet
- `set_file_meta` — Set or update metadata for a template (upsert). Accepts any subset of fields: brand, tags, theme, format, file_type, cover_image_url, obsidian_link. Only provided fields are updated.
- `set_frame_layers` — RECOMMENDED tool for AI-generated designs. Replaces one frame with a flat array of independently editable sibling layers. Every text, image, button, SVG, bezier, and shape must be a separate layer with its own id, semantic name, kind, x, y, width, and height. The harness deterministically creates data-layer attributes and absolute CSS; it never invents groups or tries to ungroup generated HTML. A layer has a fill and a stroke and no background: set_paint picks the right property for you (background-color on a div, fill on an SVG shape, color on a text) and on a group paints every object inside rather than a box behind them.
- `set_gradient` — Apply a CSS gradient (linear, radial, conic) to an element's background or fill. For SVG paths, sets fill property; for div elements, sets background-image.
- `set_html` — Replace the HTML content of a frame. Prefer import_design for importing complete designs (Gemini/ChatGPT/Claude output) — it handles the full document in one call. Use set_html only when you need to update HTML independently from CSS. Server-side sanitized with DOMPurify.
- `set_paint` — Set a layer's FILL and/or STROKE. This is the only way to colour a layer: a layer has two paints and no background. The right CSS property is chosen for you — background-color on a div, fill on an SVG shape, color on a text — so you never name it yourself. On a GROUP the paint reaches every object inside it, because a group paints nothing of its own; painting a box behind a group is not something this editor can express.
- `set_pseudo_state` — Set CSS pseudo-class styles (:hover, :active, :focus) for an element. Creates or updates a pseudo-class CSS rule like '.class:hover { ... }'.
- `set_stroke_style` — Set stroke properties (color, width, linecap, linejoin, dasharray) on an SVG path element. Applies CSS stroke-* properties to the element's selector.
- `set_style_lock` — Toggle the lock state of a style (brand guideline) in a workspace. When locked, AI agents are instructed to use only that style for designing. Multiple styles can be locked simultaneously.
- `shape_to_path` — Convert a CSS-based shape (rect div with border-radius, circle div) to an SVG path element so it can participate in pathfinder boolean operations and point editing.
- `skill_clone` — Create a reusable clone skill from extracted or manually-defined patterns. Stored in tpl.metadata.clonedSkills[] array. Skills can be applied later via skill_apply.
- `smart_layout` — Apply advanced layout algorithms to objects: grid (row/column math), masonry (column-based with height tracking), golden-ratio (spiral positioning), circular (polar coordinates), zigzag (alternating offsets), flex-wrap (row-based with overflow). Rearranges objects automatically.
- `studio_create_card` — Create a design task card in the Studio Board (Kanban). Each card represents a design to be produced: banner, post, deck, landing, etc. The card tracks status through the pipeline: pending -> in_progress -> review -> done. Use this when you need to track a design task.
- `studio_delete_card` — Delete a Kanban card together with its activity log and agent time rows. Irreversible — the card disappears from the board and the batch immediately.
- `studio_get_card` — Get full details of a single design task card, including activity log of all status transitions.
- `studio_list_cards` — List design task cards from the Studio Board. Filter by workspace, brand, status, priority, or assigned person. Returns cards sorted by priority then deadline.
- `studio_list_models` — List all AI models and their pricing from the deterministic lookup table. Returns model name, provider, and per-1M-token input/output prices. Use this to see available models and their costs.
- `studio_log_agent_time` — Log time, tokens, and model usage for an agent session on a Kanban task. Accumulates totals on the card and calculates cost from the deterministic ai_model_pricing table. Call this when an agent (leader/implementer/reviewer) finishes work on a task.
- `studio_move_card` — Move a design task card to a new status in the Studio Board. Use this to progress cards through the pipeline: backlog -> research -> draft -> design -> review -> done, or send back to feedback.
- `studio_update_card` — Update fields of a Kanban card. Whitelisted fields only: title, brief, tone, cta, priority, deadline, status, type, format, frame_count, tags, acceptance, assigned_to, brand_id, style_name, template_id, source, ai_model, content_type, enabled. The enabled boolean controls whether the Musa daily batch (scheduled function musa-batch) processes the card.
- `subscribe_template` — Subscribe to Supabase Realtime changes for a template
- `suggest_color_palette` — Generate color palettes using color theory rules from a base hex color. Types: complementary (180°), analogous (±30°), triadic (±120°), monochromatic (varied S/L), split-complementary, tetradic. Uses existing rgbToHsl/hslToRgb helpers.
- `tag_template` — Add one or more tags to a template. Tags use format 'prefix:value' (e.g., 'brand:futuraria', 'tema:navidad', 'formato:story'). Tags enable the design graph and find_templates.
- `task_queue_add` — DEPRECATED: creates a Kanban card (design_kanban_tasks) in backlog instead of a task_queue row. The Musa daily batch (scheduled function musa-batch, 9 UTC) processes Kanban cards by status. Prefer studio_create_card for new work.
- `task_queue_get_config` — Read the automation configuration for a workspace. Returns auto_process_enabled, provider, limits, and notification settings. Use this to load the initial toggle state in the UI.
- `task_queue_list` — DEPRECATED: returns Kanban cards (design_kanban_tasks) instead of task_queue rows. Prefer studio_list_cards, which also groups by status column.
- `task_queue_update_config` — Create or update the automation configuration for a workspace. Used to toggle auto-processing on/off and configure provider and limits. Merge semantics (v27): only sent fields are written, the rest keep their current DB values — the Configuración panel saves the Automatización card and the Kanban card independently. No schedule field: the global daily cron processes every enabled workspace on each run.
- `transform_element` — Transform (resize/reposition) an existing element by its data-layer-id. Updates CSS properties for position, width, height, and optionally rotation.
- `unsubscribe_template` — Unsubscribe from template realtime channel
- `untag_template` — Remove one or more tags from a template.
- `update_brand_guideline` — Update an existing brand guideline's content. Use this to refresh design tokens, update documentation, or modify shared CSS after design changes.
- `update_content` — Update a calendar entry by id: write the copy, change topic/date/time/channels/campaign, attach a design (templateId or externalUrl) or move the status along idea → diseño → aprobación → programado → publicado. Writing copy is what turns a raw idea into drafted content; an empty copy string clears the draft back to a bare idea.
- `update_copy_recipe` — Update an existing writing recipe (name, content, type or tags) by id. Only personal recipes can be updated — factory defaults (isDefault=true in list_copy_recipes) are read-only; create your own copy with create_copy_recipe instead.
- `update_element` — Update an HTML element's content or CSS rules by its data-layer-id A layer has a fill and a stroke and no background: set_paint picks the right property for you (background-color on a div, fill on an SVG shape, color on a text) and on a group paints every object inside rather than a box behind them.
- `update_frame_content` — Surgically update a specific element inside a frame by CSS selector. Uses cheerio for deterministic DOM patching. Supports: text replacement, innerHTML swap, src/href/className changes, arbitrary attributes (attr), style overrides, backgroundImage swap, and element removal.
- `update_html_frame` — Update an HTML frame's metadata or raw HTML/CSS. For importing complete designs (from Gemini, etc.), use import_design instead — it handles both new frames and existing frame updates in one call. For editable component designs, use set_frame_layers. Raw HTML must use flat sibling layers with data-layer-id/name/kind and explicit position/left/top; accidental groups are rejected before persistence.
- `update_template` — Update template metadata or raw HTML/CSS. For importing complete designs (from Gemini, etc.), use import_design instead. For editable component designs, use set_frame_layers. Raw html/frames require flat editability contract. Set allowGroupedLayers=true only for intentional groups/components.
- `update_thumbnail` — Set or update the preview thumbnail for a template — call this after creating or substantially changing a design, so its card shows the work instead of a generated placeholder. The capture replaces the design's previous one at a fixed path; there is no thumbnail history, by design. Render at card size (~480px on the long edge), not full artboard resolution.
- `upload_cover_image` — Upload a cover image (PNG/JPEG base64, max 1MB) for a template. Stored in Supabase Storage design-covers bucket. Returns the public URL.
- `upload_image` — Upload an image (PNG, JPG, SVG, WebP) to the design-assets bucket. Accepts base64 data or external URL. Returns asset record with public URL.
- `validate_brand` — Validate template against brand rules and return compliance report
- `vectorize_image` — Convert a raster image (base64 or URL) into an editable SVG vector using Quiver AI. Inserts the result as a vector layer (data-layer-kind="svg") in the specified frame. Requires a Quiver API key configured in AI Settings (server-side encrypted). Non-streaming — returns the final SVG directly.
- `verify_api_key` — PUBLIC TOOL (no auth required). Check if an API key is valid and get a full diagnostic. Use this when authentication fails with 401 to find out WHY: key_not_found, key_revoked, key_expired, database_error, etc. Pass the same key you would send in the x-api-key header. Clients that cannot send headers (e.g. Claude Connectors) can append ?key=YOUR_KEY to the MCP URL instead — the server reads both.
- `verify_design_system` — Verify extracted design tokens against actual frame content. Checks for orphan tokens (extracted but unused), missing tokens (used but not in extraction), font usage consistency, and color role classification accuracy. Returns a verification report with pass/fail/warn items.

<!-- TOOL_CATALOG_AUTO_END -->
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
| `set_paint` | `templateId`, `frameId`, `elementId` | `fill`, `stroke`, `strokeWidth` | `{ painted: [{ elementId, ...declarations }], fannedOutToGroup }` — picks the property this layer paints with; a group paints its members |
| `get_template` | `templateId` | — | `{ id, frames, html, css, metadata }` |
| `duplicate_frame` | `templateId`, `sourceFrameId` | `newName` | `{ frameId, contentHash }` |
| `delete_html_frame` | `templateId`, `frameId` | — | `{ success }` |
| `remove_element` | `templateId`, `elementId` | — | `{ success }` |
| `transform_element` | `templateId`, `elementId` | `x`, `y`, `width`, `height`, `rotation` | `{ success }` |
| `generate_design_artifacts` | `templateId` | `action` ("generate"/"publish"), `brandName` | `{ designMd, tokensJson, sharedCss, sourceHash }` |
| `extract_design_system` | `templateIds`, `workspaceId` | `name` | `{ extraction, artifacts: { tokensJson, sharedCss, designMd } }` |
| `create_deck` | `workspaceId`, `name`, `brand: { color }`, `slides: [{ title, html, css }]` | `brand.titleFont/bodyFont/background`, `cover: { html, css }` | `{ templateId, editorUrl, frames }` — deterministic 1920×1080 deck: side-by-side frames, cover on brand color, page numbers, consistent fonts; your html/css per slide is the free composition (CSS vars: `--deck-brand`, `--deck-ink`, `--deck-muted`, `--deck-title-font`, `--deck-body-font`) |
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

### Creative Mode vs Editable Mode — Choosing the Right Tools

The MCP offers two distinct workflows for building designs. Understanding when to use each is critical for achieving creative freedom.

#### Creative Mode (no restrictions): `set_html` + `set_css`

This is the **unrestricted** path. These tools write raw HTML and CSS directly to a frame without any editability contract validation. Use this when creative expression matters more than per-element editability.

**What works:**
- Full `<style>` blocks with `@keyframes`, `@media`, pseudo-elements (`::before`, `::after`)
- `text-shadow` with unlimited layers: `textShadow: "0 1px 0 #ccc, 0 2px 0 #b9b9b9, 0 5px 5px rgba(0,0,0,0.3)"`
- `transform: rotate(-3deg)`, `transform: perspective(1000px) rotateY(15deg)`
- Complex `background` shorthand: `linear-gradient(135deg, #667eea 0%, #764ba2 100%)`
- `background-image: url(https://images.unsplash.com/...)` with overlays
- Multi-layer `box-shadow`: `0 20px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.2)`
- CSS Grid, Flexbox, nested HTML structures
- Any valid HTML5 + CSS3 that DOMPurify allows

**Workflow:**
```
1. create_template({ name: "Flyer", workspaceId: wsId, engine: "html" })  → tplId, frame1Id
2. set_html({ templateId: tplId, frameId: frame1Id, html: "<full HTML>" })
3. set_css({ templateId: tplId, frameId: frame1Id, css: "<full CSS with @imports, @keyframes, etc.>" })
```

**Trade-off:** The editor cannot select individual elements for drag/resize. The frame is treated as one visual unit.

#### Editable Mode (per-element editing): `set_frame_layers`

This is the **structured** path. Every visual object becomes an independently selectable, draggable, resizable layer. The editability contract enforces flat siblings (no nesting) with explicit coordinates.

**What works in the `style` object:**
- ALL CSS properties are passed through — `textShadow`, `transform`, `boxShadow`, `backgroundImage`, `background`, `filter`, `clipPath`, etc.
- camelCase keys are auto-converted to kebab-case: `textShadow` → `text-shadow`, `backgroundColor` → `background-color`
- CSS custom properties: `--my-var: value`

**Constraints:**
- Layout properties (`position`, `left`, `top`, `width`, `height`) are reserved — controlled by `x`, `y`, `width`, `height` params
- No `{`, `}`, or `;` in style values (these are for `<style>` blocks, not inline objects)
- Flat siblings only: every text, image, shape must be a separate top-level layer (no nesting)
- `text` must be plain text (no nested HTML)

**Workflow:**
```
1. create_template({ name: "Editable Post", workspaceId: wsId, engine: "html" })  → tplId, frame1Id
2. set_frame_layers({
     templateId: tplId,
     frameId: frame1Id,
     layers: [
       { id: "bg", name: "Background", kind: "shape", x: 0, y: 0, width: 1080, height: 1080,
         style: { background: "linear-gradient(135deg, #667eea, #764ba2)" } },
       { id: "hero_title", name: "Hero Title", kind: "text", tag: "h1", x: 100, y: 400, width: 880, height: 120,
         text: "ACELERA", style: { fontSize: 96, fontWeight: 900, color: "#fff",
         textShadow: "0 2px 0 #b9b9b9, 0 4px 0 #a0a0a0, 0 6px 10px rgba(0,0,0,0.5)",
         transform: "rotate(-3deg)", textAlign: "center" } }
     ]
   })
```

**Trade-off:** Every element is independently editable in the visual editor. However, `@keyframes`, `@media` queries, and pseudo-elements (`::before`) are not available because they require a `<style>` block context that lives outside per-element CSS rules.

#### When to use which

| Scenario | Mode | Why |
|----------|------|-----|
| Flyer with Unsplash bg + 3D text | Creative | Needs `background-image` overlays, multi-layer `text-shadow`, `transform` |
| Social post with per-element editing | Editable | Human will fine-tune text/positions in editor |
| Landing page with animations | Creative | Needs `@keyframes`, pseudo-elements, nested structure |
| Brand template for CSV batch | Editable | Each text layer is a `{{column}}` slot |
| One-shot creative export (PNG/PDF) | Creative | No post-edit needed, full CSS freedom |
| Template for team collaboration | Editable | Multiple users select/edit individual elements |

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

### Canvas Interaction Model (Figma-Style)

The editor implements a two-level selection model matching Figma's behavior:

| Action | Result |
|--------|--------|
| Click frame body | Selects frame (solid blue border). Frame is draggable. |
| Double-click frame body | Enters **content mode** (dashed blue border). Elements inside become clickable. |
| Click outside frame (empty canvas) | Exits content mode. Returns to frame-level selection. |
| Drag on empty canvas | **Marquee selection** — draws rectangle, selects all intersecting frames. |
| Shift+click frame | Adds/removes frame from multi-selection. |
| Drag frame label (top-left corner) | Moves frame. Works in both frame-level and content mode. |
| Double-click frame label | **Inline rename** — Enter to commit, Escape to cancel. |

**Multi-frame drag:** When 2+ frames are selected (marquee or shift+click), dragging any selected frame moves ALL selected frames together.

**Frame auto-naming:** New frames are deterministically named "Frame 1", "Frame 2", etc. Users can rename via double-click on the label.

**Frame-level vs Content-level:**
- **Frame level** (default): Background intercepts clicks → frame selects/moves. Elements inside are NOT clickable. Drawing tools (rect, circle, text, pen) bypass this restriction.
- **Content level** (double-click to enter): Background is click-through → elements inside ARE clickable/selectable. Use the label to move the frame. Click outside to exit.
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

**Pattern 4b: Multi-template design system extraction**
```
// Analyze multiple posts/stories/formats → one unified design system
// Merges colors, typography, spacing, radii, shadows across all templates
// Fills missing semantic colors (success green, error red, warning amber, info blue)
// Discovers components by structure: rounded rect+text→button, img+heading+p→card
// Falls back to palette-derived defaults when nothing found
// Deterministic: same input → same output, zero AI opinion
tools/call: extract_design_system({
  templateIds: ["tpl_post1", "tpl_post2", "tpl_story1", "tpl_carousel1"],
  workspaceId: wsId,
  name: "Futuraria Brand System"
})
  → {
    templatesAnalyzed: 4, totalFrames: 15,
    extraction: { colors: [...], typography: {...}, components: [...], ... },
    artifacts: { tokensJson, sharedCss, designMd, styleFingerprint }
  }
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

**Pattern 7: Learn from a human's edit and apply it elsewhere**

This is the loop to run whenever you return to a design a person may have
touched. Detection alone is not enough — step 3 is what tells you *what* they
changed, and it only works if a version existed before their edit, so always
do step 0 before a batch of your own edits.

```
// Step 0 — BEFORE you edit anything: leave a baseline you can diff against.
tools/call: save_version({ templateId: tplId, label: "antes de mi cambio", author: "agent:lara" })
  → { saved: true, version: { id: "…", createdAt: "…" } }

// Step 1 — Who touched what since then?
tools/call: get_frame_changes({ templateId: tplId, sinceTimestamp: "2026-06-25T00:00:00Z" })
  → frames: [{ frameId: "f1", changed: true,
               lastModifiedBy: "human:…" | "agent:lara" | "agent:claude-opus-5",
               inspectWith: "diff_versions({ … })" }]
// `sinceTimestamp` resolves the newest version at or before that moment.
// You can also pass `baselineVersionId` directly, or your own `frameHashes`.
// `lastModifiedBy` is how you tell a person's edit from another agent's.

// Step 2 — What exactly did they change? (before vs after code)
tools/call: diff_versions({ templateId: tplId, fromVersionId: "<baseline>", frameId: "f1" })
  → frames: [{ frameId: "f1", status: "modified",
               before: { html, css }, after: { html, css } }]
// Omit toVersionId to compare the baseline against the design as it is now.
// Read both sides, infer the INTENT (new palette, tighter spacing, different
// type scale), then apply that intent to the other designs you were asked to
// update — and record it in your skill/notes so it sticks.

// Step 3 — Undo safely if you got it wrong.
tools/call: list_versions({ id: tplId })      // newest first, with author + kind
tools/call: restore_version({ id: tplId, versionId: "…", author: "agent:lara" })
// Restoring snapshots the current state first, so a restore is itself undoable.
```

**Always pass `author`** (`agent:lara`, `agent:claude-opus-5`, …) on
`save_version`, `restore_version`, `update_frame_content`, `duplicate_frame`
and `apply_csv_to_frames`. Without it the history just says "agent" and nobody
— human or model — can tell which of you made a change.

Retention: the last 10 automatic saves rotate; versions created with
`save_version` (and the human's Ctrl/⌘+S) are permanent.

**Pattern 8: Batch content generation — CSV-driven frame automation ("batchamator")**
```
// CONTRACT — enforced by the system, not by you:
//  • The exact frame is REQUIRED. One frame in the template → auto-used (reported
//    in resolvedFrames.autoResolved). Multiple frames and none specified → the
//    call FAILS listing every frame; ask the user, don't guess.
//  • The system generates the CSV skeleton (never invent columns yourself).
//  • Images: user said news/photos → search_stock_image → URLs in image columns.
//    User didn't mention photos → leave image cells EMPTY (original kept, literal).

// Step 1: Profile template pool to detect slots (frameId/frameName = exact frame)
tools/call: profile_template_pool({ templateIds: ["tpl_abc"], frameName: "Post Principal" })
  → { profiles: [...], csvColumns: [...], resolvedFrames: { tpl_abc: { frameId, frameName, autoResolved } }, _deterministic: true }

// Step 2: Generate CSV template for the human (same frame params!)
tools/call: generate_csv_template({ templateIds: ["tpl_abc"], frameName: "Post Principal", rowCount: 30 })
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
  frameName: "Post Principal",
  outputName: "News Batch — 30 Posts",
  naming: "Post {index} — {title}",
  onMissingTemplate: "skip",
  onOverflow: "truncate"
})
  → { outputTemplateId: "tpl_new", resolvedFrames: {...}, generatedFrames: 28, skippedRows: 2, report: [...] }
```

**Style extraction is a DIFFERENT flow** (`extract_design_system`): user names
only the file → NO `frameIds` (all frames merged); user names file + frame →
`frameIds: ["<frame id or name>"]` for that frame's style only. Extraction
READS style; the batchamator WRITES variants. Don't mix them.

**Pattern 9: Create and manage reusable brand guidelines**
```
// Style identity is scoped to one workspace. Normalize a name by trimming it,
// collapsing repeated whitespace, and lowercasing it. Direct
// create_brand_guideline and rename MUST fail with a conflict when that
// normalized name already exists. Publishing a recapture is the deliberate
// exception: an exact normalized-name match updates the single canonical row.
// Never create a second row, pick a prefix/fuzzy match, or merge by fingerprint.

// Step 1: Publish a design system. The operation must preserve its source
// template as a resolvable reference in the same workspace. If the human enters
// an existing exact normalized name, publish recaptures and updates that one
// canonical style; it does not create a duplicate.
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

// Step 5: Update explicitly by ID. Rename conflicts fail, and an update may
// not remove the final resolvable source template.
tools/call: update_brand_guideline({ brandId: "brand_abc123", tokensJson: "...", designMd: "...", sourceTemplateIds: [tplId] })
  → { success: true, brand: { ... } }

// Step 6: Fetch a specific brand directly
tools/call: get_brand_guideline({ brandId: "brand_abc123" })
  → { success: true, brand: { id, name, tokensJson, designMd, sharedCss, ... } }

// Step 7: Remove after explicit confirmation. Its lock and source associations
// are cleaned; templates may retain their last applied snapshot.
tools/call: delete_brand_guideline({ brandId: "brand_abc123" })
  → { success: true, deleted: "brand_abc123" }
```

**Pattern 10: Style Library — Resolve, CRUD, Lock, Merge, and Upload Styles**
```
// ── STYLE PROTOCOL (AI agents MUST follow) ──
// Before designing ANYTHING in a workspace, list the library and check locks:
tools/call: list_brand_guidelines({ workspaceId: wsId })
tools/call: get_active_styles({ workspaceId: wsId })
  → If hasLockedStyles === true:
      You MUST use the returned tokens/designMd/sharedCss for all design work.
      Do NOT invent your own colors, fonts, or spacing.
      Apply the locked style's tokens to every frame you create.
  → If hasLockedStyles === false:
      Resolve any style named by the human against list_brand_guidelines.

// ── RESOLVE a requested style ──
// Automatic selection requires an exact normalized-name match. Normalization is:
// trim leading/trailing whitespace, collapse repeated whitespace, lowercase.
// Prefix, suffix, and fuzzy matches are suggestions only and require confirmation.
// A matched style is valid only when it has >= 1 sourceTemplateId that resolves
// to a template in this same workspace. Missing, orphaned, or otherwise invalid
// requested styles MUST return blocked -> style_not_found/style_invalid. Never
// fall back to free styling, blank output, a CRM brand, or an invented style.

// ── CREATE from a captured reference ──
// Creation requires at least one valid reference template and is atomic: artifact
// extraction, guideline creation, and source association all succeed or none do.
tools/call: create_brand_guideline({
  workspaceId: wsId,
  name: "Futuraria_SocialMedia",
  sourceTemplateIds: [tplId],
  tokensJson: "...",
  designMd: "...",
  sharedCss: "..."
})
  → A normalized-name collision is a conflict, not an implicit update.

// ── READ, UPDATE, RENAME, DELETE from Style Library ──
// Read/list is scoped to the current workspace. Edit by brandId; a rename that
// collides after normalization fails. Direct CRUD update/rename uses brandId.
// A publish recapture may instead update the canonical row by an exact normalized
// name the human entered or confirmed. An update may not leave zero valid
// sourceTemplateIds. Delete requires confirmation and clears its lock.
// If the last source template is deleted, the style is deleted in the same operation.

// ── LOCK a style (human or AI can do this) ──
tools/call: set_style_lock({ workspaceId: wsId, brandId: "brand_abc", locked: true })
  → { success: true, locked: true, totalLockedStyles: 1 }

// ── UNLOCK a style ──
tools/call: set_style_lock({ workspaceId: wsId, brandId: "brand_abc", locked: false })
  → { success: true, locked: false, totalLockedStyles: 0 }

// ── FIND visually similar styles ──
tools/call: find_duplicate_styles({ workspaceId: wsId })
  → { duplicateGroups: 2, groups: [{ fingerprint: "a1b2c3...", count: 5, brands: [...] }] }
  → Fingerprints only suggest candidates. They never merge automatically.

// ── MERGE after explicit human confirmation ──
tools/call: merge_brand_guidelines({
  workspaceId: wsId,
  targetBrandId: "brand_abc",       // The one to keep
  sourceBrandIds: ["brand_def", "brand_ghi"]  // Merge these into target, then delete
})
  → { success: true, mergedCount: 2, totalTemplateIds: 15 }

// ── DOWNLOAD v2 rich tokens template for external AI (Gemini, ChatGPT) ──
tools/call: download_style_template()
  → { format: "json", filename: "tokens-template.json", content: "{...v2 rich DTCG format...}" }
  → Returns COMPLETE v2 design system template with ALL sections:
    meta, color (role/description/constraints), typography (families[] + scale[]),
    spacing (scale + semantic), radius (per-element), shadows, surfaces, layout,
    components (22 with CSS), decoration, imagery, rules (do/dont),
    cssCustomProperties, promptExamples, adaptationGuide.
  → Human downloads .json, pastes into Gemini/ChatGPT with reference images,
    AI fills token values preserving the structure, then uploads via
    Style Library → Upload or create_brand_guideline.

// ── UPLOAD a style from external AI output (v1 or v2 format) ──
// The human must choose a valid reference template. Import + reference association
// is atomic; an upload without a reference is rejected and creates no empty style.
tools/call: create_brand_guideline({
  workspaceId: wsId,
  name: "Glassmorphism Dark",
  sourceTemplateIds: [tplId],
  tokensJson: '{ "$schema": "...", "color": { "canvas": { "$value": "#0a0a0f" } }, ... }',
})
  → { id: "brand_xyz", name: "Glassmorphism Dark" }
  → Accepts BOTH v1 (flat DTCG) and v2 (rich format with families[] + scale[]).
  → Fingerprint is auto-computed from tokens (backwards-compat with both formats).
  → designMd and sharedCss are optional — they can be auto-generated from tokens.
```

In the editor, **Style Library → Estilos** exposes the same lifecycle: create
from a chosen reference, inspect, edit/rename by ID, and delete with confirmation.
The UI must surface name conflicts and invalid references; it must never present
an orphaned style as usable or turn a failed import into a zero-template card.

**Style Fingerprint Technology:**
- Each style gets a `styleFingerprint` — SHA-256 hash of sorted design tokens ONLY (colors, fonts, spacing, radii, shadows)
- Ignores text content, images, and layout
- Two templates with the same visual style but different text → SAME fingerprint
- A matching fingerprint is advisory: show merge candidates and wait for explicit confirmation
- A fingerprint never overrides normalized-name uniqueness and never triggers a silent merge
- **v2 Format Support:** Fingerprint computation handles BOTH v1 (flat DTCG with `typography.fontFamily`) and v2 (rich format with `typography.families[]` + `typography.scale[]`) — backwards-compatible with all existing stored tokens

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

## 🗂 Filing a Design — Brand, Category, Campaign, Assets

Every design belongs somewhere. The "Red de Marcas" graph and the Tabla view
are two renderings of the same filing, so getting it right is what makes work
findable later — by the next agent as much as by the human.

### Where the filing lives

| Fact | Column | Written by |
|---|---|---|
| Brand | `design_file_meta.brand_id` (+ `brand` as a mirror) | `PUT /api/meta/:templateId` |
| Category | `design_file_meta.category` (v21) | same |
| Campaign | `design_file_meta.campaign` | same |
| Asset → brand | `assets.tags` contains the brand **name** | `PATCH /api/assets/:id { brand }` |

**`brand_id` is authoritative, not `brand`.** The graph files by id and falls
back to the name only when there is no id. Sending a bare `{ brand: "Acme" }`
is correct and preferred: the route resolves it against the workspace's brands
and creates the brand if it is new. Never write `brand` and `brand_id`
inconsistently — the file ends up in two places at once.

### The four categories

`Design System` · `Plantillas` · `Assets` · `Archivos`

A file with no category is an **Archivo**. That is the default and it is
correct; do not set `category` just to set it.

### Campaigns are optional, and the shape says so

- A file **with** a campaign hangs under a node named after that campaign,
  even if it is the only one there.
- A file **without** a campaign hangs straight off Archivos.
- There is no "Sin campaña" node and there must never be one. Grouping the
  unfiled files under something that looks like a campaign erases the very
  difference the graph exists to show.

Only set a campaign when the user names one. Inventing campaigns to tidy the
tree destroys the signal.

### Paid or organic

`design_file_meta.content_kind` — `organic` | `ad` | NULL.

**This is provenance, not current state.** It records what a design was FIRST
used for. A photo that ran as an ad and did well often becomes an organic post
later; the design keeps its original label and the calendar row carries what it
is doing now. Never rewrite it because a file was reused the other way.

When you create a design, set it. A freelancer's workspace is mostly organic
and an agency's is mostly ads, but neither is a safe guess — if the request
does not say, ask or leave it NULL rather than inventing one. Images that
Content Machine pulls into a file inherit that file's kind as a tag, which is
why getting it right on the design matters beyond the design.

### Assets

Assets come from the `assets` table, not from templates. In the graph a brand
draws **at most 8** of them plus a node counting the rest — a Content Machine
run is dozens of photos and drawing them all buries the brand. The complete
list is in the Tabla view, which reads `GET /api/assets?workspaceId=` instead.

An asset uploaded through `POST /api/assets/upload` should carry
`tags: ["<brand name>"]`, or it will be filed under no brand and nobody will
find it. Pass a `url` and the server fetches and re-hosts the image; pass
`replaceAssetId` to overwrite an existing one instead of leaving two copies.

---

## 🧱 Structure — Flat, and Never Grouped

Ungrouping is where this product loses its time. A designer spends up to a
fifth of a session on it; a design generated by an agent can spend most of one.
Every wrapper you emit that exists only to hold two things is a wrapper someone
has to take apart before they can touch either of them.

**Emit layers as siblings.** A headline, a photo and a button are three
elements on the frame, not three elements inside a `<div>`. If you find
yourself opening a wrapper to "keep these together", do not — position them.

**A text block is not grouped text.** These are different things and the
difference matters:

```html
<!-- ONE text block: a heading and its subheading, moved and styled together -->
<div data-layer-name="Titular">
  <h1>Cuenta Imparable</h1>
  <p>Sin comisiones, sin letra chica</p>
</div>

<!-- NOT this: a wrapper holding unrelated elements is a group, and groups
     are what people have to undo -->
<div>
  <h1>Cuenta Imparable</h1>
  <img src="…">
</div>
```

A wrapper whose children are all plain text runs is classified as a text block
and behaves as one element. A wrapper holding anything else is a group, and
the editor will offer to flatten it — which is a job you handed the user.

**A group cannot paint. This is enforced, not advised.** If a wrapper you
marked `data-layer-kind="group"` carries a background, a border or a shadow, it
is saved back as a `container` — every write goes through one place that checks
this. Nothing you painted is lost; the label changes, because painting a box is
a deliberate act and calling that box scaffolding is the mistake. Ungrouping is
then free to dissolve real scaffolding without throwing a backdrop away.

So: to colour several objects, do not wrap them and paint the wrapper. Paint
the objects — `set_paint` on a group does exactly that, reaching every object
inside it.

**Use `padding`, never `margin`.** The selection frame is the element's box,
and `margin` inflates it — so the handles sit away from the artwork and every
snap and guide lands in the wrong place. Padding is inside the box and does
not move the frame. If you need space around something, pad its parent.

---

## 🎨 Fill and Stroke — The Only Two Paints

A layer has exactly two paints: a **fill** that colours its interior, and a
**stroke** that colours its outline. There is no third thing called a
background. The person using the editor sees exactly these two, so an agent
that thinks in other terms produces files they cannot edit back.

Which CSS property carries the fill depends on what the layer is, because that
is what the medium requires:

| layer | fill | stroke |
|---|---|---|
| `<div>` shape or container | `background-color` | `border-color` + `border-width` |
| SVG shape (`<path>`, `<circle>`, …) | `fill` | `stroke` + `stroke-width` |
| text | `color` | `-webkit-text-stroke-*` |
| image | — its interior is its own pixels | — |
| **group** | **none — it has no paint of its own** | **none** |

`set_paint` does this translation for you, which is the point of it:

```js
set_paint({ templateId, frameId, elementId: "hero_box", fill: "#3B82F6" })
// a div  → background-color: #3B82F6
// a path → fill: #3B82F6
// a text → color: #3B82F6
```

**On a group it paints every object inside**, because a group has no interior
of its own. Five outlined shapes grouped together, given a fill, come back as
five filled shapes — not a rectangle behind them.

You may still write CSS directly with `set_css`, `add_element`,
`set_frame_layers` and the rest; nothing is taken away. `set_paint` exists so
you do not have to know which property this particular layer paints with, and
so "fill the group" means what a designer means by it.

**A frame's background is a different thing and stays untouched.** A frame is
the canvas — `create_html_frame({ background: "#ffffff" })` is how you paint
it, and that has nothing to do with a layer's fill.

---

## 🗓 Content Calendar — Say When It Goes Out

`content_calendar` is one row per piece of content, and the section formerly
called Textos is built on it. `POST /api/content` to create, `PATCH
/api/content/:id` to update, `GET /api/content?workspaceId=&from=&to=` to read.

- `kind` — `organic` | `ad`. Paid and organic share every dimension except
  spend, which is why they are one table and not two.
- `campaign` and `ad_set` — **both optional**, for organic as much as for ads.
  An organic series is an ad set by another name. Never fill one in to tidy
  the data: an invented campaign erases the difference between planned work
  and loose work, which is the thing the user is looking at the graph to see.
- `template_id` — the join back to the design, the graph and the kanban. **When
  you schedule content for a design you created, set it.** Without it the
  calendar row and the file are two facts about the same work that nothing can
  connect.
- `plan_*` and `actual_*` — the PROYECCIÓN and RESULTADOS bands of an agency
  report. Leave them NULL when there is no plan; 0 is a promise to spend
  nothing and the pacing column has to tell those apart.

---

## 📸 Snapshots — Always Leave a Preview Behind

**After you finish creating or substantially changing a design, call
`update_thumbnail`.** A design with no thumbnail falls back to a generated
placeholder, and a card that shows a flat rectangle is a design the user
cannot recognise in a list of forty.

```jsonc
{
  "method": "update_thumbnail",
  "params": {
    "templateId": "tpl_...",
    // workspaceId is optional: the folder comes from the template itself
    "thumbnail": "data:image/jpeg;base64,..."
  }
}
```

Rules that matter:

- **Do not pass `workspaceId`.** The capture is stored under the template's
  OWN workspace, resolved server-side. Passing one that disagrees is rejected
  by the tenancy guard — and a client's idea of "current workspace" drifts.
- **One file per design, forever.** That path is deterministic and written with
  `upsert`, and a capture in a different format removes the previous one. There
  is no history and there must not be one — a snapshot per save would fill the
  bucket with pictures of the same design.
- **Max 1MB** as a base64 string. Render at card size (~480px on the long
  edge), not at full artboard resolution.
- The human editor already does this on its own a few seconds after edits
  settle, so you are covering the agent-created case, not duplicating it.

---

## 🧭 Graph Playbooks — Intent-Driven Agent Workflows

When a user gives you a high-level task, **don't guess the tool sequence**. Instead, match the intent to a playbook below and follow its DAG (Directed Acyclic Graph). Each playbook is a battle-tested, graph-engineered path with branching logic, validation gates, and error recovery.

**Playbook files** in `docs/` — each is a self-contained guide an agent can follow without reading source code:

| # | Playbook | Intent | File |
|---|----------|--------|------|
| 1 | **Replicate HTML+CSS** | "Copy this HTML/CSS into a frame, adapt to formats" | [`docs/GRAPH_PLAYBOOK_REPLICATE_HTML.md`](docs/GRAPH_PLAYBOOK_REPLICATE_HTML.md) |
| 2 | **Create from Scratch** | "Build a new design from a description — no template" | [`docs/GRAPH_PLAYBOOK_CREATE_FROM_SCRATCH.md`](docs/GRAPH_PLAYBOOK_CREATE_FROM_SCRATCH.md) |
| 3 | **CSV Batch → N Variants** | "Generate 100+ variants from a CSV data source" | [`docs/GRAPH_PLAYBOOK_CSV_BATCH.md`](docs/GRAPH_PLAYBOOK_CSV_BATCH.md) |
| 4 | **Design System → Brand Manual** | "Extract design tokens and generate a brand identity guide" | [`docs/GRAPH_PLAYBOOK_DESIGN_SYSTEM.md`](docs/GRAPH_PLAYBOOK_DESIGN_SYSTEM.md) |
| 5 | **Multi-Agent Collaboration** | "Multiple AI agents edit the same template simultaneously" | [`docs/GRAPH_PLAYBOOK_MULTI_AGENT.md`](docs/GRAPH_PLAYBOOK_MULTI_AGENT.md) |

### How to Use a Playbook (Agent Quick-Start)

```
1. Identify intent from user request → match to playbook above
2. Read the Mermaid DAG diagram → understand the flow
3. Follow the "Phase-by-Phase Node Guide" tables → exact tool + params per step
4. Check the "Agent Quick-Start" section → copy-paste MCP calls
5. At each validation gate (V1-V4) → run the contract check before proceeding
6. If a gate fails → follow the "Error Recovery Paths" for that error
7. Complete all phases → return the "Terminal Report" shape to the user
```

### Playbook Structure (What's Inside Each)

Every playbook follows the same graph-engineering schema:

- **Schema**: Entity types (Objective, Plan, Artifact, Run, Evaluation, Claim, Source) + Relation types
- **Node Contract**: TypeScript interface with `tool`, `params`, `expected`, `on_success`, `on_failure`, `max_retries`, `timeout_ms`
- **Mermaid DAG**: Visual graph of all nodes and branching logic
- **Phase-by-Phase Guide**: Each node with exact MCP tool, params, and expected output
- **Validation Contracts**: V1-V4 gates with YAML checks and fail handlers
- **Error Recovery Paths**: ER1-ER5 for common failure modes
- **Ratchet Loop**: Per-frame or per-variant lint-improvement loop
- **Terminal Report**: TypeScript interface for the final agent output
- **Agent Quick-Start**: 7-step copy-paste MCP call sequence
- **Principles Cross-Reference**: How each Graph Engineering principle maps to implementation

---

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
**Description:** React + Shadow DOM HTML rendering engine for the Futuraria Design platform. Full WYSIWYG design tool with frame management, layers panel, properties inspector, batch generation from CSV (3 modes), HTML/CSS code editing, MCP tool integration (250 tools), undo/redo history, auto-save with localStorage resilience, and keyboard shortcuts. Deployed on Netlify with Supabase persistence (freemium model).
**Triggers:** Any task involving the Futuraria editor UI, canvas manipulation, component changes, bug fixes, a11y improvements, API integration, MCP tools, or React best-practice refactors.

---

## Overview

You are an AI agent working on the Futuraria Design Editor — a React 18 + TypeScript + Vite application that uses a **Shadow DOM HTML rendering engine** for full WYSIWYG design. Each frame is real HTML+CSS rendered inside a Shadow DOM (no Fabric.js, no canvas 2D API) — pure browser CSS engine. The editor is deployed on **Netlify** with a serverless API via Netlify Functions and **Supabase** for cloud persistence (dual-write freemium model: Supabase when configured, in-memory fallback when not).

**React-Doctor Score:** 100/100 (clean bill of health)
**Production URL:** `https://design.futuraria.com`
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
│   │   ├── EditorV2.tsx             — Main editor (Shadow DOM HTML engine)
│   │   ├── DesignFrame.tsx       — Per-frame Shadow DOM renderer
│   │   ├── InfiniteHtmlCanvas.tsx — Pannable/zoomable canvas container
│   │   ├── HtmlToolbar.tsx       — HTML element insertion toolbar
│   │   ├── HtmlLayersPanel.tsx   — Layer manager (DOM tree)
│   │   ├── HtmlContextualPanel.tsx — Right-click actions
│   │   ├── ElementProperties.tsx — CSS property inspector
│   │   ├── BatchAMator.tsx       — Batch generation from CSV (3 modes)
│   │   ├── CodePanel.tsx        — Live HTML/CSS code editor
│   │   ├── AIPanel.tsx          — AI design generation
│   │   ├── InsertToolbar.tsx    — Element insertion bar
│   │   ├── FloatingToolbar.tsx  — Contextual floating toolbar
│   │   ├── KeyboardShortcuts.tsx — Shortcuts modal
│   │   ├── Toast.tsx             — Toast notifications
│   │   └── toolbar/              — Toolbar sub-components
│   ├── hooks/
│   │   ├── useDockablePanel.ts   — Dockable panel state
│   │   ├── useDropdowns.ts       — Dropdown state
│   │   └── useLayerTree.ts       — Layer tree builder
│   └── lib/
│       ├── templateApi.ts        — API client + localStorage fallback
│       └── supabase.ts           — Fetch wrapper (API_BASE = "")
├── api/                          — Express API (serverless via Netlify Functions)
│   ├── src/
│   │   ├── index.ts              — Express app factory
│   │   ├── server.ts             — Local dev server entry
│   │   ├── routes/
│   │   │   ├── templates.ts      — Template CRUD + base64 guard
│   │   │   ├── batch.ts          — CSV batch generation ({{slot}} substitution)
│   │   │   ├── assets.ts         — Image upload to Supabase Storage
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
├── shared/                       — THE DESIGN RULES, read by every surface
│   ├── paintModel.ts             — what a layer's fill and stroke map to
│   └── paintDetection.ts         — whether a style paints a visible box
├── netlify/
│   └── functions/
│       ├── api.mjs               — Express → Netlify Function bridge
│       └── mcp.mjs               — MCP server (JSON-RPC + SSE, 250 tools)
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
Netlify CDN (design.futuraria.com)
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
│   ├── InfiniteHtmlCanvas — Pannable/zoomable HTML canvas
│   ├── DesignFrame      — Per-frame Shadow DOM renderer (real HTML+CSS)
│   ├── HtmlToolbar      — Element insertion + formatting toolbar
│   ├── ElementProperties — CSS property inspector (fill, stroke, position, size, typography)
│   ├── HtmlLayersPanel   — layer list with visibility/lock/delete/reorder
│   ├── KeyboardShortcuts — modal dialog showing all shortcuts
│   ├── BatchAMator      — batch generator (single-post, multi-post, carousel modes)
│   ├── CodePanel         — live HTML/CSS code editor
│   └── AIPanel           — AI-powered design generation
└── ToastProvider        — toast notification system
```

### State Management

The app uses **`useReducer`** with a single state atom (`AppState`). No useState for global state — this was the key refactor to achieve react-doctor 100.

The editor (EditorV2.tsx, ~3200 lines) manages state via React `useState`/`useCallback` hooks:
- `frames[]` — array of DesignFrame objects (each has html, css, x, y, width, height)
- `selectedFrameId`, `selectedElement` — current selection
- `undoStack[]`, `redoStack[]` — frame snapshots for history
- `showCodePanel`, `showBatch`, `showImageUpload` — UI toggles

Each frame renders inside a **Shadow DOM** via DesignFrame.tsx, which:
1. Creates a shadow root on a div
2. Injects `<style>` with the frame's CSS
3. Injects `<div id="__df_content">` with the frame's HTML
4. Maps `body`/`html` CSS selectors to `#__df_content` (Shadow DOM has no `<body>`)
5. Emits change events for auto-save

**Pattern:** Frame content is real HTML+CSS inside Shadow DOM — changes emit via MutationObserver + custom events. EditorV2 listens and auto-saves debounced.

### Data Flow

```
User edits in Shadow DOM → DesignFrame emits change event
  → EditorV2 debounces 800ms → autoSave(frames)
    → localStorage (instant, primary)
    → API PUT /api/templates/:id (best-effort cloud sync)

Template load:
  → API GET /api/templates/:id
    → Frames rendered into individual Shadow DOM roots

Image imports:
  → Upload to Supabase Storage → get URL → insert <img src=url>
  → Server strips any inline base64 in PUT handler (anti-bloat guard)
```

### MCP (Model Context Protocol) — AI Agent Connection Guide

AI agents connect to the MCP server at `https://design.futuraria.com/mcp` to discover and invoke **250 tools** for workspace, template, frame, HTML/CSS, font, brand, batch, collaborative design, design system extraction, frame content editing, template profiling, CSV-to-frames batch generation, SVG import, bezier curves, pathfinder operations, stroke styling, gradient fills, blend modes, path outline/offset, authentication, team management, brand manual generation, and design system verification. The MCP server implements the **Model Context Protocol 2024-11-05** specification via **SSE transport + JSON-RPC 2.0**.

#### Protocol Flow

```
Agent (Claude / Cursor / Custom)
  │
  ├─ GET  /mcp                          → SSE init (event: endpoint)
  ├─ POST /mcp  { method: "initialize" } → capabilities + server info
  ├─ POST /mcp  { method: "tools/list" } → discover 10 tools
  └─ POST /mcp  { method: "tools/call" } → invoke any tool
```

**Auth (3 methods, all equivalent):** (1) `x-api-key: your-key` header on POST requests; (2) key in the URL — `https://design.futuraria.com/mcp?key=your-key`; (3) OAuth 2.1 — `Authorization: Bearer <token>` issued by `/oauth/token` after login+consent (ChatGPT and Claude web connectors discover this automatically via `/.well-known/oauth-protected-resource`). Falls back to `dev_user_default` only in dev.

#### Connecting from AI Agents

**Claude Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "futuraria": {
      "type": "sse",
      "url": "https://design.futuraria.com/mcp",
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
      "url": "https://design.futuraria.com/mcp",
      "headers": { "x-api-key": "your-api-key" }
    }
  }
}
```

**ChatGPT / Claude web ("Conectores" / custom connectors):** paste the plain URL and pick OAuth when the client offers it (it discovers the flow from the 401 `WWW-Authenticate` header):
- URL: `https://design.futuraria.com/mcp`
- Auth: OAuth (the client registers itself, opens the login/consent page, and stores the token)

If the client has NO OAuth and NO header support, use the key-in-URL form:
- URL: `https://design.futuraria.com/mcp?key=fdr_ws_YOUR_KEY`

**Claude Desktop with query-string key** (older UIs without a headers field):
```json
{
  "mcpServers": {
    "futuraria": {
      "type": "sse",
      "url": "https://design.futuraria.com/mcp?key=fdr_ws_YOUR_KEY"
    }
  }
}
```

**Verifying auth WITHOUT any paid AI client** (regression after deploys):
```powershell
node QA/oauth-qa-user-setup.mjs   # once: registers the QA user + accepts the NDA
node QA/oauth-flow-test.mjs       # 21 checks: discovery -> register -> authorize -> token -> Bearer on /mcp -> refresh -> replay rejection
```
This is a headless client performing the exact HTTP sequence ChatGPT/Claude web would. Full report and findings: `QA/OAUTH-FLOW-TEST-2026-08-25.md`.

**Custom HTTP Client** (any language):
```bash
# 1. Initialize
curl -X POST https://design.futuraria.com/mcp \
  -H "Content-Type: application/json" \
  -H "x-api-key: dev-key" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"my-agent","version":"1.0"}}}'
# → {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"futuraria-mcp","version":"1.0.0"}}}

# 2. Discover tools
curl -X POST https://design.futuraria.com/mcp \
  -H "Content-Type: application/json" \
  -H "x-api-key: dev-key" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
# → {"jsonrpc":"2.0","id":2,"result":{"tools":[{...10 tools...}]}}

# 3. Call a tool
curl -X POST https://design.futuraria.com/mcp \
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
      "canvas": { "type": "object", "description": "Full template JSON (frames, html, css)" }
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

DesignFrame initializes Shadow DOM in a single effect to inject HTML+CSS:

```typescript
// Shadow DOM init: inject <style> + <div id="__df_content"> into shadow root
useEffect(() => {
  if (!hostRef.current || hostRef.current.shadowRoot) return;
  const sr = hostRef.current.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = mapBodySelectors(frame.css || "");
  const content = document.createElement("div");
  content.id = "__df_content";
  content.innerHTML = frame.html || "";
  sr.append(style, content);
}, []);
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

### EditorV2 (Main Editor)
- **File:** `src/pages/EditorV2.tsx` (~3200 lines)
- **Role:** Main editor page — manages frames, selection, undo/redo, auto-save, keyboard shortcuts
- **Renders:** InfiniteHtmlCanvas (zoom/pan container) → DesignFrame[] (Shadow DOM per frame)
- **Key features:** Frame CRUD, element selection/drag/resize, code panel, batch modal, AI panel, image upload to Storage
- **Keyboard:** Ctrl+B (batch), Ctrl+/ (code panel), Ctrl+Z/Y (undo/redo), Ctrl+D (duplicate), V/H/F/R/O/T (tools)

### DesignFrame
- **File:** `src/components/DesignFrame.tsx` (~2000 lines)
- **Role:** Per-frame Shadow DOM renderer — injects HTML+CSS into shadow root
- **Key:** `mapBodySelectors()` transforms `body`/`html` CSS selectors to `#__df_content` (Shadow DOM has no `<body>`)
- **Events:** Emits `frame:change` on content mutation, `frame:select` on click

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
- **File:** `src/components/BatchAMator.tsx` (301 lines)
- **Props:** `templateId`, `onClose`
- **Modes:** single-post (one template × CSV rows), multi-post (template per row), carousel (frames grouped in one template)
- **State:** `useReducer(batchReducer, initialBatchState)` — CSV upload, parse, preview, generate
- **API:** `POST /api/templates/:id/batch/:mode` with `{ data: rows[] }`
- **Slot syntax:** `{{columnName}}` in HTML or CSS — replaced with CSV cell values
- **Limits:** Max 15 rows per batch (Netlify 10s timeout)

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

### useDockablePanel
- **File:** `src/hooks/useDockablePanel.ts`
- **Role:** Manages dockable panel position (left/right/floating)

### useDropdowns
- **File:** `src/hooks/useDropdowns.ts`
- **Role:** Manages open/close state for toolbar dropdowns
- **State:** `useReducer` — single reducer for boolean dropdown states

### useLayerTree
- **File:** `src/hooks/useLayerTree.ts`
- **Role:** Builds a tree representation of DOM elements inside a frame's Shadow DOM for the layers panel

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

## REST API — Batch Generation

### Overview

Two parallel batch generation paths exist:

| Path | Mechanism | Slot syntax | Use case |
|------|-----------|-------------|----------|
| **REST API** (UI) | `{{columnName}}` string substitution in HTML + CSS | `{{slot}}` | BatchAMator UI component |
| **MCP** (AI agents) | `data-slot` attribute + cheerio DOM manipulation | `data-slot="name"` | AI agent automation |

### REST Endpoints

#### `GET /api/templates/:id/batch/slots`
Detects `{{slot}}` placeholders in template HTML and CSS.

**Response:** `{ success: true, slots: ["headline", "subtitle", "image_url"] }`

#### `POST /api/templates/:id/batch/:mode`
Generates designs from CSV data.

**Body:** `{ data: Record<string, string>[] }`

**Modes:**
- `single-post` — N templates, each with frames substituted per CSV row
- `multi-post` — alias for single-post
- `carousel` — 1 template with N×frames, one set per CSV row

**Slot substitution:**
- `{{columnName}}` in HTML: `<h1>{{headline}}</h1>` → `<h1>New Product Launch</h1>`
- `{{columnName}}` in CSS: `background-image: url({{image_url}})` → `background-image: url(https://...)`

**Limits:** Max 15 rows per batch (Netlify 10s function timeout).

**Response:** `{ success: true, data: DesignTemplate[], count: number }`

### MCP Tools (for AI agents)

The MCP server has a more sophisticated batch pipeline:

1. **`profile_template_pool`** — Detects content slots (text, image, richtext, cta) via DOM analysis
2. **`generate_csv_template`** — Creates a CSV template with columns matching profiled slots
3. **`apply_csv_to_frames`** — Applies filled CSV to generate frames using cheerio DOM manipulation

The MCP tools use `data-slot` attributes for explicit slot naming and support overflow handling (truncate/skip/warn), slot types (text/image/cta), and multi-template pools with `_template` column.

### Design System Extraction (`extract_design_system`)

**Purpose:** Analyze one or more templates and extract a complete, deterministic design system. Zero AI opinion — same input always produces identical output.

**Multi-template mode:** When multiple `templateIds` are provided, extracts from all templates and merges into one unified design system. Colors are re-classified after merge, fonts are combined, and shared components get higher confidence.

**Semantic gap-filling:** If the designs don't contain success/warning/error/info colors, they are derived from the accent hue using color theory (green=+120°, amber=+45°, red=0°, blue=+210°). This ensures a complete palette even if the source posts only use brand colors.

**Structural component discovery:** Scans DOM structure for patterns:
- Rounded rectangle with text child → **button** (with radius detected)
- Container with img + heading + paragraph → **card**
- Input/textarea elements → **form input**

If no patterns are found, falls back to palette-derived defaults: `.btn` (primary), `.btn-secondary`, `.btn-ghost`, `.card`, `.input`.

**Output:** Full extraction with colors (classified by role: background, text, accent, muted + derived success/error/warning/info), typography (families, scale, weights), spacing scale, border radii, shadows, components, and three artifacts: `tokens.json` (DTCG format), `shared.css` (:root variables + component classes), `DESIGN.md` (structured markdown).

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
- `react-doctor/no-giant-component` — EditorV2 is ~3200 lines (complex editor logic)
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
  "react-dom": "^18.3.1"
}
```

Dev: `vite@5`, `typescript@5`, `@vitejs/plugin-react@4`

**No Fabric.js dependency** — the editor uses native browser Shadow DOM for all rendering.

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
|------|-------|--------|
| `src/pages/EditorV2.tsx` | ~3200 | Main editor (Shadow DOM HTML engine) |
| `src/components/DesignFrame.tsx` | ~2000 | Per-frame Shadow DOM renderer |
| `src/components/InfiniteHtmlCanvas.tsx` | — | Pannable/zoomable canvas |
| `src/components/HtmlToolbar.tsx` | — | HTML element insertion toolbar |
| `src/components/Dashboard.tsx` | ~230 | Template gallery |
| `src/components/BatchAMator.tsx` | ~300 | Batch generation from CSV |
| `src/components/CodePanel.tsx` | — | Live HTML/CSS code editor |
| `src/components/ElementProperties.tsx` | — | CSS property inspector |
| `src/components/HtmlLayersPanel.tsx` | — | Layer manager (DOM tree) |
| `src/components/KeyboardShortcuts.tsx` | ~170 | Shortcuts modal (native dialog) |
| `src/lib/templateApi.ts` | 207 | API client + localStorage |
| `src/lib/supabase.ts` | 12 | Fetch wrapper |
| `src/hooks/useDockablePanel.ts` | — | Dockable panel state |
| `src/hooks/useLayerTree.ts` | — | Layer tree builder |
| `api/src/services/templates.ts` | ~270 | Template service (6s timeout + version strip) |
| `api/src/routes/batch.ts` | ~170 | CSV batch generation ({{slot}} substitution) |
| `api/src/routes/assets.ts` | 114 | Image upload to Supabase Storage |
| `api/src/routes/templates.ts` | ~400 | Template CRUD + base64 guard |
| `netlify/functions/api.mjs` | 96 | Express → Netlify bridge |
| `netlify/functions/mcp.mjs` | ~13800 | MCP server (250 tools) |
| `netlify.toml` | 22 | Build config + redirects |
