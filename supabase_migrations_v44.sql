-- v44 — Copy recipes gain a brand scope, plus (inert for now) usage tracking.
--
-- brand_id: NULL = «General» — the recipe applies to every brand of the
-- workspace; set = it only applies to that brand. Same convention the
-- content calendar's brand_id uses (v22), and TEXT like brands.id.
--
-- usage_count / last_used_at: reserved for the LRU rotation rule so an AI
-- drafting copies varies its structures. Nothing writes them yet — they only
-- ride along on SELECT * until that refinement ships.

ALTER TABLE copy_recipes ADD COLUMN IF NOT EXISTS brand_id TEXT;
ALTER TABLE copy_recipes ADD COLUMN IF NOT EXISTS usage_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE copy_recipes ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_copy_recipes_brand ON copy_recipes(workspace_id, brand_id);

COMMENT ON COLUMN copy_recipes.brand_id IS
'Recetas General (NULL) aplican a todas las marcas del workspace; con un brands.id, solo a esa marca.';
