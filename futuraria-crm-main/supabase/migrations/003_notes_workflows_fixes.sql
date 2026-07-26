-- =============================================
-- Futuraria CRM — Migration 003
-- Notes, Workflows, Webhook Logs, Fixes
-- =============================================

-- =============================================
-- 1. NOTES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  body TEXT,
  pinned BOOLEAN DEFAULT FALSE,
  color TEXT DEFAULT 'default',
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public full access" ON notes FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER trigger_notes_updated_at
  BEFORE UPDATE ON notes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_notes_pinned ON notes(pinned) WHERE pinned = true;
CREATE INDEX idx_notes_created ON notes(created_at DESC);
CREATE INDEX idx_notes_lead ON notes(lead_id);

-- =============================================
-- 2. WORKFLOW RUNS TABLE (n8n tracking)
-- =============================================
CREATE TABLE IF NOT EXISTS workflow_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_id TEXT NOT NULL,
  workflow_name TEXT,
  n8n_execution_id TEXT,
  status TEXT DEFAULT 'running',
  trigger_type TEXT,
  input_data JSONB DEFAULT '{}',
  output_data JSONB DEFAULT '{}',
  error_message TEXT,
  duration_ms INTEGER,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public full access" ON workflow_runs FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_workflow_runs_workflow ON workflow_runs(workflow_id);
CREATE INDEX idx_workflow_runs_status ON workflow_runs(status);
CREATE INDEX idx_workflow_runs_started ON workflow_runs(started_at DESC);

-- =============================================
-- 3. Ensure webhook_logs table exists
-- =============================================
CREATE TABLE IF NOT EXISTS webhook_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  response_status INTEGER,
  response_body JSONB,
  error_message TEXT,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public full access" ON webhook_logs FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_event ON webhook_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_processed ON webhook_logs(processed_at DESC);

-- =============================================
-- 4. SEED — Demo workflow entries
-- =============================================
INSERT INTO workflow_runs (workflow_id, workflow_name, status, trigger_type, started_at, finished_at, duration_ms)
VALUES
  ('demo-1', 'Lead Scoring Pipeline', 'success', 'cron', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours' + INTERVAL '45 seconds', 45000),
  ('demo-2', 'Daily Summary Email', 'success', 'cron', NOW() - INTERVAL '6 hours', NOW() - INTERVAL '6 hours' + INTERVAL '12 seconds', 12000),
  ('demo-3', 'Lead Enrichment Agent', 'error', 'webhook', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '1 hour' + INTERVAL '5 seconds', 5000)
ON CONFLICT DO NOTHING;
