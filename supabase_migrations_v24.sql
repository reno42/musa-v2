-- ═══════════════════════════════════════════════════════════════
-- FUTURARIA v24 — provider keys live on the server, encrypted
--
-- An LLM API key is a password that spends money. Keeping it in localStorage
-- put it in an environment the user does not control: anyone with the device,
-- any extension with storage access, and any XSS on the page could read it.
-- It also meant a key had to be re-entered on every browser and every phone.
--
-- The ciphertext is written by services/secrets.ts (AES-256-GCM, per-row IV
-- and auth tag). The encryption key never lives in this database, so a dump of
-- this table on its own decrypts to nothing.
--
-- `last4` is stored in clear on purpose: support and the UI need to say WHICH
-- key is configured without ever reading it back.
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS user_provider_keys (
  user_id     UUID NOT NULL,
  provider    TEXT NOT NULL,          -- google | deepseek | openai | …
  key_cipher  TEXT NOT NULL,          -- v1.<iv>.<tag>.<ciphertext>
  last4       TEXT,                   -- for display and log correlation only
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  -- One key per provider per user: "one service, one key".
  PRIMARY KEY (user_id, provider)
);

COMMENT ON TABLE user_provider_keys IS
  'Encrypted LLM provider keys, per user. Never returned to the browser — the API proxies calls instead. Rotate by overwriting the row.';
COMMENT ON COLUMN user_provider_keys.last4 IS
  'Last four characters, so the UI and logs can identify a key without exposing it.';

ALTER TABLE user_provider_keys ENABLE ROW LEVEL SECURITY;

-- Even so, nothing reads this table through PostgREST: the API uses the
-- service role and returns only last4. The policy is the second lock.
DROP POLICY IF EXISTS "provider_keys_own" ON user_provider_keys;
CREATE POLICY "provider_keys_own" ON user_provider_keys
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
