# PLAN_EDITOR_CORE — Estabilidad y fluidez del editor

**Autor:** Claude (Fable 5) · **Fecha:** 2026-07-16 · **Estado:** aprobación pendiente de Renzo
**Equipo ejecutor:** Agente IDE (Qoder/GLM5.2) · Opus 4.8 (Claude Code) · Lara (OpenClaw/DeepSeek v4pro)

---

## 1. Resumen ejecutivo

El harness funciona (replicación, batch, decks). El editor NO está a la altura: commits
lentos que congelan la UI, selección impredecible sobre diseños replicados, y un undo
que falla de forma intermitente. **Las tres cosas tienen la misma raíz**: no existe un
modelo de documento transaccional — el estado vive repartido entre React (`frames[]`),
el shadow DOM (mutado imperativamente) y 77 llamadas manuales a `pushUndo`, y cada
commit re-sincroniza TODO el frame con `innerHTML`.

Este plan NO es una lista de parches: es 1 sprint de alivio inmediato + 3 sprints que
instalan la arquitectura correcta (store transaccional → sync incremental → selección
con scope), con criterios de aceptación medibles y verificación multi-agente.

---

## 2. Diagnóstico — síntomas → causas raíz (confirmadas en código)

### S1. "Muevo algo y se cuelga; no veo el movimiento en tiempo real"
El drag EN SÍ es fluido (las guías de snap se cachean una vez por gesto,
`DesignFrame.tsx` → `collectGuides` con `cachedGuides` — por eso mover FRAMES se
siente bien). Lo que congela es el **commit al soltar**:

```
mouseup → emitFrameChange(css, html) → EditorV2.handleFrameCssChange (línea ~596)
       → setFrames(...) → efecto frame.html (DesignFrame.tsx:311-324)
       → content.innerHTML = frame.html   ← reconstruye TODO el shadow DOM
```

- Re-parsea todas las capas, re-decodifica imágenes (los diseños del batch llevan
  base64 → cientos de KB re-decodificados por CADA movimiento).
- El mismo efecto hace `selectedRef = null; clearOverlay(); pen reset` → **la
  selección muere después de cada operación** → "no puedo regresar las cosas a su
  lugar" (hay que re-seleccionar tras cada movimiento, y a veces el click cae en
  otro nodo porque el DOM es nuevo).

### S2. "Clickeo una imagen y se selecciona un grupo misterioso; se mueve todo"
Dos causas que se suman:

**a) Mutación en pleno click** (`DesignFrame.tsx:1243-1247`): si el nodo clickeado no
tiene `data-layer-id`, el mousedown se lo asigna Y emite `onHtmlChange` →
`setFrames` → `innerHTML` rebuild **mientras el mouse sigue presionado** → el nodo
bajo el cursor es destruido y reemplazado; los handlers del drag quedan apuntando a
nodos huérfanos → comportamiento errático, movimientos que no se aplican o se aplican
al contenedor.

**b) Sin modelo de scope**: en un diseño replicado, el texto suele estar posicionado
ENCIMA de la imagen dentro de un contenedor (`.card > img + h1 + p`). El hit real del
click es el contenedor (o un wrapper transparente) → se selecciona y se arrastra el
contenedor con TODO adentro. No existe el gesto de Figma "click = objeto top-level,
doble click = entrar al grupo, Esc = salir".

### S3. "Ctrl+Z a veces sí, a veces no"
- **77 sitios** llaman `pushUndo` a mano en `EditorV2.tsx`. Cualquier ruta de mutación
  que lo olvide (o que mute el DOM sin pasar por React) produce un estado que undo no
  conoce → "no funciona".
- Inputs scrubby del panel commitean por *tick* → 40 micro-entradas en la pila →
  Ctrl+Z "no hace nada" (deshace 1px).
- Con foco dentro de un contenteditable del shadow DOM, el Ctrl+Z lo captura el undo
  nativo del navegador, no el de la app.
- No existe invariante verificada `estado ⇄ DOM` después de undo.

### S4. Pérdida de trabajo
Consecuencia de S1+S2+S3: seleccionas mal → mueves lo que no era → undo no responde →
el autosave persiste el estropicio. **La pérdida de trabajo es el bug compuesto, no
uno individual.**

---

## 3. Arquitectura objetivo (3 piezas)

### 3.1 `DocumentStore` transaccional — única fuente de verdad
`src/lib/documentStore.ts` (nuevo, sin dependencia de React):

```ts
interface DocumentStore {
  getFrames(): FrameData[];                          // inmutable hacia afuera
  begin(label: string): Transaction;                 // 1 gesto = 1 transacción
  commit(tx: Transaction): void;                     // apila para undo, notifica
  apply(frameId, patch: {html?, css?, meta?}): void; // solo dentro de una tx
  undo(): void; redo(): void;
  subscribe(listener: (change: FrameChange) => void): () => void;
}
```

Reglas:
- **Toda** mutación (drag, resize, panel, texto, pen, MCP reload, batch, undo) entra
  por `begin/commit`. Cero `pushUndo` manuales — el store lo hace solo. Los 77 sitios
  actuales se migran y se BORRAN.
- Un gesto de usuario = UNA transacción (drag completo, sesión de texto completa,
  scrub completo de un input — coalescing con debounce de 300ms por control).
- `FrameChange` describe QUÉ cambió (frameId + layerIds afectados + hash), no "todo".

### 3.2 Sync incremental por capa — fluidez
Reemplazar el efecto `content.innerHTML = frame.html` por un reconciliador:

- Parse del html entrante una vez → mapa `layerId → outerHTML hash`.
- Diff contra el DOM actual: solo `replaceWith()` en capas cuyo hash cambió;
  insertar/eliminar las que aparecen/desaparecen; NUNCA tocar las demás.
- **Echo-suppression de HTML** (hoy solo existe para CSS via `lastEmittedCssRef`):
  un cambio originado por el propio DesignFrame no debe re-sincronizar nada.
- La selección se re-resuelve por `data-layer-id` tras cada patch: si la capa
  seleccionada sobrevive, la selección y el overlay sobreviven.
- Durante el gesto: solo `transform: translate3d` sobre la capa arrastrada
  (composited, sin layout); estilos definitivos recién en el commit.

**Presupuestos (medibles, no opinables):**
| Métrica | Presupuesto |
|---|---|
| Drag de una capa en frame de 200 capas | ≥ 55 fps sostenido |
| Commit de 1 capa (mouseup → DOM estable) | < 30 ms |
| Selección (mousedown → overlay visible) | < 50 ms |
| Undo | < 100 ms, selección preservada |
| Capas re-creadas por un commit de 1 capa | exactamente 1 |

### 3.3 Modelo de selección con scope (gesto Figma)
- **Normalizador en la frontera**: `ensureLayerIds(html)` corre UNA vez cuando el
  contenido entra al store (import, replicación, batch, MCP) — todo nodo
  significativo (elementos con geometría propia) recibe `data-layer-id` +
  `data-layer-name` derivado (tag/rol). Se elimina la asignación de ids durante el
  click (S2a desaparece).
- **Hit-testing con scope**:
  - Click → selecciona el ancestro **top-level** (hijo directo del content) del nodo
    bajo el cursor.
  - Doble click → entra un nivel (scope = ese contenedor); los clicks siguientes
    seleccionan hijos directos del scope. Doble click repetido sigue bajando.
  - `Esc` → sube un nivel de scope. Click fuera → scope raíz.
  - `Ctrl/Cmd+click` → selección profunda directa (el nodo exacto bajo el cursor).
- **Hover preview**: outline de 1px de la capa que RECIBIRÍA el click (barato: un div
  en el overlay). El usuario nunca más adivina qué va a seleccionar.
- Solo `data-layer-kind="group"` es un grupo lógico; los contenedores comunes son
  navegables por drill-down, no bloques indivisibles.

---

## 4. Sprints

### Sprint 0 — Detener el sangrado (1-2 días) · SIN re-arquitectura
Cuatro parches quirúrgicos que alivian HOY mientras se construye lo demás:

| # | Parche | Archivo | Resuelve |
|---|---|---|---|
| 0.1 | Echo-suppression de HTML (`lastEmittedHtmlRef`, simétrico al de CSS) — un commit propio NO reconstruye el shadow DOM | `DesignFrame.tsx` efecto `frame.html` | S1 (el 80% del cuelgue) |
| 0.2 | Eliminar asignación de `data-layer-id` + `onHtmlChange` dentro del mousedown; mover a `ensureLayerIds` al cargar el frame | `DesignFrame.tsx:1243`, nuevo helper en `htmlMutations.ts` | S2a |
| 0.3 | Tras cualquier `innerHTML` sync, re-resolver `selectedRef` por `data-layer-id` en vez de anularla | `DesignFrame.tsx:311-324` | "no puedo volver a poner las cosas en su lugar" |
| 0.4 | Coalescing de undo por gesto: debounce 300ms por control en el panel; el drag ya commitea 1 vez | `EditorV2.tsx` (`handleContextualCssChange`) | S3 parcial |
| 0.5 | `#__df_content` con `width/height: 100%` — hoy no tiene altura explícita y en frames vacíos/cortos media área del frame NO recibe clicks (por eso "el cuadro de texto no siempre se genera") | `DesignFrame.tsx` shadow init | Texto/pen/formas en toda el área |

**Aceptación Sprint 0**: mover 10 objetos seguidos en un post replicado del batch sin
ningún congelamiento perceptible; la selección sobrevive a cada movimiento; Ctrl+Z
tras un scrub de font-size deshace el scrub completo.

### Sprint 1 — DocumentStore transaccional (3-5 días)
- Implementar `src/lib/documentStore.ts` + tests unitarios puros (sin DOM).
- Migrar EditorV2: `frames` state pasa a espejo del store (`useSyncExternalStore`);
  los 77 `pushUndo` se reemplazan por transacciones y se eliminan.
- Ctrl+Z/Ctrl+Shift+Z → `store.undo()/redo()` SIEMPRE (capture-phase, preventDefault);
  dentro de una sesión de texto, el undo nativo aplica hasta el blur, y el blur
  commitea la sesión como una transacción.
- Autosave lee del store (single reader).

**Aceptación**: invariante automatizada — para CUALQUIER secuencia de operaciones,
`undo × n` devuelve exactamente al estado inicial y `redo × n` al final (test de
propiedad con secuencias aleatorias de 20 ops, corrido por Opus).

### Sprint 2 — Reconciliador incremental (3-5 días)
- `src/lib/frameReconciler.ts`: diff por capa con hash; patch mínimo; instrumentado
  (cuenta de nodos re-creados por commit, expuesta a `window.futurariaAgent`).
- Presupuestos de la tabla 3.2 medidos en la suite de QA (no a ojo).
- El gesto usa `translate3d` + commit único al soltar.

**Aceptación**: los 5 presupuestos de la tabla en verde sobre un template con 200
capas y 10 imágenes base64, medidos por la suite automatizada.

### Sprint 3 — Selección con scope (2-4 días)
- Normalizador + hit-testing + drill-down + hover preview según 3.3.
- Panel de capas sincronizado: la capa seleccionada se resalta; click en el árbol =
  misma semántica que en canvas.

### Sprint 3.5 — Texto profesional (2-3 días) · ver PLAN_PRODUCTO.md §1
- La herramienta texto crea SIEMPRE (click o drag), aunque haya elementos debajo;
  entra directo en edición con placeholder seleccionado; `Esc` confirma.
- Mini-barra flotante sobre el texto seleccionado: fuente, tamaño, peso, spacing,
  line-height, color — sin viajar al panel lateral. Doble click en cualquier texto = editar.
- Herramientas sobre canvas vacío crean un auto-frame transparente del tamaño del
  elemento (simetría: ya se puede jalar afuera; ahora también crear afuera).

**Aceptación**: sobre un post replicado del batch: (1) click en la imagen selecciona
la CARD top-level y el hover lo anticipó; (2) doble click + click selecciona SOLO la
imagen; (3) moverla no arrastra los textos; (4) Ctrl+Z lo devuelve; (5) Lara ejecuta
el flujo completo desde OpenClaw sin instrucción adicional.

### Sprint 4 — QA multi-agente permanente (paralelo, desde Sprint 0)
- `scripts/editor-qa.md` + suite browser-driven: eventos sintéticos (mousedown/move/up
  con `composed: true` sobre el shadow DOM — el patrón ya está probado en
  `docs/AGENT_BRIDGE.md`) + `window.futurariaAgent.inspectFrame/renderFrame` para
  verificar geometría y píxeles.
- Gate: **nadie pushea a main sin** `npm run test:regression` verde + suite de editor
  verde. Los presupuestos de rendimiento son asserts, no comentarios.

---

## 5. Briefs por agente

### 🧠 Agente IDE (Qoder / GLM5.2) — implementación
Ejecutas los sprints EN ORDEN. Contratos estrictos:
- Sprint 0 primero, PR por parche (4 PRs pequeños, no uno grande).
- `documentStore.ts` y `frameReconciler.ts` son módulos puros: cero imports de React,
  cero acceso directo al DOM en el store (el reconciliador sí toca DOM, el store no).
- No borres los `pushUndo` hasta que la invariante de undo esté verde en CI local.
- Prohibido introducir dependencias nuevas para esto (nada de immer/redux/zustand —
  el store es un archivo de <300 líneas).
- Cada PR incluye sus tests en `QA/` (patrón existente: node --test, ver
  `QA/deck-generator.test.mjs`).

### 🔬 Opus 4.8 (Claude Code) — verificación
- Construyes ANTES que IDE: la suite de interacciones que hoy falla (selección,
  undo, fluidez) como tests rojos → IDE los pone verdes. Reproduce S1-S3 con eventos
  sintéticos (el patrón de dispatch está documentado en `docs/AGENT_BRIDGE.md` y en
  la memoria de este plan).
- Test de propiedad del undo (secuencias aleatorias, invariante de ida y vuelta).
- Mediciones de presupuesto con `performance.now()` alrededor de los gestos
  sintéticos; falla el test si se excede el presupuesto.
- Confirmas cada Sprint contra Claude (tu criterio de "funciona para Claude").

### 🎨 Lara (OpenClaw / DeepSeek v4pro) — aceptación de producto
- Eres la usuaria final agente: después de cada sprint ejecutas el flujo real
  completo en design.futuraria.com — replicar un diseño → seleccionar/mover/corregir
  → undo → batch de 20 → design system con `create_deck`.
- Reportas en un issue por sprint: qué se sintió fluido, qué no, con template ids
  concretos. Tu confirmación "funciona para OpenClaw" cierra el sprint.
- NO tocas el código del editor durante los sprints 1-2 (la zona está en cirugía);
  batch, extractor y decks siguen siendo tuyos.

---

## 6. Protocolo de coordinación

1. **Ramas**: `editor-core/sprint-N-descripcion`; main queda protegido por el gate de QA.
2. **Orden de merge**: tests de Opus (rojos) → implementación de IDE → Opus confirma
   verde → Lara acepta → merge → deploy automático a design.futuraria.com.
3. **Zona en cirugía**: `DesignFrame.tsx`, `EditorV2.tsx` (solo Agente IDE los toca
   durante los sprints 1-3). Todo lo demás (MCP, extractor, batch, decks) sigue libre.
4. **Congelamiento de alcance**: los bugs secundarios conocidos van al backlog (§7),
   no se cuelan en estos sprints.

## 7. Backlog secundario (después del core, no antes)
- Bordes configurables en círculo/formas div (el panel Border no aplica estilo+color por defecto al setear grosor).
- Text-on-path: coordenadas del path fuente en el espacio del nuevo SVG + soporte para formas div (círculos) generando el path.
- Herramientas dentro/fuera de frames (dibujar en canvas vacío → auto-frame).
- Rubber band del pen visible también en modo pen-edit.
- `#__df_content` con altura explícita del frame (los frames vacíos no reciben clicks del pen/texto en toda su área).

---

*Métrica final de éxito (la del jefe): replicar un post, mover 5 elementos, equivocarse,*
*Ctrl+Z tres veces, y terminar con el diseño intacto — sin un solo congelamiento y sin*
*perder nunca la selección. Cuando ese párrafo sea aburrido de ejecutar, cerramos.*
