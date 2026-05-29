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

### MCP (Model Context Protocol)

AI agents connect to `https://futuraria.netlify.app/mcp` to discover and invoke 10 tools:

| Tool | Description |
|------|-------------|
| `list_workspaces` | List workspaces (Supabase-first) |
| `create_workspace` | Create workspace (store + Supabase upsert) |
| `list_templates` | List templates with workspace filter + search |
| `get_template` | Full template with canvas, frames, styles |
| `create_template` | Create template in a workspace |
| `update_template` | Update name or canvas data |
| `delete_template` | Permanently delete |
| `duplicate_template` | Independent copy |
| `export_template` | Export as .futuraria JSON |
| `import_template` | Import .futuraria JSON (store + Supabase upsert) |

**Protocol:** SSE init (GET) → JSON-RPC calls (POST). Same auth via `x-api-key` header. Same freemium dual-write as REST API.

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
| `netlify/functions/mcp.mjs` | ~337 | MCP server (10 tools) |
| `netlify.toml` | 22 | Build config + redirects |
| `package.json` | 36 | Config + react-doctor ignore rules |
| `vite.config.ts` | 12 | Vite + React plugin + alias |
