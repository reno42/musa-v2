# Mapa de la UI del editor (EditorV2)

Inventario completo de cada menú/panel del editor, con su nombre de referencia,
dónde vive en el código, y qué contiene. Nomenclatura acordada:

- **Menú de herramientas** — barra flotante izquierda con las herramientas de dibujo/edición.
- **Menú contextual** — panel flotante derecho; su contenido cambia según qué esté seleccionado.
- **Panel de capas** — árbol de capas (orden en el eje Z) de cada frame.
- **Panel superior** — hay DOS, documentados por separado más abajo:
  - **Barra superior fija** (glassmorphism, negro) — siempre visible.
  - **Barra de operaciones de elemento** (fondo azul-morado oscuro) — solo aparece cuando hay un elemento seleccionado.

Todo lo demás que no encajaba en esos cuatro nombres quedó documentado con
nombre propio en las secciones finales.

---

## 1. Menú de herramientas (`src/components/FloatingToolbar.tsx`)

Barra flotante vertical, acoplable (dockable) al borde izquierdo — ver
`useDockablePanel`. De arriba a abajo:

| Herramienta | Atajo | Qué hace |
|---|---|---|
| Select | `V` | Herramienta de selección por defecto |
| Hand | `H` | Pan (arrastrar el lienzo) |
| Frame | `F` | Click = frame 100×100; arrastrar = tamaño custom |
| **Shapes** (split button + flyout) | `R`/`O`/`G`/`S`/`N` | Rectangle, Circle, Triangle, Star, Polygon (Shift = más lados) |
| **Text** (split button + flyout) | `T`/`⇧T` | Text (bloque de texto), Text on Path (escribir sobre una curva) |
| **Pen** (split button + flyout) | `P`/`+`/`−`/`C`/`B` | Pen (bezier), Pen+ (agregar punto), Pen− (borrar punto), Convert (mostrar handles bezier), Pencil (dibujo a mano alzada) |
| Add Frame (flyout) | — | Presets: IG Square, IG Story, IG Feed, Banner, Twitter |
| Pathfinder (flyout, requiere 2+ seleccionados) | — | Union, Subtract, Intersect, Exclude |
| Import SVG | — | Abre el modal de importación SVG |
| Group / Ungroup | `⌘G` / `⇧⌘G` | Agrupar / desagrupar elementos seleccionados |
| Undo / Redo | `Ctrl+Z` / `Ctrl+⇧Z` | — |
| Toggle Code | `⌘/` | Abre/cierra el Code Panel flotante (frame completo) |
| Toggle Layers | — | Abre/cierra el Panel de capas |
| **Zoom** (split button + flyout) | — | Zoom In, Zoom Out, Fit All; el % es clickeable para escribir un valor exacto |

En mobile/tablet esta barra cambia a `position:fixed` centrada abajo (ver
media query `.editor-v2-floating-toolbar` en `index.css`).

---

## 2. Menú contextual (`src/components/HtmlContextualPanel.tsx` + hermanos)

Panel flotante derecho, acoplable. Tiene **dos niveles de pestañas**:

### 2.1 Nivel superior — qué "página" del panel se ve

Controlado por los íconos del lado derecho de la barra superior fija (ver
sección 4). Cada ícono es una página distinta:

| Página | Componente | Contenido |
|---|---|---|
| **Properties** | `HtmlContextualPanel` | Ver 2.2 — es el panel contextual "clásico", cambia según selección |
| **Structure** | `StructurePanel` | Árbol/resumen estructural del template completo |
| **Variables** | `VariablesPanel` | Variables CSS (`--custom-props`) del template: crear, vincular, editar |
| **Brand** | `BrandPanel` | Extracción y aplicación de sistema de marca (colores, tipografía, tokens) |
| **Format** | `FormatPanel` | Adaptar el diseño actual a otros formatos/tamaños (crea un template nuevo) |
| **History** | `VersionHistoryPanel` | Versiones guardadas (`Guardar versión`), restaurar, comparar |
| **Agents** | `ActiveAgentsPanel` | Agentes/colaboradores conectados en tiempo real a este template |
| **Obsidian** (ícono de grafo, sin texto) | `FileInfoPanel` | Marca, campaña, tags y conexiones de este archivo en el grafo de diseño |

### 2.2 Página "Properties" — sus 3 sub-pestañas

Esta es la página que cambia según **qué está seleccionado** (un elemento
dentro de un frame, o el frame mismo). Tiene sus propias 3 pestañas
(`Properties` / `Code` / `Animation`), recién reorganizadas:

#### Si hay un ELEMENTO seleccionado (texto, vector, imagen, figura, etc.)

**Properties** — solo estas 6 categorías, todas conectadas a CSS real:
- **Position** — 6 botones de alinear (izq/centro-h/der/arriba/abajo/centro-v, alinean contra el frame), X/Y, Rotation (un campo, número sin signo = positivo).
- **Layout** — Width/Height en una fila.
- **Appearance** — Opacity, Corner radius (un campo para las 4 esquinas + 4 campos independientes). En figuras SVG (estrella/polígono/bezier-cerrada) el Radius controla el radio uniforme de vértices (`data-shape-corner-radius`) y el botón "◈ Radio por vértice" despliega un campo por vértice (`data-vr`, posicional).
- **Fill** — si es `<img>`: preview de la imagen + Opacity. Si es figura (herramienta o bezier/SVG): color + fill-opacity. Si es texto/div: color de texto, color/gradiente de fondo, subir imagen, blend mode (mismo comportamiento de siempre).
- **Stroke** — Color + Opacity (una fila), Position (Inside/Center/Outside, simulado con `border` vs `outline`+`outline-offset`) + Weight (otra fila). En SVG usa `stroke` nativo en vez de border/outline.
- **Effects** — botones para agregar: Drop Shadow, Inner Shadow, Layer Blur, Background Blur, Glass, Noise, Texture, Dither. Cada uno muestra sus propios campos al agregarse (shadows: X/Y/Blur/Spread/Color/Opacity, blurs: cantidad, noise/texture/dither: intensidad).

**Canvas sobre figuras (F4, flecha de selección):**
- **Hover sobre figura seleccionada** → círculos ámbar en cada vértice; hover en un círculo muestra su radio; arrastrar horizontalmente un círculo redondea TODA la figura en vivo (izquierda = redondea, derecha = afila) y el panel refleja el valor en tiempo real (`musa:shape-radius-live`).
- **Doble-click sobre figura/path** → modo vértices editables: anclas arrastrables con guías inteligentes (snap al X/Y de otros vértices, líneas punteadas ámbar), circulitos punteados en el punto medio de cada segmento para insertar vértices nuevos. Esc o click fuera para salir. Tras editar vértices la figura queda marcada `data-shape-custom="1"` — solo el radio se puede cambiar paramétricamente (count/ratio se ignoran para no borrar las ediciones).
- Radios por vértice y geometría viven en `src/lib/shapePaths.ts` (`verticesToPath` acepta `number | number[]`; `cornersFromShapePath` recupera vértices de un path ya redondeado).

**Code** — todo lo relacionado a estructura/markup de ESTE elemento:
- Selector de tag semántico (`<div>`→`<section>` etc.)
- Copy style / Paste style / Convert to Path
- Tipo de grupo (Grupo de posiciones fijas ⇄ Contenedor con auto-layout)
- HTML y CSS de solo este elemento (extraídos del frame), con botón Copy
- Custom CSS (textarea libre + botón Apply)

**Animation** — todo lo que no encajó en Properties ni es "código": Typography
(fuente, tamaño, peso, alineación, spacing, line-height, decoration, case),
Shape (puntos/lados/ratio de estrellas y polígonos), Stroke Detail (linecap/
linejoin/dash + outline/offset de paths SVG), Spacing (margin/padding por
lado), Border (style/color — el radius vive en Properties), Blend mode,
Flex/Grid (display, gap, dirección, justify/align, wrap, grow/shrink/basis,
grid columns/rows, overflow), Position Detail (type, right/bottom, z-index),
Transform Detail (scale/skew/origin — la rotación vive en Properties),
Transition (property/duration/easing/delay), States (`:hover`/`:active`/
`:focus`).

#### Si hay un FRAME seleccionado (sin elemento)

- **Properties** — nombre del frame, Dimensions (W×H), Background (color,
  hex, transparente, subir imagen, swatches rápidos), Position (x,y, solo lectura).
- **Code** — el `CodePanel` completo (Monaco, editable) con el HTML y CSS
  de **todo el diseño** dentro de ese frame.
- **Animation** — placeholder ("Sin herramientas de animación todavía").

Si no hay nada seleccionado: mensaje "Select a frame or element to edit its
properties" (sin pestañas).

---

## 3. Panel de capas (`src/components/HtmlLayersPanel.tsx`)

Panel flotante izquierdo (acoplable, se abre con el ícono de capas del menú
de herramientas). Muestra un árbol por frame:

- Cada frame es un nodo raíz; sus capas hijas se listan en orden de apilado (Z).
- **Click** selecciona la capa; **Shift+click** selección múltiple.
- **Arrastrar** una capa la reordena (dentro del mismo frame o a otro frame).
- Por fila: ícono de **Lock** (bloquear edición), ícono de **Hide** (ocultar
  del lienzo), botón **⋯ More actions** que abre un menú con: Duplicate,
  Delete, Bring Forward, Send Backward, Group (si hay 2+ seleccionadas),
  Ungroup (si aplica).
- Soporta capas "orphan" (objetos sueltos fuera de cualquier frame).

---

## 4. Barra superior fija (`.editor-v2-topbar`, glassmorphism negro)

Siempre visible arriba de todo, `position` normal (no flota sobre el
lienzo). De izquierda a derecha:

**Identidad / estado:**
- Back to Dashboard, menú hamburguesa (mobile)
- Nombre del workspace (doble-click para renombrar)
- Nombre + medidas del frame activo (doble-click para renombrar)
- Indicador "Saving...", indicador de agentes activos conectados

**Guardar y navegar el panel contextual:**
- **Guardar versión** (`Ctrl/⌘+S`) — snapshot permanente en el historial
- Los 8 íconos que abren cada página del Menú contextual (sección 2.1)

**Estilo y marca:**
- **Style Library** — abre el modal de biblioteca de estilos
- **Publicar** — extrae y guarda este diseño como estilo reutilizable, conservándolo como referencia fuente
- **Fonts** — abre el selector de Google Fonts

**Exportar / importar:**
- **Capture Thumbnail** — guarda una preview para el dashboard
- **ExportPanel** — dropdown de formato (PNG/JPG/SVG/PDF) + alcance (frame
  actual / todos) + botón **Exportar**
- **Export as JSON**
- **Importar** — diseños desde SVG/PSD/AI/FIG
- **Save as Key Visual (Recipe)** — guarda como receta reutilizable
- **Upload Images**

**Frame:**
- Duplicate frame (`Ctrl+D`), Delete frame (`Del`)

**Sistema de diseño:**
- **DS** — Extract Design System (descarga DESIGN.md, tokens.json, shared.css)

**Insertar / crear contenido:**
- Toggle **Insert Elements Bar** (ver sección 6)
- Import HTML/CSS into Frame (desde archivo `.html`)
- Paste HTML & CSS into Frame (modal para pegar código)
- **Convert Image to Design (AI Vision)** — botón 🪄
- **Icons (Phosphor)** — picker de íconos

**Template / calidad:**
- Import Template JSON
- **Lint Design** — revisa problemas de diseño
- **Enhance** — mejoras sugeridas por IA
- Export Design Tokens as JSON
- Extract CSS variables from template
- Apply variables (reemplaza valores hardcodeados por variables CSS)

**Generación masiva:**
- **Batch-a-mator (B)** — genera diseños desde un CSV

**Guías del lienzo:**
- Toggle Rulers (`Ctrl+R`), Toggle Pixel Grid (`Ctrl+'`)
- **Column Guides (C)** — abre un popup flotante propio (checkbox
  enable + sliders de columnas/gutter/margin) sobre el frame seleccionado
- Clear all guides (solo visible si hay guías creadas)

---

## 5. Barra de operaciones de elemento (`.editor-v2-elem-ops`, fondo azul-morado)

Esta es la barra que preguntabas — **NO** es parte de la barra superior fija:
aparece pegada justo debajo de ella, dentro del área del lienzo, **solo
cuando hay un elemento seleccionado** (`{selectedElement && (...)}`).
Fondo `rgba(12,12,36,0.8)` con blur — por eso se ve azul-morado oscuro.
Contiene:

- Align Left / Center / Right (alinea contra la selección múltiple, vía MCP `align_elements` — distinto del alineado del Menú contextual, que alinea contra el frame)
- Reorder: Bring Forward (↑), Send Backward (↓), Bring to Front (⤒), Send to Back (⤓)
- **Group** (requiere 2+ seleccionados)
- Copy as **HTML** / **CSS** / **JSON**
- Toggle **Smart / Fixed** layout (auto-layout vs posiciones fijas)

---

## 6. Barra de inserción (`.editor-v2-insert-bar`, `src/components/InsertToolbar.tsx`)

Barra horizontal **toggleable** (ícono `+` en la barra superior fija),
aparece debajo de ella cuando está activa. Botones de inserción rápida vía
MCP (`add_element`):
- **+ SVG** (si hay import SVG disponible)
- Elementos: + Div, + H1, + H2, + P, + Btn, + Img, + Span
- Figuras: Rect, Circle (con estilos pre-armados)
- Layout: Flex Row, Flex Col, Grid 2 (agrega la regla CSS al elemento)
- Align: Left, Center, Right (agrega `text-align`)

---

## 7. Otros paneles y modales (sin nombre previo — documentados aquí)

| Nombre propuesto | Disparador | Qué es |
|---|---|---|
| **Popup de Column Guides** | Ícono de columnas en la barra superior | Config de columnas de layout (count/gutter/margin) sobre el frame activo |
| **Style Library** (modal) | Botón "Library" en la barra superior | CRUD de estilos guardados y reutilizables, siempre vinculados a una plantilla fuente válida |
| **Selector de Google Fonts** (dropdown) | Botón "Fonts" en la barra superior, y también el campo "Font" dentro de Typography | Busca/aplica fuentes de Google Fonts |
| **Icon Picker (Phosphor)** (modal) | Ícono de formas en la barra superior | Buscar e insertar íconos del set Phosphor |
| **Batch-a-mator** (modal) | Botón "B" en la barra superior | Genera múltiples diseños desde un CSV |
| **Design Import** (modal) | Botón "Importar" en la barra superior | Importar SVG/PSD/AI/FIG como diseño editable |
| **Image to Design** (modal) | Botón 🪄 en la barra superior | Convierte una imagen/screenshot en un diseño editable vía IA |
| **Paste HTML Modal** | Botón de "pegar código" en la barra superior | Pegar HTML/CSS crudo directo al frame |
| **SVG Import Modal** | Botón de import SVG (menú de herramientas o barra de inserción) | Importar un archivo SVG o pegar su código |
| **Image Upload** (modal) | Botón "Upload Images" en la barra superior | Sube imágenes a la librería de assets del workspace |
| **Chat FAB** (`ChatFAB.tsx`) | Círculo morado flotante, esquina inferior derecha | Abre el chat con el agente/IA de este template |
| **Botón de ayuda / reporte de bugs** (`BugReportButton.tsx`) | Círculo "?" flotante, esquina inferior derecha, junto al chat | Ayuda y reporte de errores |

### 7.1 CRUD de Style Library

- **Crear/capturar:** el humano elige una o más referencias del workspace. La
  extracción, creación del estilo y asociación con `sourceTemplateIds` son una
  sola operación: si algo falla, no aparece una tarjeta con `0 templates`.
- **Importar:** JSON/CSS/MD también exige elegir una plantilla de referencia.
  Un archivo de tokens por sí solo no autoriza un estilo huérfano.
- **Leer:** cada tarjeta muestra nombre, lock, fuentes resolubles y cantidad de
  templates válidos. Un ID inexistente no cuenta; un estilo inválido no se
  ofrece al agente como utilizable.
- **Editar/renombrar:** el CRUD directo se actualiza por ID y no puede quitar la
  última fuente. Una recaptura por Publicar puede actualizar el registro canónico
  cuando el humano escribió o confirmó su mismo nombre normalizado exacto.
- **Eliminar:** requiere confirmación y limpia lock y asociaciones. Si se borra
  la última plantilla fuente, el estilo se elimina en la misma operación.

Los nombres son únicos por workspace después de `trim`, colapsar espacios
repetidos y pasar a minúsculas. `create_brand_guideline` directo o renombrar hacia
un nombre ocupado muestra conflicto; nunca crea una segunda tarjeta. Publicar con
el mismo nombre normalizado exacto es una recaptura y actualiza la tarjeta
canónica. Coincidencias por prefijo/fuzzy y fingerprints son sugerencias que
requieren confirmación y jamás producen una selección o merge silencioso. Si el
estilo pedido no existe o está inválido, el agente queda bloqueado: no usa estilo
libre ni genera una salida blanca.

---

## 8. Viewport del canvas — gestos de trackpad y control por IA

**Gestos nativos (trackpad/touch) en `src/components/InfiniteHtmlCanvas.tsx`:**

- **Pellizcar (pinch) = zoom anclado al cursor.** El navegador reporta el
  pinch del trackpad como `wheel` con `ctrlKey: true`; factor
  `0.999 ** deltaY` y el pan se recalcula para que el punto bajo los dedos
  no se mueva (`newPan = cursor − (cursor − oldPan) · newZoom/oldZoom`).
- **Scroll de dos dedos = pan 1:1**, como la tool mano pero sin cambiarla:
  `wheel` con `deltaX/deltaY` (sin ctrl) aplica `setPan` por delta.
- **Tool-agnóstico por diseño:** ambos gestos se interceptan en el viewport
  y nunca tocan `activeTool` — con la bezier, el rect o el eraser activos,
  los gestos funcionan igual y la tool no cambia.
- **Fluidez:** los eventos `wheel` llegan más rápido que los frames; se
  acumulan en targets locales del gesto y un `requestAnimationFrame` los
  commitea uno por frame. El handler lee refs (`zoomRef`/`panRef`), no el
  closure, y se suscribe una sola vez (ya no en cada cambio de zoom).
- El listener es **no-passive** a propósito: `preventDefault()` es lo que
  evita el zoom de página del navegador durante el pinch.
- Touch (pantallas táctiles): 1 dedo panea, 2 dedos pinch-zoom — mismos
  efectos, distinto camino de eventos.

**Paridad IA (ChatFAB → el mismo viewport):**

| Tool local | Acción | Puente |
|---|---|---|
| `editor_zoom` (in / out / fit / set) | zoom como el pinch o los botones | `CustomEvent("futuraria:editor-viewport")` → EditorV2 (`handleZoomIn/Out/Set/ToFit`) |
| `editor_pan` (dx, dy en px) | pan como el scroll de dos dedos | mismo evento → InfiniteHtmlCanvas (`setPan`) |

Estas dos tools son **locales a la sesión**: viven en `ChatFAB.tsx`
(`runEditorViewportTool`), se ejecutan en el navegador y NUNCA llegan al MCP
server — el canvas vivo de un tab no existe para la nube. Por eso no hay tool
de viewport en `MCP_TOOLS`: un agente externo "ve" el diseño vía
`get_template_structure` / `render_batch` / `export_frame`, y el agente
in-app mueve el viewport con `editor_zoom`/`editor_pan` exactamente como los
dedos del humano.

---

### Notas para seguir iterando la UI

- La distinción real entre la "Barra de operaciones de elemento" (sección 5)
  y el Menú contextual → Properties → Position (sección 2.2) es que la
  primera opera sobre **selección múltiple relativa** (alinear unos contra
  otros, vía MCP) y la segunda sobre **un elemento contra su frame** (vía
  CSS directo). Hoy conviven con dos mecanismos de alineado distintos — vale
  la pena decidir si eso se unifica o se deja así a propósito.
- El menú contextual tiene **8 páginas de nivel superior** (2.1) pero solo
  la de "Properties" tiene sub-pestañas (2.2) — las otras 7 son de una sola
  vista. Si la idea es que todas se sientan consistentes, ahí hay una
  decisión de diseño pendiente.
- Hay dos lugares distintos donde se puede insertar contenido (Insert Bar,
  sección 6, y varios botones sueltos en la barra superior como Import
  HTML/Paste HTML/Image to Design) — podrían consolidarse en un solo punto
  de entrada "Insertar" con sub-opciones.
