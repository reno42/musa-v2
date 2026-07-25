-- ============================================================
-- Migration v6: Bug Reports + Screenshots
-- Run in Supabase SQL Editor. Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS bug_reports (
  id             TEXT PRIMARY KEY DEFAULT ('bug_' || substr(md5(random()::text), 1, 16)),
  user_id        TEXT,
  description    TEXT NOT NULL,
  url            TEXT,
  device_info    JSONB DEFAULT '{}',
  console_errors JSONB DEFAULT '[]',
  screenshot_url TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  resolved_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bug_reports_created ON bug_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bug_reports_user    ON bug_reports(user_id);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('bug-screenshots', 'bug-screenshots', true, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp'];

DROP POLICY IF EXISTS "Public read bug-screenshots" ON storage.objects;
CREATE POLICY "Public read bug-screenshots" ON storage.objects FOR SELECT
  USING (bucket_id = 'bug-screenshots');

DROP POLICY IF EXISTS "Insert to bug-screenshots" ON storage.objects;
CREATE POLICY "Insert to bug-screenshots" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'bug-screenshots');

ALTER TABLE bug_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can insert bug_reports" ON bug_reports;
CREATE POLICY "Anyone can insert bug_reports" ON bug_reports FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated can read bug_reports" ON bug_reports;
CREATE POLICY "Authenticated can read bug_reports" ON bug_reports FOR SELECT
  USING (auth.uid() IS NOT NULL OR user_id IS NOT NULL);
