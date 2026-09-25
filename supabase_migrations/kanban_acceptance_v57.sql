-- Copia de ../supabase_migrations_v57.sql (convención v56: raíz = versión
-- canónica que vigila scripts/check-migrations.mjs; carpeta = nombre
-- descriptivo). REQ-026 Item 1 — ver el archivo raíz para el detalle.

UPDATE design_kanban_tasks
SET acceptance = (
  SELECT COALESCE(jsonb_agg(to_jsonb(trim(line))), '[]'::jsonb)
  FROM unnest(string_to_array(acceptance #>> '{}', E'\n')) AS line
  WHERE trim(line) <> ''
)
WHERE jsonb_typeof(acceptance) = 'string';

-- Verificación post-migración: debe devolver 0 filas.
SELECT id, jsonb_typeof(acceptance) AS acceptance_type
FROM design_kanban_tasks
WHERE acceptance IS NOT NULL AND jsonb_typeof(acceptance) <> 'array';
