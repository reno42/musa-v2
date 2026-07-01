# 🏗️ Futuraria Design — Arquitectura

> **⚠️⚠️⚠️ ESTE DOCUMENTO ESTÁ OBSOLETO Y DEPRECADO ⚠️⚠️⚠️**
>
> Este documento describe la **versión 1 (Fabric.js)** del editor. La versión actual (V2) es un editor **full web HTML/CSS** sin Fabric.js.
>
> 📄 **Ver documentación actualizada:** [`ARCHITECTURE_V2.md`](./ARCHITECTURE_V2.md)
>
> **Diferencias clave:**
> - ❌ Fabric.js v6 → ✅ Shadow DOM + iframe (HTML/CSS puro)
> - ❌ CanvasEditor → ✅ EditorV2 + DesignFrame
> - ❌ 37 MCP tools → ✅ 100+ MCP tools
> - ❌ PropertiesPanel → ✅ HtmlContextualPanel
> - ❌ useCanvas hook → ✅ DesignFrame + InfiniteHtmlCanvas
>
> **No confiar en la información de este documento.** Usar ARCHITECTURE_V2.md como fuente de verdad.

---

**Autor:** Renzo Perez Bartra / Futuraria  
**Licencia:** MIT + CC BY 4.0 | **Stack:** $0/mes Freemium

---

## 🎯 Qué es

> ⚠️ DESACTUALIZADO: La descripción a continuación corresponde a la V1 (Fabric.js).

Un editor de diseño WYSIWYG con 37 herramientas MCP para agentes de IA. Crea templates por código, editalos visualmente, exporta a PNG. El primer "Mini-Figma" con agentes de IA integrados vía MCP, completamente open source y freemium.

---

## 📐 Arquitectura General

```
┌──────────────────────────────────────────────────────────────┐
│                    NETLIFY FREE ($0)                         │
│                                                              │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ Editor       │  │ REST API     │  │ MCP Server        │  │
│  │ React 18     │  │ Express      │  │ JSON-RPC + SSE    │  │
│  │ Fabric.js v6 │  │ 15+ routes   │  │ 37 tools          │  │
│  │ Vite          │  │ Rate-limited  │  │ Agent-first       │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬──────────┘  │
│         │                 │                    │              │
│         └─────────────────┼────────────────────┘              │
│                           │                                   │
└───────────────────────────┼───────────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              │     SUPABASE FREE ($0)    │
              │     PostgreSQL 500MB      │
              │     templates table       │
              │     workspaces table      │
              └───────────────────────────┘
```

---

## 🛠️ Stack Técnico

| Capa | Tecnología | Plan | Costo |
|------|-----------|------|:---:|
| **Hosting** | Netlify | Free | $0 |
| **Frontend** | React 18 + TypeScript + Vite | — | $0 |
| **Canvas** | Fabric.js v6 | MIT | $0 |
| **Backend** | Express + Netlify Functions | Free | $0 |
| **Database** | Supabase PostgreSQL | Free (500MB) | $0 |
| **Auth** | API Keys + Supabase Auth | Free | $0 |
| **MCP** | JSON-RPC 2.0 + SSE | Custom | $0 |
| **Render** | Fabric.js StaticCanvas (client-side) | — | $0 |
| **Google Fonts** | 94 fonts catalog | Free API | $0 |
| **Total** | | | **$0/mes** |

---

## 🔌 MCP Tools (37)

### Templates & Workspaces (14)
`list/create/get/update/delete/duplicate/export/import` para workspaces y templates  
`batch_update` `render_batch` `list_versions` `restore_version`

### Transform & Objects (13)
`transform_object` `draw_shape` `add_text` `add_image` `upload_image` `delete_objects`  
`reorder_object` `align_objects` `distribute_objects` `group_objects` `ungroup_objects`  
`copy_object` `duplicate_object`

### Advanced (5)
`add_svg_path` `boolean_operation` `auto_layout`

### Frames (5)
`create_frame` `list_frames` `get_frame` `update_frame` `delete_frame`

### Fonts (2)
`list_fonts` `search_google_fonts`

### Render (1)
`render_frame` — Renderiza un frame individual a HTML con Download PNG/JPG/SVG

---

## 🎨 Flujo de Diseño

```
LARA (IA Agent)                    REN (Human Designer)
───────────────                    ────────────────────
1. create_template(name, ws)       
2. update_template(id, objects)    
3. create_frame × N                
4. add_text / draw_shape × N       
   ─────────────────────────→      5. Open editor link
                                   6. Visual refinement
                                   7. Auto-save to localStorage
   ←─────────────────────────      8. "Done, Larita"
9. render_frame × N                
10. Export to PNG folder           
11. Schedule in Meta Business      
```

---

## 📂 Estructura del Proyecto

```
design-main/
├── src/                    # Frontend React + Fabric.js
│   ├── App.tsx             # Router, useReducer
│   ├── components/         # Dashboard, CanvasEditor, Toolbar
│   │   ├── PropertiesPanel # 14 property fields
│   │   ├── LayersPanel     # Frame management
│   │   └── BatchAMator     # Batch generation (3 modes)
│   ├── hooks/              # useCanvas (689 lines), useAutoSave
│   └── lib/                # templateApi, supabase
├── api/                    # Express API
│   └── src/
│       ├── routes/         # 17 route files
│       ├── services/       # templates, store, supabase, renderer
│       └── middleware/     # auth, rateLimit, validate
├── netlify/functions/
│   ├── api.mjs             # Express → Netlify bridge
│   ├── mcp.mjs             # MCP server (37 tools)
│   └── render.mjs          # Frame render (600+ lines)
├── LICENSE.md              # MIT + CC BY 4.0
├── GAPS_FRAMES.md          # Frame system gaps
├── BUG_SAVE_NO_PERSISTE.md # Save persistence bug
└── 20_PRIORIDADES_MCP.md   # Feature roadmap
```

---

## 🚀 Quickstart

```bash
git clone https://github.com/reno42/design
cd design-main
npm install
npm run dev
# Editor: http://localhost:5173
# MCP: http://localhost:5173/mcp
# API: http://localhost:5173/api
```

---

## 🌍 Deployment

```bash
# Push to GitHub → Netlify auto-deploys
git push origin main
# Production: https://futuraria.netlify.app
# MCP: https://futuraria.netlify.app/mcp
```

---

## 📊 Métricas

| Métrica | Valor |
|---------|-------|
| MCP Tools | 37 |
| REST API Routes | 15+ |
| Google Fonts | 94 |
| React-Doctor Score | 100/100 |
| Templates creados en test | 50+ |
| Frames máximos en 1 template | 24 (probado) |
| Objetos máximos | 168 (probado) |
| Costo infraestructura | $0/mes |
