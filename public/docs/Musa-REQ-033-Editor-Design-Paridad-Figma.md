# REQ-033 — Editor de diseño: paridad Figma progresiva sin romper Musa

**Fecha:** 2026-09-30  
**Estado:** Propuesto  
**Área:** Editor de diseño / UX / rendimiento / colaboración  
**Prioridad:** P0 para la fundación; P1 para las capacidades de diseño; P2 para colaboración y prototipado

## 1. Contexto

El editor actual funciona como un editor visual basado en HTML/CSS: permite crear frames, insertar formas y texto, editar estilos, organizar capas, aplicar efectos, importar/exportar formatos, guardar versiones y usar automatizaciones de Musa.

El objetivo de este requisito no es copiar cada producto de Figma ni reemplazar las capacidades de Musa. El objetivo es que el editor tenga una base sólida de diseño 2D y una ruta clara para acercarse a la paridad con el núcleo de Figma sin perder las capacidades de IA, MCP, motion, foto y producción de contenido.

La diferencia entre “ya funciona” y “paridad Figma” se explica por tres niveles:

1. **Acción visible:** el usuario puede crear o modificar algo.
2. **Modelo interno:** el documento conserva identidad, orden, relaciones y reglas después de editar, duplicar, importar, colaborar o deshacer.
3. **Producto de escala:** varias personas pueden trabajar, compartir librerías, mantener versiones y operar documentos grandes con rendimiento predecible.

El editor actual cubre bastante del primer nivel. El requisito completa progresivamente los niveles segundo y tercero.

## 2. Alcance

### Incluido

- Fundaciones del documento y del canvas.
- Edición de formas, texto, imágenes y frames.
- Capas, selección, agrupación, alineación y distribución.
- Auto Layout y constraints con modelo propio.
- Componentes, instancias, variantes y propiedades.
- Variables y estilos reutilizables.
- Importación y exportación con reporte de fidelidad.
- Undo/redo y versionado coherentes.
- UI responsive y accesible.
- Rendimiento medible en documentos pequeños y grandes.
- Colaboración incremental y resolución visible de conflictos.
- Prototipado como capa opcional posterior.

### No incluido en la primera entrega

- Copiar toda la interfaz de Figma.
- Replicar funcionalidades de FigJam, Slides o Dev Mode.
- Crear un nuevo motor 3D.
- Convertir todos los formatos externos a una representación 100% editable desde el primer día.
- Hacer que todos los módulos de Musa se comporten como un editor de diseño tradicional.

## 3. Estado actual verificado

### Ya funciona y debe preservarse

- Canvas infinito con pan, zoom y frames.
- Selección múltiple, marquee, movimiento, resize y duplicación.
- Formas, texto, SVG básico, imágenes y paths.
- Agrupar, desagrupar, ordenar, bloquear y ocultar capas.
- Inspector de posición, tamaño, rotación, opacidad, fills, strokes y efectos.
- Flex/Grid CSS, pseudoestados, transiciones y edición HTML/CSS.
- Tipografías, gradientes, filtros y varios efectos visuales.
- Importación de SVG, PSD, AI, PDF y FIG con limitaciones de fidelidad.
- Exportación de imágenes, SVG, PDF, tokens, CSS y design system.
- Autosave, historial de versiones, comentarios, presencia y colaboración básica.
- Integración con MCP y automatizaciones específicas de Musa.

### Limitaciones actuales relevantes

- `EditorV2.tsx` concentra más de 10.000 líneas.
- El documento depende de HTML/CSS y Shadow DOM en vez de un scene graph tipado.
- Componentes, instancias, variantes y prototipado no tienen un modelo completo.
- La sincronización transmite cambios grandes de frame y no resuelve conflictos por objeto.
- La exportación trabaja principalmente con frames seleccionados.
- El bundle inicial carga módulos pesados antes de necesitarlos.
- Hay controles y menús que no tienen semántica de accesibilidad completa.
- La experiencia móvil no expone todas las acciones importantes.

## 4. Requisitos funcionales

### RF-01 — Modelo de documento estable (P0)

Crear una representación JSON versionada para el documento:

- `Document` contiene páginas o espacios de trabajo.
- `Frame` contiene nodos hijos.
- Cada nodo tiene `id`, `type`, `name`, `parentId`, `children`, `transform`, `layout`, `paint`, `effects` y `metadata`.
- La identidad de un nodo debe sobrevivir a edición de propiedades, duplicación, undo/redo, importación y sincronización.
- HTML/CSS/SVG se generan como proyección de este modelo.
- Las ediciones manuales de HTML/CSS deben producir diagnóstico y sincronización controlada, no romper silenciosamente la identidad.

**Aceptación:** después de mover, duplicar, importar, editar código y deshacer una operación, los nodos conservan orden, identidad y selección correcta.

### RF-02 — Undo/redo transaccional (P0)

- Registrar operaciones semánticas, no snapshots completos cuando no sea necesario.
- Preservar el índice original de frames y capas.
- Agrupar cambios de una misma intención en una transacción.
- Unificar cambios del canvas, inspector y código.
- Mostrar descripción de la operación.
- Persistir historial de versión sin confundirlo con undo local.

**Aceptación:** undo/redo restaura exactamente geometría, estilos, orden, selección y relaciones.

### RF-03 — Canvas y selección (P0)

- Mantener pan y zoom actuales.
- Añadir snapping configurable, guías inteligentes y mediciones entre objetos.
- Añadir navegación y edición con teclado.
- Soportar selección por caja, selección profunda, selección de grupo y selección de instancia.
- Virtualizar frames fuera del viewport en documentos grandes.
- Mantener hit testing estable sin consultar todo el DOM en cada movimiento.

**Aceptación:** un documento de 200 frames mantiene interacción fluida y selección determinista.

### RF-04 — Auto Layout y constraints (P1)

Implementar un modelo independiente de CSS para:

- Dirección horizontal/vertical.
- Padding por eje.
- Gap.
- Alineación principal y cruzada.
- Hug contents, fixed y fill container.
- Min/max width y height.
- Wrap.
- Posicionamiento absoluto dentro de Auto Layout.
- Constraints de resizing y pins.
- Preview responsive del frame.

**Aceptación:** cambiar el tamaño del frame conserva el comportamiento esperado sin depender de hacks CSS.

### RF-05 — Componentes e instancias (P1)

- Crear componente desde una selección.
- Crear instancia.
- Swap y detach.
- Overrides controlados.
- Componentes anidados.
- Variants.
- Propiedades boolean, texto, número e instance swap.
- Librería local con publicación, actualización y usage tracking.

**Aceptación:** actualizar un master actualiza sus instancias sin sobrescribir overrides válidos.

### RF-06 — Variables y estilos (P1)

- Collections y modes.
- Variables de color, número, string y boolean.
- Alias entre variables.
- Scopes y bindings.
- Color, text, effect y grid styles.
- Detach y uso rastreable.
- Exportación de tokens con referencia a variables.

**Aceptación:** cambiar un mode actualiza todos los nodos vinculados y permite previsualizar temas.

### RF-07 — Vectores, máscaras e imágenes (P1)

- Edición de nodos y handles robusta.
- Stroke caps, joins, dashes y perfiles.
- Compound paths y fill rules.
- Booleanos deterministas.
- Máscaras explícitas con edición, desactivación y restauración.
- Crop no destructivo, image fill y ajustes básicos.
- Reporte de rasterización durante importación.

**Aceptación:** una operación vectorial conserva posición, fill, stroke y orden; una importación informa qué quedó editable y qué quedó rasterizado.

### RF-08 — Importación y exportación (P1)

- Exportar selección, frame actual, todos los frames y página completa.
- Presets de escala y formato.
- Exportar assets relacionados.
- Mostrar advertencias de fidelidad.
- Pruebas de round-trip para SVG, PDF, PSD, AI y FIG cuando el formato lo permita.
- Mantener metadata de origen cuando no se pueda conservar edición completa.

### RF-09 — UI, responsive y accesibilidad (P0)

- Menús con roles, foco, Escape y navegación por teclado.
- Toolbar con nombres accesibles y estados anunciables.
- Árbol de capas con navegación por flechas, roving tabindex y estados de lock/hide.
- Canvas con foco, selección anunciada y alternativas de teclado.
- Indicador visible de modo, herramienta, guardado, offline y conflicto.
- Mobile action sheet que exponga video, foto, exportar, compartir y comentarios.
- Usar `100dvh`, safe areas y comportamiento correcto con teclado móvil.
- Tamaño mínimo de targets táctiles de 40–44 px.
- Reducir `backdrop-filter` en superficies grandes y reemplazar `transition: all` por propiedades concretas.

**Aceptación:** completar el flujo crear-seleccionar-editar-guardar-exportar con mouse, teclado y viewport móvil.

### RF-10 — Colaboración y sincronización (P2)

- Presencia de usuarios, cursores y selección.
- Operaciones por objeto o lotes pequeños.
- Cola offline.
- Detección de conflicto.
- Vista de diferencias y recuperación.
- Comentarios con threads, menciones, resolución y permisos.
- Atribución de cambios y restauración por versión.

**Aceptación:** dos usuarios pueden editar objetos distintos sin perder cambios y reciben una resolución visible cuando editan el mismo objeto.

### RF-11 — Prototipado (P2)

- Conexiones entre frames.
- Triggers y acciones.
- Overlays.
- Scroll position.
- Transiciones.
- Flows y preview compartible.

La capa de prototipado debe ser opcional para no aumentar la carga inicial del editor de diseño.

### RF-12 — Rendimiento (P0)

- Code splitting por modo y feature.
- Carga diferida de Monaco, importadores, IA, video, foto, PDF y transformers.
- Presupuesto de bundle inicial definido.
- Virtualización de frames y paneles.
- Memoización por selección y por frame.
- Spatial index o caché de geometría para hit testing.
- Métricas de LCP, INP, FPS, memoria, autosave e import/export.

**Objetivos iniciales:**

- Editor interactivo en menos de 3 segundos en un equipo de referencia.
- Selección/movimiento con al menos 55 FPS en 50 frames visibles.
- Sin caída prolongada de interacción en un documento de 200 frames.
- Chunks iniciales por debajo de 500 KB comprimidos cuando sea viable.

## 5. Plan de entrega

### Fase 0 — Fundación y seguridad de cambios

1. Crear scene graph y adaptador HTML/CSS.
2. Corregir undo/redo y orden.
3. Dividir EditorV2 por dominios.
4. Añadir métricas de rendimiento.
5. Corregir mobile, foco y semántica de menús.
6. Añadir pruebas E2E del flujo principal.

### Fase 1 — Editor de diseño sólido

1. Auto Layout propio.
2. Constraints.
3. Vectores y máscaras.
4. Variables y estilos.
5. Componentes e instancias.
6. Exportación/importación con reporte de fidelidad.

### Fase 2 — Colaboración y prototipado

1. Sincronización por operaciones.
2. Conflictos y offline.
3. Comentarios y permisos.
4. Prototyping graph.
5. Preview compartible.

## 6. Pruebas obligatorias

- Crear, seleccionar, mover, resize, rotar, agrupar, desagrupar, bloquear y ocultar.
- Undo/redo conservando orden.
- Editar HTML/CSS con error y recuperación.
- Auto Layout y responsive resize.
- Component master/instance/override.
- Variable mode switch.
- Vector boolean/mask.
- Importación con reporte editable/raster.
- Exportación de selección, frame y lote.
- Autosave, reload, offline y conflicto.
- Flujo completo con teclado.
- Flujo completo en móvil.
- Screen reader smoke test.
- Visual regression en desktop, tablet y mobile.
- Documento grande con métricas de FPS y memoria.

## 7. Definición de terminado

Una fase se considera terminada cuando:

- El comportamiento está implementado en el modelo de documento.
- Existe al menos una prueba funcional y una prueba visual para cada flujo crítico.
- El cambio no aumenta el bundle inicial por encima del presupuesto acordado.
- La UI funciona con teclado y en viewport móvil cuando aplique.
- La importación/exportación informa sus límites.
- El autosave, undo/redo y versionado fueron verificados.
- La documentación de capacidades coincide con el código.

## 8. Decisión de producto

No se debe medir el éxito preguntando si “se parece a Figma” en una captura. Se debe medir si el editor conserva correctamente identidad, relaciones, edición, colaboración y rendimiento a medida que el documento crece.

Musa puede diferenciarse manteniendo su integración con IA, MCP, copywriting, motion, foto, CRM y automatización. La paridad de Figma debe concentrarse en el núcleo de edición y en los comportamientos que los usuarios esperan de una herramienta profesional.
