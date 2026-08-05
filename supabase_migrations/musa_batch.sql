-- ═══════════════════════════════════════════════════════════════
-- MUSA DAILY BATCH — Automated design processing queue
-- Cloud-native, multi-tenant, fully on Supabase.
-- Depends on: design_kanban.sql (design_kanban_tasks), workspaces, auth.users
-- Run in Supabase SQL Editor (idempotent).
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- STEP 1: task_queue — items the batch processor picks up
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_queue (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  TEXT NOT NULL,
  account_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id       TEXT REFERENCES design_kanban_tasks(id) ON DELETE SET NULL,
  action        JSONB NOT NULL DEFAULT '{}'::jsonb,
  tag           TEXT DEFAULT 'auto',
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','processing','done','failed')),
  result        JSONB DEFAULT '{}'::jsonb,
  error_message TEXT,
  priority      INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tq_status_tag    ON task_queue(status, tag);
CREATE INDEX IF NOT EXISTS idx_tq_workspace     ON task_queue(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tq_account       ON task_queue(account_id);
CREATE INDEX IF NOT EXISTS idx_tq_priority_date ON task_queue(priority DESC, created_at ASC);

-- ─────────────────────────────────────────────────────────────
-- STEP 2: workspace_config — per-workspace batch settings
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_config (
  workspace_id              TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  auto_process_enabled      BOOLEAN DEFAULT FALSE,
  auto_process_tag          TEXT DEFAULT 'auto',
  auto_process_time         TEXT DEFAULT '06:00',
  auto_process_timezone     TEXT DEFAULT 'America/Argentina/Buenos_Aires',
  auto_process_max_items    INTEGER DEFAULT 50,
  notify_on_complete        BOOLEAN DEFAULT FALSE,
  notify_chat_id            TEXT,
  batch_llm_provider        TEXT DEFAULT 'deepseek',
  batch_llm_key_encrypted   TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- STEP 3: RLS — multi-tenant isolation
-- ─────────────────────────────────────────────────────────────
ALTER TABLE task_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "manage_own_task_queue" ON task_queue;
CREATE POLICY "manage_own_task_queue" ON task_queue
  FOR ALL USING (account_id IS NULL OR account_id = auth.uid())
  WITH CHECK (account_id IS NULL OR account_id = auth.uid());

DROP POLICY IF EXISTS "manage_own_workspace_config" ON workspace_config;
CREATE POLICY "manage_own_workspace_config" ON workspace_config
  FOR ALL USING (
    workspace_id IN (
      SELECT id FROM workspaces WHERE owner_id = auth.uid()
    )
  )
  WITH CHECK (
    workspace_id IN (
      SELECT id FROM workspaces WHERE owner_id = auth.uid()
    )
  );

-- Service role bypasses RLS (used by process_daily_batch)

-- ─────────────────────────────────────────────────────────────
-- STEP 4: Trigger — auto-update updated_at on workspace_config
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_workspace_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_wc_updated_at ON workspace_config;
CREATE TRIGGER trg_wc_updated_at
  BEFORE UPDATE ON workspace_config
  FOR EACH ROW EXECUTE FUNCTION update_workspace_config_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- END — Musa Daily Batch schema ready.
-- ═══════════════════════════════════════════════════════════════
