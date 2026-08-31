-- Futuraria Design v40 — explicit preview capture provenance.
-- Idempotent: safe to run after applying the columns manually.

ALTER TABLE design_file_meta
  ADD COLUMN IF NOT EXISTS cover_captured_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cover_source TEXT;

COMMENT ON COLUMN design_file_meta.cover_captured_at IS
  'When the current cover image was captured or uploaded. Compared with templates.updated_at to detect a stale preview.';

COMMENT ON COLUMN design_file_meta.cover_source IS
  'How the current cover was produced: snapshot, upload, or external.';
