# Futuraria Design Harness

**An AI-first design editor.** Connect any AI agent (Claude Code, OpenClaw, Qoder, Cursor) and it starts designing — creating, editing, and exporting HTML/CSS designs via MCP tools. The UI is secondary; every capability is an MCP endpoint first.

Deployed at **[design.futuraria.com](https://design.futuraria.com)** on every push to `main`.

## Quickstart

```bash
git clone https://github.com/reno42/design.git
cd design
npm install
cd api && npm install && cd ..
cp .env.example .env
# Edit .env with your Supabase credentials (free tier works)
npm run dev:all
```

Open [http://localhost:5173](http://localhost:5173) — the dashboard works in memory without Supabase. Add Supabase credentials for persistence across restarts.

## Architecture

```
Browser / AI Agent
  │
  ▼
Vite Dev Server (:5173)        API Server (:3001)
  ├── React SPA                ├── REST API (/api/*)
  └── proxies /api → :3001     ├── MCP JSON-RPC (/mcp)
                                ├── Supabase (PostgreSQL)
                                └── In-memory fallback
```

- **MCP-first**: 100+ tools via JSON-RPC — any AI agent can create, edit, render, and batch designs
- **Dual-write persistence**: Supabase when configured, in-memory fallback when not
- **Frame-based canvas**: Multi-frame HTML/CSS surfaces with Shadow DOM rendering
- **Netlify auto-deploy**: Push to `main` → `design.futuraria.com`

## Documentation

| Document | What it covers |
|---|---|
| [INSTALL.md](./INSTALL.md) | Step-by-step setup with Supabase PAT, Netlify deployment, and MCP configuration |
| [SKILL.md](./SKILL.md) | Complete AI agent skill reference — all tools, workflows, and architecture |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System architecture and design decisions |
| [PLAN_EDITOR_CORE.md](./PLAN_EDITOR_CORE.md) | Editor stability roadmap (DocumentStore, incremental sync, selection model) |
| [PLAN_EDITOR_PRO.md](./PLAN_EDITOR_PRO.md) | Professional editor feature parity plan |
| [PLAN_PRODUCTO.md](./PLAN_PRODUCTO.md) | Product growth: metrics, onboarding, cover flow |

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | For persistence | Supabase project URL (data CRUD) |
| `SUPABASE_SERVICE_KEY` | For persistence | Server-side `service_role` key |
| `SUPABASE_ANON_KEY` | For SaaS login | Public anon key delivered to the browser at runtime |
| `VITE_SUPABASE_URL` | Optional | Real-time collaboration (browser) |
| `VITE_SUPABASE_ANON_KEY` | Optional | Real-time collaboration (browser) |
| `SAAS_INITIAL_OWNER_EMAIL` | Optional | Explicit account allowed to claim pre-SaaS workspaces |
| `API_KEY` | Optional | MCP API key (default: `dev-key`) |

**No Supabase?** The editor works fully in memory — data is lost on server restart. Add the `SUPABASE_*` variables for cloud persistence.

## License

MIT — see [LICENSE.md](./LICENSE.md)
