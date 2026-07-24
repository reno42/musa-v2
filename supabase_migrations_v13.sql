-- Futuraria Design — Migration v13: design version history (hybrid storage)
-- Apply after v12. Idempotent and safe to re-run.
--
-- WHY HYBRID: version CONTENT (all frames of a design, ~70KB) is written as a
-- gzipped file in the `design-versions` bucket, while Postgres keeps only a
-- ~200-byte metadata row. Keeping content in the templates.data JSONB made
-- every design open download its whole history (the 502 source) and burned the
-- 500MB database budget ~10x faster than the 1GB storage budget.

CREATE TABLE IF NOT EXISTS template_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id TEXT NOT NULL,
  workspace_id UUID,
  -- 'auto'   → created by a save; rotated, only the newest N survive
  -- 'marked' → created by Ctrl/Cmd+S or the Save button; never auto-deleted
  kind TEXT NOT NULL DEFAULT 'auto' CHECK (kind IN ('auto', 'marked')),
  label TEXT,
  -- Who produced this state: 'human:<email>', 'agent:lara', 'agent:claude-opus-5'…
  author TEXT NOT NULL DEFAULT 'unknown',
  -- Per-frame content hashes, so an agent can tell WHICH frames changed
  -- between two versions without downloading either payload.
  frame_hashes JSONB NOT NULL DEFAULT '{}'::jsonb,
  frame_count INTEGER NOT NULL DEFAULT 0,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  -- Path inside the design-versions bucket: {template_id}/{id}.json.gz
  storage_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The list query: newest first for one design.
CREATE INDEX IF NOT EXISTS template_versions_template_created_idx
  ON template_versions (template_id, created_at DESC);
-- Retention sweep: find the oldest 'auto' rows of a design.
CREATE INDEX IF NOT EXISTS template_versions_template_kind_idx
  ON template_versions (template_id, kind, created_at DESC);

ALTER TABLE template_versions ENABLE ROW LEVEL SECURITY;

-- The API reaches Supabase with the service key, which bypasses RLS. These
-- policies only matter if the table is ever read with an anon/user key.
DROP POLICY IF EXISTS "Service role manages versions" ON template_versions;
CREATE POLICY "Service role manages versions"
  ON template_versions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ── Storage bucket for version payloads ──
-- Private: version content is only ever read server-side through the API.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('design-versions', 'design-versions', FALSE, 10485760)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Service role manages version files" ON storage.objects;
CREATE POLICY "Service role manages version files"
  ON storage.objects FOR ALL
  USING (bucket_id = 'design-versions' AND auth.role() = 'service_role')
  WITH CHECK (bucket_id = 'design-versions' AND auth.role() = 'service_role');

-- Verification
SELECT 'template_versions table', COUNT(*) FROM template_versions;
SELECT 'design-versions bucket', COUNT(*) FROM storage.buckets WHERE id = 'design-versions';
