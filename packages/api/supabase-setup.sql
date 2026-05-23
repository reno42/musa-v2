-- Supabase setup for Futuraria Design (v3 — Sprints 3+4+5 merged)
-- Run this in Supabase SQL Editor
-- Idempotent: uses IF NOT EXISTS everywhere

-- ============================================================
-- Templates table
-- ============================================================
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  data JSONB NOT NULL,
  user_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- API Keys table (Sprint 4)
-- ============================================================
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'Default Key',
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  permissions TEXT[] NOT NULL DEFAULT ARRAY['templates:read', 'templates:write', 'render', 'webhooks'],
  last_used_at TIMESTAMPTZ,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Render logs table
-- ============================================================
CREATE TABLE IF NOT EXISTS render_logs (
  id TEXT PRIMARY KEY,
  template_id TEXT REFERENCES templates(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  format TEXT NOT NULL DEFAULT 'png',
  url TEXT,
  error TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- ============================================================
-- Webhooks table
-- ============================================================
CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  events TEXT[] NOT NULL,
  secret TEXT,
  user_id TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Styles table (Sprint 3)
-- ============================================================
CREATE TABLE IF NOT EXISTS styles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('color', 'text', 'effect')),
  data JSONB NOT NULL,
  user_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Components table (Sprint 3)
-- ============================================================
CREATE TABLE IF NOT EXISTS components (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Comments table (Sprint 5)
-- ============================================================
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  frame_id TEXT,
  x DOUBLE PRECISION DEFAULT 0,
  y DOUBLE PRECISION DEFAULT 0,
  author TEXT NOT NULL,
  text TEXT NOT NULL,
  thread JSONB DEFAULT '[]',
  resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Template versions table (Sprint 5)
-- ============================================================
CREATE TABLE IF NOT EXISTS template_versions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  data JSONB NOT NULL,
  author TEXT,
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Storage bucket for renders (Sprint 4)
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('design-exports', 'design-exports', true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_templates_created ON templates(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_templates_user ON templates(user_id);
CREATE INDEX IF NOT EXISTS idx_render_logs_template ON render_logs(template_id);
CREATE INDEX IF NOT EXISTS idx_render_logs_status ON render_logs(status);
CREATE INDEX IF NOT EXISTS idx_render_logs_created ON render_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_user ON webhooks(user_id);
CREATE INDEX IF NOT EXISTS idx_styles_created ON styles(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_styles_type ON styles(type);
CREATE INDEX IF NOT EXISTS idx_styles_user ON styles(user_id);
CREATE INDEX IF NOT EXISTS idx_components_created ON components(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_components_name ON components(name);
CREATE INDEX IF NOT EXISTS idx_comments_template ON comments(template_id);
CREATE INDEX IF NOT EXISTS idx_comments_created ON comments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_template_versions_template ON template_versions(template_id);
CREATE INDEX IF NOT EXISTS idx_template_versions_number ON template_versions(template_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_variables_template ON variables(template_id);
CREATE INDEX IF NOT EXISTS idx_variables_created ON variables(created_at DESC);

-- ============================================================
-- Row Level Security
-- ============================================================
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE render_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE styles ENABLE ROW LEVEL SECURITY;
ALTER TABLE components ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE variables ENABLE ROW LEVEL SECURITY;

-- Service role full access policies
CREATE POLICY "Service role full access on templates" ON templates
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on render_logs" ON render_logs
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on webhooks" ON webhooks
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on api_keys" ON api_keys
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on styles" ON styles
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on components" ON components
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on comments" ON comments
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on template_versions" ON template_versions
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on variables" ON variables
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================================
-- Storage policies for design-exports bucket
-- ============================================================
CREATE POLICY "Public read access for design-exports"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'design-exports');

CREATE POLICY "Service role upload to design-exports"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'design-exports' AND auth.role() = 'service_role');

CREATE POLICY "Service role delete from design-exports"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'design-exports' AND auth.role() = 'service_role');

-- ============================================================
-- Variables / Design Tokens table (Sprint 6)
-- ============================================================
CREATE TABLE IF NOT EXISTS variables (
  id TEXT PRIMARY KEY DEFAULT ('var_' || gen_random_uuid()),
  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  data JSONB NOT NULL DEFAULT '{"collections":[],"variables":[],"bindings":{}}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Auto-update updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_templates_updated_at
  BEFORE UPDATE ON templates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_styles_updated_at
  BEFORE UPDATE ON styles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_components_updated_at
  BEFORE UPDATE ON components
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_comments_updated_at
  BEFORE UPDATE ON comments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_variables_updated_at
  BEFORE UPDATE ON variables
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
