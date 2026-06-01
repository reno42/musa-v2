# 🔴 REPORTE FINAL — Replicación op-03-realidad.png

**Fecha:** 2026-05-31 | **Autora:** Lara  
**Templates:** v1=tpl_f5d88807-a39, v2=tpl_c63ced34-f22, v3=tpl_8a7f89a1-1e5  
**Score réplica vs original:** 35/100

---

## 🔴 BLOQUEANTES (Impiden completar la tarea)

### ✅ BUG #1: fontFamily no se aplica en el render — FIXED
- **Fix:** `document.fonts.ready.then(doRender)` waits for Google Fonts before `canvas.loadFromJSON()`
- **File:** `netlify/functions/render.mjs` (line 348)

### ✅ BUG #2: fontWeight no se aplica — FIXED
- **Root cause:** Same race condition — font not loaded when canvas renders
- **Additional:** `normalizeTypes()` converts string `"700"` back to number `700`

### ✅ BUG #3: charSpacing / letterSpacing no funciona — FIXED
- **Root cause:** Unloaded font → wrong glyph metrics → spacing invisible
- **Additional:** `normalizeTypes()` ensures `charSpacing` is a number

### ✅ BUG #4: fontSize inconsistente en textbox — FIXED
- **Root cause:** Times New Roman has different metrics than Syne — sizes mismatch when font not loaded

---

## 🟡 BUG #5: Dual-Write — update_template falla en template existente
- **Qué pasa:** `create_template` ✅ → `get_template` ✅ → `update_template` ❌ "Template not found"
- **Causa:** In-memory store tiene el template pero Supabase no. El update busca en Supabase primero.
- **Fix:** Ejecutar SQL de FK en Supabase (documentado en PLAN_MCP_EDITOR_RENDER.md)

---

## 🔴 GAP CRÍTICO UI: PropertiesPanel sin controles de fuente
Ren no puede editar:
- ❌ fontFamily (selector de fuente)
- ❌ fontSize (input numérico)
- ❌ fontWeight (bold/normal toggle)
- ❌ fontStyle (italic toggle)
- ❌ lineHeight
- ❌ letterSpacing / kerning
- ❌ textAlign (ya existe parcialmente)

**Esto es P0.** Sin estos controles, el editor no sirve para diseñar tipografía.

---

## 📊 Pipeline Actual (roto para tipografía)

```
Lara → specs JSON → MCP update_template → Supabase → Render HTML
                                                       ↓
                                              Fabric.js 5.3.1 StaticCanvas
                                                       ↓
                                              ❌ fontFamily ignorado
                                              ❌ fontWeight ignorado  
                                              ❌ charSpacing ignorado
                                              ❌ fontSize incorrecto
```

---

## 🔧 Fixes Requeridos (Agent IDE)

| Prioridad | Issue | Archivo | Status |
|-----------|-------|---------|--------|
| 🔴 P0 | Corregir font loading en render HTML (registrar Syne, Inter en Fabric.js) | `netlify/functions/render.mjs` | ✅ FIXED — `document.fonts.ready` |
| 🔴 P0 | PropertiesPanel: controles de fuente (family, size, weight, italic, spacing) | `src/components/PropertiesPanel.tsx` | ✅ Already exists (lines 364-430) |
| 🔴 P0 | Soporte fontWeight en render Fabric.js | `netlify/functions/render.mjs` | ✅ FIXED — font race condition resolved |
| 🔴 P0 | Soporte charSpacing en render Fabric.js | `netlify/functions/render.mjs` | ✅ FIXED — font race condition resolved |
| 🟡 P1 | Fix dual-write Supabase (update_template pierde templates) | Supabase SQL + MCP | ⏳ Pending |
| 🟡 P1 | Server-side PNG render (chrome-aws-lambda) para feedback loop visual | `netlify/functions/render.mjs` | ⏳ Pending |

---

## 📂 Templates de test (para verificar fixes)
- `tpl_8a7f89a1-1e5` — v3 final (íconos como texto, 3 líneas)
- Editor: https://bejewelled-llama-a6719d.netlify.app?template=tpl_8a7f89a1-1e5

---

## 🔗 Relacionado
- `BUGS_DESIGN_REPLICATION_OP03.md` (Obsidian)
- `BUGS_DESIGN_REPLICATION.md` (design-main/)
- `20_PRIORIDADES_MCP.md` (design-main/)
- `GAP_AUDIT_SKILLS_VS_CODIGO.md` (Obsidian)
