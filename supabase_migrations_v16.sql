-- v16 — Profile fields for the redesigned Settings "Tus datos" card.
--
-- user_profiles previously held only id/email/display_name/avatar_url, so the
-- account card had nothing to show beyond an email. These columns back the
-- editable identity fields (name, contact, brand) shown there.
--
-- Safe to re-run: every ADD COLUMN is IF NOT EXISTS. The API degrades
-- gracefully when this hasn't been applied yet (it falls back to selecting
-- only the base columns), so running it is what turns the fields on rather
-- than something the app breaks without.

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS first_name  text;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS last_name   text;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS phone       text;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS website     text;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS brand_name  text;
