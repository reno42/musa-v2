-- ============================================================
-- Migration v5: Auth enforcement + session tracking (2026-07-18)
-- ============================================================

-- ── 1. client_sessions table (audit/tracking) ──
CREATE TABLE IF NOT EXISTS client_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_label TEXT NOT NULL,
  client_info TEXT,
  user_agent TEXT,
  ip TEXT,
  first_seen TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  request_count INT DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_client_sessions_key ON client_sessions(key_label);
CREATE INDEX IF NOT EXISTS idx_client_sessions_last ON client_sessions(last_seen DESC);

-- ── 2. Hash existing api_keys (migration from plain text → SHA-256) ──
-- Only run if key_hash looks like a raw key (fdr_ prefix)
-- SHA-256 hex is 64 chars; raw keys are fdr_<24chars>
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id, key_hash FROM api_keys WHERE key_hash LIKE 'fdr_%'
  LOOP
    UPDATE api_keys SET key_hash = encode(sha256(r.key_hash::bytea), 'hex')
    WHERE id = r.id;
  END LOOP;
END $$;

-- ── 3. RLS: allow service role access (api_keys and client_sessions) ──
-- Follows existing pattern: no auth.uid(), service_role bypasses RLS
ALTER TABLE client_sessions ENABLE ROW LEVEL SECURITY;

-- Allow all operations for service_role (the Netlify function)
DROP POLICY IF EXISTS "service_role_all_client_sessions" ON client_sessions;
CREATE POLICY "service_role_all_client_sessions" ON client_sessions
  FOR ALL USING (true) WITH CHECK (true);

-- api_keys RLS (ensure it exists — idempotent)
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_api_keys" ON api_keys;
CREATE POLICY "service_role_all_api_keys" ON api_keys
  FOR ALL USING (true) WITH CHECK (true);
