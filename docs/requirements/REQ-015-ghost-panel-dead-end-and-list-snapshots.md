# REQ-015 — Ghost feature V1 muerto: GhostPanel llama 4 tools inexistentes y no está montado

- **Status:** Done (implementado 27 Ago 2026)
- **Priority:** P2 — dead end que confunde a agentes de IA (regla cero dead-ends del proyecto)
- **Files:**
  - `src/components/GhostPanel.tsx` — ELIMINADO
  - `netlify/functions/mcp.mjs` — nueva tool `list_snapshots` (definición junto a `list_versions`/`restore_version`, case en el switch)

---

## Problema

Detectado durante el análisis de REQ-014: `GhostPanel.tsx` (L105) llamaba `list_snapshots`, una tool que **no existe** en `mcp.mjs`. La investigación completa mostró que el feature "ghost layer" es un artefacto V1 incompleto:

1. Ninguna de las 4 tools que invoca existe: `ghost_show`, `ghost_diff`, `ghost_merge`, `list_snapshots` (solo `update_template` existe).
2. Nunca se crean snapshots `type:"human"`: `snapshotAuto` solo se llama con `"ia"` desde `autoSnapshot`, así que el flujo de merge habría fallado igual ("No human snapshot to merge from").
3. El componente no está montado en ninguna página — solo auto-referencias, ni en `src/` ni en `packages/`.

## Causa raíz

Feature V1 (ghost layer para diff/merge humano-vs-IA) que quedó a medio construir: el panel frontal se escribió contra un backend que nunca se implementó. Es exactamente el tipo de dead end que la regla del proyecto prohíbe — un agente que encuentra el componente asume que las tools existen y pierde ciclos.

## Solución

1. **Eliminar `GhostPanel.tsx`** — cero referencias en todo el repo, puro dead end (regla cero dead-ends).
2. **Implementar `list_snapshots` como tool real** — no por el panel (eliminado), sino porque post-REQ-014 los snapshots viven solo en memoria y no había forma de descubrirlos; `restore_version` (fallback memoria) acepta sus ids. La respuesta OMITE el campo `data` — cada entry es una copia completa del diseño (higiene de payload).

## Verificación

1. `tools/list` incluye `list_snapshots` (catálogo pasa a 241 tools).
2. `list_snapshots({templateId})` tras una mutación IA (invocación warm) → entries con id/type/trigger/timestamp/frameCount, sin `data`.
3. `restore_version({templateId, versionId: <snap_id>})` → restaura con `source:"memory"`.
4. Build sin referencias rotas a GhostPanel.

## Implementación (27 Ago 2026)

- `GhostPanel.tsx` eliminado.
- `list_snapshots` agregada a `mcp.mjs`: definición de tool + case handler sobre `store.listSnapshots` (nuevo-primero), sin `data`.
