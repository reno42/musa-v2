-- v47 — Brand container (DS + Plantillas + Comunicación) and brain_notes.
-- Apply after v46. Idempotent and safe to re-run.
--
-- Law being encoded (see harness/DS_CONTAINER_CONVENTION.md):
--   one brand = its container:  a "ds" file, a "plantillas" file and a
--   "communication" file, all linked to the CRM brand. Creating a Design
--   System without a brand is not possible; the container is created with
--   the brand, atomically, on every creation path.
--
-- brain_notes is the Second Brain note store (harness/BRAIN_NOTES_SPEC.md):
-- system-generated markdown notes with [[wikilinks]], human-protected blocks.

-- ── 1. templates.brand_container_kind ─────────────────────────────
-- 'ds' | 'plantillas' | 'communication' | NULL (a normal file).
-- is_brand_manual stays true for 'ds' rows: dozens of code paths already
-- read that flag; the kind column refines it instead of replacing it.
ALTER TABLE public.templates ADD COLUMN IF NOT EXISTS brand_container_kind TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'templates_brand_container_kind_check'
  ) THEN
    ALTER TABLE public.templates ADD CONSTRAINT templates_brand_container_kind_check
      CHECK (brand_container_kind IS NULL
             OR brand_container_kind IN ('ds', 'plantillas', 'communication'));
  END IF;
END $$;

-- Backfill: every legacy v35 Design System file is the brand's "ds" kind.
UPDATE public.templates
SET brand_container_kind = 'ds'
WHERE is_brand_manual = TRUE
  AND brand_container_kind IS NULL
  AND deleted_at IS NULL;

-- At most one live container file per (workspace, brand, kind) once the
-- service layer starts writing the kind; NULL kinds are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_brand_container_unique
  ON templates(workspace_id, (data->>'brandId'), brand_container_kind)
  WHERE brand_container_kind IS NOT NULL AND deleted_at IS NULL;

-- ── 2. brands.strategy_json + logo_asset_id ───────────────────────
-- strategy_json is the source of truth behind the Brand Strategy Canvas
-- (harness/BRAND_STRATEGY_V1.md). logo_asset_id points at the brand's
-- official logo in workspace assets (design-assets bucket) — referenced,
-- never copied into the DS file.
ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS strategy_json JSONB;
ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS logo_asset_id TEXT;

-- ── 3. brain_notes (Second Brain store) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.brain_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL DEFAULT '',
  links TEXT[] NOT NULL DEFAULT '{}',
  entity_type TEXT,
  entity_id TEXT,
  source TEXT NOT NULL DEFAULT 'system' CHECK (source IN ('system', 'human', 'agent')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_brain_notes_workspace_updated
  ON brain_notes(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_brain_notes_entity
  ON brain_notes(workspace_id, entity_type, entity_id);
-- Fast substring search for search_notes (pg_trgm is available on Supabase).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_brain_notes_body_trgm
  ON brain_notes USING gin (body_md gin_trgm_ops);

ALTER TABLE brain_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "brain_notes_workspace_read" ON brain_notes;
CREATE POLICY "brain_notes_workspace_read" ON brain_notes FOR SELECT
  USING (has_workspace_role(workspace_id, 'viewer'));

DROP POLICY IF EXISTS "brain_notes_workspace_write" ON brain_notes;
CREATE POLICY "brain_notes_workspace_write" ON brain_notes FOR ALL
  USING (has_workspace_role(workspace_id, 'editor'))
  WITH CHECK (has_workspace_role(workspace_id, 'editor'));

-- Notes are authored by the server (emitters) or via MCP; browsers read only.
REVOKE INSERT, UPDATE, DELETE ON brain_notes FROM authenticated, anon;
GRANT SELECT ON brain_notes TO authenticated;
GRANT ALL ON brain_notes TO service_role;

CREATE OR REPLACE FUNCTION touch_brain_note_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_brain_notes_updated_at ON brain_notes;
CREATE TRIGGER trg_brain_notes_updated_at
BEFORE UPDATE ON brain_notes
FOR EACH ROW EXECUTE FUNCTION touch_brain_note_updated_at();
