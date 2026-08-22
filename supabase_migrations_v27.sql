-- ═══════════════════════════════════════════════════════════════
-- supabase_migrations_v27.sql — Platform config, usage metering,
-- Kanban auto-refresh settings (Futuraria Design, agosto 2026)
-- ═══════════════════════════════════════════════════════════════
--
-- WHAT (drives the Configuración panel + the Netlify budget fix):
--   1. platform_config  — platform-level switches & limits, written from
--      Configuración → Plataforma (admin key or workspace owner):
--        key 'musa'    → { musa_tick_enabled: bool }  — kill switch the
--                        hourly musa-batch-tick reads BEFORE dispatching.
--        key 'limits'  → { monthly_mcp_quota: number } — per-workspace
--                        monthly MCP call quota (0 = unlimited).
--   2. workspace_usage — one row per workspace per month with the MCP
--      call count, incremented atomically by RPC from every
--      authenticated /mcp tools/call that carries a workspaceId.
--   3. workspace_config.kanban_autorefresh_* — Kanban auto-refresh
--      toggle + interval (Configuración → Kanban, read by KanbanTab).
--
-- RLS: ENABLE with no policies → only the service role (Netlify
-- functions / api) can read/write. Browsers never touch these tables
-- directly; they go through MCP tools that enforce permissions.
--
-- Idempotent: safe to re-run. After applying on production, update
-- .migration-version to v27 (scripts/check-migrations.mjs warns until
-- then; code fails OPEN pre-migration — nothing breaks, telemetry and
-- switches just no-op with their defaults).
-- ═══════════════════════════════════════════════════════════════

-- 1. Platform-level switches & limits
CREATE TABLE IF NOT EXISTS platform_config (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE platform_config ENABLE ROW LEVEL SECURITY;

-- 2. Per-workspace monthly usage metering
CREATE TABLE IF NOT EXISTS workspace_usage (
  workspace_id    UUID NOT NULL,
  month           TEXT NOT NULL,                 -- 'YYYY-MM' (UTC)
  mcp_calls       BIGINT NOT NULL DEFAULT 0,
  items_generated BIGINT NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, month)
);
ALTER TABLE workspace_usage ENABLE ROW LEVEL SECURITY;

-- Atomic increment used by /mcp metering (one roundtrip, returns the
-- post-increment count so the quota check needs no extra read).
CREATE OR REPLACE FUNCTION increment_workspace_usage(
  p_workspace_id UUID,
  p_month        TEXT,
  p_calls        BIGINT DEFAULT 1
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_calls BIGINT;
BEGIN
  INSERT INTO workspace_usage (workspace_id, month, mcp_calls)
  VALUES (p_workspace_id, p_month, GREATEST(p_calls, 0))
  ON CONFLICT (workspace_id, month)
  DO UPDATE SET
    mcp_calls  = workspace_usage.mcp_calls + EXCLUDED.mcp_calls,
    updated_at = now()
  RETURNING mcp_calls INTO v_calls;
  RETURN v_calls;
END;
$$;

-- 3. Kanban auto-refresh (Configuración → Kanban)
ALTER TABLE workspace_config
  ADD COLUMN IF NOT EXISTS kanban_autorefresh_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS kanban_autorefresh_seconds INT NOT NULL DEFAULT 30;

COMMENT ON COLUMN workspace_config.kanban_autorefresh_enabled IS
  'Kanban auto-refresh poll toggle (Configuración → Kanban). Default on. The poll only fires while the tab is visible.';
COMMENT ON COLUMN workspace_config.kanban_autorefresh_seconds IS
  'Kanban auto-refresh interval in seconds. Allowed: 15/30/60/120. Default 30 (was a blind 10s interval pre-v27, which burned ~1,440 /mcp calls/day per parked tab).';
