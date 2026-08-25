-- ═══════════════════════════════════════════════════════════════
-- supabase_migrations_v30.sql — Acuerdo de Acceso Alfa (NDA)
-- (Futuraria Design, agosto 2026)
-- ═══════════════════════════════════════════════════════════════
--
-- WHAT: first-login NDA wall. Adds:
--   1. user_profiles.nda_accepted_at → gate flag (NULL = wall pending).
--      Every existing account has it NULL, so all of them see the wall
--      once and get recorded in nda_acceptances when they accept.
--   2. user_profiles.access_plan → 'friends_family' | 'corporate',
--      chosen on the wall, locked afterwards (read-only in Settings;
--      PATCH /api/account/me never accepts these fields).
--   3. nda_acceptances → legal record of each consent: who, which plan,
--      IP, user agent and agreement version. Written only by the API
--      (service role) via POST /api/account/nda-acceptance.
--
-- Everything lives in THIS project's Supabase. The nda-acceso-alfa/
-- folder's migration.sql targeted the CRM project and is NOT applied.
--
-- Idempotent: safe to re-run. After applying on production, update
-- .migration-version to the highest applied migration (the current v26
-- marker is stale — v27..v29 exist; scripts/check-migrations.mjs warns
-- until the marker catches up).
-- ═══════════════════════════════════════════════════════════════

-- 1. Gate flag + locked plan on the profile
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS nda_accepted_at timestamptz;

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS access_plan text
  NOT NULL DEFAULT 'friends_family';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_profiles_access_plan_check'
      AND conrelid = 'user_profiles'::regclass
  ) THEN
    ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_access_plan_check
      CHECK (access_plan IN ('friends_family', 'corporate'));
  END IF;
END $$;

-- 2. Legal record of the consent (FK style matches user_profiles /
--    workspace_members: cascade when the auth.user is deleted).
CREATE TABLE IF NOT EXISTS nda_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT,
  plan TEXT NOT NULL DEFAULT 'friends_family',
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address TEXT,
  user_agent TEXT,
  version TEXT NOT NULL DEFAULT '1.0',
  metadata JSONB DEFAULT '{}'::jsonb
);

-- One acceptance per user: the first one counts, forever.
CREATE UNIQUE INDEX IF NOT EXISTS nda_acceptances_user_id_idx
  ON nda_acceptances (user_id);

CREATE INDEX IF NOT EXISTS nda_acceptances_email_idx ON nda_acceptances (email);
CREATE INDEX IF NOT EXISTS nda_acceptances_plan_idx ON nda_acceptances (plan);

-- 3. RLS enabled with NO anon/authenticated policies: only the API's
--    service role reads/writes (same pattern as user_provider_keys, v24).
--    Consent records are private legal evidence, never client-readable.
ALTER TABLE nda_acceptances ENABLE ROW LEVEL SECURITY;
