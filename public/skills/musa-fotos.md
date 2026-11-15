---
name: musa-fotos
description: Fotos en Musa (Crear › Fotos, como Lightroom y Photoshop). Todas las fotos del espacio estén donde estén (subidas a Musa, Google Drive, Dropbox, OneDrive o un enlace) sin copiarlas; revelado no destructivo con ajustes, presets y máscaras locales, composición por capas, quitar fondo, separar una imagen en capas y generar o editar imágenes con IA. Úsala cuando el trabajo es sobre una foto.
module: crear/fotos
---

# Fotos · tus fotos estén donde estén, revelado, composición e IA de imagen

**Crear › Fotos** junta todas las fotos del espacio en un lugar, sin importar dónde están guardadas. Cada foto tiene `source`: `musa` (subida a Musa), `drive` (sigue en el Google Drive de la persona), `dropbox`, `onedrive` o `link` (cualquier https). Musa no copia las de Drive ni las de Dropbox: guarda la referencia y una `url` lista para usar en diseños, videos y webs (las de Drive pasan por un enlace firmado de Musa). Son las mismas imágenes de «Tus imágenes» del editor de diseño.

**Encontrar y traer fotos**
1. `photos_list({ workspaceId, source?, search?, tag? })` → todas las fotos con `source`, `url`, `thumb`, etiquetas y, si es una edición, de qué foto salió (`from`) y su receta.
2. `photos_sources({ workspaceId })` → cuentas de Google Drive conectadas (`psrc_…`). Conectar una cuenta lo hace la persona en Crear › Fotos (Google pide su permiso); la IA no puede conectar cuentas.
3. Drive: `photos_drive_list({ sourceId, folderId?, query? })` y `photos_drive_import({ sourceId, fileIds })`. Con el permiso básico de Google solo aparecen las fotos que la persona eligió en el selector de Google y las que Musa guardó en su carpeta «Musa».
4. Dropbox, Drive compartido, OneDrive o cualquier enlace: `photos_import_link({ workspaceId, url, name?, tags? })`.
5. Ordenar sin mover archivos: `photos_update({ assetId, name?, tags?, addTags?, removeTags? })` (etiquetas por campaña, cliente o tema). `photos_remove({ assetId })` la quita de Musa; si es de Drive, Dropbox o un enlace, el original sigue donde estaba.

**Editar una foto suelta y guardarla**
- La persona abre la foto en Crear › Fotos › Editar (el mismo editor de fotos de los diseños). Al guardar, la versión editada queda **donde está el original**: si es de Drive, en la carpeta «Musa» de esa cuenta; si no, en Musa. El original nunca se toca y la edición queda unida a él con su receta (se puede seguir editando desde el original).
- La IA guarda una edición propia con `photos_save_copy({ fromAssetId, data, name?, recipe?, saveTo: "same" | "drive" | "musa" })` (`data` = la imagen en base64 o data URL).

Las fotos también viven como capas de imagen dentro de un diseño. El **revelado** guarda una receta de ajustes por versión (nunca toca el original). La **composición** apila capas sobre la foto revelada (pintura, texto, otras imágenes) con modos de fusión y máscaras.

## Flujos

**Retocar una foto**
1. `photo_list_assets({ templateId })` → fotos del diseño.
2. `photo_open_session({ templateId, layerId })` → receta actual y versiones.
3. Rápido: `photo_apply_preset({ templateId, layerId, presetId })` (8 presets curados).
4. Fino: `photo_update_operation` (cambia algunos valores de una operación: básico, balance de blancos, color, HSL, curvas, detalle…) o `photo_apply_operation` (la reemplaza entera). `photo_remove_operation` la deja neutra.
5. Ajustes locales: `photo_create_mask` (radial, lineal o pincel) y `photo_update_mask`.
6. Guarda una versión con `photo_create_variant({ ..., recipe, label })`. `photo_compare_versions` y `photo_restore_version` para comparar o volver.

**Componer**
1. `photo_compose_get` → pila de capas.
2. `photo_compose_add_layer` (pintura, imagen, texto), `photo_compose_update_layer` (fusión, opacidad, posición), `photo_compose_set_layer_mask`.
3. `photo_compose_reorder_layers`, `photo_compose_duplicate_layer`, `photo_compose_delete_layer`. `photo_compose_clear` vacía todo (pide `confirm: true`; solo si lo piden).

**Quitar fondo o recortar sujeto**
- `remove_background({ assetId | url, workspaceId })`; si devuelve un trabajo, consulta `segment_status`.
- Sujeto por clic o por texto ("la taza"): `segment_click` + `segment_status`.
- Para recortes con forma precisa: máscaras vectoriales en `musa-vectores`.

**Generar o editar con IA**
- `ai_generate_image({ prompt, imageBase64?, aspectRatio? })`: genera o edita (Nano Banana). Pasa la imagen original para editarla.
- `separate_image_layers({ imageUrl })` → `separate_image_layers_check` hasta que termine: separa una imagen en capas (fondo, sujeto, textos).
- Animar una foto: skill `musa-video` (`generate_image_video`).

**Preparar para web**
- `optimize_image`: WebP con calidad y ancho máximo. `upload_image` para subir el resultado.

## Herramientas

Fotos del espacio (Musa, Drive, Dropbox, enlaces)
- `photos_list`, `photos_sources`, `photos_import_link`, `photos_update`, `photos_remove`.
- `photos_drive_list`, `photos_drive_import`, `photos_save_copy`.

Revelado
- `photo_list_assets`, `photo_open_session`, `photo_create_variant`.
- `photo_apply_operation`, `photo_update_operation`, `photo_remove_operation`, `photo_apply_preset`.
- `photo_create_mask`, `photo_update_mask`.
- `photo_compare_versions`, `photo_restore_version`.

Composición
- `photo_compose_get`, `photo_compose_add_layer`, `photo_compose_update_layer`, `photo_compose_delete_layer`.
- `photo_compose_reorder_layers`, `photo_compose_duplicate_layer`, `photo_compose_set_layer_mask`, `photo_compose_clear`.

Recorte e IA
- `remove_background`, `segment_click`, `segment_status`.
- `ai_generate_image`, `separate_image_layers`, `separate_image_layers_check`.
- `optimize_image`, `upload_image`.

## Reglas

- La IA de imagen usa la llave del espacio (BYOK) o créditos del plan. Si falta, avisa; no simules el resultado.
- No borres la pila de composición sin confirmación.
- Nunca borres ni sobrescribas archivos en el Drive o el Dropbox de la persona: las ediciones son archivos nuevos.
- Para usar una foto en un diseño o video, usa su `url` tal cual (no la descargues ni la vuelvas a subir).
- Revisa el resultado con `render_frame_png` (skill `musa-diseno`).

## Ejemplos

- "Dale a las fotos del menú un look cálido y súbeles la exposición"
- "Quítale el fondo a la foto del producto y ponlo sobre el color de la marca"
- "Genera una imagen de una taza de café sobre madera, formato 4:5"
