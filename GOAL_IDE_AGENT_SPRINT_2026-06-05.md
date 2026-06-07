# 🎯 /goal — Agent IDE Sprint: Design Editor → Mini-Figma MVP

> **📅 Fecha:** 2026-06-05 02:00 GMT-5
> **👤 Preparado por:** Lara (OpenClaw)
> **🎯 Objetivo:** Cerrar los 5 gaps críticos + 2 bugs para que el Design Editor funcione como Mini-Figma
> **📦 Repo:** `C:\Users\Renzo\.openclaw\workspace\design-main` → GitHub: `reno42/design`
> **🚀 Deploy:** Netlify → `https://bejewelled-llama-a6719d.netlify.app`

---

## 🔍 ANÁLISIS DE CÓDIGO — Lo que encontré

### Estructura del repo
```
design-main/
├── src/                          ← Frontend React 18 + Vite + Fabric.js
│   ├── App.tsx                   ← Router dashboard/editor, keyboard shortcuts
│   ├── lib/
│   │   ├── templateApi.ts        ← getTemplate(), updateTemplate(), localStorage fallback
│   │   └── supabase.ts           ← apiFetch() helper
│   ├── hooks/
│   │   ├── useCanvas.ts          ← 860+ lines: canvas init, tools, history, frames, export
│   │   └── useAutoSave.ts        ← Dual-write: localStorage + API PUT, debounced 2s
│   └── components/
│       ├── CanvasEditor.tsx       ← Main canvas wrapper
│       ├── PropertiesPanel.tsx    ← Object properties + GoogleFontPicker
│       ├── GoogleFontPicker.tsx   ← Font catalog with search + dynamic loading
│       ├── LayersPanel.tsx        ← Layer list + frame controls
│       ├── Dashboard.tsx          ← Template list + workspaces
│       ├── Toolbar.tsx            ← Tools, export, align, distribute, boolean ops
│       ├── BatchAMator.tsx        ← Batch render UI
│       └── ...
├── api/src/                       ← Express API (backend)
│   ├── routes/                    ← 13 route files (templates, fonts, render, frames, etc.)
│   │   ├── fonts.ts              ← Font catalog endpoint
│   │   ├── render.ts             ← POST /api/templates/:id/render
│   │   └── frames.ts             ← Frame CRUD
│   ├── services/
│   │   ├── store.ts              ← In-memory store + template CRUD
│   │   ├── templates.ts          ← Template service (Supabase + store dual-write)
│   │   ├── supabase.ts           ← Supabase client
│   │   └── renderer.ts           ← Puppeteer render engine
│   └── middleware/
│       ├── auth.ts               ← API key auth
│       └── rateLimit.ts          ← Rate limiting
└── netlify/functions/
    ├── api.mts                    ← Express wrapper for Netlify Edge
    ├── mcp.mjs                    ← 40+ MCP tools (JSON-RPC)
    └── render.mjs                 ← Render edge function
```

---

## ✅ LO QUE YA FUNCIONA BIEN

| # | Funcionalidad | Estado | Detalle |
|---|--------------|--------|---------|
| 1 | **handleSelectTemplate** | ✅ ARREGLADO | `App.tsx:159` usa `getTemplate(id)` con localStorage comparison. El bug documentado en MEMORY.md ya fue corregido. |
| 2 | **Autosave dual-write** | ✅ Robusto | `useAutoSave.ts` guarda a localStorage primero, luego PUT a API. Si API falla, datos persisten en localStorage. Debounce 2s. |
| 3 | **MCP 40+ tools** | ✅ Completo | `mcp.mjs` tiene tools para templates, shapes, text, images, transform, align, distribute, snapshots, diffs, frames, fonts, render. |
| 4 | **transform_object con gradientes** | ✅ MCP | Acepta `fillGradient: { type, angle, colorStops }` e inyecta en el objeto como relleno complejo. |
| 5 | **search_google_fonts** | ✅ MCP | Catálogo de 94 Google Fonts hardcodeado en `mcp.mjs:1900-2100`. |
| 6 | **GoogleFontPicker component** | ✅ UI | `GoogleFontPicker.tsx` existe con fetch a `/api/fonts/catalog`, carga dinámica de fuentes, y UI de búsqueda. |
| 7 | **Batch render** | ✅ MCP | `render_batch` tool devuelve links de render para múltiples templates. |
| 8 | **Snapshots + Diffs** | ✅ MCP | `snapshot_template`, `diff_template`, `snapshot_auto`, `diff_snapshots` — sistema de versionado completo. |
| 9 | **Toolbar completo** | ✅ UI | Align, distribute, boolean ops, auto-layout, export PNG/SVG/JSON/frames. |

---

## 🔴 GAPS — Lo que hay que construir/arreglar

### 🔴 P0 — CRÍTICO: Editor visual inutilizable para diseñadores

| # | Gap | Archivo(s) afectado(s) | Lo que hay que hacer |
|---|-----|----------------------|---------------------|
| **G1** | **Google Font Picker no está conectado al PropertiesPanel para texto** | `PropertiesPanel.tsx:303-320` | El GoogleFontPicker component existe y está importado, pero NO se renderiza para objetos de texto. Solo muestra un `<select>` vacío o el nombre hardcodeado. **Wirear GoogleFontPicker en la sección de texto.** |
| **G2** | **Color Picker existe solo como `<input type="color">` básico** | `PropertiesPanel.tsx` | Funciona para colores sólidos pero no tiene soporte visual para gradientes ni opacidad por capa. El MCP sí soporta gradientes vía `transform_object`. **Agregar UI de gradiente en PropertiesPanel (tipo, ángulo, color stops) y opacidad.** |
| **G3** | **Border Radius (rx/ry) solo visible para rects** | `PropertiesPanel.tsx:114` (`fieldRx`) | Solo muestra un campo "Radius" para `rx`. `ry` usa el mismo valor o 0. Funciona en Fabric.js nativo pero la UI está limitada. **Exponer rx y ry como campos independientes en PropertiesPanel.** |
| **G4** | **Imágenes: no hay upload ni URL input en el editor** | `Toolbar.tsx`, `useCanvas.ts` | El tool "image" existe en el enum pero no tiene UI para ingresar URL o subir archivo. El MCP sí tiene `add_image` y `upload_image`. **Agregar modal/dialog para añadir imagen por URL o upload.** |
| **G5** | **Gradientes: sin UI en el editor** | `PropertiesPanel.tsx` | El MCP soporta gradientes vía `fillGradient` en `transform_object`, pero el PropertiesPanel no tiene controles para crear/editar gradientes. **Agregar sección de gradiente en fill (tipo linear/radial, ángulo, color stops).** |

### 🟡 P1 — IMPORTANTE: Funcionalidad incompleta

| # | Gap | Archivo(s) afectado(s) | Lo que hay que hacer |
|---|-----|----------------------|---------------------|
| **G6** | **Frames system incompleto** | `api/src/services/store.ts`, `mcp.mjs`, `useCanvas.ts` | Los frames se crean vía `create_frame` tool pero se guardan en `frames[]` del template (no en `canvas.objects`), por lo que el editor no los renderiza consistentemente. La metodología que SÍ funciona es `update_template` con objetos `isFrameVisual:true`. **Unificar frames como objetos visuales en el canvas, no como entidad separada.** |
| **G7** | **render_frame MCP tool ausente** | `mcp.mjs` | El MCP tiene `render_batch` que renderiza el canvas entero, pero no hay tool para renderizar un frame individual. La REST API en `render.ts` ya soporta `POST /api/templates/:id/render` con `{ frameId }`. **Agregar `render_frame` tool al MCP que use el endpoint existente.** |

### 🟢 P2 — NICE TO HAVE

| # | Gap | Detalle |
|---|-----|---------|
| **G8** | **No hay UI para subir imágenes desde archivo local** | El MCP tiene `upload_image` con base64. Falta la UI en el editor. |
| **G9** | **No hay text alignment visible en PropertiesPanel** | `textAlign` existe en Fabric.js pero no en la UI. |
| **G10** | **No hay previsualización de Google Fonts en el picker** | El `GoogleFontPicker` carga fuentes pero el preview en el dropdown no muestra la fuente real. |

---

## 🗺️ RUTAS DE ARCHIVOS — Lo que el Agent IDE necesita saber

### Archivos a MODIFICAR (P0):

| Archivo | Cambio | Prioridad |
|---------|--------|:---:|
| `src/components/PropertiesPanel.tsx` | Wirear GoogleFontPicker para objetos texto, agregar UI de gradiente, exponer border-radius rx/ry separados, agregar opacidad, mejorar color picker | 🔴 P0 |
| `src/components/Toolbar.tsx` | Agregar botón "Add Image" con modal para URL/upload | 🔴 P0 |
| `src/hooks/useCanvas.ts` | Agregar `addImageFromURL(url)` y `addImageFromBase64(data)` methods | 🔴 P0 |
| `netlify/functions/mcp.mjs` | Agregar `render_frame` tool | 🟡 P1 |
| `src/components/CanvasEditor.tsx` | Wirear nuevos métodos de imagen | 🟡 P1 |
| `api/src/services/store.ts` | Unificar frames como objetos canvas (isFrameVisual) | 🟡 P1 |

### Archivos de REFERENCIA (NO modificar, solo leer):

| Archivo | Para qué sirve |
|---------|---------------|
| `src/lib/templateApi.ts` | API client con localStorage fallback — entender cómo funciona getTemplate/updateTemplate |
| `src/lib/supabase.ts` | apiFetch() wrapper — auth con x-api-key |
| `src/hooks/useAutoSave.ts` | Sistema de autosave dual-write — referencia para no romper |
| `netlify/functions/api.mjs` | Express wrapper para Netlify — entender cómo se sirve la API |
| `api/src/routes/render.ts` | Endpoint de render con soporte de frameId — base para render_frame MCP tool |
| `api/src/routes/fonts.ts` | Endpoint de catálogo de fuentes |
| `api/src/services/templates.ts` | Servicio de templates con Supabase + store dual-write |
| `api/src/services/store.ts` | Store in-memory — entender frames[] vs canvas.objects |

---

## 🏗️ ARQUITECTURA DE DATOS — Entender el flow

```
EDITOR (Frontend)                    API (Backend)                   MCP
───────────────                      ─────────────                   ───
App.tsx                              api.mts (Express)               mcp.mjs (JSON-RPC)
  │                                    │                               │
  ├─ handleSelectTemplate(id)          ├─ GET /api/templates/:id       ├─ get_template(id)
  │  └─ getTemplate(id)                │  └─ templates.getTemplate()   │  └─ templates.getTemplate()
  │     ├─ apiFetch(GET /api/...)      │     ├─ store.getTemplate()    │     ├─ store (memory)
  │     └─ localStorage fallback       │     └─ supabase fallback      │     └─ supabase fallback
  │                                    │                               │
  ├─ CanvasEditor                      ├─ PUT /api/templates/:id      ├─ update_template(id, canvas)
  │  ├─ useAutoSave (2s debounce)      │  └─ store + supabase          │  └─ store + supabase
  │  │  ├─ saveLocal(id, payload) ✅    │     dual-write                │     + autoSnapshot
  │  │  └─ apiFetch(PUT /api/...) ✅   │                               │
  │  └─ useCanvas (Fabric.js)          ├─ POST /api/templates/:id/render  ├─ render_batch(ids)
  │     ├─ canvas objects[]            │  └─ renderer.render()            │  └─ links de render
  │     └─ pushHistory() (undo/redo)   │     └─ Puppeteer                 │
  │                                    │                               │
  └─ PropertiesPanel                   ├─ GET /api/fonts/catalog       ├─ search_google_fonts()
     ├─ GoogleFontPicker (importado    │  └─ lista de 94 fonts         │  └─ hardcoded 94 fonts
     │   pero NO wireado a texto ❌)   │                               │
     ├─ Color picker (básico)          └─ POST /mcp (POST handler)     └─ transform_object()
     └─ Border radius (solo rx)                                        └─ fillGradient support ✅
```

---

## 📐 RPC MAP — Métodos disponibles vs usados

### Canvas Methods (useCanvas.ts → expuestos vía window.__canvasControls)

| Method | Expuesto en Toolbar | Usado en PropertiesPanel |
|--------|:---:|:---:|
| `setTool(tool)` | ✅ | ❌ |
| `zoomIn/zoomOut/zoomToFit` | ✅ | ❌ |
| `undo/redo` | ✅ | ❌ |
| `exportPNG/SVG/JSON` | ✅ | ❌ |
| `align(direction)` | ✅ | ❌ |
| `distribute(direction)` | ✅ | ❌ |
| `autoLayout()` | ✅ | ❌ |
| `booleanOp(op)` | ✅ | ❌ |
| `createFrame/deleteFrame/renameFrame` | ✅ LayersPanel | ❌ |
| `getFrames/getFrameCount` | ✅ | ❌ |
| `exportFramePNG/exportAllFramesPNG` | ✅ | ❌ |
| `pushHistory()` | ✅ (auto) | ✅ (via onUpdate) |
| **Faltante: `addImageFromURL(url)`** | ❌ | ❌ |
| **Faltante: `addImageFromBase64(data)`** | ❌ | ❌ |

### MCP Methods (mcp.mjs)

| Tool | Input | Output | Usado por |
|------|-------|--------|-----------|
| `list_templates` | workspaceId, search, limit, offset | { data[], total } | Dashboard, Lara |
| `get_template` | id | template con objects, frames, styles | Editor, Lara |
| `create_template` | name, workspaceId, w, h | template | Dashboard, Lara |
| `update_template` | id, canvas, name, objects | template | AutoSave, Lara |
| `delete_template` | id | { deleted } | Dashboard, Lara |
| `duplicate_template` | id, name | template | Dashboard, Lara |
| `batch_update` | templateIds, canvas, objects | { updated, results[] } | Lara |
| `render_batch` | templateIds, format, scale | links de render | Lara |
| `transform_object` | templateId, targetLayerName, fillGradient, shadow, font*, etc. | objeto modificado | Lara |
| `draw_shape` | templateId, tool, x, y, w, h, fill, stroke | shape object | Lara |
| `add_text` | templateId, text, x, y, fontSize, fontFamily | text object | Lara |
| `add_image` | templateId, src, x, y, w, h | image object | Lara |
| `upload_image` | templateId, base64, name, x, y | image object | Lara |
| `delete_objects` | templateId, layerNames | { removed[], count } | Lara |
| `search_google_fonts` | search, category, limit | { fonts[], categories[] } | Lara, FontPicker |
| **Faltante: `render_frame`** | templateId, frameId, format, scale | viewUrl | Lara |

---

## 🎯 SPRINT PLAN — Orden de implementación

### DÍA 1: Google Fonts + Color Picker (3-4h)
- [ ] **G1:** Wirear `GoogleFontPicker` en `PropertiesPanel.tsx` para objetos texto (~30 min)
  - En la sección de texto (cuando `isTextType === true`), reemplazar el input de fontFamily por `<GoogleFontPicker>`
  - El componente YA existe y funciona en `GoogleFontPicker.tsx`
- [ ] **G5 parcial:** Mejorar color picker — agregar campo de opacidad y toggle sólido/gradiente (~1h)
- [ ] **G5:** Agregar UI de gradiente en PropertiesPanel (~2h)
  - Select: tipo (linear/radial), angle slider (0-360), color stops (mínimo 2, máximo 5)
  - Usar `fillGradient` → `commit("fill", gradientObject)`

### DÍA 2: Border Radius + Imágenes (3-4h)
- [ ] **G3:** Separar rx/ry en PropertiesPanel para rects (~30 min)
- [ ] **G4:** Agregar método `addImageFromURL(url)` en `useCanvas.ts` (~1h)
- [ ] **G4:** Agregar modal "Add Image" en Toolbar con input URL + opción upload (~1.5h)
- [ ] **G4:** Wirear upload de imagen (base64 → FabricImage) (~1h)

### DÍA 3: Frames + Render Frame + QA (3-4h)
- [ ] **G6:** Unificar frames como objetos `isFrameVisual:true` en canvas.objects (~2h)
  - En `store.ts`, migrar lógica de `create_frame` para generar objetos visuales
  - En `useCanvas.ts`, asegurar que `createFrame` genera el rect visual + objetos hijos
- [ ] **G7:** Agregar `render_frame` tool al MCP (~30 min)
  - Usar el endpoint existente `POST /api/templates/:id/render` con `{ frameId }`
- [ ] **QA:** Probar todo el pipeline: crear template → editar visualmente → guardar → recargar → verificar persistencia (~30 min)

---

## ⚠️ REGLAS PARA EL AGENTE IDE

1. **LEER los archivos de referencia antes de tocar cualquier cosa**
2. **NO romper el sistema de autosave dual-write** (useAutoSave.ts)
3. **NO cambiar la estructura de canvas.objects** (Fabric.js JSON)
4. **Mantener compatibilidad con MCP tools existentes**
5. **Usar las variables CSS del tema oscuro actual** (`#0a0a14` bg, `#e4e4f0` text)
6. **NO instalar nuevas dependencias** sin consultar
7. **Commits atómicos** — un commit por gap
8. **Probar en local** con `npm run dev` antes de pushear

---

## 📊 VERIFICACIÓN POST-IMPLEMENTACIÓN

- [ ] Seleccionar texto en editor → aparece GoogleFontPicker con search
- [ ] Cambiar fuente → se renderiza en canvas con la nueva fuente
- [ ] Seleccionar rect → aparece rx y ry como campos separados
- [ ] Cambiar rx/ry → se renderiza con bordes redondeados
- [ ] Click "Add Image" → modal con URL input → imagen aparece en canvas
- [ ] Propiedades de objeto → opacidad slider funcional
- [ ] Propiedades de objeto → gradiente (linear/radial) se aplica
- [ ] Crear frame → aparece como rect visual en canvas
- [ ] `render_frame` MCP tool → devuelve URL de render
- [ ] Editar → guardar → recargar → **los cambios persisten** (prueba del save)

---

## 🔗 LINKS ÚTILES

- **Repo:** https://github.com/reno42/design
- **Deploy:** https://bejewelled-llama-a6719d.netlify.app
- **MCP:** https://bejewelled-llama-a6719d.netlify.app/mcp
- **Editor local:** http://localhost:5173
- **Fabric.js docs:** http://fabricjs.com/docs/
- **Google Fonts API:** https://developers.google.com/fonts/docs/developer_api
