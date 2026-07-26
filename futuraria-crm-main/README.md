# Futuraria CRM

CRM interno para gestión de leads, pipeline de ventas y automatización de procesos.

## Stack

- **Frontend**: Next.js 14 (App Router) + Tailwind CSS + TypeScript
- **Backend**: Supabase (PostgreSQL + Auth + RLS)
- **Hosting**: Netlify (frontend) + Railway (n8n)
- **Email**: Resend
- **Booking**: Cal.com
- **Automations**: n8n Community Edition

## Setup

### 1. Supabase

1. Crear proyecto en [supabase.com](https://supabase.com)
2. Ejecutar las migraciones en orden:
   - `supabase/migrations/001_initial_schema.sql`
3. Copiar las keys del dashboard → Settings → API

### 2. Variables de entorno

```bash
cp .env.example .env.local
# Editar con tus valores reales
```

### 3. Instalar y correr

```bash
npm install
npm run dev
```

### 4. Deploy a Netlify

```bash
# Conectar repo a Netlify
# Build command: npm run build
# Publish directory: .next
```

## Estructura

```
src/
├── app/              # Páginas (App Router)
│   ├── dashboard/    # Dashboard principal
│   ├── leads/        # Gestión de leads
│   ├── contacts/     # Contactos
│   └── api/          # API routes + webhooks
├── components/       # Componentes React
├── lib/              # Utilidades y clientes
└── types/            # TypeScript types
```

## API Endpoints

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/leads` | Listar leads |
| POST | `/api/leads` | Crear lead |
| GET | `/api/leads/[id]` | Detalle de lead |
| PATCH | `/api/leads/[id]` | Actualizar lead |
| POST | `/api/webhooks/n8n` | Webhook para n8n |

## n8n Integration

El webhook en `/api/webhooks/n8n` acepta:

```json
{
  "event": "lead.created",
  "data": { "lead_id": "uuid", "email": "..." },
  "signature": "hmac-sha256"
}
```

Eventos soportados:
- `lead.created` — Nuevo lead registrado
- `lead.updated` — Lead actualizado
- `lead.qualified` — Lead calificado
- `deal.created` — Nuevo deal creado
- `deal.won` — Deal ganado
