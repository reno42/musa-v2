# 🎨 Figma — Documentación de Funcionalidades

> **Propósito:** Referencia canónica de capacidades de Figma para guiar el desarrollo de Mini-Figma.
> **Fecha:** 7 Junio 2026
> **Fuente:** Conocimiento experto (no web research).

---

## 🖼️ CANVAS

#### Figma: Infinite Canvas
**Cat:** CANVAS | **MCP tool:** `canvas_pan` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Lienzo infinito en X/Y sin bordes. El viewport se reposiciona libremente; los objetos pueden existir en coordenadas negativas. Toda el área es navegable.

#### Figma: Zoom
**Cat:** CANVAS | **MCP tool:** `canvas_zoom` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Zoom continuo desde ~1% hasta ~25600%. Scroll de rueda (eje Y) o Ctrl+Scroll para zoom centrado en cursor. Pinch-to-zoom en trackpad. Atajos: Ctrl+0 (fit), Ctrl+1 (100%), Ctrl+2 (fit selection), Shift+0 (zoom to fit), N (zoom to next frame).

#### Figma: Pan / Hand Tool
**Cat:** CANVAS | **MCP tool:** `canvas_hand` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Space+drag para navegar el canvas sin seleccionar objetos. También activable con la herramienta Hand (H). En trackpad, drag con 2 dedos. Mantiene la posición del viewport al cambiar de página.

#### Figma: Grid (Layout & Pixel Grid)
**Cat:** CANVAS | **MCP tool:** `canvas_grid` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Grids configurables por frame: Layout Grid (columnas/filas con gutter, margin, count/stretch) y Pixel Grid (alineación sub-píxel). Múltiples grids por frame. Visibilidad toggleable desde el panel de propiedades y con Ctrl+G.

#### Figma: Rulers (Reglas)
**Cat:** CANVAS | **MCP tool:** `canvas_rulers` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Reglas horizontales y verticales en bordes del viewport. Atajo Shift+R para toggle. Muestran coordenadas del cursor y guías en tiempo real. Origen ajustable drag desde esquina superior-izquierda de las reglas.

#### Figma: Guides (Guías)
**Cat:** CANVAS | **MCP tool:** `canvas_guides` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Guías arrastrables desde las reglas (click+drag horizontal o vertical). Snap a objetos, centros y bordes. Se pueden bloquear, borrar (drag fuera del viewport) o eliminar todas (Ctrl+Shift+G). Visibles solo en la página actual.

#### Figma: Snap & Align (Magnetismo)
**Cat:** CANVAS | **MCP tool:** `canvas_snap` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Snap a grid, objetos, bounding boxes, centros, guías y pixels. Medidas rojas dinámicas entre objetos al mover (alt+hold para ver distancias). Toggle rápido con Shift+Ctrl+'. Sensibilidad y tipos de snap configurables en preferences.

#### Figma: Multi-page (Páginas)
**Cat:** CANVAS | **MCP tool:** `canvas_pages` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Panel de páginas en el sidebar izquierdo. Cada página es un canvas independiente. Sin límite de páginas. Se pueden reordenar, renombrar, duplicar, borrar. Atajo: PageUp/PageDown para navegar entre páginas.

#### Figma: Dark Mode
**Cat:** CANVAS | **MCP tool:** `canvas_dark_mode` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Tema oscuro para la UI (no el canvas). El canvas de diseño es siempre el que define el usuario (típicamente blanco #FFFFFF). Toggle en Preferences o sigue el sistema (OS-level). No afecta exports.

#### Figma: Undo / Redo
**Cat:** CANVAS | **MCP tool:** `canvas_undo_redo` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Historial completo de acciones por página. Ctrl+Z (undo), Ctrl+Shift+Z (redo). Stack ilimitado durante la sesión. No sobrevive al refresh. Disponible desde toolbar y menú Edit.

#### Figma: Color Space / Background
**Cat:** CANVAS | **MCP tool:** `canvas_background` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Color de fondo del canvas por página. Clic en el espacio vacío del panel de capas o File > Page background. Acepta hex, RGB, HSL. No es un objeto — es propiedad de la página. Visible en exports de frames que no cubren todo.

#### Figma: Pixel Preview
**Cat:** CANVAS | **MCP tool:** `canvas_pixel_preview` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Ctrl+Alt+Y o View > Pixel Preview. Muestra el diseño rasterizado a 1x/2x para ver cómo se verá en pantalla real. Crítico para evaluar anti-aliasing de vectores y nitidez de bordes.

#### Figma: Nudge (Desplazar con teclas)
**Cat:** CANVAS | **MCP tool:** `canvas_nudge` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Arrow keys mueven selección 1px. Shift+Arrow = 10px (big nudge). Configurable en Preferences > Nudge amount. Funciona también para kerning y line-height en texto seleccionado.

#### Figma: Multi-viewport / Multiplayer Cursors
**Cat:** CANVAS | **MCP tool:** `canvas_multiplayer` | **Complejidad:** Alta | **Free tier:** Sí
**Descripción:** Colaboradores ven sus propios cursores con nombre y color asignado. El viewport de cada usuario es independiente (cada quien ve su propio zoom/posición). Observar (spectate) a otro usuario: clic en su avatar.

#### Figma: Copy / Paste / Duplicate
**Cat:** CANVAS | **MCP tool:** `canvas_clipboard` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Ctrl+C/V estándar. Ctrl+D duplica selección in-place con offset. Ctrl+X recorta. Copy as PNG/SVG desde menú contextual. Paste to replace (Ctrl+Shift+R) reemplaza un objeto manteniendo propiedades. Paste over selection (Ctrl+Shift+V) pega centrado. Cross-file y cross-page copy/paste soportado. Copy properties (Ctrl+Alt+C) / Paste properties (Ctrl+Alt+V).

---

## 🔧 HERRAMIENTAS

#### Figma: Move Tool (V)
**Cat:** HERRAMIENTAS | **MCP tool:** `tool_move` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Selección, movimiento y transformación. Modos: clic para seleccionar, drag para mover, arrastrar handles de bounding box para resize (esquinas=proporcional, Shift para mantener ratio, Alt para desde el centro). Doble clic en grupo entra en isolation mode. Método más usado para todo.

#### Figma: Scale Tool (K)
**Cat:** HERRAMIENTAS | **MCP tool:** `tool_scale` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Escala proporcional de objetos incluyendo stroke width, corner radius y efectos. A diferencia del Move Tool (que solo escala el bounding box), Scale transforma todas las propiedades del objeto. Shift para mantener proporción. Útil para iconos y elementos que deben escalar fielmente.

#### Figma: Frame Tool (F)
**Cat:** HERRAMIENTAS | **MCP tool:** `tool_frame` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Contenedor principal de diseño. Modos: clic+drag para crear frame a medida, clic en presets del panel derecho (iPhone, Desktop, Tablet, Paper sizes, Social media, etc.). Frames anidables. Clipping automático del contenido que excede. Pueden tener layout grids, auto-layout, constraints y color de fondo propios.

#### Figma: Slice Tool (S)
**Cat:** HERRAMIENTAS | **MCP tool:** `tool_slice` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Define regiones de exportación sin afectar el diseño visual. Clic+drag para crear área rectangular. En el panel Export se configura escala, sufijo y formato (PNG, JPG, SVG, PDF). Puede abarcar múltiples objetos. Ideal para exportar icon sprites y assets.

#### Figma: Rectangle Tool (R)
**Cat:** HERRAMIENTAS | **MCP tool:** `tool_rectangle` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Rectángulo vectorial. Modos: clic+drag para definir tamaño, clic simple para 100×100 default, Shift+drag para cuadrado, Alt+drag desde centro, Alt+Shift para cuadrado desde centro. Post-creación: corner radius independiente por esquina, propiedades de fill/stroke/effects completas.

#### Figma: Ellipse Tool (O)
**Cat:** HERRAMIENTAS | **MCP tool:** `tool_ellipse` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Círculo/elipse vectorial. Shift+drag para círculo perfecto, Alt+drag desde centro. Post-creación: Arc (ángulo de sweep), Ratio (relación inner/outer radius para donut), Start/End angle para crear arcos y formas parciales. Útil para rings de progreso, medidores, pie charts.

#### Figma: Polygon Tool
**Cat:** HERRAMIENTAS | **MCP tool:** `tool_polygon` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Polígono regular con N lados. Post-creación: control de número de lados (3=trianǵulo, 4=rombo, 5=pentágono, 6=hexágono, etc.), corner radius global y radius interno. Shift bloquea rotación a múltiplos de 15°. Alt+drag desde centro.

#### Figma: Star Tool
**Cat:** HERRAMIENTAS | **MCP tool:** `tool_star` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Estrella vectorial. Post-creación: Count (número de puntas), Ratio (profundidad de puntas: 0%=polígono regular, 100%=punta máxima). Corner radius para suavizar puntas. Shift mantiene orientación recta.

#### Figma: Line Tool (L)
**Cat:** HERRAMIENTAS | **MCP tool:** `tool_line` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Línea recta vectorial. Shift fuerza ángulos en múltiplos de 15° (0°, 45°, 90°, etc.). Se comporta como un path de 2 puntos. Puede tener stroke, dash, cap (flat/round/square) y arrowheads en ambos extremos (línea→flecha directa).

#### Figma: Arrow Tool
**Cat:** HERRAMIENTAS | **MCP tool:** `tool_arrow` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Igual que Line pero con arrowhead predefinido en un extremo. Post-creación: toggle de cap/arrow en ambos extremos. Misma flexibilidad de stroke que Line tool. Integra con prototype connections (líneas de flujo entre frames con dirección visual).

#### Figma: Pen Tool (P)
**Cat:** HERRAMIENTAS | **MCP tool:** `tool_pen` | **Complejidad:** Alta | **Free tier:** Sí
**Descripción:** Dibujo vectorial con curvas Bézier. Modos: clic para punto recto, clic+drag para punto con handles de curva (simétricos por defecto), Shift para constrain del handle a ángulos fijos. Post-edición: doble clic en path para editar puntos, Alt para romper simetría de handles (mirror off), Delete para remover punto manteniendo path cerrado. Bend tool (Ctrl+drag segmento) para curvar path entre puntos existentes. Paint bucket (B) en modo vector para rellenar áreas definidas por paths.

#### Figma: Pencil Tool (Shift+P)
**Cat:** HERRAMIENTAS | **MCP tool:** `tool_pencil` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Dibujo libre a mano alzada. Drag continuo produce path con puntos generados automáticamente. Smoothing automático. Post-creación se convierte a path editable con Pen tool. Ideal para ilustraciones orgánicas y formas irregulares.

#### Figma: Text Tool (T)
**Cat:** HERRAMIENTAS | **MCP tool:** `tool_text` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Texto en dos modos: clic simple = texto de ancho automático (point text, crece con el contenido), clic+drag = texto de ancho fijo (area text, hace wrap). Edición inline con doble clic. Selección parcial dentro del texto para aplicar estilos a fragmentos específicos. Lista de bullets y numerada. Emoji y ligaduras soportadas.

#### Figma: Hand Tool (H)
**Cat:** HERRAMIENTAS | **MCP tool:** `tool_hand` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Navegación del canvas por arrastre. Equivalente funcional a mantener Space presionado con cualquier otra herramienta activa. Drag mueve el viewport. Menos usado que el atajo Space (más rápido), pero preferido por usuarios de stylus/tablet.

#### Figma: Comment Tool (C)
**Cat:** HERRAMIENTAS | **MCP tool:** `tool_comment` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Añadir comentarios en coordenadas específicas del canvas. Clic en el lienzo crea un pin. Abre hilo de discusión con @menciones, emoji reactions. Los pines son visibles para todos los colaboradores. Resueltos se ocultan. Export: no aparecen en los exports de diseño.

---

## 📐 CAPAS

#### Figma: Layer Hierarchy (Jerarquía)
**Cat:** CAPAS | **MCP tool:** `layers_hierarchy` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Árbol de capas en panel lateral izquierdo. Orden bottom-up (la primera capa visible está al fondo del diseño). Drag & drop para reordenar. Estructura: Page > Top-level layers > Frames > Groups > Shapes/Vectors/Text > Children. Anidamiento ilimitado. Indentación visual de niveles.

#### Figma: Groups (Agrupar)
**Cat:** CAPAS | **MCP tool:** `layers_group` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Ctrl+G agrupa selección. Ctrl+Shift+G desagrupa. Los grupos son contenedores sin propiedades visuales propias (a diferencia de Frames). Heredan clip content=false. Útiles para organización temporal. Diferencia con Frame: un grupo no puede tener auto-layout, layout grid, constraints ni background.

#### Figma: Lock / Unlock
**Cat:** CAPAS | **MCP tool:** `layers_lock` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Ctrl+L bloquea la capa seleccionada. Ícono de candado en el panel de capas. Capa bloqueada no es seleccionable, movible ni editable en canvas. Sí es seleccionable desde el panel de capas. Lock heredado: bloquear un padre también impide mover hijos (aunque estén unlocked).

#### Figma: Visibility (Toggle)
**Cat:** CAPAS | **MCP tool:** `layers_visibility` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Ícono de ojo en cada capa del panel. Ctrl+Shift+H para toggle visibilidad de selección. Capas ocultas no se exportan, no son clickeables en prototype, no aparecen en rasterized exports. Múltiples capas pueden togglear su visibilidad simultáneamente con selección múltiple.

#### Figma: Multi-Select (Selección Múltiple)
**Cat:** CAPAS | **MCP tool:** `layers_multiselect` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Shift+click en canvas añade/quita de la selección. Drag-select (arrastrar en espacio vacío) selecciona todo dentro del bounding box. Selección desde panel de capas con Shift+click para rango, Ctrl+click para toggle individual. Selection colors (azul primario) y bounding box único para la selección múltiple.

#### Figma: Boolean Operations (Operaciones Booleanas)
**Cat:** CAPAS | **MCP tool:** `layers_boolean` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Cuatro operaciones con 2+ shapes: Union (suma, une formas), Subtract (resta, el shape de arriba recorta al de abajo), Intersect (intersección, solo área compartida), Exclude (diferencia simétrica, XOR visual). Resultado es un Boolean Group editable: los shapes originales se mantienen individualmente editables. Ícono en toolbar y atajo desde menú contextual.

#### Figma: Flatten
**Cat:** CAPAS | **MCP tool:** `layers_flatten` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Ctrl+E colapsa la selección a un solo vector/image. Destructivo — aplana boolean groups, grupos, vectores con múltiples fills/strokes. Similar a "merge selected" de Illustrator. Útil para simplificar paths complejos antes de exportar o para reducir complejidad.

#### Figma: Outline Stroke
**Cat:** CAPAS | **MCP tool:** `layers_outline_stroke` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Ctrl+Shift+O convierte el stroke de un objeto en un path rellenable. Destructivo — el stroke original desaparece y se crea un vector cerrado. Útil para expandir bordes antes de boolean ops, o para exportar iconos donde el stroke debe ser path sólido.

#### Figma: Rename Layers
**Cat:** CAPAS | **MCP tool:** `layers_rename` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Doble clic en nombre de capa en el panel layers. Ctrl+R para rename rápido de la selección. Soporta rename masivo: seleccionar múltiples capas y Ctrl+R las renombra secuencialmente (ej: "Icon/ → Icon 1, Icon 2, Icon 3"). Convención común: usar / para agrupar en sidebar (ej: "Button/Default", "Button/Hover").

#### Figma: Search Layers
**Cat:** CAPAS | **MCP tool:** `layers_search` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Barra de búsqueda en el panel de capas. Filtra en tiempo real por nombre. Match parcial sin case-sensitivity. En archivos grandes con cientos de capas, es la forma más rápida de encontrar un objeto específico. No busca por tipo de objeto ni propiedad (solo por nombre).

#### Figma: Send to Front / Back (Ordenamiento)
**Cat:** CAPAS | **MCP tool:** `layers_order` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Atajos: Ctrl+] (bring forward), Ctrl+[ (send backward), Ctrl+Shift+] (bring to front), Ctrl+Shift+[ (send to back). También desde menú contextual y toolbar. Opera dentro del mismo nivel de jerarquía. Multiselección aplica a todo el grupo seleccionado.

#### Figma: Frame Nesting (Anidamiento de Frames)
**Cat:** CAPAS | **MCP tool:** `layers_frame_nesting` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Frames pueden contener otros frames, creando jerarquías profundas. Componentes usan esto para variantes. Auto-layout anidado permite layouts complejos (ej: card con header layout + body layout). Cada sub-frame tiene su propio sistema de constraints relativo al padre. El clipping del frame padre oculta contenido que se desborda (excepto prototype overflow).

#### Figma: Isolation Mode
**Cat:** CAPAS | **MCP tool:** `layers_isolation` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Doble clic en un grupo/frame entra en modo aislamiento: solo se ve y se edita el contenido de ese contenedor. Breadcrumb en la parte superior del canvas para navegar entre niveles (ej: "Page > Frame > Group"). Escape sale del isolation. Equivalente a isolation mode de Illustrator/Sketch.

#### Figma: Component Instance Detection
**Cat:** CAPAS | **MCP tool:** `layers_instance` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Las instancias de componentes se marcan con ícono diamante hueco (◇) vs componente maestro (◆). Las instancias no pueden editar su estructura, pero pueden override de texto, color, visibilidad de sub-capas y swap de instancia. "Go to main component" (Ctrl+Shift+Alt+K) navega al componente maestro. "Detach instance" (Ctrl+Alt+B) rompe el vínculo.

---

## 🎨 PROPIEDADES DE OBJETO

### 📏 Position & Size

#### Figma: Alignment (Alineación)
**Cat:** PROPIEDADES | **MCP tool:** `prop_align` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** 6 opciones en el panel de propiedades: Align Left, Align Horizontal Centers, Align Right, Align Top, Align Vertical Centers, Align Bottom. Atajos: Alt+A+L/C/R/T/M/B. Con multi-selección, alinea relativo al bounding box del grupo seleccionado.

#### Figma: Distribution (Distribución)
**Cat:** PROPIEDADES | **MCP tool:** `prop_distribute` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Distribuye objetos uniformemente: Distribute Horizontal Spacing (equidistancia en X), Distribute Vertical Spacing (equidistancia en Y). Con 3+ objetos seleccionados. Tidy Up (Ctrl+Alt+Shift+T) ordena en grid con spacing inteligente. Aparece en el panel de propiedades cuando hay multi-selección.

#### Figma: Position (X, Y)
**Cat:** PROPIEDADES | **MCP tool:** `prop_position` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Coordenadas X e Y en el panel de propiedades. Relativo al padre (frame/grupo contenedor) o al canvas si es top-level. Acepta valores decimales (sub-pixel). Aritmética en el input: escribir "100+50" suma, "100*2" multiplica. Arrastrar en el label para scrub numérico.

#### Figma: Size (W, H)
**Cat:** PROPIEDADES | **MCP tool:** `prop_size` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Width y Height en panel de propiedades. Acepta aritmética inline. Constraint de aspecto (link entre W y H) con ícono de cadena. Presets de tamaño para objetos comunes (ej: icono 24×24). Clamp to 0.01 mínimo. Auto-width y auto-height disponibles con auto-layout.

#### Figma: Rotation
**Cat:** PROPIEDADES | **MCP tool:** `prop_rotation` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Ángulo en grados (0-360). Input numérico en panel de propiedades. Drag directo en canvas: hold Ctrl para pivote libre, o usar handle de rotación fuera del bounding box. Shift lo snap a múltiplos de 15°. El centro de rotación es configurable desde el canvas (pivote visual, no numérico). Flip horizontal/vertical (Shift+H, Shift+V) combinan con rotación.

#### Figma: Constraints (Restricciones de Layout)
**Cat:** PROPIEDADES | **MCP tool:** `prop_constraints` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Define cómo responde un objeto al resize de su frame padre. Ejes independientes: horizontal (Left, Right, Left & Right, Center, Scale) × vertical (Top, Bottom, Top & Bottom, Center, Scale). Left+Top = fijo a esquina. Left & Right = stretch horizontal. Scale = escala proporcional. Center = mantiene posición relativa al centro. El ícono en panel de propiedades muestra la configuración visualmente.

#### Figma: Auto-Layout
**Cat:** PROPIEDADES | **MCP tool:** `prop_autolayout` | **Complejidad:** Alta | **Free tier:** Sí
**Descripción:** Shift+A aplica auto-layout a un frame o selección. Dirección: horizontal o vertical. Gap entre items. Padding independiente por lado (top, right, bottom, left) o uniforme. Alignment de hijos: inicio/centro/fin. Distribución: packed (default) o space-between. Resize: hug contents o fill container por eje. Wrap (nuevo) para múltiples filas/columnas. Canvas controls inline para editar sin panel: handles de padding y gap directamente en el diseño.

### 🖌️ Appearance (Apariencia)

#### Figma: Opacity
**Cat:** PROPIEDADES | **MCP tool:** `prop_opacity` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Transparencia global del objeto (0-100%). Afecta fills, strokes y efectos combinados. Independiente de la opacidad de cada fill individual (que se configura por capa de fill). Aritmética en input. Scrub numérico en el label. En auto-layout, la opacidad del frame afecta a todos los hijos.

#### Figma: Blend Modes (Modos de Fusión)
**Cat:** PROPIEDADES | **MCP tool:** `prop_blend` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** 16 modos por capa de fill/stroke: Normal, Darken, Multiply, Color Burn, Lighten, Screen, Color Dodge, Overlay, Soft Light, Hard Light, Difference, Exclusion, Hue, Saturation, Color, Luminosity. Passthrough exclusivo para frames (hereda blend de los hijos). Aplicable por capa de relleno, no por objeto. Útil para overlays y efectos de color.

#### Figma: Fill — Solid
**Cat:** PROPIEDADES | **MCP tool:** `prop_fill_solid` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Color sólido con picker HEX/RGB/HSL/HSB. Eyedropper tool (I o Ctrl+C desde otro objeto para robar color). Guardar como Style (estilo reutilizable entre archivos). Opacidad independiente del objeto. Cada capa de fill tiene su propio blend mode. Múltiples fills por objeto, apilados bottom-up. Visibilidad toggleable por fill individual.

#### Figma: Fill — Gradient Linear
**Cat:** PROPIEDADES | **MCP tool:** `prop_fill_gradient_linear` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Degradado en línea recta entre 2+ color stops. Ajuste de ángulo en canvas (handle en el objeto) o numérico. Color stops configurables: clic para añadir stop en la barra, drag para mover, Delete para remover. Opacidad por stop individual. Blend modes por stop. Se puede guardar como Style.

#### Figma: Fill — Gradient Radial
**Cat:** PROPIEDADES | **MCP tool:** `prop_fill_gradient_radial` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Degradado circular desde un centro. Ajuste visual en canvas con handles: centro (epicentro del gradiente), radio X, radio Y (elipse), y rotation. Color stops idénticos a linear. Útil para efectos de spotlight, glow y profundidad en UI.

#### Figma: Fill — Gradient Angular
**Cat:** PROPIEDADES | **MCP tool:** `prop_fill_gradient_angular` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Degradado en barrido circular (cono). Gira alrededor de un punto central. Ideal para color wheels, medidores circulares, efectos metálicos. Mismos color stops configurables. Handle en canvas para ajustar epicentro y rotación del sweep.

#### Figma: Fill — Gradient Diamond
**Cat:** PROPIEDADES | **MCP tool:** `prop_fill_gradient_diamond` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Degradado en forma de diamante/rombo desde un centro hacia las esquinas. Cuatro puntas equidistantes. Control visual en canvas: centro y escala del diamante. Color stops idénticos a los otros tipos. El menos usado de los 4 tipos pero útil para efectos geométricos específicos.

#### Figma: Fill — Image
**Cat:** PROPIEDADES | **MCP tool:** `prop_fill_image` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Imagen como relleno. Modos de ajuste: Fill (cubre), Fit (contiene), Crop (recorte manual), Tile (mosaico repetido). Rotation, exposure, contrast, saturation, tint adjustments. Las imágenes son assets del archivo con hash único. Se pueden reutilizar en múltiples objetos. Paste de imagen desde portapapeles (Ctrl+V sobre objeto seleccionado).

#### Figma: Stroke (Borde)
**Cat:** PROPIEDADES | **MCP tool:** `prop_stroke` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Múltiples strokes por objeto, apilados bottom-up como fills. Width en px. Align: Inside, Center, Outside (afecta dónde cae el borde relativo al path). Estilos de dash: línea sólida o patrones de dash/gap configurables. Cap: None, Round, Square (afecta extremos de path abierto). Join: Miter (esquina viva con angle limit), Bevel (chaflán), Round (esquina redondeada). Mismo sistema de color que fills (sólido, 4 gradientes, imagen).

#### Figma: Stroke — Dash Pattern
**Cat:** PROPIEDADES | **MCP tool:** `prop_stroke_dash` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Patrón de línea discontinua. Se configura con pares dash-gap (ej: "5, 3" → dash de 5px, gap de 3px). Múltiples valores crean patrones complejos (ej: "8, 3, 2, 3" → dash largo, gap, dash corto, gap). Se ajusta al stroke width automáticamente. Cap del dash afecta la forma terminal de cada segmento.

#### Figma: Stroke — Arrowheads
**Cat:** PROPIEDADES | **MCP tool:** `prop_stroke_arrow` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Puntas de flecha en uno o ambos extremos de un path abierto. Estilos: None, Arrow (triángulo), Triangle (triángulo relleno), Circle (círculo), Diamond (rombo), Line (línea perpendicular). Se escala con el stroke width. Disponible en Line, Arrow y cualquier path abierto.

#### Figma: Effects — Drop Shadow
**Cat:** PROPIEDADES | **MCP tool:** `prop_effect_shadow` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Sombra paralela (offset en X, Y, blur, spread). Color con opacidad independiente. Blend mode de sombra (Multiply por defecto). Se puede guardar como Effect Style. Múltiples shadow effects por objeto, apilados bottom-up. Visibilidad toggleable por efecto individual. "Show shadow behind" en frames hijos.

#### Figma: Effects — Inner Shadow
**Cat:** PROPIEDADES | **MCP tool:** `prop_effect_inner_shadow` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Sombra interior (dentro del objeto). Mismos parámetros que drop shadow (X, Y, blur, spread, color, blend). Dos tipos: Drop shadow e Inner shadow se crean por separado. Útil para efectos inset (hundimiento), bordes internos y profundidad negativa. Efecto renderizado dentro del bounding box.

#### Figma: Effects — Layer Blur
**Cat:** PROPIEDADES | **MCP tool:** `prop_effect_layer_blur` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Blur gaussiano sobre el objeto completo. Intensidad en px. Afecta fills, strokes, y contenido renderizado. Útil para glassmorphism, efectos de profundidad, sombras suavizadas indirectas. El blur se aplica antes del blend mode del objeto.

#### Figma: Effects — Background Blur
**Cat:** PROPIEDADES | **MCP tool:** `prop_effect_bg_blur` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Blur del contenido DEBAJO del objeto (no del objeto mismo). Intensidad en px. La transparencia del objeto deja ver el contenido con blur. Esencial para glassmorphism y overlays de navegación. Solo funciona donde hay contenido visual debajo (no funciona sobre transparencia total). Más costoso computacionalmente que layer blur.

#### Figma: Corner Radius (Radius de Esquina)
**Cat:** PROPIEDADES | **MCP tool:** `prop_corner_radius` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Radio de redondeo en px. Cuatro modos: Uniforme (un valor para las 4 esquinas), Independiente (4 valores por esquina), Corner smoothing (suavizado de iOS-style, 0-100%), Ellipse corner. El handle de radius en el canvas permite arrastrar visualmente. Con Alt+click en un corner handle se independiza esa esquina. Aritmética en inputs igual que position/size.

### ✍️ Text Properties

#### Figma: Font Family & Weight
**Cat:** PROPIEDADES | **MCP tool:** `prop_text_font` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Selector de font con preview. Filtro por web fonts, local fonts, y Google Fonts (sincronizados). Weight (Thin a Black, 100-900). Style (Normal/Italic). Font size en px con aritmética. Missing font warning con opción de sustitución. "Text Style" guardable como estilo reutilizable.

#### Figma: Font Size
**Cat:** PROPIEDADES | **MCP tool:** `prop_text_size` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Tamaño en px. Scrub + aritmética. Ctrl+Shift+, / . para aumentar/disminuir 1px en selección de texto. El texto puede exceder los límites del bounding box si es point text (wraps automáticamente en area text).

#### Figma: Line Height
**Cat:** PROPIEDADES | **MCP tool:** `prop_text_line_height` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Interlineado en 3 modos: Auto (120% del font size), Px (valor fijo), % (relativo al font size). Aritmética en input. Atajo: Alt+↑↓ para ajustar. Variable por selección de texto parcial. Crítico para la baseline grid y ritmo vertical.

#### Figma: Letter Spacing
**Cat:** PROPIEDADES | **MCP tool:** `prop_text_letter_spacing` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Tracking (espacio entre caracteres) en px o %. Alt+←→ para ajustar en selección. Valores negativos para tight tracking (títulos), positivos para expanded (botones, badges). Porcentaje relativo al font size, px es absoluto.

#### Figma: Paragraph Spacing
**Cat:** PROPIEDADES | **MCP tool:** `prop_text_paragraph` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Espacio entre párrafos (después de Enter). Solo en px. Independiente del line-height. Configuración en el panel de propiedades > Text > Paragraph spacing. Útil para separación entre bloques de texto en area text.

#### Figma: Text Align
**Cat:** PROPIEDADES | **MCP tool:** `prop_text_align` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Horizontal: Left, Center, Right, Justified (estira líneas para llenar ancho completo). Vertical (solo area text): Top, Middle, Bottom. Atajos: Ctrl+Alt+L/C/R para horizontal. Justify rara vez usado en UI design, más para body text de documentos.

#### Figma: Text Decoration
**Cat:** PROPIEDADES | **MCP tool:** `prop_text_decoration` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Underline (línea debajo) y Strikethrough (tachado). Ctrl+U para underline, Ctrl+Shift+X para strikethrough. Se aplican a selecciones parciales dentro de un text node. No hay overline nativo. El color y grosor del underline heredan del color de texto.

#### Figma: Text Case (Transform)
**Cat:** PROPIEDADES | **MCP tool:** `prop_text_case` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Uppercase, Lowercase, Title Case, Original Case. Ctrl+Shift+K para uppercase. No destructivo — el texto original se preserva (transformación visual solamente). Mejor que escribir en mayúsculas manualmente porque permite cambiar de opinión sin reescribir.

#### Figma: Text Resize Behavior
**Cat:** PROPIEDADES | **MCP tool:** `prop_text_resize` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Tres modos: Auto Width (point text, crece horizontalmente con el texto), Auto Height (ancho fijo, altura crece con wraps), Fixed Size (W y H fijos, texto se corta). El modo se cambia desde el panel de propiedades o con doble clic en los handles del bounding box.

#### Figma: List Style
**Cat:** PROPIEDADES | **MCP tool:** `prop_text_list` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Listas: Unordered (bullet •), Ordered (números 1., 2., etc.). Indentación automática del bullet/número con hanging indent. Ctrl+Shift+7 para unordered, Ctrl+Shift+8 para ordered. El bullet usa el mismo font que el texto (fallback a font del sistema si el glyph falta).

#### Figma: Text Truncation
**Cat:** PROPIEDADES | **MCP tool:** `prop_text_truncation` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Disponible en Fixed Size text. El texto que excede el bounding box se corta con "…" al final. Configurable en el panel de propiedades. Importante para componentes donde el texto es dinámico (nombres de usuario, títulos de card, etc.).

### 🔗 Estilos (Styles)

#### Figma: Styles (Estilos Reutilizables)
**Cat:** PROPIEDADES | **MCP tool:** `prop_styles` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Cuatro tipos de estilos: Color (fills y strokes), Text (font, size, weight, line-height, letter-spacing), Effect (shadows, blurs), Layout Grid. Se crean desde el panel de propiedades (ícono de 4 puntos). Se publican a Team Library para compartir entre archivos. Los estilos vinculados a library se actualizan cuando el source cambia. "Detach style" rompe el vínculo manteniendo los valores.

---

## 📊 Resumen

| Categoría | Funcionalidades documentadas |
|-----------|---------------------------|
| CANVAS | 15 |
| HERRAMIENTAS | 14 |
| CAPAS | 14 |
| PROPIEDADES | 33 |
| **TOTAL** | **76** |
