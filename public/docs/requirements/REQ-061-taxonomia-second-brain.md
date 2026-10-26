# REQ-061 — Taxonomía de diseño, filtros faceta y second brain interconectado

**Estado:** Fase 1 + Fase 2 implementadas (MCP-first + REST + UI). · **Fecha:** 2026-10-26 · **Migración:** `supabase_migrations_v85.sql` (manual, Supabase SQL Editor).

## 1. Problema

El usuario (o su IA) debe poder clasificar archivos por **marca**, **categoría** y **tags propios**, ver esa taxonomía reflejada en el second brain interconectado, y filtrar Diseño → Archivos con dropdowns que **se acumulen entre sí** (AND entre facetas), nunca uno opacando al otro. Todo debe ser operable por humanos desde la UI y por IAs vía MCP con las mismas tablas.

## 2. Modelo de datos (v85)

* `design_file_meta` (existente) sigue siendo la fuente de membresía: `brand`/`brand_id`, `category` TEXT, `tags` TEXT[] — cero migración de datos.
* `design_categories` — registro por workspace (`UNIQUE(workspace_id, name)`), `color`, `scope`, `created_by` (`user` | `ai:<model>`). Las 4 categorías históricas (Design System, Plantillas, Assets, Archivos) se **siembran perezosamente** al primer listado; la resolución nombre→registro degrada al enum legacy si v85 aún no se aplicó (detección 42P01/PGRST205).
* `design_tags` — registro de enriquecimiento: `parent_name` (jerarquía dotted), `color`, `is_internal`, `created_by`; `workspace_id NULL` = tag global (índice funcional con `COALESCE`).
* `design_tag_aliases` — alias → canónico; la sustitución vive en `shared/tagNormalize.ts` y se aplica en MCP (`set_file_meta`, `tag_template`) y REST antes de persistir.
* Índice nuevo: `idx_dfm_ws_category` (facetas).

## 3. Superficie MCP (MCP-first)

* `design_taxonomy` — categorías + tags del workspace con conteos de uso (siembra perezosa incluida).
* `design_category_create|rename|delete` — CRUD del registro.
* `design_tag_register|update|delete` + `design_tag_alias_set` — registro de tags y aliases.
* `tag_template` / `untag_template` / `set_file_meta` / `get_file_meta` — membresía. `set_file_meta` resuelve `brand` nombre→`brand_id` (ilike, crea la marca si es nueva — el grafo lee `brand_id` primero) y `category` nombre→registro.
* `brands_list` / `brands_create` — marcas como objetos de primera clase (`brands_create` batch e idempotente; los contenedores DS se auto-regeneran por el lazy self-heal existente).
* `find_templates` — filtro componible por `brand`, `category`, `tags` (AND), `contentKind`, `facets:true` (conteos para dropdowns).
* `query_design_graph` — nodos + ejes del grafo con filtro por categoría.

## 4. Superficie REST

* `GET /api/meta/:templateId/taxonomy` (categorías con conteos/color/scope + tags con registro, scope del workspace del archivo), `PUT /api/templates/:id/meta` (resolución brand/category/tags idéntica al MCP), `GET /api/graph` (nodos con `category` + `tags`), `GET /api/brand-graph` (árbol workspace→marcas→categorías→archivos con `tags`).

## 5. UI

* **Paneles de info** (`FileInfoPanel`): selector de marca (existente), combobox de categoría con conteos y creación inline, input de tags con autocomplete del tag cloud del workspace.
* **Archivos** (`Dashboard`): dropdowns faceta Marca / Categoría / Etiqueta con conteos — **AND entre facetas, OR dentro de una**; un archivo sin meta no cruza ninguna faceta activa; botón «✕ Filtros».
* **Second brain** (`BrandGraphCanvas`): capa de nodos etiqueta (hub top-24 por grado, órbita propia, toggle «# Etiquetas»); `GraphTab`/`designGraph` con rama «Etiquetas» equivalente.

## 6. Flujo objetivo (usuario → su IA)

1. «Tráeme todos los archivos que tengo» → `find_templates {workspaceId}`.
2. «Crea todas estas marcas» → `brands_create {names:[…]}` (idempotente).
3. «Asigna estos archivos a estas marcas» → `set_file_meta {templateId, brand}` por archivo.
4. Todo aparece en el second brain (marcas → categorías → archivos → etiquetas) porque UI e IA escriben la misma `design_file_meta`.

## 7. Fase 2 — implementada (2026-10-26)

* **Jerarquía heredada en el grafo** — `shared/tagHierarchy.ts` (puro) deriva el árbol de los paths punteados solos: `buildTagTree` crea ancestros implícitos (`redes.instagram.stories` cuelga de un `redes.instagram` visible aunque nadie etiquetó ese path exacto) y agrega `totalDegree` bottom-up; `selectVisibleTags` toma top-N por grado de subárbol con clausura de ancestros. La rama «Etiquetas» de `designGraph.ts` y la capa de tags de `BrandGraphCanvas.tsx` anidan hijos bajo su padre (órbita `TAG_CHILD_ORBIT`); los archivos siguen colgando solo de su tag exacto.
* **Taxonomía global con gobernanza** — `design_tag_register` acepta `scope:'global'` (fila `design_tags.workspace_id NULL`: vocabulario de la cuenta, visible en `design_taxonomy` y en la REST con `scope:'global'`) y promueve tags de workspace existentes. Escribir lo global lo gobierna el owner (`assertGlobalTagGovernance` en mcp.mjs: admin key, workspace key con rol owner/admin, o sesión de usuario dueña del workspace — `workspaces.owner_id` o `workspace_members` role='owner'); aplica al alta/promoción, `design_tag_update` y `design_tag_delete` de filas globales. Las categorías siguen por workspace a propósito: son ramas estructurales del grafo de cada workspace.
* **Sugerencias automáticas de tags** — `shared/tagSuggest.ts` (puro, determinista, cero LLM): puntúa overlap de tokens de contenido, hermanas por padre registrado, popularidad en el workspace y co-ocurrencia histórica (semilla = tags actuales; cold start por categoría) y devuelve razones por sugerencia. Misma fuente para las tres puertas: MCP `design_tag_suggest`, REST `GET /api/meta/:templateId/tag-suggestions` y los chips «Sugerencias» del panel de info (`FileInfoPanel`). Ambas superficies degradan si las tablas de v85 no existen.

Verificación: `QA/req061-taxonomy-fase2.test.mjs` (16/16), `npx tsc --noEmit` root y api limpios.
