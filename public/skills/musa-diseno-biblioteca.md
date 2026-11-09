---
name: musa-diseno-biblioteca
description: Archivo de diseños en Musa. Importar HTML (pegado, URL o ZIP con sus imágenes y fuentes), Figma, SVG, PSD o PDF; generar lotes de variantes desde un CSV; recetas reutilizables; versiones e historial; etiquetas, categorías y búsqueda; comentarios y trabajo de varios agentes sobre el mismo archivo.
module: crear/disenos
---

# Biblioteca de diseños · importar, lotes, versiones, orden y colaboración

Complementa a `musa-diseno` (crear y editar). Úsala cuando el trabajo es sobre muchos archivos, sobre su historial o sobre traer diseños de fuera.

## Flujos

**Importar desde Figma**
1. `figma_connection({ workspaceId })` → ¿hay conexión? Si no, la persona la conecta en Configuración › Integraciones.
2. `import_figma_design({ workspaceId, url, idempotencyKey })` (enlace de Figma) o `import_figma_file` (archivo .fig en base64).
3. `get_design_import_status({ workspaceId, jobId })` hasta que esté listo; `retry_design_import` si falla.
4. `commit_design_import({ workspaceId, jobId, templateId })` agrega cada mesa de trabajo como frame.

**Importar HTML (código de una IA, una página, un pack de portadas)**
1. Ten el diseño destino (`create_template` con `engine: "html"` si es nuevo).
2. `import_design_source({ templateId, sourceType: "html", content, format?, split? })`. Para una página pública: `sourceType: "url", url`. Para HTML con su carpeta (css, imágenes, fuentes): `sourceType: "zip", fileBase64`.
   - Trae las hojas de estilo externas, copia imágenes y fuentes a Musa, quita scripts y código activo, carga las fuentes de Google y ajusta media queries y vw/vh al tamaño del frame.
   - Varias secciones de tamaño fijo (un pack de portadas) o elementos con `data-musa-frame="Nombre"` salen como un frame cada una; `split: "single"` lo evita.
   - Si el HTML no dice su tamaño, pasa `format` (`post`, `portrait`, `story`, `landscape`, `youtube`, `slide`, `a4`) o `width`/`height`.
3. Lee `warnings` y `fonts.missing` de la respuesta y díselos a la persona (fuentes que faltan, rutas que no venían, scripts quitados).
4. Revisa con `render_frame_png` cada frame contra el original antes de decir que está listo.
- Es el mismo motor que el menú Importar del editor; no uses el menú desde un navegador.
- `import_design` sigue sirviendo para escribir HTML+CSS en un frame puntual (`frameId`).

**Importar otros archivos**
- SVG: `import_design_source` (`sourceType: "svg"`) o `import_svg`.
- PSD, PDF, AI, imágenes: `create_design_upload` → subir los bytes a la URL firmada → `convert_design_upload` → `commit_design_import`.
- Respaldo de Musa (.futuraria): `import_template` / `export_template`.

**Lote de variantes desde un CSV** (precios, sucursales, nombres…)
1. `list_batch_templates` o `profile_template_pool({ templateIds })` → detecta los espacios variables (textos, imágenes, CTA).
2. `generate_csv_template` → CSV con las columnas correctas para que la persona lo llene.
3. `apply_csv_to_frames` → cada fila se vuelve un frame en un archivo nuevo.
4. Revisa una muestra con `render_frame_png` y `lint_design` antes de entregar.
- Para cambiar variables de un solo diseño: `extract_variables` → `apply_variables`.
- Procedimiento completo: `get_playbook({ name: "csv-batch" })`.

**Recetas (diseños reutilizables)**
- `save_recipe` guarda la estructura de un diseño; `list_recipes`, `get_recipe`; `create_from_recipe` crea uno nuevo con sustituciones.

**Versiones**
- `save_version` antes de cambios grandes. `list_versions` y `diff_versions` para ver qué cambió; `restore_version` para volver (guarda el estado actual antes).
- `list_snapshots`: autoguardados recientes. `get_frame_changes`: qué frames cambiaron desde un hash conocido (útil para no releer todo).

**Unir archivos**
- `templates_merge_plan` (simulación, no escribe) → `templates_merge` (une 2 a 20 archivos en uno, sin pisar nada).

**Ordenar y encontrar**
- `find_templates({ workspaceId, tags?, brand?, category?, contentKind?, similarTo? })` es la búsqueda principal (filtros combinables; `similarTo` busca parecidos a un diseño).
- `brands_list` y `brands_create` para la marca de cada archivo; `set_file_meta` / `set_files_meta` (hasta 500 a la vez) para marca, categoría, formato y portada.
- Etiquetas: `tag_template`, `untag_template`, `tag_templates` (masivo), `design_tag_suggest` (sugiere desde el contenido).
- Vocabulario: `design_taxonomy`, `design_category_create/rename/delete`, `design_tag_register/update/delete`, `design_tag_alias_set` ("ig" → "redes.instagram").
- `query_design_graph`: grafo de diseños conectados por marca, etiquetas y campaña.

**Comentarios y aprobación**
- `comment_list`, `comment_add` (pin en el lienzo; crea tarea en el tablero salvo que digas lo contrario), `comment_reply`, `comment_resolve`.

**Varios agentes en el mismo archivo**
- `get_active_agents` → quién está editando. `claim_section` antes de editar un frame (bloqueo suave de 60 s), `release_section` al terminar. `broadcast_section_change` avisa a los demás.
- `subscribe_template` / `unsubscribe_template` solo sirven en clientes con conexión en tiempo real.
- Procedimiento: `get_playbook({ name: "multi-agent" })`.

## Herramientas

Importar y exportar
- `import_design_source` (HTML, URL, ZIP o SVG por el motor único), `import_design`, `import_svg`, `import_template`, `export_template`.
- `import_figma_design`, `import_figma_file`, `figma_connection`.
- `create_design_upload`, `convert_design_upload`, `get_design_import_status`, `retry_design_import`, `commit_design_import`.

Lotes y variables
- `list_batch_templates`, `profile_template_pool`, `generate_csv_template`, `apply_csv_to_frames`.
- `extract_variables`, `apply_variables`, `assemble_template`.

Recetas
- `save_recipe`, `list_recipes`, `get_recipe`, `create_from_recipe`.

Versiones
- `save_version`, `list_versions`, `diff_versions`, `restore_version`, `list_snapshots`, `get_frame_changes`.
- `templates_merge_plan`, `templates_merge`.

Orden y búsqueda
- `find_templates`, `query_design_graph`, `get_file_meta`, `set_file_meta`, `set_files_meta`.
- `brands_list`, `brands_create`.
- `tag_template`, `untag_template`, `tag_templates`, `design_tag_suggest`.
- `design_taxonomy`, `design_category_create`, `design_category_rename`, `design_category_delete`.
- `design_tag_register`, `design_tag_update`, `design_tag_delete`, `design_tag_alias_set`.

Comentarios y colaboración
- `comment_add`, `comment_list`, `comment_reply`, `comment_resolve`.
- `get_active_agents`, `claim_section`, `release_section`, `broadcast_section_change`, `subscribe_template`, `unsubscribe_template`.

## Reglas

- En lotes grandes revisa una muestra antes de entregar todo.
- Las etiquetas globales (sin espacio) afectan a todos los espacios de la cuenta: solo con permiso de dueño.
- `templates_merge` y `restore_version` no borran, pero confírmalo con la persona antes.

## Ejemplos

- "Importa este archivo de Figma al espacio de Nativa"
- "Genera las 40 piezas de precios por sucursal con este CSV"
- "Etiqueta todos los diseños de Café Altura de este mes como campaña navidad"
