# REQ-026 — Dogfood QA 24-sep: crash en Tabla, dashboard sin workspace, y cobertura 100% editor + copywriting

> Fuente: dogfood session de QA externo (24-sep) contrastada con el repo y la DB por Hermes.
> Estado de los 4 bugs reportados: 2 confirmados con causa raíz exacta, 1 ya tiene fix parcial en otro componente, 1 no reproducible en código (requiere instrumentación).
> Alcance nuevo pedido por Ren: QA de cobertura 100% del editor (excepto menú Manos/Hands y Video) y de TODOS los módulos de Copywriting — ver §4.

---

## 1. Estado de los bugs del reporte (verificado, no re-diagnosticar)

### BUG-001 — `y.acceptance.map is not a function` al abrir detalle desde vista Tabla — CONFIRMADO, causa raíz exacta encontrada
- **Causa raíz (verificada en código y DB):**
  - La tabla `design_kanban_tasks` tiene filas con `acceptance` como **STRING multilínea** (legacy: `card_ms7xkdc8`, `card_ms7xx73e`, `card_msdkgy36`, `card_ms8lf0aw` — verificado por query) y otras como **array**. Tipos mixtos en la misma columna.
  - El guard `normalizeTask` existe y está DEPLOYADO (`KanbanTab.tsx:287-298`, commit `291537d`, presente en el bundle de prod: `Array.isArray(pt.acceptance)` encontrado en `index-DH9cTKDc.js`).
  - **PERO la vista Tabla es otro componente: `src/components/KanbanTableView.tsx`.** Ahí NO hay normalize: línea 121 hace `setTasks(data.cards || [])` crudo, y la línea 327 (`detailTask.acceptance.map`) crashea con cualquier fila de acceptance-string. El cache de pane (`readPaneCache("kanban-table", …)`, línea 95-101) también persiste filas sin normalizar.
- **Fix (Item 1):** extraer `normalizeTask` a un módulo compartido (`src/lib/kanbanNormalize.ts`) y usarlo en `KanbanTableView.tsx` (fetch y cache) y en cualquier otro consumidor de `studio_list_cards`. Alternativa mínima: replicar el guard. BONUS raíz: migración de datos que convierta acceptance-string → array en `design_kanban_tasks` (UPDATE con split por `\n`) — con eso el bug muere para siempre, no solo se esconde.
- **Nota:** la sesión de QA crash-eó con `card_ms7yu92j` (acceptance `[]` array vacío) abierto desde Tabla — el stack apunta al render del PeekPanel; con acceptance null/[] el guard faltante de Tabla igual crashea si la fila vecina era string. El fix del Item 1 cubre ambos.

### BUG-002 — `get_dashboard_summary workspaceId is required` — CONFIRMADO, race de boot
- `HomeDashboard.tsx:548` llama `mcpCall("get_dashboard_summary", { workspaceId, range })` con `workspaceId` que viene de `Dashboard.tsx:672`: `selectedWs ?? personalWorkspaceId ?? workspaces[0]?.id ?? null` — **puede ser `null` durante el boot** (antes de que `list_workspaces` resuelva). `useMcpWidget` dispara el fetch igual con `workspaceId: null` → el MCP rechaza.
- **Fix (Item 2):** en `useMcpWidget` o en el fetcher de `HomeDashboard`, skip del fetch cuando `workspaceId` es null/falsy (estado `idle`, no error) y re-fetch cuando llegue. No esconder el error detrás de un catch silencioso: hoy el error se pinta en consola por el [mcpCall] logger — con el skip, desaparece.

### BUG-003 — DeepSeek 401 `****eb52` — YA EN REQ-025.1, no duplicar
- Causa confirmada en DB (saldo agotado, usuario lo confirmó). Cubierto por REQ-025.1 Items 1-3 (unificación de roles, preflight BYOK, telemetría). **Este req no lo vuelve a tocar.**

### BUG-004 — Back to Dashboard requiere doble click con paneles abiertos — REQUIERE INSTRUMENTACIÓN
- El botón existe en 2 lugares de `EditorV2.tsx` (7382, 7429), ambos llaman `onBack` directo — no hay guard visible en código que explique el click perdido. Hipótesis: overlay transparente del panel Layers/Export interceptando el primer click (z-index/pointer-events), o focus trap del panel.
- **Fix (Item 3):** auditoría de z-index/pointer-events de los paneles right-panel vs topbar; añadir en el click handler del panel un `stopPropagation` correcto o cerrar el panel antes de navegar. Si no reproduce en dev, añadir telemetría de click (contador de clicks en el botón) antes de tocar código.

## 2. Items de trabajo para el IDE agent (en orden)

### Item 1 — Kill BUG-001 (normalización compartida + migración de datos)
1. `src/lib/kanbanNormalize.ts`: exportar `normalizeTask` (mover desde KanbanTab.tsx, mismo código).
2. Consumirlo en `KanbanTableView.tsx`: fetch (línea ~121) y al leer cache (línea ~99).
3. Grep de verificación: `grep -rn "acceptance.map" src/` — cada archivo que lo contenga debe recibir tareas normalizadas o tener guard propio.
4. Migración SQL idempotente (`supabase_migrations/`): `UPDATE design_kanban_tasks SET acceptance = string_to_array(acceptance, E'\n') WHERE jsonb_typeof(acceptance) = 'string'` (ajustar al tipo real de la columna; si es jsonb, usar la variante jsonb). Verificar con query post-migración: `SELECT id FROM design_kanban_tasks WHERE jsonb_typeof(acceptance) NOT IN ('array') AND acceptance IS NOT NULL` → 0 filas.

### Item 2 — Kill BUG-002 (workspaceId null-guard)
1. En `HomeDashboard.tsx` (o en `useMcpWidget` con un flag `skipWhen`): no fetchear hasta tener workspaceId real. Estado loading mientras tanto.
2. Verificación: recarga del dashboard con Network tab limpia → cero llamadas a `get_dashboard_summary` con `workspaceId: null`, cero errores `[mcpCall] FAILED` en consola.

### Item 3 — BUG-004 (auditoría de overlays del editor)
1. Revisar z-index/pointer-events de right-panel (Layers/Export/Contextual) vs `editor-v2-topbar`.
2. Si hay overlay que roba el click: fixear. Si no se reproduce: añadir data-telemetry al botón y documentar "no reproducible en código; monitorear".

### Item 4 — Pruebas
1. Test unitario de `normalizeTask` con: array, string multilínea, string de 1 línea, null, undefined, objeto `{}`, número.
2. Test de render del PeekPanel de Tabla con una fila acceptance-string (snapshot: no crashea).
3. `tsc` limpio.

## 3. Reglas (no negociables)
- Un item = un commit con su verificación citada.
- Sin dependencias nuevas. La migración del Item 1 es la ÚNICA migración permitida y es idempotente.
- No pushear sin orden explícita de Ren.
- BUG-003 NO se toca aquí (dueño: REQ-025.1).

## 4. QA de cobertura 100% (pendiente — requiere sesión de dogfood con permiso de escritura)

El dogfood del 24-sep fue solo-lectura y dejó sin probar: crear/editar/borrar templates, formularios con inputs extremos, drag&drop, exportaciones, presets de animación (known freeze), importador. Para cubrir el 100% del editor (todos los menús de tools, capas, contextual — EXCEPTO Manos/Hands y Video) y el 100% de Copywriting (todos los botones y submódulos), se necesita una segunda sesión QA con:
- Permiso de crear/borrar elementos con prefijo `QA_` (limpieza al final).
- Credenciales o sesión ya autenticada.
- Checklist por inventario: enumerar cada botón/herramienta de la UI (los menús del editor: Select, Hand(excluido), Frame, Texto, Formas, Plumas, Comentarios, Iconos; paneles right: Properties/Contextual, History, Information, Biblioteca, Batchamator, AI Settings; topbar: zoom, undo/redo, guardar versión, exportar; y cada submódulo de Copywriting: calendario, contenidos, bandeja, atribución, campañas, reportes) y marcar probado/no-probado/bloqueado con evidencia.
- Entregable: matriz de cobertura (botón → estado → evidencia), no solo lista de bugs.

---

## 5. Definición de Done
- [ ] Crash de Tabla irreproducible: abrir detalle de CUALQUIER fila (incluidas las 8 "Hola Ren") no lanza Error Boundary.
- [ ] `grep -rn "acceptance.map" src/` → todos los usos cubiertos por normalize o guard.
- [ ] Migración corrida: 0 filas con acceptance no-array en `design_kanban_tasks`.
- [ ] Dashboard: cero `[mcpCall] FAILED get_dashboard_summary` en consola tras recarga limpia.
- [ ] Tests del normalize pasando; tsc limpio.
- [ ] Commits organizados; nada pusheado sin orden de Ren.

---

## 6. PROMPT PARA EL AGENTE IDE (copiar/pegar completo)

Lee y ejecuta `docs/requirements/REQ-026-dogfood-qa-fixes-and-full-coverage.md` completo. Contiene 4 items con causas raíz ya verificadas en código y DB — no re-diagnostiques.

Alcance exacto:
- **Item 1 (prioritario):** extraer `normalizeTask` desde `src/components/KanbanTab.tsx:287-298` a `src/lib/kanbanNormalize.ts`; consumirlo en `src/components/KanbanTableView.tsx` (fetch línea ~121 y cache línea ~99) y en todo consumidor de `studio_list_cards`. Verificación: `grep -rn "acceptance.map" src/` — cada uso cubierto por normalize o guard. Además, migración SQL idempotente en `supabase_migrations/` que convierta `acceptance` string → array en `design_kanban_tasks` (las filas legacy verificadas: `card_ms7xkdc8`, `card_ms7xx73e`, `card_msdkgy36`, `card_ms8lf0aw` tienen string multilínea). Post-migración: query de verificación debe devolver 0 filas no-array.
- **Item 2:** en `src/components/home/HomeDashboard.tsx:548` (o en `useMcpWidget`), no fetchear `get_dashboard_summary` hasta que `workspaceId` sea real (skip → estado loading; re-fetch al resolver). Verificación: recarga limpia del dashboard → cero `[mcpCall] FAILED get_dashboard_summary` en consola.
- **Item 3:** auditar z-index/pointer-events de right-panel (Layers/Export) vs `editor-v2-topbar` en `src/pages/EditorV2.tsx` (botón Back: líneas 7382 y 7429). Si hay overlay que roba el click, fixear; si no se reproduce, añadir telemetría de clicks al botón y documentar "no reproducible en código".
- **Item 4:** test unitario de `normalizeTask` (array / string multilínea / string 1 línea / null / undefined / objeto / número) + test de render del PeekPanel de Tabla con fila acceptance-string. `tsc` limpio.

Reglas: un item = un commit con verificación citada (comandos corridos y resultados). Sin dependencias nuevas. La migración del Item 1 es la ÚNICA migración permitida y debe ser idempotente. NO tocar `express-shim.js`, `llmProxy.ts` ni nada de BYOK/DeepSeek (dueño: REQ-025.1). NO hacer push sin orden explícita de Ren.

DoD (verifica cada punto antes de reportar done, con evidencia, no afirmaciones):
1. Abrir detalle de CUALQUIER fila de Tabla (incluidas las 8 "Hola Ren") no lanza Error Boundary.
2. `grep -rn "acceptance.map" src/` → todos los usos cubiertos.
3. Migración corrida: 0 filas con acceptance no-array.
4. Dashboard sin `[mcpCall] FAILED get_dashboard_summary` tras recarga limpia.
5. Tests del normalize pasando; tsc limpio.
6. Commits organizados; nada pusheado.

Al terminar: lista de commits con su verificación y resultado de cada punto del DoD.
