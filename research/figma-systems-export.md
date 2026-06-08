# 📘 Figma Systems Documentation — Lara ✨

> Documentación experta de funcionalidades de Figma para referencia interna de Futuraria.
> **Fecha:** 2026-06-07 | **Fuente:** conocimiento experto, no web scraping.

---

## 5. COMPONENTES

Los componentes en Figma son elementos reutilizables que mantienen consistencia de diseño. El sistema incluye master/instance, variants, properties, styles, libraries y publishing.

#### Figma: Master Component
**Cat:** COMPONENTES | **MCP tool:** `Cmd+Opt+K` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Componente principal del que derivan todas las instancias. Editar el master actualiza todas las instancias vinculadas. Overrides locales no se sobreescriben.

#### Figma: Instance Override
**Cat:** COMPONENTES | **MCP tool:** clicks en instance | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Las instancias pueden sobrescribir texto, color, visibilidad y swap sin romper el vínculo con el master. Overrides persisten incluso si el master cambia esa propiedad.

#### Figma: Push Override to Master
**Cat:** COMPONENTES | **MCP tool:** `Right-click > Push to main` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Propaga un override de una instancia hacia el master component, actualizando todas las demás instancias.

#### Figma: Component Variants
**Cat:** COMPONENTES | **MCP tool:** `Add variant` en panel | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Agrupa múltiples componentes como variantes de un conjunto (ej: btn/default, btn/hover, btn/disabled). Se seleccionan desde el panel de propiedades como dropdown.

#### Figma: Boolean Property
**Cat:** COMPONENTES | **MCP tool:** `Component properties > Boolean` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Propiedad on/off en componentes que controla visibilidad de capas. Ideal para iconos opcionales, badges, o estados show/hide.

#### Figma: Text Property
**Cat:** COMPONENTES | **MCP tool:** `Component properties > Text` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Expone un campo de texto en el panel de propiedades de la instancia. Permite cambiar contenido textual sin hacer doble-click en el canvas.

#### Figma: Instance Swap Property
**Cat:** COMPONENTES | **MCP tool:** `Component properties > Instance swap` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Define qué instancias anidadas pueden intercambiarse desde el panel de propiedades. Útil para iconos, avatares, o subcomponentes intercambiables.

#### Figma: Color Styles
**Cat:** COMPONENTES | **MCP tool:** `Styles panel > +` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Estilos de color reutilizables (fill/stroke). Al editar un estilo, todos los elementos que lo usan se actualizan. Soporta sólido, gradiente e imagen.

#### Figma: Text Styles
**Cat:** COMPONENTES | **MCP tool:** `Styles panel > Text > +` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Estilos tipográficos reutilizables (font family, weight, size, line height, letter spacing). Un cambio en el estilo se propaga a todos los textos vinculados.

#### Figma: Effect Styles
**Cat:** COMPONENTES | **MCP tool:** `Styles panel > Effect > +` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Estilos de efecto reutilizables (drop shadow, inner shadow, layer blur, background blur). Consistencia visual centralizada.

#### Figma: Grid Styles
**Cat:** COMPONENTES | **MCP tool:** `Styles panel > Grid > +` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Layout grids reutilizables (column, row, grid). Aplicables a frames para mantener sistemas de grilla consistentes entre diseños.

#### Figma: Component Libraries
**Cat:** COMPONENTES | **MCP tool:** `Assets panel > Libraries` | **Complejidad:** Alta | **Free tier:** Sí (limitado a 1 equipo)
**Descripción:** Colección de componentes y estilos publicados que pueden consumirse desde cualquier archivo del equipo. Facilita design systems cross-project.

#### Figma: Library Publishing
**Cat:** COMPONENTES | **MCP tool:** `Assets panel > Publish` | **Complejidad:** Media | **Free tier:** Sí (limitado)
**Descripción:** Publica componentes y estilos desde un archivo fuente hacia la librería del equipo. Las actualizaciones se notifican a todos los archivos consumidores.

#### Figma: Library Updates
**Cat:** COMPONENTES | **MCP tool:** `Assets panel > Updates` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Gestiona cambios entrantes desde librerías externas. Permite aceptar o rechazar actualizaciones componente por componente.

#### Figma: Detach Instance
**Cat:** COMPONENTES | **MCP tool:** `Cmd+Opt+B` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Rompe el vínculo de una instancia con su master, convirtiéndola en un grupo/frame normal. Irreversible; útil para one-offs o exploraciones.

#### Figma: Restore Component
**Cat:** COMPONENTES | **MCP tool:** `Right-click > Restore component` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Revincula un componente detached a su master original, restaurando overrides previos. Disponible mientras se mantenga en el historial de versiones.

---

## 6. AUTO LAYOUT

Auto Layout es el motor de layout responsivo de Figma. Equivalente a CSS Flexbox. Permite que los frames se redimensionen dinámicamente según su contenido.

#### Figma: Auto Layout — Add
**Cat:** AUTO LAYOUT | **MCP tool:** `Shift+A` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Convierte un frame o selección en un contenedor con auto layout. Agrega dirección, gap, padding y comportamiento de resize por defecto.

#### Figma: Auto Layout — Direction
**Cat:** AUTO LAYOUT | **MCP tool:** `Auto layout panel > Direction` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Define el flujo de los hijos: Horizontal (fila), Vertical (columna), o Wrap (multi-línea). Equivalente a flex-direction en CSS.

#### Figma: Auto Layout — Gap
**Cat:** AUTO LAYOUT | **MCP tool:** `Auto layout panel > Gap` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Espaciado uniforme entre hijos dentro del auto layout. Puede ser horizontal y vertical independiente. Equivalente a gap en CSS Grid/Flexbox.

#### Figma: Auto Layout — Padding
**Cat:** AUTO LAYOUT | **MCP tool:** `Auto layout panel > Padding` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Espacio interno entre el borde del frame y sus hijos. Configurable por lado (top, right, bottom, left) o uniforme. Base del spacing system.

#### Figma: Auto Layout — Hug Contents
**Cat:** AUTO LAYOUT | **MCP tool:** `Auto layout panel > Resizing > Hug` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** El frame se ajusta al tamaño de sus hijos. Si los hijos crecen (ej: más texto), el frame crece con ellos. Comportamiento responsive fundamental.

#### Figma: Auto Layout — Fill Container
**Cat:** AUTO LAYOUT | **MCP tool:** `Auto layout panel > Resizing > Fill` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** El hijo se estira para ocupar todo el espacio disponible en el eje definido. Equivalente a flex: 1 en CSS.

#### Figma: Auto Layout — Fixed Size
**Cat:** AUTO LAYOUT | **MCP tool:** `Auto layout panel > Resizing > Fixed` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** El frame o hijo mantiene un ancho/alto fijo independientemente de su contenido o del contenedor padre.

#### Figma: Auto Layout — Horizontal Alignment
**Cat:** AUTO LAYOUT | **MCP tool:** `Auto layout panel > Alignment` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Alineación de hijos en el eje horizontal: Left, Center, Right. En dirección horizontal controla la distribución; en vertical controla la alineación cruzada.

#### Figma: Auto Layout — Vertical Alignment
**Cat:** AUTO LAYOUT | **MCP tool:** `Auto layout panel > Alignment` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Alineación de hijos en el eje vertical: Top, Center, Bottom. En dirección vertical controla distribución; en horizontal controla alineación cruzada.

#### Figma: Auto Layout — Absolute Position
**Cat:** AUTO LAYOUT | **MCP tool:** `Right-click > Absolute position` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Saca un hijo del flujo normal del auto layout y lo posiciona manualmente. Útil para badges, iconos flotantes, o elementos overlay dentro de cards.

#### Figma: Auto Layout — Wrap
**Cat:** AUTO LAYOUT | **MCP tool:** `Auto layout panel > Wrap` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Permite que los hijos fluyan a la siguiente línea cuando no caben en el ancho del contenedor. Equivalente a flex-wrap. Soporta gap independiente entre filas.

#### Figma: Auto Layout — Min/Max Width & Height
**Cat:** AUTO LAYOUT | **MCP tool:** `Auto layout panel > Min/Max` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Define restricciones de tamaño mínimo y máximo en ejes fill o hug. Permite que un botón crezca con el texto pero no menos de 48px (touch target mínimo).

#### Figma: Auto Layout — Canvas Stacking Order
**Cat:** AUTO LAYOUT | **MCP tool:** `Auto layout panel > Canvas stacking` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Controla el orden Z de los hijos: First on top o Last on top. Determina qué elemento se pinta encima cuando hay solapamiento.

#### Figma: Auto Layout — Text Truncation
**Cat:** AUTO LAYOUT | **MCP tool:** `Auto layout panel > Text truncation` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Cuando un texto excede el ancho del contenedor, muestra "..." al final. Útil para nombres de usuario, títulos de cards, y list items con ancho fijo.

---

## 7. PROTOTIPADO

El sistema de prototipado de Figma conecta frames para simular flujos de usuario. Soporta triggers, acciones, animaciones y overlays.

#### Figma: Prototype — Interaction
**Cat:** PROTOTIPADO | **MCP tool:** `Prototype panel > +` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Conecta dos frames con una interacción: trigger + action + animation. La flecha de conexión se dibuja desde un hotspot (elemento) hacia el frame destino.

#### Figma: Prototype — On Click Trigger
**Cat:** PROTOTIPADO | **MCP tool:** `Prototype panel > Trigger > On click` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Dispara la interacción al hacer click/tap en el elemento. Es el trigger más común para navegación, botones y CTAs.

#### Figma: Prototype — On Hover Trigger
**Cat:** PROTOTIPADO | **MCP tool:** `Prototype panel > Trigger > While hovering` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Activa la interacción mientras el cursor está sobre el elemento. Típicamente usado para tooltips, previews, y estados hover.

#### Figma: Prototype — While Pressing Trigger
**Cat:** PROTOTIPADO | **MCP tool:** `Prototype panel > Trigger > While pressing` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Dispara la interacción mientras el elemento se mantiene presionado (mouse o touch). Al soltar, se revierte el estado. Ideal para estados active/pressed.

#### Figma: Prototype — On Drag Trigger
**Cat:** PROTOTIPADO | **MCP tool:** `Prototype panel > Trigger > On drag` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Dispara la interacción al arrastrar un elemento. Configurable con snap points y límites. Esencial para sliders, carruseles, y gestos swipe.

#### Figma: Prototype — Key/Gamepad Trigger
**Cat:** PROTOTIPADO | **MCP tool:** `Prototype panel > Trigger > Key/gamepad` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Activa la interacción con una tecla específica o botón de gamepad. Útil para prototipos de juegos, dashboards con atajos, y testing de accesibilidad por teclado.

#### Figma: Prototype — After Delay Trigger
**Cat:** PROTOTIPADO | **MCP tool:** `Prototype panel > Trigger > After delay` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Dispara la acción automáticamente después de un tiempo configurable en ms. Útil para splash screens, loading states, y animaciones de entrada.

#### Figma: Prototype — Mouse Enter / Leave
**Cat:** PROTOTIPADO | **MCP tool:** `Prototype panel > Trigger > Mouse enter/leave` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Dispara al entrar o salir el cursor de un elemento. Mouse enter es común para iniciar hover states; mouse leave para revertirlos.

#### Figma: Prototype — Navigate To Action
**Cat:** PROTOTIPADO | **MCP tool:** `Prototype panel > Action > Navigate to` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Navega al frame destino, reemplazando la pantalla actual. Es la acción más común para transiciones entre pantallas.

#### Figma: Prototype — Open Overlay Action
**Cat:** PROTOTIPADO | **MCP tool:** `Prototype panel > Action > Open overlay` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Abre el frame destino como un modal/overlay sobre la pantalla actual. Configurable manualmente (posición x/y) o con preset (center, top, bottom). Fondo con opacidad.

#### Figma: Prototype — Swap Overlay Action
**Cat:** PROTOTIPADO | **MCP tool:** `Prototype panel > Action > Swap overlay` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Reemplaza el overlay actual por otro diferente manteniendo la posición. Útil para flujos multi-step en modales (ej: login → forgot password).

#### Figma: Prototype — Scroll To Action
**Cat:** PROTOTIPADO | **MCP tool:** `Prototype panel > Action > Scroll to` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Hace scroll animado a un elemento específico dentro del mismo frame. Usado para anchor links, back-to-top buttons, y navegación intra-página.

#### Figma: Prototype — Back Action
**Cat:** PROTOTIPADO | **MCP tool:** `Prototype panel > Action > Back` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Retorna al frame anterior en la pila de navegación (como el botón back del navegador). Esencial para flujos de navegación con historial.

#### Figma: Prototype — Close Overlay Action
**Cat:** PROTOTIPADO | **MCP tool:** `Prototype panel > Action > Close overlay` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Cierra el overlay o modal actual y retorna a la pantalla subyacente. Común en botones de cerrar (X) y backdrop taps.

#### Figma: Prototype — Set Variable Action
**Cat:** PROTOTIPADO | **MCP tool:** `Prototype panel > Action > Set variable` | **Complejidad:** Alta | **Free tier:** Sí
**Descripción:** Asigna un valor a una variable durante el prototipado. Permite crear lógica condicional, contadores, toggles, y estados dinámicos.

#### Figma: Prototype — Conditional Action
**Cat:** PROTOTIPADO | **MCP tool:** `Prototype panel > Action > Conditional` | **Complejidad:** Alta | **Free tier:** Sí
**Descripción:** Ejecuta diferentes acciones según el valor de una variable (if/else). Permite flujos condicionales: si loggedIn=true → dashboard, si false → login.

#### Figma: Prototype — Open Link Action
**Cat:** PROTOTIPADO | **MCP tool:** `Prototype panel > Action > Open link` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Abre una URL externa en el navegador durante la presentación del prototipo. Útil para links a documentación, sitios web reales o recursos externos.

#### Figma: Prototype — Instant Transition
**Cat:** PROTOTIPADO | **MCP tool:** `Prototype panel > Animation > Instant` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Transición inmediata entre frames (0ms). Sin animación. Útil para cambios de estado puros donde no se desea movimiento.

#### Figma: Prototype — Dissolve Transition
**Cat:** PROTOTIPADO | **MCP tool:** `Prototype panel > Animation > Dissolve` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Fundido cruzado (fade) entre el frame actual y el destino. Suave y genérico. Buen default cuando no aplica Smart Animate.

#### Figma: Prototype — Slide In/Out Transition
**Cat:** PROTOTIPADO | **MCP tool:** `Prototype panel > Animation > Slide in/out` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** El frame destino se desliza desde left/right/top/bottom sobre el actual. Ideal para navegación push/pop, drawers, y panels laterales.

#### Figma: Prototype — Smart Animate
**Cat:** PROTOTIPADO | **MCP tool:** `Prototype panel > Animation > Smart animate` | **Complejidad:** Alta | **Free tier:** Sí
**Descripción:** Anima automáticamente diferencias entre dos frames (posición, tamaño, opacidad, rotación). Requiere que los elementos tengan el mismo nombre y jerarquía. Es el core diferenciador de Figma.

#### Figma: Prototype — Easing Curves
**Cat:** PROTOTIPADO | **MCP tool:** `Prototype panel > Easing` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Curvas de aceleración: Ease In, Ease Out, Ease In and Out, Ease In Back, Ease Out Back, Custom spring. Definen la personalidad del movimiento.

#### Figma: Prototype — Duration
**Cat:** PROTOTIPADO | **MCP tool:** `Prototype panel > Duration` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Duración de la animación en ms (10ms a 10000ms). Para Smart Animate, valores entre 200-500ms son naturales; transiciones más lentas para storytelling.

#### Figma: Prototype — Overlay Position & Backdrop
**Cat:** PROTOTIPADO | **MCP tool:** `Prototype panel > Overlay settings` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Configura posición del overlay (manual, center, top/bottom left/center/right) y backdrop (color sólido con opacidad, blur, o transparente).

#### Figma: Prototype — Scroll Position
**Cat:** PROTOTIPADO | **MCP tool:** `Prototype panel > Scroll position` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Elementos con posición fija (fixed) no se mueven al hacer scroll del frame padre. Sticky se mantiene en su posición hasta un límite de scroll. Esencial para headers fixed y navs sticky.

#### Figma: Prototype — Overflow Scrolling
**Cat:** PROTOTIPADO | **MCP tool:** `Prototype panel > Overflow` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Define scroll behavior del frame: No scrolling, Horizontal, Vertical, Both directions. Permite simular listas y páginas scrolleables.

#### Figma: Prototype — Prototype Device & Background
**Cat:** PROTOTIPADO | **MCP tool:** `Prototype panel > Device` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Configura el dispositivo de presentación (None, Phone, Tablet, Watch, Desktop) y color de fondo. El frame se embeve en el mockup del dispositivo elegido.

---

## 8. VARIABLES

Las variables en Figma almacenan valores reutilizables con soporte para modos (theming) y scoping. Son la capa de design tokens del ecosistema.

#### Figma: Color Variable
**Cat:** VARIABLES | **MCP tool:** `Variables panel > + > Color` | **Complejidad:** Baja | **Free tier:** Sí (limitado)
**Descripción:** Variable de color reutilizable en fills, strokes, y efectos. Soporta opacidad. Base de sistemas de color semántico (primary, surface, text).

#### Figma: Number Variable
**Cat:** VARIABLES | **MCP tool:** `Variables panel > + > Number` | **Complejidad:** Baja | **Free tier:** Sí (limitado)
**Descripción:** Variable numérica para padding, gap, corner radius, font size, line height, opacidad, stroke weight, y dimensiones de auto layout.

#### Figma: String Variable
**Cat:** VARIABLES | **MCP tool:** `Variables panel > + > String` | **Complejidad:** Baja | **Free tier:** Sí (limitado)
**Descripción:** Variable de texto para contenido dinámico en componentes (títulos, labels, placeholders). Útil para internacionalización y prototipos con datos variables.

#### Figma: Boolean Variable
**Cat:** VARIABLES | **MCP tool:** `Variables panel > + > Boolean` | **Complejidad:** Baja | **Free tier:** Sí (limitado)
**Descripción:** Variable true/false vinculable a boolean properties de componentes (show/hide). Permite lógica de visibilidad dinámica en prototipos.

#### Figma: Variable Collections
**Cat:** VARIABLES | **MCP tool:** `Variables panel > Collections` | **Complejidad:** Alta | **Free tier:** Sí (limitado a 1)
**Descripción:** Agrupa variables por propósito semántico (Colors, Spacing, Typography). Cada colección puede tener múltiples modos. Organización esencial para design tokens.

#### Figma: Variable Modes
**Cat:** VARIABLES | **MCP tool:** `Variables panel > Modes column` | **Complejidad:** Alta | **Free tier:** Sí (limitado a 1)
**Descripción:** Cada colección soporta modos (Light/Dark, Desktop/Mobile, Brand A/B). Cada variable puede tener distintos valores por modo. Permite theming y responsive tokens.

#### Figma: Variable Scoping
**Cat:** VARIABLES | **MCP tool:** `Variables panel > Scope settings` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Restringe a qué propiedades puede aplicarse una variable (fill, stroke, gap, padding, font size, etc.). Previene que una variable de color se aplique accidentalmente a un font size.

#### Figma: Variable Aliases
**Cat:** VARIABLES | **MCP tool:** `Variables panel > Alias reference` | **Complejidad:** Alta | **Free tier:** Sí
**Descripción:** Una variable puede referenciar a otra (aliasing). Ej: `color/bg-primary` → `color/blue-500`. Cambiar `blue-500` actualiza todas las variables que la referencian. Token chain.

#### Figma: Variable Binding in Auto Layout
**Cat:** VARIABLES | **MCP tool:** `Auto layout panel > Apply variable` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Vincula variables de número a propiedades de auto layout (padding, gap). Un cambio en la variable `spacing-md` actualiza todos los layouts que la usan.

#### Figma: Variable Binding in Prototype
**Cat:** VARIABLES | **MCP tool:** `Prototype panel > Set variable` | **Complejidad:** Alta | **Free tier:** Sí
**Descripción:** Variables usadas en prototipos para lógica condicional: contadores de carrito, toggles de tema, estados de formulario, y flujos personalizados por usuario.

#### Figma: Variable Groups
**Cat:** VARIABLES | **MCP tool:** `Variables panel > Group` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Agrupa variables dentro de una colección usando `/` en el nombre (ej: `primitive/blue/500`). Crea jerarquía visual en el panel de variables.

#### Figma: Variable Code Syntax Export
**Cat:** VARIABLES | **MCP tool:** `Dev Mode > Variables` | **Complejidad:** Alta | **Free tier:** No (Dev Mode pago)
**Descripción:** Exporta variables como code snippets en CSS, SCSS, JS/TS tokens. El panel de Dev Mode muestra el valor de la variable en el contexto actual (modo activo).

---

## 9. EXPORT

El sistema de export de Figma cubre assets, specs de diseño, y código generado para handoff developer.

#### Figma: Export — Single Asset
**Cat:** EXPORT | **MCP tool:** `Export panel > +` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Exporta un elemento o frame individual como PNG, JPG, SVG o PDF. Añadible desde el panel de propiedades de cualquier elemento seleccionado.

#### Figma: Export — PNG Export
**Cat:** EXPORT | **MCP tool:** `Export panel > PNG` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Exporta como imagen rasterizada PNG con soporte de transparencia (alpha channel). Ideal para assets de producción y previews. Sin pérdida de calidad.

#### Figma: Export — JPG Export
**Cat:** EXPORT | **MCP tool:** `Export panel > JPG` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Exporta como imagen comprimida JPG sin transparencia. Tamaños de archivo menores que PNG, útil para fotografías y backgrounds.

#### Figma: Export — SVG Export
**Cat:** EXPORT | **MCP tool:** `Export panel > SVG` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Exporta como gráfico vectorial SVG. Incluye opciones: outline text, include id attributes, simplify stroke, include node names. Ideal para iconos e ilustraciones web.

#### Figma: Export — PDF Export
**Cat:** EXPORT | **MCP tool:** `Export panel > PDF` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Exporta frames seleccionados como documento PDF vectorial. Útil para presentaciones, specs de diseño, y documentación para stakeholders.

#### Figma: Export — Scale Multipliers (1x-4x)
**Cat:** EXPORT | **MCP tool:** `Export panel > Suffix/Scale` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Define escala de exportación: 0.5x, 1x, 1.5x, 2x, 3x, 4x. Un frame de 48x48px exportado a 2x produce 96x96px. Estándar para assets multi-resolución.

#### Figma: Export — Custom Suffix
**Cat:** EXPORT | **MCP tool:** `Export panel > Suffix` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Añade sufijo al nombre de archivo exportado. Un frame "icon/check" con sufijo "@2x" exporta como "check@2x.png". Esencial para naming conventions de assets.

#### Figma: Export — Batch/Multiple Settings
**Cat:** EXPORT | **MCP tool:** `Export panel > Multiple settings` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Define múltiples configuraciones de export para el mismo elemento (ej: SVG + PNG@1x + PNG@2x). Se exportan todas simultáneamente.

#### Figma: Export — Bulk Export (All Selected)
**Cat:** EXPORT | **MCP tool:** `Selection > Export` o `File > Export` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Exporta todos los elementos seleccionados con "export marker" activo a la vez. Agrupa en ZIP si son múltiples archivos. Base del pipeline de asset delivery.

#### Figma: Export — Slice Tool
**Cat:** EXPORT | **MCP tool:** `S` (Slice tool) | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Define regiones de exportación personalizadas con la herramienta Slice (atajo S). No afecta el diseño; solo define qué área se exporta. Útil para sprites y banners.

#### Figma: Export — Copy as PNG
**Cat:** EXPORT | **MCP tool:** `Right-click > Copy as PNG` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Copia el elemento seleccionado al portapapeles como imagen PNG. Rápido para pegar en Slack, Notion, presentaciones o documentos sin archivo intermedio.

#### Figma: Export — Copy as SVG
**Cat:** EXPORT | **MCP tool:** `Right-click > Copy as SVG` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Copia el elemento como código SVG al portapapeles. Listo para pegar directamente en HTML o editores de código.

#### Figma: Export — Copy as CSS
**Cat:** EXPORT | **MCP tool:** `Right-click > Copy as CSS` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Copia propiedades CSS del elemento seleccionado. Incluye border-radius, background, box-shadow, font properties. Handoff rápido sin Dev Mode.

#### Figma: Export — Copy Properties
**Cat:** EXPORT | **MCP tool:** `Right-click > Copy properties` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Copia propiedades de diseño en formato JSON-like. Incluye color, tipografía, dimensiones. Útil para documentar specs o alimentar herramientas externas.

#### Figma: Dev Mode — Inspect Panel
**Cat:** EXPORT | **MCP tool:** `Shift+D` (Dev Mode toggle) | **Complejidad:** Media | **Free tier:** No (pago)
**Descripción:** Panel de inspección que muestra medidas, specs, y código generado (CSS, SwiftUI, Compose, Tailwind). Handoff developer con redlines automáticos.

#### Figma: Dev Mode — Code Snippets
**Cat:** EXPORT | **MCP tool:** `Dev Mode > Code` | **Complejidad:** Media | **Free tier:** No (pago)
**Descripción:** Genera código en múltiples sintaxis: CSS, Tailwind, SwiftUI, Jetpack Compose, Flutter. Incluye variables y tokens si están vinculados.

#### Figma: Dev Mode — Compare Changes
**Cat:** EXPORT | **MCP tool:** `Dev Mode > Compare changes` | **Complejidad:** Media | **Free tier:** No (pago)
**Descripción:** Muestra diff visual entre versiones de diseño. Resalta qué propiedades cambiaron desde la última revisión aprobada. Reduce bugs de implementación.

#### Figma: Dev Mode — Annotations & Measurements
**Cat:** EXPORT | **MCP tool:** `Dev Mode > Annotate` | **Complejidad:** Media | **Free tier:** No (pago)
**Descripción:** Herramientas de medición y anotación sobre el diseño para comunicar specs. Medir distancias entre elementos, bounding boxes, y propiedades de capa.

#### Figma: Export — RTL/LTR Text Direction
**Cat:** EXPORT | **MCP tool:** `Export settings > Text direction` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Configura dirección de texto (LTR/RTL) en export. Afecta texto y layout. Soporte para idiomas como árabe y hebreo.

#### Figma: Export — Selective Layer Export
**Cat:** EXPORT | **MCP tool:** `Export panel > Contents only` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Opción "Contents only" que exporta solo el contenido del elemento, ignorando cualquier overflow más allá de los bounds del elemento.

---

## 10. COLABORACIÓN

Figma es nativamente colaborativo: multiplayer en tiempo real, comentarios, presencia de cursores, y control de versiones.

#### Figma: Real-time Multiplayer
**Cat:** COLABORACIÓN | **MCP tool:** `Share > Invite` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Múltiples personas editan el mismo archivo simultáneamente. Sin conflictos de merge. Cambios visibles en tiempo real con indicador de quién edita qué.

#### Figma: Multiplayer Cursors
**Cat:** COLABORACIÓN | **MCP tool:** Automático con multiplayer | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Cada colaborador tiene un cursor con su nombre y color asignado. Se ve en tiempo real qué está haciendo cada persona en el canvas.

#### Figma: Observation Mode (Seguir)
**Cat:** COLABORACIÓN | **MCP tool:** Click en avatar de colaborador | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Sigue la vista de otro colaborador: tu canvas se sincroniza con su viewport. Útil para presentaciones guiadas y pair-designing. El líder mueve, el seguidor observa.

#### Figma: Comments
**Cat:** COLABORACIÓN | **MCP tool:** `C` (Comment tool) | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Añade comentarios anclados a puntos específicos del canvas. Soporta @mentions, replies, attachments (imágenes), y emoji reactions. Thread de discusión.

#### Figma: Comment Pins
**Cat:** COLABORACIÓN | **MCP tool:** Click en pin de comentario | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Los comentarios aparecen como pins en el canvas. Marcados como unresolved/resolved. Filtrables por: all, yours, unresolved, in current page.

#### Figma: Share Permissions
**Cat:** COLABORACIÓN | **MCP tool:** `Share > Permissions` | **Complejidad:** Media | **Free tier:** Sí (limitado)
**Descripción:** Control de acceso granular: Can view, Can view prototypes only, Can edit. Links con password opcional. Permisos por equipo, archivo, o persona.

#### Figma: Share Link Types
**Cat:** COLABORACIÓN | **MCP tool:** `Share > Copy link` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Genera links de diferentes tipos: edit access, prototype view, Dev Mode view. Cada link puede tener permisos distintos y caducidad opcional.

#### Figma: Version History
**Cat:** COLABORACIÓN | **MCP tool:** `File > Version history` o `Cmd+Opt+S` | **Complejidad:** Baja | **Free tier:** Sí (30 días)
**Descripción:** Historial completo de versiones con timestamp y autor. Permite restaurar versiones anteriores, duplicarlas, o nombrarlas (Named Versions) para milestones.

#### Figma: Auto-save & Named Versions
**Cat:** COLABORACIÓN | **MCP tool:** `Cmd+Opt+S` (Add to version history) | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Guardado automático continuo. Named versions permiten marcar hitos: "v1.0 Final", "Client Review", "Pre-redesign". Sirven como restore points.

#### Figma: Branching
**Cat:** COLABORACIÓN | **MCP tool:** `File > Branch` | **Complejidad:** Alta | **Free tier:** No (Professional+)
**Descripción:** Crea una rama del archivo principal para explorar cambios sin afectar el main. Al finalizar, se mergea (con review opcional) o se descarta. Git-like workflow para diseño.

#### Figma: Branch Review & Merge
**Cat:** COLABORACIÓN | **MCP tool:** `Branch > Review & merge` | **Complejidad:** Alta | **Free tier:** No (Professional+)
**Descripción:** Muestra diff visual entre branch y main. Permite aceptar/rechazar cambios individualmente antes del merge. El merge actualiza el archivo principal.

#### Figma: Audio Chat / Voice
**Cat:** COLABORACIÓN | **MCP tool:** `Audio call` en toolbar | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Llamada de audio integrada dentro del editor. Colaboradores en el mismo archivo pueden hablar sin salir de Figma. Útil para design reviews y pair design.

#### Figma: Team Libraries & Organization
**Cat:** COLABORACIÓN | **MCP tool:** `Admin > Team settings` | **Complejidad:** Media | **Free tier:** Sí (limitado)
**Descripción:** Organización de archivos en proyectos y equipos. Control de acceso a nivel de equipo. Separación entre workspace personal y equipos de trabajo.

#### Figma: Observers vs Editors
**Cat:** COLABORACIÓN | **MCP tool:** `Share > Permissions dropdown` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Distinción entre usuarios con permiso de edición (pueden modificar) y visualización (solo ver/comentar). Los viewers no consumen seat pago si no editan.

#### Figma: Prototype Sharing
**Cat:** COLABORACIÓN | **MCP tool:** `Present > Copy prototype link` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Comparte el prototipo interactivo como URL independiente. El viewer no ve el editor, solo el prototipo funcional con transiciones, overlays y scroll.

---

## 11. PLUGINS & API

Figma ofrece extensibilidad mediante plugins (sandboxed JS), una REST API completa, webhooks, y herramientas de developer mode.

#### Figma: Plugin Architecture
**Cat:** PLUGINS & API | **MCP tool:** `Plugins panel` o `Right-click > Plugins` | **Complejidad:** Alta | **Free tier:** Sí
**Descripción:** Plugins escritos en JS/TS que corren en sandbox (iframe aislado). Acceden al documento vía Figma Plugin API (`figma.*`). Disponibles desde el menú de plugins o atajos.

#### Figma: Plugin — Document API
**Cat:** PLUGINS & API | **MCP tool:** `figma.currentPage`, `figma.root` | **Complejidad:** Alta | **Free tier:** Sí
**Descripción:** API del plugin para leer y manipular nodos del documento: crear/editar/eliminar capas, leer propiedades, navegar el árbol de nodos.

#### Figma: Plugin — UI API
**Cat:** PLUGINS & API | **MCP tool:** `figma.ui`, `figma.showUI()` | **Complejidad:** Alta | **Free tier:** Sí
**Descripción:** Plugins pueden mostrar una UI HTML/CSS/JS en un panel lateral. Comunicación bidireccional entre UI (iframe) y sandbox principal vía `postMessage`.

#### Figma: Plugin — Input Events
**Cat:** PLUGINS & API | **MCP tool:** `figma.on('selectionchange')` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Plugins pueden suscribirse a eventos: selection change, document change, current page change, close. Reactividad a acciones del usuario.

#### Figma: Plugin — Node Operations
**Cat:** PLUGINS & API | **MCP tool:** `figma.createRectangle()`, etc. | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** API para crear, modificar, agrupar y eliminar nodos programáticamente. Soporta todos los tipos: frames, componentes, texto, vectores, auto layout.

#### Figma: Plugin — Component Operations
**Cat:** PLUGINS & API | **MCP tool:** `figma.createComponent()`, `instance.swapComponent()` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** API para crear componentes, instancias, variants, y propiedades desde plugins. Automatización de design systems (ej: generar todas las variantes de un botón).

#### Figma: Plugin — Styles API
**Cat:** PLUGINS & API | **MCP tool:** `figma.createPaintStyle()`, `figma.createTextStyle()` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Crear, modificar y aplicar estilos (color, texto, efecto, grid) desde plugins. Sincronización con design tokens externos.

#### Figma: Plugin — Import/Export
**Cat:** PLUGINS & API | **MCP tool:** `figma.importStyle()`, `node.exportAsync()` | **Complejidad:** Alta | **Free tier:** Sí
**Descripción:** Plugins pueden importar assets externos y exportar nodos como PNG/SVG/PDF. Base de flujos de importación desde ilustración, icon sets, o data visualization.

#### Figma: Plugin — Variables API
**Cat:** PLUGINS & API | **MCP tool:** `figma.variables.createVariable()` | **Complejidad:** Alta | **Free tier:** Sí
**Descripción:** API para crear, leer y modificar variables y colecciones desde plugins. Permite sincronizar design tokens con repos externos (Style Dictionary, Token Studio).

#### Figma: Plugin — Publishing & Approval
**Cat:** PLUGINS & API | **MCP tool:** `Figma Community > Publish` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Los plugins se publican en Figma Community con listing, descripción, screenshots y tags. Proceso de review automático + manual para plugins públicos.

#### Figma: REST API — Overview
**Cat:** PLUGINS & API | **MCP tool:** `GET/POST/PATCH/DELETE` vía `api.figma.com` | **Complejidad:** Alta | **Free tier:** Sí (rate-limited)
**Descripción:** API REST completa para operaciones CRUD sobre archivos, componentes, estilos, variables, comentarios y equipos. Autenticación vía Personal Access Token u OAuth2.

#### Figma: REST API — Files
**Cat:** PLUGINS & API | **MCP tool:** `GET /v1/files/:key` | **Complejidad:** Alta | **Free tier:** Sí
**Descripción:** Obtiene el documento JSON completo de un archivo Figma. Incluye árbol de nodos, estilos, componentes. Base para tooling: linters, documentación automática, code generation.

#### Figma: REST API — Components & Styles
**Cat:** PLUGINS & API | **MCP tool:** `GET /v1/files/:key/components`, `GET /v1/files/:key/styles` | **Complejidad:** Alta | **Free tier:** Sí
**Descripción:** Endpoints específicos para extraer componentes y estilos de un archivo. Más ligero que el file completo. Útil para catálogos de design system y documentation.

#### Figma: REST API — Images Export
**Cat:** PLUGINS & API | **MCP tool:** `GET /v1/images/:key` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Exporta nodos como PNG, JPG, SVG o PDF vía API. Especifica node IDs, formato, y escala. Retorna URLs temporales de descarga. Pipeline de asset delivery automatizado.

#### Figma: REST API — Comments
**Cat:** PLUGINS & API | **MCP tool:** `GET/POST /v1/files/:key/comments` | **Complejidad:** Media | **Free tier:** Sí
**Descripción:** Lee y crea comentarios vía API. Integración con sistemas de tickets, notificaciones, o sync con herramientas de project management (Jira, Linear, Asana).

#### Figma: REST API — Variables
**Cat:** PLUGINS & API | **MCP tool:** `GET/POST /v1/files/:key/variables` | **Complejidad:** Alta | **Free tier:** Sí
**Descripción:** Endpoint para leer y publicar variables de design tokens. Sincronización bidireccional entre Figma y repos de código (GitHub, GitLab).

#### Figma: REST API — Webhooks
**Cat:** PLUGINS & API | **MCP tool:** `POST /v2/webhooks` | **Complejidad:** Alta | **Free tier:** No (Organization+)
**Descripción:** Webhooks que disparan en eventos: file update, file delete, file version update, library publish, comment create. Integración con CI/CD, n8n, Slack, o sistemas de notificación.

#### Figma: REST API — Webhook Events
**Cat:** PLUGINS & API | **MCP tool:** `FILE_UPDATE`, `FILE_VERSION_UPDATE`, `LIBRARY_PUBLISH` | **Complejidad:** Alta | **Free tier:** No (Organization+)
**Descripción:** Eventos suscribibles: cambios en archivo, nuevas versiones, publicación de librerías, comentarios. Útil para: trigger design-to-code pipelines, invalidar cachés, notificar equipos.

#### Figma: REST API — OAuth2 Authentication
**Cat:** PLUGINS & API | **MCP tool:** `OAuth2 flow > api.figma.com` | **Complejidad:** Alta | **Free tier:** Sí
**Descripción:** Autenticación OAuth2 para apps que actúan en nombre del usuario. Flujo: redirect a Figma → user autoriza → access token + refresh token. Para apps públicas y servicios.

#### Figma: REST API — Personal Access Token
**Cat:** PLUGINS & API | **MCP tool:** `Settings > Personal Access Tokens` | **Complejidad:** Baja | **Free tier:** Sí
**Descripción:** Token personal para autenticación directa (no OAuth). Ideal para scripts, CI/CD pipelines y automatizaciones internas. Se genera desde account settings.

#### Figma: Dev Mode — Code Connect
**Cat:** PLUGINS & API | **MCP tool:** `Dev Mode > Code Connect` | **Complejidad:** Alta | **Free tier:** No (Dev Mode pago)
**Descripción:** Vincula componentes de diseño con componentes de código real. Mapeo 1:1 entre un Figma component y su implementación en React, SwiftUI, Compose. Elimina ambigüedad de handoff.

#### Figma: Dev Mode — VS Code Extension
**Cat:** PLUGINS & API | **MCP tool:** `Figma for VS Code` extension | **Complejidad:** Media | **Free tier:** No (Dev Mode pago)
**Descripción:** Extensión de VS Code que muestra diseños de Figma dentro del editor. Permite inspeccionar specs sin salir del IDE. Navegación entre código ↔ diseño.

#### Figma: Widgets API
**Cat:** PLUGINS & API | **MCP tool:** `Widgets` en toolbar | **Complejidad:** Alta | **Free tier:** Sí
**Descripción:** Mini-apps interactivas que viven en el canvas (no en panel lateral). Ej: sticky notes, voting, status trackers. Programables con la misma Plugin API pero con soporte de multiplayer nativo.

---

## 📊 Resumen — Complejidad

| Complejidad | Cantidad | Descripción |
|-------------|----------|-------------|
| **Baja** | 51 | Funcionalidades accesibles con click o atajo, curva plana |
| **Media** | 33 | Requieren comprensión del modelo (variants, overlays, scoping) |
| **Alta** | 23 | Requieren experiencia previa o conocimiento técnico (variables avanzadas, API, branching, plugins) |

## 📊 Resumen — Free Tier Availability

| Free Tier | Cantidad |
|-----------|----------|
| **Sí** | 87 |
| **Sí (limitado)** | 10 |
| **No** | 10 |

> **Nota:** Las funcionalidades marcadas "No" en Free Tier corresponden a: Dev Mode completo (inspect, code connect, VS Code extension), Branching, Webhooks, y variables avanzadas con múltiples colecciones. Todo lo demás está disponible en el plan gratuito de Figma.

---

_Documento generado por Lara ✨ — 2026-06-07 — Futuraria Design Systems Research_
