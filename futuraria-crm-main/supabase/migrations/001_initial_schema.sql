-- =============================================
-- Futuraria CRM — Database Schema
-- Supabase PostgreSQL
-- =============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- ENUMS
-- =============================================

CREATE TYPE lead_source AS ENUM (
  'website', 'referral', 'linkedin', 'cold_outreach',
  'event', 'social_media', 'organic', 'partner', 'other'
);

CREATE TYPE lead_stage AS ENUM (
  'new',            -- Lead recién llegado
  'researching',    -- Investigando (BuiltWith, LinkedIn, etc.)
  'contacted',      -- Primer contacto hecho
  'qualified',      -- Calificado (presupuesto, necesidad, timeline)
  'demo_scheduled', -- Demo agendada
  'proposal_sent',  -- Propuesta enviada
  'negotiation',    -- En negociación
  'won',            -- Ganado
  'lost',           -- Perdido
  'nurturing'       -- En nurturing (largo plazo)
);

CREATE TYPE lead_priority AS ENUM ('low', 'medium', 'high', 'urgent');

CREATE TYPE deal_stage AS ENUM (
  'discovery', 'proposal', 'negotiation', 'closed_won', 'closed_lost'
);

CREATE TYPE activity_type AS ENUM (
  'note', 'email', 'call', 'meeting', 'whatsapp',
  'demo', 'proposal', 'follow_up', 'status_change', 'enrichment'
);

CREATE TYPE contact_role AS ENUM (
  'decision_maker', 'influencer', 'buyer', 'end_user',
  'champion', 'gatekeeper', 'other'
);

-- =============================================
-- CORE TABLES
-- =============================================

-- Leads (tabla principal)
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Contacto
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  whatsapp TEXT,
  
  -- Empresa
  company_name TEXT,
  company_role TEXT,
  industry TEXT,
  company_size TEXT,
  
  -- Fuente y tracking
  source lead_source DEFAULT 'other',
  source_detail TEXT,        -- "LinkedIn post comment", "Cal.com booking"
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  
  -- Pipeline
  stage lead_stage DEFAULT 'new',
  priority lead_priority DEFAULT 'medium',
  assigned_to UUID,          -- Auth user ID
  
  -- Lead scoring (0-100)
  score INTEGER DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  score_breakdown JSONB DEFAULT '{}',
  -- {"digital_maturity": 8, "budget_fit": 6, "timing": 9, "authority": 7}
  
  -- Enrichment data (proceso de búsqueda manual)
  enrichment JSONB DEFAULT '{}',
  -- {
  --   "website": "https://...",
  --   "domain_age_years": 5,
  --   "tech_stack": ["wordpress", "elementor", "google_analytics"],
  --   "uses_elementor": true,
  --   "has_blog": true,
  --   "blog_last_post_date": "2025-01-15",
  --   "has_ecommerce": false,
  --   "social_media": {"linkedin": "...", "instagram": "...", "facebook": "..."},
  --   "social_media_active": true,
  --   "has_youtube": false,
  --   "has_hotmart": false,
  --   "press_mentions": 0,
  --   "google_my_business": true,
  --   "digital_maturity_level": "intermediate",
  --   "has_vsl": false,
  --   "homonimos_found": false,
  --   "operates_multicountry": false,
  --   "channels_found": ["linktree", "substack"]
  -- }
  
  -- Digital presence analysis (del proceso de búsqueda)
  digital_presence JSONB DEFAULT '{}',
  -- {
  --   "website_type": "corporate|vsl|both|none",
  --   "last_website_update_year": 2023,
  --   "content_strategy": "blog|social|none|testing",
  --   "linkedin_active": true,
  --   "instagram_strategy": "educational|promotional|mixed|none",
  --   "perceived_digital_level": "beginner|intermediate|advanced",
  --   "needs_explanation": ["branding", "web", "analytics", "automation"]
  -- }
  
  -- Qualification
  budget_range TEXT,          -- "$1K-5K", "$5K-15K", "$15K+"
  timeline TEXT,              -- "immediate", "1-3_months", "3-6_months", "6+_months"
  pain_points TEXT[],         -- Array de dolores identificados
  interests TEXT[],           -- Servicios de interés
  
  -- Metadata
  tags TEXT[] DEFAULT '{}',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_contacted_at TIMESTAMPTZ,
  next_follow_up_at TIMESTAMPTZ
);

-- Contactos (múltiples por lead/empresa)
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  whatsapp TEXT,
  role contact_role DEFAULT 'other',
  company_name TEXT,
  title TEXT,
  linkedin_url TEXT,
  
  is_primary BOOLEAN DEFAULT FALSE,
  tags TEXT[] DEFAULT '{}',
  notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Deals (oportunidades de venta)
CREATE TABLE deals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  
  title TEXT NOT NULL,
  description TEXT,
  stage deal_stage DEFAULT 'discovery',
  value DECIMAL(12,2),
  currency TEXT DEFAULT 'USD',
  probability INTEGER DEFAULT 10 CHECK (probability >= 0 AND probability <= 100),
  
  -- Servicios incluidos
  services TEXT[],            -- ["automatizacion_marketing", "web_desarrollo"]
  expected_close_date DATE,
  actual_close_date DATE,
  
  assigned_to UUID,
  notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Actividades (audit trail completo)
CREATE TABLE activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  
  type activity_type NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  metadata JSONB DEFAULT '{}',
  -- {"email_subject": "...", "call_duration_min": 15, "meeting_link": "..."}
  
  performed_by UUID,          -- Auth user ID
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Plantillas de email
CREATE TABLE email_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT,              -- "first_contact", "follow_up", "demo_invite", "proposal"
  
  is_active BOOLEAN DEFAULT TRUE,
  usage_count INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Webhook event log (para debugging n8n)
CREATE TABLE webhook_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  response_status INTEGER,
  response_body JSONB,
  error_message TEXT,
  
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- INDEXES
-- =============================================

CREATE INDEX idx_leads_stage ON leads(stage);
CREATE INDEX idx_leads_email ON leads(email);
CREATE INDEX idx_leads_company ON leads(company_name);
CREATE INDEX idx_leads_score ON leads(score DESC);
CREATE INDEX idx_leads_created ON leads(created_at DESC);
CREATE INDEX idx_leads_next_follow_up ON leads(next_follow_up_at) WHERE next_follow_up_at IS NOT NULL;
CREATE INDEX idx_contacts_lead ON contacts(lead_id);
CREATE INDEX idx_contacts_email ON contacts(email);
CREATE INDEX idx_deals_lead ON deals(lead_id);
CREATE INDEX idx_deals_stage ON deals(stage);
CREATE INDEX idx_activities_lead ON activities(lead_id);
CREATE INDEX idx_activities_created ON activities(created_at DESC);

-- =============================================
-- FUNCTIONS
-- =============================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_deals_updated_at
  BEFORE UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_email_templates_updated_at
  BEFORE UPDATE ON email_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-log stage changes
CREATE OR REPLACE FUNCTION log_stage_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.stage IS DISTINCT FROM NEW.stage THEN
    INSERT INTO activities (lead_id, type, title, description, metadata)
    VALUES (
      NEW.id,
      'status_change',
      'Stage changed: ' || OLD.stage || ' → ' || NEW.stage,
      'Pipeline stage updated',
      jsonb_build_object('old_stage', OLD.stage, 'new_stage', NEW.stage)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_leads_stage_change
  AFTER UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION log_stage_change();

-- Lead stats view
CREATE OR REPLACE VIEW lead_stats AS
SELECT
  stage,
  COUNT(*) as count,
  AVG(score)::INTEGER as avg_score,
  SUM(CASE WHEN priority = 'urgent' THEN 1 ELSE 0 END) as urgent_count
FROM leads
GROUP BY stage;

-- Pipeline value view
CREATE OR REPLACE VIEW pipeline_summary AS
SELECT
  stage,
  COUNT(*) as deal_count,
  SUM(value) as total_value,
  AVG(probability)::INTEGER as avg_probability,
  SUM(value * probability / 100) as weighted_value
FROM deals
WHERE stage NOT IN ('closed_won', 'closed_lost')
GROUP BY stage;

-- =============================================
-- RLS (Row Level Security)
-- =============================================

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;

-- Authenticated users can do everything
CREATE POLICY "Authenticated full access" ON leads FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated full access" ON contacts FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated full access" ON deals FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated full access" ON activities FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated full access" ON email_templates FOR ALL USING (auth.role() = 'authenticated');

-- Webhook logs: service role only
CREATE POLICY "Service role only" ON webhook_logs FOR ALL USING (auth.role() = 'service_role');

-- =============================================
-- SEED DATA (plantillas de email de Futuraria)
-- =============================================

INSERT INTO email_templates (name, subject, body, category) VALUES
(
  'Primer contacto - Web',
  'Vi tu consulta en futuraria.com — ¿agendamos 15 min?',
  E'Hola {{full_name}},\n\nGracias por comunicarte con Futuraria. Vi que estás explorando soluciones de {{interest}} para {{company_name}}.\n\n¿Te parece agendar 15 minutos para entender tu caso específico?\n\n👉 Agendar aquí: https://cal.com/your-org/event-type\n\nSaludos,\nFuturaria Team',
  'first_contact'
),
(
  'Follow-up post demo',
  'Resumen de nuestra conversación + próximos pasos',
  E'Hola {{full_name}},\n\nGracias por tu tiempo en la demo de hoy. Como hablamos:\n\n{{demo_summary}}\n\nPróximos pasos:\n1. {{next_step_1}}\n2. {{next_step_2}}\n\n¿Tienes alguna pregunta?\n\nSaludos,\nFuturaria Team',
  'follow_up'
),
(
  'Propuesta',
  'Propuesta para {{company_name}} — Soluciones de IA y Automatización',
  E'Hola {{full_name}},\n\nAdjunto encontrarás la propuesta que preparamos para {{company_name}}.\n\nResumen:\n- Servicios: {{services}}\n- Inversión: {{price}}\n- Timeline: {{timeline}}\n\n¿Agendamos una llamada para revisarla?\n\nSaludos,\nFuturaria Team',
  'proposal'
);
