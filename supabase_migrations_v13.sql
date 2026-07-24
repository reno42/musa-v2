-- Futuraria Design — Migration v13: design version history (hybrid storage)
-- Apply after v12. Idempotent and safe to re-run.
--
-- This migration supports both installations:
--   1. the legacy table (TEXT id, version_number, data), and
--   2. a new installation that stores payloads in Storage.
--
-- Legacy rows are preserved as marked versions. New version payloads are
-- gzipped into the private `design-versions` bucket.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS template_versions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  workspace_id TEXT,
  -- Retained for backward compatibility with the original table.
  version_number INTEGER NOT NULL DEFAULT 0,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  message TEXT,
  -- Hybrid history metadata.
  kind TEXT NOT NULL DEFAULT 'auto',
  label TEXT,
  author TEXT NOT NULL DEFAULT 'unknown',
  frame_hashes JSONB NOT NULL DEFAULT '{}'::jsonb,
  frame_count INTEGER NOT NULL DEFAULT 0,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  -- NULL identifies a preserved legacy row whose payload remains in `data`.
  storage_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CREATE TABLE IF NOT EXISTS does not evolve an existing legacy table.
-- Add every hybrid column before creating indexes that depend on it.
ALTER TABLE template_versions ADD COLUMN IF NOT EXISTS workspace_id TEXT;
ALTER TABLE template_versions ADD COLUMN IF NOT EXISTS version_number INTEGER;
ALTER TABLE template_versions ADD COLUMN IF NOT EXISTS data JSONB;
ALTER TABLE template_versions ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE template_versions ADD COLUMN IF NOT EXISTS kind TEXT;
ALTER TABLE template_versions ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE template_versions ADD COLUMN IF NOT EXISTS author TEXT;
ALTER TABLE template_versions ADD COLUMN IF NOT EXISTS frame_hashes JSONB;
ALTER TABLE template_versions ADD COLUMN IF NOT EXISTS frame_count INTEGER;
ALTER TABLE template_versions ADD COLUMN IF NOT EXISTS size_bytes INTEGER;
ALTER TABLE template_versions ADD COLUMN IF NOT EXISTS storage_path TEXT;
ALTER TABLE template_versions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

-- A partially applied early v13 could have created workspace_id as UUID even
-- though workspaces.id is TEXT. Normalize it before the API writes ws_* IDs.
ALTER TABLE template_versions
  ALTER COLUMN workspace_id TYPE TEXT USING workspace_id::text;

-- Preserve legacy versions permanently. They have no Storage path and must
-- never enter the rolling auto-version retention sweep.
UPDATE template_versions
SET kind = CASE WHEN storage_path IS NULL THEN 'marked' ELSE 'auto' END
WHERE kind IS NULL;

UPDATE template_versions
SET label = COALESCE(
  NULLIF(message, ''),
  CASE
    WHEN version_number IS NOT NULL AND version_number > 0
      THEN 'Versión heredada ' || version_number::text
    ELSE 'Versión heredada'
  END
)
WHERE label IS NULL;

UPDATE template_versions
SET author = 'unknown'
WHERE author IS NULL OR btrim(author) = '';

UPDATE template_versions
SET frame_hashes = '{}'::jsonb
WHERE frame_hashes IS NULL;

UPDATE template_versions
SET frame_count = CASE
  WHEN jsonb_typeof(data->'frames') = 'array' THEN jsonb_array_length(data->'frames')
  WHEN jsonb_typeof(data->'data'->'frames') = 'array' THEN jsonb_array_length(data->'data'->'frames')
  ELSE 0
END
WHERE frame_count IS NULL OR frame_count = 0;

UPDATE template_versions
SET size_bytes = octet_length(COALESCE(data, '{}'::jsonb)::text)
WHERE size_bytes IS NULL OR size_bytes = 0;

UPDATE template_versions version
SET workspace_id = template.workspace_id
FROM templates template
WHERE version.template_id = template.id
  AND version.workspace_id IS NULL;

UPDATE template_versions SET version_number = 0 WHERE version_number IS NULL;
UPDATE template_versions SET data = '{}'::jsonb WHERE data IS NULL;
UPDATE template_versions SET created_at = NOW() WHERE created_at IS NULL;

-- The primary key type differs between old and new installations. Give each
-- type a compatible generated default without rewriting existing IDs.
DO $$
DECLARE
  id_type TEXT;
BEGIN
  SELECT data_type INTO id_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'template_versions'
    AND column_name = 'id';

  IF id_type = 'uuid' THEN
    ALTER TABLE template_versions ALTER COLUMN id SET DEFAULT gen_random_uuid();
  ELSE
    ALTER TABLE template_versions ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
  END IF;
END $$;

ALTER TABLE template_versions ALTER COLUMN version_number SET DEFAULT 0;
ALTER TABLE template_versions ALTER COLUMN version_number SET NOT NULL;
ALTER TABLE template_versions ALTER COLUMN data SET DEFAULT '{}'::jsonb;
ALTER TABLE template_versions ALTER COLUMN data SET NOT NULL;
ALTER TABLE template_versions ALTER COLUMN kind SET DEFAULT 'auto';
ALTER TABLE template_versions ALTER COLUMN kind SET NOT NULL;
ALTER TABLE template_versions ALTER COLUMN author SET DEFAULT 'unknown';
ALTER TABLE template_versions ALTER COLUMN author SET NOT NULL;
ALTER TABLE template_versions ALTER COLUMN frame_hashes SET DEFAULT '{}'::jsonb;
ALTER TABLE template_versions ALTER COLUMN frame_hashes SET NOT NULL;
ALTER TABLE template_versions ALTER COLUMN frame_count SET DEFAULT 0;
ALTER TABLE template_versions ALTER COLUMN frame_count SET NOT NULL;
ALTER TABLE template_versions ALTER COLUMN size_bytes SET DEFAULT 0;
ALTER TABLE template_versions ALTER COLUMN size_bytes SET NOT NULL;
ALTER TABLE template_versions ALTER COLUMN storage_path DROP NOT NULL;
ALTER TABLE template_versions ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE template_versions ALTER COLUMN created_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.template_versions'::regclass
      AND conname = 'template_versions_kind_check'
  ) THEN
    ALTER TABLE template_versions
      ADD CONSTRAINT template_versions_kind_check
      CHECK (kind IN ('auto', 'marked'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS template_versions_template_created_idx
  ON template_versions (template_id, created_at DESC);
CREATE INDEX IF NOT EXISTS template_versions_template_kind_idx
  ON template_versions (template_id, kind, created_at DESC);

ALTER TABLE template_versions ENABLE ROW LEVEL SECURITY;

-- Remove the old cross-tenant policies and replace them with workspace-scoped
-- access. Server requests may use the signed-in user's scoped Supabase client.
DROP POLICY IF EXISTS "Users can view versions" ON template_versions;
DROP POLICY IF EXISTS "Users can create versions" ON template_versions;
DROP POLICY IF EXISTS "Service role full access on template_versions" ON template_versions;
DROP POLICY IF EXISTS "Service role manages versions" ON template_versions;
DROP POLICY IF EXISTS "template_versions_workspace_read" ON template_versions;
DROP POLICY IF EXISTS "template_versions_workspace_insert" ON template_versions;
DROP POLICY IF EXISTS "template_versions_workspace_update" ON template_versions;
DROP POLICY IF EXISTS "template_versions_workspace_delete" ON template_versions;

CREATE POLICY "template_versions_workspace_read"
  ON template_versions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM templates template
      WHERE template.id = template_versions.template_id
        AND template.workspace_id = template_versions.workspace_id
        AND has_workspace_role(template.workspace_id, 'viewer')
    )
  );

CREATE POLICY "template_versions_workspace_insert"
  ON template_versions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM templates template
      WHERE template.id = template_versions.template_id
        AND template.workspace_id = template_versions.workspace_id
        AND has_workspace_role(template.workspace_id, 'editor')
    )
  );

CREATE POLICY "template_versions_workspace_update"
  ON template_versions FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM templates template
      WHERE template.id = template_versions.template_id
        AND template.workspace_id = template_versions.workspace_id
        AND has_workspace_role(template.workspace_id, 'editor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM templates template
      WHERE template.id = template_versions.template_id
        AND template.workspace_id = template_versions.workspace_id
        AND has_workspace_role(template.workspace_id, 'editor')
    )
  );

CREATE POLICY "template_versions_workspace_delete"
  ON template_versions FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM templates template
      WHERE template.id = template_versions.template_id
        AND template.workspace_id = template_versions.workspace_id
        AND has_workspace_role(template.workspace_id, 'editor')
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON template_versions TO authenticated;

-- Private Storage bucket for new hybrid payloads.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('design-versions', 'design-versions', FALSE, 10485760)
ON CONFLICT (id) DO UPDATE
SET public = FALSE,
    file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS "Service role manages version files" ON storage.objects;
DROP POLICY IF EXISTS "workspace reads version files" ON storage.objects;
DROP POLICY IF EXISTS "workspace inserts version files" ON storage.objects;
DROP POLICY IF EXISTS "workspace updates version files" ON storage.objects;
DROP POLICY IF EXISTS "workspace deletes version files" ON storage.objects;

CREATE POLICY "workspace reads version files"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'design-versions'
    AND EXISTS (
      SELECT 1 FROM templates template
      WHERE template.id = split_part(storage.objects.name, '/', 1)
        AND has_workspace_role(template.workspace_id, 'viewer')
    )
  );

CREATE POLICY "workspace inserts version files"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'design-versions'
    AND EXISTS (
      SELECT 1 FROM templates template
      WHERE template.id = split_part(storage.objects.name, '/', 1)
        AND has_workspace_role(template.workspace_id, 'editor')
    )
  );

CREATE POLICY "workspace updates version files"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'design-versions'
    AND EXISTS (
      SELECT 1 FROM templates template
      WHERE template.id = split_part(storage.objects.name, '/', 1)
        AND has_workspace_role(template.workspace_id, 'editor')
    )
  )
  WITH CHECK (
    bucket_id = 'design-versions'
    AND EXISTS (
      SELECT 1 FROM templates template
      WHERE template.id = split_part(storage.objects.name, '/', 1)
        AND has_workspace_role(template.workspace_id, 'editor')
    )
  );

CREATE POLICY "workspace deletes version files"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'design-versions'
    AND EXISTS (
      SELECT 1 FROM templates template
      WHERE template.id = split_part(storage.objects.name, '/', 1)
        AND has_workspace_role(template.workspace_id, 'editor')
    )
  );

-- Verification
SELECT
  COUNT(*) AS total_versions,
  COUNT(*) FILTER (WHERE storage_path IS NULL) AS preserved_legacy_versions,
  COUNT(*) FILTER (WHERE storage_path IS NOT NULL) AS hybrid_versions
FROM template_versions;
SELECT id, public, file_size_limit
FROM storage.buckets
WHERE id = 'design-versions';
