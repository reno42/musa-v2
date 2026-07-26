CREATE TABLE IF NOT EXISTS webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  events TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true,
  secret TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;

-- Allow all for service role
CREATE POLICY "Allow all for service role" ON webhooks FOR ALL USING (true);

-- Insert some default events
INSERT INTO webhooks (name, url, events, active) VALUES
  ('Lead Created', '', ARRAY['lead.created'], false),
  ('Lead Updated', '', ARRAY['lead.updated'], false);

-- Also allow anon role (for client-side UI)
CREATE POLICY "Allow all for anon" ON webhooks FOR ALL TO anon USING (true);
