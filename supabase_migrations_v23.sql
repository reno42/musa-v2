-- ═══════════════════════════════════════════════════════════════
-- FUTURARIA v23 — the chat belongs to the user, not to the browser
--
-- The agent's transcript lived entirely in localStorage. localStorage is
-- per-browser-profile, so the same account opened on a phone, a second
-- browser, or after clearing site data met a brand new agent with no memory
-- of anything. That is not a bug in the storage; it is the wrong storage.
--
-- Keyed by user_id, not workspace: this agent is one per person and follows
-- them across workspaces, the way it already behaves in every other respect.
-- workspace_id is kept as context on the message, not as the key.
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS chat_messages (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL,
  workspace_id TEXT,
  role         TEXT NOT NULL,          -- user | assistant | system
  content      TEXT NOT NULL DEFAULT '',
  -- Tool events, step groups, model used: whatever the transcript needs to
  -- render the turn exactly as it looked. JSONB so the shape can grow without
  -- another migration.
  meta         JSONB DEFAULT '{}'::jsonb,
  -- The client's own timestamp. Ordering is by id, which is monotonic per
  -- insert; ts is what the UI shows and may legitimately disagree by a second.
  ts           BIGINT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE chat_messages IS
  'Agent transcript, per user. The browser keeps a copy for offline reading, but this is the source of truth.';

CREATE INDEX IF NOT EXISTS idx_chat_user     ON chat_messages(user_id, id);
CREATE INDEX IF NOT EXISTS idx_chat_user_ts  ON chat_messages(user_id, created_at DESC);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Nobody reads anybody else's conversation. This is the whole policy.
DROP POLICY IF EXISTS "chat_own_read" ON chat_messages;
CREATE POLICY "chat_own_read" ON chat_messages
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "chat_own_write" ON chat_messages;
CREATE POLICY "chat_own_write" ON chat_messages
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════
-- Which model the user picked, so that follows them too.
--
-- The provider and model only — NOT the API key. A key is a secret the user
-- pasted into their own browser, and moving it into a shared database is a
-- decision they should make on purpose rather than discover. See
-- services/secrets.ts (encryptWorkspaceSecret) for the path if that changes.
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS chat_preferences (
  user_id    UUID PRIMARY KEY,
  role_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE chat_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_prefs_own" ON chat_preferences;
CREATE POLICY "chat_prefs_own" ON chat_preferences
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
