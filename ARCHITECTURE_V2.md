# 🏗️ Futuraria Design — Complete Architecture & MCP Documentation (V2)

> **Author:** Renzo Perez Bartra / Futuraria  
> **License:** MIT + CC BY 4.0 | **Stack:** $0/mes Freemium  
> **Date:** June 2026
>
> **⚠️ CRITICAL:** This document describes the CURRENT V2 architecture (full web HTML/CSS editor). The old `ARCHITECTURE.md` at the project root references a **deprecated Fabric.js v1** — ignore it entirely. There is **NO Fabric.js** in the current codebase. The `SKILL.md` may also contain Fabric.js v1 references — treat with skepticism.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Diagram](#2-architecture-diagram)
3. [Tech Stack](#3-tech-stack-v2--current)
4. [Project Structure](#4-project-structure)
5. [Frontend Architecture](#5-frontend-architecture)
   - 5.1 [Entry Point & Routing](#51-entry-point--routing)
   - 5.2 [EditorV2 — The Orchestrator](#52-editorv2--the-orchestrator)
   - 5.3 [Shadow DOM Rendering — DesignFrame](#53-shadow-dom-rendering--designframe)
   - 5.4 [Infinite Canvas System — InfiniteHtmlCanvas](#54-infinite-canvas-system--infinitehtmlcanvas)
   - 5.5 [Panel System](#55-panel-system)
   - 5.6 [Layer Tree — useLayerTree](#56-layer-tree--uselayertree)
   - 5.7 [Tool System — FloatingToolbar](#57-tool-system--floatingtoolbar)
   - 5.8 [Bidirectional Sync Flow](#58-bidirectional-sync-flow)
   - 5.9 [Undo/Redo System](#59-undoredo-system)
   - 5.10 [Google Fonts Integration](#510-google-fonts-integration)
   - 5.11 [All Panel Components](#511-all-panel-components)
6. [API Layer](#6-api-layer)
   - 6.1 [Express App Setup](#61-express-app-setup)
   - 6.2 [Middleware](#62-middleware)
   - 6.3 [Route Modules](#63-route-modules)
   - 6.4 [Services](#64-services)
   - 6.5 [API Server Entry](#65-api-server-entry)
7. [MCP Protocol — Complete Documentation](#7-mcp-protocol--complete-documentation)
   - 7.1 [Protocol Implementation](#71-protocol-implementation)
   - 7.2 [Transport Layer](#72-transport-layer)
   - 7.3 [Lifecycle Methods](#73-lifecycle-methods)
   - 7.4 [Rate Limiting](#74-rate-limiting)
   - 7.5 [Response Format](#75-response-format)
   - 7.6 [Handler Architecture](#76-handler-architecture)
   - 7.7 [Complete Tool Catalog — 100+ Tools](#77-complete-tool-catalog--100-tools)
   - 7.8 [MCP Client Library](#78-mcp-client-library)
   - 7.9 [Backward Compatibility](#79-backward-compatibility)
   - 7.10 [Key Helper Functions in mcp.mjs](#710-key-helper-functions-in-mcpmjs)
8. [Persistence Architecture](#8-persistence-architecture)
   - 8.1 [Dual-Write Strategy](#81-dual-write-strategy)
   - 8.2 [Auto-Save](#82-auto-save)
   - 8.3 [In-Memory Store](#83-in-memory-store)
   - 8.4 [Client-Side Freshness Check](#84-client-side-freshness-check)
   - 8.5 [Supabase Realtime](#85-supabase-realtime)
9. [Export & Render Pipeline](#9-export--render-pipeline)
   - 9.1 [Client-Side PNG Export](#91-client-side-png-export)
   - 9.2 [Render Worker](#92-render-worker)
   - 9.3 [Self-Rendering HTML](#93-self-rendering-html)
   - 9.4 [MCP Export Helper](#94-mcp-export-helper)
10. [Dashboard](#10-dashboard)
11. [Deployment Architecture](#11-deployment-architecture)
    - 11.1 [Netlify Configuration](#111-netlify-configuration)
    - 11.2 [Infrastructure](#112-infrastructure)
    - 11.3 [Local Development](#113-local-development)
12. [Data Models](#12-data-models)
13. [Key Design Patterns](#13-key-design-patterns)
14. [Deprecated/Misleading Documentation](#14-deprecatedmisleading-documentation)
15. [File Size Reference](#15-file-size-reference)

---

## 1. Executive Summary

Futuraria Design is a **WYSIWYG HTML/CSS design editor** with an integrated **MCP (Model Context Protocol) server** for AI agents. Think "Mini-Figma meets Cursor for design." The editor renders HTML/CSS in isolated **Shadow DOM** frames on an **infinite canvas**, provides visual element manipulation (drag, resize, property editing), and exposes **100+ MCP tools** via JSON-RPC 2.0 over SSE, enabling AI agents to create, edit, and render templates programmatically.

Key differentiators:

- **Zero Fabric.js** — pure HTML/CSS rendering in Shadow DOM within iframes
- **Multi-frame artboard system** (like Figma frames) on an infinite pan/zoom canvas
- **100+ MCP tools** across 20 categories (CRUD, drawing, fonts, AI, batch, brand, collaboration, export, etc.)
- **Dual-write persistence**: localStorage (instant, primary) → Supabase PostgreSQL (best-effort)
- **$0/month infrastructure**: Netlify Free + Supabase Free tier
- **Multi-agent collaboration** via Supabase Realtime (broadcast + presence)
- **Bidirectional code↔visual sync**: Edit CSS → Shadow DOM updates; drag elements → CSS code updates
- **Glass-morphism UI**: backdrop-filter blur panels with dark theme throughout
- **Google Fonts**: 94-font catalog with full weight/italic variant support, auto-injected into Shadow DOMs

---

## 2. Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          NETLIFY FREE ($0)                               │
│                                                                          │
│  ┌────────────────────┐  ┌──────────────────┐  ┌────────────────────┐   │
│  │  FRONTEND (SPA)    │  │  REST API        │  │  MCP SERVER        │   │
│  │  React 18 + TS     │  │  Express.js      │  │  JSON-RPC 2.0/SSE  │   │
│  │  Vite 5            │  │  17 route files  │  │  100+ tools        │   │
│  │  Monaco Editor     │  │  In-memory store │  │  Rate-limited       │   │
│  │  html2canvas       │  │  Rate-limited    │  │  Dual-write        │   │
│  └────────┬───────────┘  └────────┬─────────┘  └─────────┬──────────┘   │
│           │                       │                       │              │
│           └───────────────────────┼───────────────────────┘              │
│                                   │                                      │
│  ┌────────────────────────────────┴──────────────────────────────────┐  │
│  │  Netlify Functions Bridge                                         │  │
│  │  api.mjs (Express→Netlify)  │  mcp.mjs (SSE/MCP handler)          │  │
│  │  render.mjs (self-rendering HTML page)                            │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────┬──────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │     SUPABASE FREE ($0)        │
                    │     PostgreSQL 500MB          │
                    │     templates table           │
                    │     workspaces table          │
                    │     Realtime (WebSocket)      │
                    │     Broadcast + Presence      │
                    └───────────────────────────────┘
```

**Component Tree (Frontend):**

```
App (useReducer router)
├── Dashboard (template gallery)
│   └── Template cards with iframe thumbnails, rename/copy/export/delete
└── EditorV2 (orchestrator, 1278 lines)
    ├── FloatingToolbar (Select/V, Hand/H, Rect/R, Circle/O, Text/T, Pen/P, frame presets, undo/redo, zoom)
    ├── InfiniteHtmlCanvas (pan/zoom viewport, 244 lines)
    │   └── DesignFrame[] (Shadow DOM frames, 723 lines each)
    │       ├── Shadow DOM: <style> + <div id="__df_content"> + font <link>s
    │       └── Interaction Overlay: selection outlines, resize handles, tool handlers
    ├── HtmlLayersPanel (layer tree, drag-and-drop reorder, group/ungroup, 305 lines)
    ├── CodePanel (Monaco editor, HTML/CSS tabs, 170 lines)
    ├── HtmlContextualPanel (typography/color/spacing/layout, 507 lines)
    ├── StructurePanel (DOM analysis via MCP get_template_structure, 96 lines)
    ├── VariablesPanel (CSS variable editor via MCP get/set_css_variable, 115 lines)
    ├── ElementProperties (CSS property editor via MCP update_element, 171 lines)
    ├── BrandPanel (brand profile/validation/contrast/accessibility)
    ├── FormatPanel (format adaptation tools)
    ├── ActiveAgentsPanel (realtime agent presence)
    ├── AIPanel (AI generation controls)
    ├── BatchPanel / BatchAMator (batch generation)
    ├── ComponentsPanel (component library)
    ├── CreativePanel (creative tools)
    ├── GhostPanel (template exploration)
    ├── GovernancePanel (governance & compliance)
    ├── InsertToolbar (HTML element insertion)
    ├── KeyboardShortcuts (shortcut display)
    ├── PrototypePanel (prototyping tools)
    ├── QualityPanel (quality checks)
    ├── SkillPanel (skill management)
    └── Toast (notification system)
```

---

## 3. Tech Stack (V2 — Current)

| Layer | Technology | Version/Plan | Notes |
|-------|-----------|-------------|-------|
| **Frontend** | React 18 + TypeScript + Vite 5 | — | SPA, no SSR, StrictMode |
| **Canvas/Rendering** | Shadow DOM in iframe | — | **NO Fabric.js** — pure HTML/CSS |
| **Code Editing** | Monaco Editor (`@monaco-editor/react`) | — | HTML/CSS tabs, debounced 200ms |
| **Image Export** | html2canvas | 1.4.x | Client-side PNG at up to 4x scale |
| **Backend API** | Express.js 4 + TypeScript | — | 17 route modules, JSON 50MB limit |
| **Serverless Runtime** | Netlify Functions | Free tier | Edge/Node functions |
| **Database** | Supabase PostgreSQL | Free 500MB | templates + workspaces tables |
| **Realtime** | Supabase Realtime (WebSocket) | Free | Broadcast + Presence channels |
| **MCP Protocol** | JSON-RPC 2.0 over SSE | Custom impl | 100+ tools, rate-limited |
| **Fonts** | Google Fonts API | Free | 94-font catalog, full variant support |
| **Styling** | Glass-morphism CSS | — | `backdrop-filter: blur()` throughout |
| **Deployment** | Netlify + GitHub | Free | Auto-deploy on push to main |
| **Build** | Vite + tsc | — | `npm run build` = `tsc && vite build` |
| **Package Manager** | npm | — | Two package.json files (root + api/) |

**What does NOT exist in V2 (despite old docs claiming otherwise):**
- ❌ Fabric.js (any version)
- ❌ CanvasEditor component
- ❌ PropertiesPanel (replaced by HtmlContextualPanel)
- ❌ useCanvas hook (replaced by DesignFrame + InfiniteHtmlCanvas)
- ❌ Fabric.js StaticCanvas for render (replaced by html2canvas)
- ❌ Canvas objects (rect, circle, text objects on a Fabric canvas — replaced by HTML divs/spans in Shadow DOM)

---

## 4. Project Structure

```
design-main/
├── src/                          # Frontend React + TypeScript
│   ├── main.tsx                  # Entry point (React 18 StrictMode, renders <App />)
│   ├── App.tsx                   # Router via useReducer: "dashboard" | "editor-v2" (86 lines)
│   ├── types.ts                  # Frontend type definitions (33 lines): HtmlTemplate, FrameData, etc.
│   ├── index.css                 # Global styles (glass-morphism, dark theme)
│   ├── vite-env.d.ts             # Vite type declarations
│   │
│   ├── pages/
│   │   └── EditorV2.tsx          # 🔥 MAIN ORCHESTRATOR (1278 lines) — owns all state
│   │
│   ├── components/
│   │   ├── DesignFrame.tsx       # Shadow DOM frame + interaction + CSS sync (723 lines)
│   │   ├── InfiniteHtmlCanvas.tsx # Infinite pan/zoom canvas viewport (244 lines)
│   │   ├── FloatingToolbar.tsx   # Tool palette with keyboard shortcuts (216 lines)
│   │   ├── CodePanel.tsx         # Monaco HTML/CSS editor wrapper (170 lines)
│   │   ├── HtmlContextualPanel.tsx # Contextual element properties panel (507 lines)
│   │   ├── HtmlLayersPanel.tsx   # Layer tree with drag-and-drop (305 lines)
│   │   ├── ElementProperties.tsx # Element CSS property editor via MCP (171 lines)
│   │   ├── StructurePanel.tsx    # DOM structure analyzer via MCP (96 lines)
│   │   ├── VariablesPanel.tsx    # CSS variables editor via MCP (115 lines)
│   │   ├── GoogleFontPicker.tsx  # 94-font catalog picker (163 lines)
│   │   ├── Dashboard.tsx         # Template gallery with workspace selector (408 lines)
│   │   ├── BatchAMator.tsx       # Batch generation UI
│   │   ├── BatchPanel.tsx        # Batch controls
│   │   ├── BrandPanel.tsx        # Brand profile, validation, contrast, accessibility
│   │   ├── FormatPanel.tsx       # Format adaptation tools
│   │   ├── AIPanel.tsx           # AI generation controls (text, image, palette, layout)
│   │   ├── ActiveAgentsPanel.tsx # Realtime agent presence display
│   │   ├── ComponentsPanel.tsx   # Component library management
│   │   ├── CreativePanel.tsx     # Creative tools
│   │   ├── GhostPanel.tsx        # Ghost/template exploration
│   │   ├── GovernancePanel.tsx   # Governance & compliance
│   │   ├── InsertToolbar.tsx     # HTML element insertion toolbar
│   │   ├── KeyboardShortcuts.tsx # Keyboard shortcut reference display
│   │   ├── PrototypePanel.tsx    # Prototyping tools (interactions, animations, overlays)
│   │   ├── QualityPanel.tsx      # Quality checks and audits
│   │   ├── SkillPanel.tsx        # Skill management
│   │   ├── Toast.tsx             # Toast notification system
│   │   ├── HtmlCanvas.tsx        # (Legacy) Simple HTML canvas component
│   │   ├── HtmlToolbar.tsx       # (Legacy) HTML toolbar
│   │   └── toolbar/              # Toolbar sub-components directory
│   │
│   ├── hooks/
│   │   ├── useDockablePanel.ts   # Drag-and-dock panel system (156 lines)
│   │   ├── useDropdowns.ts       # Dropdown menu management hook
│   │   └── useLayerTree.ts       # HTML→layer tree parser + reorder/group/ungroup (207 lines)
│   │
│   ├── lib/
│   │   ├── mcpClient.ts          # JSON-RPC 2.0 client helper (20 lines)
│   │   ├── templateApi.ts        # Client-side template API with freshness check (221 lines)
│   │   ├── supabase.ts           # API fetch wrapper with dev-key auth (12 lines)
│   │   └── supabaseRealtime.ts   # Supabase Realtime client (94 lines)
│   │
│   └── shared/
│       ├── icons.tsx             # SVG icon components (IconFolder, IconFile, etc.)
│       └── index.ts              # Shared exports
│
├── api/                          # Express API (TypeScript, separate tsconfig)
│   ├── src/
│   │   ├── server.ts             # Express listen on :3001 (7 lines)
│   │   ├── index.ts              # Express app with 17 routes + middleware (83 lines)
│   │   ├── types.ts              # Server-side type definitions (250 lines)
│   │   │
│   │   ├── middleware/
│   │   │   ├── auth.ts           # API key / Bearer auth (24 lines)
│   │   │   ├── rateLimit.ts      # IP-based rate limiter, 100 req/min (46 lines)
│   │   │   └── index.ts          # Middleware barrel export
│   │   │
│   │   ├── routes/               # 17 route files
│   │   │   ├── templates.ts      # Template CRUD (13.1 KB — largest route file)
│   │   │   ├── workspaces.ts     # Workspace CRUD (4.5 KB)
│   │   │   ├── frames.ts         # Frame management (3.1 KB)
│   │   │   ├── layers.ts         # Layer operations (4.2 KB)
│   │   │   ├── styles.ts         # Style management (4.6 KB)
│   │   │   ├── variables.ts      # CSS variable CRUD (3.7 KB)
│   │   │   ├── versions.ts       # Version history (3.5 KB)
│   │   │   ├── render.ts         # Render job management (3.4 KB)
│   │   │   ├── recipes.ts        # Recipe system (5.3 KB)
│   │   │   ├── components.ts     # Component library (1.3 KB)
│   │   │   ├── comments.ts       # Comment system (3.6 KB)
│   │   │   ├── fonts.ts          # Font operations (1.7 KB)
│   │   │   ├── tools.ts          # Custom tool registration/execution (15.9 KB — 2nd largest)
│   │   │   ├── specs.ts          # Specification management (7.3 KB)
│   │   │   ├── webhooks.ts       # Webhook management (3.5 KB)
│   │   │   ├── batch.ts          # Batch operations (0.1 KB)
│   │   │   └── colors.ts         # Color operations (1.9 KB)
│   │   │
│   │   ├── services/
│   │   │   ├── templates.ts      # Template service with dual-write (234 lines)
│   │   │   ├── store.ts          # In-memory store + snapshot system (287 lines)
│   │   │   └── ...               # Additional service files
│   │   │
│   │   └── data/
│   │       └── google-fonts.json # 94-font catalog with family/category/variants
│   │
│   ├── dist/                     # Compiled API output
│   ├── package.json              # API-specific dependencies
│   └── tsconfig.json             # API-specific TypeScript config
│
├── netlify/functions/
│   ├── api.mjs                   # Express → Netlify serverless bridge (96 lines)
│   ├── mcp.mjs                   # 🔥 MCP SERVER — JSON-RPC 2.0 + SSE (4390 lines, 100+ tools)
│   └── render.mjs                # Self-rendering HTML page (254 lines)
│
├── docs/
│   ├── HTML_ENGINE_ARCHITECTURE.md   # ✅ Accurate V2 architecture doc (183 lines, slightly outdated counts)
│   ├── MCP_TOOL_CATALOG_V2.md        # ✅ MCP tool planning document (356 lines)
│   ├── DESIGN_HARNESS_ROADMAP.md     # Roadmap document
│   ├── DATABASE_SCHEMA.md            # Database schema documentation
│   ├── DB_IMPACT_ANALYSIS.md         # Database impact analysis
│   ├── ROADMAP.md                    # Project roadmap
│   ├── UI_PHASES.md                  # UI implementation phases
│   ├── SUPABASE_MIGRATIONS_DESIGN_HARNESS.sql  # SQL migration scripts
│   ├── GOAL_FASE0_HTML_CSS_POC.md    # Phase 0 goals
│   ├── GOAL_FASE1_COMPLETAR_ENGINE.md # Phase 1 goals
│   ├── GOAL_MASTER_DESIGN_HARNESS.md # Master design harness goals
│   ├── HTML_CSS_MIGRATION_ANALYSIS.md # Migration analysis doc
│   └── AAVE_GLASS_DESIGN_SYSTEM.md   # Design system reference
│
├── QA/                           # Test artifacts, screenshots, reports
│   └── (various screenshots, test reports, test plans)
│
├── research/                     # Research documents
│   ├── ai_harness_patterns.md
│   ├── collab_design_research.md
│   ├── figma-canvas-tools.md
│   ├── figma-systems-export.md
│   ├── paper-full-capabilities.md
│   └── repo_audit_jun18.md
│
├── packages/editor/              # (Legacy) Old editor package
├── dist/                         # Vite build output
├── public/
│   └── bg-dashboard.jpg          # Dashboard background image
│
├── Root configuration files:
│   ├── package.json              # Root package: React 18, Vite, html2canvas, Monaco, Supabase
│   ├── vite.config.ts            # Vite config with React plugin, @futuraria/shared alias, /api proxy
│   ├── netlify.toml              # Build + redirect rules
│   ├── tsconfig.json             # Root TypeScript config
│   ├── index.html                # SPA entry point (<div id="root">)
│   ├── .env.example              # Environment variable template
│   └── .gitignore                # Git ignore rules
│
├── Deprecated/Outdated (do not trust):
│   ├── ARCHITECTURE.md           # ❌ Fabric.js v1 doc — completely deprecated
│   ├── SKILL.md                  # ⚠️ May contain Fabric.js v1 references
│   └── BUGS_DESIGN_REPLICATION.md # ❌ Bug doc from Fabric.js era
│
├── Other root docs:
│   ├── 20_PRIORIDADES_MCP.md     # MCP priority list
│   ├── GAP_ANALYSIS_MINI_FIGMA.md # Gap analysis
│   ├── GAPS_FRAMES.md            # Frame system gaps
│   ├── BUG_SAVE_NO_PERSISTE.md   # Save persistence bug tracking
│   ├── ISO42001_READINESS.md     # ISO compliance
│   ├── MCP_IMPROVEMENTS.md       # MCP improvement notes
│   ├── PLAN_MCP_EDITOR_RENDER.md # Editor+render plan
│   ├── POSICIONAMIENTO_OPEN_SOURCE.md # Open source positioning
│   ├── QODER_TASKS.md            # Task tracking
│   ├── SETUP.md                  # Setup instructions
│   ├── SLASH_GOAL.md             # Slash goal document
│   ├── LICENSE.md                # MIT + CC BY 4.0
│   └── (various prompt files and screenshots)
└── test scripts:
    ├── test_mcp.mjs              # MCP test script
    └── test_render.mjs           # Render test script
```

---

## 5. Frontend Architecture

### 5.1 Entry Point & Routing

**`src/main.tsx`** (14 lines):
- Renders `<App />` in React 18 `StrictMode` into `document.getElementById("root")`
- Forces `GoogleFontPicker` import via window assignment to prevent tree-shaking

**`src/App.tsx`** (86 lines):
- Uses `useReducer` for routing with two views: `"dashboard"` | `"editor-v2"`
- URL parameters: `?template=ID&v=2` loads EditorV2 directly
- Template creation: `onCreateHtmlTemplate(workspaceId, name)` → `POST /api/templates` with `engine: "html"` → opens EditorV2

```typescript
// App.tsx routing model
type ViewMode = "dashboard" | "editor-v2";
type AppAction =
  | { type: "SET_VIEW"; view: ViewMode }
  | { type: "OPEN_TEMPLATE_V2"; id: string }
  | { type: "BACK_TO_DASHBOARD" };
```

State machine:
- `SET_VIEW "dashboard"` → renders `<Dashboard />`
- `OPEN_TEMPLATE_V2 <id>` → renders `<EditorV2 templateId={id} />`
- `BACK_TO_DASHBOARD` → returns to Dashboard

Template creation flow:
1. User clicks "+ HTML" in Dashboard
2. `onCreateHtmlTemplate(workspaceId, name)` called
3. `POST /api/templates` with `{ workspaceId, name, engine: "html", initialHtml, initialCss }`
4. Response contains `{ id }`
5. `dispatch({ type: "OPEN_TEMPLATE_V2", id: response.id })`
6. EditorV2 loads with new template

### 5.2 EditorV2 — The Orchestrator

**File:** `src/pages/EditorV2.tsx` (1278 lines)

The central state owner for the entire editor. All state flows through this component. No other component holds persistent state independently — they receive everything as props and communicate changes via callbacks.

**Core State:**

```typescript
frames: FrameData[]              // All artboards on canvas
selectedFrameId: string | null   // Currently active frame
activeTool: Tool                  // "select" | "hand" | "rect" | "circle" | "text" | "pen"
zoom: number                      // Canvas zoom level (0.1–5.0)
selectedElement: SelectedElementInfo | null  // Currently selected DOM element
undoStack: string[]               // JSON snapshots (max 50)
redoStack: string[]               // JSON snapshots for redo
showCodePanel: boolean            // Monaco code panel visibility
showLeftPanel: boolean            // Left panel visibility
showRightPanel: boolean           // Right panel visibility
rightPanelTab: string             // Active right panel tab
```

**Layout:** 
```
┌────────────────────────────────────────────────────────────┐
│ FloatingToolbar (top, always visible)                      │
├──────┬──────────────────────────────────────────┬──────────┤
│ Left │  InfiniteHtmlCanvas (center)              │ Right    │
│ Panel│    └── DesignFrame[] (artboards)          │ Panel    │
│      │                                            │ (dockable)│
│      │                                            │          │
├──────┴──────────────────────────────────────────┴──────────┤
│ CodePanel (bottom, Monaco HTML/CSS)                         │
└────────────────────────────────────────────────────────────┘
```

**Core Functions:**

| Function | Description |
|----------|-------------|
| `handleHtmlChange(frameId, newHtml)` | Updates frame HTML → triggers re-render → auto-save |
| `handleCssChange(frameId, newCss)` | Updates frame CSS → triggers Shadow DOM + CodePanel update → auto-save |
| `autoSave()` | Debounced 2s, dual-write: localStorage → API PUT with exponential backoff |
| `addFrame(preset)` | Creates new frame at canvas center with preset dimensions |
| `deleteFrame(frameId)` | Removes frame, selects nearest remaining frame |
| `duplicateFrame(frameId)` | Deep-clones frame with offset position |
| `captureFrameToPng(frameId)` | Renders frame to PNG via html2canvas, returns blob |
| `handleDrawShape(frameId, shape, x, y, w, h)` | Creates div primitive in frame HTML |
| `handleTextChange(frameId, elementId, text)` | Updates text content of text element |
| `handleAddPenPath(frameId, points)` | Creates SVG polyline from pen points |
| `handleDeleteElement(frameId, elementId)` | Removes element from frame HTML |
| `handleDuplicateElement(frameId, elementId)` | Clones element with new layer ID |
| `handleChangeTag(frameId, elementId, newTag)` | Changes semantic HTML tag |
| `handleUndo()` / `handleRedo()` | JSON snapshot restore from undo/redo stacks |
| `injectFontIntoShadowDOMs(fontUrl)` | Injects font link into all active Shadow DOMs |
| `startRenderWorker()` | Background polling for MCP-created render jobs |
| `pushUndo()` | Saves current frames[] JSON to undo stack (max 50) |

**Auto-Save Flow (Detailed):**

```
User action (draw, type, drag, CSS change)
  │
  ├─→ pushUndo() — save snapshot to undo stack
  │
  ├─→ frames[] state update (React setState)
  │
  └─→ debounce 2 seconds
        │
        ├─→ localStorage.setItem("futuraria_local_templates", JSON.stringify({
        │     id: templateId,
        │     frames: [...],
        │     updatedAt: new Date().toISOString()
        │   }))
        │   Status: "Saved" badge
        │
        └─→ PUT /api/templates/{id}
              Body: { name, width, height, engine: "html", html, css, frames, metadata }
              │
              ├─→ Success (2xx): Status → "Saved"
              │
              └─→ Failure:
                    Retry 1: 1s delay → retry
                    Retry 2: 2s delay → retry
                    Retry 3: 4s delay → retry
                    All failed: Status → "Error" (data still in localStorage)
```

**Render Worker:**

```
setInterval(15000ms):
  GET /api/render/queue/pending
    │
    └─→ For each pending render job:
          ├─→ captureFrameToPng(job.frameId, { scale: job.scale || 2 })
          ├─→ Convert blob to base64 data URL
          └─→ POST /api/render/{jobId}/complete
                Body: { imageUrl: dataUrl, width, height, format: "png" }
```

**Export PNG Pipeline (`captureFrameToPng`):**

```
1. Get frame data (html, css, width, height)
2. Create offscreen container div (position: absolute, left: -9999px)
3. Set innerHTML to frame's HTML
4. Extract Google Font @import links from CSS via regex
5. Create <link rel="stylesheet"> elements for each font
6. Append links to container
7. Create <style> element with frame's CSS
8. Append style to container
9. Append container to document.body
10. Wait for document.fonts.ready (font loading)
11. html2canvas(container, {
      scale: requestedScale (1-4x),
      backgroundColor: frame.background || "#ffffff",
      useCORS: true,
      logging: false
    })
12. canvas.toBlob("image/png", quality)
13. Remove container from DOM
14. Return PNG blob
```

**Export Menu Options:**
- Export current frame as PNG
- Export all frames as individual PNGs
- Export as JSON (.futuraria format)

**Keyboard Shortcuts:**

| Key | Action |
|-----|--------|
| V | Select tool |
| H | Hand/pan tool |
| R | Rectangle tool |
| O | Circle tool |
| T | Text tool |
| P | Pen tool |
| Ctrl+Z | Undo |
| Ctrl+Shift+Z | Redo |
| Ctrl+S | Save (manual trigger) |
| Delete | Delete selected frame or element |
| Ctrl+D | Duplicate selected frame or element |
| Ctrl+/ | Toggle code panel |
| Escape | Deselect element |

### 5.3 Shadow DOM Rendering — DesignFrame

**File:** `src/components/DesignFrame.tsx` (723 lines)

The core rendering engine. Each frame (artboard) is a self-contained HTML/CSS document rendered in a **Shadow DOM** within an iframe, providing complete CSS isolation from other frames and the editor UI.

**Three-Layer Architecture:**

```
┌─────────────────────────────────────────┐
│  iframe (sandboxed)                      │
│  ┌─────────────────────────────────────┐│
│  │  Shadow DOM Root                     ││
│  │  ┌─────────────────────────────────┐ ││
│  │  │ <link> Google Font imports       │ ││
│  │  │ <style> Frame CSS                │ ││
│  │  │ <div id="__df_content">          │ ││
│  │  │   Frame HTML (innerHTML)         │ ││
│  │  │ </div>                           │ ││
│  │  │ <div id="__df_overlay">          │ ││
│  │  │   Selection outlines             │ ││
│  │  │   Resize handles (8 corners)     │ ││
│  │  │   Tool previews                  │ ││
│  │  │ </div>                           │ ││
│  │  └─────────────────────────────────┘ ││
│  └─────────────────────────────────────┘│
│  Interaction handlers (mousedown/move/up)│
└─────────────────────────────────────────┘
```

**Interaction System (Unified mousedown Handler):**

All mouse interactions are handled through a single handler on the overlay div, switching behavior based on `activeTool`:

| Tool | Behavior | Result |
|------|----------|--------|
| **Select (V)** | Click element → select (blue outline + 8 corner handles). Drag selected element → move (sets `position: absolute`, updates `left`/`top`). Drag handle → resize (updates `width`/`height`). | Updates CSS rule for element |
| **Rect (R)** | Mousedown → start rect. Mousemove → live preview div. Mouseup → create final `<div>` with `border: 2px solid`. | Adds `<div data-layer-id="el_...">` to HTML + CSS rule with `position: absolute; left; top; width; height; border` |
| **Circle (O)** | Same as rect but adds `border-radius: 50%`. | Creates circular div |
| **Text (T)** | Click → place `<span contenteditable>`. User types. Blur or Enter → commit. | Creates text element with position |
| **Pen (P)** | Click → add point. Live SVG polyline preview. Double-click or Enter → finish. | Creates `<svg><polyline points="..."></svg>` with CSS rule |

**Element Selection Flow:**

```
1. User clicks element in Shadow DOM content
2. Event target: the actual DOM element (span, div, h1, etc.)
3. Get element's data-layer-id attribute → elementId
4. Build CSS selector: [data-layer-id="el_abc123"]
5. Get computed styles: window.getComputedStyle(element)
6. Create SelectedElementInfo: { layerId, tag, selector, computedStyles, frameId }
7. Call onElementSelect(selectedElementInfo)
8. EditorV2 sets selectedElement state
9. Render selection overlay (blue border + 8 resize handles)
10. HtmlContextualPanel receives element → shows properties
```

**Drag-to-Move Flow:**

```
1. Mousedown on selected element → record start position
2. Mousemove:
   - Set element.style.position = "absolute"
   - Update element.style.left = startLeft + deltaX
   - Update element.style.top = startTop + deltaY
   - Live visual movement
3. Mouseup:
   - syncLockRef = true (prevent Code→DOM update loop)
   - updateCssRule(css, selector, { position: "absolute", left: newLeft, top: newTop })
   - Call onCssChange(frameId, updatedCss)
   - EditorV2 updates frames[] state
   - syncLockRef reset on next frame render
```

**Resize Flow:**

```
1. Mousedown on corner handle → identify direction (nw, ne, sw, se, n, s, e, w)
2. Mousemove:
   - Update element.style.width and element.style.height
   - For n/s sides: adjust top and height
   - For e/w sides: adjust left and width
   - For corners: adjust both
   - Live visual resize
3. Mouseup:
   - syncLockRef = true
   - updateCssRule(css, selector, { width, height, left?, top? })
   - Call onCssChange(frameId, updatedCss)
```

**CSS Sync Engine:**

- **Code → DOM**: `useEffect` on `frame.css` → updates Shadow DOM `<style>.textContent` + injects font `<link>` elements
- **DOM → Code**: After drag/resize/pen, `updateCssRule()` modifies the CSS string → calls `onCssChange`
- **Sync Lock**: `syncLockRef` flag prevents infinite update loops — DOM→Code sets flag, Code→DOM skips if flag set

**`updateCssRule(css, selector, properties)` — regex-based CSS modification:**

```javascript
function updateCssRule(css, selector, { prop1: value1, prop2: value2, ... }) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ruleRe = new RegExp(`(${escaped}\\s*\\{)`, 'g');
  
  if (ruleRe.test(css)) {
    // Rule exists — update/add properties
    const ruleBodyRe = new RegExp(`(${escaped}\\s*\\{)([^}]*)(\\})`);
    let body = match[2];
    for (const [prop, value] of Object.entries(properties)) {
      const propRe = new RegExp(`${prop}\\s*:[^;]*;?`);
      if (propRe.test(body)) {
        body = body.replace(propRe, `${prop}: ${value};`);
      } else {
        body += `\n  ${prop}: ${value};`;
      }
    }
    return css.replace(ruleBodyRe, `$1${body}$3`);
  } else {
    // Rule doesn't exist — create new rule
    const newRule = `${selector} {\n  ${Object.entries(properties).map(([p,v]) => `${p}: ${v};`).join('\n  ')}\n}`;
    return css + '\n' + newRule;
  }
}
```

**Key Static Functions:**

| Function | Purpose |
|----------|---------|
| `getSelector(element)` | Builds CSS selector from `data-layer-id` attribute: `[data-layer-id="..."]` |
| `updateCssRule(css, selector, props)` | Regex-based CSS rule creation/update |
| `extractFontImports(css)` | Parses `@import url(...)` from CSS string |
| `normalizeCssValue(value)` | Adds "px" to bare numbers for dimension properties |
| `toHex(color)` | Converts CSS color strings to hex format |

**TRACKED_PROPS:** 24 CSS properties automatically detected and displayed in the contextual panel:

```
font-family, font-size, font-weight, font-style, color, 
background-color, background, margin, margin-top, margin-right, 
margin-bottom, margin-left, padding, padding-top, padding-right,
padding-bottom, padding-left, border, border-radius, display,
width, height, gap, opacity, text-align, letter-spacing, 
line-height, text-decoration, text-transform,
position, left, top, right, bottom
```

**SelectedElementInfo Type:**

```typescript
interface SelectedElementInfo {
  layerId: string;        // data-layer-id value or auto-generated ID
  tag: string;            // HTML tag name (lowercase)
  selector: string;       // CSS selector: [data-layer-id="el_abc123"]
  computedStyles: Record<string, string>;  // window.getComputedStyle results
  frameId: string;        // Parent frame ID
}
```

### 5.4 Infinite Canvas System — InfiniteHtmlCanvas

**File:** `src/components/InfiniteHtmlCanvas.tsx` (244 lines)

The "desk" metaphor — an infinite pannable/zoomable viewport holding all DesignFrame components.

**Pan Controls:**
- Middle mouse button drag (always available)
- Hand tool (H) + left mouse drag
- Two-finger trackpad scroll

**Zoom Controls:**
- Scroll wheel → zoom toward cursor position
- Zoom buttons in FloatingToolbar
- Range: 0.1x (10%) to 5.0x (500%)

**Transform:** CSS `transform: translate(panX, panY) scale(zoom)` applied to wrapper div

**Frame Dragging:**
- Select tool (V) + mousedown on frame header → direct DOM translate manipulation for performance
- Commits final position via `onFrameMove(frameId, newX, newY)` on mouseup

**Auto-Center:** On first mount, calculates bounding box of all frames and pans to center them.

**Rendering:**

```tsx
<div style={{ overflow: "hidden", width: "100%", height: "100%" }}>
  <div style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "0 0" }}>
    {frames.map(frame => (
      <DesignFrame
        key={frame.id}
        frame={frame}
        isSelected={frame.id === selectedFrameId}
        activeTool={activeTool}
        onSelect={() => onSelectFrame(frame.id)}
        onMove={(x, y) => onFrameMove(frame.id, x, y)}
        onElementSelect={(el) => onElementSelect(frame.id, el)}
        onCssChange={(css) => onCssChange(frame.id, css)}
        onHtmlChange={(html) => onHtmlChange(frame.id, html)}
        onElementDelete={(elId) => onElementDelete(frame.id, elId)}
        onElementDuplicate={(elId) => onElementDuplicate(frame.id, elId)}
        onChangeTag={(elId, tag) => onChangeTag(frame.id, elId, tag)}
        zoom={zoom}
      />
    ))}
  </div>
</div>
```

### 5.5 Panel System

All panels use the **Dockable Panel Hook** (`useDockablePanel`, 156 lines) for consistent drag-and-dock behavior.

**Dock States:**

```
Panel can be:
  - DOCKED LEFT:    x=0, y=44, attached to left edge
  - DOCKED RIGHT:   x=windowWidth - panelWidth, y=44, attached to right edge
  - FLOATING:       free x,y position, higher z-index (25 vs 15)
```

**Dock/Undock Behavior:**
- Drag panel near left edge (<30px) → snap to left dock
- Drag panel near right edge (<30px) → snap to right dock
- Drag docked panel >60px from edge → undock
- Double-click docked panel header → undock
- Toggle button → toggle between docked and floating

**Animation:** 200ms CSS transition on `left` and `top` properties.

**`useDockablePanel` API:**

```typescript
function useDockablePanel(initialX: number, initialY: number, defaultDock?: DockSide) {
  return {
    state: { x, y, isDocked, dockSide },
    startDrag: (e: React.MouseEvent) => void,     // Attach to header onMouseDown
    toggleDock: (side: DockSide) => void,          // Toggle dock state
    panelStyle: (width: number) => CSSProperties,  // Get computed position CSS
    handleProps: { onMouseDown, style }            // Spread on drag handle element
  };
}
```

**Right Panel Tabs (contextual, in EditorV2):**

| Tab | Component | Description |
|-----|-----------|-------------|
| Properties | HtmlContextualPanel | Full element property editor (typography, color, spacing, layout) |
| Structure | StructurePanel | DOM tree analysis via MCP `get_template_structure` |
| Vars | VariablesPanel | CSS custom property editor via MCP |
| Brand | BrandPanel | Brand profile management, validation, contrast checks |
| Format | FormatPanel | Format adaptation (resize, reformat) |
| Agents | ActiveAgentsPanel | Real-time agent presence and section claims |

**Left Panel:**

| Panel | Component | Description |
|-------|-----------|-------------|
| Layers | HtmlLayersPanel | Tree view with drag-drop reorder, context menu, group/ungroup |

**Bottom Panel:**

| Panel | Component | Description |
|-------|-----------|-------------|
| Code | CodePanel | Monaco editor, HTML/CSS tabs, 200ms debounced onChange |

### 5.6 Layer Tree — useLayerTree

**File:** `src/hooks/useLayerTree.ts` (207 lines)

Parses HTML string into a flat tree of `LayerNode` objects for display in the layers panel.

**LayerNode Type:**

```typescript
interface LayerNode {
  layerId: string;       // data-layer-id value or "auto_N"
  tag: string;           // HTML tag name
  text: string;          // Text content preview (40 chars max)
  depth: number;         // Nesting depth from body
  parentId: string | null;
  children: string[];    // Child layer IDs
  path: number[];        // DOM child-index path for auto-generated layers
}
```

**Parsing Logic (`parseLayerTree`):**

```
1. Parse HTML with DOMParser
2. Walk DOM tree starting at body.children
3. For each element:
   - Skip structural wrappers: <div> without data-layer-id, no direct text, has children
   - Use data-layer-id if present, else generate "auto_N" ID
   - Track depth via stack, parent-child via parentId
   - Extract text preview from direct textContent
   - Build child-index path array
4. Return flat array of LayerNode for ordered rendering
```

**Tag Icons & Colors:**

| Tag | Icon | Color |
|-----|------|-------|
| h1-h6 | H1-H6 | #c8b898 (gold) |
| p, span, a | ¶, S, 🔗 | #a8c8e8 (blue) |
| div, section, header, footer, nav, main | ▣, §, ⌂, ⊥, ☰, ⛶ | #8ab8a8 (green) |
| img, svg | 🖼, 📐 | #e8c8a8 (orange) |
| ul, ol, li | ≡, ≣, • | #c8a8e8 (purple) |
| Others | First letter | #888 (gray) |

**Layer Operations:**

| Function | Description |
|----------|-------------|
| `reorderLayerInHtml(html, layerId, direction)` | Moves element up/down in HTML by regex extraction and re-insertion. Returns null for auto-generated layers. |
| `groupLayersInHtml(html, layerIds[])` | Wraps multiple elements in a `<div data-layer-id="grp_...">`. Returns `{ html, groupId }`. |
| `ungroupLayerInHtml(html, groupId)` | Extracts children from wrapper div, removes the wrapper. |

**Layer Panel Features:**
- Drag-and-drop to reorder (HTML5 drag API)
- Ctrl/Cmd+click for multi-select
- Context menu: Duplicate, Delete, Move Up, Move Down, Group (2+ selected), Ungroup
- Collapse/expand groups
- Hover highlight, selection highlight with blue left border

### 5.7 Tool System — FloatingToolbar

**File:** `src/components/FloatingToolbar.tsx` (216 lines)

Tool palette with glass-morphism styling, positioned at top-center of the editor.

**Tool Buttons:**

| Tool | Key | Icon | Description |
|------|-----|------|-------------|
| Select | V | Arrow pointer | Select/move elements and frames |
| Hand | H | Hand | Pan the canvas |
| Rect | R | Rectangle | Draw rectangle primitives |
| Circle | O | Circle | Draw circle primitives |
| Text | T | T | Place text elements |
| Pen | P | Pen nib | Draw polyline paths |

Each button shows the keyboard shortcut as a small label below.

**Frame Presets Dropdown:**

| Preset | Width | Height | Use Case |
|--------|-------|--------|----------|
| IG Square | 1080 | 1080 | Instagram square post |
| IG Story | 1080 | 1920 | Instagram/Reels story |
| IG Feed | 1080 | 1350 | Instagram portrait post |
| Banner | 1920 | 1080 | Web hero banner |
| Twitter/X | 1200 | 628 | Twitter/X card |

**Undo/Redo Buttons:**
- Undo: Back arrow icon, disabled when undoStack is empty
- Redo: Forward arrow icon, disabled when redoStack is empty

**Zoom Controls:**
- Zoom Out (-) button
- Zoom percentage display (clickable to reset to 100%)
- Zoom In (+) button
- Fit All button

**Styling:** Glass-morphism with `background: rgba(18,18,36,0.85)`, `backdrop-filter: blur(10px)`, `border: 1px solid rgba(255,255,255,0.06)`, `border-radius: 12px`.

### 5.8 Bidirectional Sync Flow

**Code → Visual (User edits code in Monaco):**

```
CodePanel onChange (debounced 200ms)
  → handleHtmlChange(frameId, newHtml) or handleCssChange(frameId, newCss)
    → EditorV2 frames[] state update
      → React re-render
        → DesignFrame useEffect(frame.css, frame.html)
          → Shadow DOM <style>.textContent = newCss
          → Shadow DOM #__df_content.innerHTML = newHtml
            → Browser renders updated content
              → syncLockRef = false (allow DOM→Code)
```

**Visual → Code (User drags/resizes element):**

```
DesignFrame mousedown on element → record start position
  → mousemove → DOM element.style.left/top/width/height updated live
    → mouseup
      → syncLockRef = true (prevent Code→DOM during state update)
      → updateCssRule(cssString, selector, { position, left, top })
      → onCssChange(frameId, updatedCss)
        → EditorV2 handleFrameCssChange(frameId, updatedCss)
          → frames[] state update
            → React re-render
              → CodePanel receives new CSS prop
              → DesignFrame useEffect → skips because syncLockRef is true
                → Next render: syncLockRef reset, normal sync resumes
```

**Contextual Panel → Both (User changes property in panel):**

```
HtmlContextualPanel updateProp(selector, prop, value)
  → updateCssProperty(css, selector, prop, value)
    → onCssChange(updatedCss)
      → EditorV2 handleCssChange
        → frames[] update
          → React re-render
            → CodePanel: CSS text updated
            → DesignFrame: Shadow DOM <style> updated
              → Visual update visible immediately
```

### 5.9 Undo/Redo System

**Storage:** JSON serialization of `frames[]` array.

**Max Depth:** 50 snapshots (oldest pushed out when limit reached).

**Trigger:** `pushUndo()` called before any state mutation:
- Frame add/delete/duplicate/move
- Element add/delete/duplicate/move/resize
- CSS change via code, drag, or contextual panel
- HTML change via code
- Text edit
- Pen path creation
- Shape drawing

**Implementation:**

```typescript
function pushUndo() {
  setUndoStack(prev => {
    const snapshot = JSON.stringify(frames);
    const next = [...prev, snapshot];
    if (next.length > 50) next.shift(); // Keep max 50
    return next;
  });
  setRedoStack([]); // Clear redo on new action
}

function handleUndo() {
  if (undoStack.length === 0) return;
  const snapshot = undoStack[undoStack.length - 1];
  setRedoStack(prev => [...prev, JSON.stringify(frames)]);
  setUndoStack(prev => prev.slice(0, -1));
  setFrames(JSON.parse(snapshot));
}

function handleRedo() {
  if (redoStack.length === 0) return;
  const snapshot = redoStack[redoStack.length - 1];
  setUndoStack(prev => [...prev, JSON.stringify(frames)]);
  setRedoStack(prev => prev.slice(0, -1));
  setFrames(JSON.parse(snapshot));
}
```

### 5.10 Google Fonts Integration

**Data Source:** `api/src/data/google-fonts.json` — 94 fonts with family, category, and variants.

**API Endpoint:** `GET /api/fonts/catalog?search=<query>&category=<cat>&limit=<n>&offset=<n>`

**GoogleFontPicker Component (163 lines):**
- Fetches font catalog on mount from `/api/fonts/catalog?limit=200`
- Searchable dropdown with text input
- Category filter pills: Sans, Serif, Display, Hand, Mono
- Each font rendered in its own typeface for preview
- Selected font highlighted in green
- Outside-click closes dropdown

**Font Loading:**
- `loadFont(family, variants)` creates a `<link>` element in document head: `https://fonts.googleapis.com/css2?family=<Family>:wght@400;700&display=swap`
- Deduplication by link ID (`gf-<family-name>`)

**Shadow DOM Injection:**
- `injectFontIntoShadowDOMs(fontUrl)` finds all frame elements by `[data-frame-id]` attribute
- For each frame, accesses the Shadow DOM root
- Injects a `<link rel="stylesheet">` element with the full font URL including all weights (100-900) and styles (normal, italic)
- Deduplication check prevents duplicate links

**CSS @import Auto-Insertion:**
When `font-family` is set via the HtmlContextualPanel:
1. Check if font is a known system font — if so, skip @import
2. Build Google Fonts URL with full variant support
3. Check if @import already exists in CSS
4. If not, prepend: `@import url('https://fonts.googleapis.com/css2?family=<Name>:ital,wght@0,100;0,200;...;0,900;1,100;...;1,900&display=swap');\n`
5. Direct injection into Shadow DOM for immediate rendering

### 5.11 All Panel Components

**HtmlContextualPanel (`src/components/HtmlContextualPanel.tsx`, 507 lines):**

The most feature-rich panel. Four collapsible sections:

**Typography Section (only shown for text elements: h1-h6, p, span, a, li, label, button):**

| Property | Control | Notes |
|----------|---------|-------|
| Font Family | GoogleFontPicker dropdown | Triggers @import auto-insertion |
| Font Size | Text input | Auto-adds "px" to bare numbers |
| Font Weight | Select (100-900) | Thin through Black |
| Text Align | 4-button toggle | Left, Center, Right, Justify |
| Letter Spacing | Text input | With px unit normalization |
| Line Height | Text input | |
| Text Decoration | Select | None, Underline, Overline, Line-through |
| Text Transform | Select | None, UPPERCASE, lowercase, Capitalize |

**Color Section:**

| Property | Control | Notes |
|----------|---------|-------|
| Text Color | Color picker + text input | Supports hex, rgb, named colors |
| Background Color | Color picker + text input | |
| Opacity | Range slider (0-1) | Live percentage display |

**Spacing Section:**

| Property | Control |
|----------|---------|
| Margin | Text input |
| Padding | Text input |
| Border | Text input |
| Border Radius | Text input |

**Layout Section:**

| Property | Control | Options |
|----------|---------|---------|
| Display | Select | Block, Flex, Grid, Inline, Inline-Block, None |
| Width | Text input | Auto px normalization |
| Height | Text input | |
| Gap | Text input | |

**Header Section:**
- Shows element tag name (e.g., "DIV", "H1") in gold color
- Shows CSS selector in monospace
- Semantic Tag selector dropdown (33 tags): div, section, article, aside, header, footer, nav, main, h1-h6, p, span, a, button, label, input, form, ul, ol, li, img, figure, figcaption, table, thead, tbody, tr, td, th

**CSS Value Normalization:** The `normalizeCssValue()` function auto-adds "px" to bare numeric values for dimension properties (font-size, width, height, margin, padding, border-radius, gap, top, left, right, bottom, letter-spacing).

**Commit on Enter:** Input fields support Enter to apply immediately instead of waiting for blur.

**Google Font Injection:** The `injectFontIntoShadowDOMs(fontUrl)` function bypasses React state by directly manipulating Shadow DOM link elements.

**ElementProperties (`src/components/ElementProperties.tsx`, 171 lines):**

A simpler alternative panel for element property editing via MCP:

- Shows element tag, class, and ID
- Quick property buttons: Color, Bg, Font, Center, Radius, Pad
- Current CSS properties display
- Custom CSS textarea with "Apply CSS" button
- Calls MCP `update_element` tool → refreshes template from API

**StructurePanel (`src/components/StructurePanel.tsx`, 96 lines):**

- "Analyze Structure" button → calls MCP `get_template_structure`
- Displays elements with color-coded tags, CSS selectors, and class names
- Click element → `onSelectElement(elementId)`

**VariablesPanel (`src/components/VariablesPanel.tsx`, 115 lines):**

- "Load Variables" button → calls MCP `get_css_variables`
- Lists all CSS custom properties from `:root`
- Click-to-edit with inline input
- Save via MCP `set_css_variable` → refresh template CSS

**CodePanel (`src/components/CodePanel.tsx`, 170 lines):**

Monaco editor wrapper:
- Two tabs: HTML and CSS
- Debounced 200ms onChange
- forwardRef with: `scrollToLine(line)`, `switchToTab(tab)`, `undo()`, `redo()`
- CSS properties panel visual style with glass background

**Dashboard (`src/components/Dashboard.tsx`, 408 lines):**

Template gallery:
- Workspace selector dropdown with "All Templates" option
- Inline workspace creation (+ Workspace button → input)
- Search input (filters by name)
- "+ HTML" button to create new HTML engine template
- Template grid with iframe thumbnail previews (transform: scale(0.15))
- Card actions: Rename (double-click), Copy (duplicate), Export (.futuraria.json), Delete
- Glass-morphism styling with `/bg-dashboard.jpg` background

---

## 6. API Layer

### 6.1 Express App Setup

**File:** `api/src/index.ts` (83 lines)

```typescript
const app = express();

// Middleware stack
app.use(cors());                          // All origins allowed
app.use(express.json({ limit: "50mb" })); // Large payload support
app.use(rateLimit);                       // IP-based, 100 req/min
app.use(auth);                            // API key / Bearer token

// Health check
app.get("/api/health", (req, res) => {
  res.json({ success: true, timestamp: new Date().toISOString() });
});

// Font catalog endpoint
app.get("/api/fonts/catalog", async (req, res) => {
  const { search, category, limit, offset } = req.query;
  // Filters google-fonts.json catalog
  // Returns: { success: true, data: { fonts: [...], total } }
});

// Route modules (17)
app.use("/api/templates", templatesRouter);
app.use("/api/workspaces", workspacesRouter);
app.use("/api/recipes", recipesRouter);
app.use("/api/webhooks", webhooksRouter);
// ... etc
```

### 6.2 Middleware

**Auth (`api/src/middleware/auth.ts`, 24 lines):**

```typescript
export function auth(req: Request, _res: Response, next: NextFunction) {
  const apiKey = req.headers["x-api-key"] as string;
  const bearer = req.headers.authorization?.replace("Bearer ", "");

  if (apiKey) {
    req.auth = { userId: apiKey };
  } else if (bearer) {
    req.auth = { userId: bearer };
  } else {
    req.auth = { userId: "dev_user_default" };  // Fallback for dev
  }
  next();
}
```

- Extends Express Request type with `auth?: { userId: string }`
- Never rejects requests — always sets a userId (falls back to "dev_user_default")
- Designed for development/internal use, not production-grade auth

**Rate Limiter (`api/src/middleware/rateLimit.ts`, 46 lines):**

```typescript
const MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX || "100", 10);
const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10); // 1 min

export function rateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = req.headers["x-forwarded-for"] as string || req.socket?.remoteAddress || "unknown";
  const now = Date.now();

  let entry = store.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    store.set(ip, entry);
  }
  entry.count++;

  // Set rate limit headers
  res.setHeader("X-RateLimit-Limit", MAX_REQUESTS);
  res.setHeader("X-RateLimit-Remaining", Math.max(0, MAX_REQUESTS - entry.count));
  res.setHeader("X-RateLimit-Reset", Math.ceil(entry.resetAt / 1000));

  if (entry.count > MAX_REQUESTS) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    res.setHeader("Retry-After", retryAfter);
    return res.status(429).json({
      success: false,
      error: "Too many requests",
      retryAfter,
    });
  }

  // Lazy cleanup of stale entries
  for (const [key, e] of store) {
    if (now > e.resetAt) store.delete(key);
  }

  next();
}
```

**Default:** 100 requests per 60-second window per IP. Configurable via env vars.

### 6.3 Route Modules (17 files)

| Route File | Size | Purpose | Key Endpoints |
|-----------|------|---------|---------------|
| `templates.ts` | 13.1 KB | Template CRUD and operations | GET/POST `/api/templates`, GET/PUT/DELETE `/api/templates/:id`, POST `/api/templates/:id/duplicate`, GET `/api/templates/:id/export`, POST `/api/templates/import` |
| `workspaces.ts` | 4.5 KB | Workspace management | GET/POST `/api/workspaces`, GET/PUT/DELETE `/api/workspaces/:id` |
| `frames.ts` | 3.1 KB | Frame (artboard) management | GET/POST `/api/templates/:id/frames`, GET/PUT/DELETE `/api/templates/:id/frames/:frameId` |
| `layers.ts` | 4.2 KB | Layer operations | GET/POST `/api/templates/:id/layers`, PUT/DELETE `/api/templates/:id/layers/:layerId`, POST `/api/templates/:id/layers/reorder`, POST `/api/templates/:id/layers/group`, POST `/api/templates/:id/layers/ungroup` |
| `styles.ts` | 4.6 KB | Style management | GET/POST `/api/templates/:id/styles`, GET/PUT/DELETE `/api/templates/:id/styles/:styleId` |
| `variables.ts` | 3.7 KB | CSS variable operations | GET `/api/templates/:id/variables`, POST/PUT/DELETE variables |
| `versions.ts` | 3.5 KB | Version history | GET `/api/templates/:id/versions`, POST `/api/templates/:id/versions/:versionId/restore` |
| `render.ts` | 3.4 KB | Render job management | GET/POST `/api/render/queue`, GET `/api/render/queue/pending`, POST `/api/render/:jobId/complete` |
| `recipes.ts` | 5.3 KB | Recipe system | Full CRUD for design recipes |
| `components.ts` | 1.3 KB | Component library | CRUD for reusable components |
| `comments.ts` | 3.6 KB | Comment system | CRUD for template comments |
| `fonts.ts` | 1.7 KB | Font operations | Font listing, adding fonts to templates |
| `tools.ts` | 15.9 KB | Custom tool management | Registration and execution of custom tools (plugin system) |
| `specs.ts` | 7.3 KB | Specifications | CRUD for design specifications |
| `webhooks.ts` | 3.5 KB | Webhook management | CRUD for webhook URLs |
| `batch.ts` | 0.1 KB | Batch operations | Batch job management |
| `colors.ts` | 1.9 KB | Color operations | Color manipulation and conversion |

### 6.4 Services

**Template Service (`api/src/services/templates.ts`, 234 lines):**

Functions:

| Function | Description |
|----------|-------------|
| `listFromSupabase(workspaceId?, search?, limit?, offset?)` | Queries Supabase with optional filters. Falls back to in-memory store on error. |
| `getFromSupabase(id)` | Single template lookup. Returns null if not found. |
| `upsertSupabase(template)` | Upserts to Supabase. Validates user_id as UUID before upsert. Non-blocking in most callers. |
| `createTemplate(data)` | Creates in-memory store, then upserts Supabase (non-blocking catch). Returns created template. |
| `getTemplate(id)` | Tries Supabase first, falls back to store if cold start. |
| `listTemplatesPaginated(params)` | Merges Supabase + store data, deduplicating by ID. Store data takes priority for freshness. |
| `updateTemplate(id, data)` | Updates store, then tries Supabase upsert. Falls back to store-only if Supabase unavailable. |
| `deleteTemplate(id)` | Removes from both store and Supabase. |
| `duplicateTemplate(id)` | Deep-clones template with new ID for template and all frames. |

**In-Memory Store (`api/src/services/store.ts`, 287 lines):**

```typescript
class Store {
  workspaces: Map<string, Workspace>;
  templates: Map<string, DesignTemplate>;
  webhooks: Map<string, Webhook>;
  renderJobs: Map<string, RenderJob>;
  snapshots: Map<string, { templateId: string; state: string; type: string; timestamp: number }[]>;

  // Template operations
  createTemplate(data): DesignTemplate    // engine defaults to "html"
  getTemplate(id): DesignTemplate | null
  updateTemplate(id, data): DesignTemplate
  deleteTemplate(id): void
  listTemplates(workspaceId?): DesignTemplate[]

  // Workspace operations
  createWorkspace(data): Workspace
  getWorkspace(id): Workspace | null
  listWorkspaces(): Workspace[]

  // Snapshot system
  snapshotAuto(templateId): void          // Stores pre-mutation state
  listSnapshots(templateId): Snapshot[]   // Newest first
  getSnapshot(id): Snapshot | null        // ID or latest lookup
```

**Snapshot System Details:**

- `snapshotAuto(templateId)`: Called before any mutation. Serializes current template state to JSON. Stores with timestamp and type tag.
- **Max:** 50 snapshots per template (oldest removed when limit reached)
- **Types:** `"ia"` (AI agent changes), `"human"` (human designer changes), `"system"` (automated changes)
- **Lookup:** Supports both direct snapshot ID and "latest" for a template

**Frame Properties stored in template:**

```typescript
interface Frame {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  html?: string;
  css?: string;
  layoutMode?: "free" | "auto";
  clipsContent?: boolean;
  constraints?: { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean };
  padding?: { top?: number; right?: number; bottom?: number; left?: number };
  order?: number;
  objects?: CanvasObject[];  // Legacy Fabric.js compat (deprecated)
}
```

### 6.5 API Server Entry

**File:** `api/src/server.ts` (7 lines)

```typescript
import app from "./index.js";
const PORT = parseInt(process.env.PORT || "3001", 10);
app.listen(PORT, () => {
  console.log(`🚀 Futuraria API running at http://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/api/health`);
});
```

Simple Express listen on port 3001. Used only in local development — in production, the Express app is bridged through Netlify Functions via `api.mjs`.

---

## 7. MCP Protocol — Complete Documentation

### 7.1 Protocol Implementation

**File:** `netlify/functions/mcp.mjs` (4390 lines — largest file in the project)

The MCP server implements **JSON-RPC 2.0 over SSE (Server-Sent Events)**. This is a **custom implementation** — it does NOT use the official `@modelcontextprotocol/sdk` package. The entire protocol, tool catalog, and handler logic are contained in this single file.

The MCP server runs as a **Netlify serverless function**. Every invocation is stateless — data persistence is handled via the in-memory store and Supabase within each request handler.

### 7.2 Transport Layer

**GET `/mcp`:**
- Returns SSE endpoint info as HTML page
- Informs clients this is an SSE endpoint
- Not used for actual MCP communication

**POST `/mcp`:**
- Accepts `Content-Type: application/json`
- Request body is JSON-RPC 2.0 format
- Returns JSON-RPC 2.0 responses
- Supports both standard JSON-RPC and direct method calls for backward compatibility

### 7.3 Lifecycle Methods

**`initialize` — Client→Server handshake:**

Request:
```json
{
  "jsonrpc": "2.0",
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": { "name": "...", "version": "..." }
  },
  "id": 1
}
```

Response:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": {
      "tools": { "listChanged": false }
    },
    "serverInfo": {
      "name": "Futuraria Design Harness",
      "version": "2.0.0"
    }
  }
}
```

**`notifications/initialized` — Client confirms initialization:**
- No response expected (notification, not request)

**`tools/list` — Returns full tool catalog:**

Request:
```json
{
  "jsonrpc": "2.0",
  "method": "tools/list",
  "params": {},
  "id": 2
}
```

Response contains all 100+ tools with their input schemas (see Section 7.7).

**`tools/call` — Execute a tool:**

Request:
```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "create_html_template",
    "arguments": {
      "workspaceId": "ws_abc123",
      "name": "My Design",
      "width": 1080,
      "height": 1080
    }
  },
  "id": 3
}
```

Internally routes to: `handleMethod(params.name, params.arguments)`

### 7.4 Rate Limiting

The MCP server has its own rate limiter (separate from the REST API rate limiter):

- **Limit:** 60 requests per minute per IP
- **Window:** 60 seconds (rolling)
- **Response on limit exceeded:** HTTP 429 with `Retry-After` header
- **IP extraction:** `x-forwarded-for` header or `req.ip`

### 7.5 Response Format

**Success response:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"success\":true,\"data\":{...}}"
      }
    ]
  }
}
```

All result data is stringified as JSON within the `text` field of the MCP content array. This is the standard MCP format for text responses.

**Error response:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32000,
    "message": "templateId is required"
  }
}
```

**Error with content (partial errors):**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"error\":\"Specific operation failed\"}"
      }
    ],
    "isError": true
  }
}
```

### 7.6 Handler Architecture

**`handleMethod(name, args)` — the core router:**

A massive switch statement routing 100+ tool names to their handler implementations. Each case follows a consistent pattern:

```javascript
case "tool_name":
  // 1. Validate required parameters
  if (!args?.templateId) {
    return { content: [{ type: "text", text: JSON.stringify({ error: "templateId is required" }) }], isError: true };
  }

  // 2. Execute operation against in-memory store
  const result = store.someOperation(templateId, args);

  // 3. Persist to Supabase (non-blocking, fire-and-forget)
  supabase.from("templates").upsert({ id: templateId, ...result }).then(() => {
    console.log("Synced to Supabase");
  }).catch(err => {
    console.error("Supabase sync failed:", err.message);
  });

  // 4. Return result
  return {
    content: [{ type: "text", text: JSON.stringify({ success: true, data: result }) }]
  };
```

**Backward Compatibility — Direct Method Calls:**

The handler also supports direct method calls (non-JSON-RPC format):
```javascript
// POST body: { method: "create_template", params: { ... } }
```
This is detected and routed to the same `handleMethod` function.

### 7.7 Complete Tool Catalog — 100+ Tools

---

#### Category 1: Workspaces

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `list_workspaces` | — | `Workspace[]` | List all workspaces |
| `create_workspace` | `name: string` | `Workspace` | Create a new workspace with generated ID |

---

#### Category 2: Templates — Core CRUD

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `list_templates` | `workspaceId?`, `search?`, `limit?`, `offset?` | `Template[]` | List templates with optional filters and pagination |
| `get_template` | `templateId: string` | `Template` | Get full template including html, css, frames, metadata |
| `create_template` | `workspaceId: string`, `name: string`, `width?`, `height?` | `Template` | Create template (Fabric.js-compatible, defaults engine to "html") |
| `create_html_template` | `workspaceId: string`, `name: string`, `width?`, `height?`, `initialHtml?`, `initialCss?` | `Template` | Create HTML engine template with optional initial content |
| `update_template` | `templateId: string`, `name?`, `html?`, `css?`, `width?`, `height?`, `metadata?` | `Template` | Update template properties |
| `delete_template` | `templateId: string` | `{ deleted: true }` | Delete template from store and Supabase |
| `duplicate_template` | `templateId: string` | `Template` | Deep-clone template with new IDs for template and all frames |
| `export_template` | `templateId: string` | `{ template: {...} }` | Export template as .futuraria JSON format |
| `import_template` | `workspaceId: string`, `data: object` | `Template` | Import template from .futuraria JSON format |

---

#### Category 3: Frames — Multi-Artboard System

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `create_frame` | `templateId: string`, `name?`, `width?`, `height?`, `x?`, `y?`, `html?`, `css?` | `Frame` | Create a new artboard frame on the canvas |
| `list_frames` | `templateId: string` | `Frame[]` | List all frames in a template |
| `get_frame` | `templateId: string`, `frameId: string` | `Frame` | Get a single frame by ID |
| `update_frame` | `templateId: string`, `frameId: string`, `name?`, `x?`, `y?`, `width?`, `height?` | `Frame` | Update frame position or dimensions |
| `delete_frame` | `templateId: string`, `frameId: string` | `{ deleted: true }` | Delete a frame from a template |

---

#### Category 4: HTML Engine — Direct Content Manipulation

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `set_html` | `templateId: string`, `html: string` | `Template` | Replace HTML content (sanitized with DOMPurify) |
| `set_css` | `templateId: string`, `css: string` | `Template` | Replace CSS content |
| `create_html_frame` | `templateId: string`, `name: string`, `width: number`, `height: number`, `html?`, `css?`, `x?`, `y?` | `Frame` | Create an HTML frame with content |
| `update_html_frame` | `templateId: string`, `frameId: string`, `html?`, `css?` | `Frame` | Update HTML frame content |
| `delete_html_frame` | `templateId: string`, `frameId: string` | `{ deleted: true }` | Delete HTML frame |
| `get_html_frames` | `templateId: string` | `Frame[]` | List all HTML frames in template |

---

#### Category 5: Structure & Element Analysis

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `get_template_structure` | `templateId: string` | `{ dom: AST, cssRules: [...], elements: [{ id, tag, cssSelector, classes, bbox }] }` | Full DOM parse with CSS rule extraction and element bounding boxes |
| `select_element` | `templateId: string`, `elementId: string` | `{ elementId, tag, classes, cssProperties, htmlSnippet, selector }` | Get detailed element information |

---

#### Category 6: Element Operations

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `update_element` | `templateId: string`, `elementId: string`, `html?`, `css?` | `Template` | Update element's HTML content or CSS properties |
| `add_element` | `templateId: string`, `parentSelector: string`, `tag: string`, `html?`, `css?`, `position?: "before"\|"after"\|"prepend"\|"append"` | `Template` | Insert new element into DOM at specified position |
| `remove_element` | `templateId: string`, `elementId: string` | `Template` | Remove element from DOM |
| `reorder_element` | `templateId: string`, `elementId: string`, `newIndex: number` | `Template` | Move element to new position in parent |
| `change_element_tag` | `templateId: string`, `elementId: string`, `newTag: string` | `Template` | Change semantic HTML tag while preserving content and attributes |

---

#### Category 7: Drawing & Visual Primitives

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `draw_shape` | `templateId: string`, `shape: "rect"\|"circle"`, `x: number`, `y: number`, `width: number`, `height: number`, `css?`, `frameId?` | `Template` | Draw geometric shape as absolutely positioned div. Rectangle: `border: 2px solid`. Circle: `border-radius: 50%`. |
| `draw_path` | `templateId: string`, `points: [{x: number, y: number}]`, `css?`, `frameId?` | `Template` | Draw SVG polyline from point array |
| `add_primitive` | `templateId: string`, `type: string`, `props: object`, `css?`, `frameId?` | `Template` | Add any primitive element with custom properties |
| `transform_element` | `templateId: string`, `elementId: string`, `transform: { x?, y?, width?, height?, rotate?, scale?, skewX?, skewY? }` | `Template` | Transform element geometry via CSS |
| `group_elements` | `templateId: string`, `elementIds: string[]` | `{ html, groupId }` | Wrap multiple elements in a group container div |
| `align_elements` | `templateId: string`, `elementIds: string[]`, `alignment: "left"\|"center"\|"right"\|"top"\|"middle"\|"bottom"` | `Template` | Align elements to each other or parent |

---

#### Category 8: Google Fonts

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `search_google_fonts` | `query?`, `category?`, `limit?` | `Font[]` | Search 94-font catalog by name and category |
| `list_fonts` | `category?` | `Font[]` | List all available fonts, optionally filtered by category |
| `add_font_to_template` | `templateId: string`, `family: string`, `weights?: number[]` | `Template` | Add font @import to CSS and inject link into Shadow DOM |
| `get_font_details` | `family: string` | `FontDetail` | Get full font metadata: category, variants, subsets, preview URL, CSS import URL |
| `preview_font` | `family: string`, `text?`, `size?` | `{ previewHtml }` | Generate HTML preview of font rendering |

---

#### Category 9: AI Generation (OpenRouter → Gemini/GPT)

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `ai_generate_text` | `prompt: string`, `context?`, `maxTokens?`, `temperature?` | `{ text }` | Generate text/copy using AI model |
| `ai_generate_image` | `prompt: string`, `style?`, `size?`, `negativePrompt?` | `{ imageUrl }` | Generate image from text prompt |
| `ai_palette` | `theme?`, `mood?`, `count?`, `baseColor?` | `{ colors: [{ hex, name, role }] }` | Generate color palette suggestions |
| `ai_suggest_layout` | `templateId: string`, `goal?`, `constraints?` | `{ suggestions: [{ description, css }] }` | Suggest layout improvements for template |
| `ai_translate` | `templateId: string`, `targetLanguage: string`, `elementIds?` | `Template` | Translate text content in template |
| `generate_from_prompt` | `prompt: string`, `format: { width, height }`, `brandId?`, `style?` | `{ templateId, previewUrl }` | Generate complete template from natural language prompt |
| `enhance_template` | `templateId: string`, `instruction: string` | `Template` | AI-enhance existing template based on instruction |

---

#### Category 10: Styles & CSS Variables

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `create_style` | `templateId: string`, `name: string`, `selector: string`, `properties: {}` | `Style` | Create named CSS style |
| `apply_style` | `templateId: string`, `styleId: string`, `selector?` | `Template` | Apply saved style to elements |
| `create_variable` | `templateId: string`, `name: string`, `value: string`, `scope?: ":root"\|"element"` | `{ variable }` | Create CSS custom property |
| `create_collection` | `templateId: string`, `name: string`, `variables: [{ name, value }]` | `{ collection }` | Create collection of related CSS variables |
| `link_variable` | `templateId: string`, `selector: string`, `property: string`, `variableName: string` | `Template` | Link CSS property to variable reference (var(--name)) |
| `get_css_variables` | `templateId: string` | `{ variables: [{ name, value, scope }] }` | List all CSS custom properties |
| `set_css_variable` | `templateId: string`, `name: string`, `value: string`, `scope?` | `Template` | Set/update CSS variable value |

---

#### Category 11: Export, Render & Copy

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `export_batch` | `templateIds: string[]`, `format?: "json"\|"zip"` | `{ downloadUrl }` | Export multiple templates as batch |
| `copy_as` | `templateId: string`, `format: "png"\|"html"\|"css"` | `{ content }` | Copy template content to clipboard in specified format |
| `export_pdf` | `templateId: string`, `options?` | `{ pdfUrl }` | Export template as PDF document |
| `render_batch` | `templateIds: string[]`, `format?`, `scale?`, `quality?` | `{ jobId, status, estimatedTime }` | Queue batch render job |
| `render_html_template` | `templateId: string`, `format?: "png"\|"webp"\|"jpg"`, `scale?: number`, `quality?: number` | `{ url, width, height, sizeBytes, format }` | Render single template to image |
| `render_to_formats` | `templateId: string`, `formats: string[]`, `scale?` | `[{ format, url, sizeBytes }]` | Render template to multiple image formats simultaneously |

---

#### Category 12: Batch Operations

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `batch_update` | `templateIds: string[]`, `updates: object` | `{ updated, failed, errors }` | Bulk update multiple templates |
| `batch_create_variants` | `templateId: string`, `recipeId?`, `variables: [{ texts?, images?, colors? }]`, `options?: { prefix?, startIndex?, concurrency? }` | `{ batchId, totalCount, templateIds, status }` | Create template variants from data array |
| `batch_render_html` | `templateIds: string[]` or `batchId: string`, `format?`, `scale?` | `{ jobId, status, estimatedTime }` | Render batch of HTML templates |
| `batch_status` | `batchId: string` or `jobId: string` | `{ progress: { completed, total, failed, errors }, results }` | Check batch job progress |
| `batch_cancel` | `batchId: string` or `jobId: string` | `{ cancelled, completedBeforeCancel }` | Cancel running batch job |
| `batch_export` | `templateIds: string[]` or `batchId: string`, `format?: "zip"\|"urls"`, `includeMetadata?` | `{ downloadUrl }` or `{ urls, expiresAt }` | Export batch as downloadable ZIP or URL list |
| `publish_batch` | `templateIds: string[]` or `batchId: string`, `channels: string[]`, `caption?`, `schedule?` | `{ jobId, status, scheduled }` | Publish batch to social media channels |
| `publish_status` | `jobId: string` | `{ channels: [{ name, status, url, error? }] }` | Check publish job status per channel |

---

#### Category 13: Multi-Agent Collaboration

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `share_template` | `templateId: string`, `userId?`, `permissions?` | `{ shared }` | Share template with another user |
| `claim_section` | `templateId: string`, `sectionId: string`, `agentId: string`, `ttlSeconds?` | `{ success, lockId, expiresAt, conflict? }` | Lock a section for exclusive editing |
| `release_section` | `templateId: string`, `sectionId: string`, `lockId: string` | `{ released: true }` | Release section lock |
| `list_sections` | `templateId: string` | `[{ sectionId, selector, claimedBy, html, css, status, updatedAt }]` | List all sections and their claim status |
| `assemble_template` | `templateId: string` | `Template` | Merge all claimed sections into complete template |
| `get_active_agents` | `templateId: string` | `[{ agentId, sectionId, status, startedAt, lastBeat }]` | List agents currently editing template |
| `subscribe_template` | `templateId: string`, `channelType: "changes"\|"presence"\|"all"` | `{ channelId, endpoint }` | Subscribe to realtime updates |
| `unsubscribe_template` | `channelId: string` | `{ unsubscribed: true }` | Unsubscribe from realtime channel |
| `broadcast_section_change` | `channelId: string`, `sectionId: string`, `html: string`, `css: string`, `agentId: string` | — | Broadcast change to all subscribers via Supabase Realtime |

---

#### Category 14: Brand Guardian

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `register_brand` | `brandId: string`, `name: string`, `colors: [{ name, hex, role }]`, `fonts: [{ family, role }]`, `logo?: { url, variants }`, `spacing?: { unit, scale }`, `rules?: [{ selector, property, expected, severity }]` | `{ brandId }` | Register a brand profile |
| `validate_brand` | `templateId: string`, `brandId: string` | `{ passed, score, checks: [{ rule, passed, expected, actual, selector, message }] }` | Check template against brand rules |
| `check_contrast` | `templateId: string` | `{ passes, elements: [{ selector, fg, bg, ratio, passesAA, passesAAA, suggestion }] }` | WCAG contrast ratio check against AA/AAA standards |
| `check_accessibility` | `templateId: string` | `{ score, issues: [{ selector, severity, type, description, wcag, suggestion }] }` | Full accessibility audit |
| `auto_fix_brand` | `templateId: string`, `brandId: string`, `autoFix: string[]` | `Template + { fixesApplied }` | Auto-apply brand rules (colors, fonts, spacing) |

---

#### Category 15: Format Adaptation

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `detect_structure` | `templateId: string` | `{ regions: [{ name: "hero"\|"headline"\|"body"\|"cta"\|"logo", selector, boundingBox, content }] }` | Detect semantic regions in template |
| `adapt_format` | `templateId: string`, `targetFormat: { width, height, name }` | `{ newTemplateId, width, height, changes: [{ region, from, to }] }` | Adapt template to new dimensions |
| `adapt_all_formats` | `templateId: string`, `formats: [{ name, width, height }]` | `{ results: [{ format, templateId, previewUrl }] }` | Multi-format adaptation |
| `compare_adaptations` | `templateIds: string[]` | `{ sideBySide: [{ format, previewUrl }] }` | Side-by-side comparison of multiple format adaptations |

---

#### Category 16: Assets & Media

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `color_picker` | `color: string` | `{ hex, rgb, hsl, name? }` | Color analysis and conversion between formats. Uses rgbToHsl/hslToRgb helpers. |
| `suggest_color_palette` | `baseColor?`, `count?`, `scheme?: "complementary"\|"analogous"\|"triadic"\|"monochromatic"` | `{ colors: [{ hex, hsl, role }] }` | Generate color palette from base color |
| `search_stock_image` | `query: string`, `orientation?`, `color?`, `source?` | `[{ url, thumb, author, license }]` | Search stock photo services (Unsplash/Pexels) |
| `optimize_image` | `imageUrl: string`, `format?`, `quality?`, `maxWidth?` | `{ optimizedUrl, originalBytes, optimizedBytes, reduction }` | Optimize image for web |
| `list_assets` | `templateId?` or `workspaceId?` | `[{ url, type, filename, dimensions, sizeBytes }]` | List uploaded assets |
| `replace_asset` | `templateId: string`, `selector: string`, `newUrl: string` | `Template` | Replace image source in template |

---

#### Category 17: Components

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `create_component` | `templateId: string`, `name: string`, `selector: string`, `html: string`, `css: string`, `props?` | `Component` | Create reusable component from template elements |
| `create_instance` | `templateId: string`, `componentId: string`, `parentSelector?`, `overrides?` | `Template` | Instantiate component in template |
| `add_variant` | `componentId: string`, `name: string`, `overrides: {}` | `Component` | Add named variant to component |

---

#### Category 18: Advanced Operations

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `smart_layout` | `templateId: string`, `layout: "grid"\|"masonry"\|"golden-ratio"\|"circular"\|"zigzag"\|"flex-wrap"`, `params?: { columns?, gap?, itemWidth?, itemHeight?, radius? }` | `Template` | Apply algorithmic layout to elements. Grid: CSS grid with configurable columns/gap. Masonry: column-based masonry. Golden Ratio: spiral positioning. Circular: radial arrangement. Zigzag: alternating offset. Flex-wrap: flexbox wrap. |
| `skill_clone` | `templateId: string`, `sourceUrl?` | `Template` | Clone design from external URL |
| `observe_session` | `templateId: string`, `enabled: boolean` | `{ observing }` | Start/stop observing user editing session |
| `publish_library` | `templateId: string`, `name: string`, `description?` | `{ libraryId }` | Publish template as component library |

---

#### Category 19: Plugin System

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `register_tool` | `name: string`, `description: string`, `parameters: object`, `handler?: string` | `{ registered: true }` | Register custom MCP tool dynamically |
| `auth_token` | `provider: string`, `token: string` | `{ stored: true }` | Store authentication token for third-party integrations |

---

#### Category 20: Version History

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `list_versions` | `templateId: string`, `limit?` | `{ versions: [{ id, timestamp, type, preview? }] }` | List version history for template |
| `restore_version` | `templateId: string`, `versionId: string` | `Template` | Restore template to previous version |

---

#### Category 21: Comments

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `add_comment` | `templateId: string`, `text: string`, `elementId?`, `position?: { x, y }` | `Comment` | Add comment to template |
| `mention_user` | `templateId: string`, `commentId: string`, `userId: string` | `Comment` | Mention user in comment |

---

#### Category 22: Recipes & Templates

| Tool | Parameters | Returns | Description |
|------|-----------|---------|-------------|
| `analyze_template_structure` | `templateId: string` | `{ layout: { type, direction, gap, padding }, colors: [{ hex, role, selector }], typography: [{ family, size, weight, lineHeight, selector, role }], components: [{ tag, selector, role }], dimensions: { width, height } }` | Deep structural analysis of template |
| `extract_variables` | `templateId: string` | `{ texts: [{ name, selector, currentValue, maxLength }], images: [{ name, selector, currentSrc, dimensions }], colors: [{ name, selector, currentValue }], fixedSections: [{ selector, content }] }` | Extract dynamic variables from template |
| `create_variant` | `templateId: string`, `variables: { texts?, images?, colors? }`, `name?` | `{ newTemplateId }` | Create template variant with substituted variables |
| `apply_variables` | `templateId: string`, `variables: object` | `Template` | Apply variable values to template |
| `save_recipe` | `templateId: string`, `name: string`, `description?` | `{ recipeId, structure, variables, previewUrl }` | Save template as reusable recipe |

---

### 7.8 MCP Client Library

**File:** `src/lib/mcpClient.ts` (20 lines)

```typescript
import { apiFetch } from "./supabase";

/**
 * JSON-RPC 2.0 helper: POST to /mcp, parse response, throw on error.
 * Reusable across all UI panels that call MCP tools.
 *
 * @example
 *   const result = await mcpCall("set_blur", { templateId: "tpl_...", blur: 6 });
 */
export async function mcpCall(method: string, params: Record<string, any>) {
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

Used by: `VariablesPanel`, `StructurePanel`, `ElementProperties` to call MCP tools directly from the UI.

**`apiFetch` wrapper (`src/lib/supabase.ts`, 12 lines):**

```typescript
const API_BASE = ""; // Relative URLs

export async function apiFetch<T = any>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { "Content-Type": "application/json", "x-api-key": "dev-key" },
    ...options,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}
```

### 7.9 Backward Compatibility

The MCP server supports both:
1. **Standard JSON-RPC 2.0**: `{ jsonrpc: "2.0", method: "tools/call", params: { name: "...", arguments: {...} } }`
2. **Direct method calls**: `{ method: "create_template", params: { ... } }` (auto-detected and routed)

This allows both MCP-compliant AI agents and simpler HTTP clients to interact with the tool system.

### 7.10 Key Helper Functions in mcp.mjs

**`buildHtmlExportPage(template, frameId?)`:**
- Generates a self-contained HTML page that auto-renders frames to PNG via html2canvas in the browser
- Extracts font imports, builds complete HTML structure with download button
- Used by `render_html_template` and `export_batch`

**`rgbToHsl(r, g, b)`:**
- Converts RGB values to HSL array
- Used by `color_picker` and `suggest_color_palette`

**`hslToRgb(h, s, l)`:**
- Converts HSL values to RGB hex string
- Used by color palette generation

**`compareValues(current, snapshot)`:**
- Recursive diff utility for snapshot comparison
- Detects changes between template states for versioning

**Tool registration pattern (inside handleMethod):**
- Each tool gets its own case in the switch
- Parameter validation at the top of each case
- Operation against in-memory store
- Supabase persistence as fire-and-forget
- JSON-RPC formatted response

---

## 8. Persistence Architecture

### 8.1 Dual-Write Strategy

The system uses a **dual-write** pattern throughout — both in the frontend (EditorV2 auto-save) and in the MCP/API layer (tool handlers).

```
┌──────────────────────────────────────────────────────────────────┐
│                        WRITE PATH (Frontend)                      │
│                                                                   │
│  User action (draw, type, drag, CSS change)                       │
│         │                                                         │
│         ├──→ localStorage.setItem()     ← INSTANT (primary store) │
│         │    Key: "futuraria_local_templates"                     │
│         │    Value: { [templateId]: { id, frames, updatedAt } }  │
│         │    Status: "Saved"                                      │
│         │                                                         │
│         └──→ PUT /api/templates/{id}    ← BEST-EFFORT             │
│              Exponential backoff: 1s → 2s → 4s (max 3 retries)  │
│              On success: Status = "Saved"                         │
│              On all failures: Status = "Error"                    │
│                (data still in localStorage, recoverable)          │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                        WRITE PATH (API/MCP)                       │
│                                                                   │
│  MCP tool call / REST API request                                 │
│         │                                                         │
│         ├──→ In-memory Store (instant)                            │
│         │    Map.set(templateId, { ...updated template })        │
│         │                                                         │
│         └──→ Supabase.upsert() (fire-and-forget)                  │
│              .catch(err => console.error("Supabase sync failed")) │
│              (best-effort, non-blocking, no retry)                │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                        READ PATH (Frontend)                       │
│                                                                   │
│  templateApi.getTemplate(id)                                      │
│         │                                                         │
│         ├──→ localStorage.getItem("futuraria_local_templates")   │
│         │    If exists AND updatedAt > API version:               │
│         │      → Return localStorage data (fresher)               │
│         │                                                         │
│         └──→ GET /api/templates/{id}                              │
│              On success: Return API data                          │
│              On error: Fall back to localStorage if available     │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                        READ PATH (API)                            │
│                                                                   │
│  GET /api/templates/{id}                                          │
│         │                                                         │
│         ├──→ Supabase query (try first)                           │
│         │    If found: Return Supabase data                       │
│         │                                                         │
│         └──→ In-memory Store lookup (fallback)                    │
│              (handles cold starts where Supabase not available)   │
└──────────────────────────────────────────────────────────────────┘
```

### 8.2 Auto-Save

**Location:** `src/pages/EditorV2.tsx`

**Debounce:** 2 seconds after last change (useRef timer, cleared and reset on each change).

**Payload:**
```json
{
  "name": "Template Name",
  "width": 1080,
  "height": 1080,
  "engine": "html",
  "html": "<div data-layer-id='el_1'>...</div>",  // From active frame
  "css": "[data-layer-id='el_1'] { ... }",         // From active frame
  "frames": [                                       // Full frame array
    {
      "id": "frame_0",
      "name": "Frame 1",
      "x": 100,
      "y": 100,
      "width": 1080,
      "height": 1080,
      "html": "...",
      "css": "...",
      "background": "#ffffff"
    }
  ],
  "metadata": {
    "createdAt": "...",
    "updatedAt": "2026-06-26T..."
  }
}
```

**Backward compatibility:** Both `frames[]` array (V2 format) and top-level `html`/`css` (V1 format) are saved. The top-level fields mirror the currently selected frame's content.

**Exponential backoff retry:**
```typescript
async function saveWithRetry(url, body, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { method: "PUT", body });
      if (res.ok) return; // Success
    } catch (e) {
      if (i < retries - 1) {
        const delay = Math.pow(2, i) * 1000; // 1000, 2000, 4000
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw new Error("All retries failed");
}
```

### 8.3 In-Memory Store

**File:** `api/src/services/store.ts` (287 lines)

```typescript
class Store {
  // Maps for all data types
  workspaces = new Map<string, Workspace>();
  templates = new Map<string, DesignTemplate>();
  webhooks = new Map<string, Webhook>();
  renderJobs = new Map<string, RenderJob>();
  snapshots = new Map<string, SnapshotEntry[]>();

  // CRUD operations for each type
  // ...
}
```

**Template defaults on creation:**
- `engine: "html"` (always, even for legacy `create_template`)
- Frames have full property model: `layoutMode`, `clipsContent`, `constraints`, `padding`, `order`, `objects[]`

**Snapshot system:**
- `snapshotAuto(templateId)`: Called before any mutation. Serializes current state. Enforces 50-per-template limit.
- `listSnapshots(templateId)`: Returns newest first.
- `getSnapshot(id)`: Lookup by ID, or pass "latest" + templateId for most recent.
- Types: `"ia"` (AI agent), `"human"` (human designer), `"system"` (automated)

### 8.4 Client-Side Freshness Check

**File:** `src/lib/templateApi.ts` (221 lines)

```typescript
async function getTemplate(id: string) {
  // 1. Check localStorage first
  const localData = getLocalTemplates();
  const local = localData[id];
  
  // 2. Fetch from API
  try {
    const res = await apiFetch(`/api/templates/${id}`);
    const apiData = res.data;
    
    // 3. Compare timestamps — use fresher data
    if (local && local.metadata?.updatedAt > apiData.metadata?.updatedAt) {
      return local; // localStorage is newer
    }
    return apiData;
  } catch {
    // 4. API failed — fall back to localStorage
    if (local) return local;
    throw new Error("Template not found");
  }
}

async function listTemplates(params?) {
  // Merge API results with localStorage-local templates
  // localStorage templates that don't exist on API are included
  // Deduplication by ID
}
```

**localStorage structure:**
```json
{
  "futuraria_local_templates": {
    "tpl_abc123": {
      "id": "tpl_abc123",
      "name": "My Design",
      "frames": [...],
      "metadata": { "updatedAt": "2026-06-26T..." }
    }
  }
}
```

### 8.5 Supabase Realtime

**File:** `src/lib/supabaseRealtime.ts` (94 lines)

**Channels configuration:**

| Channel | Type | Purpose |
|---------|------|---------|
| `template:{id}:changes` | Broadcast | HTML/CSS changes pushed to all subscribers |
| `template:{id}:presence` | Presence | Agent online status and section claims |

**API:**

```typescript
// Subscribe to template changes
subscribeTemplate(templateId, channelType = "all"):
  - Creates Supabase Realtime channel
  - Subscribes to specified channel types
  - Returns { channelId, unsubscribe function }

// Broadcast changes to all subscribers
broadcastChange(templateId, html, css):
  - Sends "html_css_change" event via Broadcast

// Track agent presence
subscribePresence(templateId):
  - Creates presence channel
  - Returns { trackPresence, untrackPresence }

// Announce agent
trackPresence(agentId, sectionId):
  - Syncs presence state with { agent_id, section_id, online_at }
```

**Presence payload:**
```json
{
  "agent_id": "agent_lara",
  "section_id": "section_hero",
  "online_at": "2026-06-26T..."
}
```

---

## 9. Export & Render Pipeline

### 9.1 Client-Side PNG Export

**Function:** `captureFrameToPng(frameId, options?)` in EditorV2.tsx

```
Step 1: Get frame data (html, css, width, height, background)
Step 2: Create offscreen container div
  - position: absolute
  - left: -9999px
  - width/height matching frame dimensions
Step 3: Set innerHTML to frame's HTML content
Step 4: Extract Google Font @import links from CSS using regex
  - Pattern: /@import\s+url\(['"]?([^'")\s]+)['"]?\)\s*;?/g
Step 5: For each @import URL:
  - Create <link rel="stylesheet" href="..."> element
  - Append to container
Step 6: Create <style> element with frame's CSS
  - Append to container
Step 7: For each font link, create matching <link> for Google Fonts
  - href = https://fonts.googleapis.com/css2?family=Name:ital,wght@...
Step 8: Append container to document.body
Step 9: Wait for fonts to load: document.fonts.ready
Step 10: html2canvas(container, {
  scale: requestedScale || 2,  // 1x-4x supported
  backgroundColor: frame.background || "#ffffff",
  useCORS: true,
  allowTaint: false,
  logging: false
})
Step 11: Convert canvas to blob: canvas.toBlob("image/png")
Step 12: Remove container from DOM
Step 13: Return PNG blob
```

**Export Menu Options in EditorV2:**
1. Export current frame as PNG — single PNG download
2. Export all frames as PNG — individual downloads for each frame
3. Export as JSON — .futuraria JSON format download

### 9.2 Render Worker

**Location:** EditorV2.tsx, background polling loop

```typescript
// Starts on mount, stops on unmount
useEffect(() => {
  const interval = setInterval(async () => {
    try {
      // Poll for pending render jobs
      const res = await fetch("/api/render/queue/pending");
      const jobs = await res.json();
      
      for (const job of jobs.data || []) {
        // Render each job
        const blob = await captureFrameToPng(job.frameId, { 
          scale: job.scale || 2,
          format: job.format || "png"
        });
        
        // Convert to base64 data URL
        const reader = new FileReader();
        const dataUrl = await new Promise((resolve) => {
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
        
        // Upload completion
        await fetch(`/api/render/${job.id}/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageUrl: dataUrl,
            width: job.width,
            height: job.height,
            format: job.format || "png"
          })
        });
      }
    } catch (e) {
      // Silently continue polling
    }
  }, 15000); // Every 15 seconds
  
  return () => clearInterval(interval);
}, []);
```

### 9.3 Self-Rendering HTML

**File:** `netlify/functions/render.mjs` (254 lines)

Generates a standalone HTML page that renders templates to PNG entirely in the browser:

**Endpoint:** `/api/render/:templateId` or `/api/render/:templateId/frame/:frameId`

**Flow:**
```
1. Fetch template from API
2. Extract HTML and CSS
3. Build complete HTML page:
   - html2canvas loaded from CDN
   - Font <link> elements extracted from CSS
   - Template HTML and CSS embedded
   - Download button with canvas rendering
4. Return with Content-Type: text/html
5. User opens URL in browser → page auto-renders → user clicks download
```

**Notes from render.mjs comments:**
- Puppeteer (headless Chrome) would be ideal for server-side rendering
- But Puppeteer/Chromium package exceeds Netlify's 50MB function limit
- Therefore: client-side html2canvas is the chosen approach
- Potential future: Railway or other service for server-side Puppeteer renders

### 9.4 MCP Export Helper

**Function:** `buildHtmlExportPage(template, frameId?)` in mcp.mjs

Embedded in the MCP server, generates the same self-contained HTML as render.mjs. Used by:
- `render_html_template` MCP tool
- `export_batch` MCP tool
- `render_to_formats` MCP tool

The generated HTML auto-renders on page load and provides a download button.

---

## 10. Dashboard

**File:** `src/components/Dashboard.tsx` (408 lines)

The template gallery and workspace management interface.

**Features:**

| Feature | Description |
|---------|-------------|
| Workspace selector | Dropdown listing all workspaces, plus "All Templates" option |
| Create workspace | "+ Workspace" button → inline input → Enter to create |
| Search | Text input filtering templates by name |
| Template grid | Responsive grid (auto-fill, minmax 220px) with glass-morphism cards |
| Thumbnails | Iframes showing scaled-down template preview (transform: scale(0.15)) |
| Card info | Template name (double-click to rename), last modified date, "HTML" badge |
| Card actions | Rename, Copy (duplicate), Export (.futuraria.json), Delete |
| Create template | "+ HTML" button → inline name input → creates HTML engine template |

**API interactions:**
- `GET /api/workspaces` — load workspace list on mount
- `GET /api/templates?workspaceId=&search=` — load filtered templates
- `POST /api/workspaces` — create workspace
- `POST /api/templates` — create template (called via `onCreateHtmlTemplate` prop)
- `PUT /api/templates/:id` — rename template
- `DELETE /api/templates/:id` — delete template
- `POST /api/templates/:id/duplicate` — copy template
- `GET /api/templates/:id/export` — export template as JSON

**Styling:**
- Background image: `/bg-dashboard.jpg` with `background-size: cover` and `background-attachment: fixed`
- Glass-morphism header, inputs, buttons, and cards
- `backdrop-filter: blur(20px) saturate(180%)` for sticky header
- Hover effects on cards: border color change, box-shadow increase

---

## 11. Deployment Architecture

### 11.1 Netlify Configuration

**File:** `netlify.toml` (37 lines)

```toml
[build]
  command = "npm install && npm run build:functions && npm run build"
  publish = "dist"

[[redirects]]
  from = "/api/render/*"
  to = "/.netlify/functions/render"
  status = 200

[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/api"
  status = 200

[[redirects]]
  from = "/mcp"
  to = "/.netlify/functions/mcp"
  status = 200

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200    # SPA fallback
```

**Build order:**
1. `npm install` — install root dependencies
2. `npm run build:functions` — install API dependencies + compile TypeScript (`cd api && npm install && npx tsc`)
3. `npm run build` — compile frontend (`tsc && vite build`) → output to `dist/`

**Redirect priority:** Specific paths first (`/api/render`, `/api`, `/mcp`), then catch-all SPA fallback.

### 11.2 Infrastructure

```
┌─────────────────────────────────────────────────────────────────┐
│                     NETLIFY FREE TIER                            │
│                                                                  │
│  • SPA hosting: dist/ directory served as static site           │
│  • 3 serverless functions:                                       │
│    - api.mjs: Express REST API bridge                           │
│    - mcp.mjs: MCP JSON-RPC 2.0 server                          │
│    - render.mjs: Self-rendering HTML page                       │
│  • 125K requests/month per function                              │
│  • 100GB bandwidth/month                                        │
│  • Auto-deploy on git push to main branch                       │
│  • Custom domain: futuraria.netlify.app                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SUPABASE FREE TIER                            │
│                                                                  │
│  • PostgreSQL database (500MB storage)                          │
│  • Tables: templates, workspaces (and others for batches, etc.) │
│  • Realtime: WebSocket-based broadcast + presence               │
│  • Row Level Security (RLS) for multi-tenant data               │
│  • 2GB bandwidth/month                                           │
│  • 500K rows maximum                                             │
└─────────────────────────────────────────────────────────────────┘
```

**Cost: $0/month total.** Both Netlify and Supabase provide generous free tiers that cover the project's usage.

### 11.3 Local Development

```bash
# Root setup
npm install

# Start frontend dev server (Vite on :5173)
npm run dev
# Vite proxies /api → localhost:3001

# Start API (in another terminal)
cd api
npm install
npm run dev
# Express on :3001

# Available locally:
# Frontend: http://localhost:5173
# API:      http://localhost:5173/api  (proxied)
# MCP:      http://localhost:5173/mcp   (proxied)
```

**Vite proxy config (`vite.config.ts`):**
```typescript
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@futuraria/shared": path.resolve(__dirname, "src/shared"),
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
```

---

## 12. Data Models

### 12.1 FrameData (Frontend Core Unit)

```typescript
// src/pages/EditorV2.tsx (inline type)
interface FrameData {
  id: string;           // Unique frame ID (e.g., "frame_0", "frame_abc123")
  name: string;         // Display name (e.g., "Frame 1", "Hero Section")
  x: number;            // X position on infinite canvas
  y: number;            // Y position on infinite canvas
  width: number;        // Frame width in pixels (e.g., 1080)
  height: number;       // Frame height in pixels (e.g., 1080)
  html: string;         // Inner HTML content
  css: string;          // Frame-scoped CSS styles
  background: string;   // Background color (hex, rgb, or named)
}
```

### 12.2 HtmlTemplate (Frontend/API Boundary)

```typescript
// src/types.ts (33 lines)
interface HtmlTemplate {
  id: string;                    // Template ID (e.g., "tpl_abc123")
  workspaceId: string;           // Parent workspace ID
  name: string;                  // Template name
  width: number;                 // Default width
  height: number;                // Default height
  engine: "html";                // Always "html" in V2
  html?: string;                 // Top-level HTML (from active frame, for backward compat)
  css?: string;                  // Top-level CSS (from active frame, for backward compat)
  frames?: FrameData[];          // Multi-frame array (V2 primary format)
  metadata: {
    createdAt: string;           // ISO timestamp
    updatedAt: string;           // ISO timestamp
    [key: string]: any;          // Extensible metadata
  };
}

interface HtmlTemplateCreatePayload {
  name: string;
  workspaceId: string;
  width?: number;
  height?: number;
  initialHtml?: string;
  initialCss?: string;
}
```

### 12.3 DesignTemplate (API/Server — Legacy Compat)

```typescript
// api/src/types.ts (250 lines)
interface DesignTemplate {
  id: string;
  workspaceId: string;
  name: string;
  width: number;
  height: number;
  engine?: "html";               // Optional for backward compat
  html?: string;
  css?: string;
  canvas?: CanvasData;           // ⚠️ Fabric.js canvas data — DEPRECATED, kept for compat
  frames?: Frame[];              // Multi-frame support
  styles?: Style[];
  comments?: Comment[];
  metadata: TemplateMetadata;
}

// Frame (API type) — includes legacy fields
interface Frame {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  html?: string;
  css?: string;
  layoutMode?: "free" | "auto";
  clipsContent?: boolean;
  constraints?: {
    left?: boolean;
    right?: boolean;
    top?: boolean;
    bottom?: boolean;
  };
  padding?: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
  order?: number;
  objects?: CanvasObject[];       // ⚠️ Fabric.js objects — DEPRECATED
}

// CanvasData (⚠️ DEPRECATED — Fabric.js compat only)
interface CanvasData {
  objects: CanvasObject[];        // Fabric.js serialized objects
  background?: string;
  version?: string;
}

// CanvasObject (⚠️ DEPRECATED — Fabric.js compat only)
interface CanvasObject {
  type: string;                   // "rect", "circle", "text", "image", etc.
  left: number;
  top: number;
  width?: number;
  height?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  // ... other Fabric.js properties
}
```

### 12.4 SelectedElementInfo (Frontend Selection Context)

```typescript
// src/components/DesignFrame.tsx (inline type)
interface SelectedElementInfo {
  layerId: string;               // data-layer-id value (e.g., "el_abc123")
  tag: string;                   // HTML tag name in lowercase (e.g., "div", "h1")
  selector: string;              // CSS selector: [data-layer-id="el_abc123"]
  computedStyles: Record<string, string>;  // Key-value from getComputedStyle()
  frameId: string;               // Parent frame ID
}
```

### 12.5 LayerNode (Layer Tree)

```typescript
// src/hooks/useLayerTree.ts
interface LayerNode {
  layerId: string;               // data-layer-id or auto-generated "auto_N"
  tag: string;                   // HTML tag
  text: string;                  // Text preview (40 chars max)
  depth: number;                 // Nesting level from body
  parentId: string | null;       // Parent layer ID
  children: string[];            // Child layer IDs
  path: number[];                // DOM child-index path for locating auto layers
}
```

### 12.6 Server Types (api/src/types.ts — Selected Highlights)

```typescript
// Workspace
interface Workspace {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

// Style
interface Style {
  id: string;
  name: string;
  selector: string;
  properties: Record<string, string>;
}

// Comment
interface Comment {
  id: string;
  text: string;
  userId: string;
  elementId?: string;
  position?: { x: number; y: number };
  createdAt: string;
  mentions?: string[];
}

// Version
interface Version {
  id: string;
  templateId: string;
  state: string;                 // JSON serialized template state
  type: "ia" | "human" | "system";
  timestamp: string;
}

// VariableStore
interface VariableStore {
  id: string;
  name: string;
  value: string;
  scope: ":root" | string;       // CSS selector for variable scope
}

// Component
interface Component {
  id: string;
  name: string;
  selector: string;
  html: string;
  css: string;
  props?: Record<string, any>;
  variants?: ComponentVariant[];
}

// Render Types
type RenderFormat = "png" | "webp" | "jpg" | "pdf" | "svg";
type RenderStatus = "queued" | "processing" | "completed" | "failed";

interface RenderJob {
  id: string;
  templateId: string;
  frameId?: string;
  format: RenderFormat;
  scale: number;
  quality: number;
  status: RenderStatus;
  resultUrl?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

// Tool Types (MCP payloads)
type ToolName = string;  // 100+ possible values

interface DrawShapePayload {
  shape: "rect" | "circle";
  x: number;
  y: number;
  width: number;
  height: number;
  css?: string;
  frameId?: string;
}

interface TextPayload {
  text: string;
  x: number;
  y: number;
  css?: string;
}

interface TransformPayload {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotate?: number;
  scale?: number;
  skewX?: number;
  skewY?: number;
}

interface TemplateMetadata {
  createdAt: string;
  updatedAt: string;
  [key: string]: any;
}
```

---

## 13. Key Design Patterns

### 13.1 Dual-Write Everywhere

**Pattern:** Every mutation (frontend auto-save, MCP tool, REST API) writes to two stores:
1. **Primary (instant):** localStorage (frontend) or in-memory Map (server)
2. **Secondary (best-effort):** Supabase PostgreSQL

**Rationale:** Ensures data is never lost even if Supabase is unavailable. The primary store is always available locally; Supabase provides persistence across sessions/devices.

**Implementation:** Fire-and-forget pattern with `.catch(() => {})` — Supabase failures are logged but never block the user.

### 13.2 Regex-Based CSS Manipulation

**Pattern:** Instead of a full CSS parser, CSS rules are modified via regex string operations.

**Reasoning:**
- Performance: regex is faster than full CSSOM for targeted single-rule changes
- Simplicity: no CSS parser dependency
- Frame isolation: each frame has its own CSS string, keeping the regex scope small

**Key function:** `updateCssProperty(css, selector, prop, value)` — finds or creates CSS rule via regex matching.

### 13.3 Semantic Element Tagging

**Pattern:** All user-created elements get a `data-layer-id` attribute. CSS selectors use attribute selectors: `[data-layer-id="el_abc123"]`.

**Benefits:**
- Elements can be uniquely identified regardless of tag, class, or position
- CSS rules are stable across DOM reordering
- Layer tree can locate any element by scanning for `data-layer-id` attributes
- Auto-generated IDs for elements without explicit layer IDs

### 13.4 Frame-Level State Isolation

**Pattern:** Each frame (artboard) has its own HTML and CSS string. Changes to one frame never affect others.

**Benefits:**
- CSS isolation via Shadow DOM prevents style leakage
- Multi-frame designs possible (e.g., carousel with square, story, banner variants side by side)
- Frame operations (add, delete, duplicate, reorder) are atomic

### 13.5 Backward Compatibility Layer

**Pattern:** V2 maintains compatibility with V1 data formats:
- `frames[]` array (V2) coexists with top-level `html`/`css` (V1)
- Legacy single-template loads are auto-converted to a single FrameData
- Canvas/objects fields in API types are retained but unused
- API endpoints accept both old and new payload formats

### 13.6 SyncLock Pattern

**Pattern:** A `useRef` boolean flag (`syncLockRef`) prevents bidirectional sync infinite loops.

**Flow:**
1. DOM→Code change starts → `syncLockRef = true`
2. Code state updates → React re-render
3. DesignFrame `useEffect` checks `syncLockRef` → skips DOM update
4. Next render: `syncLockRef = false` → normal sync resumes

### 13.7 MCP as Universal Client

**Pattern:** The editor UI itself calls MCP tools (via `mcpClient.ts`). This means:
- Every operation available to AI agents is also available to the UI
- Tool implementations are centralized in the MCP server
- The REST API and MCP share the same service layer (dual-write to store + Supabase)
- UI panels (VariablesPanel, StructurePanel, ElementProperties) are MCP clients

### 13.8 Debounce + Exponential Backoff

**Pattern:** Frontend auto-save uses a two-phase approach:
1. **Debounce:** 2-second delay before triggering save (prevents excessive writes during rapid editing)
2. **Exponential backoff:** On API failure, retry with increasing delays (1s → 2s → 4s)

---

## 14. Deprecated/Misleading Documentation

| File | Status | Details |
|------|--------|---------|
| **`ARCHITECTURE.md`** | ❌ FULLY DEPRECATED | Claims Fabric.js v6 is the canvas engine. References `CanvasEditor`, `PropertiesPanel`, `useCanvas` hook, 37 MCP tools. **NONE of this exists in V2.** The entire document describes the Fabric.js v1 architecture and should be ignored completely. |
| **`SKILL.md`** | ⚠️ PARTIALLY DEPRECATED | May contain Fabric.js v1 references in agent skill descriptions. Verify each skill's relevance before trusting. |
| **`BUGS_DESIGN_REPLICATION.md`** | ❌ DEPRECATED | Bug tracking from Fabric.js v1 era. Not applicable to V2. |
| **`docs/MCP_TOOL_CATALOG_V2.md`** | ✅ MOSTLY ACCURATE | Planning document for MCP tools. Tool counts may differ from actual implementation (100+ implemented vs 76 planned). The tool descriptions are largely accurate for the tools that exist. |
| **`docs/HTML_ENGINE_ARCHITECTURE.md`** | ✅ ACCURATE | Correctly describes V2 architecture. Line counts are outdated (files have grown significantly since this was written), but the architectural concepts remain accurate. |
| **`docs/DESIGN_HARNESS_ROADMAP.md`** | ✅ ACCURATE | Roadmap document, still relevant. |
| **`api/src/types.ts`** | ⚠️ CONTAINS LEGACY TYPES | Still defines `CanvasData`, `CanvasObject`, and Fabric.js-related types for backward compatibility. These are not used in V2 but are kept to avoid breaking API contracts. |

**Key differences between deprecated ARCHITECTURE.md and current V2:**

| Aspect | ARCHITECTURE.md (V1, deprecated) | Actual V2 |
|--------|----------------------------------|-----------|
| Canvas engine | Fabric.js v6 | Shadow DOM + iframe (NO Fabric.js) |
| Core component | CanvasEditor | EditorV2 + DesignFrame |
| Properties panel | PropertiesPanel (Fabric.js objects) | HtmlContextualPanel (CSS properties) |
| Core hook | useCanvas (689 lines) | DesignFrame (723 lines) + InfiniteHtmlCanvas (244 lines) |
| MCP tools | 37 | 100+ |
| Render | Fabric.js StaticCanvas | html2canvas |
| Frame system | Not present | Multi-frame artboard system |
| Code sync | Not present | Bidirectional CSS↔DOM sync |
| Layer system | Fabric.js object layers | HTML DOM layers with data-layer-id |

---

## 15. File Size Reference

| File | Lines | Purpose |
|------|-------|---------|
| `netlify/functions/mcp.mjs` | 4,390 | 🔥 Largest file — MCP server with 100+ tools |
| `src/pages/EditorV2.tsx` | 1,278 | Main editor orchestrator |
| `src/components/DesignFrame.tsx` | 723 | Shadow DOM rendering + interaction engine |
| `src/components/HtmlContextualPanel.tsx` | 507 | Contextual element properties panel |
| `src/components/Dashboard.tsx` | 408 | Template gallery |
| `src/components/HtmlLayersPanel.tsx` | 305 | Layer tree panel |
| `api/src/services/store.ts` | 287 | In-memory store + snapshot system |
| `netlify/functions/render.mjs` | 254 | Self-rendering HTML page |
| `api/src/types.ts` | 250 | Server type definitions |
| `src/components/InfiniteHtmlCanvas.tsx` | 244 | Infinite pan/zoom canvas |
| `api/src/services/templates.ts` | 234 | Template service |
| `src/lib/templateApi.ts` | 221 | Client-side template API |
| `src/components/FloatingToolbar.tsx` | 216 | Tool palette with shortcuts |
| `src/hooks/useLayerTree.ts` | 207 | HTML→layer tree parser + operations |
| `src/components/CodePanel.tsx` | 170 | Monaco editor wrapper |
| `src/components/GoogleFontPicker.tsx` | 163 | Font catalog picker |
| `src/hooks/useDockablePanel.ts` | 156 | Drag-and-dock panel system |
| `src/components/ElementProperties.tsx` | 171 | Element CSS property editor |
| `src/components/VariablesPanel.tsx` | 115 | CSS variable editor |
| `src/components/StructurePanel.tsx` | 96 | DOM structure analyzer |
| `netlify/functions/api.mjs` | 96 | Express → Netlify bridge |
| `src/lib/supabaseRealtime.ts` | 94 | Supabase Realtime client |
| `src/App.tsx` | 86 | Router (useReducer) |
| `api/src/index.ts` | 83 | Express app setup |
| `api/src/middleware/rateLimit.ts` | 46 | Rate limiter |
| `src/types.ts` | 33 | Frontend type definitions |
| `api/src/middleware/auth.ts` | 24 | API key auth |
| `src/lib/mcpClient.ts` | 20 | JSON-RPC 2.0 client |
| `src/main.tsx` | 14 | Entry point |
| `src/lib/supabase.ts` | 12 | API fetch wrapper |
| `api/src/server.ts` | 7 | Server listen |
| `index.html` | 13 | SPA HTML entry |

**Total:** Approximately 10,000+ lines of source code across frontend, API, and MCP server.

---

## Appendix: Netlify Functions Bridge Detail

### api.mjs (96 lines)

Bridges the Express application to Netlify's serverless function interface:

```javascript
// 1. Import the Express app (compiled TypeScript → dist/)
import app from "../../api/dist/index.js";

// 2. Convert Netlify event to Node.js IncomingMessage
function createRequest(event) {
  // Creates a Readable stream from event.body
  // Sets method, url, headers from event
}

// 3. Create mock Response object
function createResponse(callback) {
  return {
    statusCode: 200,
    headers: {},
    json(data) { /* set body, call callback */ },
    send(data) { /* set body, call callback */ },
    end(data) { /* set body, call callback */ },
    write(data) { /* buffer data */ },
    setHeader(k, v) { /* set header */ },
    // ...
  };
}

// 4. Export handler
export async function handler(event) {
  const req = createRequest(event);
  const res = createResponse((result) => {
    // Convert res to Netlify function response format
    return {
      statusCode: res.statusCode,
      headers: res.headers,
      body: res.body,
    };
  });
  
  await new Promise((resolve) => {
    res.resolve = resolve;
    app(req, res);
  });
  
  return res.result;
}
```

### render.mjs (254 lines)

Self-rendering HTML page for browser-based template rendering:

```
GET /api/render/:templateId
  → Fetch template from API
  → Extract font links from CSS
  → Build HTML page with:
    - html2canvas from CDN
    - Font stylesheet links
    - Template CSS embedded
    - Template HTML embedded
    - Download button with onclick handler
    - Script to auto-render all frames
  → Return HTML (Content-Type: text/html)

GET /api/render/:templateId/frame/:frameId
  → Same but renders a specific frame
```

---

> **Document Version:** 2.0 — June 2026  
> **Document Status:** ✅ ACCURATE — reflects current V2 full-web architecture  
> **Deprecated:** `ARCHITECTURE.md` (root) — Fabric.js v1, do not trust  
> **Total MCP Tools Documented:** 100+ across 22 categories  
> **Total Source Lines Analyzed:** 10,000+
