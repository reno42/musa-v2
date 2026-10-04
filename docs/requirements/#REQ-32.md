Hecho. Este requerimiento sustituye el alcance anterior: no trata el editor como una colección de filtros, sino como una plataforma completa de fotografía y composición capaz de llegar a paridad funcional progresiva con Photoshop y Lightroom. No hice cambios de código ni infraestructura.

# REQ-PHOTO-PLATFORM-001 — Plataforma Fotográfica Profesional de Musa

## 1. Objetivo contractual

Musa debe incorporar una plataforma de edición fotográfica profesional integrada al editor de diseño, compuesta por tres superficies que comparten assets, versiones y motor de render:

1. **Modo Foto / Develop:** edición no destructiva de una foto, color, RAW, máscaras, presets y retoque.
2. **Modo Composición / Layers:** documento raster multicapa, selección, texto, formas, blend modes, filtros y composición tipo Photoshop.
3. **Biblioteca Fotográfica / Catalog:** ingestión, organización, búsqueda, metadatos, lotes, selección, ratings y exportación tipo Lightroom.

El usuario debe poder seleccionar una foto de un diseño y abrirla directamente en Modo Foto. Nunca se debe rasterizar el diseño entero para editar una sola imagen.

El sistema debe conservar el original, registrar cada operación y permitir volver a cualquier versión. Lightroom define precisamente este modelo: las modificaciones se guardan como instrucciones y se aplican al exportar, sin alterar el archivo fuente. [Adobe Lightroom Classic: edición no destructiva](https://helpx.adobe.com/in/lightroom-classic/desktop/help/applying-adjustments-develop-module-basic.html)

## 2. Invariantes obligatorios

- El archivo original es inmutable.
- Una edición es una receta versionada, no un bitmap sobrescrito.
- Cada capa del diseño referencia un `assetId` y, si corresponde, un `renditionId`.
- Editar una foto compartida crea una variante para la capa seleccionada por defecto.
- “Actualizar todas las instancias” requiere confirmación explícita.
- Cada operación es reversible, ordenable, desactivable y auditable.
- Los previews se procesan localmente; cada movimiento de slider, cursor o pincel no puede llamar al backend.
- Los renders pesados, modelos de IA, archivos RAW, PSD y exportaciones grandes son asíncronos.
- No se usarán rutas, funciones ni colas de Netlify.
- `onnxruntime-web` para LAYA permanece intacto en el navegador. El pipeline visual es independiente.
- No se guardarán fotos grandes en HTML, CSS, Base64 dentro de templates ni JSON de diseño.

## 3. Arquitectura requerida

| Capa | Responsabilidad obligatoria |
|---|---|
| Navegador | Canvas, zoom, pan, herramientas, preview, máscaras, sliders, undo/redo y composición interactiva. |
| Web Worker + OffscreenCanvas | Procesamiento local sin bloquear la UI: thumbnails, histogramas, pinceles, máscaras, proxies y filtros CPU de respaldo. |
| WebGL2 | Render principal de ajustes, blend modes, filtros y composición. WebGPU será mejora progresiva. |
| Cloudflare Worker | Autorización, metadatos, recetas, URLs firmadas, creación/cancelación de jobs y estado. |
| R2 | Originales, proxies, thumbnails, máscaras por tiles, recetas, outputs y exportaciones. |
| Cloudflare Queues | Render, reintentos, cancelación, deduplicación y backpressure. Las colas no garantizan orden, por lo que cada job debe ser idempotente. [Cloudflare Queues](https://developers.cloudflare.com/queues/reference/how-queues-works/) |
| Cloudflare Containers | `sharp`/libvips, decodificadores RAW, PSD, TIFF pesado, ONNX visual, IA, render final y conversión profesional. Containers existe precisamente para runtimes Linux, binarios, memoria y CPU mayores que Workers. [Cloudflare Containers](https://developers.cloudflare.com/containers/) |
| Cloudflare Images | Entrega optimizada de previews, thumbnails, crop y formatos de distribución; no es el historial ni el motor de edición. [Cloudflare Images](https://developers.cloudflare.com/images/optimization/transformations/overview/) |
| Base relacional | Metadatos, ownership, permisos, colecciones, recetas, jobs, variantes, catálogo y relaciones con diseños. |

R2 debe ser el storage canónico si el objetivo “todo Cloudflare” implica retirar Supabase Storage. No se debe hacer dual-write indefinido. La migración debe tener una fuente de verdad, checksum y corte definitivo. R2 soporta acceso directo desde Workers y cargas multipart para archivos grandes. [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/), [cargas multipart](https://developers.cloudflare.com/r2/objects/upload-objects/)

## 4. Modelo de datos obligatorio

```text
photo_assets
- id, workspace_id, original_storage_key, original_checksum
- mime_type, width, height, megapixels, byte_size
- color_profile, bit_depth, exif_json, ownership, deleted_at

photo_documents
- id, workspace_id, source_asset_id
- mode: develop | composition
- active_version_id, status, created_by

photo_versions
- id, document_id, parent_version_id
- operation_graph_json, layer_graph_json, created_by, created_at
- immutable, label, checksum

photo_operations
- id, version_id, sequence, operation_type
- enabled, parameters_json, mask_id, created_at

photo_masks
- id, version_id, type, geometry_json
- feather, density, invert, tile_manifest_key

photo_renditions
- id, source_asset_id, version_id, recipe_hash
- width, height, format, color_profile
- storage_key, status, checksum

photo_jobs
- id, workspace_id, rendition_id, job_type
- idempotency_key, state, progress, cancellation_requested
- attempts, error, started_at, finished_at

photo_catalog_items
- asset_id, workspace_id, capture_date, rating, flag
- color_label, keywords, people, location, collection_ids
```

## 5. Integración con el editor de diseño

### Entrada al Modo Foto

- Clic sobre imagen raster → “Editar foto”.
- El editor abre un overlay equivalente al Modo Video.
- La foto seleccionada es el documento activo.
- Una tira inferior muestra las demás fotos raster usadas en el diseño.
- El overlay conserva el frame, selección, zoom y viewport original del diseño.
- Al cerrar, Musa vuelve exactamente al mismo lugar.

### Salida del Modo Foto

El usuario debe escoger una de estas acciones:

- Guardar receta sin aplicar.
- Crear variante y reemplazar solo la capa actual.
- Crear variante reusable en Assets.
- Aplicar la variante a todas las capas vinculadas.
- Exportar sin alterar el diseño.
- Descartar cambios.

### Assets no compatibles

- URL externa: “Crear copia editable”.
- SVG: abrir como vector o rasterizar como nueva copia; nunca modificar silenciosamente el SVG fuente.
- GIF/imagen animada: modo de frame explícito.
- Video: enviar al Modo Video.
- Asset sin permiso: mostrar bloqueo; no descargar ni copiar sin autorización.

## 6. Inventario completo de herramientas y capacidades

Esto es un inventario de paridad funcional. Ninguna familia se considera “secundaria” al evaluar completitud.

### 6.1 Navegación, lienzo y medición

- Seleccionar, mover, duplicar, bloquear, ocultar y agrupar.
- Mano, zoom, zoom continuo, fit, fill, 100%, 200%, pixel preview.
- Rotar canvas, flip canvas, fullscreen, isolate mode, presentation mode.
- Navigator/minimap.
- Rulers, guías, smart guides, grid, pixel grid, snap y distribución.
- Unidades px, pt, mm, cm, pulgadas y porcentaje.
- Cuentagotas, Color Sampler, regla, medida, conteo y notas.
- Histograma RGB, luminancia, clipping de blancos/negros, valores RGB/CMYK/Lab bajo cursor.
- Before/After: lateral, vertical, horizontal, split, reference image y soft-proof preview.

### 6.2 Selección, canales y máscaras

- Rectangular marquee.
- Elliptical marquee.
- Single row y single column marquee.
- Lazo libre.
- Polygonal lasso.
- Magnetic lasso.
- Quick Selection.
- Magic Wand por tolerancia, contigüidad y sample size.
- Selección por objeto.
- Selección de sujeto.
- Selección de cielo.
- Selección por color.
- Selección por luminancia.
- Selección por profundidad.
- Selección por foco.
- Selección por personas: piel, cabello, ropa, ojos, labios, dientes y rasgos.
- Selección con brush, box y prompt.
- Añadir, restar, intersectar e invertir selección.
- Expand, contract, feather, smooth, border y refine edge.
- Select and Mask: radio, decontaminate color, edge shift, preview sobre fondo.
- Guardar/cargar selección.
- Canales alpha.
- Máscara de capa.
- Máscara vectorial.
- Clipping mask.
- Máscara de ajuste.
- Máscara de grupo.
- Máscara de filtro.
- Máscara temporal para exportación.
- Pintar, borrar, restaurar, invertir, densidad y feather de máscara.

Photoshop trata las selecciones como áreas aisladas para editar o filtrar sin afectar el resto de la imagen; Musa debe preservar ese comportamiento. [Adobe: selecciones](https://helpx.adobe.com/photoshop/using/making-selections.html)

### 6.3 Herramientas de pintura y relleno

- Brush.
- Pencil.
- Mixer Brush.
- Color Replacement.
- History Brush.
- Art History Brush.
- Gradient: linear, radial, angle, reflected y diamond.
- Paint Bucket.
- Pattern Stamp.
- Custom brushes: tamaño, dureza, spacing, scattering, textura, dinámica de presión, tilt, rotación y opacidad.
- Soporte de stylus: presión, inclinación, velocidad y borrador físico.
- Presets de brush, import/export y sincronización por workspace.
- Color picker, Swatches, gradients, patterns y estilos.
- Foreground/background color, swap/reset.
- Blend modes y opacity/flow por herramienta.

El catálogo incluye Mixer Brush, Color Replacement, History Brush, Pattern Stamp y los modos de gradiente; no quedan fuera por ser menos usados. [Adobe: herramientas de pintura](https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/fill-objects-selections-layers/painting-tools-overview.html)

### 6.4 Retoque, restauración y corrección local

- Spot Healing Brush.
- Healing Brush.
- Patch.
- Content-Aware Move.
- Clone Stamp.
- Remove Tool.
- Red Eye.
- Dust removal.
- Scratch removal.
- Lens flare correction.
- Perspective correction.
- Dodge.
- Burn.
- Sponge.
- Blur.
- Sharpen.
- Smudge.
- Noise reduction local.
- Dehaze local.
- Frequency separation como workflow reproducible.
- Skin retouch no destructivo.
- Clone/heal con fuente visible, offset, sample current layer/current-below/all-layers.
- Pinceles correctivos con tamaño, feather, opacity y flow.
- Corrección de ojos, dientes, piel, cabello y fondo.
- Restauración de fotos antiguas.
- Eliminación de objetos, cables, reflejos y personas con estado reproducible y fallback no generativo.

### 6.5 Transformación, geometría y composición espacial

- Crop, crop overlay, ratio lock y presets.
- Straighten.
- Rotate, flip horizontal/vertical.
- Scale, skew, distort y perspective.
- Free Transform.
- Warp con grid.
- Perspective Warp.
- Puppet Warp.
- Content-Aware Scale.
- Liquify: forward warp, reconstruct, smooth, twirl, pucker, bloat, push-left, freeze/thaw mask y face-aware controls.
- Lens correction: barrel, pincushion, chromatic aberration, vignette.
- Adaptive wide angle.
- Panorama merge.
- HDR merge.
- Focus stacking.
- Photomerge.
- Auto-align layers.
- Auto-blend layers.
- Match color.
- Replace sky.
- Frame/crop repositionable.
- Transformación con numerics, snapping y pivote.

Incluye corrección de lente, Perspective Warp, Liquify, Warp y Puppet Warp, que Photoshop clasifica como herramientas de corrección y transformación creativa. [Adobe: distorsión y transformación](https://helpx.adobe.com/photoshop/desktop/effects-filters/artistic-stylize-filters/overview-of-distortion-tools.html)

### 6.6 Corrección de color y revelado RAW

- Perfil de cámara.
- Camera matching profile.
- DCP/ICC.
- White balance: temperatura, tint, eyedropper y presets.
- Exposure.
- Contrast.
- Highlights.
- Shadows.
- Whites.
- Blacks.
- Texture.
- Clarity.
- Dehaze.
- Vibrance.
- Saturation.
- HSL: hue, saturation y luminance por color.
- Color Mixer.
- Color Grading: shadows, midtones, highlights y global.
- Tone Curve: RGB y canales individuales.
- Levels: input/output, gamma, black/gray/white point.
- Curves point y parametric.
- Color Balance.
- Selective Color.
- Channel Mixer.
- Black & White Mix.
- Split toning.
- Calibration.
- Auto tone, auto contrast y auto color.
- Defringe.
- Chromatic aberration.
- Lens profile corrections.
- Transform/Upright.
- Vignette.
- Grain.
- Sharpening.
- Noise reduction luminance/color.
- AI denoise.
- Super resolution.
- HDR edit y tone mapping.
- Soft proof.
- Gamut warning.
- Copy/paste/sync settings.
- Presets, profiles, defaults y snapshots.

Las capas de ajuste deben incluir, como mínimo, Curves, Levels, Exposure, Hue/Saturation, Color Balance, Black & White, Channel Mixer, Color Lookup, Selective Color, Invert, Posterize, Threshold y Gradient Map, además de Solid, Gradient y Pattern fills. [Adobe: adjustment y fill layers](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/color-adjustment-fill-layers/work-with-adjustment-and-fill-layers.html)

### 6.7 Capas y composición tipo Photoshop

- Pixel layer.
- Background layer.
- Adjustment layer.
- Fill layer.
- Shape layer.
- Text layer.
- Smart Object / linked asset.
- Embedded asset.
- Video/frame layer.
- Group y nested group.
- Artboard.
- Layer comps.
- Visibility, lock, lock transparency y lock pixels.
- Rename, duplicate, reorder, merge, flatten y stamp visible.
- Link/unlink layers.
- Clipping masks.
- Layer masks.
- Vector masks.
- Smart filters.
- Layer styles: drop shadow, inner shadow, outer glow, inner glow, bevel/emboss, satin, color overlay, gradient overlay, pattern overlay, stroke.
- Blend If.
- Todos los blend modes: normal, dissolve, darken, multiply, color burn, linear burn, darker color, lighten, screen, color dodge, linear dodge, lighter color, overlay, soft light, hard light, vivid light, linear light, pin light, hard mix, difference, exclusion, subtract, divide, hue, saturation, color y luminosity.
- Opacity, fill, knockout, isolation y pass-through.
- Layer search, filters, color labels y panel configurable.

La edición no destructiva con adjustment layers, propiedades y orden de capas no es opcional; Photoshop usa ese modelo para preservar los píxeles fuente. [Adobe: Layers](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/get-started-layers/work-with-the-layers-panel.html)

### 6.8 Texto, vector y formas

- Horizontal/vertical type.
- Area type y path type.
- Character, paragraph, leading, tracking, kerning, baseline, ligatures y OpenType.
- Glyph picker.
- Variable fonts.
- Warp text.
- Paragraph styles y character styles.
- Shapes: rectangle, rounded rectangle, ellipse, polygon, line, custom shape.
- Pen, freeform pen, curvature pen.
- Add/delete/convert anchor point.
- Path selection y direct selection.
- Boolean operations: union, subtract, intersect, exclude.
- Fill, stroke, dash, cap, join, gradient y pattern.
- Vector export y rasterize.
- SVG import/edit/export.

### 6.9 Filtros, efectos y procesamiento

- Blur: Gaussian, box, motion, radial, lens, surface, smart blur, average.
- Sharpen: unsharp mask, smart sharpen, shake reduction.
- Noise: reduce noise, add noise, dust & scratches, median.
- Distort: displacement, ripple, wave, zigzag, twirl, polar coordinates, pinch, glass.
- Pixelate: mosaic, crystallize, pointillize, color halftone.
- Render: clouds, difference clouds, fibers, lens flare, lighting effects.
- Stylize: emboss, find edges, oil paint, solarize, wind, diffuse.
- Artistic: watercolor, cutout, colored pencil y equivalentes.
- Brush strokes, sketch y texture filters.
- High pass.
- Offset.
- Other/custom filter.
- Filter Gallery con stack, orden, visibilidad y parámetros.
- Smart Filters no destructivos.
- LUTs.
- Camera Raw Filter.
- Neural/AI filters con versionado de modelo y coste visible.

La galería de filtros debe permitir combinar, reordenar y ocultar efectos; no basta con aplicar un filtro destructivo. [Adobe: Filter Gallery](https://helpx.adobe.com/photoshop/desktop/effects-filters/get-started-with-filters/filter-gallery.html)

### 6.10 Funciones IA

- Remove background.
- Subject selection.
- Sky/background/object/people selection.
- Segmentación por clic, box y prompt.
- Generative remove.
- Generative fill.
- Generative expand.
- Replace/remove object.
- Remove distracting people.
- Relight.
- Upscale/super resolution.
- Denoise.
- Colorize/restoration.
- Generación de variaciones.
- Background replace.
- Prompt history, seed cuando aplique, modelo, coste, consentimiento y reversibilidad.
- El resultado IA siempre crea variante o capa nueva; nunca sobreescribe el original.

### 6.11 Biblioteca tipo Lightroom

- Import desde equipo, cámara, drag/drop, Assets, URL autorizada, ZIP y migración.
- Carga resumible y multipart.
- Preview generation: thumbnail, standard, 1:1 y smart preview.
- Carpetas, álbumes, colecciones, collection sets y colecciones inteligentes.
- Stacks.
- Virtual copies.
- Ratings 0–5.
- Flags: pick, reject, unflagged.
- Color labels.
- Keywords jerárquicos, sinónimos y export flags.
- Personas y face grouping.
- Localización y mapa.
- EXIF, IPTC, XMP, copyright, creator, licensing y captions.
- Búsqueda textual, visual y por metadata.
- Filtros por fecha, cámara, lente, keyword, persona, formato, ratio, tamaño, rating, flag, color, ubicación, colección y estado de edición.
- Grid, Loupe, Compare, Survey y Reference views.
- Culling.
- Duplicados y similares.
- Batch rename.
- Batch metadata.
- Batch preset.
- Sync settings.
- Auto sync.
- Historial y snapshots por foto.
- Versiones/virtual copies.
- Actividad de import, upload, proxy y render con cancelación.

Lightroom organiza el trabajo en Library, Develop y módulos de salida; Library incluye catálogo, filtros, ratings, flags, labels, keywords, colecciones, stacks y vistas Compare/Survey. [Adobe: Library](https://helpx.adobe.com/lightroom-classic/desktop/help/library-module-basic-workflow.html), [keywords](https://helpx.adobe.com/lightroom-classic/desktop/organize-photos-in-lightroom-classic/keywords.html)

### 6.12 RAW, color profesional y formatos

- JPEG, PNG, WebP, AVIF, HEIF/HEIC, TIFF, GIF estático, BMP.
- RAW mediante un decoder versionado y extensible por fabricante.
- DNG.
- PSD/PSB con informe de fidelidad por capa.
- SVG, PDF y EPS mediante ruta vectorial controlada.
- Import/export de 8, 16 y 32 bits cuando el formato lo soporte.
- RGB, grayscale, CMYK y Lab.
- sRGB, Display P3, Adobe RGB, ProPhoto RGB e ICC custom.
- Conversión de perfiles y embed profile.
- Print proof y output intent.
- Transparencia y alpha.
- Metadatos preservables, editables o eliminables.
- Eliminación de GPS por defecto en export público.

### 6.13 Salida, publicación e impresión

- Export individual y batch.
- JPEG, PNG, WebP, AVIF, TIFF, PSD, PSB, PDF y SVG cuando corresponda.
- Tamaño, resolución, quality, sharpen for screen/print, watermark, filename template y carpeta/colección destino.
- Export presets.
- Rango de fotos, selección, colección, filtros y versiones.
- Contact sheet.
- Web gallery.
- Slideshow.
- Print layouts.
- Impresión con perfiles, bleed, crop marks y proof.
- Social export por formato/plataforma.
- Publicación y share links con permisos.
- Descarga original, variante, receta/XMP y package de composición.
- Validación del archivo exportado: no vacío, dimensiones correctas, perfil correcto y checksum.

Lightroom exporta ajustes junto al archivo y permite controlar formato, nombre, espacio de color, píxeles, resolución y presets reutilizables. [Adobe: exportación](https://helpx.adobe.com/lightroom-classic/help/exporting-photos-basic-workflow.html)

### 6.14 Automatización, agentes y API/MCP

Toda capacidad visible en UI debe tener una operación MCP equivalente, segura y determinista.

Familias MCP requeridas:

- `photo_open_session`
- `photo_list_assets`
- `photo_create_variant`
- `photo_apply_operation`
- `photo_update_operation`
- `photo_remove_operation`
- `photo_create_mask`
- `photo_update_mask`
- `photo_select_subject`
- `photo_run_retouch`
- `photo_create_layer`
- `photo_update_layer`
- `photo_export`
- `photo_start_batch`
- `photo_get_job_status`
- `photo_cancel_job`
- `photo_restore_version`
- `photo_manage_catalog`
- `photo_apply_preset`
- `photo_compare_versions`

Cada tool debe validar ownership, `workspaceId`, asset type, costos, permisos y versión base. LAYA puede ejecutar recetas compuestas, pero no reemplaza el motor de edición ni controla píxeles directamente.

## 7. Rendimiento, escalabilidad y seguridad

### Rendimiento

- Preview visible en menos de 2 segundos con proxy existente.
- Herramientas interactivas no bloquean el main thread.
- Brush, crop, pan, zoom, transform y sliders tienen respuesta continua.
- Proxies adaptativos: 1024, 2048, 4096 y tile-based para imágenes grandes.
- El original solo se lee para render final o zoom de inspección.
- Cache por `originalChecksum + recipeHash + dimensions + format`.
- Un mismo render nunca se procesa dos veces si el hash coincide.
- Render final no bloquea editar, navegar ni exportar otras piezas.
- Cancelación descarta outputs parciales y libera prioridad de cola.
- Jobs viejos se invalidan cuando existe una receta más nueva.

### Seguridad

- URLs firmadas de corta vida para originales privados.
- Validación real de MIME, checksum, dimensiones y pixel count.
- Límites contra image bombs.
- Sanitización de SVG/PDF.
- RLS o equivalente por workspace.
- Auditoría de operaciones, exportación, share y eliminación.
- Cifrado en tránsito y almacenamiento.
- Política de retención de originales, proxies, renditions y papelera.
- Consentimiento y trazabilidad para IA generativa.
- Cuotas por workspace: bytes, megapíxeles, render, IA, concurrencia y exports.

## 8. Criterios de aceptación

La plataforma no se considera completa mientras falle cualquiera de estos puntos:

1. Editar una foto de un diseño no rasteriza ni altera el diseño completo.
2. El original permanece idéntico tras editar, exportar, borrar una variante o restaurar una versión.
3. Dos capas con el mismo original pueden tener variantes diferentes.
4. Undo/redo funciona en operaciones, máscaras, capas, filtros y ajustes.
5. El render asíncrono es cancelable, recuperable e idempotente.
6. No hay ninguna dependencia nueva ni activa de Netlify.
7. LAYA mantiene su router ONNX local sin regresión.
8. Una acción UI y su tool MCP producen el mismo resultado verificable.
9. Un export profesional conserva dimensiones, formato, perfil y transparencia solicitados.
10. Se prueban imágenes pequeñas, 24 MP, alpha, RAW, URL externa, asset compartido, permisos insuficientes, job cancelado, reintento, conexión interrumpida y concurrent editing.
11. Ningún error de render deja un asset parcialmente publicado.
12. El catálogo puede buscar, filtrar, etiquetar, comparar, puntuar, agrupar y exportar lotes sin degradar el editor de diseño.

## 9. Regla de completitud

Antes de marcar cualquier entrega como “Photopea/Lightroom compatible”, se debe ejecutar una matriz de paridad contra estas familias:

- Herramienta.
- Subherramienta.
- UI.
- MCP.
- Operación no destructiva.
- Soporte de máscara.
- Soporte de lote.
- Soporte de export.
- Compatibilidad de formato.
- Motor local / Worker / Container.
- Prueba automática.
- Prueba visual.
- Estado: implementado, parcial, no implementado.

No se podrá declarar completitud por “tener varita, borrador y color”. La plataforma solo será estable y escalable cuando conserve el modelo de assets, versiones, composición, catálogo, procesamiento y salida descrito arriba.