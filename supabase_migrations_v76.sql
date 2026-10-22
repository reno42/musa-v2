-- Futuraria Design — Migration v76: Referral codes on user_profiles.
--
-- Format: RENZO420 — normalized name (A-Z0-9, max 12, fallback MUSA) + a
-- number (3 digits; 4 on repeated collision). Codes are minted ONCE by the
-- BEFORE INSERT trigger below, so every code path that seeds a profile row
-- (POST /account/bootstrap, the PATCH /me self-heal insert, manual SQL)
-- produces a code without any API-side loop. Attribution (referred_by) is
-- written exclusively by the API's POST /account/referral/redeem, which
-- claims it with an IS NULL guard — double redemption is impossible.
--
-- Safe to re-run: every ALTER/INDEX/trigger uses IF NOT EXISTS / DROP first.
-- The API degrades gracefully when this hasn't run (GET /me falls back to the
-- base columns; referral endpoints answer with profileFieldsAvailable:false).
--
-- Race note: the trigger's collision check (SELECT then INSERT) has a tiny
-- two-inserts-same-instant window; the UNIQUE index is the last word — the
-- loser fails once and the client retry mints a fresh code.

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS referral_code TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS referred_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_referral_code
  ON user_profiles(referral_code) WHERE referral_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_profiles_referred_by
  ON user_profiles(referred_by) WHERE referred_by IS NOT NULL;

-- Name base for the code: strip accents (dependency-free translate, no
-- unaccent extension), drop non-alphanumerics, uppercase, cap at 12.
CREATE OR REPLACE FUNCTION generate_referral_code(p_first_name TEXT, p_display_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  base TEXT;
  attempt TEXT;
  width INT := 3;
  tries INT := 0;
BEGIN
  base := upper(regexp_replace(
    translate(
      coalesce(p_first_name, '') || coalesce(p_display_name, ''),
      'ÁÉÍÓÚÜÑÀÈÌÒÙÂÊÎÔÛÃÕÄËÏÖÇáéíóúüñàèìòùâêîôûãõäëïöç',
      'AEIOUUNAEIOUAEIOUAEIOUAOCaeiouunaeiouaeiouaeiouaoc'),
    '[^A-Za-z0-9]', '', 'g'));
  IF base IS NULL OR base = '' THEN
    base := 'MUSA';
  END IF;
  base := left(base, 12);
  LOOP
    tries := tries + 1;
    -- Collision ladder: ten 3-digit attempts, then 4-digit, then an
    -- effectively unguessable hex suffix so the loop always terminates.
    IF tries > 10 THEN width := 4; END IF;
    IF tries > 20 THEN
      attempt := base || upper(substring(gen_random_uuid()::text FROM 1 FOR 6));
    ELSIF width = 3 THEN
      attempt := base || (100 + floor(random() * 900))::INT::TEXT;
    ELSE
      attempt := base || (1000 + floor(random() * 9000))::INT::TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE referral_code = attempt) THEN
      RETURN attempt;
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION assign_referral_code()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.referral_code IS NULL THEN
    NEW.referral_code := generate_referral_code(NEW.first_name, NEW.display_name);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_assign_referral_code ON user_profiles;
CREATE TRIGGER trg_assign_referral_code
  BEFORE INSERT ON user_profiles
  FOR EACH ROW WHEN (NEW.referral_code IS NULL)
  EXECUTE FUNCTION assign_referral_code();

-- Backfill: profiles minted before this migration get their code too.
-- One UPDATE per missing row; generate_referral_code checks existing codes,
-- so re-running stays safe.
UPDATE user_profiles
SET referral_code = generate_referral_code(first_name, display_name)
WHERE referral_code IS NULL;
