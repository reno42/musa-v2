---
name: musa-video
description: Video y motion en Musa. El video es código y el código es video (HTML + GSAP compatible con HyperFrames, Remotion o JSON, ida y vuelta con el editor), animar diseños y exportarlos como reel, editar proyectos de video en timeline (pistas, clips, textos, audio, efectos), plantillas de video, escenas 3D, generar video con IA, guiones de teleprompter (Tomas) y voces clonadas (Clones IA).
module: crear/videos
---

# Video y motion · reels, timeline, tomas y clones

**Regla de oro: el video es código y el código es video.** Todo proyecto de video se lee y se escribe como código (`video_code_get` / `video_code_apply`) y se edita con arrastrar y soltar en el editor; las dos cosas son lo mismo. Lo que hagas por código lo ve la persona en el editor y lo que ella haga en el editor lo lees como código.

Hay dos formas de hacer video en Musa:

1. **Video desde un diseño (Modo Video)**: cada frame del diseño es una toma del reel. Se animan capas, se ponen transiciones, textos y música, y se exporta. Ideal para carruseles animados y reels de marca.
2. **Proyecto de video (timeline)**: editor tipo CapCut con pistas de video, audio, texto, stickers y efectos. Todo el tiempo va en microsegundos (µs). Ideal para editar material grabado.

## Flujos

**Video como código (lo recomendado para crear y editar)**
1. Crear: escribe el video como HTML + GSAP (formato HyperFrames) y llama `video_project_create_from_code({ workspaceId, code, name })`. También acepta Remotion (TSX/JSX) o HTML con CSS/anime.js; ese código se ejecuta en el navegador al abrir `editorUrl` (`needsEditor: true`) y queda editable.
2. Leer: `video_code_get({ projectId, format: "html" | "remotion" | "json" })` devuelve el video completo: cada clip es un elemento con `data-start`/`data-duration` (textos `.t`, formas/imágenes/vectores `.m`, tomas `.v1`, audio `<audio>`) y su movimiento está en un bloque `// ▸ id … // ◂ id` con `tl.set` / `tl.to` / `tl.fromTo`.
3. Cambiar: edita ese código (texto, estilos `left/top/font-size/color/background`, tiempos, agrega o borra clips, reescribe los tweens de un bloque) y mándalo con `video_code_apply({ projectId, code })`. Lo que no toques vuelve exacto desde `data-musa`; en el bloque que cambies manda tu GSAP.
4. Formato mínimo de un clip nuevo: `<div class="clip" data-start="1" data-duration="3"><div id="t-titulo" class="t" style="left:50%;top:40%;font-size:96px;font-weight:800;color:#fff">Hola</div></div>` (posición = centro en %; media: `class="m"` con `width:%`, `aspect-ratio` y `background`, o un `<svg>` adentro). Movimiento: `tl.fromTo("#t-titulo", { y: 120, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: "power3.out" }, 1)` (x/y en px desde su lugar, scale, rotation, opacity, filter blur).
5. El HTML se reproduce solo en cualquier navegador y se renderiza con HyperFrames (`npx hyperframes render`). La persona también puede abrir el panel «</> Código» del editor, pegar código con Ctrl+V o usar Crear › Videos › «Desde código».

**3D y código vivo (Three.js, React Three Fiber, p5.js, PixiJS, WebGL, canvas, Lottie)**
Lo que se dibuja en un `<canvas>` no se convierte en imagen fija: entra como **clip de código vivo** (pista M) que corre su código cuadro a cuadro y queda editable. Sirve tal cual el código que hacen las skills de video de cualquier IA (HyperFrames, Remotion, onetake).
1. Agregar a un video: `video_live_add({ projectId, code, start, duration, width, params, keyframes, scene })`. `code` puede ser HTML completo, JS suelto (`import * as THREE from "three"` funciona: Musa pone el import map) o Remotion TSX con `<ThreeCanvas>` de `@remotion/three`. Devuelve los parámetros que encontró.
2. Un video entero desde código 3D: `video_project_create_from_code` / `video_code_apply` con HTML que tenga un `<canvas>`: los textos y formas del HTML quedan como clips sueltos y el canvas como clip vivo.
3. Tiempo (cómo Musa pide cada cuadro): `hf-seek` con `e.detail.time` y `waitUntil` (HyperFrames), `window.__seek(t)` + `__ready` + `__meta {dur,fps,w,h}` (onetake), timelines GSAP en `window.__timelines`, `useCurrentFrame()` (Remotion) o un loop normal de `requestAnimationFrame` / `renderer.setAnimationLoop` / `draw()` de p5 (se avanza cuadro a cuadro; `performance.now`, `Date.now` y `Math.random` son deterministas). Lo mejor: dibujar en función del tiempo (`t`), no del cuadro anterior.
4. Para que sea editable sin tocar el código:
   - Pon los valores ajustables en un objeto `const params = { speed: 1, color: "#ff5e00", size: 1.6 }` (también `config`, `settings`, `options`, `controls`, `theme` o un objeto marcado con `// @musa`) y **léelos en cada cuadro**: así se cambian en el inspector y se animan con keyframes. Las constantes en MAYÚSCULAS (`const COUNT = 4000`), los `defaultProps` de `<Composition>` y los rangos de `lil-gui` (`gui.add(params, "speed", 0, 5)`) también aparecen.
   - Crea los objetos de Three.js con variable (`const cube = new THREE.Mesh(...)`, luces, cámara) y ponles `name` (`cube.name = "Cubo"`). Musa lee el código sin ejecutarlo y sabe de dónde sale cada valor: posición, giro, escala, color, emisivo, opacidad, intensidad, FOV y visible.
   - En React Three Fiber (Remotion con `<ThreeCanvas>`, `@react-three/fiber` con `<Canvas>`) cada elemento 3D del JSX es un objeto editable: `<mesh name="Nudo" position={[0, 0.5, 0]} rotation={[0.5, 0, 0]} scale={1.4}>` con su material hijo (`<meshStandardMaterial color="#ff5e00" />`), las luces (`<directionalLight position={[3, 4, 5]} intensity={2} />`) y la cámara de `<ThreeCanvas camera={{ position: [0, 0, 6], fov: 40 }}>`. Usa arreglos de literales y `name="…"`; lo que dependa de `frame` lo calcula el código (ajuste en el bloque).
   - Fondo transparente (`new THREE.WebGLRenderer({ alpha: true })`, sin color de fondo) si el clip va encima de otras capas.
5. **El código manda y se sincroniza solo (sin IA):** cada cambio del inspector o de `video_live_update` se escribe en el código del clip al instante, y lo que se escriba en el código vuelve a ser editable.
   - Valor fijo de un parámetro → su literal (`speed: 1` → `speed: 2`).
   - Propiedad 3D escrita en el código (`mode: "code"`) → se reescribe en su lugar (`cube.position.set(1.5, 0, 0)`, `color: 0xff5e00`, `new THREE.DirectionalLight(0xffffff, 2)`, giros como `45 * Math.PI / 180`). Si sale de un parámetro (`mode: "param"`, p. ej. `color: params.color`) se cambia el parámetro. Si el código no la escribe (`mode: "add"`) se agrega una línea después de crear el objeto (en JSX, un atributo nuevo: `position={[0, 0.8, 0]}`, `color="#2244ff"` en el material, `camera={{ position: [0, 0, 8] }}`).
   - Lo que el código calcula en cada cuadro (`mode: "offset"`, p. ej. `cube.rotation.y = t * speed`) y todos los keyframes van al **bloque `▸ musa`**: un comentario con JSON al inicio del `<script>` (o del archivo). Ahí un ajuste de posición/giro se suma, el de escala/opacidad/intensidad multiplica y el de color/visible/FOV reemplaza. Keyframes: `"o:n:Cubo|ry": [[0, 0], [2, 180, "smooth"]]` = [segundo del clip, valor, curva lin|smooth|in|out|hold]. Se puede editar a mano; borrarlo quita los ajustes.
   - Leer antes de escribir: `video_live_get({ projectId })` devuelve el código (la fuente de verdad), `params` (valor en el código, keyframes), `objects` (variable, name y por propiedad `mode` + `value`) y `block`. Si reescribes el código entero con `code`, parte del que devuelve `video_live_get` para no perder lo que la persona cambió en el inspector.
   - `video_live_update({ projectId, clipId, params: { speed: 2 }, scene: { "Cubo|px": 1.5, "cam|fov": 40, "Cubo|ry": 45 }, keyframes: { speed: [{ t: 0, v: 0 }, { t: 2, v: 3, e: "smooth" }], "Cubo|s": [{ t: 0, v: 1 }, { t: 1, v: 2 }] }, includeCode: true })`. En `scene` el valor es ABSOLUTO si la propiedad está en el código y un AJUSTE si `mode` es `offset`. Objeto por `name`, por variable (`"cube|px"`) o `cam`. Props: `px py pz`, `rx ry rz` (grados), `s`, `color`, `emi`, `op`, `int`, `vis`, `fov`.
   - Agregar objetos al código: `addObjects: [{ type: "sphere", name: "Esfera", color: "#00aaff", x: -1.5, y: 0, z: 0, size: 1 }]` (box, sphere, torus, knot, cone, cylinder, icosa, plane, pointLight, dirLight). Necesita una escena `new THREE.Scene()` (o en JSX un `</ThreeCanvas>` / `</Canvas>`: el objeto entra como `<mesh name=…>` antes de cerrarlo); quedan con `name`, editables.
   - **Con el editor abierto** (la persona editando a la vez) nada se pisa: cada escritura lleva una revisión y, si alguien guardó en el medio, se vuelve a leer y se aplica otra vez (el MCP) o se juntan los cambios (el editor: cada lado conserva lo suyo; el código del clip se junta línea por línea y el bloque ▸ musa clave por clave; si los dos cambiaron el mismo valor queda el de la persona). Si `video_live_update` responde «el editor abierto guardó cambios justo ahora», vuelve a llamarlo. Vale para todas las tools que cambian un video: también `video_segment_*`, `video_material_*`, `video_effect_*`, `video_track_add` y `motion_project_apply_spec`/`scene_project_apply_spec` esperan a que el editor termine de guardar y avisan al editor abierto, que junta el cambio con lo de la persona (no recarga ni pierde nada).
6. En `video_code_get` el clip vivo es `<canvas class="musa-live">` + `<script type="text/musa-live">` con el código tal cual (incluido su bloque `▸ musa`). El HTML exportado lo reproduce solo en el navegador y en HyperFrames; el Remotion exportado usa `<MusaLive>`.
7. La persona hace lo mismo en el editor: Media › «3D y código» (plantillas y «Pegar código…»); en el inspector del clip: parámetros, escena 3D (con «＋ Agregar al código»), tiempo del código (inicio, velocidad, repetir) y «</> Código del clip», un panel al lado que muestra el código en vivo (se ilumina la línea que cambia) y aplica solo lo que se escribe ahí. Y **directo en el lienzo**: un clic sobre un objeto 3D lo elige (marco naranja con su nombre); arrastrarlo lo mueve, las esquinas lo agrandan o achican, y la barra de arriba cambia el color, lo duplica («Duplicar» escribe la copia en el código), lo quita o lo oculta. Todo queda escrito en el código del clip. Para que la persona pueda elegir y reconocer cada objeto, **dale `name` a cada malla** (`cubo.name = "Cubo"` o `<mesh name="Cubo">`) y crea cada objeto con su propia variable (`const cubo = new THREE.Mesh(...)`), no dentro de un bucle anónimo.
   - El enlace para abrir un video en el editor es `editorUrl` (forma `…/#crear/videos/vid:<projectId>`): pásaselo tal cual a la persona; abre el editor directo aunque sea una pestaña nueva.

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

**Video hecho con código, editable capa por capa (receta probada)**
Si sabes armar un video con HyperFrames, Remotion o HTML/CSS, escríbelo como manifiesto y llega a Musa como capas editables (textos en T, formas e imágenes en M, con sus keyframes). No se manda HTML ni JS: solo el manifiesto JSON.
- `motion_source_convert({ sourceKind: "hyperframes-subset", source })` → `motion_project_create_from_spec({ workspaceId, spec, name })`. Remotion: `sourceKind: "remotion-subset"`, `composition { width, height, fps, durationInFrames, backgroundColor }` y `sequences` con `from`/`durationInFrames` y keyframes con `frame`.
- `source`: `{ name, width, height, fps, durationMs, backgroundColor, nodes: [...] }`. Cada nodo: `{ id, type: "text"|"shape"|"image", text?, src?, startMs, endMs, props, keyframes }`.
- `props`: `x`, `y` = CENTRO de la capa en px del lienzo; `fontSize`, `fontFamily`, `fontWeight`, `color` (texto); `width`, `height`, `backgroundColor`, `borderRadius` (formas e imágenes; radio = medio alto → píldora, cuadrado + radio medio → círculo); `opacity`, `scale`, `rotation`.
- Entrada del editor: `props.animation` = `words` (palabra por palabra; con `wordTimes` "0, 0.1, 0.57" en s desde el inicio del clip o `wordGap`), `fly-in`, `pop`, `fade`, `slide-up`, `typewriter`…
- `keyframes`: `[{ property: "opacity"|"x"|"y"|"scale"|"rotation", timeMs (absoluto), value, easing }]`. Dos keyframes de la misma propiedad no pueden caer en el mismo instante. `width`/`height` no se animan (usa `scale`).
- El fondo y la duración salen del manifiesto. Máximo 128 capas visuales. Revisa `fidelity.unsupported`: lo que aparezca ahí no llega al editor.

**El mismo video con las herramientas sueltas**
- Pon todos los clips de un tipo en la misma pista (tope de 128 pistas por proyecto, igual que una spec: una capa = una pista): una pista `video` (formas e imágenes) y una `text`.
- Fondo y duración: `video_material_add({ kind: "canvas", payload: { backgroundColor, durationMs } })`.
- Texto: `video_material_add({ kind: "text", payload: { text, x, y (en %), size (px), font, weight, color, anim } })`. Forma: `kind: "image"` sin `url`, con `payload.bg` (color), `w` (% del ancho), `ar` (ancho/alto), `radius`.
- Movimiento por clip: agrega `payload.props` (px) y `payload.keyframes` con el formato de arriba; `video_segment_transform` también se respeta (x, y de -1 a 1, scale, rotation, alpha).

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

Video como código
- `video_project_create_from_code`, `video_code_get`, `video_code_apply`.
- `video_live_add`, `video_live_update`, `video_live_get` (clips 3D / de código vivo: Three.js, p5, WebGL, Remotion 3D, editables).
- `image_vectorize_svg` (pasa un logo o ícono raster a SVG para usarlo como vector en M).

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
- Un `<canvas>` (Three.js, p5, WebGL) nunca se pasa a imagen: usa `video_live_add` o deja el canvas en el HTML del video. Si el código no expone `params`, la persona solo puede mover el clip entero.

## Ejemplos

- "Convierte el carrusel de lanzamiento en un reel 9:16 con transiciones y música"
- "Escribe el guion de 45 segundos para la toma de presentación de Kuna"
- "Corta los primeros 3 segundos del clip y ponle subtítulos"
