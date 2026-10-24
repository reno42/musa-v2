# REQ-053 — Motion: ampliar el subconjunto editable de MotionSpec (shape, grupo, geometría, transiciones y efectos standalone)

Fecha: 2026-10-23 · Estado: **propuesto** · Prioridad: P1 · Esfuerzo: L · Origen: cierre de la auditoría del arnés motion (`docs/REPORT_ARNES_MOTION_EDITABLE_2026-10-22.md`): el ciclo convert→validate→apply→open está implementado, pero el subconjunto standalone obliga a hornear (`baked`) demasiado material que la IA genera.

## 1. Problema

Hoy el subconjunto standalone comprobado (`.agents/skills/musa-motion/SKILL.md`) acepta: texto, imagen, video, audio, SVG/sticker como media, orden de capas, keyframes de posición/escala/rotación/opacidad, easing `linear`/`ease*`/`cubic-bezier`, filtro y tipografía. Todo lo demás vuelve en `fidelity.unsupported` y la IA debe pedir clip `baked`:

| Capacidad rechazada hoy | Costo de producto |
|---|---|
| `shape` vectorial declarativo | Logos/formas animadas de IA → siempre baked; el humano no mueve partes |
| Transformaciones de grupo | Composiciones con jerarquía (padre-hijo) se aplanan o se rechazan |
| `clipPath`, `width`, `height`, `top`, `left` como props animadas | Reveals geométricos y layouts animados imposibles |
| Transiciones standalone | Cuts duros entre clips; el catálogo de 35 transiciones no se usa |
| Efectos fuera de `fx-lut`/`fx-overlay`/`fx-text-anim` | 24 looks y TAKE_FX del catálogo inaccesibles desde spec |

Cada punto de porcentaje de `editable` que se recupera acá reduce la fracción `baked` — la métrica que define si "IA genera y humano edita" es real o marketing.

## 2. Regla rectora (no negociable)

Una capacidad sale de `unsupported` **solo cuando el preview standalone y el export la renderizan idénticamente** (mismo sampler, mismas geometrías). La suite `QA/motion-spec.test.mjs` ya pina "no persistir capacidades sin renderer standalone"; cada fase de este REQ extiende esa prueba con golden frames (ver REQ-055 F3). Si el paridad falla, la capacidad vuelve a `unsupported` — nunca se persiste una promesa que el export no cumple.

## 3. Alcance por fases

### F1 — Geometría y layout animables (P1, esf M)
- `clipPath`, `width`, `height`, `top`, `left` pasan a props soportadas en el compilador standalone (`api/src/services/motionProjectCompiler.ts` → materiales/segmentos) SI y solo si ambos renderers las aplican con el mismo resolver que `shared/animationSchema.ts` (ya las tiene en `ANIMATION_PROPS`).
- El informe de fidelidad deja de rechazarlas; `motion_spec_validate` pasa a validar rangos (unidades, %, clamp).
- Aceptación: spec con reveal por `clip-path: inset()` y caja que cambia `width` — preview y export producen los mismos frames en t=0/50/100%.

### F2 — `shape` como SVG declarativo → media `atomic` (P1, esf M)
- Un `shape` del spec (rect/ellipse/path con attrs acotados) se compila a un asset SVG (string subido a Storage o data-URL pequeña) y entra como media `svg` con `editability: "atomic"`: el humano lo mueve, escala, recorta y reemplaza, pero no edita el path interno.
- NUNCA se ejecuta ni reescribe el SVG de la IA: se sanea (allowlist de elementos/attrs, sin script/onload/foreignObject) antes de persistir.
- Aceptación: spec con 3 shapes compuestas entra como 3 clips atomic; la exportación los dibuja idéntico al preview; un SVG con `<script>` se rechaza en `motion_spec_validate` con error accionable.

### F3 — Transformaciones de grupo (P2, esf M)
- Un `group` se compila aplanado: la transformación combinada padre·hijo se calcula en el compilador (determinista, misma matemática en preview/export) y cada hijo mantiene su clip editable propio.
- El padre queda como agrupación lógica en el inspector (REQ-054 lo muestra), no como clip.
- Aceptación: grupo con rotación del padre + escala del hijo muestrea igual que su aplanado manual; editar el hijo después del apply conserva el orden visual.

### F4 — Transiciones standalone desde el catálogo (P1, esf S)
- `motion_transition` usa los ids de `shared/videoEffectsCatalog.ts` (35 transiciones paramétricas) como única fuente: `type` valida contra el catálogo y los params pasan por `sanitizeTransitionParams`. Cero geometría nueva — los dos renderers ya implementan el catálogo (`transitionPreview.ts` + `EXPORT_TRANSITIONS`).
- Aceptación: spec con transición `pinwheel` + params custom produce frames idénticos en la paridad; un id desconocido devuelve error que lista los ids válidos.

### F5 — Efectos: LOOKS, overlays y TAKE_FX tipados (P2, esf M)
- `fx-lut` mapea a la familia LOOKS del catálogo (`css(intensity)`), `fx-overlay` a `OVERLAY_FX` y `fx-text-anim` a `TEXT_ANIMS`, con params Num/Enum/Color del catálogo en lugar del `css` crudo de hoy.
- Aceptación: intensidad 0.5 de un look produce el mismo filter string en preview y export; params fuera de rango se clampan (no se rechaza el proyecto entero).

## 4. Fuera de alcance
- Editar el interior de un path SVG (sigue `atomic`).
- Efectos por-pixel pesados (twirl/bulge/displacement) — dependen de WebGL2 (REQ-046 G16).
- Precomps/Lottie — REQ-056.

## 5. Análisis de escalabilidad y fallos
- El compilador corre en el Worker (CPU-bound liviano: aplanar grupos es O(nodos)); el aplanado de grupos profundos se limita (profundidad máx. 4, nodos máx. 200 por spec) para no romper el presupuesto de CPU del plan freemium.
- El fail-open actual se conserva: si la paridad de una capacidad no se puede verificar en QA, la capacidad NO se habilita (mejor un baked honesto que un export mentiroso).
- Riesgo de bundle: el compilador vive en el Worker y en `api/`, no suma KB al bundle del navegador; los renderers ya cargan el catálogo.

## 6. QA requerido
- Unit: validadores de las nuevas props (rangos, clamps, unidades), saneamiento SVG (allowlist), aplanado de grupos (matriz 2D determinista).
- Paridad: golden frames por capacidad en t de control (REQ-055 F3 es el harness).
- E2E MCP: spec grande (shape+grupo+transición+look) → apply → open → edición humana de un hijo → reload preserva.
- La suite existente `QA/motion-spec.test.mjs` debe seguir pasando con el subconjunto ampliado (los `unsupported` viejos pasan a casos positivos).
