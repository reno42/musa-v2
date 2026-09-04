-- supabase_migrations_v45.sql
-- Apply after v44. Idempotent and safe to re-run.
--
-- CRM commercial-interaction upgrade (DIATTA-inspired, Musa-native):
--   crm_interactions  = typed commercial timeline per brand/contact
--   crm_deals         += final_value, lost_reason (outcome bookkeeping)
--   brands            += account_health_override + audit (manual wins over computed)
--
-- Existing entities stay authoritative: deals, deliverables, files, design
-- systems and calendar lead-capture are untouched.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Manual health override: when set it wins over the computed health so a
-- humano can always correct the signal. Audit columns record who/when.
ALTER TABLE brands ADD COLUMN IF NOT EXISTS account_health_override TEXT;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS health_changed_at TIMESTAMPTZ;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS health_changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'brands_account_health_override_check'
  ) THEN
    ALTER TABLE brands ADD CONSTRAINT brands_account_health_override_check
      CHECK (account_health_override IN ('active', 'at_risk', 'churned'));
  END IF;
END $$;

-- Deal outcome: closed-lost needs a reason; closed-won (delivered) can record
-- the finally invoiced amount when it differs from the estimated value.
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS final_value NUMERIC(12, 2);
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS lost_reason TEXT;

-- One row = one commercial touchpoint (reunión, propuesta, pago, follow-up…).
-- This is the raw material for the per-contact funnel and the 360 timeline.
CREATE TABLE IF NOT EXISTS crm_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,
  interaction_type TEXT NOT NULL CHECK (
    interaction_type IN (
      'primer_contacto', 'reunion', 'llamada', 'email', 'whatsapp',
      'propuesta_enviada', 'revision', 'aprobacion', 'publicacion',
      'pago', 'follow_up', 'objecion', 'otro'
    )
  ),
  notes TEXT,
  data JSONB,
  interaction_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_interactions_workspace_brand
  ON crm_interactions(workspace_id, brand_id, interaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_crm_interactions_workspace_contact
  ON crm_interactions(workspace_id, contact_id, interaction_date DESC)
  WHERE contact_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_interactions_id_workspace
  ON crm_interactions(id, workspace_id);

ALTER TABLE crm_interactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "crm_interactions_workspace_read" ON crm_interactions;
CREATE POLICY "crm_interactions_workspace_read" ON crm_interactions FOR SELECT
  USING (has_workspace_role(workspace_id, 'viewer'));
DROP POLICY IF EXISTS "crm_interactions_workspace_write" ON crm_interactions;
CREATE POLICY "crm_interactions_workspace_write" ON crm_interactions FOR ALL
  USING (has_workspace_role(workspace_id, 'editor'))
  WITH CHECK (
    has_workspace_role(workspace_id, 'editor')
    AND EXISTS (
      SELECT 1 FROM brands b
      WHERE b.id = crm_interactions.brand_id AND b.workspace_id = crm_interactions.workspace_id
    )
    AND (
      crm_interactions.contact_id IS NULL OR EXISTS (
        SELECT 1 FROM crm_contacts contact
        WHERE contact.id = crm_interactions.contact_id
          AND contact.workspace_id = crm_interactions.workspace_id
          AND contact.brand_id = crm_interactions.brand_id
      )
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON crm_interactions TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
