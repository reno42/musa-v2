---
name: musa-fotos
description: Fotos en Musa (como Lightroom y Photoshop). Revelado no destructivo con ajustes, presets y máscaras locales, composición por capas, quitar fondo, separar una imagen en capas y generar o editar imágenes con IA. Úsala cuando el trabajo es sobre una foto.
module: crear/disenos
---

# Fotos · revelado, composición e IA de imagen

Las fotos viven como capas de imagen dentro de un diseño. El **revelado** guarda una receta de ajustes por versión (nunca toca el original). La **composición** apila capas sobre la foto revelada (pintura, texto, otras imágenes) con modos de fusión y máscaras.

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
- Revisa el resultado con `render_frame_png` (skill `musa-diseno`).

## Ejemplos

- "Dale a las fotos del menú un look cálido y súbeles la exposición"
- "Quítale el fondo a la foto del producto y ponlo sobre el color de la marca"
- "Genera una imagen de una taza de café sobre madera, formato 4:5"
