-- ═══════════════════════════════════════════════════════════════
-- supabase_migrations_v28.sql — Public/private templates (Futuraria
-- Design, agosto 2026)
-- ═══════════════════════════════════════════════════════════════
--
-- WHAT (drives the editor's public/private toggle + guest links):
--   1. templates.is_public — whether the share link /c/:templateId
--      (MobileComments.tsx) can be opened by guests. When FALSE the
--      /api/comments-share endpoints answer 403 code "PRIVATE".
--
-- WHY DEFAULT TRUE: fail-open. Existing share links keep working the
-- day the column lands; owners opt OUT instead of in. The API checks
-- `is_public === false` (never `=== true`), so even before this
-- migration runs the endpoints keep serving as if public.
--
-- Idempotent: safe to re-run. After applying on production, update
-- .migration-version to v28 (scripts/check-migrations.mjs warns until
-- then; code fails OPEN pre-migration — nothing breaks, the editor
-- toggle just reports it could not persist).
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE templates
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN templates.is_public IS
  'Whether the guest share link /c/:templateId works (comments-only access). FALSE = guests get 403 PRIVATE. DEFAULT TRUE preserves existing share links on migration.';
