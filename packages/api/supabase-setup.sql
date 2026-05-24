-- ═══════════════════════════════════════════════════════════════
-- Futuraria Design — Unified Supabase Setup
-- Run this single file in Supabase SQL Editor.
-- Idempotent: uses IF NOT EXISTS, IF NOT EXISTS, ADD COLUMN IF NOT EXISTS
-- ═══════════════════════════════════════════════════════════════

-- ============================================================
-- 1. TEMPLATES
-- ============================================================
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  data JSONB NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 2. API KEYS
-- ============================================================
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  name TEXT NOT NULL DEFAULT 'Default Key',
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  permissions TEXT[] NOT NULL DEFAULT ARRAY['templates:read','templates:write','render','webhooks'],
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3. RENDER LOGS
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
-- 4. WEBHOOKS
-- ============================================================
CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  events TEXT[] NOT NULL,
  secret TEXT,
  user_id UUID REFERENCES auth.users(id),
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 5. STYLES
-- ============================================================
CREATE TABLE IF NOT EXISTS styles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('color', 'text', 'effect')),
  data JSONB NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 6. COMPONENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS components (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  data JSONB NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 7. COMMENTS
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
-- 8. TEMPLATE VERSIONS
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
-- 9. VARIABLES / DESIGN TOKENS
-- ============================================================
CREATE TABLE IF NOT EXISTS variables (
  id TEXT PRIMARY KEY DEFAULT ('var_' || gen_random_uuid()),
  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  data JSONB NOT NULL DEFAULT '{"collections":[],"variables":[],"bindings":{}}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 10. STORAGE BUCKET (rendered images)
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('design-exports', 'design-exports', true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_templates_created ON templates(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_templates_user ON templates(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_render_logs_template ON render_logs(template_id);
CREATE INDEX IF NOT EXISTS idx_render_logs_status ON render_logs(status);
CREATE INDEX IF NOT EXISTS idx_render_logs_created ON render_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhooks_user ON webhooks(user_id);
CREATE INDEX IF NOT EXISTS idx_styles_created ON styles(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_styles_type ON styles(type);
CREATE INDEX IF NOT EXISTS idx_styles_user ON styles(user_id);
CREATE INDEX IF NOT EXISTS idx_components_created ON components(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_components_name ON components(name);
CREATE INDEX IF NOT EXISTS idx_components_user ON components(user_id);
CREATE INDEX IF NOT EXISTS idx_comments_template ON comments(template_id);
CREATE INDEX IF NOT EXISTS idx_comments_created ON comments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_template_versions_template ON template_versions(template_id);
CREATE INDEX IF NOT EXISTS idx_template_versions_number ON template_versions(template_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_variables_template ON variables(template_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE render_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE styles ENABLE ROW LEVEL SECURITY;
ALTER TABLE components ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE variables ENABLE ROW LEVEL SECURITY;

-- Service role: full access to everything
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY['templates','api_keys','render_logs','webhooks','styles','components','comments','template_versions','variables'])
  LOOP
    EXECUTE format('
      CREATE POLICY "Service role full access on %I" ON %I
        FOR ALL USING (auth.role() = ''service_role'');
    ', tbl, tbl);
  END LOOP;
END $$;

-- User ownership policies for tables with user_id
CREATE POLICY "Users can manage own api_keys" ON api_keys
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own templates" ON templates
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own webhooks" ON webhooks
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own styles" ON styles
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own components" ON components
  FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- STORAGE POLICIES (design-exports bucket)
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
-- AUTO-UPDATE updated_at TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY['templates','styles','components','comments','variables'])
  LOOP
    -- Drop existing trigger if it exists (idempotent)
    EXECUTE format('DROP TRIGGER IF EXISTS update_%I_updated_at ON %I', tbl, tbl);
    EXECUTE format('
      CREATE TRIGGER update_%I_updated_at
        BEFORE UPDATE ON %I
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    ', tbl, tbl);
  END LOOP;
END $$;
