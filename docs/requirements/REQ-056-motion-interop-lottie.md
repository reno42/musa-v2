# REQ-056 — Motion: interoperabilidad Lottie (import declarativo a MotionSpec)

Fecha: 2026-10-23 · Estado: **propuesto (fase 1 implementada)** · Prioridad: P2 · Esfuerzo: M · Origen: cierre de la auditoría del arnés motion (`docs/REPORT_ARNES_MOTION_EDITABLE_2026-10-22.md`) y REQ-053 §4 (precomps/Lottie quedaron fuera de alcance ahí). Lottie es el formato de facto de la animación generada por IA (LottieFiles, After Effects via plugin, Rive export, Spline, Haiku) — aceptarlo convierte ese ecosistema en entrada editable de Musa.

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

## 4. Fases siguientes (propuestas)

### F2 — Endpoint MCP `motion_lottie_import` (P2, esf S)
- Tool MCP que recibe el JSON Lottie (o un asset subido), llama `mapLottieMotion` con un layerMap autocorrelacionado por nombre y devuelve el MotionSpec validado + informe de fidelidad + warnings, listo para `motion_project_create_from_spec`.
- Aceptación: un Lottie real de LottieFiles entra a un proyecto y el informe declara % editable/baked honesto.

### F3 — Matrices y precomps (P3, esf L)
- `ks.a` (anchor point) y transforms 3D; precomps se aplanan con la misma matemática determinista del compilador (REQ-053 F3), con límite de profundidad/nodos para el presupuesto de CPU del Worker.
- Los fills/strokes vectoriales (`ty:4` con `shapes`) pasan por el saneamiento SVG allowlist de REQ-053 F2 y entran como media `atomic`.

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
- [ ] F2: test MCP surface (patrón `QA/motion-mcp-surface.test.mjs`).
- [ ] F3: golden frames de precomp aplanado (harness REQ-055 F3).
