-- ============================================================
-- Migration v6: Asset soft-delete + storage indexes (2026-07-18)
-- ============================================================

-- ── 0. Ensure assets table exists (self-contained, safe re-run) ──
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

-- ── 1. Add deleted_at to assets table (soft-delete pattern, mirrors templates) ──
ALTER TABLE assets ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_assets_trash ON assets(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assets_deleted_workspace ON assets(workspace_id, deleted_at);

-- ── 2. Add deleted_at to recipes table (soft-delete for Key Visuals) ──
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_recipes_trash ON recipes(deleted_at) WHERE deleted_at IS NOT NULL;

-- ── 3. Add size_bytes index for storage summary queries ──
CREATE INDEX IF NOT EXISTS idx_assets_size ON assets(size_bytes) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_assets_mime ON assets(mime_type) WHERE deleted_at IS NULL;
