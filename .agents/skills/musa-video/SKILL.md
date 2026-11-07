---
name: musa-video
description: Video y motion en Musa. Animar diseños y exportarlos como reel, editar proyectos de video en timeline (pistas, clips, textos, audio, efectos), plantillas de video, escenas 3D, generar video con IA, guiones de teleprompter (Tomas) y voces clonadas (Clones IA).
module: crear/videos
---

# Video y motion · reels, timeline, tomas y clones

Hay dos formas de hacer video en Musa:

1. **Video desde un diseño (Modo Video)**: cada frame del diseño es una toma del reel. Se animan capas, se ponen transiciones, textos y música, y se exporta. Ideal para carruseles animados y reels de marca.
2. **Proyecto de video (timeline)**: editor tipo CapCut con pistas de video, audio, texto, stickers y efectos. Todo el tiempo va en microsegundos (µs). Ideal para editar material grabado.

## Flujos

**Reel desde un diseño**
1. Diseña los frames (skill `musa-diseno`); el orden de los frames es el orden del reel.
2. Lienzo: `set_video_project({ templateId, preset: "9:16" })`.
3. Animación por frame: `list_animation_presets` → `set_animation({ templateId, frameId, presetIds })`; efectos por capa con `set_layer_effect` o `apply_expression`.
4. Transiciones: `list_video_effects` → `apply_transition`. Look por toma: `set_take_effects`.
5. Textos y subtítulos: `set_video_text`. Música o voz: `set_video_audio`. Video o imagen encima: `set_video_media`. Orden y tomas: `set_video_reel`.
6. Exporta: `video_export({ templateId })` devuelve una página que renderiza el video; ábrela.

**Proyecto de timeline**
1. `video_project_create({ workspaceId, name, ratio, fps })`.
2. `video_track_add` (video, audio, text, sticker, effect).
3. `video_material_add` (el archivo o texto) → `video_segment_add({ projectId, trackId, materialId, targetStartUs, ... })`.
4. Ajusta: `video_segment_move`, `video_segment_trim`, `video_segment_transform`, `video_segment_delete`, `video_material_update`.
5. Efectos: `video_effect_apply`, `video_effect_update`, `video_effect_delete`.
6. `video_project_get` para revisar el árbol completo; `video_render({ projectId })` para renderizar.
7. Entrega el enlace: `editor_open` o `motion_project_open`.

**Motion declarativo (MotionSpec)**
- Escribe la animación como especificación: `motion_spec_validate` → `motion_project_create_from_spec` (proyecto nuevo) o `motion_frame_apply_spec` (sobre un frame de diseño).
- Cambios: `motion_project_diff_spec` → `motion_project_apply_spec`.
- Desde otro formato (HyperFrames, Remotion, Lottie, subconjuntos): `motion_source_convert`.
- Escenas 3D: mismo patrón con `scene_spec_validate`, `scene_source_convert`, `scene_project_create_from_spec`, `scene_project_diff_spec`, `scene_project_apply_spec`, `scene_project_open`.

**Plantillas de video**
- `video_template_register` marca espacios reemplazables en un proyecto; `video_template_instantiate({ projectId, slots })` crea uno nuevo rellenándolos.

**Video con IA (llave del espacio)**
- `generate_text_video({ prompt })` o `generate_image_video({ imageUrl, prompt })` → `generate_image_video_check` hasta que termine. Clips de 2 a 10 s.

**Tomas (grabación con teleprompter)**
- La IA prepara el guion: `take_script_save({ workspaceId, title, script, format })`. Graba una persona en Crear › Tomas.
- `video_takes_list` para ver lo grabado; `video_takes_download` da un enlace de 5 min; `video_takes_delete` borra al instante (destructivo, solo si lo piden).

**Clones IA (voz)**
- `list_clones({ workspaceId })`: voces y avatares ya creados.
- `voice_clone_create({ workspaceId, name, audioUrl, consent: true })` con ElevenLabs (llave del espacio). Muestra de 1 a 3 minutos y consentimiento explícito de la persona dueña de la voz.

## Herramientas

Video desde un diseño
- `set_video_project`, `set_video_reel`, `set_video_text`, `set_video_audio`, `set_video_media`, `video_export`.
- `set_animation`, `get_animation`, `list_animation_presets`, `set_layer_effect`, `apply_expression`.
- `apply_transition`, `list_video_effects`, `set_take_effects`.

Proyecto de timeline
- `video_project_create`, `video_project_list`, `video_project_get`, `video_project_delete`.
- `video_track_add`, `video_material_add`, `video_material_update`.
- `video_segment_add`, `video_segment_move`, `video_segment_trim`, `video_segment_transform`, `video_segment_delete`.
- `video_effect_apply`, `video_effect_update`, `video_effect_delete`.
- `video_template_register`, `video_template_instantiate`, `video_render`.

Motion y 3D declarativo
- `motion_spec_validate`, `motion_source_convert`, `motion_frame_apply_spec`.
- `motion_project_create_from_spec`, `motion_project_diff_spec`, `motion_project_apply_spec`, `motion_project_open`.
- `scene_spec_validate`, `scene_source_convert`, `scene_project_create_from_spec`, `scene_project_diff_spec`, `scene_project_apply_spec`, `scene_project_open`.

IA de video
- `generate_text_video`, `generate_image_video`, `generate_image_video_check`.

Tomas y clones
- `take_script_save`, `video_takes_list`, `video_takes_download`, `video_takes_delete`.
- `list_clones`, `voice_clone_create`.

## Reglas

- En el timeline todo es µs: 1 segundo = 1 000 000.
- Video y voz con IA son solo con llave propia (BYOK). Si falta, díselo a la persona.
- Nunca clones una voz sin consentimiento explícito.
- Para publicar el reel, skill `musa-redes`.

## Ejemplos

- "Convierte el carrusel de lanzamiento en un reel 9:16 con transiciones y música"
- "Escribe el guion de 45 segundos para la toma de presentación de Kuna"
- "Corta los primeros 3 segundos del clip y ponle subtítulos"
