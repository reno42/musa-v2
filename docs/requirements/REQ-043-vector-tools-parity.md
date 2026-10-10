# REQ-043 — Paridad de herramientas vectoriales nivel Illustrator: busca-trazos local + pathops completos

Fecha: 2026-10-09 · Estado: propuesto · Origen: dolor declarado por Ren ("el busca-trazos actual es una porquería" — hoy es solo Quiver AI, una API externa sin parámetros) + abandono de usuarios que vienen de Illustrator y no encuentran las herramientas de precisión vectorial. Análisis hecho contra el snapshot clean-room en `reference/vectorcraft/` (MIT/Apache-2.0), leído como SPEC de algoritmos.

---

## 0. Regla de licencia (obligatoria, leer primero)

- El código de `reference/vectorcraft/` es MIT/Apache-2.0: **leerlo y reimplementar es legal; copiar código literal NO**.
- Los archivos `.rs` se usan como **spec**: sus doc-comments explican el math (Douglas–Peucker, Zhang–Suen, least-squares Bézier fit de Graphics Gems, median cut + k-means, boundary following en pixel-crack). Reimplementar en TypeScript desde esas descripciones, con nombres, estructura y comentarios propios.
- Prohibido usar los nombres "VectorCraft" o "ArtCraft" en código, UI o docs.
- Cada módulo nuevo debe llevar un doc-comment propio citando el ALGORITMO publicado (no el repo): p. ej. `/** Cuantización: histograma de color 15-bit + median cut + k-means ponderado (Heckbert median cut; Lloyd k-means). */`

---

## 1. Objetivo

Que un usuario que viene de Illustrator encuentre en el editor de Musa las herramientas de precisión vectorial que hoy lo hacen abandonar, empezando por la #1: un **busca-trazos (image trace) local, con presets y parámetros reales**, que reemplace el flujo actual (Quiver AI: SVG opaco, sin control, requiere key de pago).

Todo client-side en TS (web worker), sin keys nuevas, sin backend nuevo.

---

## 2. Inventario REAL del editor de Musa hoy (verificado en código)

### 2.1 Tools de dibujo (`HtmlToolName`, `src/components/InfiniteHtmlCanvas.tsx:29`; rail en `src/components/FloatingToolbar.tsx`)

| Tool | Estado |
|---|---|
| select, hand, frame | OK |
| rect, circle, triangle, star, polygon | OK (drag; Shift para lados) |
| text, text-path | OK |
| pen, pen-plus, pen-minus, pen-edit (convert), pencil | OK básicos |
| eraser (máscara no destructiva en img), wand (SAM), eyedropper, paint-bucket, gradient | OK |

### 2.2 Operaciones de path

| Capacidad | Estado real |
|---|---|
| Buscatrazos booleano | `src/lib/pathBoolean.ts` con `polygon-clipping`: SOLO union/subtract/intersect/exclude (2+ shapes), UI en `HtmlContextualPanel.tsx` (~2104) y `EditorV2.tsx` (~3820). Sin Divide/Trim/Merge/Crop/Outline/MinusBack. |
| Alineación | 6 botones en `HtmlContextualPanel.tsx` (~532). **Distribute no existe en UI** (solo en la tool MCP `align_elements`). |
| Smart guides | `src/lib/smartGuides.ts`: solo bbox (edges/centros/spacing). Sin snap a anchors ni a trazos. |
| `shape_to_path`, `outline_stroke`, `offset_path` | Server-side vía MCP (`netlify/functions/mcp.mjs`). **`offset_path` es FAKE**: escala el bbox (mcp.mjs:18998-19009) — no es un offset geométrico. `outline_stroke` usa svg-path-commander. Ambos con roundtrip servidor + reload del template. |
| Pencil | `DesignFrame.tsx:3002`: polyline de segmentos `L` cada 3px. `finalizePenPath` (DesignFrame.tsx:4009) serializa anchors RECTOS: **sin suavizado ni ajuste Bézier**. |
| Modelo geométrico | `src/lib/pathData.ts` + `src/lib/bezierMath.ts`: modelo anchor con cpIn/cpOut, de Casteljau, intersecciones, splits, degeneracias. **Buena base, reutilizable.** |

### 2.3 El "busca-trazos" actual (el dolor #1)

`src/lib/quiverStream.ts` → POST `/api/quiver/vectorize` (proxy a Quiver AI). Devuelve un `<svg>` generado por un modelo externo: **sin presets, sin threshold/paleta/ruido, sin previsualización en vivo, sin determinismo, requiere key y consume créditos**. No hay trace local en ninguna parte del repo.

### 2.4 Lo que NO existe en Musa (verificado: 0 matches en src/)

Simplify, Smooth, Join, Average, Scissors, Knife, Width tool, Warp/Twirl/Pucker/Bloat/Scallop/Crystallize/Wrinkle, Reshape, Shape Builder, Live Paint, Blend, Curvature, Lasso, Group Selection, Reflect/Shear como tools interactivas, Distribute (UI), Live Corners, Shaper, Blob Brush, Path Eraser, Split Into Grid, Add Anchor Points, Remove Redundant Points, Object Mosaic, image trace local.

---

## 3. Inventario VectorCraft (spec de referencia)

### 3.1 `crates/trace/` (5,311 líneas) — busca-trazos raster → vector

- **`quantize.rs`**: reducción de color. B/N: luma `0.299/0.587/0.114` vs threshold, alpha<128 = transparente. Grayscale: k-means 1-D sobre histograma de 256 niveles (2–256 grises). Color: histograma de color 15-bit con medias exactas por bin → **Limited** = median cut a `colors` + k-means ponderado; **Full Tone** = median cut hasta cajas ajustadas, `color_detail` 0–100 controla separación; **Automatic** = uno de los dos según si la imagen es flat; **Document Library** = colores más usados de una librería de swatches.
- **`denoise`** (en quantize.rs): componentes 4-conectados del mismo color con < `noise` px se fusionan al color vecino más común.
- **`contour.rs`**: boundary following en la malla pixel-crack (vértices = esquinas de pixel). Bordes dirigidos con el interior a la derecha: contornos exteriores CW y agujeros CCW (y hacia abajo) → fill correcto con cualquier fill-rule. En saddles gira a la derecha (4-conectividad, diagonales separadas).
- **`fit.rs`**: loop → polígono (Douglas–Peucker sobre vértices crack, con "dejag") → Béziers cúbicos por least squares con detección de corners. **Parámetros derivados de la UI**: `polygon_tolerance = 0.55 + 0.75·(1−paths/100)`, `fit_tolerance = 0.2 + 1.6·(1−paths/100)`, `corner_angle = 150° − 115°·(corners/100)`; `snap_curves_to_lines` convierte curvas casi rectas en líneas.
- **`centerline.rs`** (Create: Strokes): distance transform chamfer 3-4 → componente 8-conectado con ancho ≤ `stroke_width` es "línea" → esqueletización Zhang–Suen píxel a píxel (conserva topología) → grafo de runs entre extremos/junctions (spurs cortos podados) → polilíneas → mismo fit; grosor del trazo = px/longitud media.
- **`logo/`** (modo Flat Logo): lee cada pixel como mezcla de los colores planos del logo, interpola y pone cada borde donde dos colores están igual de presentes (sub-pixel); restaura corners que el anti-aliasing redondeó, rectas y arcos exactos (círculos), contadores cerrados se pintan blancos; máx 10 colores, colores a distancia RGB <12 cuentan como uno; rechaza gradientes/fotos con error explicado (`NotFlat`).
- **`mosaic.rs`**: Object Mosaic — color promedio de una grilla cols×rows de tiles.
- **`lib.rs`**: `TraceParams` completo (sección 4), límites (MAX 64 MP; error `TooComplex` con >max anchors), capas ordenadas mayor-área-primero, método **Abutting** (cada color su área, comparten borde) vs **Overlapping** (apilado, sin hairlines), `ignore_white` (≥245), `fills` + `strokes` (Create).

### 3.2 `crates/pathops/` (4,231 líneas) — Object → Path / Pathfinder

- **`boolean.rs`**: booleans que preservan curvas (sweep sobre Béziers, refit de piezas), `unite_all` (N shapes), `normalize` por fill-rule.
- **`pathfinder.rs`**: las **10 ops del panel Pathfinder** sobre stack ordenado: `Unite, MinusFront, Intersect, Exclude, Divide, Trim, Merge, Crop, Outline, MinusBack`; cada resultado conserva el paint (key) de la shape que corresponde; `Region` = cara del arrangement con sus shapes fuente.
- **`planar.rs`**: mapa planar para Shape Builder / Live Paint: paths abiertos entran ida-y-vuelta y se cuentan cruces de frontera (no winding, que se cancela); sweep en marco cortado (shear 1/32) para coincidencias exactas.
- **`offset.rs`**: `offset_path` REAL (con Cap/Join/miter limit), `outline_stroke` (área del stroke como compound path limpio), `stroke_region`.
- **`edit.rs`**: `Simplify` (`SimplifyOptions{tolerance, corner_angle_deg:30, straight_lines}`; nunca agrega anchors), `Smooth`, `Remove Redundant Points`, `Add Anchor Points`, `Average`, `Join`, `Split Into Grid`.
- **`fit.rs`**: fit cúbico least-squares (Graphics Gems): chord-length params → Newton ≤6 rondas → split en el peor punto; G1 entre cubics consecutivos.

### 3.3 `crates/geom/` — kernel geométrico

`shapes.rs` (generadores con el anchor layout de AI, KAPPA=0.5523, CornerKind round/inverted-round/chamfer), `corners.rs` (Live Corners sobre cualquier path: anchor sin handles entre dos lados rectos en ángulo), `recognize.rs` (Shaper: línea/rectángulo/elipse/polígono regular/scribble por cierre, corners tras RDP grueso, fit de bordes, llenado del bbox), `snap.rs` (grid + candidatos de smart guides), `arc.rs` (parametrización por arc-length: type-on-path, brackets), `hit.rs` (fill_contains por winding, stroke_contains, intersects_rect para marquee), `projective.rs` (homografía/perspectiva).

### 3.4 `crates/tools/` (~23k líneas, `catalog.rs`)

~70 tools con shortcuts (orden de toolbar avanzada de AI). Las que Musa no tiene y valen para este REQ: direct selection con snap a anchors/trazos y marquee de anchors, corner widgets (Live Corners), pencil/smooth/path-eraser/join, eraser/scissors/knife + mirrorCut/lineCut/rectCut, shaper, curvature, rotate/reflect/scale/shear/reshape, width + 7 distorts, shape builder/live paint bucket/live paint selection, blend, lasso, group selection, object mosaic.

---

## 4. Spec del port del busca-trazos a TS (P1 #1 — implementar primero)

### 4.1 `TraceParams` (nuevo `src/lib/trace/params.ts`)

```ts
export type TraceMode = "blackAndWhite" | "grayscale" | "color" | "logo";
export type TracePalette = "limited" | "fullTone" | "automatic" | "documentLibrary";
export type TraceMethod = "abutting" | "overlapping";

export interface TraceParams {
  mode: TraceMode;
  /** B/N: píxeles con luma < threshold son negros (0–255). Default 128. */
  threshold: number;
  palette: TracePalette;          // solo Color
  /** Limited: tamaño de paleta (Color) / nº de grises 2–256 (Grayscale). Default 6. */
  colors: number;
  /** Full Tone / Automatic: 0 pocos – 100 muchos colores. Default 50. */
  colorDetail: number;
  /** Document Library: colores sRGB de la librería (máx `colors` usados). */
  swatches: Array<[number, number, number]>;
  /** Fidelidad 0–100: qué tan pegado al pixel. Default 50. */
  paths: number;
  /** Corners 0–100. Default 75. */
  corners: number;
  /** Áreas < noise px se ignoran. Default 25. */
  noise: number;
  method: TraceMethod;            // default "abutting"
  ignoreWhite: boolean;           // sin shape de fondo blanco (luma ≥ 245)
  snapCurvesToLines: boolean;     // curvas casi rectas → líneas
  fills: boolean;                 // Create: áreas rellenas
  strokes: boolean;               // Create: líneas finas como trazos
  strokeWidth: number;            // px del rasgo más ancho que se traza como stroke. Default 10.
  logoColors: string[];           // modo logo: "#rrggbb"; vacío = autodetectar (máx 10, fusión a dist 12)
}
```

Fórmulas de derivación (idénticas a la spec, comentarios propios):
- `polygonTolerance = 0.55 + 0.75 * (1 - paths/100)` px
- `fitTolerance = 0.2 + 1.6 * (1 - paths/100)` px
- `cornerAngle = 150 - 115 * (corners/100)` grados
- `MAX_PIXELS = 64<<20` (rechazar antes de decodificar); límite de anchors configurable (`TooComplex` con mensaje accionable: "sube Ruido, baja Trazos/Colores o elige un preset de menor fidelidad").

### 4.2 Presets built-in (13, orden del panel) — `src/lib/trace/presets.ts`

| Preset | mode | params |
|---|---|---|
| Default | B/N | threshold 128, paths 50, corners 75, noise 25 |
| High Fidelity Photo | Color | colors 64, paths 90, corners 25, noise 4, **overlapping** |
| Low Fidelity Photo | Color | colors 20, paths 60, corners 50, noise 12, **overlapping** |
| 3 Colors | Color | colors 3, paths 60, corners 60, noise 20, abutting |
| 6 Colors | Color | colors 6, paths 65, corners 60, noise 16, abutting |
| 16 Colors | Color | colors 16, paths 70, corners 55, noise 10, abutting |
| Shades of Gray | Grayscale | colors 8, paths 60, corners 50, noise 10, overlapping |
| Black and White Logo | B/N | threshold 128, paths 95, corners 80, noise 8, ignoreWhite, snapCurvesToLines |
| Sketched Art | B/N | threshold 150, paths 50, corners 50, noise 100 |
| Silhouettes | B/N | threshold 200, paths 40, corners 60, noise 30 |
| Line Art | B/N | threshold 128, paths 80, corners 70, noise 10 |
| Technical Drawing | B/N | threshold 128, paths 95, corners 90, noise 4, ignoreWhite, snapCurvesToLines |
| Flat Logo | logo | colors 8, paths 60, corners 50, noise 6, snapCurvesToLines |

### 4.3 Pipeline (nuevos módulos bajo `src/lib/trace/`)

```
trace(imageData, params) → TraceResult
 1. quantize.ts     — mode B/N (luma vs threshold), grayscale (kmeans1D sobre hist 256),
                      color (hist 15-bit → median cut (+kmeans ponderado) | fullTone | automatic | library),
                      alpha<128 = TRANSPARENT.
 2. denoise         — componentes 4-conectados < noise px → color vecino más común (BFS).
 3. order           — capas por área descendente (bottom→top); skip blanco si ignoreWhite.
 4. contour.ts      — boundary following pixel-crack por capa: loops exteriores CW, agujeros CCW,
                      right-turn en saddles. (Directamente portable: aritmética de enteros.)
 5. fit.ts          — por loop: Douglas–Peucker (stack iterativo) → fit cúbico least-squares
                      (chord params → Newton ≤6 → split en peor punto; corners si ángulo > cornerAngle;
                      snapCurvesToLines si desviación de la cuerda < fitTolerance/3).
 6. centerline.ts   — si strokes: chamfer 3-4 DT → componentes 8-conn con ancho ≤ strokeWidth →
                      Zhang–Suen thinning → grafo runs/junctions (podar spurs) → polilíneas → fit;
                      width del trazo = px/longitud.
 7. ensamblar       — TraceResult { paths: [{d (coordenadas en px de la imagen), color, pixels,
                      strokePx?}], palette } → el llamador lo convierte a un <svg> con un <path>
                      por shape (fill-rule según método; abutting comparte aristas).
```

El **modo logo** (`unmixing` sub-pixel + restauración de corners/arcos) es el bloque más caro del crate (~40% de sus líneas): portearlo en la Fase 4, NO en la Fase 1. En Fase 1–3, `mode:"logo"` degrada a B/N con threshold automático (Otsu) y `snapCurvesToLines`.

### 4.4 Ejecución y UI

- **Worker**: `src/workers/trace.worker.ts` (mismo patrón que `src/workers/ghostscript.worker.ts`). Recibe `{imageData: ImageData-like (transferable), params, maxAnchors}`; postMessage de resultado parcial por capa (progreso) y final. Cancelable. Sin `onnxruntime` ni canvas en el worker: puro JS sobre Uint8ClampedArray.
- **UI — panel Buscatrazos** (nueva sección en `src/components/HtmlContextualPanel.tsx` cuando la selección es un layer `<img>`, y entrada en el menú AI junto a "Vectorizar"):
  - Preset dropdown (los 13) + toggle "Preview en vivo".
  - Mode (B/N / Grises / Color), Threshold slider (solo B/N), Palette + Colors + Color detail (Color), Paths / Corners / Noise sliders, Method (Adyacente/Superpuesto), Ignore white, Snap curves, Create: Fills/Strokes/Stroke width.
  - "Expandir" (confirmar) crea un **grupo de shapes SVG** (un `<svg data-layer-kind="svg">` con un `<path>` por TracedPath, fill=hex, en las coords del layer de imagen original; la imagen se oculta, no se borra). Undoable con el undo existente.
  - Fallo con mensaje accionable (`TooComplex`, imagen vacía, >64MP).
- **Quiver queda como opción secundaria** ("Vectorizar con IA") para fotos/artístico; el local pasa a ser el default.

### 4.5 Archivos de Musa a tocar (trace)

| Archivo | Cambio |
|---|---|
| `src/lib/trace/params.ts`, `presets.ts`, `quantize.ts`, `contour.ts`, `fit.ts`, `centerline.ts`, `index.ts` | NUEVOS (port spec §4.3) |
| `src/workers/trace.worker.ts` | NUEVO |
| `src/components/HtmlContextualPanel.tsx` | Panel Buscatrazos para layers `<img>` |
| `src/pages/EditorV2.tsx` | Estado del panel, handler `confirmTrace()` (svg → layer grupo), menú AI: "Vectorizar imagen (local)" default, Quiver secundario |
| `src/lib/quiverStream.ts` | Sin cambios (sigue como opción) |
| `QA/trace.test.mjs` | NUEVO: fixtures sintéticos (círculo AA, logo 4 colores, foto gradiente) con aserciones de área/color/anchors |

---

## 5. Gap analysis priorizado (dolor Illustrator × costo TS)

Esfuerzo: S ≤1 día-agente · M 1–3 · L >3. Prioridad: [P1] crítico-dolor-alto · [P2] valioso · [P3] nice-to-have.

| # | Pri | Herramienta | Qué hace | Spec VectorCraft | Dónde en Musa | Esf. |
|---|---|---|---|---|---|---|
| 1 | **[P1]** | **Busca-trazos local** | raster→vector con presets/params/vivo | `trace/*` (§4) | §4.5 | **L** |
| 2 | **[P1]** | **Simplify / Smooth / Remove Redundant / Add Anchor Points / Join** | comandos Object→Path | `pathops/edit.rs` | nuevo `src/lib/pathOps/edit.ts`; UI menú contextual (`HtmlContextualPanel` + `CanvasContextMenu`) | M |
| 3 | **[P1]** | **Offset Path REAL** (reemplaza el fake de bbox-scale) + **Outline Stroke client-side** | offset con cap/join/miter; stroke→fill | `pathops/offset.rs` | portear a `src/lib/pathOps/offset.ts` y llamar desde `EditorV2.tsx` (~4630) en vez de `mcpCall("offset_path"/"outline_stroke")` | M |
| 4 | **[P1]** | **Pencil con ajuste Bézier + Smooth** | freehand suave, no polyline | `trace/fit.rs` (RDP+fit) reutilizado | `DesignFrame.tsx:3002-3064` (al soltar: RDP → fit cúbico → anchors con handles) | S |
| 5 | **[P1]** | **Pathfinder completo**: Divide, Trim, Merge, Crop, Outline, MinusBack (hoy solo 4 ops) | panel de 10 ops con paint rules | `pathops/pathfinder.rs` (divide/trim via arrangement; aplanar con `polygon-clipping` + refit es aceptable en TS) | `src/lib/pathBoolean.ts` → ampliar; UI grid 2×5 en `HtmlContextualPanel`/`CanvasContextMenu` | M |
| 6 | **[P1]** | **Scissors** (cortar trazo en un punto) y **Knife** (corte libre a través) | split de paths | `tools/catalog.rs` (scissors/knife); split ya existe en `bezierMath.ts` (`splitBezier`, intersecciones) | `InfiniteHtmlCanvas.tsx` (HtmlToolName) + `DesignFrame.tsx` (pointer handlers) | S (scissors) / M (knife) |
| 7 | [P2] | **Distribute horizontal/vertical + align a selección/lienzo** | Distribución real en UI | estándar (AI Align panel) | `HtmlContextualPanel.tsx` (~532): fila extra de 2 botones; lógica en `EditorV2.tsx` (usa la misma geometría de align existente) | S |
| 8 | [P2] | **Live Corners** (round/inverted/chamfer sobre cualquier path) | widgets de esquina | `geom/corners.rs` + `geom/shapes.rs` (CornerKind) + `tools/corners.rs` | `src/lib/pathOps/corners.ts` + widgets en `shapeHandles.ts`/`DesignFrame.tsx` | M |
| 9 | [P2] | **Curvature tool** | clic a clic con suavizado automático | concept AI; fit de `pathops/fit.rs` | nueva tool en `InfiniteHtmlCanvas`/`DesignFrame` | S–M |
| 10 | [P2] | **Shaper** (garabato → forma limpia; scribble borra) | reconocimiento | `geom/recognize.rs` | `src/lib/pathOps/recognize.ts` + tool | S–M |
| 11 | [P2] | **Centerline "Create Strokes"** (parte del trace) | líneas → trazos centrados | `trace/centerline.rs` | `src/lib/trace/centerline.ts` (Fase 1 lo deja tras interfaz; activar UI en esta fase) | M |
| 12 | [P2] | **Modo Flat Logo** del trace | sub-pixel, corners restaurados | `trace/logo/*` | extensión del trace | **L** |
| 13 | [P2] | Lasso + Group Selection | selección por lazo / por grupo | `tools/select.rs` (marquee toggle) | `InfiniteHtmlCanvas.tsx` | S |
| 14 | [P2] | Object Mosaic | grilla de tiles promediados | `trace/mosaic.rs` (trivial) | `src/lib/trace/mosaic.ts` + acción en menú de imagen | S |
| 15 | [P2] | Mirror & Cut / Line Cut / Rect Cut | cortar arte seleccionado con eje/línea/rect | `tools/cut.rs` | booleans existentes + preview en vivo | M |
| 16 | [P3] | Width tool + distorts (Warp/Twirl/Pucker/Bloat/Scallop/Crystallize/Wrinkle) | distorsión interactiva | `tools/distort*` | cada uno S pero son muchos; hacer solo Width+Warp primero | L |
| 17 | [P3] | Shape Builder + Live Paint | caras del plano pintables | `pathops/planar.rs` + `tools/builder.rs` | el mapa planar es el algoritmo más difícil del crate | **L** |
| 18 | [P3] | Blend tool, Symbols, Graphs, Perspective, Puppet Warp, Mesh | suite avanzada | crates respectivos | fuera de alcance 2026 H2 | L c/u |

Orden dentro de P1 justificado: el trace es el dolor #1 declarado; Simplify/Offset/Pathfinder/Pencil son lo segundo que un ilustrador busca al editar lo que importó.

---

## 6. Recomendación: TS puro vs WASM

**Recomendación: TypeScript puro (web worker), con WASM como contingencia acotada.**

| | TS puro | WASM (compilar crates) |
|---|---|---|
| Bundle/entrega | ~40–80 KB sin comprimir de TS propio en el bundle Vite; worker ya es un patrón del repo (`ghostscript.worker.ts`) | +0.5–1.5 MB de wasm por crate; hay que intalar toolchain Rust/wasm-pack en el build |
| Velocidad | trace 1–2 MP ≈ 1–3 s en worker (el pipeline es O(píxeles) con constantes bajas; `polygon-clipping` ya demostró que JS rinde en este editor) | 5–10× más rápido; importa solo en Full Tone sobre fotos grandes y en el modo logo |
| Integración con el modelo de Musa | directa: produce anchors con cpIn/cpOut para `pathData.ts` (un solo modelo de verdad) | el límite wasm es `PathData` plano → hay que reconstruir anchors igual; dos fuentes de verdad (Rust y TS) |
| Mantenimiento / agentes IDE | todo TS: cualquier agente lo lee, prueba y extiende | los agentes IDE TS no pueden tocar el Rust; bugs del trace requieren toolchain que el repo no tiene |
| Riesgo | port con bugs sutiles (saddles, thinning) → mitigar con los tests de fixtures (§4.5) | riesgo de build/CI y de FFI, no de algoritmo |

Decisión operativa: **Fases 1–3 en TS puro.** Re-evaluar WASM SOLO para el modo Flat Logo (Fase 4) si el QA muestra >5 s en logos típicos o si la calidad sub-pixel del port TS no alcanza la del Rust; en ese caso compilar únicamente `trace/logo` (crate aislado) y mantener el resto en TS.

---

## 7. Fases de implementación (para el agente IDE)

### Fase 1 — Busca-trazos local [P1 #1]
Alcance: `src/lib/trace/{params,presets,quantize,contour,fit,index}.ts` + `src/workers/trace.worker.ts` + panel en `HtmlContextualPanel.tsx` + handler en `EditorV2.tsx` (§4.5). Modo logo degrada a B/N+Otsu. Centerline: dejar el módulo con `lines()` implementado pero UI de Strokes opcional apagada si el tiempo aprieta.
**Criterios de aceptación:**
1. Logo B/N (PNG con anti-aliasing) → paths que con `ignoreWhite` no producen shape de fondo y rellenan agujeros correctamente (fill-rule) — fixture en `QA/trace.test.mjs`.
2. Los 13 presets devuelven params exactos (test de tabla) y "Default" = B/N 128/50/75/25.
3. Cambiar un slider con Preview re-traza en ≤2 s (imagen 1 MP) sin bloquear el hilo (worker).
4. Fotos (High Fidelity) no reventan el límite de anchors: `TooComplex` con mensaje accionable.
5. El resultado queda como grupo de paths editable (pen-edit mueve handles), y Ctrl+Z lo revierte dejando la imagen original visible.
6. Sin ninguna key/red: funciona offline.

### Fase 2 — Comandos de path [P1 #2 #3 #4]
Simplify/Smooth/Remove Redundant/Add Anchor Points/Join (`src/lib/pathOps/edit.ts`), Offset real + Outline Stroke client-side (`src/lib/pathOps/offset.ts`, reemplaza las llamadas MCP en `EditorV2.tsx:4611-4645`), Pencil con fit (patch en `DesignFrame.tsx`).
**Criterios:** Simplify nunca devuelve más anchors que el original; Smooth no mueve endpoints; Offset ±5px sobre un círculo r=50 da radio 55/45 (no un scale anisótropo); Outline Stroke de una línea de 4px produce compound path cerrado; Pencil dibuja curvas con handles (no polyline de L); todos con undo y tests en `QA/path-commands.test.mjs`.

### Fase 3 — Pathfinder completo + Scissors/Knife [P1 #5 #6]
Divide/Trim/Merge/Crop/Outline/MinusBack sobre el motor existente (`pathBoolean.ts`, aplanado + refit); UI grid 2×5 estilo AI con tooltips y atajos; Scissors corta el segmento bajo el clic (usa `closestPathSegment` de `pathData.ts`); Knife arrastra y corta todo lo seleccionado.
**Criterios:** Divide de círculo+rect solapados produce 3 caras con fills correctos (front-most gana); Trim no borra la parte visible del shape de atrás; MinusFront conserva el fill del de atrás; las 10 ops con test de geometría; Scissors sobre un punto de curva inserta anchor con handles correctos.

### Fase 4 — [P2] Live Corners, Curvature, Shaper, Distribute UI, centerline UI, Flat Logo (evaluar WASM aquí)
**Criterios:** widgets de esquina arrastrables en pen-paths con ciclo round/inverted/chamfer (Alt-clic); Curvature produce curva suave con 3 clics; garabato ovalado → elipse exacta (rotación snapped a 45°); Distribute iguala gaps (test: 3 rects → spacing idéntico); Strokes del trace sobre un scan de línea art produce paths abiertos con stroke, no outlines rellenas; Flat Logo sobre logo con AA coloca bordes a <0.5 px del ideal sintético.

### Fase 5 — [P3] el resto (Width/distorts, Shape Builder/Live Paint…)
Solo tras QA en vivo de las fases 1–4 con usuarios reales de Illustrator.

---

## 8. Decisiones

- **D1 trace local primero y como default**: es el dolor #1 declarado; Quiver (IA) queda como alternativa para fotos artísticas.
- **D2 TS puro en worker** (§6): mantenimiento por agentes IDE > 5× de velocidad que hoy no se necesita; WASM solo contingencia del modo logo.
- **D3 reutilizar `pathData.ts`/`bezierMath.ts`** como único modelo de anchors: el port escribe anchors con cpIn/cpOut, no un formato paralelo.
- **D4 booleans sobre polígonos aplanados + refit** (lo que ya hace `pathBoolean.ts` con `polygon-clipping`, dep existente): Divide/Trim con calidad suficiente sin portear el sweep exacto sobre Béziers de `pathops/boolean.rs`.
- **D5 offset_path del MCP se deprecaca en UI** (queda en el server para agentes) en cuanto el client-side real exista: eliminar el roundtrip servidor de la acción del usuario.
- **D6 sin migraciones ni backend**: todo client-side sobre el frame HTML/SVG actual.

## 9. Riesgos

1. **Calidad del fit TS vs Rust**: los presets son sensibles a `fitTolerance`/`cornerAngle`. Mitigación: tests con fixtures sintéticos (círculo, estrella, logo 4-colores) y tolerancias numéricas, más QA visual dogfood antes de Fase 2.
2. **Rendimiento Full Tone en fotos grandes**: capas en paralelo no existen en un worker single-thread → encadenar por capa con progreso y cancelación; bajar resolución del ImageData a 2 MP máx antes de trazar (upscale del resultado al tamaño original).
3. **Zhang–Suen y saddles son fáciles de portear mal**: seguir la spec al pie (thin píxel-a-píxel conservando topología; right-turn en saddles) y probar con diagonales de 1 px.
4. **EditorV2.tsx ya pesa ~575 KB**: sumar el mínimo ahí; la lógica nueva vive en `src/lib/trace` y `src/lib/pathOps` testeadas fuera del componente.

## 10. Regla de licencia (repetida para el ejecutor)

Reimplementar desde los algoritmos publicados descritos en los doc-comments de `reference/vectorcraft/crates/*` — nunca copiar código, nunca nombrar VectorCraft/ArtCraft. Todo módulo nuevo documenta SU algoritmo con referencia académica (median cut, k-means, Douglas–Peucker, Zhang–Suen, Schneider Graphics Gems, boundary following / moore-crack).
