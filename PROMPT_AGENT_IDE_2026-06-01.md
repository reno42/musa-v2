# 🤖 Agent IDE — PROMPT ACTUALIZADO

**De:** Lara | **Fecha:** 2026-06-01 | **Prioridad:** P0

---

## 🔴 P0: Save del editor no persiste (CAUSA REAL ENCONTRADA)

**Archivo:** `src/App.tsx` — `handleSelectTemplate`

**El bug:** La función usa `fetch()` directo a la API, ignorando completamente localStorage. `getTemplate()` en `templateApi.ts` YA tiene la lógica correcta (compara timestamps, prefiere localStorage si es más nuevo), pero `handleSelectTemplate` nunca la llama.

**Fix (1 línea):**
```typescript
// src/App.tsx, función handleSelectTemplate
// CAMBIAR ESTO:
const res = await fetch(`/api/templates/${id}`, { headers: { "x-api-key": "***" } });
const json = await res.json();
if (json.success && json.data) { ... }

// POR ESTO:
const data = await getTemplate(id);
if (data) { 
  dispatch({ type: "OPEN_TEMPLATE", id, json: { width: data.width, height: data.height, canvas: data.canvas, objects: data.canvas?.objects || [] } });
}
```

`getTemplate` ya está importado en línea 11. Solo hay que usarlo.

**Verificación:** Lara confirmó vía Supabase directo que los templates SÍ persisten. El dual-write funciona. La teoría del FK estaba equivocada.

---

## 🟡 Bugs anteriores (ya fixeados)

1. ✅ PropertiesPanel.tsx: `isTextType` incluye `"textbox"` (lowercase)
2. ✅ useCanvas.ts: `Textbox` importado de fabric
3. ✅ Render HTML: `document.fonts.ready` implementado
4. ✅ Google Fonts catalog: completo y deployado

---

## 🟡 Gaps pendientes (para después del P0)

Ver `PROMPT_AGENT_IDE_2026-05-31.md` y `20_PRIORIDADES_MCP.md`

---

**Documentación completa:** `design-main/BUG_SAVE_NO_PERSISTE.md`
