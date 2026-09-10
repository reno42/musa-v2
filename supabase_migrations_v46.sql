-- v46 — Universal design-import jobs and private source storage.
-- Apply after v45. Idempotent and safe to re-run.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_connections_one_figma
  ON workspace_mcp_connections(workspace_id) WHERE provider = 'figma';

CREATE TABLE IF NOT EXISTS design_import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  idempotency_key TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('svg', 'psd', 'ai', 'pdf', 'fig', 'figma', 'image')),
  source_name TEXT NOT NULL,
  source_path TEXT,
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'analyzing', 'converting', 'ready', 'partial', 'committing', 'committed', 'error')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  result JSONB,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  error TEXT,
  template_id TEXT REFERENCES templates(id) ON DELETE SET NULL,
  committed_frame_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, idempotency_key),
  CHECK (source_path IS NULL OR left(source_path, length(workspace_id || '/' || id::text || '/')) = workspace_id || '/' || id::text || '/')
);

CREATE INDEX IF NOT EXISTS idx_design_import_jobs_workspace_created
  ON design_import_jobs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_design_import_jobs_expiry
  ON design_import_jobs(expires_at) WHERE status <> 'committed';

ALTER TABLE design_import_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "design_import_jobs_workspace_read" ON design_import_jobs;
CREATE POLICY "design_import_jobs_workspace_read" ON design_import_jobs FOR SELECT
  USING (has_workspace_role(workspace_id, 'viewer'));

DROP POLICY IF EXISTS "design_import_jobs_workspace_write" ON design_import_jobs;
CREATE POLICY "design_import_jobs_workspace_write" ON design_import_jobs FOR ALL
  USING (has_workspace_role(workspace_id, 'editor'))
  WITH CHECK (has_workspace_role(workspace_id, 'editor'));

-- Converted HTML and job state are authored only by the authenticated API.
REVOKE INSERT, UPDATE, DELETE ON design_import_jobs FROM authenticated, anon;
GRANT SELECT ON design_import_jobs TO authenticated;
GRANT ALL ON design_import_jobs TO service_role;

CREATE OR REPLACE FUNCTION touch_design_import_job_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_design_import_jobs_updated_at ON design_import_jobs;
CREATE TRIGGER trg_design_import_jobs_updated_at
BEFORE UPDATE ON design_import_jobs
FOR EACH ROW EXECUTE FUNCTION touch_design_import_job_updated_at();

CREATE OR REPLACE FUNCTION public.commit_design_import(
  target_job UUID, target_workspace TEXT, target_template TEXT, imported_frames JSONB
) RETURNS JSONB LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  job design_import_jobs%ROWTYPE;
  template_data JSONB;
  next_frames JSONB;
  ids JSONB;
BEGIN
  SELECT * INTO job FROM design_import_jobs
    WHERE id = target_job AND workspace_id = target_workspace FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Import job not found'; END IF;
  IF job.template_id IS NOT NULL AND job.template_id <> target_template THEN
    RAISE EXCEPTION 'Import already belongs to another template';
  END IF;
  IF job.status = 'committed' THEN
    RETURN jsonb_build_object('id', job.id, 'status', 'committed', 'templateId', target_template, 'frameIds', job.committed_frame_ids);
  END IF;
  IF job.status NOT IN ('ready', 'partial', 'committing') THEN RAISE EXCEPTION 'Import is not ready'; END IF;
  IF jsonb_typeof(imported_frames) <> 'array' OR jsonb_array_length(imported_frames) = 0 THEN
    RAISE EXCEPTION 'Frames are required';
  END IF;
  SELECT data INTO template_data FROM templates
    WHERE id = target_template AND workspace_id = target_workspace AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Template not found'; END IF;
  SELECT coalesce(jsonb_agg(frame->'id'), '[]'::jsonb) INTO ids FROM jsonb_array_elements(imported_frames) frame;
  SELECT coalesce(jsonb_agg(frame), '[]'::jsonb) INTO next_frames
    FROM jsonb_array_elements(coalesce(template_data->'frames', '[]'::jsonb)) frame
    WHERE NOT (ids @> jsonb_build_array(frame->'id'));
  next_frames := next_frames || imported_frames;
  UPDATE templates SET data = jsonb_set(jsonb_set(template_data, '{frames}', next_frames), '{engine}', '"html"'::jsonb),
    updated_at = NOW(), content_updated_at = NOW() WHERE id = target_template;
  UPDATE design_import_jobs SET status = 'committed', progress = 100,
    template_id = target_template, committed_frame_ids = ids WHERE id = target_job;
  RETURN jsonb_build_object('id', target_job, 'status', 'committed', 'templateId', target_template, 'frameIds', ids);
END;
$$;
REVOKE ALL ON FUNCTION public.commit_design_import(UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_design_import(UUID, TEXT, TEXT, JSONB) TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'design-imports', 'design-imports', FALSE, 52428800,
  ARRAY['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'application/postscript', 'application/illustrator', 'application/octet-stream', 'image/vnd.adobe.photoshop', 'application/x-photoshop']
)
ON CONFLICT (id) DO UPDATE SET
  public = FALSE,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "design_import_sources_read" ON storage.objects;
CREATE POLICY "design_import_sources_read" ON storage.objects FOR SELECT
USING (
  bucket_id = 'design-imports'
  AND EXISTS (
    SELECT 1 FROM design_import_jobs job
    WHERE job.workspace_id = (storage.foldername(name))[1]
      AND job.id::text = (storage.foldername(name))[2]
      AND has_workspace_role(job.workspace_id, 'viewer')
  )
);

DROP POLICY IF EXISTS "design_import_sources_insert" ON storage.objects;
CREATE POLICY "design_import_sources_insert" ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'design-imports'
  AND EXISTS (
    SELECT 1 FROM design_import_jobs job
    WHERE job.workspace_id = (storage.foldername(name))[1]
      AND job.id::text = (storage.foldername(name))[2]
      AND has_workspace_role(job.workspace_id, 'editor')
  )
);

DROP POLICY IF EXISTS "design_import_sources_update" ON storage.objects;
CREATE POLICY "design_import_sources_update" ON storage.objects FOR UPDATE
USING (
  bucket_id = 'design-imports'
  AND EXISTS (
    SELECT 1 FROM design_import_jobs job
    WHERE job.workspace_id = (storage.foldername(name))[1]
      AND job.id::text = (storage.foldername(name))[2]
      AND has_workspace_role(job.workspace_id, 'editor')
  )
)
WITH CHECK (
  bucket_id = 'design-imports'
  AND EXISTS (
    SELECT 1 FROM design_import_jobs job
    WHERE job.workspace_id = (storage.foldername(name))[1]
      AND job.id::text = (storage.foldername(name))[2]
      AND has_workspace_role(job.workspace_id, 'editor')
  )
);

DROP POLICY IF EXISTS "design_import_sources_delete" ON storage.objects;
CREATE POLICY "design_import_sources_delete" ON storage.objects FOR DELETE
USING (
  bucket_id = 'design-imports'
  AND EXISTS (
    SELECT 1 FROM design_import_jobs job
    WHERE job.workspace_id = (storage.foldername(name))[1]
      AND job.id::text = (storage.foldername(name))[2]
      AND has_workspace_role(job.workspace_id, 'editor')
  )
);
