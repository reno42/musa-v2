-- ═══════════════════════════════════════════════════════════════════
-- v57 — REQ-026 Item 1: design_kanban_tasks.acceptance string → array
--
-- BUG-001 (dogfood 24-sep): filas legacy guardan acceptance como STRING
-- multilínea (verificadas por query: card_ms7xkdc8, card_ms7xx73e,
-- card_msdkgy36, card_ms8lf0aw) y otras como array — tipos mixtos en la
-- misma columna JSONB. El cliente ya normaliza (KanbanTab + Tabla vía
-- src/lib/kanbanNormalize.ts); esta migración mata la raíz en DB.
--
-- IDEMPOTENTE: sólo toca filas donde jsonb_typeof(acceptance)='string';
-- una segunda corrida no encuentra nada.
--
-- Cómo correrla (workflow estándar): Supabase SQL Editor → pegar este
-- archivo completo → Run. Luego actualizar .migration-version a v57.
--
-- Split idéntico al del cliente: partir por \n, trim, descartar vacíos.
-- ═══════════════════════════════════════════════════════════════════

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
