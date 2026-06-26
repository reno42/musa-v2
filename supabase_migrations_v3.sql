-- ═══════════════════════════════════════════════════════════════
-- DESIGN HARNESS V3: Assets + Recipes + Storage Buckets
-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- ── 1. design-assets Storage Bucket ──
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'design-assets',
  'design-assets',
  true,
  10485760, -- 10MB max per file
  ARRAY['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];

-- ── 2. assets table ──
CREATE TABLE IF NOT EXISTS assets (
  id          TEXT PRIMARY KEY DEFAULT ('asset_' || substr(md5(random()::text), 1, 16)),
  name        TEXT NOT NULL,
  filename    TEXT NOT NULL,
  mime_type   TEXT NOT NULL DEFAULT 'image/png',
  size_bytes  BIGINT DEFAULT 0,
  url         TEXT NOT NULL,
  width       INTEGER,
  height      INTEGER,
  tags        TEXT[] DEFAULT '{}',
  workspace_id TEXT,
  created_by  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assets_workspace ON assets(workspace_id);
CREATE INDEX IF NOT EXISTS idx_assets_created_at ON assets(created_at DESC);

-- ── 3. recipes table ──
CREATE TABLE IF NOT EXISTS recipes (
  id            TEXT PRIMARY KEY DEFAULT ('rec_' || substr(md5(random()::text), 1, 16)),
  name          TEXT NOT NULL,
  description   TEXT DEFAULT '',
  workspace_id  TEXT,
  template_html TEXT DEFAULT '',
  template_css  TEXT DEFAULT '',
  template_width  INTEGER DEFAULT 1080,
  template_height INTEGER DEFAULT 1080,
  structure     JSONB DEFAULT '{}'::jsonb,
  variables     JSONB DEFAULT '{}'::jsonb,
  preview_url   TEXT DEFAULT '',
  tags          TEXT[] DEFAULT '{}',
  usage_count   INTEGER DEFAULT 0,
  created_by    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recipes_workspace ON recipes(workspace_id);
CREATE INDEX IF NOT EXISTS idx_recipes_name ON recipes USING gin(to_tsvector('english', name));
CREATE INDEX IF NOT EXISTS idx_recipes_tags ON recipes USING gin(tags);

-- ── 4. batch_jobs table (if not already exists) ──
CREATE TABLE IF NOT EXISTS batch_jobs (
  id              TEXT PRIMARY KEY,
  template_id     TEXT,
  recipe_id       TEXT,
  status          TEXT DEFAULT 'pending',
  total_count     INTEGER DEFAULT 0,
  completed_count INTEGER DEFAULT 0,
  failed_count    INTEGER DEFAULT 0,
  results         JSONB DEFAULT '[]'::jsonb,
  errors          JSONB DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

-- ── 5. Storage RLS Policies ──
-- Allow public read access to design-assets bucket
DROP POLICY IF EXISTS "Public read design-assets" ON storage.objects;
CREATE POLICY "Public read design-assets"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'design-assets');

-- Allow authenticated insert to design-assets
DROP POLICY IF EXISTS "Insert to design-assets" ON storage.objects;
CREATE POLICY "Insert to design-assets"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'design-assets');

-- Allow authenticated delete from design-assets
DROP POLICY IF EXISTS "Delete from design-assets" ON storage.objects;
CREATE POLICY "Delete from design-assets"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'design-assets');

-- ── 6. Verify ──
SELECT 'Buckets:' as info, count(*)::text FROM storage.buckets WHERE id = 'design-assets'
UNION ALL
SELECT 'Assets table:', count(*)::text FROM information_schema.tables WHERE table_name = 'assets'
UNION ALL
SELECT 'Recipes table:', count(*)::text FROM information_schema.tables WHERE table_name = 'recipes';
