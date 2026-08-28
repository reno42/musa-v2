-- ═══════════════════════════════════════════════════════════════
-- FUTURARIA v32 — Copy Recipes (REQ-016)
--
-- Writing recipes: hooks, communication tones and copywriting frameworks
-- (AIDA, PAS, StoryBrand…) that a user OR an AI can save and reuse as
-- instructions when drafting the calendar's `copy` column.
--
-- Deliberately separate from the existing `recipes` table (design recipes /
-- key visuals with html+css): the shape is different — instructional text,
-- not markup — and mixing them would force every reader to filter by a
-- discriminator that old rows don't have.
--
-- The CRUD is identical for humans (REST, "Recetas" pane) and AIs (MCP
-- tools create_copy_recipe / update_copy_recipe / delete_copy_recipe), so a
-- user can ask their AI to research frameworks online and store them here.
--
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS copy_recipes (
  id            TEXT PRIMARY KEY DEFAULT ('crx_' || substr(md5(random()::text), 1, 16)),
  workspace_id  TEXT NOT NULL,

  -- What kind of recipe this is. 'otro' keeps the set open instead of
  -- rejecting a taxonomy the user invented.
  type          TEXT NOT NULL DEFAULT 'otro',   -- hook | tono | framework | otro

  name          TEXT NOT NULL,
  content       TEXT NOT NULL,                  -- the recipe itself: instructions, examples, rules
  tags          TEXT[] NOT NULL DEFAULT '{}',   -- free-form: 'corto', 'urgente', 'ecommerce'…

  -- Provenance: who saved it. Informational only — both paths share the
  -- exact same permissions.
  source        TEXT NOT NULL DEFAULT 'humano', -- humano | ia

  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON COLUMN copy_recipes.type IS
  'hook | tono | framework | otro. A hook is an opening line pattern, a tono is a voice/tone guide, a framework is a full writing structure (AIDA, PAS…).';
COMMENT ON COLUMN copy_recipes.source IS
  'humano | ia — who saved it. Informational; permissions are identical for both.';

CREATE INDEX IF NOT EXISTS idx_crx_workspace_type ON copy_recipes(workspace_id, type);
CREATE INDEX IF NOT EXISTS idx_crx_updated        ON copy_recipes(workspace_id, updated_at DESC);

ALTER TABLE copy_recipes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "copy_recipes_read" ON copy_recipes;
CREATE POLICY "copy_recipes_read" ON copy_recipes
  FOR SELECT USING (has_workspace_role(workspace_id, 'viewer'));

DROP POLICY IF EXISTS "copy_recipes_write" ON copy_recipes;
CREATE POLICY "copy_recipes_write" ON copy_recipes
  FOR ALL USING (has_workspace_role(workspace_id, 'editor'))
  WITH CHECK (has_workspace_role(workspace_id, 'editor'));
