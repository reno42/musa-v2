-- Futuraria Design — Migration v14: workspace CRM deals and deliverables
-- Apply after v13. Idempotent and safe to re-run.
--
-- Existing entities stay authoritative:
--   brands             = commercial accounts
--   crm_contacts       = human stakeholders
--   campaigns          = campaign context
--   design_file_meta   = design files and their asset taxonomy
--
-- This migration adds the commercial/production layer that connects them.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- A brand can remain a client while its health changes to at-risk or churned.
-- This preserves the lead/client model used by the knowledge graph.
ALTER TABLE brands ADD COLUMN IF NOT EXISTS account_health TEXT NOT NULL DEFAULT 'active';
ALTER TABLE brands ADD COLUMN IF NOT EXISTS crm_priority TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE brands ADD COLUMN IF NOT EXISTS crm_notes TEXT;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS next_follow_up_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'brands_account_health_check'
  ) THEN
    ALTER TABLE brands ADD CONSTRAINT brands_account_health_check
      CHECK (account_health IN ('active', 'at_risk', 'churned'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'brands_crm_priority_check'
  ) THEN
    ALTER TABLE brands ADD CONSTRAINT brands_crm_priority_check
      CHECK (crm_priority IN ('low', 'medium', 'high', 'urgent'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_brands_workspace_crm
  ON brands(workspace_id, relationship_status, account_health, crm_priority);

-- Deals cover both the sales pipeline and the design-production handoff.
CREATE TABLE IF NOT EXISTS crm_deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  primary_contact_id UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  stage TEXT NOT NULL DEFAULT 'discovery' CHECK (
    stage IN (
      'discovery', 'proposal', 'negotiation', 'approved',
      'in_production', 'review', 'ready', 'delivered', 'lost'
    )
  ),
  value NUMERIC(12, 2),
  currency TEXT NOT NULL DEFAULT 'USD',
  probability INTEGER NOT NULL DEFAULT 10 CHECK (probability BETWEEN 0 AND 100),
  expected_close_date DATE,
  due_date DATE,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_deals_workspace_stage
  ON crm_deals(workspace_id, stage, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_deals_brand
  ON crm_deals(workspace_id, brand_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_deals_campaign
  ON crm_deals(campaign_id) WHERE campaign_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_deals_id_workspace
  ON crm_deals(id, workspace_id);

-- One row represents a measurable line item in a deal:
-- e.g. 8 social-media pieces or 1 landing page.
CREATE TABLE IF NOT EXISTS crm_deal_deliverables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL,
  label TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 10000),
  sort_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_deliverables_deal
  ON crm_deal_deliverables(deal_id, sort_order, created_at);
CREATE INDEX IF NOT EXISTS idx_crm_deliverables_workspace_asset
  ON crm_deal_deliverables(workspace_id, asset_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_deliverables_id_workspace
  ON crm_deal_deliverables(id, workspace_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_deliverables_deal_workspace_fk'
  ) THEN
    ALTER TABLE crm_deal_deliverables ADD CONSTRAINT crm_deliverables_deal_workspace_fk
      FOREIGN KEY (deal_id, workspace_id) REFERENCES crm_deals(id, workspace_id) ON DELETE CASCADE;
  END IF;
END $$;

-- Explicit links are the source of truth for "this requested asset exists".
-- A design file can satisfy only one deliverable, avoiding double counting.
CREATE TABLE IF NOT EXISTS crm_deliverable_files (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  deliverable_id UUID NOT NULL REFERENCES crm_deal_deliverables(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  linked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (deliverable_id, template_id),
  UNIQUE (workspace_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_deliverable_files_workspace
  ON crm_deliverable_files(workspace_id, linked_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_deliverable_files_workspace_fk'
  ) THEN
    ALTER TABLE crm_deliverable_files ADD CONSTRAINT crm_deliverable_files_workspace_fk
      FOREIGN KEY (deliverable_id, workspace_id)
      REFERENCES crm_deal_deliverables(id, workspace_id) ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE crm_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_deal_deliverables ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_deliverable_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "crm_deals_workspace_read" ON crm_deals;
CREATE POLICY "crm_deals_workspace_read" ON crm_deals FOR SELECT
  USING (has_workspace_role(workspace_id, 'viewer'));
DROP POLICY IF EXISTS "crm_deals_workspace_write" ON crm_deals;
CREATE POLICY "crm_deals_workspace_write" ON crm_deals FOR ALL
  USING (has_workspace_role(workspace_id, 'editor'))
  WITH CHECK (
    has_workspace_role(workspace_id, 'editor')
    AND EXISTS (
      SELECT 1 FROM brands b
      WHERE b.id = crm_deals.brand_id AND b.workspace_id = crm_deals.workspace_id
    )
    AND (
      crm_deals.campaign_id IS NULL OR EXISTS (
        SELECT 1 FROM campaigns c
        WHERE c.id = crm_deals.campaign_id
          AND c.workspace_id = crm_deals.workspace_id
          AND c.brand_id = crm_deals.brand_id
      )
    )
    AND (
      crm_deals.primary_contact_id IS NULL OR EXISTS (
        SELECT 1 FROM crm_contacts contact
        WHERE contact.id = crm_deals.primary_contact_id
          AND contact.workspace_id = crm_deals.workspace_id
          AND contact.brand_id = crm_deals.brand_id
      )
    )
  );

DROP POLICY IF EXISTS "crm_deliverables_workspace_read" ON crm_deal_deliverables;
CREATE POLICY "crm_deliverables_workspace_read" ON crm_deal_deliverables FOR SELECT
  USING (has_workspace_role(workspace_id, 'viewer'));
DROP POLICY IF EXISTS "crm_deliverables_workspace_write" ON crm_deal_deliverables;
CREATE POLICY "crm_deliverables_workspace_write" ON crm_deal_deliverables FOR ALL
  USING (has_workspace_role(workspace_id, 'editor'))
  WITH CHECK (
    has_workspace_role(workspace_id, 'editor')
    AND EXISTS (
      SELECT 1 FROM crm_deals deal
      WHERE deal.id = crm_deal_deliverables.deal_id
        AND deal.workspace_id = crm_deal_deliverables.workspace_id
    )
  );

DROP POLICY IF EXISTS "crm_deliverable_files_workspace_read" ON crm_deliverable_files;
CREATE POLICY "crm_deliverable_files_workspace_read" ON crm_deliverable_files FOR SELECT
  USING (
    has_workspace_role(workspace_id, 'viewer')
    AND EXISTS (
      SELECT 1 FROM crm_deal_deliverables deliverable
      WHERE deliverable.id = crm_deliverable_files.deliverable_id
        AND deliverable.workspace_id = crm_deliverable_files.workspace_id
    )
    AND EXISTS (
      SELECT 1 FROM templates template
      WHERE template.id = crm_deliverable_files.template_id
        AND template.workspace_id = crm_deliverable_files.workspace_id
    )
  );
DROP POLICY IF EXISTS "crm_deliverable_files_workspace_write" ON crm_deliverable_files;
CREATE POLICY "crm_deliverable_files_workspace_write" ON crm_deliverable_files FOR ALL
  USING (
    has_workspace_role(workspace_id, 'editor')
    AND EXISTS (
      SELECT 1 FROM crm_deal_deliverables deliverable
      WHERE deliverable.id = crm_deliverable_files.deliverable_id
        AND deliverable.workspace_id = crm_deliverable_files.workspace_id
    )
    AND EXISTS (
      SELECT 1 FROM templates template
      WHERE template.id = crm_deliverable_files.template_id
        AND template.workspace_id = crm_deliverable_files.workspace_id
    )
  )
  WITH CHECK (
    has_workspace_role(workspace_id, 'editor')
    AND EXISTS (
      SELECT 1 FROM crm_deal_deliverables deliverable
      WHERE deliverable.id = crm_deliverable_files.deliverable_id
        AND deliverable.workspace_id = crm_deliverable_files.workspace_id
    )
    AND EXISTS (
      SELECT 1 FROM templates template
      WHERE template.id = crm_deliverable_files.template_id
        AND template.workspace_id = crm_deliverable_files.workspace_id
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON crm_deals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm_deal_deliverables TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm_deliverable_files TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
