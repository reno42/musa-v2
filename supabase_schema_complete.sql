-- ═══════════════════════════════════════════════════════════════
-- Futuraria Design — Complete Database Schema
-- Run in Supabase SQL Editor or via Management API.
-- Idempotent: safe to re-run (all CREATE IF NOT EXISTS,
-- ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE).
-- 7 tables + 4 indexes + 1 storage bucket + 5 RLS policies
-- + slug columns + slugify() function + 2 unique indexes (v7)
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
DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['recipes', 'batch_jobs', 'section_locks', 'brands']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = table_name
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', table_name);
    END IF;
  END LOOP;
END $$;

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

-- ============================================================
-- v7: URL slugs for workspaces + templates
-- ============================================================

-- Slug columns (idempotent)
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE templates   ADD COLUMN IF NOT EXISTS slug TEXT;

-- slugify() function: unaccent → em-dash→hyphen → lowercase →
-- collapse hyphens → reserved-word guard
CREATE OR REPLACE FUNCTION slugify(input TEXT) RETURNS TEXT AS $$
DECLARE
  result    TEXT;
  reserved  TEXT[] := ARRAY[
    'api','mcp','w','dashboard','assets','covers',
    'exports','storage','settings','graph','login',
    'admin','health','trash','landing','editor'
  ];
BEGIN
  result := unaccent(input);
  result := regexp_replace(result, '[–—―]', '-', 'g');
  result := lower(result);
  result := regexp_replace(result, '[^a-z0-9\-]', '-', 'g');
  result := regexp_replace(result, '-+', '-', 'g');
  result := trim('-' FROM result);
  IF length(result) = 0 THEN result := 'untitled'; END IF;
  IF result = ANY(reserved) THEN result := result || '-1'; END IF;
  RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Backfill: workspaces (idempotent — only NULL slugs)
UPDATE workspaces SET slug = slugify(name) WHERE slug IS NULL;

-- Backfill: templates (idempotent — only NULL slugs)
UPDATE templates SET slug = slugify(name) WHERE slug IS NULL;

-- Dedup: templates within each workspace (ROW_NUMBER suffix)
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT id, slug, rn FROM (
      SELECT id, slug,
        ROW_NUMBER() OVER (
          PARTITION BY workspace_id, slug
          ORDER BY created_at, id
        ) AS rn
      FROM templates WHERE slug IS NOT NULL
    ) sub WHERE sub.rn > 1
  LOOP
    UPDATE templates SET slug = rec.slug || '-' || rec.rn
    WHERE id = rec.id;
  END LOOP;
END $$;

-- Dedup: workspaces (global scope, ROW_NUMBER suffix)
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT id, slug, rn FROM (
      SELECT id, slug,
        ROW_NUMBER() OVER (
          PARTITION BY slug ORDER BY created_at, id
        ) AS rn
      FROM workspaces WHERE slug IS NOT NULL
    ) sub WHERE sub.rn > 1
  LOOP
    UPDATE workspaces SET slug = rec.slug || '-' || rec.rn
    WHERE id = rec.id;
  END LOOP;
END $$;

-- Unique indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_slug
  ON workspaces(slug);
CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_slug_ws
  ON templates(workspace_id, slug);

-- ============================================================
-- TABLE 9: user_api_keys (BYOK — encrypted provider keys)
-- Stores each user's third-party API keys (Gemini, Quiver, OpenAI,
-- etc.) encrypted with WORKSPACE_SECRET_ENCRYPTION_KEY. Keys are NEVER stored
-- in plain text and NEVER exposed to the browser — the GET endpoint
-- only returns whether a key is configured, not the key itself.
-- ============================================================
CREATE TABLE IF NOT EXISTS user_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  model TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_user_api_keys_user ON user_api_keys(user_id);

ALTER TABLE user_api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own API keys" ON user_api_keys;
CREATE POLICY "Users read own API keys"
  ON user_api_keys FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own API keys" ON user_api_keys;
CREATE POLICY "Users insert own API keys"
  ON user_api_keys FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own API keys" ON user_api_keys;
CREATE POLICY "Users update own API keys"
  ON user_api_keys FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own API keys" ON user_api_keys;
CREATE POLICY "Users delete own API keys"
  ON user_api_keys FOR DELETE
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- Musa batch v2 (see supabase_migrations/musa_batch_v2.sql)
-- ---------------------------------------------------------------
ALTER TABLE design_kanban_tasks
  ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE;
CREATE INDEX IF NOT EXISTS idx_dkt_enabled
  ON design_kanban_tasks (enabled) WHERE enabled = TRUE;
