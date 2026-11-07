---
name: musa-diseno
description: Diseño en Musa. Crear y editar piezas gráficas (posts, carruseles, stories, banners, decks, gráficos) capa por capa, adaptarlas a formatos, revisarlas y exportarlas a PNG, PDF o SVG. Úsala cuando el entregable sea una pieza visual.
module: crear/disenos
---

# Diseño · crear, editar, verificar y exportar

## Cómo está hecho un diseño

- Un **diseño** (template) es un archivo con uno o más **frames** (mesas de trabajo). Un carrusel de 5 láminas es un diseño con 5 frames.
- Cada frame es HTML/CSS **por capas**: cada texto, imagen, botón, forma o ícono es una capa independiente con `data-layer-id`, nombre y posición. La persona edita esas capas en el editor igual que en Figma.
- Solo el frame tiene fondo. Las capas tienen **relleno y borde** (`set_paint`), nunca un "background" detrás.
- Todo cambio queda en el historial; antes de un cambio grande guarda versión con `save_version`.

## Antes de diseñar

1. `resolve_brand({ workspaceId, brand })` → paleta, tipografías, logo, plantillas de la marca.
2. `get_active_styles({ workspaceId })`: si hay estilos bloqueados, son obligatorios.
3. Si la marca tiene plantillas aprobadas, parte de ellas (`create_from_plantilla`, skill `musa-marcas`) en vez de empezar en blanco.

## Flujos

**Pieza nueva (post, story, banner)**
1. `create_template({ name, workspaceId, engine: "html", width, height })` → `templateId` y el Frame 1.
2. `set_frame_layers({ templateId, frameId, background, fontImports, layers })`: el diseño completo como lista plana de capas (id, name, kind, x, y, width, height, contenido, estilo). Es la herramienta recomendada.
3. Si el texto es largo, mide antes con `text_metrics` para elegir tamaño y que no se desborde.
4. Íconos: `search_icons` → `insert_icon`. Fotos: `search_stock_image` o `upload_image`; ilustraciones: `search_illustrations` → `get_illustration_svg`.
5. Verifica (ver abajo) y entrega el enlace con `editor_open({ templateId, surface: "design" })`.

**Carrusel o deck en una llamada**
- Carrusel o cualquier multi-frame con medida propia: `create_html_carousel({ workspaceId, name, width, height, brandId, frames })`.
- Presentación 1920×1080: `create_deck({ workspaceId, name, brand, cover, slides })`. La portada siempre es el primer frame. Ábrela con `presentation_open`.

**Editar un diseño existente**
1. `get_template` (o `get_html_frames` para ver HTML/CSS de los frames) y `get_template_structure` para el árbol de capas.
2. Cambios puntuales: `edit_text_content` (textos), `set_paint` (colores), `transform_element` (posición y tamaño), `update_element` (HTML/CSS de una capa), `update_frame_content` (por selector CSS).
3. Agregar o quitar: `add_element`, `add_primitive`, `remove_element`, `duplicate_frame`, `create_html_frame`.
4. Rehacer un frame entero: `set_frame_layers` de nuevo sobre el mismo frame.
5. Cambios guiados por instrucción en lenguaje natural: `enhance_template({ templateId, instruction })`.

**Llevar a otros formatos**
1. `adapt_all_formats({ templateId, formats: ["story", "post", "banner", ...] })` o `adapt_format` para uno.
2. `compare_adaptations` para revisar lado a lado; corrige lo que se rompa.

**Desde una imagen o un prompt**
- `image_to_design` convierte una imagen de referencia en capas editables.
- `generate_from_prompt` crea un diseño desde texto (modelo del espacio).
- Para replicar una referencia exacta, compara con `diff_overlay` hasta que coincida.

**Verificar antes de entregar (obligatorio)**
1. `lint_design({ templateId, frameId })` → puntaje y problemas (textos desbordados, capas fuera del frame, contraste).
2. `validate_brand({ templateId, brandId })` si es de una marca; `check_contrast` o `check_accessibility` si hay dudas de lectura.
3. `render_frame_png({ templateId, frameId })` para **ver** el resultado: abre la `captureUrl` una vez y lee la URL del PNG. Si no puedes abrir páginas, usa `render_html_template`.
4. Corrige solo lo que falle. `update_thumbnail` si cambió mucho.

**Exportar y compartir**
- PNG/JPG/WebP: `render_html_template`, `render_to_formats`, `export_batch` (varios frames).
- PDF: `export_pdf`. SVG editable: `export_frame`. Código: `copy_as`.
- Enlace público: `share_design({ templateId, isPublic: true })`.
- Para pasarlo a video o a correo: skills `musa-video` y `musa-mailing-eventos`.

## Herramientas

Archivo y frames
- `list_templates`, `get_template`: buscar y leer diseños (para filtros avanzados: `find_templates` en `musa-diseno-biblioteca`).
- `create_template`, `create_html_template`: diseño nuevo (siempre `engine: "html"`).
- `create_html_carousel`: carrusel multi-frame en una llamada.
- `create_deck`: presentación 1920×1080 en una llamada.
- `update_template`, `rename_template`, `duplicate_template`, `delete_template`.
- `create_html_frame`, `create_frame`, `update_html_frame`, `delete_html_frame`, `delete_frame`, `duplicate_frame`.
- `get_html_frames`, `list_frames`, `get_frame`.

Capas
- `set_frame_layers`: frame completo como lista de capas (recomendada).
- `set_canvas_layers`: objetos sueltos en el lienzo, fuera de los frames.
- `set_html`, `set_css`: reemplazan HTML/CSS de un frame (pasan por el normalizador de capas).
- `get_template_structure`, `select_element`: árbol y detalle de capas.
- `add_element`, `add_primitive`, `remove_element`, `update_element`, `update_frame_content`, `change_element_tag`, `reorder_element`.
- `edit_text_content`: cambiar texto de una capa.
- `transform_element`, `align_elements`, `group_elements`, `smart_layout`: posición, alineación, grupos, grillas.
- `set_layer_z`: orden de apilado.
- `lock_element`, `hide_element`.
- `canvas_select_move`, `canvas_copy_paste`, `canvas_undo_redo`, `canvas_context_menu`: lo mismo que hace la persona con el mouse (mover, copiar/pegar, deshacer, clic derecho).

Estilo
- `set_paint`: relleno y borde de una capa (la única forma de colorear).
- `set_gradient`, `set_blend_mode`, `set_pattern_fill`, `set_pseudo_state`.
- `copy_style`, `paste_style`.
- `text_metrics`: mide texto con métricas reales de la fuente antes de crearlo.

Contenido visual
- `search_icons`, `insert_icon`, `get_icon_svg`, `resolve_icon_hints`.
- `search_illustrations`, `get_illustration_svg`.
- `search_stock_image`, `upload_image`, `replace_asset`, `list_assets`, `delete_asset`.
- `create_chart`: gráficos y diagramas calculados en el servidor.

IA de diseño
- `generate_from_prompt`, `enhance_template`, `image_to_design`, `ai_suggest_layout`.
- `detect_structure`, `analyze_template_structure`: entender un diseño ajeno.

Formatos
- `adapt_format`, `adapt_all_formats`, `compare_adaptations`.

Verificación
- `lint_design`, `render_frame_png`, `diff_overlay`.
- `validate_brand`, `check_contrast`, `check_accessibility`, `auto_fix_brand` (detalle en `musa-marcas`).

Exportar y abrir
- `render_html_template`, `render_to_formats`, `render_batch`, `batch_render_html`.
- `export_pdf`, `export_frame`, `export_batch`, `copy_as`.
- `update_thumbnail`, `upload_cover_image`.
- `share_design`, `editor_open`, `presentation_open`.
- `save_version`: guarda un punto del historial antes de cambios grandes.

Guías de procedimiento
- `get_playbook({ name })`: pasos detallados para `create-from-scratch`, `replicate-html`, `csv-batch`, `design-system`, `multi-agent`. Úsalos solo si el trabajo es de ese tipo.

## Reglas

- Una capa por objeto visible; nada de capturas de pantalla de texto.
- Nunca declares terminado sin `lint_design` y una revisión visual.
- Conserva los textos exactos que da la persona.
- Si cambias mucho un diseño que no creaste tú, `save_version` antes.

## Ejemplos

- "Hazme un carrusel de 5 láminas para Instagram con los 5 errores del CRM, con la marca Kuna"
- "Adapta el post de lanzamiento a story, banner web y LinkedIn"
- "Arma un deck de 8 diapositivas con los resultados del trimestre"
