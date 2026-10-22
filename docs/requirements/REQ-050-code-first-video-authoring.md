# REQ-050 — Video code-first: generar por MCP, previsualizar, editar y exportar

Fecha: 2026-10-21 · Estado: **fase 1 implementada localmente; requiere migración v75 y deploy** · Prioridad: P1 · Origen: solicitud de Ren tras revisar el editor standalone y sus herramientas MCP.

## Avance de fase 1

- El proyecto standalone presenta imágenes y video reales en el monitor,
  reproduce/pausa el timeline, sincroniza el audio y aplica trim, velocidad y
  transform del clip en la preview.
- La persona puede descargar un WebM desde el editor. El export usa el encoder
  existente del Video Mode y compone el mismo documento con medios, texto,
  audio y transformaciones.
- MCP acepta `image` como material visual; la migración v75 amplía el CHECK de
  la base de datos. Las herramientas existentes `video_project_create`,
  `video_material_add`, `video_segment_add` y `video_effect_apply` siguen
  siendo la API code-first para crear el proyecto que luego abre la persona.
- `video_render` de servidor sigue fuera de esta fase: el render se hace en el
  navegador de quien abre el editor, igual que el exportador ya utilizado por
  el Video Mode. Un job remoto con estado/URL permanece como trabajo futuro.

## 1. Objetivo

Una IA debe poder construir un proyecto de video mediante código/MCP, abrirlo
en el editor y entregarlo a una persona para que lo previsualice, modifique y
exporte. El proyecto debe seguir siendo un proyecto de edición real: clips,
capas, keyframes, texto, audio, efectos y tiempos son editables por separado.

La IA y la persona trabajan sobre **el mismo proyecto persistido**. La edición
humana posterior no requiere regenerar el video completo ni queda reemplazada
por una nueva ejecución del código generador.

## 2. Problema original y evidencia

Antes de esta fase, el módulo standalone VID10–VID14 ya permitía crear proyectos, pistas, materiales,
segmentos, texto, efectos y plantillas por MCP. La UI tiene timeline, selección,
trim, movimiento, velocidad y edición de propiedades. Sin embargo, el ciclo de
trabajo solicitado no está completo:

1. `src/components/video/VideoPreview.tsx` pinta los materiales `video`/`image`
   como rectángulos con el nombre de archivo; no decodifica ni muestra el medio.
2. La preview no tiene reproducción continua. Cambia al mover el playhead.
3. La pista `audio` se excluye de la preview y no se oye.
4. La página standalone no tiene una acción de exportación funcional.
5. La tool `video_render` responde `RENDER_PENDING`; REQ-VID10 deja el render
   como dependencia futura de VID1–VID5.
6. El importador CapCut marca las rutas locales como pendientes de Storage; una
   ruta local no se convierte por sí sola en un asset accesible por el editor.

Referencias: `src/components/video/VideoPreview.tsx`,
`src/pages/VideoProjectEditor.tsx`, `netlify/functions/mcp.mjs` (caso
`video_render`) y `docs/requirements/REQ-VID10-video-capcut-model.md`.

## 3. Experiencia requerida

1. La IA crea o actualiza un proyecto a partir de una especificación declarativa
   de timeline mediante MCP/código. Puede incluir medios subidos o assets
   generados por código (por ejemplo SVG, formas, texto y animaciones).
2. La IA devuelve el ID/enlace del proyecto y la persona lo abre en el editor
   standalone.
3. La persona ve los medios reales en el monitor, reproduce y busca en el
   tiempo, escucha el audio y modifica los mismos clips/capas en el timeline.
4. La persona guarda y exporta desde la UI. La IA puede solicitar un render por
   MCP y obtener un estado consultable y el asset resultante.
5. Al reabrir el proyecto, los cambios humanos permanecen y la preview/export
   corresponde al estado guardado.

## 4. Alcance funcional

### F1 — Especificación code-first

- Definir un formato versionado y validado para describir proyecto, canvas,
  fps, clips, pistas, materiales, transformaciones, audio, texto, keyframes y
  efectos. Reusar `musa_video_*` y los validadores de
  `api/src/services/videoProjects.ts`; no crear un segundo modelo persistente.
- Exponer una operación MCP de alto nivel para crear/aplicar esa especificación
  con validación completa y errores accionables. Las operaciones repetidas con
  el mismo ID deben actualizar o reconciliar el proyecto, no duplicar filas.
- Permitir material generado por código de forma reproducible, con salida
  independiente editable (mínimo SVG y elementos de texto/vector). No ejecutar
  código arbitrario con acceso al DOM, red, credenciales ni filesystem. Si se
  acepta una fuente ejecutable, debe correr aislada, con límites y un contrato
  de entrada/salida versionado.
- Soportar medios externos solo cuando el servidor pueda leerlos de forma
  estable. Para archivos locales, ofrecer carga a Storage y reemplazar la ruta
  local por una URL persistente antes de considerar completa la generación.

### F2 — Preview real y reproducción

- Renderizar imágenes y video desde los materiales del proyecto en su tiempo de
  source correcto, con trim, velocidad, transformación, orden de pistas y
  efectos compatibles.
- Reproducir/pausar, seek, avanzar por frame y mostrar duración/playhead. El
  audio debe sincronizarse y respetar trim, velocidad cuando aplique, volumen y
  fades soportados.
- Mantener edición directa en el monitor para los objetos editables. El estado
  visual y la posición seleccionada deben corresponder al clip activo.
- El preview debe seguir disponible en desktop y móvil, con gestos/controles
  adecuados al viewport.

### F3 — Render y exportación

- Implementar `video_render` para el proyecto standalone. Debe informar estado
  (`queued/running/completed/failed`), progreso cuando exista, errores claros y
  una URL verificable al completar.
- La exportación desde UI y MCP debe renderizar el mismo documento y compartir
  el mismo sampler/render core. El archivo debe incluir medios, texto,
  transformaciones, keyframes, efectos y audio dentro del alcance soportado;
  no debe degradarse silenciosamente a slideshow.
- Publicar los formatos/resoluciones/codec realmente soportados. Si el
  navegador no puede producir una combinación solicitada, fallar antes de
  empezar con un mensaje que sugiera opciones válidas.
- Render determinista: seek y export en el mismo timestamp producen la misma
  composición visual, con tolerancia definida para codecs con pérdida.

### F4 — Persistencia y edición compartida

- MCP y UI actualizan las mismas tablas `musa_video_*` con las reglas de
  `REQ-VID10` (tiempos en µs, referencias por ID y reglas de audio/trim/speed).
- Las mutaciones de UI siguen autosave, undo/redo y reconciliación existentes.
  La generación inicial no debe saltarse el historial ni dejar una preview
  diferente del documento persistido.
- La persona puede modificar, mover, recortar, reemplazar o borrar los clips y
  ajustar texto/efectos compatibles sin editar el código fuente generado.
- Guardar el código/especificación de origen como metadata/version vinculada
  (opcional para proyectos creados manualmente); re-generar solo mediante una
  acción explícita y con diff/revisión antes de aplicar cambios que afecten
  ediciones humanas.

## 5. Criterios de aceptación

1. Un flujo MCP crea un proyecto con un SVG generado por código, dos clips de
   video, un clip de texto con keyframes y audio; el ID abre el proyecto en la
   UI sin pasos manuales de DB.
2. La preview muestra el SVG y los frames reales de los videos en el monitor;
   play/pause, seek, trim y speed actualizan la imagen y mantienen sincronía.
3. El audio se oye durante reproducción y respeta sus límites en la timeline.
4. La persona mueve un clip, cambia un texto y recorta el audio; guarda, recarga
   el proyecto y los cambios siguen presentes.
5. Una exportación UI y una solicitud MCP del mismo estado generan archivos con
   duración, resolución y pistas esperadas. El render no es un slideshow de
   frames estáticos.
6. Capturas del preview en timestamps acordados coinciden con los frames del
   archivo exportado dentro de la tolerancia documentada.
7. Una URL de medio inválida, una ruta local sin subir o una especificación
   inválida produce un error visible y accionable; no deja un proyecto que
   aparente estar listo.
8. El trabajo funciona en 390px móvil y desktop, y no expone tokens, secretos,
   filesystem ni APIs no permitidas al material generado.

## 6. QA requerido

- Unit: normalización/versionado de especificación, conversión de unidades,
  duración, keyframes, trim/speed, asignación de pistas, y casos inválidos.
- Integración: MCP → tablas → REST/UI → reload → MCP get, verificando igualdad
  del árbol y ausencia de duplicados en reintentos.
- E2E navegador: importar/crear medios, preview real, reproducción, seek, audio,
  edición, autosave, undo/redo, reload y export.
- Render parity: comparar frames de preview/export en principio, centro,
  bordes de clips, transiciones y final; verificar duración y audio.
- Usar un fixture con video, imagen, audio, SVG generado, texto, al menos dos
  pistas superpuestas y efectos; el fixture vacío actual no es evidencia
  suficiente para aprobar la fase.

## 7. Dependencias y límites

- Depende de completar playback/render standalone (VID1–VID5 según REQ-VID10)
  y cerrar la subida de medios locales a Storage.
- Reusar o extraer el motor del Video Mode basado en templates solo si su modelo
  y su sampler pueden representar de forma fiel el timeline standalone; no
  simular compatibilidad convirtiendo el proyecto en una secuencia de frames.
- Esta solicitud cubre la ruta web de autoría y export. No exige render server-side
  ni generación de footage con IA externa.
- Los formatos finales y límites por tamaño/duración deben fijarse tras una
  prueba de codecs/navegadores soportados; el producto debe comunicar esos
  límites antes de que la persona comience un render.
