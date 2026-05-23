# Futuraria Design

AI-first design tool with REST API, webhooks, and n8n integration for content automation.

## Architecture

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

## Packages

| Package | Description | Deploy |
|---------|-------------|--------|
| `packages/editor` | React + Fabric.js visual editor | Netlify |
| `packages/api` | Express REST API + Puppeteer renderer | Railway |
| `packages/shared` | Shared types and schemas | — |

## Quick Start

```bash
# Install dependencies
npm install

# Start editor (frontend)
npm run dev:editor

# Start API (backend)
npm run dev:api
```

## API Endpoints (MVP)

```bash
# Templates
POST   /api/templates                    # Create template
GET    /api/templates                    # List templates
GET    /api/templates/:id                # Get template JSON
PUT    /api/templates/:id                # Update template
DELETE /api/templates/:id                # Delete template
POST   /api/templates/:id/duplicate      # Clone template

# Layers
PATCH  /api/templates/:id/layers/:name   # Modify layer (text, image, color)

# Render
POST   /api/templates/:id/render         # Render to PNG/JPG

# Webhooks
POST   /api/webhooks                     # Register webhook
```

## n8n Integration Example

```json
POST /api/templates/tpl_abc/render
{
  "format": "png",
  "scale": 2,
  "overrides": {
    "layers": {
      "headline": { "text": "Summer Sale!" },
      "product_image": { "imageUrl": "https://cdn.example.com/product.jpg" }
    }
  },
  "webhookUrl": "https://n8n.example.com/webhook/render-done"
}
```

## Stack

- **Frontend:** React 18, Vite, Fabric.js 6, TypeScript
- **Backend:** Express, Puppeteer, Supabase JS
- **Render:** Headless Chromium via Puppeteer (best font fidelity)
- **Storage:** Supabase (templates, assets, renders)

## License

MIT
