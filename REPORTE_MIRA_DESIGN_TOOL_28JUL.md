# 🟢 REPORTE MIRA — Design Tool Status

**Fecha:** 28 Julio 2026
**Diagnosticado por:** Mira (Hermes — orquestadora)

---

## ✅ BUENAS NOTICIAS: El MCP ESTÁ VIVO

El problema NO era el código. Era la URL.

| URL | Estado |
|-----|--------|
| `futuraria.netlify.app/mcp` | ❌ Caído (devuelve HTML de Webflow) |
| **`bejewelled-llama-a6719d.netlify.app/mcp`** | ✅ **VIVO** — 100+ tools respondiendo |

La URL correcta (`bejewelled-llama-a6719d.netlify.app`) YA está configurada en Hermes (`config.yaml → mcp_servers.design-tool.url`). El API key `fdr_ws_beIyGjsGSdlRMU2W4nj4jostikL_sS_f` está en `.env`.

**Lo que falló antes:** Los `tool_call` de Hermes a las MCP tools del Design Tool estaban timeout (300s). Probablemente porque la URL anterior (`futuraria.netlify.app`) ya no resuelve al Design Tool, sino al sitio Webflow de marketing.

---

## 🔧 Diagnóstico técnico

### Causa raíz
El subdominio `futuraria.netlify.app` fue reclamado/sobrescrito por el sitio Webflow de marketing. El Netlify site original del Design Tool ahora solo existe en `bejewelled-llama-a6719d.netlify.app`.

### Verificación
```
POST bejewelled-llama-a6719d.netlify.app/mcp → 200 OK, JSON-RPC válido
  ├── tools/list → 100+ herramientas documentadas
  ├── create_template, create_html_frame, add_element, etc.
  └── set_frame_layers, generate_design_artifacts, render_batch
```

### Servicios verificados
- **API REST** (`/api/templates`): ✅ Funciona
- **MCP JSON-RPC** (`/mcp`): ✅ Funciona
- **Editor UI** (`/`): ✅ SPA carga
- **Netlify Functions**: ✅ api.mjs + mcp.mjs activas

---

## 🟡 PENDIENTE: Intentar el diseño "Data Grid System"

Con el MCP funcionando, YA se puede crear el diseño que Ren pidió al inicio de la sesión. El task está documentado en `Desktop/data-grid-system-task.md`.

### Prueba 28 Julio — Instagram Post "Qué hace Futuraria"

**Objetivo:** Crear un post 1080x1080 para Instagram explicando qué hace Futuraria.

**Flujo de diseño (mi lógica como Mira):**
1. La herramienta clave es `import_design` (no `update_html_frame` — esta pide data-layer-id en cada elemento)
2. `create_template` con `engine: "html"` → auto-crea Frame 1
3. `import_design` con `html` + `css` separados → aplica el diseño en 1 paso
4. El diseño usa: fondo negro #0a0a0a, acento verde #CDFE36, tipografía Syne+Inter, badge superior, headline con palabra clave en verde, 4 cards de servicios en grid 2x2, CTA verde

**Resultado:** ✅ Template `tpl_61e35118-7df` creado y renderizado.

**Lecciones aprendidas:**
- URL correcta: `bejewelled-llama-a6719d.netlify.app/mcp`
- Workspace correcto: `ws_user_8e9f031817184e0ab205` (no `ws_c2ba06df-226`)
- `import_design` es la herramienta para diseños completos (visual fidelity > editability)
- NO usar `update_html_frame` para diseños nuevos — requiere flat editability
- `futuraria.netlify.app` está caído/sobrescrito por Webflow

**Ver:** https://bejewelled-llama-a6719d.netlify.app/?templateId=tpl_61e35118-7df

---

## 📊 Estado general del Design Tool

| Componente | Estado |
|------------|--------|
| MCP Server (mcp.mjs) | ✅ Operativo |
| API REST (api.mjs) | ✅ Operativo |
| Supabase persistence | ✅ Configurado |
| Editor V2 UI | ✅ Carga |
| Templates DB | ✅ ws_c2ba06df-226 activo |
| Netlify Deploy | ✅ Último build exitoso |
| Dominio futuraria.netlify.app | ❌ Apunta a Webflow, no al Design Tool |

---

## 🔗 Referencias
- MCP URL correcta: `https://bejewelled-llama-a6719d.netlify.app/mcp`
- API Key: en `.env` como `DESIGN_TOOL_API_KEY`
- Workspace principal: `ws_c2ba06df-226`
- Repo: `design-main/`
