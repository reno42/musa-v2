# Futuraria Design API — AI Agent Skill

**Skill Name:** `futuraria-api`  
**Description:** Full REST API + MCP server for the Futuraria Design platform. Create, read, update, and delete workspaces, templates, frames, layers, styles, versions, comments, variables, components, and webhooks. Supports batch generation, CSS specs extraction, image upload, SVG path tools, boolean operations, alignment, distribution, auto-layout, and server-side rendering (PNG/JPG/SVG). Built on Express + Netlify Functions with Supabase dual-write persistence (freemium model: cloud DB when configured, in-memory fallback when not).  
**Triggers:** Any task involving the Futuraria API, template management, batch generation, design automation, MCP integration, or backend operations.

---

## Overview

You are an AI agent with full access to the Futuraria Design API and MCP server. The API lets you create workspaces, templates, frames, and manipulate design elements using 100% of the available canvas tools. The MCP server exposes the same capabilities via JSON-RPC for AI agent consumption.

**Cloud URL:** `https://futuraria.netlify.app/api`  
**Dev URL:** `http://localhost:3001/api`  
**Health:** `GET /api/health` → `{ "status": "ok", "timestamp": "..." }`  
**MCP Endpoint:** `https://futuraria.netlify.app/mcp` (SSE + JSON-RPC, 10 tools)  
**Auth:** Pass `X-API-Key: your-key` or `Authorization: Bearer your-token` header. Falls back to `dev_user_default` if no auth provided.  
**Rate Limit:** 100 requests per 15-second window (shared across all endpoints).  
**Persistence:** Supabase-primary dual-write with in-memory Map store fallback.  
**Response Format:** `{ "success": true|false, "data": ..., "error?": "message" }`

## Deployment Architecture

```
Browser / AI Agent
  │
  ▼
Netlify CDN
  ├── /api/*     → /.netlify/functions/api  (Express app → JSON)
  └── /mcp       → /.netlify/functions/mcp   (JSON-RPC + SSE)
         │
         ▼
Supabase (PostgreSQL)
  ├── workspaces (id, name, owner_id, data JSONB, created_at, updated_at)
  └── templates  (id, name, workspace_id, data JSONB, user_id, created_at, updated_at)
```

### Freemium Dual-Write Pattern

**All CRUD operations** on templates and workspaces follow this pattern:

```
READ:  Supabase.select() first → return if found → fall back to in-memory store
WRITE: in-memory store first → then Supabase.upsert() (non-blocking, catch+silent)
DELETE: in-memory store first → then Supabase.delete() (non-blocking, catch+silent)
```

**When Supabase env vars are set in Netlify:**
- Data persists across cold starts, redeploys, and container restarts
- Workspace and template CRUD is fully durable

**When Supabase is NOT configured (freemium/dev):**
- Data lives only in the in-memory Map store
- Survives the lifetime of the Netlify Function container
- Resets on cold start (acceptable for dev/testing)

The MCP server uses the **same service layer** (`templates.ts`, `store.ts`, `supabase.ts`) — identical dual-write behavior, no separate code path.

## Start the Server

```bash
# Local development (Express + in-memory store)
cd api && npm run dev                    # → http://localhost:3001/api

# Type-check only (no runtime)
cd api && npm run typecheck
```

## Quick Start: Create a Full Design

```bash
# Cloud (Netlify)
BASE="https://futuraria.netlify.app/api"

# Local dev
# BASE="http://localhost:3001/api"

# 1. Create a workspace
curl -X POST $BASE/workspaces \
  -H "Content-Type: application/json" \
  -d '{"name":"My Project","description":"Design system for landing page"}'
# → { "success": true, "data": { "id": "ws_abcd1234", ... } }
export WS="ws_abcd1234"

# 2. Create a template
curl -X POST $BASE/templates \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Hero Section\",\"width\":1440,\"height\":900,\"workspaceId\":\"$WS\"}"
# → { "success": true, "data": { "id": "tpl_xyz", ... } }
export TPL="tpl_xyz"

# 3. Create frames inside the template
curl -X POST $BASE/templates/$TPL/frames \
  -H "Content-Type: application/json" \
  -d '{"name":"Desktop","x":0,"y":0,"width":1440,"height":900}'
# → { "success": true, "data": { "id": "frame_...", ... } }
export FRAME="frame_..."

# 4. Draw shapes inside a frame
curl -X POST $BASE/templates/$TPL/tools/draw \
  -H "Content-Type: application/json" \
  -d "{\"tool\":\"rect\",\"x\":100,\"y\":50,\"width\":200,\"height\":60,\"fill\":\"#3B82F6\",\"layerName\":\"cta_bg\",\"frameId\":\"$FRAME\"}"

# 5. Add text
curl -X POST $BASE/templates/$TPL/tools/text \
  -H "Content-Type: application/json" \
  -d '{"text":"Get Started","x":130,"y":65,"fontSize":28,"fill":"#FFFFFF","layerName":"cta_text","frameId":"'$FRAME'"}'

# 6. Align
curl -X POST $BASE/templates/$TPL/tools/align \
  -H "Content-Type: application/json" \
  -d "{\"direction\":\"center-h\",\"targetLayerNames\":[\"cta_bg\",\"cta_text\"],\"frameId\":\"$FRAME\"}"

# 7. Render
curl -X POST $BASE/templates/$TPL/render \
  -H "Content-Type: application/json" \
  -d '{"format":"png","scale":2}'
```

## Complete Endpoint Reference

### Workspaces

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/workspaces` | Create workspace (store + Supabase) |
| `GET` | `/api/workspaces` | List your workspaces (Supabase-first) |
| `GET` | `/api/workspaces/:id` | Get workspace |
| `PUT` | `/api/workspaces/:id` | Update workspace (store + Supabase) |
| `DELETE` | `/api/workspaces/:id` | Delete workspace (cascades, store + Supabase) |
| `POST` | `/api/workspaces/:id/members` | Add member `{ userId }` (store + Supabase) |
| `GET` | `/api/workspaces/:id/templates` | List templates in workspace |

```json
// POST|PUT body
{ "name": "string", "description?": "string" }
// POST /members body
{ "userId": "string" }
```

### Templates

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/templates` | Create template (store + Supabase) |
| `GET` | `/api/templates?limit&offset&workspaceId` | List templates (Supabase-first) |
| `GET` | `/api/templates/:id` | Get template (Supabase-first) |
| `PUT` | `/api/templates/:id` | Update template (store + Supabase) |
| `DELETE` | `/api/templates/:id` | Delete template (store + Supabase) |
| `POST` | `/api/templates/:id/duplicate` | Duplicate template (store + Supabase) |
| `PATCH` | `/api/templates/:id/layers` | Batch layer override |
| `PATCH` | `/api/templates/:id/layers/:name` | Single layer override |
| `GET` | `/api/templates/:id/layers` | List layers |
| `GET` | `/api/templates/:id/layers/:name` | Get layer |

```json
// POST body
{ "name?": "string", "width?": 1080, "height?": 1080, "workspaceId": "string", "canvas?": {} }
// PUT body
{ "name?": "string", "canvas?": {}, "width?": 1080, "height?": 1080 }
// PATCH layer body — any property to override
{ "text": "new text", "fill": "#FF0000", "x": 100, "opacity": 0.8, ... }
```

### Frames

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/templates/:id/frames` | Create frame |
| `GET` | `/api/templates/:id/frames` | List frames |
| `GET` | `/api/templates/:id/frames/:frameId` | Get frame |
| `PUT` | `/api/templates/:id/frames/:frameId` | Update frame |
| `DELETE` | `/api/templates/:id/frames/:frameId` | Delete frame |

```json
// POST body
{ "name": "string", "x": 0, "y": 0, "width": 500, "height": 400, "fill?": "#ffffff" }
// PUT body (all optional)
{ "name?": "string", "x?": 0, "y?": 0, "width?": 500, "height?": 400, "fill?": "#fff", "opacity?": 0.5, "order?": 0 }
```

### Tools — 100% Coverage

All tool endpoints operate within a specific frame. Use `frameId` to target a frame, or omit to work on the canvas root.

#### Draw Shapes
`POST /api/templates/:id/tools/draw`

```json
{
  "tool": "rect|ellipse|line|triangle|star|polygon",
  "x": 0, "y": 0, "width": 100, "height": 100,
  "fill?": "#cccccc", "stroke?": "transparent", "strokeWidth?": 1,
  "layerName?": "myShape", "frameId?": "string"
}
```

#### Text
`POST /api/templates/:id/tools/text`

```json
{
  "text": "Hello World", "x": 0, "y": 0,
  "fontSize?": 24, "fontFamily?": "Inter", "fill?": "#000000",
  "layerName?": "myText", "frameId?": "string"
}
```

#### Image
`POST /api/templates/:id/tools/image`

```json
{
  "src": "https://example.com/image.png", "x": 0, "y": 0,
  "width?": 200, "height?": 200,
  "layerName?": "myImage", "frameId?": "string"
}
```

#### Boolean Operations
`POST /api/templates/:id/tools/boolean`

```json
{
  "operation": "union|subtract|intersect|exclude",
  "targetLayerNames": ["shape1", "shape2"],
  "frameId?": "string"
}
```

#### Align
`POST /api/templates/:id/tools/align`

```json
{
  "direction": "left|center-h|right|top|center-v|bottom",
  "targetLayerNames?": ["layer1", "layer2"],
  "frameId?": "string"
}
```

#### Distribute
`POST /api/templates/:id/tools/distribute`

```json
{
  "direction": "horizontal|vertical",
  "targetLayerNames?": ["layer1", "layer2", "layer3"],
  "frameId?": "string"
}
```

#### Transform
`POST /api/templates/:id/tools/transform`

```json
{
  "targetLayerName": "myLayer",
  "x?": 0, "y?": 0, "width?": 0, "height?": 0,
  "scaleX?": 1, "scaleY?": 1, "angle?": 0,
  "opacity?": 0.5, "visible?": true,
  "frameId?": "string"
}
```

#### Auto Layout
`POST /api/templates/:id/tools/auto-layout`

```json
{
  "targetLayerNames": ["a", "b", "c"],
  "direction?": "horizontal|vertical",
  "gap?": 16, "padding?": 16,
  "frameId?": "string"
}
```

### Render

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/templates/:id/render` | Start render job |
| `GET` | `/api/templates/:id/render/:renderId` | Poll render status |

```json
// POST body
{ "format?": "png|jpg|svg|json", "scale?": 2, "width?": 0, "height?": 0 }
```

### Webhooks

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/webhooks` | Register webhook |
| `GET` | `/api/webhooks` | List webhooks |
| `DELETE` | `/api/webhooks/:id` | Delete webhook |

```json
// POST body
{ "url": "https://hook.example.com", "events": ["template.created", "render.complete"], "secret?": "string" }
```

## MCP (Model Context Protocol) Server

The MCP server runs at `https://futuraria.netlify.app/mcp` and exposes the same template/workspace services via JSON-RPC for AI agents. Same auth, same dual-write, same rate limits.

**Protocol:** SSE init (GET) → JSON-RPC calls (POST)

### Available MCP Tools

| Tool | Description | Persistence |
|------|-------------|-------------|
| `list_workspaces` | List workspaces | Supabase-first |
| `create_workspace` | Create workspace | Store + Supabase upsert |
| `list_templates` | List templates (workspace filter, search, pagination) | Supabase-first |
| `get_template` | Full template with canvas, frames, styles | Supabase-first |
| `create_template` | Create template in a workspace | Store + Supabase upsert |
| `update_template` | Update name or canvas data | Store + Supabase upsert |
| `delete_template` | Permanently delete | Store + Supabase delete |
| `duplicate_template` | Independent copy | Store + Supabase upsert |
| `export_template` | Export as .futuraria JSON | Supabase read |
| `import_template` | Import .futuraria JSON into workspace | Store + Supabase upsert |

**Auth:** Pass `x-api-key` or `Authorization: Bearer <key>` header with POST requests.

### Example MCP Interaction

```bash
# 1. SSE init (GET)
curl https://futuraria.netlify.app/mcp
# → event: endpoint
# → data: /mcp

# 2. Initialize (POST)
curl -X POST https://futuraria.netlify.app/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}}}'

# 3. List tools (POST)
curl -X POST https://futuraria.netlify.app/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# 4. Call a tool (POST)
curl -X POST https://futuraria.netlify.app/mcp \
  -H "Content-Type: application/json" \
  -H "x-api-key: dev-key" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"create_template","arguments":{"name":"Hero","workspaceId":"ws_abc","width":1440,"height":900}}}'
```

## Agent Workflow Patterns

### Pattern 1: Create a social media post (multi-frame)
```
1. POST /workspaces → wsId
2. POST /templates (workspaceId) → tplId
3. POST /templates/tplId/frames × N (one per platform: Instagram, Twitter, LinkedIn)
4. For each frame: POST tools/draw + tools/text to build content
5. POST /templates/tplId/tools/align for layout
6. POST /templates/tplId/render for each frame
```

### Pattern 2: Batch content generation
```
1. POST /workspaces → wsId
2. POST /templates (workspaceId) → baseTplId
3. POST /templates/baseTplId/duplicate × N → tplIds[]
4. PATCH each template's layers with different content
5. POST render for each
```

### Pattern 3: Design system creation
```
1. POST /workspaces (name: "Design System")
2. POST /templates → colors Tpl, typography Tpl, components Tpl
3. POST tools/draw for each color swatch
4. POST tools/text for each typography sample
5. POST tools/auto-layout to organize components
```

## Batch Generation

Three batch modes for generating templates from CSV/JSON data:

```bash
# Post Único — one template type, one per CSV row
curl -X POST http://localhost:3001/api/templates/$TPL/batch/single-post \
  -H "Content-Type: application/json" \
  -d '{"data":[{"Name":"Post 1","Title":"Hello World"},{"Name":"Post 2","Title":"Futuraria"}]}'

# Multi Posts — different templates per row (Plantilla column)
curl -X POST http://localhost:3001/api/templates/$TPL/batch/multi-post \
  -H "Content-Type: application/json" \
  -d '{"data":[{"Plantilla":"Square Post","Title":"Hello"},{"Plantilla":"Story Template","Title":"Hi"}]}'

# Carruseles — grouped by ID_Carrusel, uses Plantilla_Slide
curl -X POST http://localhost:3001/api/templates/$TPL/batch/carousel \
  -H "Content-Type: application/json" \
  -d '{"data":[{"ID_Carrusel":"Car_A","Plantilla_Slide":"Slide A","Title":"Hello"},{"ID_Carrusel":"Car_A","Plantilla_Slide":"Slide B","Title":"World"}]}'
```

## CSS Specs Extraction

```bash
# Get CSS of all objects
curl http://localhost:3001/api/templates/$TPL/specs
# Returns { css: ".layer-rect { left: 100px; ... } ..." }

# Get JSON specs (flat design tokens)
curl "http://localhost:3001/api/templates/$TPL/specs?format=json"

# Extract from specific frame
curl "http://localhost:3001/api/templates/$TPL/specs?frameId=$FRAME"
```

## Style Management

```bash
# Create a style
curl -X POST http://localhost:3001/api/templates/$TPL/styles \
  -H "Content-Type: application/json" \
  -d '{"name":"Primary Fill","type":"fill","properties":{"fill":"#3B82F6"}}'

# List styles (supports ?search=)
curl "http://localhost:3001/api/templates/$TPL/styles?search=Primary"

# Apply style to layers
curl -X POST http://localhost:3001/api/templates/$TPL/styles/$STYLE/apply \
  -H "Content-Type: application/json" \
  -d '{"layerNames":["cta_bg","hero_bg"]}'
```

## Version History

```bash
# Create snapshot
curl -X POST http://localhost:3001/api/templates/$TPL/versions \
  -H "Content-Type: application/json" \
  -d '{"label":"Before batch generation"}'

# List versions (paginated: ?limit=&offset=)
curl http://localhost:3001/api/templates/$TPL/versions

# Restore version
curl -X POST http://localhost:3001/api/templates/$TPL/versions/$VER/restore
```

## Comments

```bash
# Add comment with canvas position
curl -X POST http://localhost:3001/api/templates/$TPL/comments \
  -H "Content-Type: application/json" \
  -d '{"text":"Make this bolder","x":100,"y":50}'

# List (filter: ?resolved=true|false)
curl http://localhost:3001/api/templates/$TPL/comments

# Toggle resolved
curl -X POST http://localhost:3001/api/templates/$TPL/comments/$CMT/resolve
```

## Variable Management

```bash
# Create collection
curl -X POST http://localhost:3001/api/templates/$TPL/variables/collections \
  -H "Content-Type: application/json" \
  -d '{"name":"Colors"}'

# Create variable
curl -X POST http://localhost:3001/api/templates/$TPL/variables \
  -H "Content-Type: application/json" \
  -d '{"collectionId":"col_...","name":"primary","value":"#3B82F6"}'

# List all
curl http://localhost:3001/api/templates/$TPL/variables
```

## Component System

```bash
# Create component from layers
curl -X POST http://localhost:3001/api/templates/$TPL/components \
  -H "Content-Type: application/json" \
  -d '{"name":"Button","layerNames":["btn_bg","btn_text"]}'

# Instantiate (place at x,y)
curl -X POST http://localhost:3001/api/templates/$TPL/components/$COMP/instantiate \
  -H "Content-Type: application/json" \
  -d '{"x":200,"y":100}'

# Update component (propagates to instances)
curl -X PUT http://localhost:3001/api/templates/$TPL/components/$COMP \
  -H "Content-Type: application/json" \
  -d '{"properties":{"fill":"#EF4444"}}'
```

## Image Upload (Base64)

```bash
curl -X POST http://localhost:3001/api/templates/$TPL/tools/upload \
  -H "Content-Type: application/json" \
  -d '{"base64":"iVBORw0KGgo...","name":"photo.png","x":10,"y":10,"width":400}'
```

## Template Export/Import

```bash
# Export as .futuraria JSON
curl http://localhost:3001/api/templates/$TPL/export

# Import .futuraria JSON
curl -X POST http://localhost:3001/api/templates/import \
  -H "Content-Type: application/json" \
  -d '{"format":"futuraria/v1","workspaceId":"ws_...","template":{"name":"Imported","canvas":{...}}}'
```

## Bulk Operations

```bash
# Delete multiple templates
curl -X POST http://localhost:3001/api/templates/bulk/delete \
  -H "Content-Type: application/json" \
  -d '{"ids":["tpl_1","tpl_2"]}'

# Delete multiple frames
curl -X POST http://localhost:3001/api/templates/$TPL/frames/bulk/delete \
  -H "Content-Type: application/json" \
  -d '{"ids":["frame_1","frame_2"]}'
```

## Search & Filter

Supports `?search=` on GET `/templates` and GET `/:id/styles`.
Supports `?workspaceId=` to filter templates by workspace.
Supports `?resolved=true|false` on GET `/:id/comments`.

## Additional Tool Endpoints

```bash
# Delete layers by name
curl -X POST http://localhost:3001/api/templates/$TPL/tools/delete \
  -H "Content-Type: application/json" \
  -d '{"layerNames":["rect_123","text_456"]}'

# Reorder (z-index: top, bottom, up, down)
curl -X POST http://localhost:3001/api/templates/$TPL/tools/reorder \
  -H "Content-Type: application/json" \
  -d '{"layerName":"rect_123","position":"top"}'

# Add SVG path
curl -X POST http://localhost:3001/api/templates/$TPL/tools/svg-path \
  -H "Content-Type: application/json" \
  -d '{"path":"M10 10 L50 10 L30 50 Z","fill":"#3B82F6"}'

# Group layers
curl -X POST http://localhost:3001/api/templates/$TPL/tools/group \
  -H "Content-Type: application/json" \
  -d '{"layerNames":["rect_a","rect_b"],"groupName":"myGroup"}'

# Ungroup
curl -X POST http://localhost:3001/api/templates/$TPL/tools/ungroup \
  -H "Content-Type: application/json" \
  -d '{"layerName":"myGroup"}'

# Copy
curl -X POST http://localhost:3001/api/templates/$TPL/tools/copy \
  -H "Content-Type: application/json" \
  -d '{"layerName":"rect_123"}'

# Duplicate (with offset)
curl -X POST http://localhost:3001/api/templates/$TPL/tools/duplicate \
  -H "Content-Type: application/json" \
  -d '{"layerName":"rect_123","offsetX":20,"offsetY":20}'
```

## Analytics

```bash
# Color palette extraction
curl http://localhost:3001/api/templates/$TPL/colors
# Returns { colors: [{ color: "#3B82F6", count: 5, usedBy: ["rect", "text-stroke"] }, ...] }

# Font listing
curl http://localhost:3001/api/templates/$TPL/fonts
# Returns { fonts: [{ family: "Inter", count: 12, sizes: [14,16,24], weights: ["400","600"] }, ...] }
```

## Response Format

All responses follow:
```json
{ "success": true|false, "data": ..., "error?": "message", "details?": {...} }
```

## Key Concepts

- **Workspace** contains templates (projects)
- **Template** has a canvas + frames (artboards) + styles
- **Frame** is a named region on the canvas (like Figma frames)
- **Layer** is any object (shape, text, image, group) on the canvas or inside a frame
- **frameId** parameter targets operations to a specific frame; omit for canvas root
- **layerName** is the unique identifier for finding/modifying objects
- **Dual-write**: All CRUD on templates/workspaces writes to in-memory store AND Supabase (when configured)
- **MCP**: Same service layer as REST API — AI agents use JSON-RPC, humans use REST, same persistence

## API Codebase Structure

```
api/src/
├── index.ts           — Express app factory (exported for Netlify bridge)
├── server.ts          — Local dev server entry (tsx watch)
├── routes/
│   ├── templates.ts   — Template CRUD routes (Supabase dual-write)
│   └── workspaces.ts  — Workspace CRUD routes (Supabase dual-write)
├── services/
│   ├── templates.ts   — Template service (listFromSupabase, upsertSupabase, etc.)
│   ├── store.ts       — In-memory Map store (fallback when Supabase unavailable)
│   └── supabase.ts    — Supabase admin client (service_role key)
├── middleware/
│   ├── auth.ts        — API key / Bearer token auth
│   ├── rateLimit.ts   — Rate limiting (lazy cleanup, no setInterval)
│   └── validation.ts  — Zod schemas for request validation
└── types.ts           — Shared TypeScript types
```

## Key Files

| File | Purpose |
|------|---------|
| `api/src/services/templates.ts` | Template CRUD with Supabase dual-write |
| `api/src/services/store.ts` | In-memory Map store (all entities) |
| `api/src/services/supabase.ts` | Supabase admin client (getSupabase) |
| `api/src/routes/workspaces.ts` | Workspace REST routes (dual-write) |
| `api/src/middleware/auth.ts` | Auth extraction (dev_user_default fallback) |
| `api/src/middleware/rateLimit.ts` | 100 req/15s rate limiter |
| `netlify/functions/api.mjs` | Express → Netlify Function bridge |
| `netlify/functions/mcp.mjs` | MCP server (SSE + JSON-RPC, 10 tools) |
| `netlify.toml` | Build config + /api/* → /mcp → /* redirects |
