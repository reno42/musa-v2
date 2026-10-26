# REQ-061 — Taxonomía de diseño, filtros faceta y second brain interconectado

**Estado:** Fase 1 + parte de Fase 2 implementadas (MCP-first + REST + UI). · **Fecha:** 2026-10-26 · **Migración:** `supabase_migrations_v85.sql` (manual, Supabase SQL Editor).

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

## 7. Fuera de alcance (Fase 2 restante)

* Herencia visual de jerarquía de tags en el grafo (hoy jerarquía registrada, grafo plano por tag).
* Taxonomía global entre workspaces con gobernanza (`scope:'global'` ya previsto en schema).
* Sugerencias automáticas de tags por similitud de contenido.
