# REQ-035 — Editor de video de Musa: UX, timeline y render confiable

**Fecha:** 2026-09-30  
**Estado:** Propuesto  
**Área:** Editor de video / Motion / Render / UX  
**Prioridad:** P0 para entrada, edición básica y exportación; P1 para audio, captions y colaboración; P2 para capacidades avanzadas de NLE

## 1. Decisión de producto

El Modo Video de Musa debe ser un editor de reels basado en diseños, con una experiencia clara para crear, animar, montar y exportar una pieza. Hoy funciona como un compositor determinista de frames, capas, clips multimedia, textos, audio, transiciones y efectos. No debe presentarse como un clon completo de Premiere o CapCut hasta que existan las garantías de edición, persistencia y render que exige un NLE.

El objetivo de esta entrega es que una persona pueda responder sin documentación externa:

1. ¿Cómo entro al modo video?
2. ¿Qué representa cada pista?
3. ¿Qué clip está seleccionado y qué puedo cambiar?
4. ¿Qué ocurrirá al exportar?
5. ¿Dónde quedó guardado el cambio y cómo lo deshago?

## 2. Estado actual verificado

### 2.1 Lo que ya existe y se debe conservar

- Entrada persistente **Video** en la barra superior de `EditorV2`.
- Overlay de cuatro zonas: biblioteca de medios, player, inspector y timeline.
- Pista V1 de tomas, filas de capas, filas de media, texto y audio.
- Reordenamiento de tomas, trim, drag, snapping y playhead.
- Animación por keyframes de transform, escala, rotación y opacidad.
- Transiciones, efectos de capa, looks/filtros y animaciones de texto.
- Upload de video, imágenes, música y grabación de voz en off.
- Assets del workspace como recursos multimedia.
- Detección de beats para marcadores.
- Exportación WebM/MP4 en el navegador y publicación de una URL.
- Adaptación al formato del proyecto y acción para rellenar tomas con letterbox.
- Generación de video desde imagen o texto desde el editor de diseño.

### 2.2 Fuentes revisadas

- `src/pages/EditorV2.tsx`: entrada del modo y montaje del overlay.
- `src/components/VideoModeOverlay.tsx`: composición de la UI, player, transport y export.
- `src/components/video/VideoTimeline.tsx`: pistas, drag, trim, snapping y atajos.
- `src/components/video/VideoInspector.tsx`: settings, keyframes, media, texto, audio y export.
- `src/components/video/VideoMediaPanel.tsx`: tomas, media, música, voz en off y recursos.
- `src/components/video/FxLibraryPanel.tsx`: transiciones, efectos, filtros y texto.
- `src/lib/videoTimelineDoc.ts`: documento de timeline.
- `src/lib/videoExport.ts`: WebCodecs y fallback MediaRecorder.

## 3. Hallazgos de la revisión

### P0 — La entrada y el estado del modo todavía no son suficientemente obvios

- El modo reemplaza el canvas y conserva la top bar, pero no muestra un encabezado de proyecto persistente con estado de guardado, cambios pendientes, resolución, FPS y nombre del reel.
- La acción **Volver al diseño** es pequeña y queda dentro de una barra de 6 px de padding; debe ser una salida inequívoca y accesible.
- En el dogfood previo, la apertura del modo no fue evidente a la primera interacción cuando no había una toma seleccionada. Debe existir una prueba automatizada de “un click en Video abre el editor” con cero dependencia de selección previa.
- La pantalla vacía y la pantalla sin selección solo muestran mensajes de texto pequeños. Deben incluir una acción principal guiada.

### P0 — La timeline tiene muchas capacidades, pero no explica su modelo

- Las filas tienen alturas de 20–46 px y controles de 10 px (`VideoTimeline.tsx`); con varias capas la lectura se vuelve densa.
- Los nombres V1, L, M, T y A son útiles para implementación, pero no son suficientes para una persona que no conoce el modelo interno.
- No hay modo visible de edición **ripple / overwrite / insert**, ni indicación de si mover una toma desplaza las demás.
- La selección es de un clip por vez (`TimelineSelection`); no hay selección múltiple, rango, lasso ni edición de grupo.
- Existen move/trim, pero no slip, slide, roll, freeze frame, speed ramp ni control de duración con timecode editable en el timeline.
- El zoom es numérico y el timeline no muestra fit-to-content, minimap, scroll automático al playhead ni entrada de timecode.
- Los atajos se muestran como texto en el transport, pero no hay ayuda contextual, mapa completo de comandos ni garantía de foco cuando el usuario está escribiendo en un input.

### P0 — La previsualización y el render pueden divergir

- El player aplica cambios mutando el DOM y consultando selectores de capas durante cada tick; el exportador vuelve a dibujar en canvas/WebCodecs. Son dos rutas de render que pueden producir diferencias de fuente, CSS, filtros, z-index, video y transiciones.
- `innerHTML`, estilos directos y consultas `[data-layer-id]` hacen difícil garantizar paridad cuando un diseño contiene CSS complejo o muchas capas.
- MP4 depende de los codecs disponibles en el navegador y WebM usa WebCodecs/MediaRecorder según el fallback. El usuario necesita ver compatibilidad antes de comenzar, no descubrirla al final.
- El render se ejecuta 100% en el navegador. No hay cola persistente, reanudación, cancelación real, recuperación después de cerrar la pestaña ni job id para soporte.
- La UI muestra progreso, pero no expone tiempo estimado, etapa actual, tamaño aproximado, codec ni un resultado verificable antes de descargar.

### P1 — Audio y media son funcionales, pero no tienen herramientas de edición suficientes

- Hay volumen, fade in/out y detección de beats, pero no se muestra waveform ni envolvente de volumen.
- No hay crossfade entre clips, ducking de voz, mute/solo por pista, normalización, monitorización de niveles ni mezcla por bus.
- El bin permite subir archivos y recursos, pero no muestra duración, codec, dimensiones, progreso de upload, cancelación, relink de archivos ni proxies.
- Los clips de video se colocan como overlays libres; falta un source monitor para marcar in/out antes de insertarlos.

### P1 — Texto y captions requieren un flujo editorial completo

- El track T soporta texto, stickers y animaciones predefinidas, pero no importación/exportación SRT/VTT, estilos globales de captions, safe areas, RTL, revisión de overflow ni sincronización por palabras.
- La biblioteca usa etiquetas abreviadas como `Transic.` y muchos botones de 9–10 px. Esto reduce descubribilidad y accesibilidad.

### P1 — Persistencia, undo y colaboración no tienen una transacción de video clara

- La animación de frames y el documento `videoTimelineDoc` se actualizan mediante callbacks separados. Se debe garantizar que mover un clip, cambiar una propiedad y editar audio formen operaciones atómicas y reversibles.
- No hay estado visible de guardado, historial de versiones del reel, restauración de una versión ni conflicto de edición por pista.
- Los favoritos de FX se guardan en `localStorage` (`futuraria.favFx`), por lo que no siguen al usuario entre dispositivos ni son compartidos por workspace.

### P1 — Accesibilidad y responsive

- La UI depende de iconos, emojis, `title` y controles muy pequeños; faltan labels visibles, `aria-label`, foco consistente, navegación completa por teclado y anuncios para lector de pantalla.
- El layout fijo de biblioteca + player + inspector + timeline no presenta una estrategia clara para ventanas estrechas ni para ocultar/agrandar paneles.

### P2 — Capacidades avanzadas que no deben bloquear el núcleo

- Graph editor de curvas, motion paths, máscaras, tracking, chroma key, color wheels, scopes, nested sequences, multicam, 3D, plugins de efectos y render distribuido.
- Estas capacidades se pueden planificar después de estabilizar el modelo de timeline, el render y la persistencia.

## 4. Requisitos funcionales

### RF-01 — Entrada y orientación del modo (P0)

- Un click en **Video** abre el modo independientemente del frame seleccionado.
- El modo muestra nombre del proyecto, estado guardado/sin guardar, duración, FPS, resolución, formato de salida y botón de salida.
- La primera visita incluye una ayuda de 3 pasos: biblioteca, player/inspector y timeline.
- Los estados vacío, sin selección, procesando y error tienen una acción principal clara.

### RF-02 — Documento de proyecto explícito (P0)

Definir una única fuente de verdad para:

- `project`: width, height, preset, FPS y fondo.
- `takes` y orden del reel.
- `layers`, `media`, `text`, `audio`, markers y transitions.
- metadatos de render y versión del documento.

Cada mutación debe producir un patch/command identificable y compatible con undo/redo.

### RF-03 — Timeline legible y consistente (P0)

- Etiquetas completas de pistas y leyenda visible.
- Herramientas de selección, snapping, trim y reorder con feedback durante el drag.
- Modos de edición explícitos: ripple, overwrite e insert.
- Multi-select, selección de rango, duplicar, cortar, pegar y borrar con confirmación cuando corresponda.
- Zoom, fit-to-content, timecode, scroll-to-playhead y minimap.
- Atajos con foco seguro, ayuda contextual y equivalentes accesibles.

### RF-04 — Player y timeline con contrato de tiempo único (P0)

- Player, timeline, inspector y exportador deben consumir la misma función de muestreo.
- Añadir una prueba de paridad que compare capturas del player y frames exportados para tomas, capas, texto, media, filtros y transiciones.
- Marcar incompatibilidades de codec, fuente o filtro antes de exportar.

### RF-05 — Render y exportación confiables (P0)

- Mostrar codec seleccionado, compatibilidad, resolución, FPS, audio y tamaño estimado.
- Progreso por etapa: preparación, render, audio, mux, upload y finalización.
- Cancelación real, descarga reintentable y reporte de error accionable.
- Crear un `renderJobId`, conservar el resultado temporal y permitir reanudar cuando la plataforma lo soporte.
- Mantener WebCodecs/MediaRecorder como fallback, pero registrar cuál ruta se usó.

### RF-06 — Audio y media operables (P1)

- Waveform, mute/solo, volumen por clip y pista, fades visuales y crossfade.
- Metadatos, upload con progreso, cancelación, relink y validación de CORS/codec.
- Source monitor con in/out y preview antes de insertar.

### RF-07 — Captions y texto (P1)

- Importar/exportar SRT y VTT.
- Safe area, overflow warnings, estilos globales y animaciones consistentes.
- Soporte de idiomas, RTL y sincronización de palabras como fase posterior.

### RF-08 — Persistencia, undo y colaboración (P1)

- Guardado automático con indicador y recuperación después de recarga.
- Undo/redo por operación semántica, no por cada pixel del pointermove.
- Historial de versiones y restauración.
- Actualizaciones colaborativas por patches con detección de conflicto.
- Favoritos de FX persistentes en workspace y opcionalmente por usuario.

### RF-09 — Accesibilidad y responsive (P0)

- Labels visibles o `aria-label` para todos los iconos.
- Foco visible, orden lógico, navegación de teclado y mensajes de estado.
- Controles táctiles de mínimo 44 px en superficies principales.
- Paneles colapsables/redimensionables y layout usable desde 1024 px de ancho.

### RF-10 — Observabilidad de rendimiento (P1)

- Medir FPS del preview, tiempo de commit, número de capas, tamaño del documento y duración del render.
- Evitar reconstruir HTML/CSS de todas las tomas en cada tick.
- Virtualizar filas y thumbnails cuando el proyecto supere un umbral definido.
- Registrar errores de codec, audio y CORS con un código que la UI pueda explicar.

## 5. Plan de entrega

### Fase 0 — Correcciones inmediatas

1. Apertura con un click, salida clara y estado de guardado.
2. Etiquetas de pistas y controles legibles.
3. Leyenda y ayuda de atajos.
4. Compatibilidad de exportación antes de renderizar.
5. Tests de regresión para abrir, seleccionar, mover, trim, reproducir y exportar.

### Fase 1 — Núcleo confiable

1. Documento único y commands undo/redo.
2. Contrato de muestreo compartido por preview y export.
3. Render job con cancelación, reintento y resultado verificable.
4. Audio/media con waveform, metadatos y source monitor.
5. Accesibilidad y responsive.

### Fase 2 — Productividad

1. Multi-select, ripple/overwrite/insert, slip/slide/roll.
2. Captions SRT/VTT y safe areas.
3. Historial de versiones y colaboración por patches.
4. Performance para proyectos grandes.

### Fase 3 — NLE avanzado

Curvas, motion paths, máscaras, tracking, scopes, nested sequences, multicam y herramientas de color.

## 6. Criterios de aceptación

- Una persona nueva abre Video, importa una media, la coloca en timeline, ajusta duración, añade texto/audio, reproduce y exporta sin leer el código.
- La acción se puede realizar solo con teclado y foco visible.
- El frame mostrado en el player y el frame exportado coinciden dentro de una tolerancia documentada.
- Un fallo de codec, CORS o audio explica qué ocurrió y ofrece una salida.
- Recargar el editor conserva el documento y permite deshacer la última operación.
- Un proyecto con 20 tomas, 30 capas, 5 clips de media y 3 audios mantiene una interacción fluida definida por una métrica de FPS/latencia.
- La interfaz sigue siendo utilizable a 1024 px de ancho y con lector de pantalla.

## 7. Fuera de alcance de esta entrega

- Clonar toda la superficie de Premiere/CapCut.
- Render server-side obligatorio para cada export.
- Tracking, 3D, color grading avanzado o marketplace de plugins antes de estabilizar el núcleo.

