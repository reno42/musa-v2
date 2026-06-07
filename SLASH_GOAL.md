# 🤖 Agent IDE — SLASH GOAL: Implementación Completa

**Goal:** Cerrar todos los gaps detectados en la sesión 2026-06-01 para operar a nivel profesional (superior a Canva).

---

## 🔴 P0 — Bloqueantes

### 1. Dual Snapshot System + Governance UI
- `snapshot_auto(templateId, type, trigger)` — type: "ia"|"human"|"system"
- `list_snapshots(templateId)` — timeline completo
- `GovernancePanel.tsx` — UI con 🤖👤⚙️, diff, restaurar, exportar JSON
- Auto-triggers: cada write MCP, cada autoSave, beforeunload, visibilitychange, idle 5min
- Límite 50 snapshots/template, auto-borra viejos
- **Alineación ISO 42001:** Ver `ISO42001_READINESS.md` — cubre trazabilidad (A.7), awareness (7.3), monitoreo (9.1), control operacional (8.1)

### 2. Fix: Texto centrado "chueco"
Fabric.js textbox agrega espacio lateral invisible. El centrado dentro del textbox funciona pero el ancho del textbox ≠ ancho visual del texto → se ve descentrado en el canvas.
**Fix:** Investigar si Fabric.js textbox tiene `padding` interno. Probar `padding: 0` en objetos textbox. Si no funciona: calcular `_textWidth` real y ajustar `left` para centrado visual.

### 3. Fix: Nombres de objetos se pierden en Supabase
Al serializar/deserializar, `name` y `layerName` se pierden (aparecen como `undefined` en Supabase).
**Fix:** Asegurar que `canvas.toJSON()` incluya `['name','layerName','frameId','isFrameVisual','frameName']` en EXTRA_PROPS.

### 4. Fix: get_template MCP retorna 0 objetos cuando Supabase tiene datos
El MCP `get_template` handler tiene un path de parseo que no encuentra `canvas.objects` en la respuesta de Supabase.
**Fix:** Verificar `rowToTemplate()` en `templates.ts` — confirmar que `data.canvas.objects` se mapea correctamente.

---

## 🟡 P1 — Calidad profesional

### 5. Textbox padding/espaciado lateral
Textbox tiene espacio extra a los lados que afecta layouts. Documentado por Ren como "espacio a los lados".
**Fix:** `padding: 0` por defecto en objetos textbox. O exponer `padding` en PropertiesPanel.

### 6. Gradientes en render HTML
`transform_object` acepta `fillGradient` pero el render HTML no lo procesa.
**Fix:** El `prepareCanvasJson` en render.mjs ya convierte gradientes. Verificar que fabric.js los renderice. Si no: implementar en `svgGradientToFabric`.

### 7. Font weights completos (100-900) en render HTML
Actualmente solo carga 400,500,700,800. Faltan 100,200,300,600,900.
**Fix:** `family=Syne:wght@100;200;300;400;500;600;700;800;900` en `googleFontsLinks()`.

---

## 🟢 P2 — Operación a escala

### 8. Export pipeline automático
`create_template → update_template → render_frame → PNG` en un solo paso.
**Fix:** Nuevo MCP tool `export_frame_png(templateId, frameId)` que devuelva URL del PNG.

### 9. AI Impact Report
Auto-generado al final de cada sesión: "Lara modificó X objetos, Ren aprobó Y".
**Fix:** `generate_impact_report(templateId)` — lee snapshots, genera resumen.

---

## 📂 Archivos de referencia

| Archivo | Contenido |
|---------|-----------|
| `ISO42001_READINESS.md` | Mapeo ISO 42001 |
| `BUG_SAVE_NO_PERSISTE.md` | Diagnóstico save bug |
| `GAPS_FRAMES.md` | Sistema de frames |
| `MCP_IMPROVEMENTS.md` | Roadmap features |
| `ARCHITECTURE.md` | Documentación técnica |
| `LICENSE.md` | Dual license |

---

**Orden de prioridad:** 1 → 2 → 3 → 4 → 5 → 6 → 7
