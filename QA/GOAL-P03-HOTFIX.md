# 🎯 /goal — P0.3 HOTFIX: create_frame roto

> **Fecha:** 2026-06-07 | **Preparado por:** Lara (OpenClaw)
> **Causa:** store.createFrame() retorna undefined en cold start de Netlify Edge Functions
> **Repro:** `mcporter call '...create_frame' name="test"` → -32000 "Failed to create frame"

---

## 🔍 DIAGNÓSTICO

**Commit:** 7281a28 (P0.3 fix original)
**Archivo:** `netlify/functions/mcp.mjs` — handler `create_frame`

**Flujo actual (roto):**
```
1. templates.getTemplate(id) → tpl cargado de Supabase ✅
2. store.createFrame(id, data) → busca en Map en memoria → undefined ❌
3. if (!frame) throw -32000 ❌
```

**Causa raíz:** Netlify Edge Functions son serverless. En cold start, `store.templates` Map está vacío. `store.createFrame()` solo funciona si el template ya fue cargado en el store (estado previo de la misma instancia Lambda). `templates.getTemplate()` usa un fallback que carga de Supabase si el store está vacío, pero `store.createFrame()` NO tiene ese fallback.

---

## 🔧 FIX: Bypassear store.createFrame()

El template YA está cargado vía `templates.getTemplate()`. Crear el frame directamente sobre `tpl` sin pasar por el store:

```js
case "create_frame": {
  const tpl = await templates.getTemplate(params.templateId);
  if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };

  // 1. Create frame metadata DIRECTLY on tpl (bypass store cold-start issue)
  const frameId = `frame_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const frame = {
    id: frameId,
    templateId: params.templateId,
    name: params.name,
    x: params.x || 0, y: params.y || 0,
    width: params.width || 400, height: params.height || 300,
    fill: params.fill || "#ffffff",
    opacity: 1, order: (tpl.frames || []).length,
    objects: [],
    parentFrameId: params.parentFrameId || null,
  };
  if (!tpl.frames) tpl.frames = [];
  tpl.frames.push(frame);[…]

  // 2. Create visual object in canvas.objects
  const visualObj = {
    type: "rect",
    layerName: `frame_visual_${frameId}`,
    frameId,
    isFrameVisual: true,
    frameName: frame.name,
    frameFill: frame.fill,
    left: frame.x, top: frame.y,
    width: frame.width, height: frame.height,
    fill: frame.fill,
    stroke: "#6366f1", strokeWidth: 1,
    rx: 0, ry: 0, scaleX: 1, scaleY: 1, angle: 0, opacity: 1, visible: true,
  };
  if (!tpl.canvas) tpl.canvas = { objects: [], viewport: { x: 0, y: 0, zoom: 1 } };
  if (!tpl.canvas.objects) tpl.canvas.objects = [];
  tpl.canvas.objects.push(visualObj);

  // 3. Persist in one operation
  await templates.updateTemplate(params.templateId, {
    frames: tpl.frames,
    canvas: tpl.canvas,
  });
  autoSnapshot(params.templateId, "create_frame");

  // 4. Return frameId consistently (BUG-011 fix)
  return {
    frameId,
    name: frame.name,
    x: frame.x, y: frame.y,
    width: frame.width, height: frame.height,
    fill: frame.fill,
    parentFrameId: frame.parentFrameId,
  };
}
```

**Cambio clave:** Reemplazar `store.createFrame(...)` por creación directa del objeto frame sobre `tpl`. Eliminar `if (!frame) throw`.

**Archivos a modificar:** Solo `netlify/functions/mcp.mjs` — handler `create_frame`

**Riesgo de BD:** CERO — mismo schema, misma operación, mismo updateTemplate.

**Tiempo estimado:** 15 minutos.

---

## ⚠️ NOTA PARA QODER

El método `store.createFrame()` tiene una falla de diseño para Edge Functions serverless. Solo funciona si el template ya existe en el Map en memoria. En cold start, siempre falla.

NO intentes "arreglar" store.createFrame() — eso requeriría refactorizar todo el store para que haga fallback a Supabase. Para este hotfix, bypasséalo como se muestra arriba.
