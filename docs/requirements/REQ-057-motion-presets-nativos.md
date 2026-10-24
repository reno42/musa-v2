# REQ-057 — Motion: presets nativos de movimiento (catálogo tipado para IA y humano)

Fecha: 2026-10-23 · Estado: **fases 1-2 implementadas (lógica); F3 UI pendiente** · Prioridad: P1 · Esfuerzo: S-M · Origen: cierre de la auditoría del arnés motion (`docs/REPORT_ARNES_MOTION_EDITABLE_2026-10-22.md`). Hoy la IA que anima en Musa debe inventar keyframes crudos en cada spec — resultados inconsistentes entre generaciones y sin vocabulario compartido con el humano que edita después.

## 1. Problema

- Cada spec de IA reinventa "entrar desde abajo con fade": keyframes distintos, easings distintos, calidad desigual.
- El humano que recibe el proyecto no tiene forma de saber "esto es un rise-in" ni de reajustarlo con una perilla: solo ve keyframes crudos.
- El catálogo de presets del editor (si existe en UI) no es consumible por el arnés MCP: dos vocabularios que no se hablan.

## 2. Regla rectora (no negociable)

Un preset es una FUNCIÓN PURA `(params saneados) → tweens`, nunca keyframes congelados: aplicar/re-aplicar con otros params reemplaza su propio clip (identidad estable `${presetId}:${layerId}`) y el resultado SIEMPRE sobrevive `normalizeAnimation` redondo (el apply normaliza antes de devolver — misma ruta que editor, MCP y undo).

## 3. Fase 1 — IMPLEMENTADA: librería compartida

**`shared/motionPresets.ts`** + **`QA/motion-presets.test.mjs`** (6 tests). Cero DOM, cero dependencias: importable desde Worker, editor, MCP y QA node.

- **13 presets** en 4 familias: entrada (`rise-in`, `drift-in`, `zoom-settle`, `blur-focus-in`, `type-on`, `word-cascade`), salida (`fall-away`, `zoom-blow-out`), loop (`pulse-loop`, `float-loop`, `wobble-loop` — cierran al valor identity en el fin de ventana), cámara/documento (`ken-burns-in`, `pan-across`).
- **Params declarados y saneados**: cada preset declara sus params (número con min/max/default, enum, boolean); `sanitizeMotionParams` clampea, cae al default en no-numéricos y descarta claves desconocidas (los params son MCP-safe: jamás llegan a un evaluator).
- **API**: `findMotionPreset`, `buildMotionClip` (ventana saneada, mín. 0.1s), `applyMotionPresetToSchema` (reemplazo idempotente por `${presetId}:${layerId}`, no toca clips ajenos), `motionPresetCatalogSummary` (para tools/list y UI).
- **Determinismo**: mismos params → mismo JSON (testeado); los loops vuelven al identity en el fin de ventana (testeado).

## 4. Fase 2 — IMPLEMENTADA (lógica; registro MCP pendiente) · Fase 3 pendiente

El registro de tools vive en `worker/runtime/functions/mcp.mjs`, archivo en edición por otra sesión concurrente: la lógica completa vive en **`shared/motionSurface.ts`** (sin importar `motionSpec.ts` — specs cruzan como JSON estructural) con test propio `QA/motion-surface.test.mjs`; el shim worker queda documentado.

### F2 — LÓGICA LISTA
- `motionPresetListPayload()`: catálogo completo (ids/labels/familias/params saneados) para `motion_preset_list`.
- `motionPresetParamsPayload(id)`: params por preset (defaults saneados) para previsualizar antes de aplicar.
- `expandSpecPresets(spec)`: expande `node.preset` (`"id"` o `{ id, params, windowMs }`) a keyframes numéricos vía LOS MISMOS builders del editor (`applyMotionPresetToSchema`); las declaraciones se consumen (expansión idempotente); id desconocido = error con la lista de ids válidos; params fuera de rango se clampan (nunca rechazan el spec); colisión con keyframe existente se omite con warning `KEYFRAME_COLLISION` (jamás pisa trabajo humano); ventana ≠ ventana del nodo avisa `PRESET_WINDOW_MISMATCH` (el compilador estira los keyframes a la ventana del nodo); clamps a `canvas.durationMs` y mínimo 100ms (`PRESET_WINDOW_INVALID` si degenera).
- Aceptación cubierta por test: el spec expandido pasa `normalizeMotionSpec` y compila al schema con los mismos extremos que el preset aplicado directo.

### F3 — Vocabulario en el editor (P2, esf M) — PENDIENTE
- El inspector de clip (REQ-054) muestra el chip del preset con sus params como perillas (dist, escala, duración): re-aplicar con otros params reemplaza el clip (idempotencia ya garantizada); desvincular deja los keyframes crudos.
- La UI y el MCP leen el MISMO catálogo de `shared/motionPresets.ts` — un solo vocabulario.

## 5. Fuera de alcance
- Presets con física (spring/bounce simulado): requieren solver por-frame que el sampler declarativo no expresa; llegarán como loops pre-horneados si hace falta.
- Presets de transición entre clips: usa REQ-053 F4 (catálogo de 35 transiciones ya existente).

## 6. Análisis de escalabilidad y fallos
- La librería es estática y pura: 0 KB de runtime por preset no usado si el bundler tree-shakea (export por preset); el catálogo completo pesa menos que un icono.
- Fallos contenidos: params inválidos se clampan (nunca rechazan el spec entero — un `distPx: "abc"` cae al default y anima); ventana degenerada se expande al mínimo 0.1s; id desconocido es error accionable con lista.
- El reemplazo por `instanceId` evita la fuga clásica de re-apply: aplicar 10 veces deja 1 clip.

## 7. QA requerido / implementado
- [x] Catálogo determinista, keyframes válidos y params saneados por defecto (test 1).
- [x] `sanitizeMotionParams`: clamps, enums, defaults, desconocidos fuera (test 2).
- [x] `buildMotionClip`: ventana saneada + instanceId (test 3).
- [x] `applyMotionPresetToSchema`: reemplazo idempotente + sobrevive normalize (test 4).
- [x] Muestreo: extremos exactos y fill-both (test 5), cierre de loops (test 6).
- [x] F2 (lógica): expansión idempotente/determinista, id desconocido con ids válidos, colisión omitida con warning, mismatch/clamp/degenerada de ventana, colisión con keyframe humano (`QA/motion-surface.test.mjs`); spec expandido válido ante `normalizeMotionSpec` + compilación al schema (integración con skip si el módulo no está).
- [ ] F2 (registro worker): tools en `mcp.mjs` — bloqueado por WIP concurrente sobre ese archivo.
- [ ] F3: test del inspector (chip + perillas) — UI.
