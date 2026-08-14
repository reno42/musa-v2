-- ═══════════════════════════════════════════════════════════════
-- Musa batch v2 — Kanban as single source of truth
-- ═══════════════════════════════════════════════════════════════
-- The daily batch (scheduled function musa-batch, 0 9 * * *) now
-- iterates design_kanban_tasks directly (task_queue is deprecated).
-- Each card needs an `enabled` flag so the human can opt out
-- individual cards from the autonomous pipeline.
--
-- Idempotent — safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE design_kanban_tasks
  ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- Batch queries filter on (workspace_id, status, enabled)
CREATE INDEX IF NOT EXISTS idx_dkt_enabled
  ON design_kanban_tasks (enabled)
  WHERE enabled = TRUE;

COMMENT ON COLUMN design_kanban_tasks.enabled IS
  'When FALSE, the Musa daily batch skips this card. Human can toggle per card. Default TRUE.';
