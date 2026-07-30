-- ═══════════════════════════════════════════════════════════════
-- Fix: UNIQUE constraint on harness_checkpoints(task_id, checkpoint_id)
--
-- Root cause: mcp.mjs line 11238 does:
--   .upsert(newCp, { onConflict: "task_id,checkpoint_id" })
-- PostgreSQL ON CONFLICT requires a unique index. The table only had
-- a non-unique index idx_hc_task on (task_id). This caused every
-- harness_evaluate_checkpoint call to fail, blocking harness_complete_feature.
--
-- Fix: Create a UNIQUE index so the upsert can find the conflict target.
-- ═══════════════════════════════════════════════════════════════

-- Drop any existing non-unique index first (optional, harmless if not exists)
-- We keep idx_hc_task for query performance, but add the unique one.

CREATE UNIQUE INDEX IF NOT EXISTS idx_hc_task_checkpoint_unique
  ON harness_checkpoints (task_id, checkpoint_id);
