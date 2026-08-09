-- ═══════════════════════════════════════════════════════════════
-- FUTURARIA v21 — design_file_meta.category
--
-- The brand table ("Red de Marcas → Tabla") shows a Categoria column with
-- the four branches a file can hang from: Design System · Plantillas ·
-- Assets · Archivos. Until now that branch was DERIVED inside
-- services/brandGraph.ts and stored nowhere, so picking a value in the
-- table wrote to a column that did not exist, the API dropped it, and the
-- cell snapped back on the next refresh with no error anywhere.
--
-- NULL / empty keeps the old derived behaviour (Archivos for design files).
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE design_file_meta
  ADD COLUMN IF NOT EXISTS category TEXT;

COMMENT ON COLUMN design_file_meta.category IS
  'Branch this file hangs from in the brand graph: Design System | Plantillas | Assets | Archivos. NULL = Archivos (the default for design files).';

CREATE INDEX IF NOT EXISTS idx_dfm_category
  ON design_file_meta(workspace_id, category);
