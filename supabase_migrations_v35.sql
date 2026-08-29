-- ═══════════════════════════════════════════════════════════════
-- FUTURARIA v35 — Regla dura: una marca = UN archivo Design System
--
-- 1. Asegura las columnas de v20 (por si esta DB nunca corrió v20:
--    "column g.deleted_at does not exist") ANTES de tocar datos.
-- 2. Vínculo explícito marca ↔ design system por ID (crm_brand_id),
--    no por nombre (el matching por nombre rompe con renombres).
-- 3. Backfill por nombre para marcas existentes.
-- 4. Dedupe: si quedaran 2 design systems para la misma marca,
--    se conserva el más reciente y el otro va a papelera.
-- 5. Índices únicos parciales que hacen IMPOSIBLE tener dos DS
--    vivos para la misma marca (la unicidad ya no es solo runtime).
--
-- Idempotente. Ejecutar ANTES de deployar el código que la usa.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Columnas base (defensivo: v20 pudo no haberse aplicado) ──
ALTER TABLE brand_guidelines
  ADD COLUMN IF NOT EXISTS design_system_template_id TEXT;

ALTER TABLE brand_guidelines
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

COMMENT ON COLUMN brand_guidelines.design_system_template_id IS
  'The template that serves as this brand''s Design System file. Created automatically when the brand is created.';

CREATE INDEX IF NOT EXISTS idx_bg_active
  ON brand_guidelines(workspace_id, deleted_at);

CREATE INDEX IF NOT EXISTS idx_bg_ds_template
  ON brand_guidelines(design_system_template_id)
  WHERE design_system_template_id IS NOT NULL;

-- ── 2. Vínculo explícito con la marca del CRM ──
ALTER TABLE brand_guidelines
  ADD COLUMN IF NOT EXISTS crm_brand_id TEXT REFERENCES brands(id) ON DELETE SET NULL;

COMMENT ON COLUMN brand_guidelines.crm_brand_id IS
  'CRM brand (brands.id) that owns this Design System. One live Design System per brand, enforced by uq_bg_one_ds_per_brand.';

CREATE INDEX IF NOT EXISTS idx_bg_crm_brand
  ON brand_guidelines(crm_brand_id)
  WHERE crm_brand_id IS NOT NULL;

-- ── 3. Dedupe previo: mismo nombre normalizado en un workspace =
--       se conserva solo la fila más reciente ──
DO $$
DECLARE
  dup RECORD;
BEGIN
  FOR dup IN
    SELECT workspace_id, lower(btrim(name)) AS name_key
    FROM brand_guidelines
    GROUP BY workspace_id, lower(btrim(name))
    HAVING COUNT(*) > 1
  LOOP
    UPDATE brand_guidelines g
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE g.workspace_id = dup.workspace_id
      AND lower(btrim(g.name)) = dup.name_key
      AND g.id NOT IN (
        SELECT g2.id FROM brand_guidelines g2
        WHERE g2.workspace_id = dup.workspace_id
          AND lower(btrim(g2.name)) = dup.name_key
        ORDER BY COALESCE(g2.updated_at, g2.created_at) DESC
        LIMIT 1
      );
  END LOOP;
END $$;

-- ── 4. Backfill: casar design systems existentes con su marca por
--       nombre normalizado (solo filas vivas y aún sin vínculo) ──
UPDATE brand_guidelines g
SET crm_brand_id = b.id
FROM brands b
WHERE b.workspace_id = g.workspace_id
  AND lower(btrim(b.name)) = lower(btrim(g.name))
  AND g.deleted_at IS NULL
  AND g.crm_brand_id IS NULL;

-- ── 5. Dedupe por marca: dos DS vivos para la misma marca CRM →
--       se conserva el más reciente, el otro va a papelera ──
DO $$
DECLARE
  dup RECORD;
BEGIN
  FOR dup IN
    SELECT crm_brand_id
    FROM brand_guidelines
    WHERE crm_brand_id IS NOT NULL AND deleted_at IS NULL
    GROUP BY crm_brand_id
    HAVING COUNT(*) > 1
  LOOP
    UPDATE brand_guidelines g
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE g.crm_brand_id = dup.crm_brand_id
      AND g.deleted_at IS NULL
      AND g.id NOT IN (
        SELECT g2.id FROM brand_guidelines g2
        WHERE g2.crm_brand_id = dup.crm_brand_id
          AND g2.deleted_at IS NULL
        ORDER BY COALESCE(g2.updated_at, g2.created_at) DESC
        LIMIT 1
      );
  END LOOP;
END $$;

-- ── 6. REGLA DURA: una marca viva = UN solo Design System ──
-- Parcial: filas de papelera (deleted_at) y huérfanas (NULL) no cuentan.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bg_one_ds_per_brand
  ON brand_guidelines (crm_brand_id)
  WHERE deleted_at IS NULL AND crm_brand_id IS NOT NULL;

-- ── 7. Unicidad de nombre a nivel DB (antes era solo runtime) ──
CREATE UNIQUE INDEX IF NOT EXISTS uq_bg_name_per_workspace
  ON brand_guidelines (workspace_id, lower(btrim(name)))
  WHERE deleted_at IS NULL;

-- ═══════════════════════════════════════════════════════════════
-- END v35 — una marca, un Design System, garantizado por la DB.
-- ═══════════════════════════════════════════════════════════════
