# Futuraria Design — Zero-to-Deploy Install Guide

> **SaaS v9 prerequisite:** before deploying this version, run
> `node scripts/setup-supabase.mjs`. The script applies the base schema and all
> numbered migrations as complete SQL units. Confirm that
> `supabase_migrations_v9.sql` succeeds, then update `.migration-version` to
> `v9`. Configure `SUPABASE_PUBLISHABLE_KEY`, `WORKSPACE_SECRET_ENCRYPTION_KEY`, and
> `MCP_ADMIN_KEY` in addition to the existing server-side Supabase variables.
> Authentication receives the publishable key from the server at runtime;
> `VITE_*` remains optional for Realtime. A `VITE_` key must always be
> publishable, never secret/service-role. Enable Email/Password in Supabase Auth
> and allow both local and production URLs as authentication redirect URLs.
> Commands farther below that use `SUPABASE_ANON_KEY` or
> `SUPABASE_SERVICE_KEY` document the compatible legacy path; new projects
> should use publishable/secret keys.

**Two audiences, one file:**
- [For AI Agents](#for-ai-agents) — execute phases in order, each ends with ✓ checkpoint
- [For Humans](#for-humans) — click-through instructions with dashboard directions

**One message to install:** tell your AI *"Install the design tool from https://github.com/reno42/design"* — it reads this file and does everything.

**Total cost: $0/month.** Netlify Free tier + Supabase Free tier (500MB). No credit card.

---

## For AI Agents

> You are an AI agent. Execute phases in order. Each ends with ✓ checkpoint — stop on failure.
> Ask the human for credentials only when instructions say **ASK HUMAN.**
> Cross-platform note: Windows uses PowerShell (no `&&`, no heredocs). Use `.mjs` temp files instead of `node -e` for multiline code.

### Phase 0 — Prerequisites

```bash
node -v        # ≥18 required
npm -v         # ≥9 required
git --version  # any version
```

If any fail, tell the human what's missing and stop.

### Phase 1 — Local Clone & Run

```bash
git clone https://github.com/reno42/design.git
cd design
npm install
npm run dev &
```

Wait 5 seconds, verify:

```bash
# Windows (PowerShell):
(Invoke-WebRequest -Uri http://localhost:5173).StatusCode
# macOS/Linux:
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173
```

Must return 200. ✓

**ASK HUMAN:** *"Editor running at http://localhost:5173. Cloud persistence + AI agent access? Or local-only?"*

If local-only → skip to Phase 4 pointing at `http://localhost:5173/mcp`.

### Phase 2 — Supabase (Cloud Persistence)

#### Path A: Automated via Management API

**ASK HUMAN:** *"Create a Supabase PAT at https://app.supabase.com/account/tokens → 'Generate new token' → paste it here."*

Store as `$SUPABASE_PAT`.

**Step 1: Get organization**

```bash
curl -s https://api.supabase.com/v1/organizations -H "Authorization: Bearer $SUPABASE_PAT"
# Store first result's id as $ORG_ID
```

**Step 2: Create project**

```bash
# Windows (PowerShell) — generate password:
$DB_PASS = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 16 | ForEach-Object {[char]$_})
# macOS/Linux:
DB_PASS=$(node -e "console.log(require('crypto').randomBytes(12).toString('base64').replace(/[^a-zA-Z0-9]/g,'').slice(0,16))")

curl -s -X POST https://api.supabase.com/v1/projects \
  -H "Authorization: Bearer $SUPABASE_PAT" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"futuraria\",\"organization_id\":\"$ORG_ID\",\"region\":\"us-east-1\",\"db_pass\":\"$DB_PASS\",\"kps_enabled\":false}"
```

Store `response.id` as `$PROJECT_REF`.

**Step 3: Wait for ACTIVE_HEALTHY (poll up to 2 min)**

```bash
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24; do
  STATUS=$(curl -s https://api.supabase.com/v1/projects/$PROJECT_REF -H "Authorization: Bearer $SUPABASE_PAT" | node -p "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).status")
  echo "Status: $STATUS"
  if [ "$STATUS" = "ACTIVE_HEALTHY" ]; then break; fi
  sleep 5
done
```

**Step 4: Get API keys**

```bash
KEYS=$(curl -s https://api.supabase.com/v1/projects/$PROJECT_REF/api-keys -H "Authorization: Bearer $SUPABASE_PAT")
SUPABASE_URL="https://${PROJECT_REF}.supabase.co"
```

Write a temp script to extract keys (works on both Windows and Unix):

```javascript
// _extract_keys.mjs
import { readFileSync, writeFileSync } from 'fs';
const keys = JSON.parse(process.argv[1]);
const sr = keys.find(k => k.name === 'service_role');
const anon = keys.find(k => k.name === 'anon');
writeFileSync('.supabase_keys', `SUPABASE_URL=${process.argv[2]}\nSUPABASE_SERVICE_KEY=${sr?.api_key||''}\nSUPABASE_ANON_KEY=${anon?.api_key||''}\n`);
```

Run it: `node _extract_keys.mjs "$KEYS" "$SUPABASE_URL"` then source `.supabase_keys`.

**Step 5: Run database migration FROM FILE (not inline)**

The repo includes `supabase_schema_complete.sql` — a standalone file with all 7 tables, indexes, storage bucket, RLS policies, and realtime publications. Read it with Node to avoid JSON escaping errors:

```javascript
// _run_sql.mjs
const SQL = require('fs').readFileSync('supabase_schema_complete.sql', 'utf8');
const res = await fetch(`https://api.supabase.com/v1/projects/${process.env.PROJECT_REF}/sql`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${process.env.SUPABASE_PAT}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: SQL }),
});
const data = await res.json();
console.log(res.status, data.error || 'OK');
```

Run: `PROJECT_REF=$PROJECT_REF SUPABASE_PAT=$SUPABASE_PAT node _run_sql.mjs`

**Step 6: Verify tables exist**

```bash
curl -s "$SUPABASE_URL/rest/v1/workspaces?limit=1" -H "apikey: $SUPABASE_ANON_KEY"
```

Must return `[]` (not an error). ✓

**Step 7: Write .env**

```env
SUPABASE_URL=https://PROJECT_REF.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOi...  (service_role key)
SUPABASE_ANON_KEY=eyJhbGciOi...     (anon key)
```

#### Path B: Manual Fallback

**ASK HUMAN:** *"Create a project at https://supabase.com, then give me the Project URL, service_role key, and anon key from Project Settings → API."*

Then **ASK HUMAN:** *"Go to SQL Editor, paste the contents of supabase_schema_complete.sql, and run it."*

Write `.env` with the provided values.

✓ **Checkpoint:** Restart `npm run dev`. Create workspace + template, refresh — persists.

### Phase 3 — Netlify Deploy

**ASK HUMAN:** *"When browser opens for OAuth, click Authorize."*

```bash
npm install -g netlify-cli
netlify login
```

If headless: **ASK HUMAN** for a Netlify PAT from https://app.netlify.com/user/applications#personal-access-tokens, then `netlify login --auth $TOKEN`.

```bash
netlify init                              # Create & configure new site → pick team → enter name
netlify env:set SUPABASE_URL "$SUPABASE_URL"
netlify env:set SUPABASE_SERVICE_KEY "$SUPABASE_SERVICE_KEY"
netlify env:set SUPABASE_ANON_KEY "$SUPABASE_ANON_KEY"
npm run build:functions
npm run build
netlify deploy --prod --dir=dist
```

Note URL from output (e.g., `https://my-futuraria.netlify.app`). Store as `$SITE_URL`.

```bash
curl -s -X POST "$SITE_URL/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Must return JSON with `"tools": [...]` — 120+ tools. ✓

### Phase 3.5 — Healthcheck (Verify Everything Works)

`tools/list` returning 120+ tools doesn't guarantee CRUD works. The repo includes a smoke test:

```bash
node QA/healthcheck_mcp.mjs "$SITE_URL/mcp" "dev-key"
```

This tests the full pipeline:
- `tools/list` (discovery)
- `create_workspace` → `list_workspaces`
- `create_template` → `get_template`
- `create_html_frame` → `set_html` → `update_frame_content`
- `generate_design_artifacts` → `get_design_artifacts`
- `profile_template_pool` → `generate_csv_template` (downloadHtml + dataUri + cleanCsv)
- `delete_template` → verify deleted
- Cleanup

All tests must PASS. If any fail, the deploy is incomplete — debug before connecting AI agents.

✓ **Checkpoint:** `healthcheck_mcp.mjs` exits 0 with all tests green.

### Phase 4 — Connect AI Agent to MCP

**About authentication — three methods, all equivalent:**

1. **`x-api-key` header** (default for Claude Desktop, Cursor, OpenClaw/Qoder, custom agents). Default valid key is `dev-key` (defined by the `API_KEY` environment variable on Netlify). For production, set `API_KEY` to a random secret in Netlify env vars and share it only with trusted agents.
2. **Key in the URL** (clients with no header support): `https://YOUR-SITE.netlify.app/mcp?key=YOUR_KEY` — `?api_key=`, `?token=` and `?x-api-key=` are also accepted. The header always wins when both are present.
3. **OAuth 2.1** (ChatGPT connectors, Claude web/desktop "Conectores"): the server is a full OAuth authorization server per the MCP Authorization spec (2025-06-18) — discovery at `/.well-known/oauth-protected-resource` (RFC9728) and `/.well-known/oauth-authorization-server` (RFC8414), dynamic client registration at `/oauth/register` (RFC7591), authorization code + PKCE S256 via `/oauth/authorize` (login + consent page) and `/oauth/token`. Just paste the plain `/mcp` URL in the client and it discovers the rest. Tokens are user-scoped Supabase sessions sent as `Authorization: Bearer`; each connector gets its own session (revocable from the Supabase dashboard). Requires the `oauth_clients` / `oauth_codes` tables (migration `supabase_migrations_v31.sql`).

**Without any of the three, `tools/call` is rejected (401).** `initialize`, `tools/list` and the public tools (`get_agent_guide`, `get_playbook`, `verify_api_key`) need no auth. The examples below use `dev-key` — replace with your actual key if you changed it.

**Verify the full OAuth flow without any paid AI client:**
```powershell
node QA/oauth-qa-user-setup.mjs   # once: registers the QA user via public signup + accepts the NDA
node QA/oauth-flow-test.mjs       # 21 checks: discovery -> register -> authorize -> token -> Bearer on /mcp -> refresh -> replay rejection
```
The test is a headless client performing the exact HTTP sequence a real connector performs. Report: `QA/OAUTH-FLOW-TEST-2026-08-25.md`.

**Claude Desktop / Claude Code:**

Config file: macOS `~/Library/Application Support/Claude/claude_desktop_config.json`, Windows `%APPDATA%\Claude\claude_desktop_config.json`.

```json
{
  "mcpServers": {
    "futuraria": {
      "type": "sse",
      "url": "https://YOUR-SITE.netlify.app/mcp",
      "headers": { "x-api-key": "dev-key" }
    }
  }
}
```

**OpenClaw / Qoder:**

Settings → MCP Servers → Add:
- Name: `Futuraria`
- Transport: `SSE`
- URL: `https://YOUR-SITE.netlify.app/mcp`
- Headers: `x-api-key = dev-key`

**Cursor:**

`.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "futuraria": {
      "transport": "sse",
      "url": "https://YOUR-SITE.netlify.app/mcp",
      "headers": { "x-api-key": "dev-key" }
    }
  }
}
```

**Any MCP Agent (generic JSON-RPC):**

```bash
curl -X POST https://YOUR-SITE.netlify.app/mcp \
  -H "Content-Type: application/json" \
  -H "x-api-key: dev-key" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"my-agent","version":"1.0"}}}'
```

⚠️ **Rate limit:** The MCP endpoint allows ~60 requests/minute per IP. If batch operations fail with 429 errors, add 1-2 second delays between calls. Batch CSV tools handle this internally, but custom scripts need explicit `sleep()` calls.

✓ **Final Checkpoint:** Restart AI agent. Ask: "Call list_workspaces on Futuraria." Must return data.

---

### One-Message Install Recipe

> *"Install the Futuraria design tool from https://github.com/reno42/design"*

| Moment | Human action | Time |
|--------|-------------|------|
| Phase 1 | None | 0 min |
| Phase 2 | Paste Supabase PAT | 30 sec |
| Phase 3 | Click Netlify OAuth | 10 sec |
| Phase 4 | None | 0 min |

Human does 2 things. Everything else is automated.

---

## For Humans

### Step 1: Prerequisites

Install Node.js (≥18) from https://nodejs.org and Git from https://git-scm.com.

```bash
node -v; npm -v; git --version
```

### Step 2: Clone & Run

```bash
git clone https://github.com/reno42/design.git
cd design
npm install
npm run dev
```

Open http://localhost:5173. Dashboard appears. **Done!** Continue for cloud/AI features.

### Step 3: Supabase (Cloud Persistence)

1. Go to https://supabase.com → Sign up (free) → New project → name "futuraria" → create
2. Wait 2 min for provisioning
3. Project Settings → API → copy **Project URL**, **service_role key**, **anon key**
4. SQL Editor → New query → paste contents of `supabase_schema_complete.sql` → Run
5. On your machine:

```bash
cp .env.example .env
```

Edit `.env`:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOi...  ← service_role
SUPABASE_ANON_KEY=eyJhbGciOi...     ← anon
```

Restart `npm run dev`. Create a template, refresh — persists.

### Step 4: Deploy to Netlify

```bash
npm install -g netlify-cli
netlify login        # browser opens → Authorize
netlify init         # Create & configure → pick team → enter site name
netlify env:set SUPABASE_URL "https://your-project.supabase.co"
netlify env:set SUPABASE_SERVICE_KEY "eyJhbGciOi..."
netlify env:set SUPABASE_ANON_KEY "eyJhbGciOi..."
npm run build:functions
npm run build
netlify deploy --prod --dir=dist
```

### Step 4.5: Run Healthcheck

```bash
node QA/healthcheck_mcp.mjs https://YOUR-SITE.netlify.app/mcp dev-key
```

All tests must PASS. If not, something is broken — don't connect AI agents yet.

### Step 5: Connect AI Agent

**About x-api-key:** The MCP endpoint requires `x-api-key` header. Default key is `dev-key`. Change it via `netlify env:set API_KEY "your-secret"` and share only with trusted agents.

Add to your AI's MCP config (replace URL and key):

**Claude Desktop:** `claude_desktop_config.json`:

```json
{ "mcpServers": { "futuraria": { "type": "sse", "url": "https://YOUR-SITE.netlify.app/mcp", "headers": { "x-api-key": "dev-key" } } } }
```

**OpenClaw/Qoder:** Settings → MCP Servers → Add: Name=Futuraria, Transport=SSE, URL=https://YOUR-SITE.netlify.app/mcp, Headers=x-api-key=dev-key

**Cursor:** `.cursor/mcp.json`: same JSON as Claude.

Restart AI. Ask: "List my Futuraria workspaces."

⚠️ **Rate limit:** ~60 requests/minute. Batch operations need ~2s delays between calls. Don't fire 11 frame updates in parallel.

---

## For Template Creators: data-slot Attribute

If you're building HTML templates for use with `profile_template_pool` → `generate_csv_template` → `apply_csv_to_frames` (batch CSV pipeline), add `data-slot="name"` to content elements:

```html
<h1 data-slot="headline">Default Headline</h1>
<p data-slot="subtitle">Default subtitle text here</p>
<img data-slot="hero_image" src="placeholder.jpg" alt="" />
<a data-slot="cta" href="#">Click Here</a>
```

When `data-slot` is present on ANY element in a frame, the profiler switches to **explicit mode** and only exports those elements as CSV columns (ignoring chrome, decorations, structural tags). Without `data-slot`, the profiler uses auto-detection which may create unpredictable column names.

**Best practices:**
- Use lowercase, underscore_separated names: `hero_image`, `stat_1_value`, `author_name`
- Names become CSV column headers — keep them human-readable
- Every element with `data-slot` MUST exist in every frame using the same template
- Image slots: put a placeholder `src` so the profiler detects type `image`

---

## What You Can Do (Key MCP Workflows)

### Batch CSV Pipeline (most powerful feature)

```
profile_template_pool → generate_csv_template → human fills CSV → apply_csv_to_frames
```

- `profile_template_pool({ templateIds })` — auto-detects content slots across templates
- `generate_csv_template({ templateIds, rowCount })` — returns downloadHtml (self-contained HTML page with Download button), dataUri (paste in browser for instant .csv), and cleanCsv (DB-ready, no comments)
- Human fills CSV in Excel/Google Sheets — one row per generated frame
- `apply_csv_to_frames({ workspaceId, csvData, templateIds })` — creates new output template with all frames populated from CSV values
- **Zero AI content manipulation** — system profiles deterministically, human fills content, system generates frames

### Design Artifacts

```
generate_design_artifacts({ templateId, action: "generate" })
→ { designMd, tokensJson, sharedCss, sourceHash, _deterministic: true }
```

Extracts canonical DESIGN.md, tokens.json, and shared.css from frame HTML/CSS. `sourceHash` enables staleness detection via `get_design_artifacts`.

### Surgical Frame Editing

```
update_frame_content({ templateId, frameId, patches: [
  { selector: "h1", patch: { text: "New Title" } },
  { selector: ".hero", patch: { src: "https://..." } },
  { selector: "#box", patch: { style: { background: "#fff" } } }
]})
```

---

## Tier Reference

| Tier | What you get | Steps | Time | Cost |
|------|-------------|-------|------|------|
| **Local only** | Editor at :5173, no persistence, no MCP | 1-2 | 5 min | $0 |
| **Local + DB** | Editor + permanent cloud storage | 1-3 | 15 min | $0 |
| **Full cloud** | Public URL + MCP for AI agents + persistence | 1-5 | 25 min | $0 |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `npm run dev` fails: "Cannot find module" | Missing node_modules | `npm install` |
| Blank dashboard | No workspace exists | Click "New Workspace" |
| `netlify deploy` fails: "Not authorized" | CLI not logged in | `netlify login` |
| MCP returns "Unauthorized" | Missing or wrong x-api-key | Use `dev-key` or check `API_KEY` env var |
| MCP returns 404 | Site not deployed | Run `netlify deploy --prod --dir=dist` |
| MCP returns 429 "Rate limit exceeded" | Too many requests (~60/min) | Add 2s delays between batch calls |
| Templates disappear after restart | No Supabase or wrong keys | Verify .env keys match Supabase dashboard |
| `tools/list` returns fewer than 120 tools | Old deploy cached | `npm run build && netlify deploy --prod --dir=dist` |
| `node -e` multiline fails on Windows | PowerShell doesn't support multiline `-e` | Write temp `.mjs` file and run with `node file.mjs` |
| Supabase Management API returns 403 | PAT lacks permissions | Create project manually via dashboard (Path B) |
| `healthcheck_mcp.mjs` fails at update_frame_content | Frame HTML not set yet | Ensure `set_html` ran before `update_frame_content` |
| Batch CSV has wrong column names | Template missing `data-slot` | See [data-slot section](#for-template-creators-data-slot-attribute) |

---

## Key Files

| File | Purpose |
|------|---------|
| `INSTALL.md` | ← This file. AI + human zero-to-deploy. |
| `supabase_schema_complete.sql` | Complete DB schema — 7 tables, indexes, storage, RLS. Read with `fs.readFileSync` for Management API. |
| `QA/healthcheck_mcp.mjs` | Post-deploy smoke test — full CRUD pipeline. |
| `SKILL.md` | AI agent skill reference — 259 tools, components, patterns. Auto-synced with `npm run sync:skill`. |
| `SETUP.md` | Quickstart (shorter, human-only). |
| `.env.example` | Template for Supabase credentials. |
| `netlify.toml` | Build command, function bundler, redirects. |
# Futuraria Design — Zero-to-Deploy Install Guide

---

## Quick Reference

| Who | What to do | Time |
|-----|-----------|------|
| **Human** | Read [For Humans](#for-humans) — manual setup with dashboard clicks | 25 min |
| **AI Agent** | Read [For AI Agents](#for-ai-agents) — execute phases sequentially | 10 min |
| **Human → AI** | Tell your AI: *"Install the design tool from https://github.com/reno42/design"* | 30 sec |

**Total cost: $0/month.** Netlify Free tier + Supabase Free tier (500MB). No credit card.

---

## For AI Agents

> You are an AI agent reading this file. Your job: execute every phase in order.
> Each phase ends with a ✓ checkpoint. If a checkpoint fails, stop and report to the human.
> Ask the human for credentials only when the phase instructions say "ASK HUMAN".

### Phase 0 — Prerequisites

Run these checks first:

```bash
node -v        # ≥18 required
npm -v         # ≥9 required
git --version  # any version
```

If any fail, tell the human what's missing and stop.

### Phase 1 — Local Clone & Run

```bash
git clone https://github.com/reno42/design.git
cd design
npm install
npm run dev &
```

Wait 5 seconds, then verify:

```bash
curl -s http://localhost:5173 | head -5
```

Must return HTML with `<title>` tag. ✓

**ASK HUMAN:** *"The editor is running at http://localhost:5173. Do you want cloud persistence (Supabase) and AI agent access (Netlify deploy)? Or is local-only fine?"*

If local-only → **DONE.** Skip to Phase 4 (MCP config), pointing at `http://localhost:5173/mcp`.

### Phase 2 — Supabase (Cloud Persistence)

#### Path A: Automated via Management API

**ASK HUMAN:** *"I need a Supabase Personal Access Token. Go to https://app.supabase.com/account/tokens, click 'Generate new token', and paste it here."*

Store the PAT as `$SUPABASE_PAT`.

**Step 1: Get available organizations**

```bash
curl -s https://api.supabase.com/v1/organizations \
  -H "Authorization: Bearer $SUPABASE_PAT"
```

Pick the first organization ID from the response. Store as `$ORG_ID`.

**Step 2: Create project**

```bash
DB_PASS=$(node -e "console.log(require('crypto').randomBytes(12).toString('base64').replace(/[^a-zA-Z0-9]/g,'').slice(0,16))")

curl -s -X POST https://api.supabase.com/v1/projects \
  -H "Authorization: Bearer $SUPABASE_PAT" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"futuraria\",\"organization_id\":\"$ORG_ID\",\"region\":\"us-east-1\",\"db_pass\":\"$DB_PASS\",\"kps_enabled\":false}"
```

Store `response.id` as `$PROJECT_REF`.

**Step 3: Wait for project to be ready**

```bash
# Poll until status is ACTIVE_HEALTHY (up to 2 min)
for i in $(seq 1 24); do
  STATUS=$(curl -s https://api.supabase.com/v1/projects/$PROJECT_REF \
    -H "Authorization: Bearer $SUPABASE_PAT" | node -e "process.stdin.on('data',d=>{try{console.log(JSON.parse(d).status)}catch(e){console.log('PENDING')}})")
  echo "Status: $STATUS"
  if [ "$STATUS" = "ACTIVE_HEALTHY" ]; then break; fi
  sleep 5
done
```

**Step 4: Get API keys**

```bash
KEYS=$(curl -s https://api.supabase.com/v1/projects/$PROJECT_REF/api-keys \
  -H "Authorization: Bearer $SUPABASE_PAT")

SUPABASE_URL="https://${PROJECT_REF}.supabase.co"
SUPABASE_SERVICE_KEY=$(echo "$KEYS" | node -e "process.stdin.on('data',d=>{const k=JSON.parse(d);const s=k.find(x=>x.name==='service_role');console.log(s?s.api_key:'')})")
SUPABASE_ANON_KEY=$(echo "$KEYS" | node -e "process.stdin.on('data',d=>{const k=JSON.parse(d);const a=k.find(x=>x.name==='anon');console.log(a?a.api_key:'')})")
```

**Step 5: Run complete database migration**

The SQL is at the bottom of this file in [Appendix A: Complete Database Schema](#appendix-a-complete-database-schema). Read it, escape it for JSON, and POST:

```bash
# Read the SQL from Appendix A of this file, then:
curl -s -X POST "https://api.supabase.com/v1/projects/$PROJECT_REF/sql" \
  -H "Authorization: Bearer $SUPABASE_PAT" \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"<ESCAPED_SQL_HERE>\"}"
```

**Step 6: Verify tables exist**

```bash
curl -s "$SUPABASE_URL/rest/v1/workspaces?limit=1" \
  -H "apikey: $SUPABASE_ANON_KEY"
```

Must return `[]` (not an error). ✓

**Step 7: Write .env**

Read `.env.example` and write `.env` with the actual values:

```env
SUPABASE_URL=https://PROJECT_REF.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOi...  (service_role key)
SUPABASE_ANON_KEY=eyJhbGciOi...     (anon key)
```

#### Path B: Fallback (if Management API fails)

If Step 2 returns 403 or the human can't get a PAT:

**ASK HUMAN:** *"Create a Supabase project manually: go to https://supabase.com, sign up, create a project called 'futuraria'. Then go to Project Settings → API and give me the Project URL, service_role key, and anon key."*

Then:
1. **ASK HUMAN:** *"Go to SQL Editor in your Supabase dashboard, paste the SQL from Appendix A of INSTALL.md, and run it."*
2. Write `.env` with the provided values.

✓ **Checkpoint:** Restart `npm run dev`. Create a workspace, create a template, refresh the browser — it persists. If data disappears, Supabase is not connected.

### Phase 3 — Netlify Deploy

**ASK HUMAN:** *"I'm going to deploy to Netlify. When the browser opens for OAuth, click 'Authorize'."*

```bash
npm install -g netlify-cli
netlify login
```

**If netlify login fails (headless/token):**

**ASK HUMAN:** *"I need a Netlify Personal Access Token. Go to https://app.netlify.com/user/applications#personal-access-tokens, create one, and paste it."*

```bash
netlify login --auth $NETLIFY_TOKEN
```

**Create and deploy:**

```bash
# Create site (interactive — pick team, enter site name like "my-futuraria")
netlify init

# Set env vars
netlify env:set SUPABASE_URL "$SUPABASE_URL"
netlify env:set SUPABASE_SERVICE_KEY "$SUPABASE_SERVICE_KEY"
netlify env:set SUPABASE_ANON_KEY "$SUPABASE_ANON_KEY"

# Build and deploy
npm run build:functions
npm run build
netlify deploy --prod --dir=dist
```

Note the deployed URL from the output (e.g., `https://my-futuraria.netlify.app`). Store as `$SITE_URL`.

**Verify:**

```bash
curl -s -X POST "$SITE_URL/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Must return JSON with `"tools": [...]` containing 122 tools. ✓

### Phase 4 — Connect AI Agent to MCP

Now configure the AI agent's own MCP connection to the deployed endpoint.

**If the AI agent is Claude Desktop/Code:**

Read and update the MCP config file:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Add or merge:

```json
{
  "mcpServers": {
    "futuraria": {
      "type": "sse",
      "url": "https://YOUR-SITE.netlify.app/mcp",
      "headers": { "x-api-key": "dev-key" }
    }
  }
}
```

**If the AI agent is OpenClaw/Qoder:**

Tell the human to add an MCP server in settings:
- Name: `Futuraria`
- Transport: `SSE`
- URL: `https://YOUR-SITE.netlify.app/mcp`
- Headers: `x-api-key = dev-key`

**If the AI agent is Cursor:**

Write `.cursor/mcp.json` in the current project:

```json
{
  "mcpServers": {
    "futuraria": {
      "transport": "sse",
      "url": "https://YOUR-SITE.netlify.app/mcp",
      "headers": { "x-api-key": "dev-key" }
    }
  }
}
```

✓ **Final Checkpoint:** Restart the AI agent. Ask the agent: *"Call list_workspaces on Futuraria."* It must return workspace data (or empty array if none exist yet).

---

### One-Message Install Recipe

When the human tells their AI agent:

> *"Install the Futuraria design tool from https://github.com/reno42/design"*

The AI reads this INSTALL.md and executes Phases 0-4. Total human involvement:

| Moment | Human action | Time |
|--------|-------------|------|
| Phase 1 | None (AI clones + installs) | 0 min |
| Phase 2 | Paste Supabase PAT | 30 sec |
| Phase 3 | Click Netlify OAuth "Authorize" | 10 sec |
| Phase 4 | None (AI writes MCP config) | 0 min |

Human does 2 things. Everything else is automated.

---

## For Humans

Follow these steps manually. Each step tells you what to click, paste, or type.

### Step 1: Install Prerequisites

1. Install Node.js from https://nodejs.org (LTS version, ≥18)
2. Install Git from https://git-scm.com

Verify in terminal:

```bash
node -v
npm -v
git --version
```

### Step 2: Clone & Run Locally

```bash
git clone https://github.com/reno42/design.git
cd design
npm install
npm run dev
```

Open http://localhost:5173 in your browser. You should see the Futuraria dashboard.

**Done!** The editor works at this point. Continue only if you want cloud persistence or AI agent access.

### Step 3: Supabase (Cloud Persistence)

1. Go to https://supabase.com → Sign up (free, no credit card)
2. Click "New project" → name it "futuraria" → create
3. Wait 2 minutes for the database to provision
4. Go to Project Settings → API
5. Copy these three values:
   - **Project URL** (`https://xxxxx.supabase.co`)
   - **service_role key** (starts with `eyJhbGciOi...`)
   - **anon key** (starts with `eyJhbGciOi...`)
6. Go to SQL Editor → New query
7. Paste the complete SQL from [Appendix A](#appendix-a-complete-database-schema)
8. Click "Run"

Back on your machine:

```bash
cp .env.example .env
```

Open `.env` in a text editor and fill in:

```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOi...  ← service_role key
SUPABASE_ANON_KEY=eyJhbGciOi...     ← anon key
```

Restart `npm run dev`. Create a template, refresh — it should persist.

### Step 4: Deploy to Netlify

1. Install Netlify CLI:

```bash
npm install -g netlify-cli
```

2. Login:

```bash
netlify login
```

A browser opens — click "Authorize".

3. Create a site:

```bash
netlify init
```

Choose "Create & configure a new site" → pick your team → enter a site name (e.g., `my-futuraria`).

4. Upload environment variables:

```bash
netlify env:set SUPABASE_URL "https://your-project.supabase.co"
netlify env:set SUPABASE_SERVICE_KEY "eyJhbGciOi..."
netlify env:set SUPABASE_ANON_KEY "eyJhbGciOi..."
```

5. Build and deploy:

```bash
npm run build:functions
npm run build
netlify deploy --prod --dir=dist
```

Note the URL in the output (e.g., `https://my-futuraria.netlify.app`).

6. Verify MCP works:

```bash
curl -X POST https://YOUR-SITE.netlify.app/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

You should see JSON with `"tools": [...]` — 122 tools.

### Step 5: Connect Your AI Agent

Configure your AI coding assistant to use the MCP endpoint.

**Claude Desktop / Claude Code:**

Find your config file:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Add:

```json
{
  "mcpServers": {
    "futuraria": {
      "type": "sse",
      "url": "https://YOUR-SITE.netlify.app/mcp",
      "headers": { "x-api-key": "dev-key" }
    }
  }
}
```

Restart Claude. Ask: "List my Futuraria workspaces."

**OpenClaw / Qoder:**

Settings → MCP Servers → Add:
- Name: `Futuraria`
- Transport: `SSE`
- URL: `https://YOUR-SITE.netlify.app/mcp`
- Headers: `x-api-key = dev-key`

**Cursor:**

In your project folder, create `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "futuraria": {
      "transport": "sse",
      "url": "https://YOUR-SITE.netlify.app/mcp",
      "headers": { "x-api-key": "dev-key" }
    }
  }
}
```

### Step 6: Tell Your AI to Install Itself

Now that your AI agent has MCP access, you can install the tool on a fresh machine with one message:

> *"Install the Futuraria design tool from https://github.com/reno42/design"*

The AI reads `INSTALL.md` and does everything — clone, Supabase, Netlify, MCP config — asking you only for the Supabase PAT and Netlify OAuth click.

---

## Tier Reference

| Tier | What you get | Steps | Time | Cost |
|------|-------------|-------|------|------|
| **Local only** | Editor at :5173, no persistence, no MCP | 1-2 | 5 min | $0 |
| **Local + DB** | Editor + permanent cloud storage | 1-3 | 15 min | $0 |
| **Full cloud** | Public URL + MCP for AI agents + persistence | 1-5 | 25 min | $0 |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `npm run dev` fails: "Cannot find module" | Missing node_modules | `npm install` |
| Blank dashboard at :5173 | No workspace exists | Click "New Workspace" |
| `netlify deploy` fails: "Not authorized" | CLI not logged in | `netlify login` |
| MCP returns "Unauthorized" | Missing x-api-key header | Add `x-api-key: dev-key` to requests |
| MCP returns 404 | Site not deployed or wrong URL | Check `netlify deploy --prod` succeeded |
| Templates disappear after restart | No Supabase or wrong keys | Verify .env keys match Supabase dashboard |
| `tools/list` returns fewer than 122 | Old deploy cached | `npm run build && netlify deploy --prod --dir=dist` |
| Supabase Management API returns 403 | PAT lacks permissions or wrong org | Create project manually via dashboard (Path B) |

---

## Appendix A: Complete Database Schema

Run this entire script in Supabase SQL Editor. Every table, index, storage bucket, RLS policy, and realtime publication is included. Nothing is omitted.

```sql
-- ═══════════════════════════════════════════════════════════════
-- Futuraria Design — Complete Database Schema
-- Run in Supabase SQL Editor or via Management API
-- 7 tables + 4 indexes + 1 storage bucket + 5 RLS policies
-- ═══════════════════════════════════════════════════════════════

-- ============================================================
-- TABLE 1: workspaces
-- ============================================================
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT,
  member_ids TEXT[] DEFAULT '{}',
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE 2: templates
-- ============================================================
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID,
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE 3: recipes (design recipes / brand configs)
-- ============================================================
CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  workspace_id TEXT,
  structure JSONB NOT NULL DEFAULT '{}',
  template_html TEXT,
  template_css TEXT,
  preview_url TEXT,
  template_width INTEGER DEFAULT 1080,
  template_height INTEGER DEFAULT 1080,
  variables JSONB DEFAULT '{}'::jsonb,
  tags TEXT[] DEFAULT '{}',
  usage_count INTEGER DEFAULT 0,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recipes_workspace ON recipes(workspace_id);
CREATE INDEX IF NOT EXISTS idx_recipes_tags ON recipes USING gin(tags);

-- ============================================================
-- TABLE 4: batch_jobs
-- ============================================================
CREATE TABLE IF NOT EXISTS batch_jobs (
  id TEXT PRIMARY KEY,
  template_id TEXT,
  recipe_id TEXT,
  status TEXT DEFAULT 'queued',
  total_count INTEGER DEFAULT 0,
  completed_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  results JSONB DEFAULT '[]',
  errors JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- ============================================================
-- TABLE 5: section_locks (multi-agent collaboration)
-- ============================================================
CREATE TABLE IF NOT EXISTS section_locks (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  acquired_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE(template_id, section_id)
);

-- ============================================================
-- TABLE 6: brands
-- ============================================================
CREATE TABLE IF NOT EXISTS brands (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  workspace_id TEXT,
  colors JSONB DEFAULT '[]',
  fonts JSONB DEFAULT '[]',
  logo JSONB,
  spacing JSONB,
  rules JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE 7: assets (uploaded images metadata)
-- ============================================================
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY DEFAULT ('asset_' || substr(md5(random()::text), 1, 16)),
  name TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'image/png',
  size_bytes BIGINT DEFAULT 0,
  url TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  tags TEXT[] DEFAULT '{}',
  workspace_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assets_workspace ON assets(workspace_id);
CREATE INDEX IF NOT EXISTS idx_assets_created_at ON assets(created_at DESC);

-- ============================================================
-- STORAGE BUCKET: design-assets
-- Public bucket for user-uploaded images.
-- Max file size: 10 MB. Allowed types: PNG, JPEG, SVG, WebP.
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'design-assets',
  'design-assets',
  true,
  10485760,
  ARRAY['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];

-- ============================================================
-- RLS POLICIES: design-assets bucket
-- The API uses service_role (bypasses RLS), but these policies
-- ensure public URLs work for <img src> tags and future
-- client-side access.
-- ============================================================

DROP POLICY IF EXISTS "Public read design-assets" ON storage.objects;
CREATE POLICY "Public read design-assets"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'design-assets');

DROP POLICY IF EXISTS "Insert to design-assets" ON storage.objects;
CREATE POLICY "Insert to design-assets"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'design-assets');

DROP POLICY IF EXISTS "Delete from design-assets" ON storage.objects;
CREATE POLICY "Delete from design-assets"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'design-assets');

-- ============================================================
-- REALTIME: Enable on collaboration tables
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE recipes;
ALTER PUBLICATION supabase_realtime ADD TABLE batch_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE section_locks;
ALTER PUBLICATION supabase_realtime ADD TABLE brands;

-- ═══════════════════════════════════════════════════════════════
-- VERIFICATION: Run this block to confirm everything exists
-- ═══════════════════════════════════════════════════════════════
SELECT 'workspaces table' as check_item,
       count(*)::text as result
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'workspaces'
UNION ALL
SELECT 'templates table',
       count(*)::text
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'templates'
UNION ALL
SELECT 'recipes table',
       count(*)::text
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'recipes'
UNION ALL
SELECT 'batch_jobs table',
       count(*)::text
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'batch_jobs'
UNION ALL
SELECT 'section_locks table',
       count(*)::text
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'section_locks'
UNION ALL
SELECT 'brands table',
       count(*)::text
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'brands'
UNION ALL
SELECT 'assets table',
       count(*)::text
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'assets'
UNION ALL
SELECT 'design-assets bucket',
       count(*)::text
FROM storage.buckets WHERE id = 'design-assets';

-- All results should show '1'.
```

---

## Key Files

| File | Purpose |
|------|---------|
| `INSTALL.md` | ← This file. AI + human zero-to-deploy instructions. |
| `SETUP.md` | Quickstart (shorter, human-only). |
| `SKILL.md` | AI agent skill reference — 259 MCP tools, components, coding standards. Auto-synced with `npm run sync:skill`. |
| `ARCHITECTURE_V2.md` | Deep-dive architecture (V2 HTML/CSS engine). |
| `netlify.toml` | Build command, function bundler, URL redirects. |
| `.env.example` | Template for Supabase credentials. |
| `docs/SUPABASE_MIGRATIONS_DESIGN_HARNESS.sql` | Migration v1 source. |
| `supabase_migrations_v3.sql` | Migration v3 source (assets, storage, RLS). |
