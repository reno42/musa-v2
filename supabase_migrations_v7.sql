-- ============================================================
-- Migration v7: URL slugs for workspaces + templates
-- (2026-07-18)
--
-- What this does:
--   1. Adds `slug` column to workspaces & templates
--   2. Creates a slugify() function: NFD normalize → strip
--      diacritics → em-dash→hyphen → lowercase → collapse
--      hyphens → reserved-word guard
--   3. Backfills slugs with per-workspace dedup (suffix -2,-3)
--   4. Adds unique indexes
--
-- Idempotent: safe to re-run. All DDL uses IF NOT EXISTS,
-- backfills only where slug IS NULL.
-- ============================================================

-- ── 0. Ensure unaccent extension (safe re-run) ──
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ── 1. Add slug columns ──
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE templates   ADD COLUMN IF NOT EXISTS slug TEXT;

-- ── 2. Slugify function ──────────────────────────────────
-- PostgreSQL 13+ normalize(text, NFD) → strip combining
-- diacritics (U+0300–U+036F). Em/en dashes → hyphen.
-- Non-alphanum → hyphen. Collapse runs. Trim.
-- Reserved slugs get a numeric suffix.
CREATE OR REPLACE FUNCTION slugify(input TEXT) RETURNS TEXT AS $$
DECLARE
  result    TEXT;
  reserved  TEXT[] := ARRAY[
    'api','mcp','w','dashboard','assets','covers',
    'exports','storage','settings','graph','login',
    'admin','health','trash','landing','editor'
  ];
BEGIN
  -- NFD normalize + remove combining diacritical marks
  result := regexp_replace(normalize(input, 'NFD'), '[\u0300-\u036f]', '', 'g');
  -- Em dash, en dash, horizontal bar → plain hyphen
  result := regexp_replace(result, '[–—―]', '-', 'g');
  -- Lowercase
  result := lower(result);
  -- Any character that is NOT a-z, 0-9, or hyphen → hyphen
  result := regexp_replace(result, '[^a-z0-9\-]', '-', 'g');
  -- Collapse consecutive hyphens
  result := regexp_replace(result, '-+', '-', 'g');
  -- Trim leading / trailing hyphens
  result := trim('-' FROM result);
  -- Empty or whitespace-only → fallback
  IF length(result) = 0 THEN
    result := 'untitled';
  END IF;
  -- Reserved-word guard
  IF result = ANY(reserved) THEN
    result := result || '-1';
  END IF;
  RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ── 3. Backfill: workspaces (base slugs) ──
UPDATE workspaces SET slug = slugify(name) WHERE slug IS NULL;

-- ── 4. Backfill: templates (base slugs) ──
UPDATE templates SET slug = slugify(name) WHERE slug IS NULL;

-- ── 5. Dedup: templates within each workspace ─────────────
-- ROW_NUMBER() over (workspace_id, slug) ordered by
-- created_at. First keeps base slug; 2nd+ get suffix.
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT id, slug, rn FROM (
      SELECT id, slug,
        ROW_NUMBER() OVER (
          PARTITION BY workspace_id, slug
          ORDER BY created_at, id
        ) AS rn
      FROM templates WHERE slug IS NOT NULL
    ) sub WHERE sub.rn > 1
  LOOP
    UPDATE templates SET slug = rec.slug || '-' || rec.rn
    WHERE id = rec.id;
  END LOOP;
END $$;

-- ── 6. Dedup: workspaces (global scope) ───────────────────
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT id, slug, rn FROM (
      SELECT id, slug,
        ROW_NUMBER() OVER (
          PARTITION BY slug ORDER BY created_at, id
        ) AS rn
      FROM workspaces WHERE slug IS NOT NULL
    ) sub WHERE sub.rn > 1
  LOOP
    UPDATE workspaces SET slug = rec.slug || '-' || rec.rn
    WHERE id = rec.id;
  END LOOP;
END $$;

-- ── 7. Unique indexes ────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_slug
  ON workspaces(slug);
CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_slug_ws
  ON templates(workspace_id, slug);

-- ── 8. Verify ────────────────────────────────────────────
SELECT 'workspaces' AS entity,
       count(*) AS total,
       count(DISTINCT slug) AS unique_slugs
FROM workspaces
UNION ALL
SELECT 'templates',
       count(*),
       count(DISTINCT (workspace_id, slug))
FROM templates;
