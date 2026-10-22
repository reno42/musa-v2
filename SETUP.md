# Futuraria Design Harness — Setup Guide for AI Agents

**Target audience:** Any developer with Claude Code, Openclaw, Hermes, or any AI coding assistant.

**Time to first run:** ~5 minutes without Supabase, ~15 minutes with Supabase.

---

## What is this?

A full WYSIWYG design editor — React + TypeScript + Vite frontend, Express API backend, deployed on Cloudflare Workers with Supabase persistence. Supports Fabric.js canvas AND HTML/CSS infinite canvas (dual-engine). Exposes MCP tools for AI agents to create, edit, and export designs programmatically.

---

## Quick Start (5 min — no Supabase)

```bash
# 1. Clone
git clone https://github.com/reno42/design.git
cd design

# 2. Install frontend
npm install

# 3. Start dev server
npm run dev
# → http://localhost:5173
```

That's it. The editor works fully without Supabase — uses in-memory storage (resets on restart). Skip to "AI Agent Connection" below.

---

## Full Setup (15 min — with Supabase persistence)

### Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| Node.js | ≥18 | `node -v` |
| npm | ≥9 | `npm -v` |
| Git | any | `git --version` |
| Wrangler | project-pinned | `npx wrangler whoami` (deploy only) |
| Supabase account | free tier | [supabase.com](https://supabase.com) (persistence only) |

### 1. Clone & install

```bash
git clone https://github.com/reno42/design.git
cd design
npm install              # Frontend (Vite + React)
cd api && npm install    # Backend (Express API)
cd ..
```

### 2. Environment variables

Copy `.env.example` to `.env` and fill in your Supabase credentials:

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Supabase (https://app.supabase.com → Project Settings → API)
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...          # backend only
SUPABASE_PUBLISHABLE_KEY=sb_publishable_... # browser-safe login key
```

> **Without Supabase:** The app uses in-memory storage. Works perfectly for development. Data lost on restart.

### 3. Database setup (Supabase SQL Editor)

Run this in your Supabase SQL Editor:

```sql
-- workspaces table
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT,
  member_ids TEXT[] DEFAULT '{}',
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- templates table
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID,
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 4. Run full stack locally

```bash
# Terminal 1: API server
cd api && npm run dev
# → http://localhost:3001

# Terminal 2: Frontend
npm run dev
# → http://localhost:5173
```

### 5. Test MCP endpoint

```bash
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

---

## Deploying to Cloudflare Workers

The production service is a Cloudflare Worker with static assets and the API in the same runtime.

```bash
# Authenticate once (or set CLOUDFLARE_API_TOKEN in your shell)
npx wrangler login

# Set server-only values without adding them to source control
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SECRET_KEY
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY

# Build the SPA and publish the Worker. --keep-vars preserves dashboard variables.
npm run deploy:cloudflare
```

### Production URLs

| Resource | URL |
|----------|-----|
| App | `https://design.futuraria.com` |
| API | `https://design.futuraria.com/api/*` |
| MCP | `https://design.futuraria.com/mcp` |

---

## Connecting AI Agents

### Claude Code / Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "futuraria": {
      "type": "sse",
      "url": "https://design.futuraria.com/mcp",
      "headers": { "x-api-key": "dev-key" }
    }
  }
}
```

### Openclaw

In Openclaw's MCP settings, add:

```yaml
mcp_servers:
  futuraria:
    transport: sse
    url: https://design.futuraria.com/mcp
    headers:
      x-api-key: dev-key
```

### Hermes / Custom agent

Use the JSON-RPC 2.0 protocol over HTTP POST:

```bash
# 1. Initialize session
curl -X POST https://design.futuraria.com/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"my-agent","version":"1.0"}}}'

# 2. List tools
curl -X POST https://design.futuraria.com/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# 3. Call a tool
curl -X POST https://design.futuraria.com/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"create_workspace","arguments":{"name":"My Project"}}}'
```

---

## MCP Tools Reference (full catalog)

### Workspace & Template Management

| Tool | Required | Description |
|------|----------|-------------|
| `list_workspaces` | — | List all workspaces |
| `create_workspace` | `name` | Create workspace |
| `list_templates` | — | List templates (optional: `workspaceId`, `search`, `limit`, `offset`) |
| `get_template` | `id` | Get full template data |
| `create_template` | `name`, `workspaceId` | Create template (optional: `width`, `height`, `engine`) |
| `update_template` | `id` | Update name/canvas/HTML/CSS/frames |
| `delete_template` | `id` | Delete template |
| `duplicate_template` | `id` | Clone template |
| `export_template` | `id` | Export as `.futuraria.json` |
| `import_template` | `data`, `workspaceId` | Import from `.futuraria.json` |
| `batch_update` | `templateId`, `updates[]` | Batch apply changes |

### HTML Engine — Elements

| Tool | Required | Description |
|------|----------|-------------|
| `add_element` | `templateId`, `frameId`, `tag` | Add HTML element to frame |
| `add_primitive` | `templateId`, `frameId`, `type` | Add rect / circle / text |
| `change_element_tag` | `templateId`, `elementId`, `newTag` | Change semantic tag |
| `remove_element` | `templateId`, `elementId` | Delete element |
| `reorder_element` | `templateId`, `elementId`, `position` | Move element in DOM |

### HTML Engine — Drawing Tools (Phase C)

| Tool | Required | Description |
|------|----------|-------------|
| `draw_shape` | `templateId`, `frameId`, `type`, `x`, `y`, `width`, `height` | Draw rect/circle with exact dimensions |
| `draw_path` | `templateId`, `frameId`, `pathData`, `x`, `y`, `width`, `height` | Create SVG path |
| `transform_element` | `templateId`, `frameId`, `elementId` | Resize/reposition element |
| `group_elements` | `templateId`, `frameId`, `elementIds[]` | Group elements in wrapper |
| `align_elements` | `templateId`, `frameId`, `elementIds[]`, `align` | Align (left/center/right/top/middle/bottom) |

### Fabric.js Engine

| Tool | Required | Description |
|------|----------|-------------|
| `transform_object` | `templateId`, `objectId` | Transform Fabric.js object |
| `render_batch` | `templateId`, `variations[]` | Batch render with CSV data |

### Frames

| Tool | Required | Description |
|------|----------|-------------|
| `add_html_frame` | `templateId`, `width`, `height` | Add HTML frame |
| `update_html_frame` | `templateId`, `frameId` | Update frame properties |
| `delete_html_frame` | `templateId`, `frameId` | Delete frame |
| `get_html_frames` | `templateId` | List all frames |
| `render_frame` | `templateId`, `frameId` | Render frame to PNG |

### Variables & Styles

| Tool | Required | Description |
|------|----------|-------------|
| `set_css_variable` | `templateId`, `name`, `value` | Set CSS custom property |
| `analyze_template_structure` | `templateId` | Extract layout/colors/typography |
| `extract_variables` | `templateId` | Extract replaceable content |
| `apply_recipe` | `templateId`, `recipeId` | Apply design recipe |
| `comment_template` | `templateId`, `comment` | Add comment |

### Version History

| Tool | Required | Description |
|------|----------|-------------|
| `list_versions` | `templateId` | List version history |
| `restore_version` | `templateId`, `versionId` | Restore to version |

---

## Common AI Agent Workflows

### Workflow 1: Create a design from scratch

```
1. create_workspace({ name: "Client Project" })               → wsId
2. create_template({ name: "Hero", workspaceId: wsId })        → tplId
3. add_html_frame({ templateId: tplId, width: 1440, height: 900 })
4. draw_shape({ templateId: tplId, frameId: "...", type: "rect", x: 100, y: 100, width: 300, height: 200 })
5. add_primitive({ templateId: tplId, frameId: "...", type: "text", x: 150, y: 120 })
6. export_template({ id: tplId })                              → backup
```

### Workflow 2: Analyze and modify existing design

```
1. get_template({ id: tplId })                                 → full template
2. analyze_template_structure({ templateId: tplId })           → colors, fonts, layout
3. transform_element({ templateId: tplId, frameId: "...", elementId: "...", width: 400 })
4. set_css_variable({ templateId: tplId, name: "--primary", value: "#FF5500" })
5. update_template({ id: tplId, name: "Hero v2" })
```

### Workflow 3: Batch generate variants

```
1. get_template({ id: tplId })
2. batch_update({
     templateId: tplId,
     updates: [
       { find: "--headline", replace: "Summer Sale" },
       { find: "--price", replace: "$19.99" }
     ]
   })
3. render_batch({ templateId: tplId, variations: [{ ... }, { ... }] })
```

### Workflow 4: Collaborative editing (real-time)

```
# Editor already supports real-time sync via Supabase Realtime channels.
# Two agents can connect to the same template and see each other's changes:

Agent A → edit frame → autoSave → PUT /api/templates/:id
                                     → broadcastChange() → Supabase Realtime
Agent B ← subscribeTemplate() ← receives update ← auto-applies to UI

# Presence is also tracked — top bar shows "N agents connected"
```

---

## Project Structure

```
design/
├── src/                          # React frontend (Vite)
│   ├── App.tsx                   # Root + routing
│   ├── pages/
│   │   └── EditorV2.tsx          # HTML/CSS infinite canvas editor
│   ├── components/
│   │   ├── DesignFrame.tsx       # Shadow DOM + interaction engine
│   │   ├── InfiniteHtmlCanvas.tsx # Pan/zoom viewport
│   │   ├── FloatingToolbar.tsx   # Tool palette (V,H,R,O,T,P)
│   │   ├── HtmlContextualPanel.tsx # Property inspector
│   │   ├── CodePanel.tsx         # Monaco HTML/CSS editor
│   │   ├── Dashboard.tsx         # Template gallery
│   │   ├── CanvasEditor.tsx      # Fabric.js editor
│   │   └── Toolbar.tsx           # Fabric.js toolbar
│   ├── hooks/
│   │   ├── useCanvas.ts          # Fabric.js operations (689 lines)
│   │   └── useAutoSave.ts        # Dual-write auto-save
│   └── lib/
│       ├── templateApi.ts        # API client
│       └── supabaseRealtime.ts   # Realtime channels
├── api/                          # Express API
│   ├── src/
│   │   ├── routes/               # REST endpoints
│   │   ├── services/             # Templates, store, supabase
│   │   └── middleware/            # Auth, rate limit
│   └── package.json
├── worker/runtime/
│   └── functions/
│       ├── api.mjs               # Express adapter inside the Worker
│       └── mcp.mjs               # MCP server (JSON-RPC + SSE)
├── SETUP.md                      # ← This file
├── SKILL.md                      # AI agent skill reference
├── ARCHITECTURE.md               # Architecture deep dive
├── .env.example                  # Environment variable template
├── wrangler.toml                 # Cloudflare Worker + static assets config
├── package.json
└── vite.config.ts
```

---

## Build Commands

```bash
# Frontend only
npm run dev                # Vite dev server → http://localhost:5173
npm run build              # tsc + vite build → dist/

# API only
cd api && npm run dev      # Express dev → http://localhost:3001
cd api && npm run build    # tsc compile

# Full production build for Cloudflare Workers
npm run build:functions    # Install API deps + compile
npm run build              # Frontend build
# → ready for npm run deploy:cloudflare

# Type checking
npx tsc --noEmit --skipLibCheck          # Frontend
cd api && npx tsc --noEmit --skipLibCheck # API
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Template not found" | In-memory store reset | Add Supabase env vars |
| Blank dashboard | Workspace selector on "All Templates" | Switch to your workspace |
| Zoom collapses page | Old JS cached | Hard refresh (Ctrl+Shift+R) |
| Selection handles tiny/misplaced | Old JS cached | Hard refresh |
| MCP connection refused | Missing auth header | Add `x-api-key: dev-key` |
| 500 on PUT | Supabase RLS blocking | Use `SUPABASE_SERVICE_KEY` not anon key |
| `npm run dev` fails | Missing node_modules | Run `npm install` first |
