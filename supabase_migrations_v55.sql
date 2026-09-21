-- ═══════════════════════════════════════════════════════════════════
-- v55 — Key scopes: separate the MCP keyring from the REST keyring
-- ═══════════════════════════════════════════════════════════════════
-- Until now workspace_api_keys was a single keyring with two names:
-- «Invita IAs» and «APIs/Webhooks» both listed the same rows, and the
-- MCP endpoint + the REST API both authenticated with the same
-- x-api-key. From v55 every key declares its scope:
--
--   kind = 'mcp'  → created in Invita IAs (or by the MCP tool
--                   create_api_key). The full-access tier: opens the
--                   MCP endpoint and keeps working on /api/* because
--                   the MCP server's own tools forward it there
--                   (the bridge in mcp.mjs re-validates via auth.ts).
--   kind = 'rest' → created in APIs/Webhooks for N8N/Zapier/Make and
--                   scripts. Narrow tier: /api/* only — the MCP
--                   endpoint rejects it with key_wrong_scope.
--
-- Legacy rows default to 'mcp' because every key that existed before
-- v55 was created for agents. Enforcement is defensive on both sides:
-- a row read from a pre-v55 database (no kind column) stays valid
-- everywhere, so deploying the code before this migration locks
-- nobody out.
--
-- Idempotent: safe to re-run (IF NOT EXISTS / DROP ... IF EXISTS).
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE workspace_api_keys
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'mcp';

-- Re-add the check idempotently (drop-then-add keeps re-runs safe).
ALTER TABLE workspace_api_keys
  DROP CONSTRAINT IF EXISTS workspace_api_keys_kind_check;
ALTER TABLE workspace_api_keys
  ADD CONSTRAINT workspace_api_keys_kind_check CHECK (kind IN ('mcp', 'rest'));

COMMENT ON COLUMN workspace_api_keys.kind IS
  'Scope of the key: mcp = MCP endpoint + API bridge (agents, Invita IAs); rest = REST API only (N8N/Zapier/Make/scripts, APIs/Webhooks). Pre-v55 rows default to mcp.';
