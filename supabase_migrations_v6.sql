-- ============================================================
-- Migration v6: Asset soft-delete + storage indexes (2026-07-18)
-- ============================================================

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
