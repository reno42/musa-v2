# REQ-045 — Interacción y paridad Illustrator (Fases 2+3): compound/distorsiones/blend/width, pintura compartida y transform numérico

Fecha: 2026-10-10 · Estado: **Fases 2+3 implementadas** · Origen: cierre del 100% de la lista pendiente del gap analysis (REQ-044 §4-5) contra `reference/vectorcraft/` (leído como SPEC, no copiado; regla de licencia en REQ-043 §0).

---

## 1. Objetivo

Cerrar las herramientas y comportamientos que hacen abandonar a un usuario de Illustrator: trazados compuestos reales (agujeros evenodd), distorsiones líquidas y Warp, mezclas (blend) con anclas editables, width tool con expansión geométrica honesta, pintura compartida entre panel y atajos (la deuda de REQ-044 §3), snap a anclas ajenas en edición de vértices y el diálogo numérico con Enter.

## 2. Motores puros — `src/lib/pathOps/` + `src/lib/layerPaint.ts`

- **`compound.ts`** — nivel string `d` (parsePathData es single-subpath, NO se tocó): `splitSubpaths` (corte por lookahead `M`), `countSubpaths`, `makeCompoundD(ds)` (≥2 subtrazados, si no `null`), `releaseCompoundD(d)` (1 subtrazado → `null`). El navegador rellena los anillos con `fill-rule="evenodd"`.
- **`distort.ts`** — pipeline sample→kernel→refit: `samplePathPoints` aplana cúbicas; kernels deterministas sobre `Pt[]` con mulberry32 (`seed`, nada de Math.random): `twirl` (ángulo con decaimiento cuadrático), `pucker`/`bloat` (radiales monotónicos e inversos), `crystallize` (picos aleatorios), `scallop` (sinusoidal por arc-length), `wrinkle` (jitter); `warpPath` con 8 presets sobre coords normalizadas del bbox (arc, bulge, flag, wave, fish, fisheye, rise, twist); `refitPathPoints` vía `fitPolyline` de `trace/fit.ts` (motor Schneider existente) + `fitSubPathToPathPoints`; `applyDistortion(points, closed, effect, opts)` orquesta con guardia anti-degeneración. `DISTORT_FIT_DEFAULTS` conservador (snapLines off).
- **`blend.ts`** — `resamplePath` (n puntos equiespaciados por arc-length, 32-512), `blendPaths(a, b, steps, opts)` interpola denso y refitea cada paso intermedio (extremos sin repetir), auto-flip si el inicio de B queda más lejos que su final (flipB fuerza/desactiva), cerrados ambos → intermedios cerrados; `blendD(dA, dB, steps, opts)` conveniencia string→string para MCP.
- **`width.ts`** — width tool real: `widthProfileOutline(points, closed, baseWidth, profile[{t,w}], caps)` densifica (rectas incluidas), normales por punto, ancho piecewise-linear por fracción de arc-length, lado izq + der invertida → polígono cerrado → refit; caps redondeados en abiertos (10 pasos por semicírculo); `pickWidthT(points, closed, pt)` devuelve t/distance/point/normal para el hit del tool. Perfil uniforme ≡ outline de ancho constante.
- **`layerPaint.ts`** — pintura compartida UI/atajos: `swapPair`/`DEFAULT_PAINT` (blanco/negro estilo Illustrator); variantes DOM (`readPaint`, `writeFillEl`, `writeStrokeEl`) y HTML (`readLayerPaintHtml`, `writeLayerFillHtml`, `writeLayerStrokeHtml`, `swapLayerPaintHtml`, `resetLayerPaintHtml` — `null` en capas no SVG). Sin DOM/Node en los motores: compat Cloudflare/Workers, cero migraciones.

## 3. QA

`QA/path-ops3.test.mjs` (15 tests, script `test:path-ops3`, patrón path-ops2 importando .ts directo): compound split/make/release roundtrip; twirl conserva centro y módulo radial; pucker/bloat monotónicos e inversos; warp fórmula conocida sobre caja conocida; determinismo por seed; blend (paso medio ≈ punto medio, número de pasos, flipB); width (perfil uniforme ≈ outline constante, pickWidthT); refit de círculo bajo tolerancia.

## 4. UI

### 4.1 Herramientas (`HtmlToolName` += curvature | lasso | shape-builder | width | zoom | live-paint)
- **FloatingToolbar**: curvatura dentro del flyout de la pluma; lazo, shape builder, width y live-paint como botones propios (estilo tijeras/cuchillo); zoom junto a la mano. **Z sigue siendo zoom-in del teclado (REQ-044): el zoom tool va SIN atajo.**
- **InfiniteHtmlCanvas**: `zoom` (clic = +1 paso en el punto, Alt+clic = −1; prop `onZoomAt` → `handleZoomSet` con compensación de scroll) y `lasso` (polígono punteado; mouseup → `frameLassoRegistry` con mods shift=toggle/alt=restar, misma semántica del marquee REQ-044).
- **DesignFrame**: `curvature` (clic coloca puntos suaves con preview estilo pen; Enter suaviza Catmull-Rom antes de finalizar; commit por `onAddPenPath`); `shape-builder` (≥2 seleccionadas con path → caras UNA vez con `pathfinder("divide")`; arrastrar une las caras tocadas, Alt+arrastrar borra; commit reemplaza originales); `live-paint` v1 honesto (clic pinta LA CARA bajo el cursor como capa nueva con el color frontal; repetible; Esc sale — documentado Live Paint lite); `width` (drag cerca de un stroke crea puntos de perfil con preview del outline; Enter expande el stroke a forma rellena — **width = expand real**, no bbox hack); **snap de anclas ajenas** al arrastrar vértices (≤8/z px, por-eje si solo un eje captura, highlight ámbar temporal, guías existentes intactas).
- **Cubo y gradiente conectados** (deuda REQ-044 §3): `paint-bucket` rellena la capa tocada con el color frontal vía `writeFillEl`; `gradient` aplica linear-gradient frontal→fondo al inline style de capas HTML (SVG: omitido honesto v1).

### 4.2 Teclado (EditorV2, handlers definidos antes del efecto + deps)
| Tecla | Acción |
|---|---|
| `Ctrl+8` / `⌘8` | Componer trazado compuesto (≥2 capas path → 1 path multi-M en la capa más al frente; las demás se eliminan en el MISMO documento, undo atómico) |
| `Ctrl+Alt+8` / `⌘⌥8` | Liberar compuesto (1 capa multi-M → N capas en su mismo lugar z, cada clon hereda pintura y reglas CSS vía `cloneLayerCssBlocks`) |
| `X` | Intercambiar fill/stroke (paint swap) |
| `D` | Pintura por defecto (blanco/negro) |
| `,` | Rellenar con el color frontal |
| `.` | Sin relleno |
| `Enter` | Diálogo numérico X/Y/W/H/Ángulo con selección activa y tool select/hand |

Las paint keys operan sobre el HTML con `layerPaint` (multi-selección: cada capa SVG; capa no-SVG: toast "Solo capas SVG por ahora."). El Enter del diálogo lee la caja VIVA del DOM (`frameBoundsRegistry`, escala calculada del propio contenido para no depender del zoom capturado) y aplica inline style + regla CSS (`updateCssProperty`) — la convención doble de la UI.

### 4.3 Panel contextual
Sección **Distorsión** (capa con path): grid de 6 kernels (Remolino/Fruncir/Inflar/Cristalizar/Festonear/Arrugar) + fila Warp (select de 8 presets ES + Cantidad px) → prop `onDistortPath(effect, opts)`. Sección **Mezclar** (exactamente 2 capas): Pasos (1-50, default 6) + invertir B + botón → `onBlendLayers(steps, flipB)`.

## 5. MCP (`netlify/functions/mcp.mjs`, mismos motores vía import TS esbuild como REQ-043)

5 tools nuevos sobre la cirugía de capas existente (patrón edit_path/pathfinder):
- **`compound_path`** — mode make (layerIds[] ≥2; la capa más al frente conserva el compound con `fill-rule="evenodd"`, las demás se eliminan con sus reglas CSS) / release (layerId; 1 → N capas con pintura y CSS heredados, ids `randomUUID`). Los d se combinan en su espacio compartido (convención de pluma, igual que pathfinder).
- **`distort_path`** — effect (twirl/pucker/bloat/crystallize/scallop/wrinkle/warp), amount px (default 30), radius/cx/cy (default bbox del trazado), seed determinista (default 1), preset warp (8). Re-hornea la máscara si el path es `data-mask-for`. Compuestos no soportados en v1 (error honesto).
- **`blend_path`** — layerIdA/B, steps 1-50 (default 6), flipB (omitido = auto). Cada paso se inserta como capa nueva detrás de B, clonando pintura y reglas CSS.
- **`width_path`** — profile[{t,w}], baseWidth (default stroke-width), caps round/flat. Requiere trazo; el stroke se expande a forma (fill = color del trazo, stroke = none).
- **`transform`** — dx/dy o left/top, scale (ancla sup-izq) o width/height, rotate (reemplaza SOLO la función rotate del transform existente). Escribe inline style + regla CSS (`setCssDeclaration`) — la convención doble de la UI.

## 6. Decisiones documentadas

- **Z sin tool**: el teclado conserva Z/⇧Z = zoom in/out (REQ-044); la herramienta zoom va SIN atajo para no chocar.
- **Warp 8 presets v1**: fórmulas sobre coords normalizadas del bbox (arc/bulge/flag/wave/fish/fisheye/rise/twist); envelope deformable real queda fuera de alcance.
- **Live Paint lite**: pintar la cara bajo el cursor como capa nueva (caras del divide del pathfinder); el group/knife interactivo de Illustrator no se replica en v1.
- **Width = expand real**: SVG no tiene trazos de ancho variable; el stroke se reemplaza por una forma cerrada con perfil (lo mismo que hace el botón Expand de Outline Stroke, pero con ancho variable).
- **Compound a nivel string d**: parsePathData/serializePathData no se tocan (single-subpath); v1 asume espacio compartido entre capas (pen/frame coords), misma suposición que pathfinder v2.
- **Determinismo**: RNG mulberry32 con seed explícita en crystallize/wrinkle — QA y MCP reproducibles.

## 7. Criterios de aceptación (verificados)

1. `npx tsc --noEmit` limpio.
2. 6 suites QA verdes (trace, path-commands, pathfinder-boolean, scissors-knife, path-ops2, path-ops3).
3. `node --check` + esbuild de mcp.mjs (`--platform=node --packages=external`) limpios.
4. `npm run sync:skill` regenera catálogo + conteos (5 tools nuevos).
5. Los 5 tools MCP corren con los mismos motores que la UI (cero drift).
