# 🤖 Agent IDE — Dual Snapshot + ISO 42001

**Goal:** Implementar sistema de doble snapshot (IA vs Humano) con trazabilidad completa, alineado a ISO 42001:2023.

---

## 1. snapshot_auto(templateId, type, trigger, canvas)

Nuevo MCP tool. Reemplaza al snapshot_template manual existente.

```javascript
snapshot_auto(templateId, type, trigger)
// type: "ia" | "human" | "system"
// trigger: "update_template" | "autosave" | "beforeunload" | "idle" | "visibility" | "manual"
// Guarda en store y en Supabase (templates.data.versions[])
// Máximo 50 snapshots por template
// Auto-borra los más antiguos cuando excede el límite
```

## 2. Timeline UI — Governance Panel

Nuevo componente `GovernancePanel.tsx`:

```
┌─────────────────────────────────────────┐
│ 🕐 Timeline — Nombre del template       │
│─────────────────────────────────────────│
│ 13:24 🤖 Lara creó 8 objetos            │
│ 13:25 👤 Ren editó "headline"           │
│ 13:25 👤 Ren movió CTA pill             │
│ 13:30 ⚙️ Sistema: inactividad           │
│─────────────────────────────────────────│
│ [Ver diff] [Restaurar] [Exportar JSON]  │
└─────────────────────────────────────────┘
```

- Iconos: 🤖 IA | 👤 Humano | ⚙️ Sistema
- Al hacer click en un snapshot → diff contra el anterior
- Botón "Restaurar" → vuelve a ese estado
- Botón "Exportar JSON" → descarga el snapshot

## 3. Triggers automáticos

**Desde el Editor (useAutoSave.ts o CanvasEditor.tsx):**
- Después de cada autoSave exitoso → `snapshot_auto(id, "human", "autosave")`
- `window.addEventListener('beforeunload', ...)` → `snapshot_auto(id, "human", "beforeunload")` con `keepalive: true`
- `document.addEventListener('visibilitychange', ...)` → `snapshot_auto(id, "system", "paused")`
- Timer de inactividad 5 minutos → `snapshot_auto(id, "system", "idle")`

**Desde el MCP (mcp.mjs):**
- Cada `update_template`, `create_frame`, `transform_object`, `add_text`, `draw_shape`, `delete_objects` → `snapshot_auto(id, "ia", toolName)`

## 4. Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| `mcp.mjs` | Agregar `snapshot_auto` tool + auto-disparo en cada write |
| `api/src/services/store.ts` | `snapshotAuto()` con límite 50 |
| `src/components/GovernancePanel.tsx` | NUEVO — Timeline UI |
| `src/App.tsx` | Agregar GovernancePanel al layout |
| `src/hooks/useAutoSave.ts` | Disparar snapshot_auto en cada save |

## 5. Referencia ISO 42001

Ver `design-main/ISO42001_READINESS.md` para el mapeo completo.
Con este feature cubrimos: trazabilidad (A.7), awareness (7.3), monitoreo (9.1), control operacional (8.1).
