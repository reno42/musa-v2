-- ═══════════════════════════════════════════════════════════════
-- FUTURARIA v20 — Brand Library: Design System template + soft-delete
-- Each brand owns exactly one Design System template (is_brand_manual=true).
-- Deleting a brand soft-deletes both the brand record and its DS template.
-- Source templates survive; they get re-tagged to the user's default brand.
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════

-- 1. Link brand to its Design System template
ALTER TABLE brand_guidelines
  ADD COLUMN IF NOT EXISTS design_system_template_id TEXT;

COMMENT ON COLUMN brand_guidelines.design_system_template_id IS
  'The template that serves as this brand''s Design System file. Created automatically when the brand is created.';

-- 2. Soft-delete support for brands (same pattern as templates.deleted_at)
ALTER TABLE brand_guidelines
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 3. Index for active brands (most queries filter out deleted)
CREATE INDEX IF NOT EXISTS idx_bg_active
  ON brand_guidelines(workspace_id, deleted_at);

-- 4. Index for looking up a brand by its DS template
CREATE INDEX IF NOT EXISTS idx_bg_ds_template
  ON brand_guidelines(design_system_template_id)
  WHERE design_system_template_id IS NOT NULL;
