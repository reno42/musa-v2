# 🤖 Agent IDE — Prompt Final: Siguientes Pasos

**De:** Lara | **Fecha:** 2026-06-01 06:26 GMT-5

---

## ✅ Lo que YA funciona (no tocar)

- 37 MCP tools operativas en `https://futuraria.netlify.app/mcp`
- Render con `document.fonts.ready` + Syne/Inter
- `render_frame` con fallback a `canvas.objects[]` (isFrameVisual)
- Google Fonts catalog (94 fonts)
- `update_template` con 168 objetos en una sola llamada
- `create_frame` × N + `update_template` con `frameId`
- Editor: 20 estilos en un solo template (21600×1080px, 20 frames)
- PropertiesPanel: `isTextType` incluye `"textbox"`

---

## 🔴 P0 — Implementar AHORA

### 1. handleSelectTemplate use getTemplate()
**Archivo:** `src/App.tsx` ~línea 153
```
fetch(`/api/templates/${id}`) → getTemplate(id)
```
`getTemplate()` ya está importado. Compara localStorage vs API y prefiere el más nuevo.
**Sin esto:** los cambios de Ren se pierden al recargar.

### 2. snapshot_template(templateId)
Nuevo MCP tool. Guarda estado actual del template como referencia en sesión (no Supabase).
```javascript
case "snapshot_template": {
  const tpl = await templates.getTemplate(params.templateId);
  if (!tpl) throw { code: -32000, message: "Template not found" };
  store.snapshot(params.templateId, JSON.parse(JSON.stringify(tpl)));
  return { snapshotted: true, templateId: params.templateId };
}
```

### 3. diff_template(templateId)
Compara estado actual vs snapshot. Retorna lista de cambios objeto por objeto.
```javascript
case "diff_template": {
  const current = await templates.getTemplate(params.templateId);
  const snap = store.getSnapshot(params.templateId);
  if (!snap) throw { code: -32000, message: "No snapshot found" };
  const diffs = compareTemplates(snap, current);
  return { templateId: params.templateId, changes: diffs };
}
```

### 4. Supabase dual-write fix
Los templates creados vía MCP no persisten en Supabase (solo en store in-memory).
Cold-start de Netlify Function = datos perdidos.
**Fix:** Asegurar que `create_template` y `update_template` en MCP usen `templates.updateTemplate()` con write a Supabase, no solo `store.*`.

---

## 🟡 P1 — Siguientes

### 5. Gradientes en transform_object
`transform_object` soporte `fillGradient: { type, stops, angle }` → Fabric.js Gradient.

### 6. Text shadows en texto
`transform_object` con `shadow: { color, blur, offsetX, offsetY }` en textbox.

### 7. Font weights 100-900 en render HTML
Actualmente solo 400,500,700,800 cargados. Agregar 100,200,300,600,900.

### 8. Imágenes de fondo en render HTML
`FabricImage.fromURL` en el render para objetos `type: 'image'`.

---

## 🧠 Skills de Diseñador (futuro)

### 9. apply_style(templateId, styleName)
Aplica reglas de diseño predefinidas a un template.

### 10. extract_patterns(templateId)
Analiza refinamientos de Ren vs original de Lara, extrae reglas recurrentes, genera skill JSON.

---

## 📂 Archivos actualizados en el repo

| Archivo | Contenido |
|---------|-----------|
| `LICENSE.md` | MIT + CC BY 4.0 + Commercial |
| `ARCHITECTURE.md` | Stack completo, 37 tools, quickstart |
| `MCP_IMPROVEMENTS.md` | Roadmap P0/P1/P2 + skills |
| `GAPS_FRAMES.md` | Frame system gaps + fix aplicado |
| `BUG_SAVE_NO_PERSISTE.md` | Diagnóstico del save bug |
| `BUGS_DESIGN_REPLICATION.md` | Bugs encontrados en replicación |
| `20_PRIORIDADES_MCP.md` | Roadmap original |
| `POSICIONAMIENTO_OPEN_SOURCE.md` | Estrategia de lanzamiento |

---

## 🎯 Template de test

`tpl_280cea6d-429` — 20 estilos Futuraria, 183 objetos, 20 frames

**Orden de implementación:** 1 → 2 → 3 → 4 → 5 → 6
