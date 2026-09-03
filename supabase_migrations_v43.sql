-- FUTURARIA v43 — Zernio inbox: messages + comments, with reply and CRM
-- capture state. Safe to re-run. One row per provider item; the local status
-- column survives reloads so the Bandeja does not re-ask the provider who was
-- already answered or captured.

CREATE TABLE IF NOT EXISTS social_inbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  connection_id UUID,
  provider TEXT NOT NULL DEFAULT 'zernio',
  external_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'message',        -- message | comment
  platform TEXT,
  author_name TEXT,
  author_handle TEXT,
  author_email TEXT,
  content TEXT,
  occurred_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'nuevo',        -- nuevo | respondido | capturado
  reply_text TEXT,
  replied_at TIMESTAMPTZ,
  crm_contact_id UUID,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, external_id)
);

CREATE INDEX IF NOT EXISTS idx_social_inbox_workspace
  ON social_inbox(workspace_id, provider, status);

ALTER TABLE social_inbox ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE social_inbox IS
  'Zernio inbox mirror: messages/comments synced from the provider; reply and CRM-capture state lives here.';
