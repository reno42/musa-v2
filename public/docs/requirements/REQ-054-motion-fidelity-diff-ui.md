# REQ-054 — Motion: fidelidad y diff visibles para la persona en el editor

Fecha: 2026-10-23 · Estado: **bloqueado por sesión concurrente (2026-10-25) — F1–F4 son UI de `src/pages/VideoProjectEditor.tsx`, archivo en edición por otra sesión activa; sin lógica pura previa que implementar sin ella. Los datos que consume cada fase ya existen (ver §1)** · Prioridad: P1 · Esfuerzo: S/M · Origen: la auditoría del arnés motion (`docs/REPORT_ARNES_MOTION_EDITABLE_2026-10-22.md`) demostró que el contrato de fidelidad existe pero solo se ve por respuestas MCP. La persona que abre el editor no sabe qué es editable, qué es baked ni qué quiere sobrescribir la IA.

## 1. Problema

Los datos ya existen y están protegidos:
- Cada nodo generado conserva `source` (adapter, sourceNodeId), `editability` y el binding que marca cambios humanos (`overwriteHuman` bloquea la reaplicación — verificado en `QA/motion-mcp-surface.test.mjs`).
- `motion_project_diff_spec` produce un diff determinista entre el spec entrante y el estado aplicado.

Pero en `src/pages/VideoProjectEditor.tsx` nada de eso se muestra: el clip generado por IA es indistinguible de uno manual, y cuando la IA reaplica, el conflicto solo existe para quien tenga el cliente MCP. La consecuencia práctica: la persona no sabe qué puede tocar sin romper el vínculo con la IA, ni qué va a pisar la próxima reaplicación.

## 2. Alcance

### F1 — Badges de fidelidad por clip (P1, esf S)
- Cada clip generado muestra un badge discreto con su `editability`: `editable` (sin badge — es el default), `atomic` (icono "objeto"), `baked` (icono "clip"), `unsupported` no llega a persistirse, no se muestra.
- Tooltip con la procedencia: adapter, spec version, hash corto.
- Aceptación: abrir un proyecto creado por `motion_project_create_from_spec` muestra los badges correctos; un clip creado a mano no muestra nada.

### F2 — Panel "Generado por IA" en el inspector (P1, esf S)
- Sección del inspector para clips con binding: nombre del spec, adapter, versión, fecha del último apply, estado del binding (`pristine` / `human-modified`).
- Botón "Convertir a keyframes propias" (desvincula: el clip deja de regenerarse por reaplicaciones — el binding se disuelve y el contenido se conserva tal cual).
- Aceptación: desvincular un clip y reaplicar el spec completo NO toca ese clip; el diff lo lista como `unbound`.

### F3 — Drawer de conflicto y reaplicación (P1, esf M)
- Cuando `motion_project_apply_spec` encuentra nodos human-modificados y el llamador pidió sobrescribir, el editor muestra un drawer con el diff a nivel campo: valor entrante vs valor humano, lado a lado, con decisión por campo: **conservar humano** (default) / **aceptar entrante** / **aceptar todo** (`overwriteHuman` explícito).
- La decisión por campo se registra en el binding (qué campos fueron cedidos) para que la próxima reaplicación no re-pregunte lo ya resuelto.
- Aceptación: reaplicar un spec con 3 campos humanos modificados pregunta exactamente por esos 3; elegir conservar preserva los valores al recargar; aceptar todo produce el estado del spec y queda auditado.

### F4 — Línea de tiempo de versiones del spec (P2, esf S)
- Vista simple (lista, no git): cada apply genera una entrada — spec hash corto, autor (IA/humano), resumen del diff (+n/−m campos), timestamp.
- Fuente: las filas de auditoría que la RPC de apply ya escribe; si falta algún campo para el resumen, es UNA migración posterior a `supabase_migrations_v82.sql` coordinada con la sesión activa de motion (no modificar migraciones en vuelo).
- Aceptación: reaplicar 3 veces deja 3 entradas legibles; ninguna expone secretos ni URLs firmadas largas.

## 3. Decisiones de diseño
- Todo el estado que la UI necesita ya viaja en `video_project_get` + bindings: F1–F3 no requieren migración. F4 puede requerirla y por eso es P2.
- El drawer de conflicto es el ÚNICO lugar donde se puede aceptar `overwriteHuman`: la tool MCP lo acepta como flag, la UI lo hace como decisión informada. Ninguna ruta lo aplica silenciosamente.
- Mobile 390px: el drawer es bottom-sheet con la misma estructura de campos.
- Copys en español, sin jerga de "fidelity": "Editable", "Objeto", "Video/imagen fija", "Lo generó IA (adapter)".

## 4. Fuera de alcance
- Editar el spec desde la UI (la edición humana es por clips/inspector, como hoy; regenerar es acción del lado IA).
- Undo del bind/unbind más allá del undo/redo transaccional existente del editor.

## 5. Análisis de escalabilidad y fallos
- El diff para la UI se calcula con el mismo diff determinista del Worker (`motion_project_diff_spec`) — cero lógica de comparación duplicada; un proyecto con cientos de nodos pagina el drawer por nodo conflictivo (los comunes son <10).
- Fallo abierto: si el estado del binding no se puede leer (RPC caída), los badges se ocultan y el editor funciona como hoy — la UI de fidelidad nunca bloquea la edición.
- Riesgo: badges mal calculados generarían desconfianza; por eso se derivan del binding persistido, no de heurísticas del front.

## 6. QA requerido
- Unit: derivación badge↔editability↔binding; merge de decisiones por campo en el binding.
- E2E navegador: crear proyecto por spec → verificar badges → editar un campo → reaplicar con conflicto → decidir por campo → reload preserva → línea de tiempo muestra las entradas.
- La suite `QA/motion-mcp-surface.test.mjs` (human REST edits marcan bindings) se extiende con el caso "decisión por campo cedida".
