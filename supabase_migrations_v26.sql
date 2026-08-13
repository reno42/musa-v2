-- ═══════════════════════════════════════════════════════════════
-- FUTURARIA v26 — Unify key storage on user_api_keys
--
-- The platform had two parallel systems for encrypted provider keys:
--   1. user_api_keys       (Netlify keys.mjs — the original, RLS-protected)
--   2. user_provider_keys  (Express providerKeys.ts — added later, duplicate)
--
-- The keys.mjs getUserKey() function now migrates rows from
-- user_provider_keys into user_api_keys automatically (decrypt with the
-- old salt, re-encrypt with the current salt, move the row). After every
-- user has logged in once, the old table is empty and can be dropped.
--
-- This migration adds the `last4` column to user_api_keys (needed for
-- display and for the migration target) and provides a safe drop for
-- the old table once you confirm it is empty.
--
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════

-- 1. Add last4 column to user_api_keys
ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS last4 TEXT;

COMMENT ON COLUMN user_api_keys.last4 IS
  'Last four characters of the key, for display and log correlation. Never the key itself.';

-- 2. Backfill last4 for existing rows that were stored before this column
--    existed (the key itself is encrypted, but last4 is safe to store clear).
--    Only possible for keys stored via keys.mjs PUT endpoint after this
--    migration runs — older rows will have NULL last4 until rotated.

-- 3. Check the old table before dropping (run manually, do NOT auto-drop):
--    SELECT count(*) FROM user_provider_keys;
--    If 0 → safe to drop:
--    DROP TABLE IF EXISTS user_provider_keys;
