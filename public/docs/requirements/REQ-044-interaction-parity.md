# REQ-044 — Interacción y paridad Illustrator (Fase 1): path ops finales, teclado no conflictivo y comportamientos humanos

Fecha: 2026-10-11 · Estado: **Fase 1 implementada** · Fases 2-3 registradas como pendientes · Origen: gap analysis contra `reference/vectorcraft/` (Rust, derivado de Graphite — leído como SPEC, no copiado; ver regla de licencia en REQ-043 §0) tras completar REQ-043.

---

## 1. Objetivo

Cerrar la brecha de *interacción* que hace abandonar a un usuario de Illustrator: comandos de Object → Path que faltaban (Reverse/Average/Cleanup), teclas de Illustrator que no chocan con la base Figma de Musa, y los comportamientos humanos de canvas (smart guides de capa con espaciado igualado, marquee con modificadores, duplicado con Alt, pan con Space, línea con snap 45°).

Musa conserva su mapa Figma (R/O/S/G/N formas, A frame, W varita) y añade SOLO teclas Illustrator no conflictivas.

## 2. Implementado en Fase 1

### 2.1 Motores puros — `src/lib/pathOps/edit.ts`
- `reversePath(points, closed)`: invierte el orden de anclas e intercambia cpIn↔cpOut (los handles son coordenadas absolutas, así que el swap ES la inversión geométrica correcta; el rol smooth/corner de cada ancla se conserva).
- `averagePath(points, mode: "h"|"v"|"both")`: promedia a Y compartida (h), X compartida (v) o centroide (both); cada handle viaja con el MISMO delta que su ancla.
- `removeStrayAnchors(points, closed)`: elimina SOLO anclas peladas (sin handles) que duplican la posición del vecino (eps 1e-6) y el ancla de cierre duplicada en cerrados; devuelve `{points, removed}` o `null` si no hay nada que quitar o el resultado degeneraría (abierto <2, cerrado <3).
- El helper privado que usaba el nombre `reversePath` para Join se renombró a `reverseJoinableInPlace`. Sin DOM/Node (compat Cloudflare/Workers).

### 2.2 Ops en UI y MCP
- `EditorV2.handleObjectPathOp` ampliado con `"reverse" | "average" | "cleanup"` (+ parámetro `axis`); mensajes ES: "Trazado invertido." / "Anclas promediadas (horizontal|vertical|XY)." / "Limpieza: N ancla(s) suelta(s) eliminada(s)." / "Limpieza: no hay anclas sueltas que quitar."
- `HtmlContextualPanel` (sección "Objeto → Trazado"): botones **Invertir**, **Prom. H**, **Prom. V**, **Prom. XY**, **Limpiar** junto a los existentes; la prop `onObjectPathOp` acepta los 8 ops + `axis`.
- MCP `edit_path` (netlify/functions/mcp.mjs): schema con 8 ops + `axis` enum h/v/both; el case aplica reverse/average/cleanup con el mismo motor; respuesta incluye `removed` (cleanup) y `axis` (average).

### 2.3 Teclado (EditorV2)
| Tecla | Acción |
|---|---|
| `C` | Tijeras (tooltip de pen-edit corregido a ⇧C) |
| `⇧C` | Pen edit / convert |
| `\` | Herramienta línea |
| `⇧Z` | Zoom out (`Z` simple sigue = zoom in) |
| `Ctrl+J` / `⌘J` | Join sobre la capa seleccionada (≥2 capas: une la multi-selección) |
| `Ctrl+2` / `Ctrl+3` | Bloquear / ocultar la capa seleccionada |
| `Ctrl+Alt+2` / `Ctrl+Alt+3` | Desbloquear / mostrar TODAS las capas del frame activo |
| `Ctrl+Shift+A` | Deseleccionar todo (marquee con rect vacío por el registry) |
| `Alt` + flechas | Duplicar y mover el clon en UN paso de undo (`handleDuplicateNudgeSelection`: duplica con `duplicateLayerInHtml` + `cloneLayerCss` y aplica el nudge CSS al clon) |

Nota de implementación: los handlers nuevos se definen ANTES del efecto de teclado y entran en su lista de deps (el toggle de bloqueo/ocultación del panel vive después del efecto — por eso los atajos replican la lógica CSS `pointer-events/display !important` con `appendCssOverride`/`removeCssOverride`).

### 2.4 Comportamientos humanos — `DesignFrame.tsx` / `InfiniteHtmlCanvas.tsx`
- **Alt-drag multi-duplicado**: `duplicateForDrag` ya no se limita a 1 capa; duplica secuencialmente todos los `dragTargets` releyendo `content.innerHTML`, fusiona los idMap, reconstruye los dragItems sobre los clones (cada unidad hereda la geometría cacheada de su original y queda absoluta) y conserva la selección múltiple en los clones.
- **Marquee con modificadores**: `FrameMarqueeFn` recibe `mods?: {shift, alt}` (el canvas pasa los modificadores del mouseup). Sin mods reemplaza; Shift = toggle simétrico con la selección actual; Alt = restar los hits.
- **Cuchillo Shift = 45°**: el extremo del corte se ajusta al ángulo de 45° más cercano desde el ancla, en preview y en el commit.
- **Space+drag = pan temporal**: keydown/keyup de Space (ignorando targets editables y el panel de chat) activa la misma ruta de pan de la mano, con cursor grab/grabbing; blur limpia el estado.
- **Smart guides de capa**: el edge-matching simple del drag se reemplazó por `computeAlignmentGuides` + `computeSpacingGuides` (`src/lib/smartGuides.ts`) sobre bounds de capas hermanas cacheados al inicio del drag + los 4 bordes del frame. Renderiza segmentos de alineación (bordes, cruces y centros) y chips de espaciado igualado en px; snapping conservador con SNAP=8.

### 2.5 Line tool
- `HtmlToolName` += `"line"`. DesignFrame: drag dibuja `M…L…`; Shift ajusta a 45°; crea `<svg data-layer-kind="bezier"><path stroke="#c8b898" stroke-width="2" fill="none">` con viewBox alineado al box (misma convención que el pen) y emite el cambio del frame. FloatingToolbar: entrada en SHAPE_TOOLS con icono SVG propio y atajo `\`.

### 2.6 QA y docs
- `QA/path-ops2.test.mjs` (11 tests): reverse (roundtrip parse→serialize cerrado/abierto, handles intercambiados), average h/v/both (handles viajan con el ancla), removeStrayAnchors (sueltas reales vs curva sana intacta, cierre duplicado, anti-degeneración) e integración con serializePathData. Script `test:path-ops2`.
- SKILL.md raíz: entrada `edit_path` (8 ops), Pattern 11 con ejemplos reverse/average/cleanup + nota de atajos, tablas de Keyboard Shortcuts actualizadas. `scripts/copy-skill.mjs` regenera la copia pública.

## 3. Mapa de teclas (decisión documentada)

Musa mantiene su base Figma (R/O/S/G/N formas, A frame, W varita, T texto, P/B/E pen/pencil/eraser) y añade solo teclas Illustrator NO conflictivas: `C`, `\`, `Ctrl+J`, `Ctrl+2/3`, `Ctrl+8` (Fase 2). Las paint keys `X/D/,/.` requieren una librería `layerPaint` compartida entre panel y atajos — refactor aparte (Fase 2).

## 4. Pendiente — Fase 2 (tools de selección/dibujo)

Curvature tool, lasso, zoom tool dedicado, shape builder, direct-selection con snap a anclas, Ctrl+8, paint keys X/D/,/. (necesitan `layerPaint` compartida), diálogos numéricos con Enter (transform preciso).

## 5. Pendiente — Fase 3 (suite avanzada)

Width tool + distorsiones (Warp/Twirl/Pucker/Bloat/Scallop/Crystallize/Wrinkle), Blend, Live Paint / Pathfinder en vivo, MCP `transform` interactivo.

## 6. Criterios de aceptación Fase 1 (verificados)

1. `reversePath` dos veces = identidad serializable (cerrado y abierto).
2. `averagePath("h")` alinea todas las anclas a la media Y sin tocar X; los handles conservan su forma.
3. `removeStrayAnchors` no toca curvas sanas y nunca deja menos anclas que el mínimo.
4. Los 8 ops de `edit_path` corren server-side con el mismo motor que la UI (bundle esbuild limpio).
5. Marquee Shift/Alt y Ctrl+Shift+A cubren toggle/restar/deseleccionar sin tocar el marquee simple.
6. Alt+flecha duplica+nudge en un solo undo; Alt+drag duplica la selección múltiple completa.
7. `npx tsc --noEmit` limpio; 5 suites QA verdes (trace, path-commands, pathfinder-boolean, scissors-knife, path-ops2).
