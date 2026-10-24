# REQ-056 — Motion: interoperabilidad Lottie (import declarativo a MotionSpec)

Fecha: 2026-10-23 · Estado: **fases 1-3 implementadas (lógica); registro MCP pendiente** · Prioridad: P2 · Esfuerzo: M · Origen: cierre de la auditoría del arnés motion (`docs/REPORT_ARNES_MOTION_EDITABLE_2026-10-22.md`) y REQ-053 §4 (precomps/Lottie quedaron fuera de alcance ahí). Lottie es el formato de facto de la animación generada por IA (LottieFiles, After Effects via plugin, Rive export, Spline, Haiku) — aceptarlo convierte ese ecosistema en entrada editable de Musa.

## 1. Problema

Un JSON Lottie que llega de una IA o de un motion designer no tiene ruta de entrada a Musa: o se renderiza a video (pierde toda editabilidad) o no entra. El arnés MotionSpec ya demostró que un documento declarativo → `AnimationSchema` → sampler compartido es el camino (REQ-046, REQ-050); falta el traductor Lottie→MotionSpec con una regla de fidelidad honesta por capa.

## 2. Regla rectora (no negociable)

Toda promesa de editabilidad se respalda con el sampler compartido (`shared/animationSchema.ts`): si un rasgo de Lottie no puede expresarse en el schema normalizado SIN perder su forma bajo `normalizeAnimation`, se declara `unsupported` con razón accionable — nunca se persiste una aproximación que el export renderice distinto al preview.

## 3. Fase 1 — IMPLEMENTADA: bridge puro Lottie→schema

**`shared/lottieImport.ts`** (`mapLottieMotion(lottie, layerMap)`) + **`QA/lottie-import.test.mjs`** (6 tests, 15 con presets/parity). Cero dependencias, cero DOM: corre en Worker, editor y node QA.

Cubierto:
- **Transforms**: posición (concatenada y split-dims `p.s===true`), escala, rotación, opacidad → tweens del schema en `canonicalTransform` (un tween por prop: requisito de `normalizeAnimation`).
- **Easing por segmento**: Lottie pone AMBOS handles (`o` out, `i` in) en el keyframe que INICIA el segmento; se vota el easing dominante entre segmentos reales y los segmentos desviados se hornean como keyframes muestreados (BAKE_SAMPLES=12). El ganador sale como `cubic-bezier(...)` literal que `normalizeEasing` ya acepta.
- **Ventanas por extent**: el clip de cada capa va de su primer a su último keyframe animado REAL (frames de composición → segundos), no del `ip/op` — porque el schema fija el primer/último keyframe de cada tween en t=0/1 y una ventana más ancha estiraría la animación. Los holds se extienden con keyframes constantes (`holdExtend`) y sobreviven vía fill-both del sampler.
- **Valores estáticos**: tracks no animados (`a:0`, escalar o vector) van a `staticProps` de la capa (opacidad/transform) en vez de desaparecer.
- **Timeline**: `fr`→fps, `op-ip`→durationSec, `w/h`→canvas.
- **Fidelidad y warnings**: por capa `editable` / `unsupported:<razón>` (parent-chain, matte, unmapped-layer, visual-not-imported, expression, no-ks) + warnings accionables; `layerMap` acepta `"<nombre>"` o `"ind:<n>"` (índice estable cuando el nombre no lo es).
- **Robustez**: entrada malformada → `schema:null` + warning `invalid-input` (nunca lanza); mapeo determinista; el schema resultante es estable bajo `normalizeAnimation` (round-trip idéntico — testeado).

## 4. Fases 2-3 — IMPLEMENTADAS (lógica pura; el registro MCP queda como shim documentado)

El registro de tools vive en `worker/runtime/functions/mcp.mjs`, archivo en edición por otra sesión concurrente: para no arrastrar su WIP al commit, la lógica completa vive en módulos propios y el shim pendiente es fino (por tool: parse body → llamar la función → devolver `{spec, applied, fidelity, warnings, issues}`).

### F2 — `importLottieMotionIntoSpec(lottie, rawSpec)` — `shared/motionSurface.ts`
- Autocorrelaciona layers por `node.id` y `node.name` (precomps también por `contenedor/hoja`); no crea visuals: los nodos deben existir.
- Inyecta keyframes numéricos (transform → x/y/scale/rotation; opacidad) con ids deterministas `kfl-...`; `applied[]` informa keyframes, `replaced` y ventana por nodo.
- Re-import idempotente: reemplaza SOLO las propiedades que el propio import anima por nodo — la titularidad se calcula sobre las seeds reales (el tween `transform` genera 4 propiedades, no una) — y los ids propios se reusan; el resto del spec queda intacto.
- Static-only: los valores base caen a `node.props` (determinista). Lottie inválido → `ok:false` + issue `LOTTIE_INVALID`; nunca lanza.

### F3 — Anchor point (`ks.a`) + precomps — `shared/lottieImport.ts` v2
- **Anchor**: con el transform-origin `0 0` de los renderers, el anchor se pliega en el translate `p − R(θ)·s·a` — exacto mientras rotación/escala no animen; si animan se hornea en keyframes muestreados (preview==export, mismo sampler) y se declara `baked:anchor-offset` + warning `anchor-offset`.
- **Precomps** (`ty:0`+`refId`): se aplanan hasta profundidad 4 componiendo cadenas translate·rotate·escala-uniforme — la composición permanece en el conjunto expresable (sin sesgo) — evaluadas en la unión de tiempos de keyframe REALES; el tiempo hijo vive en la línea de tiempo del precomp (shift por `ip` del contenedor). Ciclos, refs faltantes y profundidad excedida se REPORTAN (`precomp-cycle`/`precomp-missing-ref`/`precomp-depth`), nunca se adivinan.
- Queda fuera (sin cambios de alcance): transforms 3D (solo warning) y fills/strokes vectoriales → SVG allowlist (REQ-053 F2), pospuesto.

## 5. Fuera de alcance
- Exportar a Lottie (Musa→Lottie): el schema tiene ventanas/aristas que Lottie no expresa 1:1; primero consumir, evaluar export después.
- Expressiones de Lottie (`x:`): se marcan `unsupported:expression` — ejecutarlas sería código dinámico no declarativo (regla del arnés: nada ejecutable).

## 6. Análisis de escalabilidad y fallos
- `mapLottieMotion` es O(capas × keyframes) sin asignaciones por frame: un Lottie de 60 capas × 200 keyframes (~12k nodos) parsea en milisegundos; no toca red ni Storage.
- Fail-safe: cualquier campo corrupto degrada esa propiedad a estática/default y suma un warning — un Lottie parcialmente válido produce el mejor subconjunto honesto en vez de fallar entero.
- El límite real es el sampler (ventanas ≥0.05s, fps 1..60, duración ≤600s): clamps de `normalizeAnimation` actúan como barrera final incluso si el mapper tuviera un hueco.

## 7. QA requerido / implementado
- [x] Mapeo transform/opacity + easing bezier + ventana por extent (test 1).
- [x] Estabilidad bajo `normalizeAnimation` (test 2), determinismo (test 3).
- [x] Holds via `sampleAnimationAt` (test 4), malformados sin throw (test 5), layerMap por `ind:` (test 6).
- [x] F2 (lógica): `QA/motion-surface.test.mjs` — autocorrelación, inyección numérica, re-import idempotente (reemplaza solo propiedades propias), staticProps a `node.props`, Lottie inválido; integración con `normalizeMotionSpec` del arnés (skip si el módulo no está disponible).
- [x] F3: goldens de precomp aplanado con valores exactos (600/600 → 800/650 → 900/700), profundidad/ciclo/ref faltante, anchor estático plegado y anchor animado horneado (`QA/lottie-import.test.mjs`).
- [ ] Registro worker: tools en `mcp.mjs` + test patrón `QA/motion-mcp-surface.test.mjs` (bloqueado por WIP concurrente sobre ese archivo).
