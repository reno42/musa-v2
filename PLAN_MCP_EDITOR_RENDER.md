# 🔧 Plan: MCP + Editor + Render — Freemium Pipeline

**Objetivo:** Lara crea diseños vía MCP → se guardan en Supabase → Ren los abre en el editor web → edita manualmente → renderiza a PNG. Como Obsidian pero para diseños.

**Meta:** $0/mes. Todo en Netlify Free + Supabase Free.

---

## ✅ Lo que YA funciona

| Componente | Estado | URL |
|------------|:---:|------|
| **Editor web** (Fabric.js) | ✅ Deployed | `https://bejewelled-llama-a6719d.netlify.app` o `https://futuraria.netlify.app` |
| **MCP server** (10 tools) | ✅ 10/10 | `https://bejewelled-llama-a6719d.netlify.app/mcp` |
| **API REST** (CRUD) | ✅ Parcial | `/api/workspaces`, `/api/templates` |
| **Supabase** (persistencia) | ⚠️ FK rota | `qqqcmtwzyaejlzffivri.supabase.co` |
| **Render local** (Puppeteer) | ✅ Funciona | `render.js` en `crm/` |
| **Render server-side** | ❌ Falta | No deployed |

---

## 🔴 Lo que falta (3 tareas)

### 1. Arreglar Supabase `user_id` (5 min — Ren)

```sql
-- Ejecutar en Supabase SQL Editor
ALTER TABLE public.templates DROP CONSTRAINT IF EXISTS templates_user_id_fkey;
ALTER TABLE public.templates ALTER COLUMN user_id TYPE uuid USING user_id::uuid;
ALTER TABLE public.templates ADD CONSTRAINT templates_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
```

**Sin esto**, los templates creados vía MCP no tienen dueño real y Ren no los ve en el editor.

---

### 2. Agregar render endpoint al deploy (Agent IDE — 30 min)

Crear 1 archivo en `netlify/functions/render.mjs`:

```javascript
// Renderiza templates a PNG usando chrome-aws-lambda
// POST /api/render/:templateId
// Tiempo: ~5s para un frame 1080×1080 (dentro del límite de 10s de Netlify)
```

**Dependencias a instalar:**
- `chrome-aws-lambda` (~44MB comprimido, cabe en Netlify Function de 50MB)
- `puppeteer-core`

**Endpoints que agrega:**
```
POST /api/templates/:id/render  → renderiza a PNG (scale 1-4)
GET  /api/templates/:id/render/:jobId → estado del job
```

**Costo: $0.** `chrome-aws-lambda` es open source. Netlify Free da 125K invocaciones/mes.

---

### 3. Sincronizar MCP → Editor (Agent IDE — 15 min)

Cuando Lara crea un template vía MCP:
- Se guarda en Supabase con `user_id` del dueño
- El editor lo ve en el dashboard al refrescar
- Ren abre, edita, guarda

**Esto YA debería funcionar** una vez arreglado el FK de Supabase. Solo falta verificarlo.

---

## 📐 Arquitectura final

```
┌─────────────┐     MCP (JSON-RPC)      ┌──────────────┐
│   Lara      │ ──────────────────────→ │  Netlify     │
│  (OpenClaw) │ ←────────────────────── │  Functions   │
└─────────────┘     templates JSON      └──────┬───────┘
                                               │
┌─────────────┐     Editor web          ┌──────┴───────┐
│    Ren      │ ──────────────────────→ │   Supabase   │
│  (humano)   │ ←────────────────────── │  (PostgreSQL)│
└─────────────┘     drag & drop         └──────┬───────┘
                                               │
┌─────────────┐     POST /render        ┌──────┴───────┐
│   PNG       │ ←────────────────────── │   chrome-    │
│   1080×1080 │                        │   aws-lambda  │
└─────────────┘                        └──────────────┘
```

---

## 💰 Costo mensual

| Recurso | Plan | Costo |
|---------|------|:----:|
| Netlify (hosting + functions) | Free | $0 |
| Supabase (database) | Free (500MB) | $0 |
| chrome-aws-lambda | Open source | $0 |
| MCP server | Incluido en Netlify | $0 |
| **TOTAL** | | **$0** |

---

## 📁 Archivos a modificar

| Archivo | Qué |
|---------|-----|
| `netlify/functions/render.mjs` | **NUEVO** — endpoint de renderizado server-side |
| `package.json` | Agregar `chrome-aws-lambda`, `puppeteer-core` |
| `netlify.toml` | Agregar redirect `/api/render/*` → `/.netlify/functions/render` |
| Supabase SQL | Corregir FK de `templates.user_id` |

---

## ⚠️ Limitaciones del plan freemium

| Límite | Valor | ¿Nos afecta? |
|--------|-------|:---:|
| Netlify Function timeout | 10 segundos | ⚠️ Render debe ser <10s (con chrome-aws-lambda toma ~5s) |
| Netlify Function size | 50MB | ⚠️ chromium pesa ~44MB, cabe justo |
| Supabase DB size | 500MB | ✅ Templates son JSON, pesan KBs |
| Netlify bandwidth | 100GB/mes | ✅ Un PNG de 200KB × 1000 renders = 200MB |

---

## 📋 Orden de ejecución

1. **Ren:** Ejecutar SQL en Supabase (FK fix)
2. **Agent IDE:** Crear `netlify/functions/render.mjs` + deploy
3. **Lara:** Probar pipeline completo: crear template → Ren abre → Lara renderiza → PNG
