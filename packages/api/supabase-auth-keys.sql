-- Auth + API Keys setup for Futuraria Design
-- Run in Supabase SQL Editor AFTER supabase-setup.sql

-- API Keys table
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Default Key',
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  permissions TEXT[] DEFAULT '{templates:read,templates:write,render,webhooks}',
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own API keys" ON api_keys
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Service role full access on api_keys" ON api_keys
  FOR ALL USING (auth.role() = 'service_role');

-- Add user_id to templates for ownership
ALTER TABLE templates ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- Update templates RLS
DROP POLICY IF EXISTS "Service role full access on templates" ON templates;
CREATE POLICY "Users can manage own templates" ON templates
  FOR ALL USING (auth.uid() = user_id OR auth.role() = 'service_role');

-- Add user_id to webhooks
ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

DROP POLICY IF EXISTS "Service role full access on webhooks" ON webhooks;
CREATE POLICY "Users can manage own webhooks" ON webhooks
  FOR ALL USING (auth.uid() = user_id OR auth.role() = 'service_role');
