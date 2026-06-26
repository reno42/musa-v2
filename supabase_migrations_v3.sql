-- ═══════════════════════════════════════════════════════════════
-- DESIGN HARNESS V3: Assets + Recipe Enhancements + Storage
-- Run this in Supabase SQL Editor (https://npdycbfhtcccznbndrkl.supabase.co)
-- 
-- DB AUDIT (from DATABASE_SCHEMA.md + SUPABASE_MIGRATIONS_DESIGN_HARNESS.sql):
--   ✅ templates     — exists (JSONB-hybrid)
--   ✅ workspaces    — exists (JSONB-hybrid)
--   ✅ recipes       — exists (id, name, description, workspace_id, structure,
--                      template_html, template_css, preview_url, created_at, updated_at)
--   ✅ batch_jobs    — exists (id, template_id, recipe_id, status, total_count,
--                      completed_count, failed_count, results, errors, created_at, completed_at)
--   ✅ section_locks — exists
--   ✅ brands        — exists
--   ✅ design-exports bucket — exists
--   ❌ assets table  — NEW
--   ❌ design-assets bucket — NEW
--
-- This script only ADDS what's missing — no DROP, no destructive changes.
-- ═══════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- STEP 1: New Columns on Existing `recipes` Table
-- ─────────────────────────────────────────────────────────────
-- The recipes table already exists from SUPABASE_MIGRATIONS_DESIGN_HARNESS.sql.
-- These columns are needed by the enhanced save_recipe + batch_from_recipe MCP tools.
-- Using ADD COLUMN IF NOT EXISTS so it's safe to re-run.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE recipes ADD COLUMN IF NOT EXISTS template_width  INTEGER DEFAULT 1080;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS template_height INTEGER DEFAULT 1080;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS variables      JSONB DEFAULT '{}'::jsonb;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS tags           TEXT[] DEFAULT '{}';
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS usage_count    INTEGER DEFAULT 0;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS created_by     TEXT;

-- ═══════════════════════════════════════════════════════════════
-- STEP 2: New Indexes on `recipes`
-- ─────────────────────────────────────────────────────────────
-- GIN indexes for text search on name and tag filtering.
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_recipes_workspace ON recipes(workspace_id);
CREATE INDEX IF NOT EXISTS idx_recipes_tags ON recipes USING gin(tags);

-- ═══════════════════════════════════════════════════════════════
-- STEP 3: New `assets` Table
-- ─────────────────────────────────────────────────────────────
-- Stores metadata for uploaded images (PNG, JPG, SVG, WebP).
-- Actual files live in the design-assets Supabase Storage bucket.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS assets (
  id           TEXT PRIMARY KEY DEFAULT ('asset_' || substr(md5(random()::text), 1, 16)),
  name         TEXT NOT NULL,
  filename     TEXT NOT NULL,
  mime_type    TEXT NOT NULL DEFAULT 'image/png',
  size_bytes   BIGINT DEFAULT 0,
  url          TEXT NOT NULL,
  width        INTEGER,
  height       INTEGER,
  tags         TEXT[] DEFAULT '{}',
  workspace_id TEXT,
  created_by   TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assets_workspace ON assets(workspace_id);
CREATE INDEX IF NOT EXISTS idx_assets_created_at ON assets(created_at DESC);

-- ═══════════════════════════════════════════════════════════════
-- STEP 4: New `design-assets` Storage Bucket
-- ─────────────────────────────────────────────────────────────
-- Public bucket for user-uploaded images. design-exports already
-- exists for rendered exports — this is separate for raw uploads.
-- ═══════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'design-assets',
  'design-assets',
  true,
  10485760,  -- 10 MB max per file
  ARRAY['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];

-- ═══════════════════════════════════════════════════════════════
-- STEP 5: Storage RLS — Allow access to design-assets bucket
-- ─────────────────────────────────────────────────────────────
-- The API uses service_role key (bypasses RLS), but these ensure
-- public URLs work and future client-side access is possible.
-- ═══════════════════════════════════════════════════════════════

-- Public read (needed for <img src="..."> to work)
DROP POLICY IF EXISTS "Public read design-assets" ON storage.objects;
CREATE POLICY "Public read design-assets"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'design-assets');

-- Allow insert (service_role or authenticated)
DROP POLICY IF EXISTS "Insert to design-assets" ON storage.objects;
CREATE POLICY "Insert to design-assets"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'design-assets');

-- Allow delete
DROP POLICY IF EXISTS "Delete from design-assets" ON storage.objects;
CREATE POLICY "Delete from design-assets"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'design-assets');

-- ═══════════════════════════════════════════════════════════════
-- VERIFY: Run this block to confirm everything is in place
-- ═══════════════════════════════════════════════════════════════

SELECT 'design-assets bucket' as check_item,
       count(*)::text as result
FROM storage.buckets WHERE id = 'design-assets'
UNION ALL
SELECT 'assets table',
       count(*)::text
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'assets'
UNION ALL
SELECT 'recipes.template_width column',
       count(*)::text
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'recipes' AND column_name = 'template_width'
UNION ALL
SELECT 'recipes.variables column',
       count(*)::text
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'recipes' AND column_name = 'variables'
UNION ALL
SELECT 'recipes.tags column',
       count(*)::text
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'recipes' AND column_name = 'tags'
UNION ALL
SELECT 'recipes.usage_count column',
       count(*)::text
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'recipes' AND column_name = 'usage_count';

-- Done! All results should show '1'.
