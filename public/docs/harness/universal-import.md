# Importación de diseños

Estado: implementado y probado localmente; requiere aplicar `supabase_migrations_v46.sql` antes de probar los jobs o Figma con Supabase. Las migraciones v42–v45 no forman parte de este cambio. `.migration-version` se mantiene en v45 hasta confirmar que v46 fue aplicada.

## Compatibilidad

| Entrada | Editor | MCP |
| --- | --- | --- |
| SVG estático | Bloque vectorial con reporte de fidelidad | Mismo conversor; imágenes embebidas pasan a Assets |
| Enlace de Figma | Texto simple editable y otros elementos como bloques SVG | Mismo documento, con job y commit |
| PSD | Texto simple, capas raster, mesas y visibilidad; composición raster para máscaras/efectos | Composición guardada por Photoshop, por mesa, como imagen |
| PDF / AI compatible con PDF | Cada página se renderiza como imagen | Cada página se renderiza como imagen |
| AI antiguo | Vista previa embebida si existe; de lo contrario pide SVG/PDF | Requiere guardar con compatibilidad PDF |
| `.fig` local | Drag & drop en el editor: cada frame se importa como mesa con capas editables por objeto (texto, formas vectoriales, imágenes) y matching de fuentes con reemplazo; los píxeles de imágenes quedan como marcadores porque no viajan dentro del archivo | `import_figma_file({workspaceId, name, fileBase64, idempotencyKey})`; también por `create_design_upload`/`convert_design_upload` con `sourceType: "fig"` |
| PNG/JPEG/WEBP | Imagen persistida en Assets | Imagen persistida en Assets |

Los SVG rechazan XML activo, scripts, eventos, enlaces externos y CSS fuera del subconjunto soportado. Los estilos complejos deben exportarse como atributos de presentación. No se promete reconstrucción nativa de todos los efectos, componentes o estilos de texto de las aplicaciones de origen.

## Uso

El botón Importar y el drop de archivos aceptan lotes. Los fallos de conversión se muestran sin descartar los archivos válidos. Por defecto se crean frames nuevos. La opción de actualizar una importación previa es explícita porque reemplaza las ediciones de esa importación. Cancelar impide agregar frames; los recursos que ya hayan terminado de subir pueden permanecer en Assets.

En Configuración se conecta un token Figma por workspace, cifrado en servidor. Requiere `current_user:read` y `file_content:read`; comprobar también que esa cuenta tiene acceso al archivo. Los límites y expiración son los de la cuenta de Figma. Referencia: https://developers.figma.com/docs/rest-api/users-endpoints/

Para una IA:

1. SVG: `import_design_source({templateId, sourceType: "svg", content, name})`.
2. Figma: `import_figma_design({workspaceId, url, idempotencyKey})`; archivo `.fig` local: `import_figma_file({workspaceId, name, fileBase64, idempotencyKey})`.
3. Binarios: `create_design_upload({workspaceId, name, size, sourceType})`, PUT de los bytes a `signedUrl`, después `convert_design_upload({workspaceId, jobId})`.
4. Inspeccionar el reporte mediante `get_design_import_status` y confirmar con `commit_design_import({workspaceId, jobId, templateId})`.
5. Reintentar un Figma fallido con `retry_design_import`; un binario fallido con `convert_design_upload`.

La conversión ocurre durante la solicitud, con estado persistido; no existe un worker independiente. Un corte abrupto del proceso puede requerir una nueva subida/job. Los originales viven en un bucket privado durante 24 horas; subidas posteriores limpian hasta cinco originales expirados del mismo workspace. No hay un cron que consuma invocaciones en reposo. Los recursos de frames confirmados no se eliminan.

El commit usa una transacción que bloquea las filas del job y del template. La repetición devuelve los mismos IDs; dos jobs no reemplazan entre sí sus listas de frames. Sólo el servidor puede modificar el resultado de un job o invocar la función de commit.

## Verificación local

`node --test QA/universal-design-import.test.mjs QA/design-import-db.test.mjs`

`node --test QA/design-import-browser.test.mjs`

`node --import ./api/node_modules/tsx/dist/loader.mjs --test QA/design-upload-conversion.test.mjs`

El navegador de prueba bloquea conexiones externas y simula Assets. La prueba SQL aplica v46 dos veces en PostgreSQL embebido, verifica conservación de frames, repetición, aislamiento y privilegios. No aplica migraciones ni consume APIs reales. PDF.js y el canvas nativo se mantienen externos al empaquetado de funciones; el worker del navegador se publica como un asset de Vite.
