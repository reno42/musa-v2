# BUG-GRAPH-THUMBNAIL — query_design_graph (2026-07-18)

**Estado:** MITIGADO por Lara vía SQL (sin tocar código). Requiere decisión del equipo para fix definitivo.

## Bug
`query_design_graph` en `netlify/functions/mcp.mjs` (~línea 8563) hace:

```js
sbGraph.from("design_file_meta").select("*, templates!inner(id, name, thumbnail)")
```

La columna `templates.thumbnail` **no existía** — el thumbnail vive en `templates.data` (JSONB, key `thumbnail`). PostgREST devolvía `42703 column templates_1.thumbnail does not exist` y el grafo retornaba 0 nodos con 69 rows de metadata correctos en `design_file_meta`.

## Mitigación aplicada (ya en producción)
```sql
ALTER TABLE templates ADD COLUMN IF NOT EXISTS thumbnail TEXT
  GENERATED ALWAYS AS (data->>'thumbnail') STORED;
```
Resultado verificado: grafo devuelve 69 nodos / 966 aristas; filtro `brand=polimi` → 13 nodos / 253 aristas.

## Trade-off de la mitigación
- Columna STORED **duplica** el peso de thumbnails base64 (hasta 1MB c/u) en disco.
- Aceptable a corto plazo (3/69 templates tienen thumbnail hoy).

## Fix definitivo recomendado (elegir uno)
1. **Preferido:** migrar thumbnails a Supabase Storage (pipeline de covers ya existe: bucket `design-covers`) y guardar solo URL. Entonces la columna generada pesa nada.
2. Cambiar el select a `templates!inner(id, name, data)` y mapear `r.templates?.data?.thumbnail` — y dropear la columna generada.

## Incidente relacionado (contexto)
- La tabla `workspaces` fue dropeada por accidente desde el SQL editor. Restaurada por Lara con los IDs originales derivados de `templates.workspace_id`. **Recomendación:** agregar a la migración un `CREATE TABLE IF NOT EXISTS workspaces` idempotente + considerar backups automáticos (Supabase PITR o pg_dump programado).
