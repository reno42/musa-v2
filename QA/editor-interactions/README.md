# Editor Interactions — suite roja

Prueba el editor **como lo usa un humano**: eventos de mouse/teclado sintéticos sobre el
shadow DOM real, en un Chrome headless del sistema (via `puppeteer-core`, sin descargar
Chromium). Codifica los tres síntomas de `PLAN_EDITOR_CORE.md §2` como asserts
comprobables. **Son ROJOS a propósito hoy**: son la definición de terminado del Agente IDE
para los Sprints 0-2. Cuando un sprint los ponga en verde, el bug está resuelto de verdad.

## Cómo correr

```bash
npm run test:editor
```

El runner:
1. Asegura que estén arriba **vite (:5173)** y **api (:3001)** — si faltan, los arranca y los
   apaga al terminar (los que ya tenías corriendo NO los toca).
2. Crea plantillas de prueba desechables vía MCP (`x-api-key: dev-key`).
3. Abre el editor en Chrome headless y dirige gestos sintéticos.
4. Reporta cada assert y sale con código ≠0 si algo falla.

**Modo guardián** (para el gate de CI mientras el bug siga vivo):
```bash
EXPECT_RED=1 npm run test:editor   # sale 0 si las pruebas de bug SIGUEN rojas; 1 si alguna pasó
```
Úsalo para detectar cuándo un sprint resuelve (¡o rompe!) un bug sin querer.

Variables útiles: `CHROME_PATH` (ruta a Chrome/Edge si no se autodetecta).

## Qué prueba cada archivo

| Archivo | Síntoma | Assert clave | Estado hoy |
|---|---|---|---|
| `test-s1-commit-selection.mjs` | S1 · commit congela / mata selección | **S1.1** un commit html preserva la identidad de los nodos no tocados (hoy `innerHTML` re-crea todo → 0 sobreviven) | 🔴 **RED** (confirma el bug) |
| `test-s2-click-mutation.mjs` | S2a · el click muta el DOM | el click no reconstruye el subárbol ni destruye el nodo | 🟢 guarda (ver hallazgo abajo) |
| `test-s3-undo-invariant.mjs` | S3 · undo intermitente | **S3.1** `undo×N == inicial` / `redo×N == final`; **S3.2** un Ctrl+Z revierte un scrub completo de tamaño de fuente | 🔴 **RED** (round-trip roto + sin coalescing) |
| `test-perf-budgets.mjs` | fluidez | selección <50ms, commit <30ms, drag ≥55fps en frame de 200 capas | 🟢 guarda (verde hoy; debe seguir verde tras Sprint 2) |

## Cómo observa (sin editar el editor)

- **Identidad de nodos**: marca cada capa con una propiedad JS `__qaMark` (nunca se
  serializa). Si `content.innerHTML = frame.html` reconstruye el árbol, todas las marcas
  desaparecen → `survivors === 0` prueba la re-creación total.
- **Selección**: lee la caja de selección del overlay `#__df_overlay` en el shadow DOM.
- **Mutaciones**: `MutationObserver` sobre el subárbol de contenido durante un gesto.
- **Estado para undo**: huella geométrica vía `window.futurariaAgent.inspectFrame` + hash del
  `<style>` del shadow.
- **Gestos**: `MouseEvent`/`KeyboardEvent` con `composed:true, bubbles:true` (patrón de
  `docs/AGENT_BRIDGE.md`), despachados directamente sobre el nodo objetivo dentro del shadow.

## Hallazgos de la verificación (2026-07-16)

1. **S1.1 — confirmado 🔴**: cualquier operación que commitea HTML corre el efecto
   `frame.html` (`DesignFrame.tsx:330-343`) → `content.innerHTML = frame.html`, que re-crea
   TODOS los nodos y hace `selectedRef=null; clearOverlay()`. Un cambio en una capa destruye
   la identidad de todas. Es la raíz del cuelgue y de "pierdo la selección".
2. **S3.1 — confirmado 🔴**: `undo×N` no devuelve al estado inicial (round-trip roto),
   coherente con los 77 `pushUndo` manuales de granularidad inconsistente.
3. **S3.2 — confirmado 🔴**: cada `onChange` de un input del panel apila su propio undo
   (`ScrubbyInput`, `HtmlContextualPanel.tsx:202`), así que un "scrub" de ~15 ajustes de
   tamaño se vuelve 15 pasos; un Ctrl+Z revierte 1. Falta el coalescing por gesto (Sprint 0.4).
4. **S2a — YA MITIGADO 🟢 (hallazgo)**: `ensureLayerIds` (`src/lib/htmlMutations.ts`) ya se
   ejecuta en la carga de cada frame (`EditorV2.tsx:377,397`), así que los nodos ya traen
   `data-layer-id` y la rama de asignación en el click (`DesignFrame.tsx:1343`) está muerta
   para contenido cargado. **El Sprint 0.2 está de facto hecho para el camino normal.** La
   prueba se conserva como **guarda de regresión**: si se quita `ensureLayerIds`, se pone roja.
   (El "grupo misterioso" — S2b — depende del modelo de scope del Sprint 3 y de una estructura
   DOM específica donde un contenedor recibe el click; no se fuerza un rojo artificial aquí.)
5. **Perf — verde hoy 🟢**: con las guías de snap ya cacheadas por gesto, los presupuestos
   pasan holgados. Son guardas: deben SEGUIR verdes tras el reconciliador del Sprint 2.

## Definición de terminado por sprint (para el Agente IDE)

- **Sprint 0.1 / 0.3 + Sprint 2** → `S1.1` en verde (reconciliador incremental + selección
  re-resuelta por `data-layer-id`).
- **Sprint 1** → `S3.1` en verde (store transaccional; una operación = una transacción).
- **Sprint 0.4** → `S3.2` en verde (coalescing por gesto con debounce por control).
- **Sprint 2** → los presupuestos de `perf` siguen verdes con 200 capas + imágenes base64.
