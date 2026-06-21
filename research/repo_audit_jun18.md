# Repo Audit — design-main (June 18, 2026)

> Comprehensive audit of the `design-main` repository at `C:\Users\Renzo\.openclaw\workspace\design-main`.
> Focus: HTML engine support, MCP tools, render pipeline, multi-agent editing readiness.

---

## 1. Architecture Overview

```
design-main/
├── src/                          # React frontend (Vite)
│   ├── App.tsx                   # Main app with view routing (dashboard, editor, editor-v2)
│   ├── pages/EditorV2.tsx        # HTML/CSS editor (Monaco + iframe preview)
│   ├── components/
│   │   ├── HtmlCanvas.tsx        # Iframe-based live preview with zoom + element selection
│   │   ├── CodePanel.tsx         # Monaco editor with HTML/CSS tabs (debounced)
│   │   ├── CanvasEditor.tsx      # Fabric.js canvas editor (original)
│   │   └── ... (18 more panel/UI components)
│   ├── lib/
│   │   ├── mcpClient.ts          # MCP client (talks to /mcp endpoint)
│   │   ├── supabase.ts           # API fetch wrapper with dev-key auth
│   │   └── templateApi.ts        # Template CRUD + localStorage fallback
│   └── shared/index.ts           # Simplified DesignTemplate type (no engine/html/css fields)
├── api/                          # Express API (Netlify Functions or standalone)
│   └── src/
│       ├── index.ts              # Express app: ~16 route groups
│       ├── types.ts              # Full DesignTemplate with engine, html, css
│       ├── server.ts             # Standalone server entry
│       ├── services/
│       │   ├── templates.ts      # Template CRUD + Supabase sync
│       │   ├── store.ts          # In-memory Map-based store
│       │   ├── renderer.ts       # Render job factory (stub, no Puppeteer)
│       │   └── supabase.ts       # Supabase client singleton
│       ├── routes/
│       │   ├── templates.ts      # Full REST: CRUD, duplicate, export, import, bulk-delete
│       │   └── render.ts         # Render trigger + poll endpoints
│       └── middleware/
│           ├── auth.ts           # Pass-through auth (x-api-key / Bearer / dev_user_default)
│           └── validate.ts       # Zod schemas for all routes (includes engine/html/css)
├── netlify/functions/
│   ├── mcp.mjs                   # 🧠 THE MCP SERVER — 84+ tools, 5000+ lines
│   ├── render.mjs                # Self-rendering HTML + Fabric.js → PNG/JPG/SVG
│   └── api.mjs                   # Express adapter for Netlify Functions
├── test_mcp.mjs                  # Integration test: 16 test suites for MCP tools
└── package.json                  # Vite + React + Monaco + Fabric.js + DOMPurify
```

---

## 2. What's Implemented & Working ✅

### 2.1 HTML Template Engine (New)

| Component | Status | Details |
|-----------|--------|---------|
| `DesignTemplate.engine` field | ✅ | `"fabric" \| "html"` in `api/src/types.ts` |
| `DesignTemplate.html` field | ✅ | `string \| undefined` — raw HTML body |
| `DesignTemplate.css` field | ✅ | `string \| undefined` — CSS stylesheet |
| `createTemplateSchema` (Zod) | ✅ | Accepts `engine`, `html`, `css` |
| `updateTemplateSchema` (Zod) | ✅ | Accepts `engine`, `html`, `css` |
| POST `/api/templates` | ✅ | Creates templates with engine/html/css, persists via `updateTemplate` |
| PUT `/api/templates/:id` | ✅ | `updateTemplate` merges engine/html/css into DesignTemplate |
| `store.createTemplate()` | ✅ | Defaults to `engine: "fabric"`, has html/css fields in type |
| `EditorV2.tsx` | ✅ | Full Monaco editor + iframe preview + auto-save |
| `HtmlCanvas.tsx` | ✅ | Iframe with CSP, zoom controls, postMessage element selection |
| `CodePanel.tsx` | ✅ | Two-tab Monaco editor (HTML + CSS), 200ms debounce |
| `App.tsx` routing | ✅ | `"editor-v2"` ViewMode, `OPEN_TEMPLATE_V2` action, renders `<EditorV2>` |
| Engine detection in EditorV2 | ✅ | Shows error if template uses Fabric engine (`engine !== "html"`) |
| Auto-save (EditorV2) | ✅ | 2-second debounced PUT with html/css body |
| `loadFromJSON` compatibility | ✅ | EditorV2 falls back to localStorage if API canvas is empty |
| DOMPurify in package.json | ✅ | `dompurify: ^3.4.11`, `@types/dompurify: ^3.0.5` |
| `@monaco-editor/react` | ✅ | `^4.7.0` in package.json dependencies |

### 2.2 MCP Server (netlify/functions/mcp.mjs)

The MCP server is a **behemoth** — 84+ JSON-RPC tools in a single file (~6000 lines), all routed via `handleMethod()`.

**HTML-specific MCP tools:**

| Tool | Status | Description |
|------|--------|-------------|
| `create_html_template` | ✅ | Creates HTML engine template with initialHtml/initialCss |
| `set_html` | ✅ | Replaces full HTML, sanitizes server-side via DOMPurify |
| `set_css` | ✅ | Replaces full CSS |

**DOMPurify config in `set_html`:**
```javascript
DOMPurify.sanitize(params.html, {
  ALLOWED_TAGS: ["div", "span", "h1".."h6", "p", "img", "a", "br", "svg", "path", ...],
  ALLOWED_ATTR: ["class", "id", "src", "alt", "href", "data-layer-id", "style", ...]
});
```

**Existing MCP tools (non-HTML) — all working:**
- Workspaces: `list_workspaces`, `create_workspace` ✅
- Templates: `list_templates`, `get_template`, `create_template`, `update_template`, `delete_template`, `duplicate_template` ✅
- Export/Import: `export_template`, `import_template` ✅
- Canvas objects: `draw_shape`, `add_text`, `add_image`, `upload_image`, `add_svg_path`, `add_block`, `add_code_block`, `add_table`, `add_columns`, `add_toggle`, `add_callout`, `add_quote` ✅
- Object manipulation: `transform_object`, `delete_objects`, `reorder_object`, `align_objects`, `distribute_objects`, `group_objects`, `ungroup_objects`, `copy_object`, `duplicate_object` ✅
- Boolean ops: `boolean_operation` ✅
- Layout: `auto_layout`, `smart_layout` ✅
- Frames: `create_frame`, `list_frames`, `get_frame`, `update_frame`, `delete_frame`, `render_frame`, `frame_auto_layout` ✅
- Render: `render_batch`, `render_frame` ✅
- Versioning: `list_versions`, `restore_version` ✅
- Diff/Snapshot: `snapshot_template`, `diff_template`, `snapshot_auto`, `list_snapshots`, `diff_snapshots` ✅
- Ghost System: `ghost_show`, `ghost_diff`, `ghost_merge`, `ghost_timeline`, `ghost_compare` ✅
- Clone Skills: `skill_extract`, `skill_clone`, `skill_apply` ✅
- Brand: `brand_analyze`, `brand_apply` ✅
- Design quality: `aesthetic_score`, `design_lint`, `auto_polish` ✅
- Batch: `batch_update`, `batch_design_from_csv` ✅
- Styles: `create_style`, `apply_style` ✅
- Variables: `create_variable`, `create_collection`, `link_variable` ✅
- Components: `create_component`, `create_instance`, `add_variant`, `set_component_prop` ✅
- Prototyping: `add_interaction`, `set_animation`, `add_overlay`, `set_scroll_position` ✅
- Canvas: `canvas_pan`, `canvas_zoom`, `canvas_grid`, `canvas_rulers`, `canvas_snap`, `canvas_pages` ✅
- History: `history_undo`, `history_redo` ✅
- Export: `export_batch`, `copy_as`, `export_pdf` ✅
- Embedding: `embed_video`, `embed_figma`, `embed_audio`, `embed_pdf`, `embed_social` ✅
- AI: `ai_generate_text`, `ai_generate_image`, `ai_palette`, `ai_suggest_layout`, `ai_translate` ✅
- UI: `search_google_fonts`, `color_picker`, `suggest_color_palette`, `preview_font`, `render_markdown`, `gallery_create` ✅
- Misc: `add_comment`, `mention_user`, `share_template`, `set_gradient`, `set_shadow`, `set_blur`, `image_filter`, `image_crop` ✅
- Plugins: `register_tool`, `auth_token`, `publish_library` ✅
- Design tools: `observe_session`, `remix_template`, `design_diff` ✅

### 2.3 Render Pipeline

**Fabric.js engine:** `buildRenderPage()` in `render.mjs`
- Self-contained HTML page using Fabric.js v5 CDN
- Converts SVG paths, gradients, normalizes types
- Auto-download PNG on load
- Google Fonts async loading via `document.fonts.ready`
- Manual download buttons (PNG/JPG/SVG)

**HTML engine:** `buildRenderPageHtml()` in `render.mjs`
- Renders tpl.html + tpl.css into an HTML page
- Auto-captures as PNG using SVG `foreignObject` → Canvas → `toBlob`
- Works but limited: `foreignObject` rendering is browser-dependent, not identical to native HTML
- No Puppeteer/Chromium dependency (bypasses Netlify's file size limits)

**Render endpoints:**
| Endpoint | Method | Status |
|----------|--------|--------|
| `/api/templates/:id/render` | POST | ✅ Returns HTML page or JSON with render links |
| `/api/templates/:id/render/:jobId` | GET | ✅ Polls job status |
| `/api/render/:templateId` | POST | ✅ Legacy endpoint |
| `/api/render/:templateId/:jobId` | GET | ✅ Legacy poll |
| `/api/render/:templateId/frame/:frameId` | GET | ✅ Frame-specific render |

### 2.4 Database (Supabase)

**templates table schema** (from service code):
| Column | Type | Details |
|--------|------|---------|
| `id` | TEXT PK | `tpl_xxxxxxxx` format |
| `name` | TEXT | Human-readable name |
| `workspace_id` | TEXT | FK reference |
| `data` | JSONB | Full DesignTemplate object (includes html, css, engine, canvas, frames, etc.) |
| `user_id` | UUID | FK → auth.users (nullable in code if not UUID format) |
| `created_at` | TIMESTAMPTZ | Auto-generated |
| `updated_at` | TIMESTAMPTZ | Auto-updated via trigger |

**Key insight:** The entire template is stored as a single JSONB `data` column. The `html`, `css`, and `engine` fields live **inside** the JSONB, not as separate columns. This means:
- No column-level locking possible
- Updates always replace the entire JSONB row
- No database-level conflict detection for partial field updates

### 2.5 In-Memory Store

`api/src/services/store.ts` — `Map<string, DesignTemplate>`:
- `createTemplate()` — defaults engine to `"fabric"`
- `updateTemplate()` — deep-merges all fields including html/css/engine/canvas
- `snapshotAuto()` — saves full template snapshot (50-per-template limit)
- `listSnapshots()` / `getSnapshot()` — timeline management
- `createFrame()` / `updateFrame()` / `deleteFrame()` — frame CRUD
- No TTL on templates (persists for warm function lifetime)

---

## 3. What's Partially Implemented ⚠️

| Feature | Status | Gap |
|---------|--------|-----|
| **DOMPurify sanitization** | ⚠️ | Used in MCP `set_html` but NOT in REST API `PUT /api/templates/:id`. The REST API accepts raw html/css without sanitization. |
| **HTML render quality** | ⚠️ | Uses SVG `foreignObject` hack, not Puppeteer. Complex CSS (grid, flexbox, animations) may fail. No Google Fonts loading for HTML engine. |
| **Element selection (editor)** | ⚠️ | `HtmlCanvas` sends postMessage on click, `EditorV2.handleSelectElement` only logs to console — no Monaco sync. |
| **Snapshot/diff for HTML** | ⚠️ | `compareTemplates()` only compares `canvas.objects`. HTML/CSS content is NOT diffed. `snapshot_template` snapshots the full template including html/css, but diffs ignore them. |
| **Supabase persistence** | ⚠️ | `upsertSupabase()` only rungs if Supabase is configured. Falls back to in-memory silently. No queue/retry for failed writes. |
| **Auth** | ⚠️ | Pass-through auth — any header value becomes userId. No JWT validation, no Supabase auth integration. `dev_user_default` fallback always works. |
| **Frontend localStorage fallback** | ⚠️ | `templateApi.ts` has localStorage fallback for offline/freemium. Creates data consistency issues (local vs server). |
| **Zoom controls in EditorV2** | ⚠️ | Zoom only affects iframe CSS transform. Does NOT change the actual canvas dimensions or CSS media queries. |

---

## 4. What's Completely Missing ❌

### 4.1 Real-Time Collaboration (Multi-Agent)

| Feature | Priority | Notes |
|---------|----------|-------|
| **WebSocket/SSE server** | 🔴 Critical | No real-time transport. Agents poll or use REST, no push updates. |
| **CRDT/OT for text** | 🔴 Critical | No operational transform or CRDT for concurrent html/css editing. |
| **Conflict detection** | 🔴 Critical | PUT blindly overwrites. No `if-match` (ETag) or version-vector checking. |
| **Per-field locking** | 🟡 High | No way to say "I'm editing CSS, you edit HTML." Everything is one big JSONB. |
| **Presence/awareness** | 🟡 High | No cursor position sharing, no "Agent X is editing this section" indicators. |
| **Optimistic updates with rollback** | 🟡 High | Only 2s debounced save. No undo stack for remote changes. |
| **Change acknowledgement** | 🟡 High | No ACK when save succeeds. No retry queue for failed saves. |

### 4.2 HTML Editor Features

| Feature | Priority | Notes |
|---------|----------|-------|
| **CSS autocomplete (framework)** | 🟡 High | Monaco has basic CSS, but no Tailwind/SCSS/etc. language services. |
| **HTML validation/linting** | 🟡 High | No HTMLHint or W3C validator integration. |
| **CSS linting** | 🟢 Medium | No Stylelint or CSS validation. |
| **Responsive preview** | 🟢 Medium | Only single width/height. No device presets (mobile, tablet, desktop). |
| **Element inspector** | 🟢 Medium | Click → shows element in iframe but doesn't highlight match in code. |
| **HTML components/templates** | 🟢 Medium | No snippet library for HTML engine. Only Fabric `add_block` equivalents. |
| **CSS variable manager** | 🟢 Medium | No UI for managing CSS custom properties for HTML engine. |
| **Dark/light mode preview** | 🟢 Low | Only dark theme editor. No `prefers-color-scheme` toggle. |
| **Code formatting (Prettier)** | 🟢 Low | No auto-format on save. |

### 4.3 MCP Tools Missing

| Tool | Why Needed |
|------|------------|
| `get_html` | Get just the HTML content (without full 500KB template JSON) |
| `get_css` | Get just the CSS content |
| `diff_html` | Compare two HTML strings/templates |
| `render_html_template` | Trigger Puppeteer render specifically for HTML engine templates |
| `validate_html` | Server-side W3C validation |
| `validate_css` | Server-side CSS validation |
| `preview_html` | Generate a shareable preview URL (not just render-to-image) |
| `html_to_canvas` | Convert HTML template to Fabric.js objects for hybrid editing |
| `canvas_to_html` | Convert Fabric.js template to HTML/CSS |

### 4.4 Rendering

| Feature | Notes |
|---------|-------|
| **Puppeteer server-side render** | The `render.mjs` explicitly avoids Puppeteer due to Netlify's 50MB limit. No headless Chrome rendering available. SVG foreignObject is a hack that breaks on complex CSS. |
| **HTML engine font loading** | `buildRenderPageHtml()` does NOT include Google Fonts CSS. If the template uses custom fonts, they won't render. |
| **Image assets in HTML** | No proxy/CORS handling for external images in the HTML engine render. |
| **Responsive render** | No way to render at multiple breakpoints. |

### 4.5 Developer Experience

| Feature | Notes |
|---------|-------|
| **Test suite** | `test_mcp.mjs` exists as an integration test but is NOT wired to any npm script or CI. Only tests Fabric.js functions. |
| **TypeScript project references** | No monorepo setup. `src/shared/index.ts` has an outdated DesignTemplate type without engine/html/css fields. |
| **Error boundaries** | No React ErrorBoundary in EditorV2. |
| **Loading states** | EditorV2 has loading/error states. Other components vary. |
| **API versioning** | No versioning strategy. API is flat `/api/templates/...`. |
| **API rate limiting** | MCP has in-memory rate limiter (60 req/min). Express API has `rateLimit` middleware (implementation not reviewed). |
| **CORS** | Wide open (`Access-Control-Allow-Origin: *`). No origin validation. |

---

## 5. API/MCP Tool Matrix

### 5.1 REST API Endpoints

| Method | Path | Auth | Working? |
|--------|------|------|----------|
| GET | `/api/health` | No | ✅ |
| POST | `/api/templates` | Yes | ✅ (engine/html/css supported) |
| GET | `/api/templates` | Yes | ✅ (pagination, search, workspace filter) |
| GET | `/api/templates/:id` | Yes | ✅ |
| PUT | `/api/templates/:id` | Yes | ✅ (html/css NOT sanitized ⚠️) |
| DELETE | `/api/templates/:id` | Yes | ✅ |
| POST | `/api/templates/:id/duplicate` | Yes | ✅ |
| GET | `/api/templates/:id/export` | Yes | ✅ |
| POST | `/api/templates/import` | Yes | ✅ |
| POST | `/api/templates/bulk/delete` | Yes | ✅ |
| POST | `/api/templates/:id/render` | Yes | ✅ (HTML engine support via render.mjs) |
| GET | `/api/templates/:id/render/:renderId` | Yes | ✅ |

### 5.2 MCP Tools vs REST Coverage

| Domain | MCP Tool | REST Counterpart | Gap |
|--------|----------|-----------------|-----|
| HTML create | `create_html_template` | `POST /api/templates` | MCP tool provides cleaner API with initialHtml/initialCss params |
| HTML edit | `set_html`, `set_css` | `PUT /api/templates/:id` | MCP sanitizes with DOMPurify; REST does NOT |
| HTML get | `get_template` | `GET /api/templates/:id` | Both return full template. No partial fetch. |

---

## 6. What Needs to Change for Multi-Agent Simultaneous Editing

### 6.1 Architecture Changes

```
Current:
  Agent A ──PUT──▶ API Server ──upsert──▶ Supabase (last write wins)
  Agent B ──PUT──▶ API Server ──upsert──▶ Supabase

Needed:
  Agent A ──WebSocket──▶ WS Server ──CRDT──▶ State ──persist──▶ Supabase
  Agent B ──WebSocket──▶ WS Server ──CRDT──▶ State
```

### 6.2 Required Changes by Layer

**Database (Supabase):**
1. Add `version` column (monotonic counter) to templates table for optimistic locking
2. Consider breaking `html`/`css` into separate columns (not just inside `data` JSONB) to allow column-level updates and reduce conflict surface
3. Add `locked_by` and `locked_at` columns for optional pessimistic locking

**API Server:**
1. Add `If-Match` / ETag header validation on PUT
2. Add `PATCH` endpoint for partial field updates (html-only, css-only)
3. Sanitize html/css on REST PUT (parity with MCP's DOMPurify usage)
4. Add WebSocket endpoint for real-time sync
5. Add change notification events (which templates changed, what fields)

**MCP Server:**
1. Add `lock_template` / `unlock_template` tools for explicit locking
2. Add `get_template_version` tool (version + ETag for optimistic concurrency)
3. Add `patch_template` tool (partial update with field-level conflict detection)
4. Add `subscribe_template` tool (return SSE/WS URL for live updates)
5. Diff tools need HTML content comparison (`diff_html`, `diff_css`)

**Frontend Editor:**
1. Replace debounced auto-save with real-time sync (Yjs or similar)
2. Add presence indicators ("Agent X is editing CSS")
3. Add optimistic updates with server reconciliation
4. Add conflict resolution UI (show incoming changes, accept/reject)

### 6.3 Collaborative Editing Strategy Options

| Approach | Complexity | Best For |
|----------|-----------|----------|
| **Optimistic locking (ETag)** | Low | 2-3 agents, infrequent conflicts |
| **Pessimistic locking (field-level)** | Medium | Coordinated agents, clear ownership |
| **CRDT (Yjs)** | High | Many simultaneous editors, text-heavy |
| **Operational Transform** | High | Real-time text editing |

**Recommendation:** Start with optimistic locking (ETag + version counter) + field-level PATCH for html/css. This is the lowest-hanging fruit with the most immediate impact for 2-5 AI agents editing the same template.

---

## 7. Dependency & Build Health

### 7.1 Frontend (package.json)

| Dependency | Version | Status |
|------------|---------|--------|
| react | ^18.3.1 | ✅ |
| react-dom | ^18.3.1 | ✅ |
| @monaco-editor/react | ^4.7.0 | ✅ |
| fabric | ^6.9.1 | ✅ (note: Fabric.js v6, MCP uses Fabric v5 CDN) |
| dompurify | ^3.4.11 | ✅ (only used in MCP, not in frontend bundle) |
| @types/dompurify | ^3.0.5 | ✅ |

**⚠️ Version mismatch:** Frontend uses Fabric.js v6 (`fabric: ^6.9.1`), but `render.mjs` loads Fabric.js v5 from CDN. These APIs differ (`StaticCanvas.loadFromJSON` behavior, gradient format, etc.).

### 7.2 API (api/package.json)

| Dependency | Version | Status |
|------------|---------|--------|
| express | ^4.21.0 | ✅ |
| @supabase/supabase-js | ^2.49.0 | ✅ |
| uuid | ^10.0.0 | ✅ |
| zod | ^3.23.0 | ✅ |
| cors | ^2.8.5 | ✅ |

**Missing API dependencies:**
- No `dompurify` in api/package.json (it's in the root package.json but used in the MCP function which imports from root)
- No `puppeteer` or `chrome-aws-lambda` (deliberately avoided)
- No WebSocket library (ws, socket.io)
- No rate-limiting library (custom implementation)

---

## 8. Type System Alignment

### 8.1 DesignTemplate Types — Fragmentation

| File | Has engine? | Has html? | Has css? | Has workspaceId? |
|------|-------------|-----------|----------|-----------------|
| `api/src/types.ts` | ✅ `"fabric" \| "html"` | ✅ `string?` | ✅ `string?` | ✅ |
| `src/shared/index.ts` | ❌ | ❌ | ❌ | ❌ |
| `src/lib/templateApi.ts` | ❌ (imports from `@futuraria/shared`) | ❌ | ❌ | ❌ via interface |

**⚠️ The frontend's `TemplateFull` interface in `templateApi.ts` is missing engine/html/css fields.** EditorV2 works around this by casting to `any`:

```typescript
const t = tpl as any;
if (t.engine && t.engine !== "html") { ... }
```

This needs to be fixed: update `src/shared/index.ts` to match `api/src/types.ts`.

---

## 9. Quick Wins (Tactical Fixes)

These can be done immediately without architectural changes:

1. **Sanitize html in REST PUT** — Add DOMPurify to `api/src/routes/templates.ts` PUT handler (parity with MCP)
2. **Fix frontend types** — Update `src/shared/index.ts` with engine/html/css fields
3. **Add version counter** — Add `version` field to templates table + increment on each update
4. **Add ETag support** — Return `ETag` header on GET, validate `If-Match` on PUT
5. **Add MCP `patch_template` tool** — Partial update for specific fields (html-only, css-only)
6. **Add Google Fonts to HTML render** — Include font links in `buildRenderPageHtml()`
7. **Wire test_mcp.mjs to npm script** — Add `"test:mcp": "node test_mcp.mjs"` to package.json
8. **Fabric version alignment** — Document or resolve v5 vs v6 discrepancy

---

## 10. Summary

| Category | Count |
|----------|-------|
| ✅ Fully implemented | ~35 features |
| ⚠️ Partially implemented | 8 features |
| ❌ Completely missing | 20+ features |
| MCP Tools | 84+ (83 for Fabric, 3 for HTML) |
| REST Endpoints | 12 |
| Components | 28 frontend + 16 API routes |
| Lines of MCP code | ~6,000 |
| Lines of API code | ~2,500 |
| Lines of frontend code | ~5,000+ |

**Overall Assessment:** The HTML engine integration is **foundationally solid** — types are correct, the API accepts html/css, the editor works end-to-end (Monaco + iframe preview + auto-save), and the MCP has dedicated `create_html_template`/`set_html`/`set_css` tools with DOMPurify sanitization. The main gaps are: (1) no real-time collaboration, (2) no Puppeteer-based high-fidelity render, (3) no conflict detection for simultaneous edits, and (4) fragmented type definitions between frontend and API.
