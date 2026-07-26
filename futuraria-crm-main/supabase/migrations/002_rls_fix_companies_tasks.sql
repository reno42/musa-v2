-- =============================================
-- Futuraria CRM — Migration 002
-- Fix RLS + Companies + Tasks + Views
-- =============================================

-- =============================================
-- 1. FIX RLS — Add permissive policies for anon role
-- The app uses publishable key (anon role) for frontend queries.
-- Original policies only allowed 'authenticated' role.
-- =============================================

-- Leads: allow anon full access (internal CRM, no auth required)
DROP POLICY IF EXISTS "Authenticated full access" ON leads;
CREATE POLICY "Public full access" ON leads FOR ALL USING (true) WITH CHECK (true);

-- Contacts: allow anon full access
DROP POLICY IF EXISTS "Authenticated full access" ON contacts;
CREATE POLICY "Public full access" ON contacts FOR ALL USING (true) WITH CHECK (true);

-- Deals: allow anon full access
DROP POLICY IF EXISTS "Authenticated full access" ON deals;
CREATE POLICY "Public full access" ON deals FOR ALL USING (true) WITH CHECK (true);

-- Activities: allow anon full access
DROP POLICY IF EXISTS "Authenticated full access" ON activities;
CREATE POLICY "Public full access" ON activities FOR ALL USING (true) WITH CHECK (true);

-- Email templates: allow anon read, authenticated write
DROP POLICY IF EXISTS "Authenticated full access" ON email_templates;
CREATE POLICY "Public read access" ON email_templates FOR SELECT USING (true);
CREATE POLICY "Authenticated write access" ON email_templates FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- Webhook logs: keep service role only (already correct)

-- =============================================
-- 2. COMPANIES TABLE (Twenty CRM feature)
-- =============================================

CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  name TEXT NOT NULL,
  domain TEXT,                    -- website domain (e.g., "acme.com")
  industry TEXT,
  size TEXT,                      -- "1-10", "11-50", "51-200", "201-500", "500+"
  
  -- Contact info
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  country TEXT,
  
  -- Social
  linkedin_url TEXT,
  twitter_url TEXT,
  website TEXT,
  
  -- Business
  revenue_range TEXT,             -- "<$1M", "$1M-$10M", "$10M-$50M", "$50M+"
  description TEXT,
  logo_url TEXT,
  
  -- Metadata
  tags TEXT[] DEFAULT '{}',
  notes TEXT,
  assigned_to UUID,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Link leads to companies
ALTER TABLE leads ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(name);
CREATE INDEX IF NOT EXISTS idx_companies_domain ON companies(domain);
CREATE INDEX IF NOT EXISTS idx_companies_industry ON companies(industry);
CREATE INDEX IF NOT EXISTS idx_leads_company_id ON leads(company_id);

-- RLS
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public full access" ON companies FOR ALL USING (true) WITH CHECK (true);

-- Trigger
CREATE TRIGGER trigger_companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================
-- 3. TASKS TABLE (Twenty CRM feature)
-- =============================================

CREATE TYPE task_status AS ENUM ('todo', 'in_progress', 'done', 'cancelled');
CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high', 'urgent');

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  title TEXT NOT NULL,
  description TEXT,
  status task_status DEFAULT 'todo',
  priority task_priority DEFAULT 'medium',
  
  -- Relations
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  
  -- Scheduling
  due_date TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  
  -- Assignment
  assigned_to UUID,
  
  -- Metadata
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_lead ON tasks(lead_id);
CREATE INDEX IF NOT EXISTS idx_tasks_company ON tasks(company_id);

-- RLS
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public full access" ON tasks FOR ALL USING (true) WITH CHECK (true);

-- Trigger
CREATE TRIGGER trigger_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================
-- 4. VIEWS
-- =============================================

-- Company stats view
CREATE OR REPLACE VIEW company_stats AS
SELECT
  c.id,
  c.name,
  c.industry,
  COUNT(DISTINCT l.id) as lead_count,
  COUNT(DISTINCT d.id) as deal_count,
  COALESCE(SUM(d.value), 0) as total_deal_value,
  MAX(l.created_at) as last_lead_at
FROM companies c
LEFT JOIN leads l ON l.company_id = c.id
LEFT JOIN deals d ON d.lead_id = l.id
GROUP BY c.id, c.name, c.industry;

-- Task summary view
CREATE OR REPLACE VIEW task_summary AS
SELECT
  status,
  COUNT(*) as count,
  COUNT(CASE WHEN due_date < NOW() AND status NOT IN ('done', 'cancelled') THEN 1 END) as overdue_count
FROM tasks
GROUP BY status;

-- =============================================
-- 5. SEED DATA — Companies
-- =============================================

INSERT INTO companies (name, domain, industry, size, website, description) VALUES
('Futuraria', 'futuraria.com', 'Digital Agency', '1-10', 'https://futuraria.com', 'Agencia de transformación digital con IA')
ON CONFLICT DO NOTHING;
