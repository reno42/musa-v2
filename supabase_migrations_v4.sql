-- ═══════════════════════════════════════════════════════════════
-- Futuraria Design — Migration v4: Design File Metadata + Graph
-- Run in Supabase SQL Editor. Idempotent (safe to re-run).
-- ═══════════════════════════════════════════════════════════════

-- ============================================================
-- TABLE: design_file_meta
-- Human-curated and AI-curated metadata for design files.
-- Keyed by template_id (FK, cascade) — NOT by file_path.
-- cover_image_url (curated) coexists with templates.thumbnail (auto).
-- UI prefers cover_image_url, falls back to thumbnail.
-- ============================================================
CREATE TABLE IF NOT EXISTS design_file_meta (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id     TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  workspace_id    TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  brand           TEXT,
  tags            TEXT[] DEFAULT '{}',
  theme           TEXT,
  format          TEXT,           -- "web" | "mobile" | "social" | "print" | "email"
  file_type       TEXT,           -- "frame" | "deck" | "template" | "export"
  cover_image_url TEXT,           -- Supabase Storage public URL
  obsidian_link   TEXT,           -- obsidian://open?vault=...&file=...
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(template_id)
);

CREATE INDEX IF NOT EXISTS idx_dfm_brand     ON design_file_meta(brand);
CREATE INDEX IF NOT EXISTS idx_dfm_tags      ON design_file_meta USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_dfm_workspace ON design_file_meta(workspace_id);
CREATE INDEX IF NOT EXISTS idx_dfm_format    ON design_file_meta(format);

-- ============================================================
-- STORAGE BUCKET: design-covers
-- Public bucket for curated cover images.
-- Max file size: 1 MB. Allowed types: PNG, JPEG.
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'design-covers',
  'design-covers',
  true,
  1048576,
  ARRAY['image/png', 'image/jpeg']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 1048576,
  allowed_mime_types = ARRAY['image/png', 'image/jpeg'];

-- RLS for design-covers bucket (public read, insert via API service key)
DROP POLICY IF EXISTS "Public read design-covers" ON storage.objects;
CREATE POLICY "Public read design-covers"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'design-covers');

DROP POLICY IF EXISTS "Insert to design-covers" ON storage.objects;
CREATE POLICY "Insert to design-covers"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'design-covers');

DROP POLICY IF EXISTS "Delete from design-covers" ON storage.objects;
CREATE POLICY "Delete from design-covers"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'design-covers');
