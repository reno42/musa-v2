-- 30_v2_import_html — Importar HTML por el motor de importaciones (editor, MCP y API).
-- design_import_jobs acepta HTML pegado, URL y ZIP (HTML + CSS + imágenes + fuentes),
-- y el bucket privado design-imports acepta ZIP para la subida firmada desde el editor.
-- Idempotente: se puede correr varias veces.

alter table public.design_import_jobs drop constraint if exists design_import_jobs_source_type_check;
alter table public.design_import_jobs add constraint design_import_jobs_source_type_check
  check (source_type = any (array['svg','psd','ai','pdf','fig','figma','image','html','url','zip']));

update storage.buckets
   set allowed_mime_types = (
     select array(select distinct unnest(coalesce(allowed_mime_types, '{}'::text[]) || array['application/zip','application/x-zip-compressed','application/x-zip','text/html']))
   )
 where id = 'design-imports';
