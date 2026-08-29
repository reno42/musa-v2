-- ═══════════════════════════════════════════════════════════════════════════
-- v36 · User preferences JSONB
-- ═══════════════════════════════════════════════════════════════════════════
-- Non-secret user preferences that must follow the account across devices:
--   • chatRoles  — { leader, implementer, reviewer } × { provider, model }
--                  (was localStorage-only, so a new device lost the setup)
--   • nanoBananaModel — default image-gen model
-- Secrets (API keys) deliberately stay OUT of here: they live encrypted in
-- user_api_keys via the /api/keys endpoints.
--
-- Idempotent. Safe to run any number of times.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS prefs JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN user_profiles.prefs IS
  'Per-user non-secret preferences (chat roles, default models). Merged shallowly by PATCH /api/account/me.';
