-- ═══════════════════════════════════════════════════════════════
-- Futuraria Design — Migration v8: Campaign column + indexes
-- Run in Supabase SQL Editor. Idempotent (safe to re-run).
-- ═══════════════════════════════════════════════════════════════

-- Add campaign column to design_file_meta
ALTER TABLE design_file_meta ADD COLUMN IF NOT EXISTS campaign TEXT;

-- Index for campaign grouping (used by Graph brand-tree view + Texts tab)
CREATE INDEX IF NOT EXISTS idx_dfm_campaign ON design_file_meta(campaign);
