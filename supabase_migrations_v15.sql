-- ═══════════════════════════════════════════════════════════════
-- FUTURARIA HARNESS — Error log table (v15)
-- Centralized error tracking for all MCP tool failures.
-- Every error is recorded here — even those the user never reports.
-- Run ENTIRE file in Supabase SQL Editor (Ctrl+A → Run).
-- ═══════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS harness_error_logs (
  id              TEXT PRIMARY KEY,
  account_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  tool            TEXT NOT NULL,
  args            JSONB DEFAULT '{}'::jsonb,
  error_message   TEXT NOT NULL,
  step_index      INTEGER,
  total_steps     INTEGER,
  round           INTEGER,
  provider        TEXT,
  mcp_status_code INTEGER,
  source          TEXT DEFAULT 'chatfab',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hel_account ON harness_error_logs(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hel_tool    ON harness_error_logs(tool, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hel_created ON harness_error_logs(created_at DESC);

ALTER TABLE harness_error_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "manage_own_error_logs" ON harness_error_logs;
CREATE POLICY "manage_own_error_logs" ON harness_error_logs
  FOR ALL USING (account_id = auth.uid()) WITH CHECK (account_id = auth.uid());

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'harness_error_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.harness_error_logs;
  END IF;
END $$;

COMMIT;
