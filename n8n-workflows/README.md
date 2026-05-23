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
| POST | `/api/templates/:id/export` | Get export data (for rendering) |
| POST | `/api/templates/:id/export/upload` | Upload rendered image |
| GET | `/api/templates/:id/export/svg` | Download as SVG |

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
| `render.complete` | `{ id, templateId, format, template }` |
| `export.complete` | `{ id, templateId, format, imageData, width, height }` |
| `export.requested` | `{ id, templateId, format, canvas, layers }` |
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
From n8n, call the export API:

```
POST https://your-app.netlify.app/api/templates/{templateId}/export
Body: { "format": "png", "scale": 2 }
```

Or get SVG directly:
```
GET https://your-app.netlify.app/api/templates/{templateId}/export/svg
```

## Export Pipeline (Client → API → n8n)

1. **User designs** in Futuraria Editor
2. **Client renders** canvas to PNG/SVG using Fabric.js
3. **Client uploads** to `/api/templates/:id/export/upload`
4. **API fires webhook** `export.complete` with image data
5. **n8n receives** webhook and processes the image
6. **n8n stores** result (Supabase, S3, email, etc.)

## Example: Export and Email

n8n workflow:
1. Webhook Trigger (futuraria-export)
2. Wait for `export.complete` event
3. Send email with image attachment
4. Log to Google Sheets

## Supabase Tables

The API uses these tables (create via `supabase-setup.sql`):

- `templates` — Design templates
- `webhooks` — Registered webhooks
- `api_keys` — API keys (hashed)
- `styles` — Design styles
- `components` — Component library
- `comments` — Design comments
- `template_versions` — Version history
