# 🩺 QA: Auditoría Design Tool — 18 Junio 2026

> **Contexto:** El IDE Agent completó múltiples sprints (Fase 0-6, EditorV2, Supabase, realtime). Ren abre la herramienta y ve la UI igual. Lara audita.

---

## 🔴 Hallazgo Crítico: EditorV2 está construido pero no conectado

### El problema en una frase
**EditorV2 (HTML/CSS engine) existe, es funcional, pero NADIE lo conectó al Dashboard. La UI solo rutea al editor Fabric.js viejo.**

### Evidencia

**`App.tsx`** (línea 28): `EditorV2` está importado.
**`App.tsx`** (línea 39): `view: "editor-v2"` existe en el state.
**`App.tsx`** (línea 186-192): El routing a EditorV2 EXISTE:
```tsx
if (view === "editor-v2") {
  return <EditorV2 templateId={templateId!} onBack={...} />;
}
```

**PERO:**

- Dashboard (`handleCreateTemplate`, línea 153) → dispara `OPEN_TEMPLATE` → Fabric.js ❌
- Dashboard (`handleSelectTemplate`, línea 167) → dispara `OPEN_TEMPLATE` → Fabric.js ❌
- La ÚNICA forma de llegar a EditorV2: URL param `?template=xxx&v=2` (línea 177)
- Dashboard.tsx: **CERO** referencias a EditorV2 u `OPEN_TEMPLATE_V2`
- No hay botón, toggle, ni detección de tipo de template

---

## 🟡 Hallazgos por área

### 1. Dashboard → Editor routing

| Path | Dispatch | Editor | ¿Funciona? |
|------|----------|--------|-----------|
| Crear template nuevo | `OPEN_TEMPLATE` | Fabric.js | ✅ |
| Seleccionar template | `OPEN_TEMPLATE` | Fabric.js | ✅ |
| URL `?template=x&v=2` | `OPEN_TEMPLATE_V2` | EditorV2 | ✅ |
| **Desde la UI normal** | — | EditorV2 | ❌ NO EXISTE |

### 2. EditorV2 (lo que SÍ funciona)

Probado vía MCP: creé template HTML, le puse HTML+CSS, EditorV2 lo carga y renderiza correctamente:

- ✅ CodePanel (Monaco editor HTML + CSS)
- ✅ HtmlCanvas (iframe preview con zoom)
- ✅ GoogleFontPicker (selector de fuentes con @import)
- ✅ Auto-save (debounce 2s → PUT /api/templates/:id)
- ✅ Realtime polling (cada 5s detecta cambios externos)
- ✅ Active agents indicator (dot verde)
- ✅ Click en elemento → navega al CSS selector

### 3. Render pipeline

| Motor | MCP tool | ¿Genera PNG? | Detalle |
|-------|----------|-------------|--------|
| Fabric.js | `render_batch` | Browser-side | HTML page con Fabric.js CDN → auto-download PNG |
| HTML/CSS | `render_html_template` | Browser-side | HTML page con SVG foreignObject → auto-download PNG |
| **Ninguno** | — | **Server-side** | ❌ No hay Puppeteer/Sharp. Netlify 50MB limit |

- `render_html_template` MCP devuelve `url: ""` porque el pipeline espera una URL de PNG generado en servidor, pero el render entrega HTML
- El endpoint `/api/templates/:id/render` POST sí funciona → devuelve job con HTML en el body
- El view URL del job (`/api/templates/:id/render/:jobId`) devuelve el HTML page
- Para obtener PNG real: abrir el HTML en browser → el JS interno genera canvas y auto-descarga

### 4. App.tsx — Doble motor sin switch

```tsx
// Editores disponibles
type ViewMode = "dashboard" | "editor" | "editor-v2";

// PERO handleCreateTemplate solo abre Fabric:
dispatch({ type: "OPEN_TEMPLATE", ... }) // ← siempre Fabric.js

// PERO handleSelectTemplate solo abre Fabric:
dispatch({ type: "OPEN_TEMPLATE", id, json: ... }) // ← siempre Fabric.js

// EditorV2 está huérfano. Solo accesible por URL.
```

### 5. MCP Tools — 126 operativas

Probé: `list_workspaces`, `create_workspace`, `create_template`, `set_html`, `set_css`, `get_template_structure`, `generate_from_prompt`, `list_templates`. Todas responden correctamente via Netlify.

Template HTML creado vía MCP: `tpl_69b206a5-b70` — HTML + CSS completos almacenados y recuperables.

---

## 🟢 Lo que sí funciona

- 126 MCP tools — 100% operativas
- EditorV2 completo con CodePanel + HtmlCanvas + Fonts + AutoSave + Realtime
- API REST (`/api/templates`, `/api/workspaces`, etc.)
- Supabase con migrations aplicadas
- Realtime polling para colaboración
- Active agents indicator
- Fabric.js editor legacy (CanvasEditor, Layers, Properties, Frames)

---

## 🔧 Fix requerido (mínimo para que Ren vea el cambio)

### P0: Conectar Dashboard → EditorV2

1. **En `Dashboard.tsx`**: Agregar botón "Open in HTML Editor" o detectar `engine: "html"` en el template y rutear a EditorV2
2. **En `handleCreateTemplate`**: Agregar opción de crear template HTML (con `engine: "html"`)
3. **En `handleSelectTemplate`**: Si `template.engine === "html"` → `OPEN_TEMPLATE_V2` en vez de `OPEN_TEMPLATE`

```tsx
// handleSelectTemplate fix:
const handleSelectTemplate = async (id: string) => {
  const d = await getTemplate(id);
  if (d?.engine === "html") {
    dispatch({ type: "OPEN_TEMPLATE_V2", id });
    return;
  }
  // ... existing Fabric.js path
};
```

### P1: Render server-side (opcional, requiere Puppeteer)

Mover render a un servicio externo con Puppeteer/Sharp para PNG real server-side. Netlify free tier no soporta.

---

## 📁 Archivos clave auditados

| Archivo | Rol | Estado |
|---------|-----|--------|
| `src/App.tsx` | Router principal | Tiene routing a EditorV2 pero sin switch desde UI |
| `src/pages/EditorV2.tsx` | Editor HTML/CSS | ✅ Completo y funcional |
| `src/components/HtmlCanvas.tsx` | Preview iframe | ✅ Renderiza HTML+CSS |
| `src/components/CodePanel.tsx` | Monaco code editor | No auditado directamente |
| `src/components/Dashboard.tsx` | Dashboard | ❌ Sin routing a EditorV2 |
| `src/components/CanvasEditor.tsx` | Fabric.js editor | ✅ Legacy funcional |
| `netlify/functions/render.mjs` | Render pipeline | ✅ Genera HTML, no PNG |
| `netlify/functions/mcp.mjs` | MCP server | ✅ 126 tools operativas |

---

> ✨ *Lara — 18 Junio 2026, 19:30 GMT-5*
