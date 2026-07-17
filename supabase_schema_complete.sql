-- ═══════════════════════════════════════════════════════════════
-- Futuraria Design — Complete Database Schema
-- Run in Supabase SQL Editor or via Management API.
-- Idempotent: safe to re-run (all CREATE IF NOT EXISTS).
-- 7 tables + 4 indexes + 1 storage bucket + 5 RLS policies
-- ═══════════════════════════════════════════════════════════════

-- ============================================================
-- TABLE 1: workspaces
-- ============================================================
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT,
  member_ids TEXT[] DEFAULT '{}',
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE 2: templates
-- ============================================================
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID,
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- ============================================================
-- TABLE 3: recipes (design recipes / brand configs)
-- ============================================================
CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  workspace_id TEXT,
  structure JSONB NOT NULL DEFAULT '{}',
  template_html TEXT,
  template_css TEXT,
  preview_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Recipe enhancements (v3 — safe to re-run)
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS template_width  INTEGER DEFAULT 1080;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS template_height INTEGER DEFAULT 1080;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS variables      JSONB DEFAULT '{}'::jsonb;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS tags           TEXT[] DEFAULT '{}';
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS usage_count    INTEGER DEFAULT 0;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS created_by     TEXT;

CREATE INDEX IF NOT EXISTS idx_recipes_workspace ON recipes(workspace_id);
CREATE INDEX IF NOT EXISTS idx_recipes_tags ON recipes USING gin(tags);

-- ============================================================
-- TABLE 4: batch_jobs
-- ============================================================
CREATE TABLE IF NOT EXISTS batch_jobs (
  id TEXT PRIMARY KEY,
  template_id TEXT,
  recipe_id TEXT,
  status TEXT DEFAULT 'queued',
  total_count INTEGER DEFAULT 0,
  completed_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  results JSONB DEFAULT '[]',
  errors JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- ============================================================
-- TABLE 5: section_locks (multi-agent collaboration)
-- ============================================================
CREATE TABLE IF NOT EXISTS section_locks (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  acquired_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE(template_id, section_id)
);

-- ============================================================
-- TABLE 6: brands
-- ============================================================
CREATE TABLE IF NOT EXISTS brands (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  workspace_id TEXT,
  colors JSONB DEFAULT '[]',
  fonts JSONB DEFAULT '[]',
  logo JSONB,
  spacing JSONB,
  rules JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE 7: assets (uploaded images metadata)
-- ============================================================
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY DEFAULT ('asset_' || substr(md5(random()::text), 1, 16)),
  name TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'image/png',
  size_bytes BIGINT DEFAULT 0,
  url TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  tags TEXT[] DEFAULT '{}',
  workspace_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assets_workspace ON assets(workspace_id);
CREATE INDEX IF NOT EXISTS idx_assets_created_at ON assets(created_at DESC);

-- ============================================================
-- STORAGE BUCKET: design-assets
-- Public bucket for user-uploaded images.
-- Max file size: 10 MB. Allowed types: PNG, JPEG, SVG, WebP.
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'design-assets',
  'design-assets',
  true,
  10485760,
  ARRAY['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];

-- ============================================================
-- RLS POLICIES: design-assets bucket
-- The API uses service_role (bypasses RLS), but these policies
-- ensure public URLs work for <img src> tags.
-- ============================================================
DROP POLICY IF EXISTS "Public read design-assets" ON storage.objects;
CREATE POLICY "Public read design-assets"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'design-assets');

DROP POLICY IF EXISTS "Insert to design-assets" ON storage.objects;
CREATE POLICY "Insert to design-assets"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'design-assets');

DROP POLICY IF EXISTS "Delete from design-assets" ON storage.objects;
CREATE POLICY "Delete from design-assets"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'design-assets');

-- ============================================================
-- REALTIME: Enable on collaboration tables
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE recipes;
ALTER PUBLICATION supabase_realtime ADD TABLE batch_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE section_locks;
ALTER PUBLICATION supabase_realtime ADD TABLE brands;

-- ============================================================
-- TABLE 8: api_keys (F5 — API key management)
-- ============================================================
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  label TEXT DEFAULT 'API Key',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
