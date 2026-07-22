-- Futuraria Design — Migration v10: CRM accounts + Obsidian commercial graph
-- Apply after v9. Idempotent and safe to re-run.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- A brand is the commercial account. People are stakeholders linked through
-- crm_contacts; lead/client therefore belongs to the brand, not to a person.
ALTER TABLE brands ADD COLUMN IF NOT EXISTS relationship_status TEXT NOT NULL DEFAULT 'lead';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'brands_relationship_status_check'
  ) THEN
    ALTER TABLE brands ADD CONSTRAINT brands_relationship_status_check
      CHECK (relationship_status IN ('lead', 'client'));
  END IF;
END $$;

-- Campaigns are first-class so many files can share one stable campaign.
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY DEFAULT ('campaign_' || substr(md5(random()::text), 1, 20)),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brands_workspace_relationship
  ON brands(workspace_id, relationship_status, name);
CREATE INDEX IF NOT EXISTS idx_campaigns_workspace_brand
  ON campaigns(workspace_id, brand_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_workspace_brand_name
  ON campaigns(workspace_id, brand_id, lower(name));

ALTER TABLE design_file_meta ADD COLUMN IF NOT EXISTS brand_id TEXT REFERENCES brands(id) ON DELETE SET NULL;
ALTER TABLE design_file_meta ADD COLUMN IF NOT EXISTS campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL;
ALTER TABLE design_file_meta ADD COLUMN IF NOT EXISTS asset_type TEXT NOT NULL DEFAULT 'other';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'design_file_meta_asset_type_check'
  ) THEN
    ALTER TABLE design_file_meta ADD CONSTRAINT design_file_meta_asset_type_check
      CHECK (asset_type IN ('key_visual', 'social_media', 'web', 'mailing', 'other'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dfm_brand_id ON design_file_meta(brand_id);
CREATE INDEX IF NOT EXISTS idx_dfm_campaign_id ON design_file_meta(campaign_id);
CREATE INDEX IF NOT EXISTS idx_dfm_asset_type ON design_file_meta(workspace_id, asset_type);

-- Materialize legacy free-text brands without deleting or rewriting metadata.
INSERT INTO brands (id, workspace_id, name, relationship_status)
SELECT
  'brand_' || substr(md5(dfm.workspace_id || ':' || lower(trim(dfm.brand))), 1, 20),
  dfm.workspace_id,
  trim(dfm.brand),
  'client'
FROM design_file_meta dfm
WHERE dfm.workspace_id IS NOT NULL AND nullif(trim(dfm.brand), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM brands b
    WHERE b.workspace_id = dfm.workspace_id AND lower(trim(b.name)) = lower(trim(dfm.brand))
  )
GROUP BY dfm.workspace_id, trim(dfm.brand)
ON CONFLICT (id) DO NOTHING;

INSERT INTO brands (id, workspace_id, name, relationship_status)
SELECT
  'brand_' || substr(md5(c.workspace_id || ':' || lower(trim(coalesce(c.brand_name, c.company)))), 1, 20),
  c.workspace_id,
  trim(coalesce(c.brand_name, c.company)),
  CASE WHEN bool_or(c.status = 'active') THEN 'client' ELSE 'lead' END
FROM crm_contacts c
WHERE nullif(trim(coalesce(c.brand_name, c.company)), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM brands b
    WHERE b.workspace_id = c.workspace_id
      AND lower(trim(b.name)) = lower(trim(coalesce(c.brand_name, c.company)))
  )
GROUP BY c.workspace_id, trim(coalesce(c.brand_name, c.company))
ON CONFLICT (id) DO NOTHING;

-- Existing brands already used by designs are treated as clients. After this
-- migration users can explicitly change them to leads from the CRM.
UPDATE brands b
SET relationship_status = 'client', updated_at = NOW()
WHERE EXISTS (
  SELECT 1 FROM design_file_meta dfm
  WHERE dfm.workspace_id = b.workspace_id
    AND lower(trim(dfm.brand)) = lower(trim(b.name))
);

UPDATE design_file_meta dfm
SET brand_id = b.id
FROM brands b
WHERE dfm.brand_id IS NULL
  AND b.workspace_id = dfm.workspace_id
  AND lower(trim(b.name)) = lower(trim(dfm.brand));

UPDATE crm_contacts c
SET brand_id = b.id,
    brand_name = b.name,
    updated_at = NOW()
FROM brands b
WHERE c.brand_id IS NULL
  AND b.workspace_id = c.workspace_id
  AND lower(trim(b.name)) = lower(trim(coalesce(c.brand_name, c.company)));

-- Materialize the old campaign text and connect each file to its campaign.
INSERT INTO campaigns (id, workspace_id, brand_id, name)
SELECT
  'campaign_' || substr(md5(dfm.workspace_id || ':' || dfm.brand_id || ':' || lower(trim(dfm.campaign))), 1, 20),
  dfm.workspace_id,
  dfm.brand_id,
  trim(dfm.campaign)
FROM design_file_meta dfm
WHERE dfm.workspace_id IS NOT NULL
  AND dfm.brand_id IS NOT NULL
  AND nullif(trim(dfm.campaign), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM campaigns c
    WHERE c.workspace_id = dfm.workspace_id
      AND c.brand_id = dfm.brand_id
      AND lower(trim(c.name)) = lower(trim(dfm.campaign))
  )
GROUP BY dfm.workspace_id, dfm.brand_id, trim(dfm.campaign)
ON CONFLICT (id) DO NOTHING;

UPDATE design_file_meta dfm
SET campaign_id = c.id
FROM campaigns c
WHERE dfm.campaign_id IS NULL
  AND c.workspace_id = dfm.workspace_id
  AND c.brand_id = dfm.brand_id
  AND lower(trim(c.name)) = lower(trim(dfm.campaign));

UPDATE design_file_meta
SET asset_type = CASE lower(coalesce(format, ''))
  WHEN 'social' THEN 'social_media'
  WHEN 'web' THEN 'web'
  WHEN 'mobile' THEN 'web'
  WHEN 'email' THEN 'mailing'
  ELSE 'other'
END
WHERE asset_type = 'other';

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campaigns_workspace_read" ON campaigns;
CREATE POLICY "campaigns_workspace_read" ON campaigns FOR SELECT
  USING (has_workspace_role(workspace_id, 'viewer'));
DROP POLICY IF EXISTS "campaigns_workspace_write" ON campaigns;
CREATE POLICY "campaigns_workspace_write" ON campaigns FOR ALL
  USING (has_workspace_role(workspace_id, 'editor'))
  WITH CHECK (has_workspace_role(workspace_id, 'editor'));

GRANT SELECT, INSERT, UPDATE, DELETE ON campaigns TO authenticated;
