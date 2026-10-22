# Futuraria Design API — AI Agent Skill

**Skill Name:** `futuraria-api`
**Description:** Full REST API + MCP server for the Futuraria Design platform. Create, read, update, and delete workspaces, templates, frames, layers, styles, versions, comments, variables, components, and webhooks. Supports batch generation, CSS specs extraction, image upload, SVG path tools, boolean operations, alignment, distribution, auto-layout, and server-side rendering (PNG/JPG/SVG). Built on Express + Cloudflare Worker handlers with Supabase dual-write persistence (freemium model: cloud DB when configured, in-memory fallback when not).
**Triggers:** Any task involving the Futuraria API, template management, batch generation, design automation, MCP integration, or backend operations.

---

## Overview

You are an AI agent with full access to the Futuraria Design API and MCP server. The API lets you create workspaces, templates, frames, and manipulate design elements using 100% of the available canvas tools. The MCP server exposes the same capabilities via JSON-RPC for AI agent consumption.

**Prod URL:** `https://design.futuraria.com/api`
**Dev URL:** `http://localhost:3001/api`
**Health:** `GET /api/health` → `{ "status": "ok", "timestamp": "..." }`
**MCP Endpoint:** `https://design.futuraria.com/mcp` (SSE + JSON-RPC)
**Editor (v2 HTML engine):** `https://design.futuraria.com`

> ⚠️ El dominio oficial es `design.futuraria.com`. El subdominio anterior `bejewelled-llama` fue reemplazado por el custom domain.
**Auth:** Pass `X-API-Key: your-key` or `Authorization: Bearer your-token` header. Falls back to `dev_user_default` if no auth provided.
**Rate Limit:** 100 requests per 15-second window (shared across all endpoints).
**Persistence:** Supabase-primary dual-write with in-memory Map store fallback.
**Response Format:** `{ "success": true|false, "data": ..., "error?": "message" }`

## 🧠 Agent Operational Guide (CRITICAL — READ FIRST)

### CSS: Always Inline Per Frame

**The editor v2 does NOT read global CSS set via `set_css`.** Even though `set_css` returns `success: true`, the CSS is stored separately and the editor only reads per-frame `css` fields.

```powershell
# WRONG — editor won't show CSS
set_css(templateId, css=$fullCSS)
create_html_frame(templateId, name="Slide", html=$html)  # css="" → invisible frame

# CORRECT — CSS inline in every frame
create_html_frame(templateId, name="Slide", html=$html, css=$fullCSS)
```

**Always include `css` in every `create_html_frame` or `update_html_frame` call.** Test frames showed `css: 0` → blank in editor.

### Design System: NewForm

Reference files for LinkedIn carousel designs:
- **DESIGN.md:** `C:\Users\Renzo\.openclaw\workspace\DESIGN.md` (full brand tokens)
- **CSS template:** `C:\Users\Renzo\.openclaw\workspace\exports\adisruptive-15x\` (working ADISruptive HTML/CSS)
- **Fonts:** Playfair Display (headings) + Inter (UI/body), Google Fonts import
- **Colors:** `#fafffa` (linen bg), `#121613` (obsidian text), `#2bee4b` (voltage accent), `#516254` (sage muted), `#c8d2c8` (mist borders)
- **Theme:** Light. No dark backgrounds. No second saturated color.

### LinkedIn Format

- **Portrait/vertical:** 1080×1350 (use this for carousels)
- **Square:** 1080×1080 (deprecated for carousels)
- Create template with `engine="html"`, `width=1080`, `height=1350`

### Building Slides

1. Write complete HTML file locally with all slides (each as `<div class="slide">`)
2. Build each slide's HTML individually in PowerShell here-strings (`@'...'@`) — do NOT regex-extract from the HTML file (extraction corrupts nested divs)
3. Send each slide as a separate `create_html_frame` with `css=$fullCSS`
4. Verify with `get_html_frames` — check every frame has `html` AND `css` with proper lengths
5. Render locally with **Playwright** (`element.screenshot()` per slide), NOT Puppeteer

### Unicode in JSON from PowerShell

`ConvertTo-Json` preserves Unicode. Corruption happens when Windows PowerShell sends the resulting
string to a native process using a legacy code page. Send explicit UTF-8 bytes and declare the
charset; do not replace Spanish text or emoji with HTML entities:

```powershell
$json = $payload | ConvertTo-Json -Depth 100 -Compress
$utf8Body = [System.Text.Encoding]::UTF8.GetBytes($json)
Invoke-RestMethod -Uri $url -Method Post -ContentType 'application/json; charset=utf-8' -Body $utf8Body
```

### Workflow Checklist

```
1. create_workspace(name="...")
2. create_html_template(name="...", workspaceId=$ws, width=1080, height=1350, engine="html")
3. For each slide: create_html_frame(templateId=$tpl, name="NN - Title", html=$slideHtml, css=$fullCSS, width=1080, height=1350, background="#fafffa")
4. get_html_frames(templateId=$tpl) → verify html + css lengths
5. Local render: Playwright element.screenshot() per slide
```

## Deployment Architecture

```
Browser / AI Agent
  │
  ▼
Cloudflare Workers
  ├── /api/*     → /.worker/runtime/functions/api  (Express app → JSON)
  └── /mcp       → /.worker/runtime/functions/mcp   (JSON-RPC + SSE)
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

**When Supabase env vars are set in Cloudflare Workers:**
- Data persists across cold starts, redeploys, and container restarts
- Workspace and template CRUD is fully durable

**When Supabase is NOT configured (freemium/dev):**
- Data lives only in the in-memory Map store
- Survives the lifetime of the Cloudflare Workers Function container
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
# Cloud (Cloudflare Workers)
BASE="https://futuraria.cloudflare.app/api"

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

## MCP (Model Context Protocol) Server — AI Agent Integration

The MCP server runs at `https://futuraria.cloudflare.app/mcp` and exposes the same template/workspace services via JSON-RPC 2.0 for AI agents. **100% tested** — all tools + error cases pass. Same auth, same dual-write, same rate limits.

**Protocol:** MCP 2024-11-05 via SSE transport (GET) + JSON-RPC 2.0 calls (POST).
**Implementation:** `worker/runtime/functions/mcp.mjs` (~7500 lines) — standalone Cloudflare Workers Function, no Express dependency.

### Connecting AI Agents

**Claude Desktop** — add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "futuraria": {
      "type": "sse",
      "url": "https://futuraria.cloudflare.app/mcp",
      "headers": { "x-api-key": "your-api-key" }
    }
  }
}
```

**Cursor** — add to `.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "futuraria": {
      "transport": "sse",
      "url": "https://futuraria.cloudflare.app/mcp",
      "headers": { "x-api-key": "your-api-key" }
    }
  }
}
```

**Any MCP-compatible agent** (Windsurf, Continue.dev, Cody, etc.) — use SSE transport pointing to `/mcp` with `x-api-key` header.

### Protocol Lifecycle

```
1. GET  /mcp                                      → SSE handshake
2. POST /mcp  { method: "initialize" }             → capabilities exchange
3. POST /mcp  { method: "notifications/initialized" } → confirm ready
4. POST /mcp  { method: "tools/list" }             → discover 268 tools
5. POST /mcp  { method: "tools/call", params: {...} } → invoke any tool
```

### Complete Tool Reference

#### Workspace & Template Core

| # | Tool | Required | Optional | Persistence |
|---|------|----------|----------|-------------|
| 1 | `list_workspaces` | — | — | Supabase → store |
| 2 | `create_workspace` | `name` | `description` | store → Supabase upsert |
| 3 | `list_templates` | — | `workspaceId`, `search`, `limit`, `offset` | Supabase + store merged |
| 4 | `get_template` | `id` | — | Supabase → store fallback |
| 5 | `create_template` | `name`, `workspaceId` ⚠️ | `width`, `height`, `engine`, `html`, `css` | store → Supabase upsert |
| 6 | `update_template` | `id` | `name`, `canvas`, `objects`, `engine`, `html`, `css`, `frames` | store → Supabase upsert |
| 7 | `delete_template` | `id` | — | store + Supabase delete |
| 8 | `duplicate_template` | `id` | `name` | store → Supabase upsert |
| 9 | `export_template` | `id` | — | Supabase read |
| 10 | `import_template` | `data`, `workspaceId` | — | store → Supabase upsert |
| 11 | `rename_template` | `templateId`, `newName` | — | store → Supabase upsert |

#### HTML Frame Operations

| # | Tool | Required | Optional | Persistence |
|---|------|----------|----------|-------------|
| 12 | `create_html_frame` | `templateId`, `name` | `width`, `height`, `html`, `css`, `background`, `x`, `y` | Persist via updateTemplate |
| 13 | `update_html_frame` | `templateId`, `frameId` | `name`, `html`, `css`, `width`, `height`, `x`, `y`, `background` | Persist via updateTemplate |
| 14 | `delete_html_frame` | `templateId`, `frameId` | — | Persist via updateTemplate |
| 15 | `get_html_frames` | `templateId` | — | Read-only |
| 16 | `update_frame_content` | `templateId`, `frameId` | `html`, `css` | Persist via updateTemplate |

#### HTML/CSS DOM Manipulation

| # | Tool | Required | Optional | Persistence |
|---|------|----------|----------|-------------|
| 17 | `set_html` | `templateId`, `html` | — | Persist via updateTemplate |
| 18 | `set_css` | `templateId`, `css` | — | Persist via updateTemplate |
| 19 | `add_element` | `templateId`, `tag`, `parentSelector` | `html`, `css`, `position`, `frameId` | Persist via updateTemplate |
| 20 | `update_element` | `templateId`, `elementId` | `html`, `css`, `attributes` | Persist via updateTemplate |
| 21 | `remove_element` | `templateId`, `elementId` | — | Persist via updateTemplate |
| 22 | `get_template_structure` | `templateId` | — | Read-only |
| 23 | `select_element` | `templateId`, `elementId` | — | Read-only |
| 24 | `reorder_element` | `templateId`, `elementId`, `newIndex` | — | Persist via updateTemplate |

#### Drawing & Vector Tools

| # | Tool | Required | Optional | Persistence |
|---|------|----------|----------|-------------|
| 25 | `draw_shape` | `templateId`, `frameId`, `tool` | `x`, `y`, `width`, `height`, `fill`, `stroke`, `layerName` | store → Supabase upsert |
| 26 | `draw_path` | `templateId`, `frameId`, `pathData` | `fill`, `stroke`, `strokeWidth`, `layerName` | store → Supabase upsert |
| 27 | `draw_bezier` | `templateId`, `frameId`, `points` | `fill`, `stroke`, `layerName`, `closed` | store → Supabase upsert |
| 28 | `edit_path_points` | `templateId`, `frameId`, `layerId`, `points` | — | store → Supabase upsert |
| 29 | `edit_path_point` | `templateId`, `frameId`, `layerId`, `pointIndex`, `x`, `y` | `handleIn`, `handleOut` | store → Supabase upsert |
| 30 | `transform_element` | `templateId`, `frameId`, `layerId` | `x`, `y`, `width`, `height`, `scaleX`, `scaleY`, `angle`, `opacity` | store → Supabase upsert |
| 31 | `group_elements` | `templateId`, `frameId`, `layerIds` | `groupName` | store → Supabase upsert |
| 32 | `align_elements` | `templateId`, `frameId`, `layerIds`, `direction` | — | store → Supabase upsert |

#### SVG & Path Operations

| # | Tool | Required | Optional | Persistence |
|---|------|----------|----------|-------------|
| 33 | `import_svg` | `templateId`, `frameId`, `svg` | `x`, `y`, `width`, `height` | store → Supabase upsert |
| 34 | `pathfinder` | `templateId`, `frameId`, `operation`, `layerIds` | — | store → Supabase upsert |
| 35 | `shape_to_path` | `templateId`, `frameId`, `elementId` | — | store → Supabase upsert |

#### SVG Styling

| # | Tool | Required | Optional | Persistence |
|---|------|----------|----------|-------------|
| 36 | `set_stroke_style` | `templateId`, `frameId`, `layerId` | `stroke`, `strokeWidth`, `strokeLinecap`, `strokeLinejoin`, `strokeDasharray` | store → Supabase upsert |
| 37 | `set_gradient` | `templateId`, `frameId`, `layerId`, `type` | `angle`, `stops`, `colors` | store → Supabase upsert |
| 38 | `set_blend_mode` | `templateId`, `frameId`, `layerId`, `mode` | — | store → Supabase upsert |
| 39 | `set_pattern_fill` | `templateId`, `frameId`, `layerId`, `pattern` | `color`, `backgroundColor`, `size`, `angle` | store → Supabase upsert |
| 40 | `outline_stroke` | `templateId`, `frameId`, `layerId` | `strokeWidth`, `fillColor` | store → Supabase upsert |
| 41 | `offset_path` | `templateId`, `frameId`, `layerId`, `offset` | — | store → Supabase upsert |

#### AI Generation

| # | Tool | Required | Optional | Persistence |
|---|------|----------|----------|-------------|
| 41 | `ai_generate_text` | `templateId`, `prompt` | `style`, `tone`, `maxLength` | Read-only |
| 42 | `ai_generate_image` | `prompt` | `imageBase64`, `model`, `aspectRatio`, `geminiApiKey` | Read-only (returns data URI) |
| 43 | `ai_palette` | `templateId`, `prompt` | `count` | Read-only |
| 44 | `ai_suggest_layout` | `templateId`, `prompt` | `format` | Read-only |
| 45 | `separate_image_layers` | `imageUrl` | `prompt`, `resolution`, `promptOptimizationMode`, `wavespeedApiKey` | Async → `predictionId` (poll with 46) |
| 46 | `separate_image_layers_check` | `predictionId` | `wavespeedApiKey` | Free poll → `outputs[]` + `layers[]` (con `boundingBox` para reconstruir posiciones exactas) |

#### Brand & Governance

| # | Tool | Required | Optional | Persistence |
|---|------|----------|----------|-------------|
| 45 | `register_brand` | `brandId`, `name`, `colors`, `fonts` | `logo`, `spacing`, `rules` | Supabase |
| 46 | `validate_brand` | `templateId`, `brandId` | — | Read-only |
| 47 | `check_contrast` | `templateId` | — | Read-only |
| 48 | `auto_fix_brand` | `templateId`, `brandId` | `autoFix` | store → Supabase upsert |

#### Variables & Design Tokens

| # | Tool | Required | Optional | Persistence |
|---|------|----------|----------|-------------|
| 49 | `create_variable` | `templateId`, `name`, `value` | `collectionId` | store → Supabase upsert |
| 50 | `create_collection` | `templateId`, `name` | — | store → Supabase upsert |
| 51 | `link_variable` | `templateId`, `variableId`, `targetSelector`, `property` | — | store → Supabase upsert |
| 52 | `apply_variables` | `templateId` | `variables` | store → Supabase upsert |

#### Version, Fonts, Batch & Collaboration

| # | Tool | Required | Optional | Persistence |
|---|------|----------|----------|-------------|
| 53 | `list_versions` | `templateId` | `limit`, `offset` | Supabase read |
| 54 | `restore_version` | `templateId`, `versionId` | — | store → Supabase upsert |
| 55 | `search_google_fonts` | `query` | `limit`, `category` | Read-only |
| 56 | `add_font_to_template` | `templateId`, `family` | `weights` | store → Supabase upsert |
| 57 | `batch_update` | `templateId`, `updates` | — | store → Supabase upsert |
| 58 | `render_batch` | `templateId` | `format`, `scale`, `frameIds` | Read-only |
| 59 | `batch_create_variants` | `templateId`, `variables` | `prefix`, `startIndex` | store → Supabase upsert |
| 60 | `batch_render_html` | `batchId` | `format`, `scale` | Read-only |
| 61 | `share_template` | `templateId`, `userId` | `role` | Supabase |
| 62 | `claim_section` | `templateId`, `sectionId`, `agentId` | `ttlSeconds` | Supabase |
| 63 | `get_active_agents` | `templateId` | — | Supabase read |
| 64 | `broadcast_section_change` | `channelId`, `sectionId`, `html`, `css`, `agentId` | — | Supabase Realtime |
| 65 | `font_list_custom` | — | — | Supabase read |
| 66 | `font_upload_custom` | `fileName`, `dataBase64` | — | Supabase + Storage |
| 67 | `font_delete_custom` | `fontId` | — | Supabase + Storage |
| 68 | `font_usage_custom` | — | — | Supabase read |

#### Render & Visual Verification (REQ-032)

| # | Tool | Required | Optional | Persistence |
|---|------|----------|----------|-------------|
| 69 | `render_frame_png` | `templateId`, `frameId` | `scale`, `workspaceId`, `includeBase64` | Read-only (returns captureUrl; the page rasterizes and uploads the PNG via `upload_image`) |
| 70 | `text_metrics` | `text`, `fontSize` | `fontUrl`, `fontFamily`, `letterSpacing`, `boxWidth`, `boxHeight`, `lineHeight` | Read-only — medición en creación; PROHIBIDO autofit en runtime |
| 71 | `diff_overlay` | `templateId`, `frameId`, `referenceUrl` | `referenceBase64`, `mode`, `threshold`, `scale`, `workspaceId` | Read-only (returns diffUrl; the page computes the block diff and uploads the composite) |

> ⚠️ `create_template` **validates** `workspaceId` — missing returns `-32602` (enforced in mcp.mjs).

### JSON-RPC Error Codes

| Code | Meaning | Example |
|------|---------|---------|
| `-32700` | Parse error | Invalid JSON body |
| `-32600` | Invalid Request | Not JSON-RPC 2.0 |
| `-32601` | Method not found | Unknown tool name |
| `-32602` | Invalid params | Missing required field, bad format |
| `-32000` | Server error | Template/workspace not found |

### Example MCP Calls

```bash
BASE="https://futuraria.cloudflare.app/mcp"

# Initialize
curl -s -X POST $BASE -H "Content-Type: application/json" -H "x-api-key: dev-key" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"my-agent","version":"1.0"}}}'
# → {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"futuraria-mcp","version":"1.0.0"}}}

# List tools
curl -s -X POST $BASE -H "Content-Type: application/json" -H "x-api-key: dev-key" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
# → {"jsonrpc":"2.0","id":2,"result":{"tools":[{...268 tools...}]}}

# Create workspace
curl -s -X POST $BASE -H "Content-Type: application/json" -H "x-api-key: dev-key" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"create_workspace","arguments":{"name":"Brand Guidelines"}}}'

# Create template in workspace
curl -s -X POST $BASE -H "Content-Type: application/json" -H "x-api-key: dev-key" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"create_template","arguments":{"name":"Logo Design","workspaceId":"ws_abc123","width":1200,"height":1200}}}'

# Update canvas with Fabric.js objects
curl -s -X POST $BASE -H "Content-Type: application/json" -H "x-api-key: dev-key" \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"update_template","arguments":{"id":"tpl_xyz","objects":[{"type":"rect","left":100,"top":50,"width":200,"height":100,"fill":"#3B82F6","layerName":"badge"}]}}}'

# Export for backup
curl -s -X POST $BASE -H "Content-Type: application/json" -H "x-api-key: dev-key" \
  -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"export_template","arguments":{"id":"tpl_xyz"}}}'
```

**Auth:** Pass `x-api-key` or `Authorization: Bearer <key>` header with POST requests. Falls back to `dev_user_default`.

### MCP Code Architecture

The MCP function (`worker/runtime/functions/mcp.mjs`) imports directly from the API service layer:
```js
import * as templates from "../../api/src/services/templates.js";
import { store } from "../../api/src/services/store.js";
import { getSupabase } from "../../api/src/services/supabase.js";
```

MCP tools share the **exact same persistence logic** as the REST API:
- `list_templates` merges Supabase + in-memory store, deduping by ID (store takes precedence)
- `update_template` accepts `id` or `templateId`, `canvas` (object) or `objects` (raw array auto-wrapped)
- `import_template` validates `data.format === "futuraria/v1"` and `data.template.name` required
- All errors return proper JSON-RPC 2.0 error codes (`-32602`, `-32000`, `-32601`)

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

## Photos (REQ-32 — Modo Foto)

Modelo Lightroom: la foto original NUNCA se toca. Un documento de revelado por (workspace, source_url); cada edición es una RECETA JSON versionada (inmutable, solo INSERT); la metadata tipo Library (rating/flag/colorLabel/keywords) vive por asset. Migración: `supabase_migrations_v59.sql` (`photo_documents`, `photo_versions`, `photo_catalog_items`). Mismo modelo y mismas primitivas puras (`shared/photoRecipe.ts`) para REST, MCP y la UI — una acción UI y su tool MCP producen el mismo resultado.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/photos/documents` | Upsert documento `{ workspaceId, sourceUrl, sourceAssetId?, recipe?, label?, mode? }` (+ primera versión si es nuevo) |
| `GET` | `/api/photos/documents?workspaceId&sourceUrl` | Documento + historial de versiones (≤50 desc) |
| `POST` | `/api/photos/documents/:id/versions` | Nueva versión de receta `{ recipe, label?, parentVersionId? }` |
| `POST` | `/api/photos/documents/:id/restore` | Restaurar `{ versionId }` — solo mueve `active_version_id` |
| `GET` | `/api/photos/catalog?workspaceId` | Metadata Library del workspace (≤200) |
| `PUT` | `/api/photos/catalog` | Rating/flag/colorLabel/keywords `{ workspaceId, assetId, sourceUrl?, ... }` |
| `GET` | `/api/photos/composition?workspaceId&sourceUrl` | Stack de capas de la composición (viewer; sin composición → `composition: null`) |
| `PUT` | `/api/photos/composition` | Upsert stack completo `{ workspaceId, sourceUrl, layers[] }` (editor; ≤12 capas, dataUrl ≤3MB c/u, total ≤8MB) |

Familia MCP `photo_*` (11 tools sobre el MISMO modelo; read-only: `photo_list_assets`, `photo_open_session`, `photo_compare_versions`):

```bash
# Inventario de fotos del diseño (frames + huérfanas), con documento y metadata
curl -s -X POST $BASE/mcp -H "Content-Type: application/json" -H "x-api-key: dev-key" \
  -d '{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"photo_list_assets","arguments":{"templateId":"tpl_xyz"}}}'

# Aplicar un ajuste (crea versión nueva; historial inmutable)
curl -s -X POST $BASE/mcp -H "Content-Type: application/json" -H "x-api-key: dev-key" \
  -d '{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"photo_apply_operation","arguments":{"templateId":"tpl_xyz","layerId":"img_1","type":"basic","params":{"exposure":20,"contrast":10}}}}'
```

> Las ediciones pesadas (render/export server-side, batch, RAW/PSD, ops IA) requieren CF Queues/Containers (fuera del freemium): declaradas, NO simuladas.

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

## HTML Engine — Code-Based Design

The HTML engine (`engine: "html"`) lets AI agents create designs using HTML/CSS code instead of Fabric.js objects. Each template has multiple **frames** (like papers on a desk), each with its own HTML/CSS content.

### Creating an HTML Template

```bash
# Via MCP: create an HTML engine template
curl -s -X POST $BASE -H "Content-Type: application/json" -H "x-api-key: dev-key" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_template","arguments":{"name":"Instagram Carousel","workspaceId":"ws_abc","width":1080,"height":1080,"engine":"html","html":"<div class=\"card\"><h1>Slide 1</h1></div>","css":".card { font-family: Inter; text-align: center; padding: 40px; }"}}}'
```

### HTML Frame Tools

| # | Tool | Required | Optional |
|---|------|----------|----------|
| 1 | `create_html_frame` | `templateId`, `name` | `width`, `height`, `html`, `css`, `background`, `x`, `y` |
| 2 | `update_html_frame` | `templateId`, `frameId` | `name`, `html`, `css`, `width`, `height`, `x`, `y`, `background` |
| 3 | `delete_html_frame` | `templateId`, `frameId` | — |
| 4 | `get_html_frames` | `templateId` | — |

### Agent Workflow: Instagram Carousel (5 slides)

```
1. create_workspace → wsId
2. create_template (engine='html', name='Carousel', workspaceId=wsId, width=1080, height=1080) → tplId
3. update_html_frame (templateId, frameId=defaultFrame, html='<slide 1>', css='...')
4. create_html_frame × 4 more (name='Slide 2-5', width=1080, height=1080, html='...', css='...')
5. get_html_frames → verify all 5 frames exist
```

### Frame Data Model

Each HTML frame contains:
```json
{
  "id": "frame_abc123",
  "name": "IG Square",
  "x": 0, "y": 0,
  "width": 1080, "height": 1080,
  "html": "<div class='card'><h1>Hello</h1></div>",
  "css": "body { font-family: Inter; } .card { text-align: center; }",
  "background": "#ffffff"
}
```

### Frame Presets (common dimensions)

| Name | Width | Height | Use Case |
|------|-------|--------|----------|
| IG Square | 1080 | 1080 | Instagram square post |
| IG Story | 1080 | 1920 | Instagram/Reels story |
| IG Feed | 1080 | 1350 | Instagram portrait post |
| Banner | 1920 | 1080 | Web banner / hero |
| Twitter | 1200 | 628 | Twitter/X card |

## API Codebase Structure

```
api/src/
├── index.ts           — Express app factory (exported for Cloudflare Workers bridge)
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
| `worker/runtime/functions/api.mjs` | Express → Cloudflare Workers Function bridge |
| `worker/runtime/functions/mcp.mjs` | MCP server (SSE + JSON-RPC, 268 tools) |
| `cloudflare.toml` | Build config + /api/* → /mcp → /* redirects |
