# REQ-023 — Export completo (Archivo/Diseño) + grilla en PPT

**Fecha:** 2026-08-28 · **Estado:** implementado

## Pedido

En Copywriting → Calendario y contenidos:

1. CSV/Excel deben llevar **todas** las columnas de la UI.
2. Columna **Archivo** = nombre del archivo (no un id) + columna nueva **Diseño** = frame exacto (una grilla tiene varios diseños en un único archivo).
3. Botón **PPT**: descarga un .pptx compatible con PowerPoint y Google Slides, con todo el contenido del rango en un único documento. **No descarga directo**: primero un popup pidiendo rango de fechas y marca. Portada con la grilla/fecha/nombre del usuario; un slide por pieza; texto seleccionable; por slide: copy a la izquierda + PNG del diseño a la derecha.
4. Paridad MCP: las IAs deben poder rellenar todo (incluido el link al frame) vía tools.

## Implementación

### Base de datos — `supabase_migrations_v34.sql` (lo corre el humano)

- `content_calendar.frame_id TEXT` (+ comment + índice parcial). Es el id de un elemento de `templates.frames` (JSON dentro del template), no hay FK posible.
- La API detecta `42703` (columna inexistente si v34 no corrió) y responde 503 con `setupRequired` y el archivo exacto a ejecutar — mismo patrón que PGRST205/v22.

### API — `api/src/routes/contentCalendar.ts`

- `buildPatch` acepta `frame_id` (`""` → NULL).

### Dominio — `src/lib/contentCalendar.ts`

- `ContentRow` += `frame_id`, `template_name`, `frame_name` (los últimos dos son solo display, resueltos en render).
- `EXPORT_COLUMNS` += `{ template_name, "Archivo" }` y `{ frame_name, "Diseño" }` después de AVANCE. El export ahora lleva TODAS las columnas de la UI (las de la hoja ya estaban) más Archivo/Diseño por nombre.

### UI — `src/components/ContentTab.tsx`

- Carga la lista de archivos del workspace (`/api/templates?limit=300`) y, lazy, los frames de cada archivo linkeado (`/api/templates/:id`, un GET por archivo, solo los linkeados).
- **Archivo**: select con nombres de archivos (mantiene ↗ al editor). Cambiar de archivo limpia el frame.
- **Diseño**: select con los frames del archivo linkeado ("(todo el archivo)" = sin frame pinneado).
- `visible` resuelve `template_name`/`frame_name` → los exports (CSV/Excel) salen con nombres.
- **⇩ PPT** en la barra: abre popup (Desde/Hasta con default = mes visible del calendario, Marca). Muestra "N piezas → N+1 slides". Genera:
  - pptxgenjs 4 (dynamic import → chunk propio, fuera del bundle principal).
  - Portada: "Grilla de contenido", marca, rango, "Preparado por {full_name|email}", fecha y N piezas.
  - Un slide por pieza: header fecha · canales; **texto nativo** (seleccionable/copiable en PowerPoint y Google Slides) con tema + copy a la izquierda; a la derecha el **frame exacto** renderizado a PNG con `rasterizeFrame` (lectura fresca del template, no caché del select), aspect-fit en su mitad; footer archivo ▸ diseño por nombre. Sin frame linkeado → placeholder.
  - Archivo: `grilla-{marca}-{desde}-a-{hasta}.pptx`.

### MCP — `netlify/functions/mcp.mjs`

- `update_content` += `frameId` (schema + patch). Cambiar `templateId` sin `frameId` en el mismo call limpia el frame (el description lo documenta).
- `mapCalendarRow` += `frameId` → `list_calendar_entries` / `add_content_idea` / `update_content` lo devuelven.

## Flujo completo pedido

1. La IA llena el calendario (`add_content_idea` → `update_content` con copy + `templateId` + `frameId` del grid).
2. El humano revisa en Contenidos (Archivo/Diseño como selects con nombres).
3. ⇩ CSV / ⇩ Excel → todas las columnas, Archivo y Diseño por nombre.
4. ⇩ PPT → popup rango+marca → grilla lista para mandar al cliente.

## Migración pendiente (humano)

`supabase_migrations_v34.sql` en Supabase (idempotente) + reload schema cache. Sin ella, linkear Diseño devuelve 503 con instrucciones; el resto de la sección funciona igual.
