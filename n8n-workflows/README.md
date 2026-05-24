# Futuraria Design — API & n8n Integration Guide

## Architecture

```
┌─────────────┐     Webhooks      ┌─────────────┐
│  Futuraria  │ ─────────────────→ │    n8n      │
│   Editor    │                    │  Workflows  │
│  (Netlify)  │ ←───────────────── │  (Railway)  │
└─────────────┘     API Calls     └─────────────┘
       │
       │ API
       ▼
┌─────────────┐
│  Supabase   │
│  (Storage)  │
└─────────────┘
```

## API Endpoints

### Templates
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/templates` | List all templates |
| POST | `/api/templates` | Create template |
| GET | `/api/templates/:id` | Get template |
| PUT | `/api/templates/:id` | Update template |
| DELETE | `/api/templates/:id` | Delete template |
| POST | `/api/templates/:id/duplicate` | Duplicate template |

### Design Export
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/templates/:id/render` | Render template to PNG/JPG/SVG |
| GET | `/api/templates/:id/render/:renderId` | Check render status |
| GET | `/api/templates/:id/css` | Export CSS stylesheet (JSON or raw CSS) |
| POST | `/api/templates/:id/batch` | Validate batch design CSV against template |
| POST | `/api/templates/:id/auto-rename` | Generate rename plan for batch processing |

### Webhooks
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/webhooks` | List webhooks |
| POST | `/api/webhooks` | Register webhook |
| DELETE | `/api/webhooks/:id` | Delete webhook |

### Other
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/styles` | List styles |
| GET | `/api/components` | List components |
| GET | `/api/comments?templateId=:id` | List comments |
| GET | `/api/templates/:id/versions` | List versions |

## Webhook Events

When events happen in Futuraria, webhooks fire to your registered URLs:

| Event | Payload |
|-------|---------|
| `template.created` | `{ id, name, canvas, layers, metadata }` |
| `template.updated` | `{ id, name, canvas, layers, metadata }` |
| `render.complete` | `{ id, templateId, format, url, width, height }` |
| `render.failed` | `{ id, templateId, format, error }` |
| `version.created` | `{ id, templateId, versionNumber, data }` |
| `comment.created` | `{ id, templateId, author, text, x, y }` |
| `layer.updated` | `{ templateId, layer }` |
| `style.created` | `{ id, name, type }` |
| `component.created` | `{ id, name }` |

## n8n Setup

### 1. Import Workflows
In n8n, go to **Workflows → Import** and upload:
- `01-webhook-receiver.json` — Receives all Futuraria events
- `02-api-manager.json` — Manages templates via API
- `03-design-export.json` — Export designs on demand

### 2. Set Environment Variables
In n8n, add these credentials:

```
FUTURARIA_API_URL=https://your-app.netlify.app
FUTURARIA_API_KEY=your-api-key
```

### 3. Register Webhooks
From Futuraria, register your n8n webhook URL:

```bash
curl -X POST "https://your-app.netlify.app/api/webhooks" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-n8n.up.railway.app/webhook/futuraria-events",
    "events": ["template.created", "render.complete", "export.complete", "comment.created"]
  }'
```

### 4. Trigger Export via n8n
From n8n, call the render API:

```
POST https://your-app.netlify.app/api/templates/{templateId}/render
Body: { "format": "png", "scale": 2 }
```

Or get CSS directly:
```
GET https://your-app.netlify.app/api/templates/{templateId}/css?format=css
```

## Export Pipeline (Client → API → n8n)

1. **User designs** in Futuraria Editor
2. **API renders** canvas to PNG/SVG via Puppeteer (or direct SVG generation)
3. **API stores** result in Supabase Storage (design-exports bucket)
4. **API fires webhook** `render.complete` with render data
5. **n8n receives** webhook and processes the image/SVG
6. **n8n stores** result (Supabase, S3, email, etc.)

## Example: Export and Email

n8n workflow:
1. Webhook Trigger (futuraria-events)
2. Wait for `render.complete` event
3. Send email with image attachment
4. Log to Google Sheets

## Supabase Tables

The API uses these tables (create via `supabase-setup.sql`):

- `templates` — Design templates (id, name, data JSONB, user_id, timestamps)
- `api_keys` — API keys with SHA-256 hashed keys (id, user_id UUID, key_hash, key_prefix, permissions, expires_at, active)
- `render_logs` — Render job tracking (id, template_id, status, format, url, error)
- `webhooks` — Registered webhook URLs (id, url, events, secret, user_id, active)
- `styles` — Design styles (id, name, type, data JSONB)
- `components` — Component library (id, name, data JSONB)
- `comments` — Design comments with threads (id, template_id, x, y, author, text, thread JSONB, resolved)
- `template_versions` — Version history snapshots (id, template_id, version_number, data JSONB, author, message)
- `variables` — Design tokens / variables (id, template_id, data JSONB with collections+variables+bindings)
- `design-exports` — Storage bucket for rendered images (public read, service_role write)
