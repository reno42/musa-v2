# REQ-031 — Inicio/Kanban: validación de título, Dry run visible y verificación post-deploy del workspaceId

> Fuente: dogfood Inicio (ChatGPT, 25-sep) contrastado con repo por Hermes.
> Buenas noticias primero: el flujo NUEVO tarjeta-clickeable (tarjeta → drawer → editar → persistir → mover columna → Refresh) pasó COMPLETO ✓. El contador 54→55 cuadró, los acceptance criteria renderizan, y la coherencia dashboard↔CRM (Pipeline USD 1.6K, 3 deals) cuadra. No hay bugs funcionales nuevos graves — este req es de pulido pequeño + 1 verificación que depende de deploy.

---

## 1. Estado de los hallazgos (verificado, no re-diagnosticar)

### INI-001 — `get_dashboard_summary workspaceId is required` en la carga de Inicio — YA ARREGLADO EN CÓDIGO, PENDIENTE DE DEPLOY
- Tercera vez que este mismo bug aparece en un dogfood (REQ-026 BUG-002 → CRM-005 → INI-001). Causa raíz idéntica: `activeWorkspaceId` null durante boot.
- El fix EXISTE y está commiteado (REQ-026 Item 2, commit `77293ec`: gate `enabled` en `useMcpWidget`, HomeDashboard.tsx:116-119). NO está en prod porque el deploy no ha salido: prod corre el bundle viejo `index-DH9cTKDc.js` (verificado hoy), y origin/main sigue en `5ba7624` con 15 commits locales pendientes.
- **Acción del agente: NINGUNA de código.** Solo verificar que no exista OTRO call-site de `get_dashboard_summary` fuera del gate (grep) y reportarlo. El bug desaparece de prod con el próximo deploy.

### INI-002 — Título de tarea acepta 500+ caracteres sin límite ni aviso — CONFIRMADO
- Verificado: los inputs de título (crear, KanbanTab.tsx:771; editar, :865) no tienen `maxLength`, ni contador, ni validación en `handleCreate`. El botón Crear queda habilitado con 503 chars.
- Riesgo real: tarjetas kanban con títulos kilométricos rompen el layout de columna y el drawer.

### INI-003 — Dry run no cambia el CTA "▶ Ejecutar batch" — CONFIRMADO
- Verificado (KanbanTab.tsx:1204-1216): el botón muestra siempre `▶ Ejecutar batch` o `Ejecutando…`; el checkbox Dry run (línea 1195-1201) solo cambia el param interno `dryRun: true` (línea 648). El feedback existe DESPUÉS (toast "Dry run listo…", línea 661), pero el CTA no comunica ANTES que no mutará nada. En un botón que dispara un pipeline LLM real sobre 54 tareas, la ambigüedad pre-click es un riesgo operativo.

## 2. Items (un item = un commit con verificación citada)

### Item 1 — Límite y validación de título (INI-002)
En ambos inputs de título (crear :771, editar :865):
1. `maxLength={120}` en el input.
2. Contador discreto `n/120` visible cuando n > 90.
3. `handleCreate`/`handleUpdateCard`: guard defensivo (trim vacío rechazado — ya existe; >120 truncado con aviso).
Verificación: crear tarea con 500 chars → input corta a 120; crear/editar con título normal funciona igual. Screenshot.

### Item 2 — Dry run visible en el CTA (INI-003)
En el botón de batch (KanbanTab.tsx:1215): label condicional —
- `batchDryRun` true → `▶ Ejecutar DRY RUN (sin cambios)` con estilo neutro (no verde de "go").
- false → `▶ Ejecutar batch` (estilo actual).
- Extra barato: tooltip del checkbox ya explica; añadir al tooltip del botón el modo actual: title={`Modo: ${batchDryRun ? "DRY RUN — no muta nada" : "REAL — dispara el pipeline sobre el pipeline actual"}`}.
Verificación: toggle del checkbox cambia el label y el estilo del botón al instante. Screenshot de ambos estados.

### Item 3 — Verificación workspaceId (INI-001, solo grep + reporte)
1. `grep -rn "get_dashboard_summary" src/` — cada call-site debe estar bajo el gate `enabled` de useMcpWidget o con guard propio de workspaceId.
2. Reportar resultado en el commit (esperado: todos gated desde REQ-026; si aparece alguno sin gate, arreglarlo aquí).
3. NOTA para Ren (no acción del agente): este error desaparecerá de prod con el deploy de los 15 commits pendientes.

### Item 4 — Tests + higiene
1. Test del guard de título (120 max) si el runner lo permite sin deps nuevas; si no, verificación manual documentada.
2. `tsc` + `node --check` limpios.

## 3. Reglas (no negociables)
- Un item = un commit con verificación citada. Sin dependencias nuevas.
- NO tocar: `express-shim.js`, `llmProxy.ts`, BYOK, `ghost_perform`, pipeline del batch (solo el label del botón), las 54 tareas existentes.
- La tarea `card_muga4cvc_8agsr5` (QA_Inicio_Kanban_Editado) es evidencia de dogfood — NO borrarla por código.
- NADA pusheado sin orden explícita de Ren.

## 4. Definición de Done
- [ ] Título: maxLength 120 + contador visible cerca del límite, en crear y editar.
- [ ] Botón batch: label y estilo cambian con Dry run; tooltip indica el modo.
- [ ] Grep de get_dashboard_summary: todos los call-sites gated (o fixeado el que falte).
- [ ] tsc limpio; commits organizados; nada pusheado.

---

## 5. PROMPT PARA EL AGENTE IDE (copiar/pegar completo)

Lee y ejecuta `docs/requirements/REQ-031-inicio-kanban-polish.md` completo. Es un req pequeño de pulido (3 items de código + 1 de verificación) con causas raíz ya verificadas — no re-diagnostiques.

Contexto verificado: los inputs de título sin maxLength están en `src/components/KanbanTab.tsx:771` (crear) y `:865` (editar); el botón batch con label fijo en `:1215` y el checkbox Dry run en `:1195-1201` (el param `dryRun` ya se envía correctamente, línea 648 — solo falta que el CTA lo comunique). INI-001 NO lleva código: el fix ya existe (REQ-026 commit `77293ec`) y el error de prod desaparece con el próximo deploy — tu parte es solo el grep del §2 Item 3.

Ejecuta los 4 items del §2 EN ORDEN (un item = un commit con verificación citada). Reglas: sin dependencias nuevas; NO tocar el pipeline del batch (solo label/tooltip del botón), `express-shim.js`, `llmProxy.ts`, BYOK, `ghost_perform`; NO borrar la tarea `card_muga4cvc_8agsr5`; NADA pusheado sin orden explícita de Ren.

DoD §4: verifica cada punto con evidencia (screenshots de los estados del botón y del contador de título, resultado del grep). Reporta: commits + resultado de cada punto.
