# Futuraria Design — Complete System Documentation

> **Auto-generated comprehensive documentation** covering every file, function, and architectural decision in the Futuraria Design codebase.
>
> Versions: API v3.0.0 / Editor v0.1.0
>
> License: MIT | Owner: Renzo Perez Bartra (futuraria.com)

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture Overview](#2-architecture-overview)
3. [Deployment Topology](#3-deployment-topology)
4. [Root Configuration Files](#4-root-configuration-files)
5. [n8n Workflow Files](#5-n8n-workflow-files)
6. [Shared Package (`packages/shared`)](#6-shared-package-packagesshared)
7. [API Backend (`packages/api`)](#7-api-backend-packagesapi)
8. [Editor Frontend (`packages/editor`)](#8-editor-frontend-packageseditor)
9. [Netlify Functions](#9-netlify-functions)
10. [Errors, Inconsistencies & Issues Found](#10-errors-inconsistencies--issues-found)

---

## 1. Project Overview

**Futuraria Design** is an AI-first design tool inspired by Figma, built as a monorepo with:
- A **React + Fabric.js canvas editor** (frontend) deployed on Netlify
- An **Express REST API** (backend) deployable on Railway or via Netlify Functions
- **n8n integration** for content automation via webhooks
- **Supabase** for persistent storage (PostgreSQL + Storage)

The tool allows users to create visual designs with layers (rectangles, ellipses, text, images, paths, lines, groups), export them as PNG/JPG/SVG, manage API keys for programmatic access, and trigger webhooks for automation workflows.

### Key Features
- Canvas-based visual editor with Fabric.js 6
- Multi-layer design system (rect, ellipse, text, image, path, line, group)
- Puppeteer-based PNG/JPG rendering (server-side)
- Direct SVG generation (no Puppeteer needed)
- REST API for CRUD operations on templates, layers, styles, components, comments, versions, variables
- Webhook system for event-driven automation (n8n integration)
- API key management with SHA-256 hashed keys
- Branch-based template versioning
- Prototype interactions (click, hover, transitions)
- Auto-save with debouncing
- Variable/design token system
- Boolean operations for shape manipulation

---

## 2. Architecture Overview

```
┌─────────────────────┐        ┌─────────────────────┐
│  Frontend (Netlify)  │        │  Backend (Railway)   │
│                      │        │                      │
│  React + Fabric.js   │◄──────►│  Express API         │
│  Canvas Editor       │  JSON  │  + Puppeteer (render)│
│                      │        │  + Supabase (storage)│
│  - Visual editing    │        │  + Webhooks          │
│  - SVG import        │        │                      │
│  - Layer management  │        │  REST API:           │
│  - Template preview  │        │  - Templates CRUD    │
│                      │        │  - Layer write ops   │
└─────────────────────┘        │  - Render/export     │
                                │  - Webhooks          │
                                └──────────┬──────────┘
                                           │
                                ┌──────────▼──────────┐
                                │       n8n            │
                                │  HTTP Request → API  │
                                │  Webhook callback    │
                                └─────────────────────┘
```

### Data Flow
1. **Frontend → Backend**: The React editor sends REST API calls (GET/POST/PUT/PATCH/DELETE) to the Express API
2. **Backend → Supabase**: The API persists data to Supabase PostgreSQL tables and Storage buckets
3. **Backend → n8n**: Webhooks fire events to registered n8n webhook URLs
4. **n8n → Backend**: n8n workflows call the API to create/update templates and trigger exports
5. **Rendering**: PNG/JPG uses Puppeteer (headless Chromium); SVG is generated directly server-side

### Two Backend Deploy Modes
The project supports two backend deployment strategies that can coexist:
1. **Netlify Functions mode** (`packages/editor/netlify/functions/api.mts`): A self-contained edge function that handles all API routes directly. Uses Supabase service role key for database access.
2. **Express API mode** (`packages/api/src/`): A traditional Express server intended for Railway or standalone deployment. Shares the same route structure but uses middleware-based auth.

---

## 3. Deployment Topology

| Component | Platform | Technology |
|-----------|----------|------------|
| Frontend (Editor) | Netlify | Vite-built React SPA |
| Backend (API) Option A | Netlify Functions | Edge function (api.mts) |
| Backend (API) Option B | Railway | Express server (api/src/) |
| Database | Supabase | PostgreSQL |
| File Storage | Supabase Storage | S3-compatible bucket (`design-exports`) |
| Automation | n8n (self-hosted) | Workflow automation |

### netlify.toml Redirect Rules
- `/api/*` → `/.netlify/functions/api/:splat` (API proxy)
- `/*` → `/index.html` (SPA fallback)

---

## 4. Root Configuration Files

### 4.1 `.gitignore`
**Path:** `/.gitignore`
**Purpose:** Defines files and directories excluded from Git version control.
**Contents:** `node_modules/`, `dist/`, `.env`, `.env.local`, `*.log`, `.DS_Store`, `packages/editor/dist/`, `packages/api/dist/`

### 4.2 `LICENSE`
**Path:** `/LICENSE`
**Purpose:** MIT License. Grants permission to use, copy, modify, merge, publish, distribute, sublicense, and sell the software. Requires the copyright notice and permission notice to be included in all copies.
**Copyright:** 2026 Futuraria (futuraria.com), Renzo Perez Bartra.

### 4.3 `NOTICE`
**Path:** `/NOTICE`
**Purpose:** Attribution notice. Requires all copies, forks, and derivative works to include this file and display attribution to Futuraria in a visible location within the application.

### 4.4 `TRADEMARK.md`
**Path:** `/TRADEMARK.md`
**Purpose:** Defines the trademark policy for the "Futuraria" name and logo. Allows forking/modifying under MIT but prohibits naming forks/products "Futuraria" or using the logo as one's own brand.

### 4.5 `README.md`
**Path:** `/README.md`
**Purpose:** High-level project overview. Documents architecture diagram, packages table, quick start commands, API endpoints (MVP), n8n integration example, and tech stack. This is the only existing project documentation beyond the n8n README.

### 4.6 `package.json` (Root)
**Path:** `/package.json`
**Purpose:** Root workspace configuration for the monorepo. Defines scripts for development and building:
- `dev:editor` → `cd packages/editor && npm run dev`
- `dev:api` → `cd packages/api && npm run dev`
- `build:editor` → `cd packages/editor && npx vite build`
- `build:api` → `cd packages/api && npm run build`
**Note:** `"workspaces": []` is empty — the monorepo does not use npm workspaces. Each package is independent.

### 4.7 `netlify.toml`
**Path:** `/netlify.toml`
**Purpose:** Netlify deployment configuration.
- **Build:** Base is `packages/editor`, command `npm install && npx vite build`, publish to `dist/`
- **Environment:** Node 22, `SECRETS_SCAN_OMIT_KEYS` set
- **Functions:** Directory `netlify/functions`, bundler `esbuild`
- **Headers:** Security headers (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`)
- **Redirects:** `/api/*` → `/.netlify/functions/api/:splat`, `/*` → `/index.html` (SPA)

### 4.8 `package-lock.json` (Root)
**Path:** `/package-lock.json`
**Purpose:** Lockfile for root-level dependencies. 5794 lines. Standard npm artifact.

---

## 5. n8n Workflow Files

**Directory:** `/n8n-workflows/`

### 5.1 `n8n-workflows/README.md`
**Purpose:** Comprehensive guide for n8n integration. Documents:
- Architecture diagram (Futuraria ↔ n8n ↔ Supabase)
- All API endpoints (templates, export, webhooks, health, styles, components, comments, versions)
- Webhook event types and their payloads (10 event types)
- n8n setup instructions (import workflows, set env vars, register webhooks)
- Export pipeline steps (design → render → upload → webhook → n8n)
- Example n8n workflow (export and email)
- Supabase table listing (7 tables: templates, webhooks, api_keys, styles, components, comments, template_versions)

### 5.2 `n8n-workflows/01-webhook-receiver.json`
**Purpose:** n8n workflow definition. Receives Futuraria webhook events via HTTP POST at path `/futuraria-events`.
**Nodes:**
1. **Webhook** (n8n-nodes-base.webhook): HTTP POST endpoint at `futuraria-events`, responds immediately (`onReceived`), returns all entries
2. **Switch Event** (n8n-nodes-base.switch): Routes based on `$json.body.event` value. Handles 6 event types: `template.created`, `template.updated`, `render.complete`, `version.created`, `comment.created`, `layer.updated`
3. **Log Template Created** (set node): Extracts action, templateId, templateName
4. **Log Render Complete** (set node): Extracts action, renderId, templateId, format
5. **Log Comment** (set node): Extracts action, commentId, author, text
**Status:** `active: false` (inactive by default)

### 5.3 `n8n-workflows/02-api-manager.json`
**Purpose:** n8n workflow for managing Futuraria templates via API calls.
**Nodes:**
1. **Schedule Trigger** (cron): Runs every hour
2. **Manual Trigger**: For manual execution
3. **List Templates** (HTTP Request): GET `$FUTURARIA_API_URL/api/templates` with `X-API-Key` header
4. **Health Check** (HTTP Request): GET `$FUTURARIA_API_URL/api/health` (no auth)
5. **Check Status** (IF): Checks if `$json.success` is true
6. **Format Output** (set): Outputs templateCount and status
**Note:** Uses `X-API-Key` header (not `Authorization: Bearer`). Health check does NOT use API key auth.
**Status:** `active: false`

### 5.4 `n8n-workflows/03-design-export.json`
**Purpose:** n8n workflow for the design export pipeline.
**Nodes:**
1. **Webhook Trigger**: POST at `futuraria-export`, response mode `lastNode`
2. **Get Template** (HTTP Request): GET template by ID with `X-API-Key`
3. **Request Export** (HTTP Request): POST export request (png, scale 2) with `X-API-Key`
4. **Get SVG Export** (HTTP Request): GET SVG export with `X-API-Key`
5. **Set Export Result** (set): Formats result with status, exportId, templateId, format
**Status:** `active: false`

