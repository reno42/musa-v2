-- ═══════════════════════════════════════════════════════════════
-- Musa batch v2.2 — no_tocar: hard lock against ANY AI
-- ═══════════════════════════════════════════════════════════════
-- Idempotent. Run in the Supabase SQL Editor BEFORE deploying the
-- code that queries this column (mcp.mjs harness_list_features /
-- harness_claim_feature, musa-batch-core.mjs runDailyBatch), or those
-- queries will fail with "column does not exist".
--
-- enabled  (v2):   controls ONLY the batch (hourly pipeline skips it).
-- no_tocar (v2.2): controls EVERY AI — the batch skips the card AND
--                  leader/implementer/reviewer agents cannot claim it
--                  via the harness. Set/unset by the human from the
--                  Kanban UI (studio_update_card).
ALTER TABLE design_kanban_tasks
  ADD COLUMN IF NOT EXISTS no_tocar BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_dkt_no_tocar
  ON design_kanban_tasks (no_tocar) WHERE no_tocar = TRUE;

COMMENT ON COLUMN design_kanban_tasks.no_tocar IS
  'Hard human lock: no AI (batch, leader/implementer/reviewer) may touch this card. Independent from enabled (batch-only).';
