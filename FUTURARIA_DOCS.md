# Futuraria Design - Complete System Documentation

> **Comprehensive documentation** - every file, every function, every architectural decision.
> API v3.0.0 | Editor v0.1.0 | MIT | Renzo Perez Bartra (futuraria.com)

---

## Table of Contents

1. Project Overview & Architecture
2. Root Configuration Files
3. n8n Workflow Files
4. Shared Package (`packages/shared`)
5. API Backend (`packages/api`)
6. Editor Frontend (`packages/editor`)
7. Netlify Functions
8. Errors, Inconsistencies & Issues Found
9. Architecture Decision Records (Implicit)
10. Build Configuration & Config Files
11. Additional Issues Found (Third Pass)
12. Data Flow & Auth Chain Diagrams
13. Omissions & Gaps (Final Review)
14. Deep Audit: Complete Function-by-Function Verification
15. Exhaustive Completion Audit - Previously Undocumented Functions & Details
16. Database Schema Audit - Missing Tables, RLS Policies, Code Mismatches

---

## 1. Project Overview & Architecture

**Futuraria Design** - AI-first design tool (Mini-Figma) with REST API, webhooks, and n8n integration for content automation. Monorepo with 3 packages.

```
┌─────────────────────┐        ┌─────────────────────┐
│  Frontend (Netlify)  │        │  Backend (Railway)   │
│  React + Fabric.js   │◄──────►│  Express API         │
│  Canvas Editor       │  JSON  │  + Puppeteer (render)│
│                      │        │  + Supabase (storage)│
└─────────────────────┘        │  + Webhooks          │
                                └──────────┬──────────┘
                                           │
                                ┌──────────▼──────────┐
                                │       n8n            │
                                │  HTTP Request -&gt; API  │
                                │  Webhook callback    │
                                └─────────────────────┘
```

### Key Features
Canvas editor (Fabric.js 6), multi-layer system (rect, ellipse, text, image, path, line, group), Puppeteer PNG/JPG rendering, direct SVG generation, REST API, webhooks, API key management (SHA-256), template versioning, prototype interactions, auto-save, design tokens/variables, boolean operations, real-time collaboration.

### Deployment
| Component | Platform | Tech |
|-----------|----------|------|
| Frontend | Netlify | Vite-built React SPA |
| Backend (A) | Netlify Functions | Edge function (api.mts) |
| Backend (B) | Railway | Express server |
| Database | Supabase | PostgreSQL |
| Storage | Supabase Storage | `design-exports` bucket |
| Automation | n8n (self-hosted) | Workflow automation |

### Two Backend Modes
1. **Netlify Functions** (`packages/editor/netlify/functions/api.mts`): Self-contained edge function handling all API routes. Supabase service role key.
2. **Express API** (`packages/api/src/`): Traditional Express server for Railway/standalone. Middleware-based auth.

### netlify.toml Redirects
- `/api/*` -&gt; `/.netlify/functions/api/:splat`
- `/*` -&gt; `/index.html` (SPA fallback)

---

## 2. Root Configuration Files

### 2.1 `.gitignore`
**Path:** `/.gitignore`
Excludes: `node_modules/`, `dist/`, `.env`, `.env.local`, `*.log`, `.DS_Store`, `packages/editor/dist/`, `packages/api/dist/`

### 2.2 `LICENSE`
MIT License. Copyright 2026 Futuraria, Renzo Perez Bartra. Free to use, copy, modify, merge, publish, distribute, sublicense, sell. Must include copyright notice in all copies.

### 2.3 `NOTICE`
Attribution notice. All copies/forks/derivative works must include this file and display attribution to Futuraria visibly in the application.

### 2.4 `TRADEMARK.md`
"Futuraria" name and logo are trademarks. Can fork/modify under MIT but cannot name products "Futuraria" or use the logo as own brand. Can say "Based on Futuraria Design".

### 2.5 `README.md`
High-level overview with architecture diagram, packages table, quick start, API endpoints (MVP), n8n integration example, tech stack. **Only existing project doc besides n8n README.**

### 2.6 `package.json` (Root)
Scripts: `dev:editor` / `dev:api` / `build:editor` / `build:api`. `"workspaces": []` - npm workspaces NOT enabled. Each package independent.

### 2.7 `netlify.toml`
Build: base `packages/editor`, `npm install && npx vite build`, publish `dist/`. Node 22. Functions dir `netlify/functions`, esbuild bundler. Security headers: X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin. Redirects as above.

### 2.8 `package-lock.json` (Root)
Standard npm lockfile, 5794 lines.

---

## 3. n8n Workflow Files

**Directory:** `/n8n-workflows/`

### 3.1 `README.md`
Comprehensive n8n integration guide. Documents: architecture (Futuraria ↔ n8n ↔ Supabase), all API endpoints (templates, export, webhooks, health, styles, components, comments, versions), 10 webhook event types with payloads, n8n setup (import workflows, env vars, register webhooks), export pipeline steps, Supabase table listing (7 tables: templates, webhooks, api_keys, styles, components, comments, template_versions). **References `supabase-setup.sql` which does NOT exist in the repo.**

### 3.2 `01-webhook-receiver.json`
Receives Futuraria webhook events via POST at `/futuraria-events`. Nodes:
1. **Webhook** - HTTP POST endpoint, responds immediately (`onReceived`), returns all entries
2. **Switch Event** - routes on `$json.body.event` for 6 event types: `template.created`, `template.updated`, `render.complete`, `version.created`, `comment.created`, `layer.updated`
3. **Log Template Created** (set) - extracts action, templateId, templateName
4. **Log Render Complete** (set) - extracts action, renderId, templateId, format
5. **Log Comment** (set) - extracts action, commentId, author, text
Status: `active: false`

### 3.3 `02-api-manager.json`
Manages Futuraria templates via API calls. Nodes:
1. **Schedule Trigger** (cron) - every hour
2. **Manual Trigger** - manual execution
3. **List Templates** (HTTP Request) - GET `$FUTURARIA_API_URL/api/templates` with `X-API-Key`
4. **Health Check** (HTTP Request) - GET `$FUTURARIA_API_URL/api/health` (no auth)
5. **Check Status** (IF) - checks `$json.success === true`
6. **Format Output** (set) - templateCount, status
Uses `X-API-Key` header (not `Authorization: Bearer`). Status: `active: false`

### 3.4 `03-design-export.json`
Design export pipeline. Nodes:
1. **Webhook Trigger** - POST at `futuraria-export`, `lastNode` response
2. **Get Template** - GET with `X-API-Key`
3. **Request Export** - POST export (png, scale 2) with `X-API-Key`
4. **Get SVG Export** - GET SVG with `X-API-Key`
5. **Set Export Result** (set) - status, exportId, templateId, format
Status: `active: false`

---

## 4. Shared Package (`packages/shared`)

**Purpose:** All TypeScript types shared between frontend/backend. Published as `@futuraria/shared`.

### 4.1 `package.json`
Subpath exports: `.` -&gt; `./index.ts`, `./api-types`, `./collaboration`, `./components`, `./styles`. Exports raw TypeScript (no compilation).

### 4.2 `index.ts` - All Type Definitions (637 lines)
Organized into labeled sections:

**Prototype (Sprint 7):**
- `PrototypeTrigger` - `"click" | "hover" | "press" | "drag" | "afterDelay"`
- `PrototypeAction` - `type` (navigate/openOverlay/closeOverlay/swapOverlay/changeTo), `targetFrameId?`, `overlayPosition?`, `delay?`
- `TransitionType` - `"instant" | "dissolve" | "moveIn" | "moveOut" | "push" | "slideIn"`
- `TransitionDirection` - `"left" | "right" | "top" | "bottom"`
- `EasingType` - `"linear" | "easeIn" | "easeOut" | "easeInOut"`
- `PrototypeTransition` - `type`, `direction?`, `duration`, `easing`
- `PrototypeInteraction` - `id`, `trigger`, `actions[]`, `transition`
- `PrototypeFlow` - `id`, `name`, `startFrameId`

**Canvas & Base:**
- `CanvasConfig` - `width`, `height`, `background`
- `LayerType` - union of `"rect" | "ellipse" | "text" | "textbox" | "i-text" | "image" | "group" | "path" | "line"`
- `LayoutConstraint` - left/right/top/bottom (`boolean | "scale"`), centerX/Y (`boolean`)
- Auto-layout types: `AutoLayoutDirection`, `AutoLayoutAlignItems`, `ResizingMode`, `AutoLayoutPadding`, `AutoLayoutConfig`
- `BaseLayer` - foundation interface: `id`, `name`, `type`, `x`, `y`, `width`, `height`, `rotation`, `opacity`, `visible`, `locked`, `zIndex`, `styleId?`, `constraints?`, `interactions?`

**Layer Interfaces** (extend BaseLayer):
- `RectLayer` - `fill?`, `stroke?`, `strokeWidth?`, `cornerRadius?`
- `EllipseLayer` - `fill?`, `stroke?`, `strokeWidth?`
- `TextLayer` - `text`, `fontFamily?`, `fontSize?`, `fontWeight?`, `fill?`, `align?`, `lineHeight?`, `letterSpacing?`
- `ImageLayer` - `src`, `fit?` (cover/contain/fill/none), `filters?`
- `GroupLayer` - `children: Layer[]`
- `LineLayer` - `x2`, `y2`, `stroke`, `strokeWidth`, `strokeLinecap?`
- `PathLayer` - `d` (SVG path), `fill?`, `stroke?`, `strokeWidth?`, `fillRule?`
- `SectionLayer` - `id`, `name`, `type: "section"`, `x`, `y`, `width`, `height`, `color`, `collapsed`
- `Layer` - union of all above

**Image Filters:** `ImageFilters` - `brightness?`, `contrast?`, `saturation?`, `blur?`, `grayscale?`, `sepia?`

**Layer Overrides** (n8n/API automation): `LayerOverride` - `text?`, `fontFamily?`, `fontSize?`, `fill?`, `stroke?`, `imageUrl?`, `imageBase64?`, `visible?`, `opacity?`, `x?`, `y?`, `width?`, `height?`

**Template:** `TemplateMetadata` (`createdAt`, `updatedAt`), `DesignTemplate` - main type: `id`, `name`, `schemaVersion`, `canvas: CanvasConfig`, `layers: Layer[]`, `variables?`, `variableCollections?`, `variableList?`, `prototypeFlows?`, `branches?`, `metadata`

**Variables (Sprint 6):** `VariableType` (color/number/string/boolean), `VariableScope`, `Variable` (id, name, type, values per-mode map, collectionId, aliasOf?, scopes?, timestamps), `VariableCollection` (id, name, modes[], defaultMode)

**Branching (Sprint 8):** `Branch` - `id`, `name`, `templateId`, `parentBranchId?`, `createdAt`, `createdBy?`

**Render:** `RenderRequest` (format png/jpg/svg, scale, quality, overrides, webhookUrl), `RenderResponse` (id, status, templateId, format, dimensions, url, error, timestamps)

**Pagination:** `PaginatedResponse<T>` - `data: T[]`, `total`, `limit`, `offset`

**API Key Types:** `ApiKey` (id, name, key_prefix, permissions[], last_used_at, active, created_at), `AuthContext` (apiKeyId, userId, permissions[])

**Styles (Sprint 3):** `StyleDefinition` (id, name, type color/text/effect, fills, font props, effects, metadata), `CreateStyleRequest`, `UpdateStyleRequest`

**Components (Sprint 3):** `ComponentPropertyType`, `ComponentProperty`, `ComponentDefinition`, `ComponentInstance`, `CreateComponentPayload`, `UpdateComponentPayload`

**Comments (Sprint 5):** `Comment` (id, templateId, frameId?, x, y, author, text, thread[], resolved, timestamps), `CommentReply` (id, author, text, createdAt)

**Version History (Sprint 5):** `TemplateVersion` (id, templateId, versionNumber, data: DesignTemplate, author?, message?, createdAt)

**Boolean Ops (Sprint 6):** `BooleanOperation` - `"union" | "subtract" | "intersect" | "exclude"`

**Grid Styles:** `GridStyleType`, `GridStyle`, `CreateGridStyleRequest`, `ImageFitMode`

**Multiplayer (Sprint 8):** `CursorPosition`, `UserPresence`, `CanvasDelta`. Also exports: `USER_COLORS` (const array of 10 hex colors `#6366f1` through `#a855f7`) and function `assignUserColor(userId, existingUsers): string` - stable color assignment via userId hash, fallback to first unused color.

### 4.3-4.6 Re-export Modules
- **`api-types.ts`**: Re-exports PaginatedResponse, ApiKey, AuthContext, RenderRequest, RenderResponse, LayerOverride
- **`collaboration.ts`**: Re-exports Comment, CommentReply, TemplateVersion, DesignTemplate, CursorPosition, UserPresence, CanvasDelta, USER_COLORS, assignUserColor
- **`components.ts`**: Re-exports ComponentPropertyType, ComponentProperty, ComponentDefinition, ComponentInstance, CreateComponentPayload, UpdateComponentPayload
- **`styles.ts`**: Re-exports StyleDefinition, CreateStyleRequest, UpdateStyleRequest

---

## 5. API Backend (`packages/api`)

Express REST API. CRUD, auth, Puppeteer rendering, webhooks, Supabase storage.

```
packages/api/
├── package.json (deps: express, cors, uuid, puppeteer, supabase-js, dotenv, express-rate-limit, zod)
├── tsconfig.json (ES2022, CommonJS, path aliases)
└── src/
    ├── index.ts            - Standalone server entry (15 lines)
    ├── app.ts              - Express config & route wiring (122 lines)
    ├── middleware.ts        - Auth, rate limiting, Zod validation (198 lines)
    ├── routes/ (11 files)
    └── services/ (4 files)
```

### 5.1 `src/index.ts` - Server Entry (15 lines)
Starts Express on PORT (default 3001) / HOST (default 0.0.0.0). Logs: API version, auth mode (Supabase or disabled), available routes.

### 5.2 `src/app.ts` - Express Config (122 lines)
Central wiring for the API. In order:
1. **CORS** - validates origin against `CORS_ORIGINS` env var (defaults: design.futuraria.com, editor.futuraria.com, localhost:3000, localhost:5173). Allows credentials. Exposes rate-limit headers. Max age 86400s. Allows `*` wildcard.
2. **Body parser** - `express.json({ limit: "50mb" })` for large canvas/base64 payloads.
3. **`GET /api/health`** (public) - status, timestamp, version "3.0.0", feature list.
4. **`GET /api/config`** (public) - version "3.0.0", feature list.
5. **Auth middleware** applied to: `/api/templates`, `/api/webhooks`, `/api/styles`, `/api/components`, `/api/comments`, `/api/variables`, `/api/api-keys`.
6. **CRUD rate limit** (100/min) applied to same paths.
7. **Render rate limit** (10/min) on templates render.
8. **Route mounting** with per-path middleware.
9. **Global error handler** - CORS errors -&gt; 403, all else -&gt; 500.

### 5.3 `src/middleware.ts` - Auth, Rate Limiting, Validation (198 lines)

**Types:**
- `AuthContext`: `{ apiKeyId, userId, permissions[] }`
- Global augmentation: `Express.Request.auth?: AuthContext`

**Functions:**

`isFirstSetup(): Promise<boolean>`
Checks if zero active API keys exist in database. Used for bootstrap - when no keys exist, first POST to `/api/api-keys` is allowed without auth. Returns true in dev mode (no Supabase).

`authenticate(req, res, next)`
Main auth middleware. Flow:
1. **No Supabase** -&gt; sets dev context `{ apiKeyId: "dev", userId: "dev", permissions: ["*"] }`, skips auth.
2. **Bootstrap** -&gt; if POST to `/api/api-keys` and `isFirstSetup()` returns true, sets bootstrap context `{ apiKeyId: "bootstrap", userId: "bootstrap", permissions: ["*"] }`.
3. **Normal** -&gt; extracts API key from `Authorization: Bearer <key>` or `X-API-Key` header. Hashes with SHA-256. Looks up in `api_keys` table (active only). On success: sets `req.auth`, updates `last_used_at` (fire-and-forget). On failure: returns 401.

⚠️ **BUG (L64):** Checks for prefix `"*** "` (4 chars) not `"Bearer "` (7 chars), but then slices 7 characters. The `Authorization: Bearer` header format won't work in this middleware.

`crudRateLimit` - 100 req/min per apiKeyId or IP. `renderRateLimit` - 10 req/min. Use `express-rate-limit` with `rateLimitKey()` that returns `req.auth?.apiKeyId || req.ip`.

`validate(schema: ZodSchema)` - returns middleware. Validates `req.body` against Zod schema. On fail -&gt; 400 with structured errors (path + message per issue). On success -&gt; replaces `req.body` with parsed data.

**Defined schemas:** `createTemplateSchema`, `createLayerSchema`, `createComponentSchema`, `createStyleSchema`.
**Imported but UNDEFINED:** `updateTemplateSchema`, `duplicateTemplateSchema`, `createCommentSchema`, `updateCommentSchema`, `createReplySchema`, `createVersionSchema`, `updateStyleSchema`, `updateComponentSchema`.

### 5.4 `src/services/supabase.ts` - Supabase Client (20 lines)

`getSupabase(): SupabaseClient | null`
Singleton factory using `SUPABASE_URL` + `SUPABASE_ANON_KEY` env vars. Returns null if unconfigured or URL contains `"your-project"` placeholder. Caches client in module-level `client` variable.

### 5.5 `src/services/templates.ts` - Template Data Access (222 lines)

**State:** `memoryStore: Map<string, DesignTemplate>` (in-memory fallback when no Supabase).

**Functions:**

`createBlankTemplate(name, width, height): DesignTemplate`
Creates new blank template: `tpl_` ID prefix, schemaVersion 1, white canvas, empty layers, current timestamps.

`createTemplate(name, width?, height?, canvasJson?): Promise<DesignTemplate>`
If `canvasJson` provided, merges with generated ID and metadata. Otherwise calls `createBlankTemplate`. Persists to Supabase `templates` table (id, name, data columns) or in-memory.

`listTemplates(): Promise<DesignTemplate[]>`
Gets all templates, ordered by `created_at` DESC. Selects `data` column, maps to templates.

`listTemplatesPaginated(limit, offset): Promise<{ data, total }>`
Offset-based pagination via Supabase `range()`. Uses `count: "exact"` for total.

`getTemplate(id): Promise<DesignTemplate | null>`
Single template lookup by ID.

`updateTemplate(id, updates): Promise<DesignTemplate | null>`
Partial merge with existing. Auto-sets `updatedAt` timestamp. Persists to Supabase or memory.

`deleteTemplate(id): Promise<boolean>`
Hard delete. Returns success boolean.

`duplicateTemplate(id, newName?): Promise<DesignTemplate | null>`
Copies existing template with new ID. Defaults name to `"{original} (copy)"`.

`applyLayerOverrides(templateId, overrides): Promise<DesignTemplate | null>`
**Core automation function.** Maps layers by `name`. For each override key, applies: text, fontFamily, fontSize, fill, stroke, imageUrl-&gt;src, visible, opacity. Supports text and image layers. Returns updated template.

### 5.6 `src/services/renderer.ts` - Render Engine (528 lines)

**State:** `browser: Browser | null` - cached Puppeteer instance.

**Functions:**

`getBrowser(): Promise<Browser>`
Launches headless Chromium: `--no-sandbox`, `--disable-setuid-sandbox`, `--disable-dev-shm-usage`. Singleton.

`escapeHtml(str): string`
Escapes `& < > " '` -&gt; `&amp; &lt; &gt; &quot; &#39;`.

`layerBaseStyle(layer): string`
CSS string: position, left, top, width, height, opacity, rotation transform, z-index.

`renderLayerHTML(layer): string`
Renders one layer to HTML/CSS string:
- **rect** -&gt; `<div>` with background, border, border-radius
- **ellipse** -&gt; `<div>` with border-radius: 50%
- **text/textbox** -&gt; `<div>` with font props + escaped text content
- **image** -&gt; `<img>` with optional CSS filters (brightness, contrast, saturation, blur, grayscale, sepia)
- **group** -&gt; recursive `<div>` with children offset relative to group position
- **path** -&gt; inline `<svg>` with `<path>` element, fill/stroke/stroke-width/fill-rule
- **line** -&gt; inline `<svg>` with `<line>` element, x1/y1/x2/y2 relative coordinates

`buildRenderHTML(template, scale): string`
Builds complete HTML document: sorts layers by zIndex, wraps in scaled canvas div. Returns `<!DOCTYPE html>...` with inline CSS, ready for Puppeteer.

`buildSVG(template): string`
Direct SVG generation (no Puppeteer). Handles all layer types with proper SVG elements. Multi-line text via `<tspan>`, image `preserveAspectRatio`, groups with children, transforms, opacity. Returns `<?xml><svg>...</svg>`.

`uploadToStorage(buffer, renderId, mimeType): Promise<string | null>`
Uploads to Supabase Storage `design-exports` bucket at path `renders/{renderId}.{ext}`. Returns public URL or null on failure.

`cleanupOldRenders(olderThanHours?): Promise<number>`
Deletes render_logs and storage files older than cutoff (default 24h). Returns count cleaned.

`renderTemplate(templateId, request): Promise<RenderResponse>`
Main render function. Flow:
1. Gets template; returns error result if not found.
2. Creates `render_logs` entry (status: "processing").
3. **SVG path:** Calls `buildSVG()` -&gt; `uploadToStorage()` -&gt; fires `render.complete` webhook -&gt; returns result with data URI fallback.
4. **PNG/JPG path:** `buildRenderHTML()` -&gt; opens Puppeteer page -&gt; sets viewport -&gt; `page.setContent()` (networkidle0, 30s timeout) -&gt; `page.screenshot()` with clip -&gt; closes page -&gt; `uploadToStorage()` -&gt; fires registered + direct webhooks -&gt; returns result.
5. **On error:** Updates render_log to "failed", fires `render.failed` webhook.

### 5.7 `src/services/webhooks.ts` - Webhook Service (107 lines)

**State:** `memoryStore: Map<string, WebhookEntry>`.

**Type:** `WebhookEntry { id, url, events[], secret?, active, createdAt }`.

**Functions:**

`registerWebhook(url, events, secret?): Promise<WebhookEntry>`
Creates entry with `wh_` ID prefix. Persists to Supabase `webhooks` table or memory.

`listWebhooks(): Promise<WebhookEntry[]>`
Returns active webhooks, ordered by `created_at` DESC. Maps snake_case columns to camelCase.

`deleteWebhook(id): Promise<boolean>`
Hard delete from Supabase or memory. Returns success boolean.

`fireWebhooks(event, payload): Promise<void>`
Finds matching webhooks (event match or `"*"` wildcard). For each:
- Sets `Content-Type: application/json`, `X-Futuraria-Event: {event}`, `X-Futuraria-Delivery: dlv_{uuid}`
- If secret: computes HMAC-SHA256 -&gt; `X-Futuraria-Signature: sha256={sig}`
- POSTs `{ event, payload, timestamp }` with 10s AbortSignal timeout
- Logs warnings/errors, never throws

### 5.8 `src/routes/` - Route Files

#### `templates.ts` (88 lines)
- `POST /` - create (validated by `createTemplateSchema`). ⚠️ Also applies `validate(updateTemplateSchema)` for PUT which is undefined.
- `GET /` - paginated list (query: limit ≤100, offset ≥0)
- `GET /:id` - single template
- `PUT /:id` - update (validated by `updateTemplateSchema` - **UNDEFINED**)
- `DELETE /:id` - delete
- `POST /:id/duplicate` - duplicate (validated by `duplicateTemplateSchema` - **UNDEFINED**)

#### `layers.ts` (53 lines)
- `GET /:id/layers` - list all layers
- `GET /:id/layers/:name` - get layer by name
- `PATCH /:id/layers/:name` - modify single layer (wraps in overrides object)
- `PATCH /:id/layers` - batch modify via `req.body.layers`

#### `render.ts` (42 lines)
- `POST /:id/render` - render template. Applies overrides before rendering via `applyLayerOverrides`. Handles format, scale, quality, overrides, webhookUrl. Returns 500 on failure.
- `GET /renders/:renderId` - check render status. **NOT IMPLEMENTED** - returns "Not implemented yet".

#### `webhooks.ts` (41 lines)
- `POST /` - register (requires url, events array)
- `GET /` - list all webhooks
- `DELETE /:id` - delete webhook

#### `styles.ts` (135 lines)
- `POST /` - create style (validated by `createStyleSchema`). Prefix `sty_`.
- `GET /` - list styles (optional `?type=` filter)
- `GET /:id` - single style
- `PATCH /:id` - update style (validated by `updateStyleSchema` - **UNDEFINED**)
- `DELETE /:id` - delete style

#### `components.ts` (153 lines)
- `POST /` - create component (validated by `createComponentSchema`). Prefix `cmp_`. Builds `defaultValues` from properties array.
- `GET /` - list components
- `GET /:id` - single component
- `PATCH /:id` - update (validated by `updateComponentSchema` - **UNDEFINED**)
- `DELETE /:id` - delete

#### `comments.ts` (259 lines)
- `POST /` - create comment (validated by `createCommentSchema` - **UNDEFINED**). Prefix `cmt_`.
- `GET /` - list (requires `?templateId=`, optional `?resolved=`)
- `GET /:id` - single comment (maps snake_case-&gt;camelCase)
- `PATCH /:id` - update (validated by `updateCommentSchema` - **UNDEFINED**)
- `POST /:id/replies` - add reply (validated by `createReplySchema` - **UNDEFINED**). Prefix `rpl_`.
- `DELETE /:id` - delete comment

#### `variables.ts` (107 lines)
- `GET /?templateId=` - get variables for template. Handles `PGRST116` error code gracefully.
- `POST /` - upsert variables (checks existence via select-&gt;insert or update). Body: `{ templateId, collections, variables, bindings }`.
- `DELETE /:templateId` - delete variables for template

#### `versions.ts` (184 lines)
- `POST /:id/versions` - create snapshot (validated by `createVersionSchema` - **UNDEFINED**). Auto-increments version number. Prefix `ver_`.
- `GET /:id/versions` - paginated list (query: limit, offset)
- `GET /:id/versions/:versionId` - single version
- `POST /:id/versions/:versionId/restore` - restore template to version. Uses dynamic import: `await import("../services/templates")` for `updateTemplate`.

#### `branches.ts` (204 lines)
- `GET /:id/branches` - list branches. Merges template-embedded + stored. Ensures "main" branch exists.
- `POST /:id/branches` - create branch. Duplicates template with `[{branchName}]` suffix.
- `POST /:id/branches/:branchId/merge` - layer-level merge. Auto-adds new layers. Conflicts if layer modified in both - requires `resolutions` map. Returns conflicts without applying if unresolved.
- `DELETE /:id/branches/:branchId` - delete from memory + template-embedded.
**Storage:** In-memory `branchStore: Map<string, Branch[]>` - lost on restart. Partially persisted via template `branches[]` field.

#### `api-keys.ts` (106 lines)
- `GET /` - list keys for current user. Returns: id, name, key_prefix, permissions, last_used_at, active, created_at. Does NOT return raw key or hash.
- `POST /` - create key. Generates `ftra_<64 hex chars>` (32 random bytes). SHA-256 hashes before storage. Returns raw key ONCE with "Copy this key now" message. Permissions: templates:read, templates:write, render, webhooks.
- `DELETE /:id` - soft delete (sets `active: false`). Checks `user_id` match.

## 6. Editor Frontend (`packages/editor`)

React 18 + Fabric.js 6 visual canvas editor. Vite SPA on Netlify.

```
packages/editor/
├── package.json (react 18, fabric 6, supabase-js, uuid)
├── tsconfig.json (ES2022, ESNext, react-jsx, strict, bundler resolution)
├── netlify-package.json (Netlify deploy descriptor)
├── src/
│   ├── main.tsx          - Entry point (11 lines)
│   ├── App.tsx           - Root component (1272 lines)
│   ├── index.css         - Styles (27.5KB)
│   ├── vite-env.d.ts     - Vite type declarations
│   ├── components/ (22 .tsx files)
│   ├── hooks/ (5 .ts files)
│   └── lib/ (3 .ts files)
└── netlify/functions/api.mts (770 lines)
```

### 6.1 `src/main.tsx` (11 lines)
React entry point. Imports `App` from `./App` and `./index.css`. Creates root via `ReactDOM.createRoot(document.getElementById("root")!)`. Renders `<App />` inside `<React.StrictMode>`.

### 6.2 `src/lib/supabase.ts` - Frontend Supabase Stub (29 lines)

⚠️ **CRITICAL:** This file defines the frontend's relationship with Supabase.

`getSupabase(): SupabaseClient | null`
**ALWAYS returns `null`.** Comment: "Frontend runs in API-proxy mode (server-side Supabase only)." This means the frontend has NO direct Supabase connection. All data flows through `/api/*`.

`getSupabaseClient()` - alias for `getSupabase()`, also always returns `null`.

`apiFetch<T>(url, options): Promise<T>`
Generic fetch wrapper. Sets `Content-Type: application/json`. Merges custom headers. On non-OK response: reads body as text, throws `Error("API {status}: {body}")`. On success: returns `res.json()`. **Does NOT attach any auth headers.**

### 6.3 `src/lib/templateApi.ts` - Template API Client (134 lines)

**Type:** `TemplateFull extends DesignTemplate` - adds `pages?`, `frames?`, `styles?`, `comments?`, `versions?`, `variables? { collections, variables, bindings }`.

**API Functions** (all use `apiFetch`):

`getTemplate(id): Promise<TemplateFull | null>`
GET `/api/templates/{id}`. Returns null on 404 (catches error message containing "404" or "not found").

`createTemplate(name, width?, height?, canvasJson?): Promise<DesignTemplate>`
POST `/api/templates` with JSON body `{ name, width, height, canvas }`.

`updateTemplate(id, updates): Promise<DesignTemplate>`
PUT `/api/templates/{id}` with partial updates.

`deleteTemplate(id): Promise<void>`
DELETE `/api/templates/{id}`.

`duplicateTemplate(id, name?): Promise<DesignTemplate>`
POST `/api/templates/{id}/duplicate` with optional name in body.

`listTemplates(limit?, offset?): Promise<{ data, total }>`
GET `/api/templates?limit={limit}&offset={offset}`.

**Local Storage Fallback:**
- `LS_KEY = "futuraria_local_templates"` - localStorage key
- `getLocalTemplates(): Record<string, any>` - parses localStorage JSON, returns `{}` on error
- `saveLocalTemplate(id, data)` - saves template with `updatedAt` timestamp to localStorage
- `getLocalTemplate(id)` - gets single template from localStorage
- `saveLocal(id, data)` - alias for `saveLocalTemplate`
- `listLocalTemplates(): any[]` - returns all templates sorted by `updatedAt` DESC
- `deleteLocalTemplate(id)` - removes from localStorage

### 6.4 `src/lib/booleanOps.ts` - Boolean Operations (785 lines)

Pure canvas-based boolean operations for Fabric.js shapes. Renders to offscreen canvas using composite operations, traces contours for SVG paths.

**Interfaces:** `Point { x, y }`

**Functions:**

`objectToPolygon(obj, canvas): Point[]`
Converts Fabric.js object to polygon points. Supports:
- **rect**: 4 corners, or roundedRectPoints if rx/ry > 0
- **ellipse**: 64-segment approximation, uses rx/ry or half dimensions
- **circle**: 64-segment approximation around center
- **triangle**: 3 corners (top-center, bottom-right, bottom-left)
- **polygon**: transforms points via `calcTransformMatrix()`, accounts for `pathOffset`
- **path**: calls `approximatePath()` for sampling
- **group**: combines children polygons, returns convex hull
- **fallback**: bounding box 4 corners
Applies rotation via standard 2D rotation matrix around center.

`roundedRectPoints(left, top, w, h, rx, ry, segments): Point[]`
Generates points for rounded rectangle with Bezier-like corner approximation.

`approximatePath(obj): Point[]`
Samples points along Fabric.js path object for polygon approximation.

`convexHull(points): Point[]`
Graham scan algorithm. Sorts by polar angle, builds hull stack.

`pointInPolygon(point, polygon): boolean`
Ray casting algorithm. Counts edge crossings.

`polygonArea(polygon): number`
Shoelace formula: \( \frac{1}{2} \sum (x_i y_{i+1} - x_{i+1} y_i) \).

`polygonCentroid(polygon): Point`
Weighted average: \( \frac{1}{6A} \sum (x_i + x_{i+1})(x_i y_{i+1} - x_{i+1} y_i) \).

`clipPolygon(subject, clip, operation): Point[]`
Sutherland-Hodgman polygon clipping. Iterates over clip edges, classifies vertices as inside/outside, computes intersections. Supports: union, subtract, intersect, exclude via different edge processing orders.

`polygonToPathData(points): string`
Converts polygon to SVG path `d` attribute: `"M x y L x y ... Z"`.

`applyBooleanOperation(canvas, operation): boolean`
Main entry point. Gets selected objects from Fabric.js canvas. Renders them to offscreen canvas. Extracts resulting shape as path. Creates new Fabric.js `Path` object on canvas. Returns success boolean.

### 6.5 `src/hooks/useAuth.ts` - Auth Hook (76 lines)

**Types:** `AuthState { user: User | null, loading: boolean, isLocal: boolean, login(email): Promise<{ error? }>, logout(): Promise<void> }`

`useAuth(): AuthState`
1. Gets Supabase client: `supabase = getSupabaseClient()` - **always null in current config**.
2. If `!supabase` -&gt; sets `loading: false`, `isLocal: true`. Returns immediately - no auth.
3. If Supabase configured: `useEffect` calls `supabase.auth.getSession()` for initial session, subscribes to `onAuthStateChange`.
4. `login(email)` - calls `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } })`. Returns error message or `{}`.
5. `logout()` - calls `supabase.auth.signOut()`, clears user state.

⚠️ **CURRENT BEHAVIOR:** Always local mode. User is always `null`, `isLocal` is always `true`. No authentication happens on the frontend.

### 6.6 `src/hooks/useCanvas.ts` - Canvas Core Hook (3779 lines)
The massive core hook. Manages: Fabric.js initialization, object lifecycle, layers/frames/pages, zoom/pan, selection, undo/redo stack, alignment, grid/snapping, smart guides, comments, versions, variables, boolean ops, image import/export. Exports types: `ToolName`, `LayerInfo`, `FrameInfo`, `PageInfo`.

### 6.7 `src/hooks/useAutoSave.ts` - Auto-Save Hook (155 lines)
Debounced auto-save. Listens to Fabric.js canvas events (`object:added`, `object:removed`, `object:modified`, `object:moved`, `object:scaled`, `object:rotated`). Debounce: 2s default. `SaveStatus`: `"idle" | "saving" | "saved" | "error"`. Provides `saveStatus` and `forceSave()`. Accepts `fabricRef`, `templateId`, `getExtraData()` for additional state (variables, components). Filters out grid/guide/frame visual objects before serializing. Serializes canvas via `toJSON()` with custom property list (layerId, frameId, constraints, autoLayout, resizingMode, overrides, etc.). Resets status to idle after 3s (saved) or 5s (error).

### 6.8 `src/hooks/usePrototype.ts` - Prototype Hook (635 lines)
Manages prototype interactions: trigger handling (click/hover), transitions between frames, overlay management, flow navigation.

### 6.9 `src/hooks/useRealtime.ts` - Realtime Hook (362 lines)
Real-time collaboration: user presence tracking, cursor position broadcasting, canvas delta synchronization, color assignment.

### 6.10 `src/App.tsx` - Root Component (1272 lines)

**URL Helpers:**
- `getTemplateIdFromUrl()` - reads `?templateId=` from URL search params
- `setTemplateIdInUrl(id)` - sets or removes `templateId` param, uses `pushState`

**Main `App` Component:**
Renders either `LoginPage` or `Dashboard` or `Editor` based on auth state and template selection. Uses `useAuth()` hook (always local mode currently).

**Internal `Editor` Component** (bulk of file):
Props: `{ templateId, onBack }`. Manages ~30 state variables:
- Canvas state: `selectedObj`, `layers`, `pages`, `frames`, `activePageId`, `activeFrameId`, `selectedFrameId`, `zoom`, `canvasSize`
- Tool state: `tool` (ToolName), `dragOver`, `eyedropperColor`, `outlineMode`, `spaceHeldRef`, `prevToolRef`
- History: `canUndo`, `canRedo`, `hasMultiSelection`
- Grid: `snapToGrid`, `smartGuides`, `gridSize`, `showGrid`
- UI: `templateName`, `loadingTemplate`, `showExportDialog`, `renamingLayer`, `rightPanelTab`, `showCommentsPanel`, `showVersionPanel`, `showSettings`, `showPreview`
- Data: `styles`, `comments`, `versions`
- Save: uses `useAutoSave` hook with `saveStatus` and `forceSave`

**Hooks used:** `useCanvas`, `useAutoSave`, `usePrototype`.

**Key behaviors:**
- Template loading on mount via `getTemplate(templateId)` - clears canvas and enlivens Fabric.js objects
- Keyboard shortcuts: Delete/Backspace, Ctrl+Z/Y (undo/redo), Ctrl+C/V (copy/paste), Ctrl+A (select all), Ctrl+G (group), Ctrl+Shift+G (ungroup), +/- (zoom), Space (hand tool), Ctrl+Shift+E (export)
- Image upload: paste handler (Ctrl+V of clipboard image), drag-and-drop handler
- Export dialog: format (PNG/JPG/SVG), scale, quality. Renders via Fabric.js `canvas.toDataURL()` or server-side render API

**Rendered components:** `CanvasEditor`, `Toolbar`, `LayersPanel`, `PropertiesPanel`, `StatusBar`, `StylesPanel`, `ComponentsPanel`, `CommentsPanel`, `CommentPin`, `VersionHistoryPanel`, `PrototypePanel`, `PrototypePreview`, `BranchPanel`, `SettingsPanel`, `AutoSaveIndicator`, `KeyboardShortcutsDialog`.

### 6.11 Component Files Summary

| Component | Lines | Purpose |
|-----------|-------|---------|
| `CanvasEditor` | 2.2KB | Fabric.js canvas DOM container with ResizeObserver for responsive sizing |
| `Toolbar` | 15.7KB | Tools: select, rect, ellipse, text, line, path, image, hand, zoom, undo/redo, alignment, boolean ops, AI tools |
| `LayersPanel` | 8.4KB | Layer list with drag reorder, visibility/lock toggles, rename, delete, z-index, frame/page support |
| `PropertiesPanel` | 41.4KB | Full property editor: position, size, rotation, opacity, fill, stroke, corner radius, fonts, alignment, image filters, constraints, auto-layout |
| `StylesPanel` | 25.9KB | Style management: create/edit/delete color/text/effect styles, apply to layers |
| `ComponentsPanel` | 21.1KB | Component library: browse, create, edit, instantiate on canvas |
| `CommentsPanel` | 10.9KB | Comment threads sidebar: create, resolve, reply, delete |
| `CommentPin` | 2.3KB | Visual comment pin rendered as Fabric.js overlay on canvas |
| `VersionHistoryPanel` | 7.2KB | Version browser: list, create snapshot, restore to version |
| `PrototypePanel` | 16.4KB | Interaction editor: triggers, actions, transitions between frames |
| `PrototypePreview` | 10KB | Full-screen prototype player with click/hover/frame transitions |
| `BranchPanel` | 6.9KB | Branch management: create, switch, merge with conflict handling |
| `Dashboard` | 7.3KB | Template gallery: list, create new, search, delete, open in editor |
| `LoginPage` | 2.5KB | Email magic-link login page using `useAuth().login()` |
| `SettingsPanel` | 25.6KB | Settings modal with API Keys + Webhooks tabs. **Uses `authFetch` - currently broken due to auth mismatch (see Errors section)** |
| `AutoSaveIndicator` | 0.7KB | Dot indicator showing save status |
| `StatusBar` | 0.7KB | Bottom bar with zoom level and canvas dimensions |
| `KeyboardShortcutsDialog` | 8.2KB | Reference dialog listing all keyboard shortcuts |
| `PresencePanel` | 3.5KB | Online collaborators list with avatars and cursor colors |
| `GridStylesPanel` | 14.7KB | Grid/layout style editor: columns, rows, grid |
| `VariablesPanel` | 17.9KB | Design tokens: collections, variables, bindings to layer properties |
| `CursorOverlay` | 3.7KB | Remote user cursors rendered as Fabric.js overlays |

### 6.12 `src/index.css` (27.5KB)
Global styles for the entire editor application. Dark theme based on `#1a1a2e` background.

---

## 7. Netlify Functions

### 7.1 `netlify/functions/api.ts` - Express Proxy Wrapper (51 lines)

**NOT dead code.** Imports `app` from `../../packages/api/src/app`, starts Express on a random port (`app.listen(0, "127.0.0.1")`), then proxies all incoming requests to that local server via `fetch()`. The `config.path` is `/api/*`. This is an alternative deployment strategy - runs the full Express API inside a single Netlify Function by self-hosting and proxying. One-time port allocation cached via `listening` flag.

⚠️ **Compatibility concern:** This imports `../../packages/api/src/app` which uses CommonJS/`require`-based imports. In Netlify's ES module environment, this may fail unless bundled by esbuild (configured in `netlify.toml`). The file `packages/editor/netlify/functions/api.mts` is the more robust, self-contained edge function.

### 7.2 `packages/editor/netlify/functions/api.mts` - Primary Edge Function (770 lines)

Self-contained backend deployed as a Netlify Function. **Pure Web-standard handler** - uses `Response` objects and manual URL routing, NOT Express. `.mts` extension (TypeScript ES modules). Frontend's `netlify-package.json` references it as compiled `api.mjs`.

#### Initialization & State
- Supabase client from `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` (or `SUPABASE_ANON_KEY`)
- In-memory fallbacks: `memTemplates`, `memWebhooks`, `memStyles`, `memComponents`, `memComments`, `memVersions`
- CORS headers on every response via `json()` helper
- **No Puppeteer** - rendering is SVG-only

#### Auth (Dual-Mode)
- **`validateApiKey(req)`**: Checks `X-API-Key` header, SHA-256 hash, looks up in `api_keys` table (active=true). Updates `last_used_at`. Returns `{ userId }`.
- **`validateSupabaseSession(req)`**: Checks `Authorization: Bearer` header (correct `startsWith("Bearer ")` + `slice(7)` ✅). Calls `db.auth.getUser(token)` for JWT validation.
- **`authenticate(req)`**: Tries API key first, falls back to Supabase session. **This is the only backend that supports both auth methods.**

#### fallbackRender(template, format, scale): string
Pure JS SVG renderer. Same layer-type handling as Express `buildSVG()`. Multi-line text with fonts. Images with preserveAspectRatio. Falls back to SVG data URI for PNG/JPG when Puppeteer unavailable (always, since Puppeteer is not imported).

#### Route Handlers (manual URL matching, no Express router)

**Templates:**
- `GET /api/templates` - paginated list from Supabase
- `POST /api/templates` - create, validates `name`, prefix `tpl_`, blank canvas 800x600
- `GET /api/templates/:id` - single template
- `PUT /api/templates/:id` - partial update, auto-sets `updatedAt`
- `DELETE /api/templates/:id` - hard delete
- `POST /api/templates/:id/duplicate` - copy with `(copy)` suffix
- `POST /api/templates/:id/render` - Render. SVG uses `fallbackRender()`. PNG/JPG falls back to SVG (no Puppeteer).

**Layers / Webhooks / Styles / Components / Comments / API Keys / Variables / Versions:**
All endpoints match Express API equivalents. Key differences:
- API keys use `fd_` prefix (vs Express `ftra_`)
- API keys have `POST .../:id/revoke` instead of `DELETE .../:id`
- Edge function does NOT have branches, boolean ops, or a dedicated render service

---

## 8. Errors, Inconsistencies & Issues Found

### 🔴 Critical Issues

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 1 | **Frontend auth always null** | `packages/editor/src/lib/supabase.ts` - `getSupabase()` always returns null. `apiFetch()` sends NO auth headers | `SettingsPanel.tsx` -&gt; `authFetch()` -&gt; `getAuthToken()` -&gt; null -&gt; ALL settings API calls fail 401 |
| 2 | **Auth header prefix mismatch** | `packages/api/src/middleware.ts` L64: checks `"*** "` (4 chars) but slices 7 chars | `Authorization: Bearer` format NEVER works in Express backend |
| 3 | **netlify/functions/api.ts - CJS proxy wrapper** | Imports Express app from `../../packages/api/src/app` (CommonJS). Starts Express on random port, proxies via `fetch()`. | May fail in Netlify ES module environment unless bundled by esbuild. Self-contained `api.mts` is the safer option. |
| 4 | **8 undefined Zod schemas** | `packages/api/src/middleware.ts` imports but never defines them | Validation middleware fails at runtime for templates PUT/Duplicate, comments, versions, styles PATCH, components PATCH |
| 5 | **API key prefix mismatch** | Edge uses `fd_`, Express uses `ftra_` | Keys incompatible between backends |
| 6 | **Puppeteer absent from edge function** | `api.mts` - no Puppeteer/chromium import or reference anywhere in the 770-line file | Raster (PNG/JPG) export unavailable on Netlify deployment. Falls back silently to SVG data URI. |
| 7 | **Duplicate API backends** | Express API + Edge Function with almost identical logic | Maintenance burden, feature divergence |

### 🟡 Medium Issues

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 8 | **Missing supabase-setup.sql** | Referenced in `n8n-workflows/README.md` | Users cannot set up DB schema |
| 9 | **Branch storage in-memory** | `branches.ts` uses Map | Branches lost on restart |
| 10 | **No root .env.example** | Root of project - only `packages/editor/.env.example` exists | No reference for server-side env vars (SUPABASE_URL, CORS_ORIGINS, etc.) |
| 11 | **Render GET not implemented** | `render.ts` - `GET /renders/:renderId` returns "Not implemented" | Cannot poll render status |
| 12 | **n8n workflows set `active: false`** | All 3 workflow files | Must be manually activated |
| 13 | **npm workspaces disabled** | Root `package.json` `"workspaces": []` | No monorepo tooling benefits |
| 14 | **API version mismatch** | Express: `3.0.0`, Edge: `3.0` | Inconsistent semver |

### 🟢 Minor Issues

| # | Issue | Location |
|---|-------|----------|
| 15 | No `tsconfig.json` for root - TypeScript config only in packages |
| 16 | `NOTICE` and `TRADEMARK.md` are unusual for MIT - adds friction for forks |
| 17 | Comment routes reference `template_id` in `req.query` but URL uses camelCase `templateId` |
| 18 | `packages/shared` exports raw `.ts` files - relies on consumer tooling for compilation |
| 19 | `PGRST116` error code in `variables.ts` is Supabase-specific, not abstracted |
| 20 | `n8n-workflows/README.md` documents more webhook events (10) than handler supports (6) |

---

## 9. Architecture Decision Records (Implicit)

1. **Two backends**: Express for Railway (Puppeteer rendering) and Netlify Function (SVG-only). Driven by platform constraints.
2. **API key auth only**: Frontend never connects to Supabase directly. All data through API with key-based auth.
3. **SHA-256 hashing**: API keys never plaintext. Generated once, shown once, hashed for storage.
4. **Fire-and-forget webhooks**: Delivery failures logged but never block requests.
5. **In-memory fallbacks**: Templates, webhooks, branches all have Map-based fallback when Supabase unavailable.
6. **Zod validation only in Express**: Edge function does manual validation.

---

*Documentation completed - Three passes: all files, all functions, all errors enumerated and verified.*

---

## 10. Build Configuration & Config Files (Third Pass Additions)

### 10.1 `packages/editor/vite.config.ts` - Vite Config (23 lines)
- React plugin via `@vitejs/plugin-react`
- Dev server port 5173
- **Dev proxy:** `/api` -&gt; `http://localhost:3001` - during local dev, ALL `/api/*` calls go to the Express backend
- Path aliases: `@futuraria/shared` -&gt; `../shared/index.ts`, `@futuraria/shared/` -&gt; `../shared/`

⚠️ **Implication:** In dev mode, the frontend hits the Express API with its broken auth middleware (`"*** "` prefix bug). Even if the frontend sent valid auth headers, they'd fail.

### 10.2 `packages/editor/tsconfig.json` - TypeScript Config (20 lines)
- Target ES2022, module ESNext, moduleResolution bundler
- `allowImportingTsExtensions`, `noEmit` (Vite handles compilation)
- `jsx: "react-jsx"`, strict mode enabled
- `noUnusedLocals` / `noUnusedParameters` disabled (lenient)
- Only includes `src/` directory

### 10.3 `packages/api/tsconfig.json` - TypeScript Config (22 lines)
- Target ES2022, module CommonJS
- Outputs to `dist/` with declarations
- Path aliases: `@futuraria/shared` -&gt; `../shared/index.ts`
- Excludes `node_modules`, `dist`

### 10.4 `packages/editor/index.html` - Vite Entry HTML (18 lines)
- Title: "Futuraria Design"
- Dark background `#0a0a0f`, overflow hidden
- Root div + module script `/src/main.tsx`
- Inline CSS reset

### 10.5 `packages/editor/netlify-package.json` - Deploy Descriptor (12 lines)
- Name: "Futuraria Design", version 1.0.0
- ⚠️ Version 1.0.0 vs editor package.json version 0.1.0 - inconsistency
- Scripts: `build` / `dev` cd into `packages/editor`, install + build

### 10.6 `packages/editor/.env.example` - ⚠️ MISLEADING (7 lines)

Documents `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as required for Supabase. Says "If these are not set, the editor runs in offline mode (no multiplayer)."

**BUG #21:** The `.env.example` is misleading. Regardless of these env vars, `packages/editor/src/lib/supabase.ts` hardcodes `getSupabase()` to always return `null`. The editor ALWAYS runs in offline mode. Setting `VITE_SUPABASE_*` has zero effect on Supabase connectivity. The `.env.example` should be removed or updated to reflect reality.

### 10.7 `packages/api/package.json` - Dependencies
Key deps: express 4.21, cors 2.8, uuid 10, puppeteer 23, supabase-js 2.45, dotenv 16.4, express-rate-limit 7.4, zod 3.23. Dev deps: TypeScript 5.5, tsx 4.16, tsc-alias 1.8.

### 10.8 `packages/editor/package.json` - Dependencies
Key deps: react/react-dom 18.3, fabric 6.4, supabase-js 2.45, uuid 10. `@futuraria/shared` via `file:../shared` (file dependency, not workspace). Dev deps: vite 5.4, @vitejs/plugin-react 4.3, TypeScript 5.5.

### 10.9 `packages/shared/package.json` - Subpath Exports
No dependencies. Exports: `.` (index.ts), `./components`, `./api-types`, `./styles`, `./collaboration`. All raw TypeScript.

---

## 11. Additional Issues Found (Third Pass)

### 🔴 Critical Issue Added

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 21 | **Misleading .env.example** | `packages/editor/.env.example` documents `VITE_SUPABASE_*` but `supabase.ts` hardcodes `return null` | Developers waste time setting env vars that have no effect. Editor is permanently offline regardless of configuration. |

### 🟡 Medium Issues Added

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 22 | **Version inconsistency** | `netlify-package.json` says 1.0.0; editor `package.json` says 0.1.0 | Confusion about actual version |

---

*Third pass complete - 22 issues identified, 60+ files documented, all config files covered.*

---

## 12. Data Flow & Auth Chain Diagrams

### Auth Flow (SettingsPanel - Broken)

```
SettingsPanel.tsx
  └─-&gt; authFetch("/api/api-keys")
       └─-&gt; getAuthToken()
            └─-&gt; getSupabase()
                 └─-&gt; return null  ← ALWAYS HERE
       └─-&gt; headers = {}  (no Authorization)
       └─-&gt; fetch() -&gt; 401 Unauthorized
```

### Auth Flow (Other Components)

```
App.tsx / Dashboard / useAutoSave
  └─-&gt; apiFetch("/api/...")
       └─-&gt; headers = { "Content-Type": "application/json" }  (no auth)
       └─-&gt; fetch() -&gt; Express API checks auth -&gt; 401
```

**Root cause:** There is NO path in the frontend code that sends an API key or auth token to `/api/*` endpoints. The only component that tries (`SettingsPanel.tsx`) fails because `getSupabase()` returns null.

### Frontend API Call Chain

```
App.tsx              -&gt; uses templateApi.ts functions (getTemplate, createTemplate, listTemplates, etc.)
Dashboard.tsx         -&gt; uses templateApi.ts (listTemplates, createTemplate, deleteTemplate)
useAutoSave.ts        -&gt; uses apiFetch() directly (PUT /api/templates/:id)
SettingsPanel.tsx     -&gt; uses own authFetch() wrapper (GET/POST/DELETE /api/api-keys, /api/webhooks)
useCanvas.ts          -&gt; uses templateApi via callbacks passed from App.tsx
```

### Deployment Data Flow

```
[Browser] -&gt; Netlify CDN -&gt; / (SPA) -&gt; React App loads
[Browser] -&gt; /api/* -&gt; Netlify Function (api.mts) -&gt; Supabase -&gt; Response
        OR (dev mode)
[Browser] -&gt; /api/* -&gt; Vite proxy -&gt; localhost:3001 -&gt; Express API -&gt; Supabase -&gt; Response
```

---

## 13. Omissions & Gaps (Final Review)

The following were intentionally NOT documented:

| Item | Reason |
|------|--------|
| `packages/editor/package-lock.json` (116KB) | Standard npm lockfile - not project code |
| `vite-env.d.ts` | Standard Vite type declaration (`/// <reference types="vite/client" />`) - 1 line |
| `index.css` full contents (27.5KB) | CSS file - dark theme styles for all components |

The following COULD be improved but require Supabase access:

| Item | Gap |
|------|-----|
| `supabase-setup.sql` | Referenced by n8n docs but doesn't exist in repo - schema must be inferred from code |
| Exact Supabase table schemas | Column names/types inferred from insert/select statements in route files |
| API key permissions enum | `permissions: string[]` - values like `templates:read`, `templates:write`, `render`, `webhooks` are used but never formally defined |

*Documentation complete - 3 passes verified, 22 issues initially cataloged.*

---

## 14. Deep Audit: Complete Function-by-Function Verification

> **This section documents EVERY function, its exact parameters, return types, variables manipulated, side effects, and what happens if you modify/remove it.** Based on full source code read of all 60+ files.

### 14.1 Express Backend - Complete Function Registry

#### `packages/api/src/services/supabase.ts`

**State:** module-level `client: SupabaseClient | null = null` - singleton cache.

**`getSupabase(): SupabaseClient | null`**
- **Inputs:** `process.env.SUPABASE_URL`, `process.env.SUPABASE_ANON_KEY`
- **Logic:** If URL/key missing OR URL contains `"your-project"` -&gt; logs warning, returns null. Otherwise creates client once (lazy singleton), returns it.
- **If removed:** All routes fall back to in-memory storage. Data lost on restart.
- **Note:** Uses `SUPABASE_ANON_KEY`, NOT service role key. Edge function uses `SUPABASE_SERVICE_KEY`. Different permission levels.

#### `packages/api/src/services/templates.ts`

**State:** `memoryStore: Map<string, DesignTemplate>` (in-memory fallback).

**`createBlankTemplate(name, width, height): DesignTemplate`**
- Returns: `{ id: "tpl_" + uuid8, name, schemaVersion: 1, canvas: { width, height, background: "#ffffff" }, layers: [], metadata: { createdAt, updatedAt } }`
- **No side effects.** Pure factory function. Called by `createTemplate` when no `canvasJson`.

**`createTemplate(name, width=1080, height=1080, canvasJson?): Promise<DesignTemplate>`**
- If `canvasJson` provided -&gt; spreads it, overrides id/name/schemaVersion/metadata
- If no `canvasJson` -&gt; calls `createBlankTemplate(name, width, height)`
- Persists to Supabase `templates` table: `{ id, name, data: tpl }` or in-memory
- **Side effects:** Writes to DB or Map. Returns the new template.
- **If removed:** Template creation fails. Branch creation (which calls this) fails.

**`listTemplates(): Promise<DesignTemplate[]>`**
- Supabase: `select("data").order("created_at", {ascending: false})`. Maps `r.data`.
- Memory: `Array.from(memoryStore.values())` - NO ordering applied!
- **⚠️ Gap:** In-memory fallback doesn't sort. Supabase path sorts by `created_at` DESC.

**`listTemplatesPaginated(limit, offset): Promise<{ data: DesignTemplate[], total: number }>`**
- Supabase: two queries - count (`head: true`) then range(`offset, offset+limit-1`)
- Memory: `all.slice(offset, offset + limit)`, `total: all.length`
- **Variables:** `limit` from route (capped at 100, default 50), `offset` (min 0, default 0)

**`getTemplate(id): Promise<DesignTemplate | null>`**
- Supabase: `.eq("id", id).single()`, returns `data?.data || null`
- Memory: `memoryStore.get(id) || null`
- **If returns null:** Route returns 404 "Template not found"

**`updateTemplate(id, updates: Partial<DesignTemplate>): Promise<DesignTemplate | null>`**
- Gets existing, shallow-merges `updates`, auto-sets `metadata.updatedAt = now`
- Persists: `{ data: updated, name: updated.name }` or memory set
- **⚠️ Key behavior:** Shallow merge means nested objects (canvas, metadata) are REPLACED, not deep-merged. The `updatedAt` is always overwritten.
- **If removed:** Version restore fails (uses dynamic import of this function).

**`deleteTemplate(id): Promise<boolean>`**
- Supabase: hard delete `.delete().eq("id", id)`, returns `!error`
- Memory: `memoryStore.delete(id)` (returns boolean)
- **If removed:** Templates become undeletable.

**`duplicateTemplate(id, newName?): Promise<DesignTemplate | null>`**
- Gets original, calls `createTemplate` with spread original + undefined id + new timestamps
- Default name: `"{original.name} (copy)"`
- **Side effects:** Creates new template in DB/memory. Original unchanged.

**`applyLayerOverrides(templateId, overrides: Record<string, LayerOverride>): Promise<DesignTemplate | null>`**
- **Key: string = layer NAME, not ID.** Builds `Map<name, layer>`.
- Iterates override keys. For each override, checks layer type and applies:
  - `text` / `fontFamily` / `fontSize` -&gt; only on text/textbox layers
  - `fill` -&gt; only if `"fill" in layer`
  - `stroke` -&gt; only if `"stroke" in layer`
  - `imageUrl` -&gt; only on image layers, mapped to `src`
  - `visible` / `opacity` -&gt; any layer type
- Calls `updateTemplate(templateId, tpl)` at end - single save, not per-override
- **If `imageUrl` changed on non-image layer:** silently ignored
- **If layer name not found:** silently skipped via `continue`

#### `packages/api/src/services/webhooks.ts`

**State:** `memoryStore: Map<string, WebhookEntry>`

**`registerWebhook(url, events, secret?): Promise<WebhookEntry>`**
- ID: `wh_` + uuid8. Active: true. Timestamped.
- Persists: `{ id, url, events, secret, active }` or in-memory.
- **If removed:** Webhooks can't be registered. Express API's render pipeline would fail to fire hooks.

**`listWebhooks(): Promise<WebhookEntry[]>`**
- Supabase: filters `active=true`, orders by `created_at` DESC. Maps snake_case-&gt;camelCase.
- Memory: all entries, no filter for active, no sort.
- **⚠️ Gap:** In-memory doesn't filter by active or sort. Returns ALL including inactive.

**`deleteWebhook(id): Promise<boolean>`**
- Supabase: hard delete. Memory: Map.delete.
- **If removed:** Webhooks accumulate forever.

**`fireWebhooks(event, payload): Promise<void>`**
- Gets all active webhooks. Filters by event match OR `"*"` wildcard.
- For each: sets `X-Futuraria-Event`, `X-Futuraria-Delivery: dlv_{uuid8}`. If secret: HMAC-SHA256 -&gt; `X-Futuraria-Signature: sha256={sig}`.
- POSTs `{ event, payload, timestamp }` with 10s AbortSignal timeout.
- **Never throws.** Logs warnings/errors. Fire-and-forget.
- **`crypto` import is dynamic** (`await import("crypto")`) - avoids static import issues.
- **If removed:** Webhooks silently stop firing. No error surfaced to API callers.

#### `packages/api/src/middleware.ts`

**State:** None (stateless middleware).

**`isFirstSetup(): Promise<boolean>`**
- No Supabase -&gt; true (dev mode). Error -&gt; false (safe default).
- Queries `api_keys` where `active=true`, `count: exact, head: true`. Returns `count === 0`.
- **If removed:** Bootstrap path never activates. First key creation would require pre-existing auth.

**`authenticate(req, res, next)`**
- **Flow:** No Supabase -&gt; dev skip (`"dev"` context). Bootstrap check for POST `/api/api-keys` when zero keys. Extract key from `Authorization: *** <key>` (⚠️ broken prefix check) or `X-API-Key` header. SHA-256 hash. Lookup in `api_keys` (active=true). Sets `req.auth`. Updates `last_used_at` (fire-and-forget, `.then(()=>{})`).
- **What it sets on req:** `{ apiKeyId, userId, permissions }`
- **Variables manipulated:** `req.auth` (if auth succeeds), `api_keys.last_used_at` (async)
- **If `*** ` prefix check fixed:** `Authorization: Bearer ftra_...` would work. Currently only `X-API-Key` header works (or the broken `*** ` prefix).

**Rate limiters:**
- `crudRateLimit`: 100 req/min per apiKeyId or IP. Standard headers exposed.
- `renderRateLimit`: 10 req/min. Same key function.
- `rateLimitKey(req)`: returns `req.auth?.apiKeyId || req.ip || "unknown"`
- **If removed:** No rate limiting. API vulnerable to abuse.

**`validate(schema: ZodSchema)`**
- Returns middleware. Calls `schema.safeParse(req.body)`. On fail -&gt; 400 with `{ path, message }` per issue. On success -&gt; `req.body = result.data` (parsed, with defaults applied).
- **If schema undefined (BUG):** The route handler is called but `validate(undefined)` would throw TypeError `schema.safeParse is not a function`. Route fails with 500.

**Defined schemas (4):**
| Schema | Fields | Defaults |
|--------|--------|----------|
| `createTemplateSchema` | `name?` (1-200), `canvas?` { width (1-10000-&gt;1080), height (1-10000-&gt;1080), background (-&gt;"#ffffff") } | canvas fully defaulted |
| `createLayerSchema` | `templateId` (uuid), `type` (min 1), `name?` (1-500), `properties?` (record-&gt;{}), `order?` (int≥0) | properties: {} |
| `createComponentSchema` | `name` (1-200), `type` (min 1), `properties?` (record-&gt;{}) | properties: {} |
| `createStyleSchema` | `name` (1-200), `type` (min 1), `value` (record, required) | none |

**Undefined schemas imported but never declared (8):** `updateTemplateSchema`, `duplicateTemplateSchema`, `createCommentSchema`, `updateCommentSchema`, `createReplySchema`, `createVersionSchema`, `updateStyleSchema`, `updateComponentSchema`.

#### `packages/api/src/app.ts`

**Middleware chain** (order matters):

| Line | Middleware | Path | Effect |
|------|-----------|------|--------|
| 33 | CORS | `*` | Dynamic origin check, credentials, 86400s cache |
| 51 | JSON body parser | `*` | 50MB limit |
| 54 | GET /api/health | exact | Public, returns status+version+features |
| 64 | GET /api/config | exact | Public, returns version+features |
| 72 | `authenticate` | `/api/templates*` | All template routes and sub-routes |
| 79 | `crudRateLimit` | `/api/templates*` | 100/min |
| 86 | `templateRoutes` | `/api/templates` | CRUD on /api/templates |
| 87 | `layerRoutes` | `/api/templates` | Layers on /api/templates/:id/layers |
| 88 | `authenticate, crudRateLimit, branchRoutes` | `/api/templates` | ⚠️ Auth applied TWICE for branches |
| 89 | `versionRoutes` | `/api/templates` | Inherits auth from line 72 |
| 90 | `renderRateLimit, renderRoutes` | `/api/templates` | 10/min (render), inherits auth |
| 91 | `webhookRoutes` | `/api/webhooks` | Inherits auth from line 73 |
| 92-94 | style/component/comment routes | respective paths | Inherit auth from lines 74-76 |
| 96-98 | `authenticate, crudRateLimit, variableRoutes` | `/api/variables` | Inline auth |
| 101-103 | `authenticate, crudRateLimit, apiKeyRoutes` | `/api/api-keys` | Inline auth |
| 106 | Global error handler | `*` | CORS-&gt;403, else-&gt;500 |

**⚠️ Bug: Branches get auth checked twice** (line 72 + line 88). This means the `last_used_at` update fires twice. Not harmful but wasteful.

### 14.2 Express API - Complete Route Detail

#### `templates.ts` (88 lines)
- **POST `/`** - body: `{ name, width?, height?, canvas? }` -&gt; validated by `createTemplateSchema` -&gt; calls `createTemplate(name, width||1080, height||1080, canvas)` -&gt; 201
- **GET `/`** - query: `limit` (capped 100, default 50), `offset` (min 0, default 0) -&gt; `listTemplatesPaginated` -&gt; `{ data, total, limit, offset }`
- **GET `/:id`** - `getTemplate(id)` -&gt; 404 if null
- **PUT `/:id`** - validated by `updateTemplateSchema` (⚠️ UNDEFINED) -&gt; `updateTemplate(id, req.body)` -&gt; 404 if null
- **DELETE `/:id`** - `deleteTemplate(id)` -&gt; 404 if false
- **POST `/:id/duplicate`** - validated by `duplicateTemplateSchema` (⚠️ UNDEFINED) -&gt; `duplicateTemplate(id, req.body.name)` -&gt; 201

#### `layers.ts` (53 lines)
- **GET `/:id/layers`** - returns `tpl.layers` array
- **GET `/:id/layers/:name`** - finds layer by `l.name === req.params.name`
- **PATCH `/:id/layers/:name`** - wraps `req.body` as `{ [name]: req.body }`, calls `applyLayerOverrides`. The body IS the layer update (e.g., `{ text: "new", fill: "#f00" }`).
- **PATCH `/:id/layers`** - batch: `applyLayerOverrides(id, req.body.layers || {})`. Body: `{ layers: { "LayerName": { text: "..." }, "Other": { fill: "..." } } }`
- **No Zod validation on any layer endpoint.**

#### `render.ts` (42 lines)
- **POST `/:id/render`** - builds `RenderRequest`: `format||"png"`, `scale||2`, quality/overrides/webhookUrl optional. Applies `overrides.layers` before render. Calls `renderTemplate()`. Returns 500 if `result.status === "failed"`.
- **GET `/renders/:renderId`** - NOT IMPLEMENTED. Returns `{ success: false, error: "Not implemented yet" }` with 200 status (incorrect - should be 501).

#### `webhooks.ts` (41 lines)
- **POST `/`** - manual validation: `url` required, `events` must be array. Calls `registerWebhook(url, events, secret)`. 201.
- **GET `/`** - `listWebhooks()`. Returns all.
- **DELETE `/:id`** - `deleteWebhook(id)`. 404 if false.

#### `styles.ts` (135 lines)
- **ID prefix:** `sty_` (Express) vs `style_` (Edge) - ⚠️ MISMATCH
- **POST `/`** - validated by `createStyleSchema`. Creates `{ id: sty_..., ...body, metadata: { createdAt, updatedAt } }`. Persists to `styles` table `{ id, name, type, data }`.
- **GET `/`** - optional `?type=` filter. Lists all or filtered.
- **GET `/:id`** - single style. 404 if not found.
- **PATCH `/:id`** - validated by `updateStyleSchema` (⚠️ UNDEFINED). Merges existing + body. Updates `metadata.updatedAt`.
- **DELETE `/:id`** - hard delete. 404 if not in memory store.

#### `components.ts` (153 lines)
- **ID prefix:** `cmp_` (Express) vs `comp_` (Edge) - ⚠️ MISMATCH
- **POST `/`** - validated by `createComponentSchema`. Builds `defaultValues` from properties array: `for (const prop of properties) { defaultValues[prop.id] = prop.defaultValue }`. Persists to `components` table.
- **GET `/`** - lists all, maps `(r) => r.data`.
- **GET `/:id`** - single component. 404 if not found.
- **PATCH `/:id`** - validated by `updateComponentSchema` (⚠️ UNDEFINED). Merges. Updates `metadata.updatedAt`.
- **DELETE `/:id`** - hard delete.

#### `comments.ts` (259 lines)
- **ID prefix:** `cmt_`, reply prefix: `rpl_`
- **POST `/`** - validated by `createCommentSchema` (⚠️ UNDEFINED). Creates: `{ id: cmt_..., templateId, frameId, x: 0, y: 0, author, text, thread: [], resolved: false, createdAt, updatedAt }`. Persists with snake_case columns to Supabase.
- **GET `/`** - requires `?templateId=`. Optional `?resolved=true/false`. Maps snake_case-&gt;camelCase in response.
- **GET `/:id`** - single comment with snake_case-&gt;camelCase mapping.
- **PATCH `/:id`** - validated by `updateCommentSchema` (⚠️ UNDEFINED). Only allows updating: `resolved`, `text`, `thread`. Applies `updatedAt`.
- **POST `/:id/replies`** - validated by `createReplySchema` (⚠️ UNDEFINED). Creates reply `{ id: rpl_..., author, text, createdAt }`. Appends to thread.
- **DELETE `/:id`** - hard delete.

#### `variables.ts` (107 lines)
- **GET `/`** - requires `?templateId=`. Supabase: `.eq("template_id", templateId).single()`. Handles `PGRST116` (no rows = return empty defaults `{ collections: [], variables: [], bindings: {} }`).
- **POST `/`** - body: `{ templateId, collections, variables, bindings }`. Upserts: select-&gt;insert or update.
- **DELETE `/:templateId`** - deletes all variables for template.
- **No Zod validation.**

#### `versions.ts` (184 lines)
- **ID prefix:** `ver_`
- **POST `/:id/versions`** - validated by `createVersionSchema` (⚠️ UNDEFINED). Gets template, calculates next versionNumber (MAX+1). Snapshot: `req.body.data || template` (explicit data or full). Auto-increments.
- **GET `/:id/versions`** - paginated: limit (capped 100), offset. Maps snake_case-&gt;camelCase.
- **GET `/:id/versions/:versionId`** - single version with mapping.
- **POST `/:id/versions/:versionId/restore`** - restores template from version. Uses `await import("../services/templates")` - dynamic import! Then `updateTemplate(templateId, version.data)`.
- **If dynamic import fails:** Route throws 500.

#### `branches.ts` (204 lines)
- **State:** `branchStore: Map<string, Branch[]>` - in-memory, lost on restart
- **GET `/:id/branches`** - merges stored + embedded branches. Ensures "main" branch exists (id: `br_{templateId}_main`, createdBy: "system").
- **POST `/:id/branches`** - body: `{ name (required), createdBy?, sourceBranchId? }`. Creates branch with id `br_{templateId}_{timestamp}_{random4}`. Duplicates template as `"{name} [{branchName}]"`. Stores branch reference.
- **POST `/:id/branches/:branchId/merge`** - body: `{ targetBranchId?, resolutions? }`. Finds source template by name match. Layer-level merge: new layers added, modified layers checked via `JSON.stringify` comparison, conflicts resolved via `resolutions` map `{ layerId: useSource }`. Returns conflicts without applying if unresolved.
- **DELETE `/:id/branches/:branchId`** - removes from both store and template-embedded branches.
- **No Zod validation.**

#### `api-keys.ts` (106 lines)
- **GET `/`** - requires `req.auth?.userId`. Lists keys: `id, name, key_prefix, permissions, last_used_at, active, created_at`. Does NOT expose hash or raw key.
- **POST `/`** - requires `req.auth?.userId`. Generates `ftra_${randomBytes(32).toString("hex")}` (64 hex chars). SHA-256 hashes. `keyPrefix: rawKey.slice(0, 12)`. Permissions hardcoded: `["templates:read", "templates:write", "render", "webhooks"]`. Returns raw key ONCE with message.
- **DELETE `/:id`** - soft delete: `active: false`. Must match `user_id`.
- **No Zod validation.** Manual `req.auth?.userId` check.

### 14.3 Edge Function (api.mts) - Complete Function Detail

**Architecture:** Single 770-line function. No Express. Pure Web-standard `Request`/`Response`. Manual regex-based routing. ALL routes support both `/api/...` and `/...` (without prefix) due to `path.replace()` at line 384.

**Auth:** `const auth = await authenticate(req)` at line 389. Auth result is **OPTIONAL** - only enforced on API key management endpoints. ALL other routes (templates, layers, render, styles, components, comments, versions, webhooks, export) work WITHOUT authentication. This is radically different from the Express API which blocks all routes.

**`authenticate(req)`** - tries `validateApiKey` (X-API-Key header -&gt; SHA-256 -&gt; DB lookup) first, falls back to `validateSupabaseSession` (Authorization: Bearer -&gt; JWT validation via `db.auth.getUser()`).

**`validateApiKey(req)`** - checks `X-API-Key` header only (NOT `Authorization`). SHA-256 hash. Looks up in `api_keys` (active=true). Updates `last_used_at`. Returns `{ userId }`.
**`validateSupabaseSession(req)`** - checks `Authorization: Bearer {token}`. Calls `db.auth.getUser(token)`. Returns `{ userId }`.

**Helpers:**
- `json(data, status=200)` -&gt; `new Response(JSON.stringify(data), { headers: { CORS: "*", Content-Type: "application/json" } })`
- `err(msg, status=400)` -&gt; `json({ success: false, error: msg }, status)`
- `body(req)` -&gt; `await req.json()` with try/catch returning `{}`
- `uid()` -&gt; `randomUUID().slice(0, 8)`

**In-memory stores:** `memTemplates`, `memWebhooks`, `memStyles`, `memComponents`, `memComments`, `memVersions`

**Templates:**
- `createTemplate(name, w=1080, h=1080, canvasJson?, userId?)` - same logic as Express. Adds `user_id` if provided.
- `listTemplates(userId?)` - optionally filters by `user_id`. Maps `r.data`.
- `getTemplate(id)` - single lookup.
- `updateTemplate(id, updates)` - merge + updatedAt.
- `deleteTemplate(id)` - hard delete.
- `applyLayerOverrides(templateId, overrides)` - loops override keys, applies ALL properties indiscriminately (`for (const [k, v] of Object.entries(override)) { layer[k] = v; }`). Simpler than Express version - no type checking.

**Webhooks:**
- `registerWebhook(url, events, secret?, userId?)` - auto-generates secret if not provided: `whsec_${randomUUID().replace(/-/g, "")}`. **Different behavior from Express.**
- `listWebhooks(userId?)` - optional user filter.
- `deleteWebhook(id)` - hard delete.
- `fireWebhooks(event, payload)` - signature header: `X-PaperFlow-Signature` (vs Express's `X-Futuraria-Signature`). HMAC-SHA256.

**API Keys:**
- `listApiKeys(userId)` - no in-memory fallback (requires DB).
- `createApiKeyDB(name, userId)` - format: `fd_${randomUUID().replace(/-/g, "")}`. **Different prefix from Express (`fd_` vs `ftra_`).** Key prefix: `rawKey.slice(0, 11)` (vs Express `slice(0, 12)`). Same permissions.
- `deleteApiKey(id, userId)` - soft delete (active=false).

**Styles:**
- `createStyle(data, userId?)` - validates type MUST be "color", "text", or "effect" (checked at route level). ID prefix: `style_` (vs Express `sty_`). Explicit fields: fills, fontFamily, fontSize, fontWeight, lineHeight, letterSpacing, effects.
- `listStyles(userId?)`, `getStyle(id)`, `updateStyle(id, updates)` - **uses PUT not PATCH** at route level.
- `deleteStyle(id)`.

**Components:**
- `createComponent(data)` - requires canvas + layers array (validated at route). ID prefix: `comp_` (vs Express `cmp_`). Properties map via `Object.fromEntries`.
- `listComponents()`, `getComponent(id)`, `updateComponent(id, updates)`, `deleteComponent(id)`.

**Comments:**
- `createComment(data)` - uses `db.from("comments").upsert()` (vs Express's `insert`). Snake_case columns.
- `listComments(templateId)`, `updateComment(id, updates)`, `deleteComment(id)`.
- `addReply(commentId, author, text)` - reply format uses snake_case `created_at`.

**Versions:**
- `createVersion(templateId, data, author?, message?)` - **auto-prunes to 50 versions!** Deletes old versions after insert. Memory: keeps last 50 via unshift + pop.
- `listVersions(templateId)` - limit 50.
- `restoreVersion(templateId, versionId)` - updates template directly (no dynamic import needed).

**Routes NOT in Express API (Edge-only):**

| Route | Method | Description |
|-------|--------|-------------|
| `/api/templates/:id/export` | POST | Returns canvas data for client-side rendering. Fires `export.requested`. |
| `/api/templates/:id/export/upload` | POST | Accepts `{ imageData (base64), format, width?, height? }`. Fires `export.complete`. Forwards to webhookUrl if provided. |
| `/api/templates/:id/export/svg` | GET | Server-side SVG generation. Returns `Content-Type: image/svg+xml` with download disposition. |
| `/api/api-keys/create` | POST | Separate key creation endpoint. Auth via API key OR `body.userId`. |

### 14.4 Frontend - Complete Function Detail

#### `src/lib/supabase.ts` (29 lines)

**`getSupabase(): null`** - ALWAYS returns null. Hardcoded. Comment says "offline mode."
**`getSupabaseClient()`** - alias for getSupabase().
**`apiFetch<T>(url, options): Promise<T>`** - generic fetch wrapper. Sets Content-Type. **NO auth headers.** Throws on non-OK. Reads body as text for error message.

**If `getSupabase()` were changed to actually create a client:** `getAuthToken()` in SettingsPanel would return a token, `authFetch` would include `Authorization: Bearer` header. But Express middleware only checks `*** ` prefix, not `Bearer `. Would still fail on Express backend.

#### `src/lib/templateApi.ts` (134 lines)

**Type `TemplateFull`:** extends `DesignTemplate` with optional: `pages[]`, `frames[]`, `styles[]`, `comments[]`, `versions[]`, `variables: { collections, variables, bindings }`.

**`getTemplate(id): Promise<TemplateFull | null>`** - catches 404/"not found" in error message -&gt; returns null. Re-throws other errors.

**`createTemplate(name, width=1080, height=1080, canvasJson?): Promise<DesignTemplate>`** - body: `{ name, width, height, canvas: canvasJson }`.

**`updateTemplate(id, updates): Promise<DesignTemplate>`** - body: `JSON.stringify(updates)`. Type: `Partial<DesignTemplate> & Record<string, any>`.

**`deleteTemplate(id): Promise<void>`** - no return value handling.

**`duplicateTemplate(id, name?): Promise<DesignTemplate>`** - body: `{ name }`.

**`listTemplates(limit=50, offset=0): Promise<{ data, total }>`** - URL params, no body.

**Local Storage Fallbacks:**
- `LS_KEY = "futuraria_local_templates"` - localStorage key
- `getLocalTemplates(): Record<string, any>` - parses JSON, returns `{}` on error
- `saveLocalTemplate(id, data)` - saves with `updatedAt` timestamp
- `getLocalTemplate(id): any | null` - single lookup
- `saveLocal(id, data)` - alias
- `listLocalTemplates(): any[]` - sorted by `updatedAt` DESC
- `deleteLocalTemplate(id)` - removes key
- **These functions are exported but never called anywhere in the codebase.** They exist as an offline fallback that was never wired up.

### 14.5 Critical Differences Between Backends

| Feature | Express API (Railway) | Edge Function (Netlify) |
|---------|----------------------|------------------------|
| Framework | Express with middleware | Raw fetch handler |
| Auth enforcement | ALL routes blocked | Only API keys endpoints blocked |
| Auth methods | `*** <key>` (broken) or `X-API-Key` | `X-API-Key` or `Bearer <JWT>` |
| Rate limiting | Yes (100/min CRUD, 10/min render) | None |
| Zod validation | 4 schemas defined, 8 undefined | None (manual only) |
| Puppeteer render | Yes (PNG/JPG) | No (SVG only, client-side export) |
| Export endpoints | No | Yes (3 export routes) |
| Style ID prefix | `sty_` | `style_` |
| Component ID prefix | `cmp_` | `comp_` |
| API key prefix | `ftra_` (randomBytes hex) | `fd_` (UUID no dashes) |
| Key prefix length | 12 chars | 11 chars |
| Webhook signature header | `X-Futuraria-Signature` | `X-PaperFlow-Signature` |
| Webhook secret | User-provided optional | Auto-generated if missing |
| Version pruning | No | Auto-prune to 50 |
| Config endpoint | Returns version+features | Returns Supabase URL + anon key (⚠️ security issue) |
| Comment insert | `insert` | `upsert` |
| Style update method | PATCH | PUT |

### 14.6 New Issues Found (Deep Audit)

| # | Severity | Issue |
|---|----------|-------|
| 23 | 🔴 CRITICAL | **Edge config endpoint leaks Supabase URL + anon key** - `/api/config` returns `{ supabaseUrl, supabaseAnonKey }` to unauthenticated callers |
| 24 | 🔴 CRITICAL | **Edge function has NO auth on most routes** - templates, layers, styles, components, comments, versions all accessible without API key |
| 25 | 🔴 CRITICAL | **8 Zod schemas undefined** - any route using them will throw TypeError at runtime |
| 26 | 🔴 CRITICAL | **Auth double-applied on branches** - `last_used_at` fires twice per branch request |
| 27 | 🟡 | **4 additional prefix mismatches** - style `sty_`/`style_`, component `cmp_`/`comp_`, secret auto-gen, signature header name |
| 28 | 🟡 | **Edge has NO rate limiting** - vulnerable to abuse |
| 29 | 🟡 | **Edge has NO Zod/input validation** - manual checks only, inconsistent with Express |
| 30 | 🟡 | **Local storage fallback never wired** - `templateApi.ts` localStorage functions are dead code |
| 31 | 🟡 | **Styles use PATCH in Express but PUT in Edge** - HTTP method mismatch |
| 32 | 🟢 | **In-memory list functions don't sort** - Express `listTemplates()` memory fallback has no ordering |
| 33 | 🟢 | **Variables: PGRST116 not abstracted** - Supabase-specific error code hardcoded |
| 34 | 🟢 | **Render GET returns 200 with error** - should be 501 Not Implemented |

---

*Deep audit complete: 60+ files verified line-by-line. 34 issues cataloged. Every function documented with inputs, outputs, side effects, and what happens if removed.*

---

## 15. Exhaustive Completion Audit - Previously Undocumented Functions & Details

> This section catalogs every function, variable, utility, event handler, and implementation detail that was previously summarized, considered non-essential, or inadvertently omitted. Every entry here has been verified against the source code.

---

### 15.1 booleanOps.ts - Complete Algorithm Catalog (785 lines)

#### Internal Utilities (not exported)

**`roundedRectPoints(x, y, w, h, rx, ry, segments: number): Point[]`** - Constructs a rounded-rectangle polygon by iterating 4 corners, each with `segments` arcs. Uses parametric cos/sin on each quadrant. Returns array of points tracing the full rounded perimeter clockwise.

**`approximatePath(obj): Point[]`** - Converts a Fabric.js `path` object to sampled points. Iterates through `obj.path` commands: `M`/`L` (direct, transform-matrix applied), `C` (cubic bezier sampled at 0.1 intervals), `Q` (quadratic bezier sampled at 0.1 intervals). `Z` command is ignored (closure handled externally).

**`cubicBezier(p0, p1, p2, p3, t): number`** - Standard cubic Bézier formula: \( (1-t)^3 p_0 + 3(1-t)^2 t p_1 + 3(1-t) t^2 p_2 + t^3 p_3 \).

**`quadBezier(p0, p1, p2, t): number`** - Standard quadratic Bézier: \( (1-t)^2 p_0 + 2(1-t) t p_1 + t^2 p_2 \).

**`rotatePoint(p, cx, cy, angle): Point`** - Rotates point `p` around center `(cx, cy)` by `angle` radians using standard rotation matrix.

**`convexHull(points: Point[]): Point[]`** - Graham scan algorithm. Finds lowest point as pivot, sorts remaining by polar angle (atan2). Builds hull via stack, popping when `cross(prev, curr, next) ≤ 0`. Handles collinear points by preferring closer ones. Returns convex hull polygon in counter-clockwise order.

**`cross(a, b, c): number`** - 2D cross product: `(b.x - a.x)*(c.y - a.y) - (b.y - a.y)*(c.x - a.x)`. Used for orientation tests in convex hull.

**`pointInPolygon(p, poly): boolean`** - Ray-casting algorithm (even-odd rule). Casts horizontal ray to the right, counts edge crossings. Handles edge cases: when ray passes exactly through vertices, the inequality `(yi > p.y) !== (yj > p.y)` correctly excludes duplicate counts.

**`lineIntersection(p1, p2, p3, p4): Point | null`** - Computes intersection of two line segments using parametric form. Returns null if denom < 1e-10 (parallel/coincident) or if intersection is outside both segments (`t`/`u` not in [0,1]).

**`clipPolygon(subject, clip): Point[]`** - Sutherland-Hodgman polygon clipping. Iterates through each edge of `clip` polygon, building output list from input list using `isLeftOfEdge` test. Adds intersection points when vertices cross the boundary.

**`isLeftOfEdge(p, edgeStart, edgeEnd): boolean`** - Tests if point `p` is on the left side of the directed edge (cross product ≥ 0).

#### Canvas-Based Boolean Operation Internals

**`getCompositeOperation(operation): GlobalCompositeOperation`** - Maps BooleanOperation enum to Canvas 2D composite mode:
- `union` -&gt; `"source-over"` (A over B)
- `subtract` -&gt; `"destination-out"` (B punches hole in A)
- `intersect` -&gt; `"source-in"` (B masks A)
- `exclude` -&gt; `"xor"` (keep non-overlapping areas)
- Default -&gt; `"source-over"`

**`renderObjectToCanvas(obj, ctx: CanvasRenderingContext2D)`** - Renders a Fabric.js object to a 2D canvas context for pixel-manipulation boolean ops. Handles: rect (with rotation, rounded corners via `roundRect`), ellipse (rotated around center), circle, triangle, path (via `extractPathD` + `Path2D`), group (recursive render of children), polygon (with transform matrix calc). Fallback: bounding-box fillRect. Applies fill/stroke of each object.

**`extractPathD(obj): string`** - Converts Fabric.js `obj.path` array of SVG commands to a `d` attribute string. Joins commands with spaces/commas. Used to create `Path2D` for canvas rendering.

**`roundRect(ctx, x, y, w, h, rx, ry)`** - Draws a rounded rectangle path on a 2D context using 4 `quadraticCurveTo` calls for corners and straight lines for edges. Clamps radius to `w/2` / `h/2`.

#### Contour Tracing Pipeline

**`traceContourFromCanvas(canvas, offsetX, offsetY, scale): string | null`** - Complete pipeline from rendered canvas to SVG path:
1. Gets `ImageData` from the offscreen canvas
2. Creates binary mask (Uint8Array): alpha > 127 -&gt; 1 (filled), else 0
3. Runs **Moore neighborhood tracing** via `mooreTraceContour`
4. Simplifies contour via **Ramer-Douglas-Peucker** algorithm with ε=1.5
5. Undoes scale+offset to get canvas coordinates
6. Builds SVG `d` string: `M x y L ... Z`

**`mooreTraceContour(mask, w, h): Point[]`** - Moore neighborhood boundary tracing (8-connected). Finds the first non-zero pixel by left-&gt;right, top-&gt;bottom scan. Uses 8-direction offsets (clockwise: left, top-left, top, top-right, right, bottom-right, bottom, bottom-left). Starts at direction 6 (left), searches for next boundary pixel by checking (dir+5)%8 first (90° CCW from backtrack direction). Safety: maxSteps = `w*h*2`. Returns closed contour.

**`simplifyContour(points, epsilon): Point[]`** - Ramer-Douglas-Peucker polyline simplification. Recursively finds the point with maximum perpendicular distance from the line between first and last. If max > epsilon, splits and recurses; otherwise returns [first, last].

**`perpendicularDistance(p, lineStart, lineEnd): number`** - Computes point-to-line distance as `|dy*px - dx*py + x1*y2 - y1*x2| / sqrt(dx²+dy²)`. Handles zero-length edges by returning Euclidean distance to first point.

---

### 15.2 useCanvas.ts - Internal Engine Functions (3779 lines)

#### Undocumented Internal Helpers

**`uid(p = "n"): string`** - Global monotonic counter + timestamp UID generator: `"${prefix}_${Date.now()}_${++_uid}"`. Prefixes used: `n` (default), `page`, `frame`, `bool`, `comp`, `inst`, `section`. Variable `_uid` is module-level (shared across hook instances).

**`currentPage(): PageInfo | undefined`** - Returns the currently active page from `pagesRef.current`. Used internally by `savePage`, `addFrame`, `deleteFrame`.

**`frameSizeSnapshotRef: Map<string, { width, height, left, top }>`** - Snapshot of each frame's dimensions BEFORE resize begins. Keyed by frameId. Populated on `scaling` event, consumed by `applyConstraintsToFrame`.

**`isRestoringRef`** - Flag set to true during undo/redo/paste operations to prevent pushUndoState from creating new undo entries during restoration (avoids redo stack contamination).

**`initialStateSavedRef`** - Set to true after the first object:added fires post-mount. Prevents double initial state capture.

**`saveTimerRef`** - Holds `setTimeout` ID for the 300ms debounced undo state push.

#### Frame Visual System

**`addFrameVisual(c, fid, name, x, y, w, h)`** (line 985-1054) - Internal function, NOT exported. Creates frame background rect + text label on canvas:
- **bg:** `fabric.Rect` at `(x, y, w, h)`, fill `#161616`, stroke `#444`, cornerColor `#6366f1`, transparentCorners=false, mark `isFrameBg=true`, `isFrameVisual=true`, `layerId=fid`.
- **label:** `fabric.Textbox` positioned 28px above the frame (`y - 28`), font 18px bold "Inter, sans-serif", fill `#ddd`, mark `isFrameLabel=true`.
- **Event handlers on bg:** `moving` -&gt; syncs label position; `scaling` -&gt; captures initial size snapshot; `modified` -&gt; syncs label text to frame name + applies layout constraints via `applyConstraintsToFrame`.
- **Event handler on label:** `mousedown` -&gt; selects the corresponding frame background rect.

**`selectFrame(fid)`** (line 1445-1465) - Finds frame visual by `fid`, centers viewport on it: `newVptX = viewW/2 - (fx + fw/2) * zoom`. Triggers `syncLayers()`.

**`renameFrame(fid, name)`** - Updates `framesRef.current` entry + label text. Triggers `syncLayers()` + `opts.onPagesChange`.

**`deleteFrame(fid)`** - Removes ALL objects with matching `frameId` (two passes: objects with `.frameId` property and ones accessed via cast). Removes frame from `framesRef`. Handles active frame reassignment. Syncs page state.

#### Smart Guides & Snap Engine

**`setupSmartGuides(c)`** (line 1057-1131) - Internal function, attaches fabric event listeners:
- **`object:moving`**: If `snapToGrid` enabled, rounds position to nearest grid multiple. If `smartGuides` enabled, finds alignment with other objects via `findAlignmentGuides`, snaps to the closest match, and draws colored guide lines (green=horizontal, blue=vertical).
- **`object:scaling`**: If `snapToGrid`, rounds width/height to grid size.
- **`mouse:up`**: Clears all guide lines.

**`getObjectBounds(obj): { left, top, right, bottom, centerX, centerY, width, height }`** - Convenience wrapper around `getBoundingRect()`. Used by the smart guides engine.

**`findAlignmentGuides(target, targetBounds, others, threshold): { snapX, snapY, guides[] }`** - Core alignment detection. Checks 5 vertical alignments (left, right, center vs other's left, right, center) and 5 horizontal alignments (top, bottom, center). Deduplicates guides by type and position (within 1px). Returns closest snap point and list of guides to draw.

**`createGuideLine(c, guide, zoom): fabric.Line`** - Creates a dashed guide line: horizontal=green (`#22c55e`), vertical=blue (`#3b82f6`), dashed `[4/zoom, 4/zoom]`, strokeWidth `1/zoom`, marked with `isGuideLine=true`, sent to front.

**`clearGuideLines(c)`** - Removes all guide line objects from canvas and clears `guideLinesRef`.

#### Tool Mode State Machine

**`setToolMode(tool: ToolName)`** (line 1498-1517) - Configures the Fabric canvas based on active tool:
- `pencil`: enables `isDrawingMode`, sets `PencilBrush` with white color and width 2
- `pen`: disables selection, sets cursor to `crosshair`
- `hand`: disables selection, sets cursor to `grab`
- `eyedropper`: disables selection, sets cursor/hover to `crosshair`
- Other tools (`rect`, `ellipse`, `line`, `text`, `frame`, `image`): disables selection, crosshair cursor
- `select`: restores selection=true, default cursor

#### Object Placement

**`placeInFrame(obj)`** (line 1520-1544) - Internal helper. Assigns `layerId` via `uid()`, sets `frameId` to `activeFrameIdRef.current`. If frame visual found and object has no position, places at frame position + 100px offset. Calls `c.add(obj)`, `c.setActiveObject(obj)`, `c.renderAll()`.

#### Shape Factories (Full Parameters)

**`addRect()`** - Creates `fabric.Rect` at (200, 200), 200×150, fill `#6366f1`, rx=ry=8, drop shadow.

**`addEllipse()`** - Creates `fabric.Ellipse` at (200, 200), rx=100, ry=80, fill `#22c55e`.

**`addLine()`** - Creates `fabric.Line` from `[200, 300, 500, 300]` (horizontal 300px), white, strokeWidth 2.

**`addText(text="Edit me")`** - Creates `fabric.Textbox`, 200×300, fontSize 32, white, "Inter, sans-serif".

**`addImage(src: string)`** - Loads image from URL via `new Image()`, scales to max 500px either dimension, stores `imageFilters: {}` on the object.

**`addSVG(svgString: string)`** - Uses `fabric.loadSVGFromString`. If single object, places directly; if multiple, wraps in `fabric.Group` scaled to max 500px.

#### Pen Tool Engine

**`handlePenClick(opt)`** - Stores pointer in `penPoints` array, draws a 4px-radius fill circle on click point (via `penDots`), draws a dashed line from previous point to current point (via `penLines`). Both markers are non-selectable, non-eventing.

**`finishPenPath()`** - Clears all pen dots/lines. Constructs SVG path from `penPoints`. Auto-closes if start-to-end distance < 30px. Creates `fabric.Path` with fill=`#6366f1` (closed) or `transparent` (open), stroke=white. Stores `isClosedPath` on the object. Calls `placeInFrame`.

**`clearPen()`** - Removes all pen dots and lines from canvas, resets `penPoints`, `penLines`, `penDots` to empty arrays.

#### Export Internals

**`exportFrame(fid, format: "png" | "jpg" | "svg")`** (line 3423-3438) - Finds frame by ID, creates an offscreen canvas at 2× resolution, temporarily sets viewport to [1,0,0,1,-x,-y] to render only frame objects, renders each child to canvas context, restores viewport, downloads via `downloadDataUrl`.

**`downloadDataUrl(url, name)`** (line 3776-3778) - Global function outside the hook. Creates hidden `<a>` element, sets `href` and `download`, triggers click, then disposes. Used by all export functions.

**`exportSVG()`** - Uses `c.toSVG()`, wraps in `Blob`, creates object URL, downloads.

**`exportJSON()`** - Custom serialization preserving all extended properties (`layerId`, `layerName`, `frameId`, `isFrameVisual`, `isClosedPath`, `imageFilters`, `styleId`, `componentId`, `isComponentInstance`, `constraints`, section props). Pretty-prints with 2-space indent.

#### Layout Constraints Engine (Complete)

**`applyConstraints(child, parentOld, parentNew, constraints)`** (line 1652-1751) - The layout constraint resolver. Computes distances (left, top, right, bottom) from child to parent edges before resize, then applies the new parent size:
- **left/right both**: options for "scale" (proportional) or fixed distance
- **Single direction anchors** (left-only, right-only, top-only, bottom-only)
- **Center anchors** (`centerX`, `centerY`) maintain child's relative center offset
- **No anchor**: proportional repositioning based on width/height ratio
- Sets `left`, `top`, `scaleX`, `scaleY` on the child object

**`applyConstraintsToFrame(frameId, frameObj)`** - Called on frame `modified` event. Compares snapshot vs new bounds. Skips if change < 0.5px (floating-point guard). Iterates all children with matching `frameId`, applies their stored `constraints` via `applyConstraints`.

**`setConstraints(constraints: LayoutConstraint)`** - Writes constraints to `(obj).constraints` on the active object.

**`getConstraints(): LayoutConstraint | undefined`** - Reads `(activeObj).constraints`.

#### Sections Engine (Complete - 7 functions)

**`createSection(name, x=100, y=100, width=600, height=400, color="#6366f1"): SectionInfo | null`** - Creates a 3-piece section visual: semi-transparent bg rect (color + "18" alpha), title label ("Inter sans-serif 600 14px"), and collapse indicator (●). All three have`sectionId` linking. Mouse handlers: label click selects bg; bg moving scales label/indicator. Adds `SectionInfo` to `sectionsRef`.

**`toggleSectionCollapse(sectionId)`** - Toggles `collapsed` flag. Hides/shows children assigned to this section. Updates indicator: ●-&gt;▶ (collapsed), ▶-&gt;● (expanded).

**`assignToSection(layerId, sectionId)`** - Sets `(obj).sectionId` on the Fabric object.

**`removeFromSection(layerId)`** - Deletes `(obj).sectionId` property.

**`renameSection(sectionId, newName)`** - Updates name in `sectionsRef` and all label text objects.

**`setSectionColor(sectionId, color)`** - Updates bg fill (color+"18"), bg stroke, label fill, indicator fill. Stores in `sectionsRef`.

**`deleteSection(sectionId)`** - Removes section visuals (bg, label, indicator by id match), unassigns children (deletes `sectionId` property), removes from `sectionsRef`.

**`getSections(): SectionInfo[]`** - Returns `sectionsRef.current`.

#### Grid Styles System (Complete - 6 functions)

**`setGridStyles(styles: GridStyle[])`** - Writes to `gridStylesRef`.

**`getGridStyles(): GridStyle[]`** - Reads from `gridStylesRef`.

**`getActiveGridStyleId(): string | null`** - Returns `activeGridStyleIdRef.current`.

**`applyGridStyle(styleId)`** - Finds style by ID, stores as active, calls `renderGridStyleOverlay`.

**`removeGridStyle()`** - Sets active to null, removes all `isGridStyleLine` objects.

**`renderGridStyleOverlay(style: GridStyle)`** - Draws colored lines for columns/rows/grid within the visible viewport. Calculates visible area from viewport transform. Lines have 25% opacity, `isGridStyleLine=true`, sent to back (above regular grid). Supports `columns`, `rows`, and `grid` types with configurable count, gutter, margin.

#### Image Fit Mode System (Complete)

**`setImageFitMode(layerId, fitMode: ImageFitMode)`** - Applies image fitting mode:
- `fill`: scales to cover container, clips with `clipPath`
- `fit`: scales to fit entirely within container, clips with `clipPath`  
- `crop`: user-specified scale and offset, clips with offset-adjusted clipPath
- Stores `_origImgWidth`/`_origImgHeight` for reference

**`getImageFitMode(layerId): ImageFitMode | undefined`** - Returns stored mode or undefined.

---

### 15.3 App.tsx - Undocumented Utilities & Handlers

#### URL Routing Helpers

**`getTemplateIdFromUrl(): string | null`** (line 29-31) - Parses `?templateId=` from `window.location.search`. Returns null if absent.

**`setTemplateIdInUrl(id: string | null)`** (line 34-42) - Sets or clears `templateId` search param in URL via `history.pushState`. Preserves existing params.

#### File I/O Helpers

**`openFilePicker(cb: (file: File) => void)`** (line 1264-1266) - Creates a hidden `<input type="file" accept="image/*,.svg">`, triggers click, calls callback with selected file. Used by the image tool.

**`readFileAs(file, mode: "text" | "dataUrl", cb: (r: string | ArrayBuffer) => void)`** (line 1268-1271) - Uses `FileReader`: `readAsText` or `readAsDataURL` depending on mode. Used by image/import and drag-drop handlers.

#### Event Handlers (Not Previously Detailed)

**Pen tool useEffect** (line 276-281): Attaches `mouse:down` to Fabric canvas that calls `canvas.handlePenClick(opt)` only when `tool === "pen"`.

**Eyedropper useEffect** (line 283-317): Two separate Fabric handlers:
- `handleEyedropperClick`: Calls `canvas.sampleColor(e)`, sets color on active object's `fill`, returns to select mode.
- `handleEyedropperMove`: Live color preview on hover.

**Comment mode useEffect** (line 320-336): When `canvas.commentModeRef.current` is true, `mouse:down` prompts user for text input, calls `canvas.addComment(x, y, text, "User", "current")`, exits comment mode, opens comments panel.

**Space bar hand tool** (line 642-652, 681-687):
- `keydown`: Sets `spaceHeldRef=true`, saves current tool to `prevToolRef`, switches to `hand` tool.
- `keyup`: Restores `prevToolRef.current` tool.

**Scroll zoom** (line 703-721): `wheel` event on `.canvas-area`. When `ctrlKey` or `metaKey` pressed, zooms centered on pointer: `deltaY > 0 -&gt; ×0.9`, else `×1.1`. Clamped to `[0.05, 5]`. Non-passive listener.

**Drag & drop** (line 724-732): Three handlers:
- `handleDragOver`: `preventDefault()` + sets `dragOver=true`
- `handleDragLeave`: `preventDefault()` + sets `dragOver=false`
- `handleDrop`: Iterates `e.dataTransfer.files`, SVG files read as text -&gt; `canvas.addSVG()`, image files read as dataUrl -&gt; `canvas.addImage()`

**selectedLayer** (line 734): `layers.find(l => l.id === (selectedObj as any)?.layerId) || null` - used to pass the selected layer's metadata to LayersPanel and StatusBar.

**onLayerUpdate in PropertiesPanel** (line 1068-1075): After any property change, re-syncs layers list by iterating all non-frame-visual objects and mapping to `LayerInfo`.

**renderFrame in PrototypePreview** (line 1129-1146): For each frame in preview, renders a placeholder `<div>` showing frame name and element count. The actual frame rendering is a placeholder - there is no Fabric canvas mirror in preview mode.

#### App Root Component Routing

**`App()`** (line 1194-1262): Root component with routing:
1. `auth.loading` -&gt; shows spinner
2. `!auth.isLocal && !auth.user && !localMode` -&gt; shows `<LoginPage>`
3. `templateId` set -&gt; shows `<Editor>`  
4. Otherwise -&gt; shows `<Dashboard>`
- Uses `useState` for `templateId` (from URL), `localMode`
- `popstate` listener syncs `templateId` from URL on browser back/forward
- `localMode` is a skip-login flag for offline/local use (never persisted)
- `userId` defaults to `"local"` when unauthenticated

---

### 15.4 usePrototype.ts - Complete Prototype Engine (636 lines)

#### Module-Level Variables

**`let _pid = 0`** - Global interaction counter, incremented by `puid()`.

**`puid(prefix="pi"): string`** - `"${prefix}_${Date.now()}_${++_pid}"`. Used for interaction (`int`), flow (`flow`) IDs.

**`defaultTransition: PrototypeTransition`** - `{ type: "dissolve", duration: 300, easing: "easeInOut" }`.

**`EASING_CSS: Record<string, string>`** - Maps easing names to CSS `cubic-bezier()` strings:
- `linear` -&gt; `"linear"`
- `easeIn` -&gt; `"cubic-bezier(0.4, 0, 1, 1)"`
- `easeOut` -&gt; `"cubic-bezier(0, 0, 0.2, 1)"`
- `easeInOut` -&gt; `"cubic-bezier(0.4, 0, 0.2, 1)"`

#### React State

**`const [, setTick] = useState(0)`** - Unused state value, only `setTick` is used for `forceUpdate()`.

**`forceUpdate()`** - `setTick(n => n + 1)` - triggers re-render of any component consuming usePrototype.

#### All 5 Action Types in executeTrigger

The `executeTrigger` function handles 5 action types via a switch:
1. **`navigate`**: calls `navigateToFrame(action.targetFrameId, transition)` - replaces current frame
2. **`openOverlay`**: pushes `{ frameId, position }` to `activeOverlaysRef` - multiple overlays can stack
3. **`closeOverlay`**: removes specific overlay by frameId, or all overlays if no targetFrameId
4. **`swapOverlay`**: replaces the first overlay with a new one (keeps position if `action.overlayPosition` absent)
5. **`changeTo`**: same as `navigate` but treated as "state change" semantically

Each action respects `action.delay` - if > 0, execution is wrapped in `setTimeout(action.delay, execute)`.

#### Exported CSS Helpers

**`getTransitionCSS(transition): { entering: CSSProperties, exiting: CSSProperties }`** - Maps PrototypeTransition to CSS animation properties:
- `instant`: no transition (instant opacity change)
- `dissolve`: opacity fade with duration/easing
- `moveIn`: translates FROM direction into place
- `moveOut`: translates FROM place TO direction
- `push`: current frame exits opposite direction from new frame entering
- `slideIn`: combined translation + opacity fade
- Default: opacity 1/0 with no transition

**`getDeviceDimensions(device): { width, height, label }`** - Returns viewport dimensions:
- `phone`: 390×844 (iPhone 14)
- `tablet`: 820×1180 (iPad Air)
- `desktop`: 1440×900

---

### 15.5 useRealtime.ts - Complete Realtime Engine (363 lines)

**`throttle<T>(fn, ms): T`** - Generic throttle. Runs first call immediately, queues subsequent calls. If a call arrives during cooldown, schedules the last one. Clears pending if new call within cooldown. Returns typed function matching `fn`'s signature.

**`broadcastDelta(delta)`** - Wraps a partial `CanvasDelta` with `userId` + `timestamp`, sends as Supabase broadcast on event `"canvas:delta"`. Used for `object:added` and `object:removed`.

**`throttledCursorBroadcast`** - useRef-wrapped throttle (50ms). Sends `CursorPosition` (userId, userName, x, y, color) on broadcast event `"cursor:move"`.

**`throttledModifiedBroadcast`** - useRef-wrapped throttle (50ms). Serializes modified object (preserving 11 extended properties), sends on broadcast event `"canvas:delta"` with delta type `"object:modified"`. Uses `obj.toObject([...])` to capture the full state.

**`applyRemoteDelta(delta)`** - Processes incoming broadcast deltas:
- `object:modified`: Finds matching local object by `layerId`, applies delta payload via `obj.set()`, updates coords
- `object:added`: Enlivens from JSON if object doesn't already exist locally
- `object:removed`: Finds and removes object from canvas
- Sets `isRemoteUpdateRef=true` to prevent echo (local listeners check this flag)
- Skips if `delta.userId === userId` (self-messages)

**Channel subscription logic** (line 205-294): Creates Supabase `channel("template:${templateId}")` with `broadcast: { self: false }` and `presence: { key: userId }`. Handles:
- `presence sync`: builds user list from `channel.presenceState()`, ensures self is included
- `presence leave`: removes departed user's cursor
- `broadcast cursor:move`: updates cursor state
- `broadcast canvas:delta`: calls `applyRemoteDelta`
- On `SUBSCRIBED`: sets online, assigns user color via `assignUserColor`, tracks presence

**Fabric listener attachments** (line 297-354): When online, hooks into:
- `object:modified` -&gt; `throttledModifiedBroadcast`
- `object:added` -&gt; `broadcastDelta`
- `object:removed` -&gt; `broadcastDelta`
- `mouse:move` -&gt; `throttledCursorBroadcast`
All skip frame labels, grid lines, guide lines by checking `isFrameLabel/isGridLine/isGuideLine`. All skip if `isRemoteUpdateRef.current` is true.

**Return values not previously detailed:** `users: UserPresence[]`, `cursors: CursorPosition[]`, `isOnline: boolean`, `userCount: number` (= users.length).

---

### 15.6 netlify/functions/api.ts - Proxy Wrapper (51 lines)

**`ensureServer(): Promise<number>`** - Singleton. If `listening` is false, calls `app.listen(0, "127.0.0.1")` on the Express app. Port 0 = random available port. Stores assigned port. Returns the port number. Subsequent calls resolve immediately.

**Default export `(req: Request, _context: Context)`** - Full proxy handler:
1. Calls `ensureServer()` to start Express
2. Constructs target URL: `http://127.0.0.1:${port}${pathname}${search}`
3. Copies all request headers using `new Headers()` + `req.headers.forEach()`
4. Forwards body as text for non-GET/HEAD methods
5. Returns `new Response(res.body, { status, statusText, headers })`
6. Path matches `/api/*` via `export const config = { path: "/api/*" }`

---

### 15.7 templateApi.ts - Local Storage Fallback Functions

**`getLocalTemplates(): Record<string, any>`** - Reads `localStorage.getItem("futuraria_local_templates")`, JSON.parse, returns `{}` on error.

**`saveLocalTemplate(id, data)`** - Merges data with `{ ...data, id, updatedAt }`, writes to localStorage.

**`getLocalTemplate(id): any | null`** - Single key lookup.

**`saveLocal(id, data)`** - Alias to `saveLocalTemplate()`.

**`listLocalTemplates(): any[]`** - Returns all values sorted by `updatedAt` DESC.

**`deleteLocalTemplate(id)`** - Deletes key from localStorage object.

> ⚠️ **Dead code**: These 6 functions are exported but NEVER called anywhere in the codebase. Issue #30.

---

### 15.8 renderer.ts - Undocumented Internal Details

**`escapeHtml(str): string`** - Escapes `&`, `<`, `>`, `"`, `'` to HTML entities. Used by `renderLayerHTML` and `buildSVG` to prevent XSS from user text content.

**`layerBaseStyle(layer): string`** - Builds CSS string for `position:absolute; left; top; width; height; opacity; transform:rotate(Xdeg); z-index`. Default: opacity=1, rotation=0, zIndex=0.

**`renderLayerHTML(layer): string`** - Returns empty string if `layer.visible === false`. Handles 7 layer types:
- `rect`: background, border, border-radius
- `ellipse`: background, border-radius:50%
- `text`/`textbox`: font-family, font-size, font-weight, color, text-align, line-height, display:flex, word-break
- `image`: `<img src>` with object-fit + CSS filters (brightness, contrast, saturation, blur, grayscale, sepia)
- `group`: recursive `renderLayerHTML` on children with positions offset by group's x/y
- `path`: inline SVG with `<path d>`
- `line`: inline SVG with `<line x1 y1 x2 y2>`

**`buildRenderHTML(template, scale): string`** - Full HTML document with zIndex sorting, scale transform on `.canvas` div (`transform: scale(${scale})`), `transform-origin: 0 0`.

**`buildSVG(template): string`** - Full SVG document with:
- Sort by zIndex (index fallback)
- Rotation transforms: `rotate(${rotation}, ${w/2}, ${h/2})`
- Multi-line text: splits on `\n`, uses `<tspan x dx dy>` for line positioning
- Image `preserveAspectRatio`: `xMidYMid slice` (cover), `xMidYMid meet` (contain), `none` (fill)
- Background rect matching canvas color
- Empty `<defs>` block reserved for future use
- xmlns:xlink attribute on root `<svg>`

**`uploadToStorage(buffer, renderId, mimeType): Promise<string | null>`** - Uploads to Supabase Storage bucket `"design-exports"` under `renders/${renderId}.${ext}`. Gets public URL via `getPublicUrl()`. Returns null if Supabase unavailable or upload fails.

**Browser singleton** - `let browser: Browser | null = null`. `getBrowser()` launches Puppeteer once with args `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage`. Reuses the same browser instance across renders. **Never calls `browser.close()`** - memory leak on server restart.

**Direct webhook call** - In `renderTemplate()`, if `request.webhookUrl` is provided, sends a POST with `{ event: "render.complete", payload: result, timestamp }` with 10s AbortSignal timeout. This is separate from the database-stored webhooks.

---

### 15.9 Previously Undocumented Components

#### GridStylesPanel.tsx (475 lines)
**`GridStylesPanel({ gridStyles, activeGridStyleId, onGridStylesChange, onApplyGridStyle, onRemoveGridStyle })`**
- State: `showCreate` (toggle), `editingId` (edit mode for existing style)
- `handleCreate(req)`: Generates `gs_` prefixed ID, creates GridStyle with union of `req` fields + `visible: true` + metadata timestamps. Calls `onGridStylesChange`.
- `handleDelete(id)`: Filters out style, calls `onRemoveGridStyle` if deleting active.
- `handleUpdate(id, updates)`: Maps and replaces style entry.
- `GRID_TYPE_ICONS`: Record mapping `columns-&gt;"▥"`, `rows-&gt;"▤"`, `grid-&gt;"⊞"`.
- Renders list of grid styles with type icon, name, color swatch. Active style gets highlighted border. Create/delete/edit inline UI.

#### VariablesPanel.tsx (435 lines)
**`VariablesPanel({ collections, variables, activeModes, bindings, selectedLayerId, selectedLayerProperty, onCreateCollection, onUpdateCollection, onDeleteCollection, onCreateVariable, onUpdateVariable, onDeleteVariable, onSetActiveMode, onBindVariable, onUnbindVariable, onResolveValue, onSave })`**
- State: `expandedCollections` (Set<string>), `showNewCollection`, `newCollectionName`, `newCollectionModes` (comma-separated string "Light, Dark"), `addingVariableTo`, `newVarName`, `newVarType`, `editingVarId`, `draggedVarId`, `editingCollectionId`, `editModeName`
- `toggleCollection(id)`: Toggles entry in `expandedCollections` Set
- Full collection CRUD form: name input, modes input (parsed by splitting comma-separated string), delete button
- Variable row: shows name, type badge, resolved value (via `onResolveValue`), edit button
- Variable type selector: `color`, `number`, `boolean`, `string`
- Mode switcher: dropdown per collection to change active mode
- Drag-and-drop: `draggedVarId` state for binding variables to properties
- Save button at bottom calls `onSave`
- `selectedLayerId/property` context: highlights bindable state for current selection

#### PresencePanel.tsx (119 lines)
**`PresencePanel({ users, currentUserId, isOnline })`**
- Helper `getInitials(name)`: Splits on whitespace, returns first 2 capitalized letters. Single word -&gt; first 2 chars. Always uppercase.
- Sorts users: current user first, others alphabetically by `userName`.
- Renders: online dot (green circle if `isOnline`, gray otherwise), user avatars (circles with initials colored by `user.color`), user count badge. Positioned fixed top-right as overlay.

#### CursorOverlay.tsx (130 lines)
**`CursorOverlay({ cursors, viewportTransform })`**
- `CURSOR_FADE_MS = 3000` - cursors fade after 3s inactivity
- `visibleCursors: Map<string, { cursor, lastUpdate }>` - tracks active cursor positions with timestamps
- Updates map when `cursors` prop changes (preserves existing entries, adds new ones)
- Every 500ms: scans for stale cursors (`now - lastUpdate > 3000`) and removes them
- Renders: for each visible cursor, a colored triangle SVG (▼ with user name label nearby). Position transformed by `viewportTransform`: `left = pt[4] + cursor.x * pt[0]`, `top = pt[5] + cursor.y * pt[3]`

#### KeyboardShortcutsDialog.tsx (237 lines)
**`KeyboardShortcutsDialog({ isOpen, onClose })`**
- `SHORTCUT_CATEGORIES` - 6 categories hardcoded:
  1. **Tools** (12 shortcuts): V/H/P/B/R/O/L/F/T/I/K/Space
  2. **Edit** (11 shortcuts): ⌘Z/⌘⇧Z/⌘C/⌘V/⌘⇧V/⌘X/⌘D/⌘A/Delete/Esc/⌘R/⌘S
  3. **View** (8 shortcuts): ⌘+/⌘−/0/⌘1/⌘2/⌘'/⌘Y/⌘P
  4. **Arrange** (8 shortcuts): ⌘G/⌘⇧G/⌘]/⌘[/⌘⌥]/⌘⌥[/N/C
  5. **Boolean Operations** (4 shortcuts): ⌘⌥U/⌘⌥S/⌘⌥I/⌘⌥E
  6. **Snap & Layout** (5 shortcuts): ⌘⇧S/⌘⇧H/⇧A/⌘⇧E/⌘S
- Renders as modal overlay with close on Esc or backdrop click. Categories displayed in columns with icon header and shortcut key rows.

#### Previously Undocumented Props on Existing Components

**PropertiesPanel.tsx** - additional props not documented:
- `variableBindings` - Map tracking which variables are bound to properties
- `onDropVariable(variableId, layerId, property)` - callback for drag-drop variable binding
- `onUnbindVariable(variableId, layerId, property)` - callback for unbinding
- `gridStyles` - GridStyle[] for the grid style dropdown
- `activeGridStyleId` - currently selected grid style
- `onApplyGridStyle(styleId)` - apply grid style overlay
- `onRemoveGridStyle()` - remove overlay
- `onSetImageFitMode(layerId, fitMode)` - for image fit mode controls
- `currentImageFitMode` - current fit mode for selected image layer

**StylesPanel.tsx** - standalone export:
- **`applyStyleToObject(obj, style)`** - Pure function that mutates a Fabric object to match a StyleDefinition. Handles `color` (fill+opacity), `text` (fontFamily, fontSize, fontWeight, lineHeight, letterSpacing), and `effect` (shadow). Used outside the StylesPanel component.

---

### 15.10 Summary: Final Count

| Category | Previously Documented | Now Added | Total |
|----------|----------------------|-----------|-------|
| booleanOps.ts | 5 functions | 17 internal functions | 22 |
| useCanvas.ts | ~75 functions/props | 28 internal functions + 6 refs + 6 state vars | ~115 |
| App.tsx | 10 handlers | 8 utility functions + 6 inline handlers | 24 |
| usePrototype.ts | 15 functions | 2 exported CSS helpers + 3 module-level vars + all 5 action types | 25 |
| useRealtime.ts | 4 return values | 5 internal functions + channel logic + 4 event listeners | 13 |
| netlify/functions/api.ts | - | 2 functions | 2 |
| templateApi.ts | 6 API functions | 6 localStorage dead-code functions | 12 |
| renderer.ts | 6 functions | 7 internal details + browser singleton | 13 |
| Components | 22 panel components | 5 undocumented panels + standalone helpers + extra props | 28 |
| GridStylesPanel | — | 3 handlers + GRID_TYPE_ICONS + full state | — |
| VariablesPanel | — | 13 state vars + toggleCollection + full CRUD form | — |
| PresencePanel | — | getInitials + sorted users + 4 UI elements | — |
| CursorOverlay | — | visibleCursors map + fade timer + transform math | — |
| KeyboardShortcutsDialog | — | 6 categories × 48 shortcuts total + modal | — |

**Total additions**: 95+ functions, helper variables, event handlers, state declarations, and implementation details that were previously summarized or omitted.

**Final file verified**: 55 source files across 3 packages + 4 n8n workflows + 3 config files. Every exported function, every internal helper, every useState/useRef declaration, every event handler, and every inline computation now documented.

---


## 16. Database Schema Audit — Missing Tables, RLS Policies, Code Mismatches

> **Source**: `DATABASE.md` (user-provided Supabase schema) vs actual code references across all route files, services, and edge functions.
> **Supabase SQL**: All fixes consolidated in `supabase-schema.sql` (481 lines, 7 sections).

### 16.1 Summary: What is Missing

| Item | Count | Severity |
|------|-------|----------|
| Tables in DATABASE.md | 4 | — |
| Tables referenced in code but MISSING from DATABASE.md | **5** | CRITICAL |
| RLS policies defined | **0** | HIGH |
| Missing indexes | **6** | MEDIUM |
| FK inconsistencies (ON DELETE CASCADE mismatch) | **2** | MEDIUM |
| Code-level auth bugs | **2** | CRITICAL |
| Orphan data (user_id never populated) | **3** | HIGH |

### 16.2 Tables in DATABASE.md vs Code Expectations

#### 16.2.1 Tables Present in DATABASE.md (4)

| Table | Status | Issues |
|-------|--------|--------|
| `api_keys` | EXISTS | `expires_at` never checked; auth header bug (CRITICAL) |
| `render_logs` | EXISTS | No issues |
| `templates` | EXISTS | `user_id` never populated by Express; FK missing CASCADE |
| `webhooks` | EXISTS | `user_id` never populated; FK missing CASCADE |

#### 16.2.2 Tables MISSING from DATABASE.md (5)

These 5 tables are referenced throughout the code but have **no schema definition**:

1. **`comments`** — Referenced by `comments.ts` (259 lines) + Edge Function `api.mts`. Operations: CRUD + threaded replies.
   Expected columns: `id` (text PK, `cmt_` prefix), `template_id` (text FK→templates), `frame_id` (text nullable), `x` (float8), `y` (float8), `author` (text), `text` (text), `thread` (jsonb, default `[]`), `resolved` (bool, default false), `created_at`, `updated_at`.

2. **`components`** — Referenced by `components.ts` (153 lines) + Edge Function. Operations: CRUD.
   Expected columns: `id` (text PK, `cmp_` prefix), `name` (text), `data` (jsonb), `created_at`.

3. **`styles`** — Referenced by `styles.ts` (135 lines) + Edge Function. Operations: CRUD + type filtering.
   Expected columns: `id` (text PK, `sty_` prefix), `name` (text), `type` (text), `data` (jsonb), `created_at`.

4. **`variables`** — Referenced by `variables.ts` (107 lines). Operations: GET/POST/DELETE per template.
   Expected columns: `id` (uuid PK, `DEFAULT gen_random_uuid()`), `template_id` (text FK→templates), `data` (jsonb), `created_at`, `updated_at`.
   **Important**: This is the ONLY table using auto-generated IDs (POST route inserts without explicit `id`).

5. **`template_versions`** — Referenced by `versions.ts` (184 lines) + Edge Function. Operations: CRUD + restore.
   Expected columns: `id` (text PK, `ver_` prefix), `template_id` (text FK→templates), `version_number` (int4), `data` (jsonb), `author` (text nullable), `message` (text nullable), `created_at`.

### 16.3 RLS Policies — Complete Gap

**ZERO RLS policies exist on any table.** The code uses `SUPABASE_SERVICE_KEY` which bypasses RLS entirely. This works but has risks:
- If service key leaks, all tables are fully open
- If anon key is accidentally used, all data is public
- No defense-in-depth

**34 policies are needed** across 9 tables. All use `TO authenticated`. See `supabase-schema.sql` Section 4 for complete policy SQL.

### 16.4 Foreign Key Integrity Analysis

| Constraint | Table | ON DELETE | Issue |
|-----------|-------|-----------|-------|
| `api_keys_user_id_fkey` | api_keys | CASCADE | Consistent |
| `render_logs_template_id_fkey` | render_logs | CASCADE | Correct |
| `templates_user_id_fkey` | templates | **NO ACTION** | Deleting user with templates FAILS |
| `webhooks_user_id_fkey` | webhooks | **NO ACTION** | Deleting user with webhooks FAILS |
| 3 FKs for missing tables | — | Not defined | Must add CASCADE |

**Fix**: `supabase-schema.sql` Section 5 drops and recreates inconsistent FKs with `ON DELETE CASCADE`.

### 16.5 Missing Indexes

| Index Name | Table | Column(s) | Why Needed |
|------------|-------|-----------|------------|
| `idx_templates_user` | templates | `user_id` | Edge Function filters by `user_id` |
| `idx_comments_template` | comments | `template_id` | Always queried by template |
| `idx_variables_template` | variables | `template_id` | Always queried by template |
| `idx_versions_template` | template_versions | `template_id` | Always queried by template |
| `idx_versions_number` | template_versions | `(template_id, version_number DESC)` | Sorted listing |
| `idx_styles_type` | styles | `type` | Type filtering |

### 16.6 Code-Level Database Bugs

#### BUG #1 (CRITICAL): Broken Auth Header in Express `middleware.ts`
- **Line 64**: `authHeader?.startsWith("*** ")` with `slice(7)`
- `"*** "` is 4 characters, but `slice(7)` expects 7 (`"Bearer "`). This cuts into the actual API key.
- This appears to be a placeholder (`***`) that was never replaced with `Bearer`.
- **Edge Function**: Correctly uses `"Bearer "` + `slice(7)` at `api.mts:61-64`.
- **Impact**: **All Express API authentication is silently broken.** Only works via dev fallback (no Supabase → skip auth) or bootstrap path.
- **Fix**: Change `"*** "` to `"Bearer "` on line 64 of `middleware.ts`.

#### BUG #2 (HIGH): `expires_at` Never Checked
- **Lines 82-86**: Auth query only checks `key_hash` + `active`, ignores `expires_at`.
- Expired API keys remain valid forever.
- **Fix**: Add `expires_at` filter to the lookup query.

#### BUG #3 (HIGH): Templates Created Orphaned (Express)
- **`templates.ts:46`**: Insert never includes `user_id`.
- All Express-created templates have `user_id = NULL`.
- **Edge Function** handles this correctly (`api.mts:90-91`).
- **Fix**: Pass `user_id` from `req.auth?.userId`.

#### BUG #4 (HIGH): Webhooks Created Orphaned
- **`webhooks.ts:28-34`**: `user_id` never passed in `registerWebhook()`.
- **Fix**: Accept and pass `user_id` parameter.

#### BUG #5 (MEDIUM): Variables Table ID Type Mismatch Risk
- **`variables.ts:74-77`**: Insert without explicit `id`.
- If existing table uses text `id` without default, insert fails.
- **Fix**: SQL defines `uuid DEFAULT gen_random_uuid()` — the only table using auto-gen keys.

### 16.7 Code → Database Dependency Map

```
EXPRESS API (packages/api/src/)
├── middleware.ts ──────────▶ api_keys (auth lookup + last_used update)
├── routes/api-keys.ts ──────▶ api_keys (CRUD)
├── services/templates.ts ──▶ templates (CRUD)
├── routes/comments.ts ──────▶ comments (TABLE MISSING)
├── routes/components.ts ─────▶ components (TABLE MISSING)
├── routes/styles.ts ────────▶ styles (TABLE MISSING)
├── routes/variables.ts ──────▶ variables (TABLE MISSING)
├── routes/versions.ts ───────▶ template_versions (TABLE MISSING)
├── services/webhooks.ts ────▶ webhooks (CRUD + fire)
└── services/renderer.ts ────▶ render_logs + templates

EDGE FUNCTION (packages/editor/netlify/functions/api.mts)
├── templates CRUD ────────▶ templates
├── validateApiKey ───────▶ api_keys
├── comments ─────────────▶ comments (TABLE MISSING)
├── components ───────────▶ components (TABLE MISSING)
├── styles ──────────────▶ styles (TABLE MISSING)
└── versions ─────────────▶ template_versions (TABLE MISSING)
```

### 16.8 Edge Function vs Express: Key Differences

| Feature | Express (`middleware.ts`) | Edge Function (`api.mts`) | Impact |
|---------|--------------------------|--------------------------|--------|
| Auth header parsing | `"*** "` (BROKEN) | `"Bearer "` (correct) | Express auth broken |
| X-API-Key support | Yes | Yes | Both OK |
| Supabase session auth | Not implemented | Yes (Bearer JWT) | Edge more capable |
| `user_id` on create | Never passed | Passed when available | Express orphans data |
| `expires_at` check | Not checked | Not checked | Both ignore expiry |

### 16.9 Action Items (Priority Order)

| # | Priority | Action | Target | Status |
|---|----------|--------|--------|--------|
| 1 | **CRITICAL** | Fix auth header: `"*** "` → `"Bearer "` | `middleware.ts:64` | ✅ FIXED |
| 2 | **CRITICAL** | Create 5 missing tables in Supabase | Run `supabase-schema.sql` §2 | ✅ DONE (user) |
| 3 | **HIGH** | Add `expires_at` check to auth query | `middleware.ts:82-86` | ✅ FIXED |
| 4 | **HIGH** | Populate `user_id` on template/webhook creation | `templates.ts:46`, `webhooks.ts:28-34` | ✅ FIXED |
| 5 | **HIGH** | Enable RLS + create 34 policies | Run `supabase-schema.sql` §§1+4 | ✅ DONE (user) |
| 6 | **MEDIUM** | Fix FK ON DELETE CASCADE for templates + webhooks | Run `supabase-schema.sql` §5 | ✅ DONE (user) |
| 7 | **MEDIUM** | Add 6 missing indexes | Run `supabase-schema.sql` §3 | ✅ DONE (user) |
| 8 | **LOW** | Add `user_id` filtering to webhook routes | `webhooks.ts` | ✅ FIXED |

### 16.10 Reference: Complete Generated SQL

All SQL (missing tables, RLS policies, FK fixes, indexes) is consolidated in:

**`supabase-schema.sql`** — 481 lines, 7 sections. Idempotent (`IF NOT EXISTS` / `IF EXISTS`). Safe to run multiple times via Supabase SQL Editor or `supabase db push`.

---

### 16.11 Code Fixes Implemented (2026-05-22)

#### Fixes Applied This Session

| # | File | Change | Impact |
|---|------|--------|--------|
| 1 | `middleware.ts:64` | `"*** "` → `"Bearer "` | Auth header parsing fixed |
| 2 | `middleware.ts:86` | Added `.or("expires_at.is.null,expires_at.gt.now()")` | Expired keys now rejected |
| 3 | `templates.ts:30` | `createTemplate` now accepts `userId?: string` | Templates get `user_id` populated |
| 4 | `templates.ts:48` | `if (userId) row.user_id = userId` | Conditional user_id insert |
| 5 | `templates.ts:153-170` | `duplicateTemplate` accepts + passes `userId` | Duplicated templates not orphaned |
| 6 | `templates.ts` route L19, L81 | `req.auth?.userId` passed to `createTemplate` + `duplicateTemplate` | Route-level propagation |
| 7 | `webhooks.ts:16` | `registerWebhook` accepts `userId?: string` | Webhooks get `user_id` populated |
| 8 | `webhooks.ts:35` | `if (userId) row.user_id = userId` | Conditional user_id insert |
| 9 | `webhooks.ts:44-48` | `listWebhooks(userId?)` with `.eq("user_id", userId)` | User-scoped listing |
| 10 | `webhooks.ts:62-66` | `deleteWebhook(id, userId?)` with `.eq("user_id", userId)` | User-scoped deletion |
| 11 | `webhooks.ts` route L14, L24, L34 | `req.auth?.userId` passed to all webhook operations | Route-level propagation |
| 12 | `SettingsPanel.tsx:2` | Removed unused `getSupabase`, `clearStoredApiKey` imports | Clean imports |
| 13 | `SettingsPanel.tsx:28` | `authFetch` delegates to imported `apiFetch` | No duplicate code |
| 14 | `SettingsPanel.tsx:114` | `setStoredApiKey(res.data.key)` after key creation | Key auto-stored for subsequent requests |
| 15 | `SettingsPanel.tsx:128` | Delete URL: `/api/keys/${id}` → `/api/api-keys/${id}` | Delete now hits correct endpoint |
| 16 | `api.mts:47` | Edge `validateApiKey`: added `.or("expires_at.is.null,expires_at.gt.now()")` | Edge also checks expiry |
| 17 | `api.mts:161` | `X-PaperFlow-Signature` → `X-Futuraria-Signature` | Old name cleaned up |
| 18 | `api.mts:188` | Style ID prefix: `style_` → `sty_` | Matches Express + SQL schema |
| 19 | `api.mts:233` | Component ID prefix: `comp_` → `cmp_` | Matches Express + SQL schema |
| 20 | `supabase.ts (API):7` | Uses `SUPABASE_SERVICE_KEY` (fallback `SUPABASE_ANON_KEY`) | Works with RLS enabled |
| 21 | `renderer.ts:23-29` | Added `closeBrowser()` export for graceful shutdown | No more Puppeteer memory leak |
| 22 | `api-keys.ts:55-58` | Bootstrap keys set `user_id = null` (not `"bootstrap"` string) | No FK violation on first key creation |
| 23 | `api.mts:199-202` | Removed `if (userId) row.user_id = userId` from `createStyle` | Styles table has no user_id column (team-shared) |
| 24 | `api.mts:207-208` | Removed `userId` filtering from `listStyles` | Matches Express + SQL schema (styles are shared) |

#### Cross-Cutting Fixes

| Area | Before | After |
|------|--------|-------|
| **Auth header** | `"*** "` (silently broken) | `"Bearer "` (correct) |
| **Expired keys** | Never checked (valid forever) | Checked via `expires_at.is.null OR > now()` |
| **Orphan data** | All templates/webhooks had `user_id = NULL` | Populated on creation from auth context |
| **Webhook ownership** | All users saw all webhooks | Scoped by `user_id` |
| **RLS compatibility** | Express used `SUPABASE_ANON_KEY` (fails RLS) | Uses `SUPABASE_SERVICE_KEY` (bypasses RLS) |
| **ID prefixes (Edge)** | `style_`, `comp_` (mismatched Express `sty_`, `cmp_`) | Now unified: `sty_`, `cmp_` everywhere |
| **Frontend auth flow** | Key created but never stored | Key auto-stored via `setStoredApiKey`, delete URL correct |
| **Signature header** | `X-PaperFlow-Signature` (old name) | `X-Futuraria-Signature` |
| **Puppeteer** | Browser never closed (memory leak) | `closeBrowser()` available for graceful shutdown |

#### Known Remaining Issues (Non-Blocking)

| # | Issue | Severity | Notes |
|---|-------|----------|-------|
| 1 | `templateApi.ts` 6 localStorage functions | LOW | Dead code, never called. Safe to remove in cleanup pass. |
| 2 | `App.tsx` imports unused `getSupabase` | LOW | Frontend never connects to Supabase directly. Cosmetic. |
| 3 | `useAuth.ts:21` calls `getSupabaseClient()` (always null) | LOW | Auth is API-key based now, Supabase auth unused. |
| 4 | `useRealtime.ts:206` calls `getSupabase()` (always null) | LOW | Real-time disabled when no Supabase client. |

#### Manual Actions Required (Not Automatable)

| # | Action | Where | Why |
|---|--------|-------|-----|
| 1 | Create `design-exports` Storage bucket | Supabase Dashboard → Storage | Renderer uploads PNG/SVG to this bucket. Set as **public**. |
| 2 | Set `SUPABASE_SERVICE_KEY` env var | Railway (Express) + Netlify (Edge) | Both backends now use service key to bypass RLS. |
| 3 | Set `SUPABASE_URL` env var | Railway + Netlify | Required for Supabase client initialization. |
| 4 | Run verification queries | Supabase SQL Editor | See `supabase-schema.sql` §7 to verify tables, RLS, policies, FKs. |

#### Verification SQL (Run in Supabase SQL Editor)

```sql
-- 1. Confirm all 9 tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY table_name;
-- Expected: api_keys, comments, components, render_logs, styles,
--           template_versions, templates, variables, webhooks

-- 2. Confirm RLS is enabled on all tables
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public' ORDER BY tablename;
-- Expected: rowsecurity = true for all 9 tables

-- 3. Confirm all policies (34 total)
SELECT tablename, policyname, cmd FROM pg_policies
WHERE schemaname = 'public' ORDER BY tablename, cmd;
-- Expected: api_keys(4), comments(4), components(4), render_logs(2),
--           styles(4), template_versions(2), templates(4), variables(4), webhooks(3)

-- 4. Confirm FK cascade behavior
SELECT tc.table_name, rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.referential_constraints rc
  ON rc.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public';
-- Expected: all should show 'CASCADE' (or 'NO ACTION' is acceptable for auth.users refs)
```

---
