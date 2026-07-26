-- Futuraria CRM - Migration 004
-- Consolidate contacts into leads + company_id FK

ALTER TABLE leads ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'other';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leads' AND column_name = 'company_id'
  ) THEN
    ALTER TABLE leads ADD COLUMN company_id UUID REFERENCES companies(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_leads_company_id ON leads(company_id);
CREATE INDEX IF NOT EXISTS idx_leads_role ON leads(role);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'contacts') THEN
    INSERT INTO leads (full_name, email, phone, whatsapp, company_name, role, tags, notes, stage, priority, source)
    SELECT c.full_name, c.email, c.phone, c.whatsapp, c.company_name,
      COALESCE(c.role::text, 'other'), COALESCE(c.tags, '{}'), c.notes,
      'new', 'medium', 'other'
    FROM contacts c WHERE c.lead_id IS NULL;

    UPDATE leads l SET role = COALESCE(c.role::text, l.role)
    FROM contacts c WHERE c.lead_id = l.id AND c.role IS NOT NULL;
  END IF;
END $$;

UPDATE leads l SET company_id = c.id
FROM companies c
WHERE l.company_id IS NULL AND l.company_name IS NOT NULL AND LOWER(TRIM(l.company_name)) = LOWER(TRIM(c.name));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'contacts') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notes' AND column_name = 'contact_id') THEN
      UPDATE notes n SET lead_id = c.lead_id FROM contacts c WHERE n.contact_id = c.id AND n.lead_id IS NULL AND c.lead_id IS NOT NULL;
      ALTER TABLE notes DROP COLUMN contact_id;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'activities' AND column_name = 'contact_id') THEN
      UPDATE activities a SET lead_id = c.lead_id FROM contacts c WHERE a.contact_id = c.id AND a.lead_id IS NULL AND c.lead_id IS NOT NULL;
      ALTER TABLE activities DROP COLUMN contact_id;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'deals' AND column_name = 'contact_id') THEN
      UPDATE deals d SET lead_id = COALESCE(d.lead_id, c.lead_id) FROM contacts c WHERE d.contact_id = c.id AND d.lead_id IS NULL AND c.lead_id IS NOT NULL;
      ALTER TABLE deals DROP COLUMN contact_id;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'contact_id') THEN
      UPDATE tasks t SET lead_id = COALESCE(t.lead_id, c.lead_id) FROM contacts c WHERE t.contact_id = c.id AND t.lead_id IS NULL AND c.lead_id IS NOT NULL;
      ALTER TABLE tasks DROP COLUMN contact_id;
    END IF;
  END IF;
END $$;

DROP TABLE IF EXISTS contacts CASCADE;