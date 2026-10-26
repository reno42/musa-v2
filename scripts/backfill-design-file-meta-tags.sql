-- scripts/backfill-design-file-meta-tags.sql
-- REQ-062 Fase 2 — Backfill one-time: llenar design_file_meta.tags desde el
-- mirror legacy de tags en la fila del template.
--
-- OJO (verificado en repo): templates NO tiene columna tags. El mirror que
-- escribia el tag_template viejo vive DENTRO del blob JSONB:
--   templates.data -> 'tags'  (jsonb array)
-- El store canonical es design_file_meta.tags (TEXT[], UNIQUE(template_id),
-- migracion v4) — la tabla que find_templates, get_file_meta, el design graph
-- y brandFiling consultan.
--
-- Semantica (REQ-062 Fase 2):
--   1. Inserta fila meta para templates con tags legacy y SIN fila (o con
--      fila sin tags). Nunca pisa meta existente con tags.
--   2. Idempotente: re-ejecutar no duplica ni sobreescribe nada.
--
-- COMO CORRERLO: Supabase SQL Editor contra el proyecto de produccion
-- (workflow manual del repo). NO correr el set completo de supabase_migrations_*
-- contra prod (drift historico) — solo este script.
--
-- Ejecutar en orden: DRY-RUN (ver cuantos) -> PASO 1 -> PASO 2 -> VERIFICACION.

-- ════════════════════════════════════════════════════════════════════
-- DRY-RUN — ¿Cuantos templates tienen tags legacy sin fila meta util?
-- ════════════════════════════════════════════════════════════════════
select count(*) as templates_to_backfill
from templates t
where t.deleted_at is null
  and jsonb_typeof(t.data -> 'tags') = 'array'
  and jsonb_array_length(t.data -> 'tags') > 0
  and not exists (
    select 1 from design_file_meta m
    where m.template_id = t.id
      and coalesce(array_length(m.tags, 1), 0) > 0
  );

-- Muestra de lo que se va a insertar (revision manual antes de los pasos):
select t.id,
       t.workspace_id,
       (select array_agg(btrim(tag) order by ord)
          from jsonb_array_elements_text(t.data -> 'tags') with ordinality as x(tag, ord)
       ) as tags_to_backfill
from templates t
where t.deleted_at is null
  and jsonb_typeof(t.data -> 'tags') = 'array'
  and jsonb_array_length(t.data -> 'tags') > 0
  and not exists (
    select 1 from design_file_meta m
    where m.template_id = t.id
      and coalesce(array_length(m.tags, 1), 0) > 0
  )
limit 50;

-- ════════════════════════════════════════════════════════════════════
-- PASO 1 — Templates CON tags legacy y SIN fila en design_file_meta.
-- Crea la fila con workspace_id del template y tags normalizados
-- (trim; descarta strings vacios).
-- ════════════════════════════════════════════════════════════════════
insert into design_file_meta (template_id, workspace_id, tags)
select t.id,
       t.workspace_id,
       coalesce((
         select array_agg(btrim(tag) order by ord)
           from jsonb_array_elements_text(t.data -> 'tags') with ordinality as x(tag, ord)
          where btrim(tag) <> ''
       ), '{}')
from templates t
where t.deleted_at is null
  and jsonb_typeof(t.data -> 'tags') = 'array'
  and jsonb_array_length(t.data -> 'tags') > 0
  and not exists (select 1 from design_file_meta m where m.template_id = t.id)
on conflict (template_id) do nothing;

-- ════════════════════════════════════════════════════════════════════
-- PASO 2 — Filas meta que YA existen pero con tags vacio: rellenarlas
-- desde el mirror legacy. Jamas toca filas con tags.
-- ════════════════════════════════════════════════════════════════════
update design_file_meta m
set tags = backfill.tags,
    updated_at = now()
from (
  select t.id,
         coalesce((
           select array_agg(btrim(tag) order by ord)
             from jsonb_array_elements_text(t.data -> 'tags') with ordinality as x(tag, ord)
            where btrim(tag) <> ''
         ), '{}') as tags
  from templates t
  where t.deleted_at is null
    and jsonb_typeof(t.data -> 'tags') = 'array'
    and jsonb_array_length(t.data -> 'tags') > 0
) backfill
where m.template_id = backfill.id
  and coalesce(array_length(m.tags, 1), 0) = 0;

-- ════════════════════════════════════════════════════════════════════
-- VERIFICACION — Debe devolver 0.
-- ════════════════════════════════════════════════════════════════════
select count(*) as pendientes
from templates t
where t.deleted_at is null
  and jsonb_typeof(t.data -> 'tags') = 'array'
  and jsonb_array_length(t.data -> 'tags') > 0
  and not exists (
    select 1 from design_file_meta m
    where m.template_id = t.id
      and coalesce(array_length(m.tags, 1), 0) > 0
  );

-- Sanity: los tags backfillearon y son visibles para find_templates:
select m.template_id, m.workspace_id, m.tags
from design_file_meta m
where coalesce(array_length(m.tags, 1), 0) > 0
order by m.updated_at desc nulls last
limit 20;
