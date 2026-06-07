# 🔴 Frames: Diagnóstico y Gaps (Junio 2026)

**Objetivo:** 1 template = N frames (como Figma). Lara crea todo en lote, Ren abre un solo template y ve todas las variantes.

---

## 🔴 P0 ACTUAL: render_frame no exporta (2026-06-01 04:51)

**Síntoma:** `render_frame` y `POST /api/templates/:id/render {frameId}` devuelven "Frame not found".

**Causa:** `prepareFrameRender()` en `netlify/functions/render.mjs` solo busca en `tpl.frames[]`. Nuestros frames se crean vía `update_template` con objetos en `canvas.objects[]` que tienen `isFrameVisual: true` + `frameId`.

**Fix (15 líneas):** Agregar fallback en `prepareFrameRender()`:
```javascript
function prepareFrameRender(tpl, frameId) {
  // 1. Buscar en tpl.frames[]
  let frame = tpl.frames?.find(f => f.id === frameId);
  
  // 2. Si no está, buscar en canvas.objects[] (isFrameVisual rects)
  if (!frame) {
    const canvasObjs = tpl.canvas?.objects || [];
    const frameObj = canvasObjs.find(o => o.frameId === frameId && o.isFrameVisual);
    if (frameObj) {
      frame = {
        id: frameId,
        name: frameObj.frameName || frameId,
        x: frameObj.left || 0,
        y: frameObj.top || 0,
        width: frameObj.width || 1080,
        height: frameObj.height || 1080,
        fill: frameObj.fill || '#ffffff'
      };
    }
  }
  
  if (!frame) return null;
  // ... resto de la función sin cambios
```

**Template de test:** `tpl_203b1b3d-529` (24 frames en canvas.objects, 168 objetos)
**Editor:** https://bejewelled-llama-a6719d.netlify.app?template=tpl_203b1b3d-529

---

## 🧪 Resultados de pruebas

### Test A: MCP con isFrameVisual
**Resultado:** ✅ Funciona parcialmente  
- Se pueden crear objetos rect con `isFrameVisual: true` + `frameId` + `frameName`
- Los objetos contenido se linkean al frame con `frameId`
- Las posiciones son absolutas (X:0, X:1080, X:2160 para slide 1, 2, 3)
- **PERO:** Son rects con flag, no son "frames" gestionados por el sistema de frames

### Test B: REST API /api/templates/:id/frames
**Resultado:** ❌ 404  
- Las rutas EXISTEN en código (`routes/frames.ts` → frameRoutes)
- Están registradas en `index.ts`: `app.use("/api/templates", frameRoutes)`
- `store.getTemplate()` usa el in-memory store — que NO comparte datos con MCP
- **Causa:** MCP y REST API usan instancias de store separadas (solo convergen en Supabase)

### Test C: Editor
**Resultado:** ⚠️ Parcial  
- Los objetos con `isFrameVisual: true` SÍ aparecen en el canvas como rects coloreados
- El LayersPanel tiene soporte para frames (frameCreate, frameDelete, moveToFrame)
- El Toolbar tiene exportFramePNG, exportAllFramesPNG
- **PERO:** Sin la API de frames funcional, el editor no puede listar/gestionar frames como entidad separada

---

## 🔍 Gaps detallados (código vs realidad)

| Componente | ¿Existe en código? | ¿Funciona? | Gap |
|------------|:---:|:---:|------|
| `routes/frames.ts` | ✅ CRUD completo | ❌ 404 en deploy | MCP y REST usan stores separadas |
| `useCanvas.ts - createFrame()` | ✅ | ⚠️ | Crea en canvas local, no persiste en API |
| `useCanvas.ts - getFrames()` | ✅ | ⚠️ | Solo objetos locales |
| `useCanvas.ts - exportFramePNG()` | ✅ | ⚠️ | Exporta frame del canvas activo |
| `useCanvas.ts - exportAllFramesPNG()` | ✅ | ⚠️ | Recorre frames locales |
| `mcp.mjs - frame tools` | ❌ | ❌ | No hay create_frame, delete_frame, list_frames en MCP |
| `tools/draw - frame mode` | ✅ | ✅ | POST /api/templates/:id/tools/draw tool=frame |
| `store.js - createFrame()` | ✅ | ❌ | In-memory, no dual-write a Supabase |
| `store.js - getTemplate().frames` | ✅ | ❌ | El store de MCP ≠ el store de REST |

---

## 🎯 Lo que se necesita para el workflow de Ren

```
Lara: 1 MCP call → crea template con 5 frames + contenido → Ren abre → ve todo → exporta lote
```

| # | Requisito | MCP Tool necesaria | Estado |
|---|-----------|-------------------|:---:|
| 1 | Crear frames desde MCP | `create_frame(templateId, name, x, y, w, h, fill)` | ❌ No existe |
| 2 | Listar frames | `list_frames(templateId)` | ❌ No existe |
| 3 | Borrar frame | `delete_frame(templateId, frameId)` | ❌ No existe |
| 4 | Agregar objetos a un frame | `update_template` con frameId en objetos | ✅ Funciona (con isFrameVisual) |
| 5 | Exportar todos los frames a PNG | `export_all_frames(templateId)` | ❌ No existe en MCP |
| 6 | Store unificado (MCP ↔ REST) | Mismo Supabase + in-memory | ❌ Stores separadas |
| 7 | Editor renderiza frames | useCanvas.ts ya lo tiene | ✅ (parcial) |

---

## 🔧 Fixes prioritarios (Agent IDE)

### P0: Unificar stores
MCP y REST API deben compartir la misma instancia de store. Actualmente `mcp.mjs` tiene su propia lógica de dual-write mientras que `api.mjs` (Express) usa `services/store.js`. Solución: MCP debe llamar al mismo store que la REST API.

### P0: Wirear frameRoutes correctamente
Las rutas existen pero devuelven 404 porque el store no tiene el template. Al unificar stores, deberían funcionar.

### P1: Exponer frame tools en MCP
Agregar a `mcp.mjs`:
- `create_frame(templateId, name, x, y, width, height, fill)` → llama a store.createFrame()
- `list_frames(templateId)` → llama a store.getTemplate().frames
- `delete_frame(templateId, frameId)` → llama a store.deleteFrame()

### P1: Export lote desde MCP
`export_all_frames(templateId, format)` → renderiza cada frame a PNG (usa render_batch o server-side render)

---

## 📂 Archivos relevantes
- `api/src/routes/frames.ts` — rutas de frames (CRUD, existen pero no andan)
- `api/src/index.ts` — registro de rutas (frameRoutes está registrado)
- `api/src/services/store.ts` — store in-memory (NO unificado con MCP)
- `netlify/functions/mcp.mjs` — MCP server (no tiene frame tools)
- `netlify/functions/api.mjs` — Express bridge (usa el store de services/)
- `src/hooks/useCanvas.ts` — frame management en frontend
- `src/components/LayersPanel.tsx` — UI de frames
