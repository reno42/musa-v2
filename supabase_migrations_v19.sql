-- ═══════════════════════════════════════════════════════════════
-- FUTURARIA v19 — Studio Board card context enrichment
-- Adds style_name + frame_count to design_kanban_tasks so the
-- leader can pre-resolve context and the implementer doesn't
-- waste rounds re-discovering what the leader already knew.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE design_kanban_tasks
  ADD COLUMN IF NOT EXISTS style_name TEXT;

ALTER TABLE design_kanban_tasks
  ADD COLUMN IF NOT EXISTS frame_count INTEGER;

-- Index for filtering tasks by style
CREATE INDEX IF NOT EXISTS idx_dkt_style_name ON design_kanban_tasks(style_name);
