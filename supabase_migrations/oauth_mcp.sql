-- ═══════════════════════════════════════════════════════════════
-- oauth_mcp.sql — domain mirror of supabase_migrations_v31.sql
-- (OAuth 2.1 para MCP, REQ-012). The numbered root file is the
-- source of truth; this copy lives here so the schema of the OAuth
-- domain is browsable next to harness.sql / design_kanban.sql.
-- Apply via the Supabase SQL Editor like any numbered migration.
-- ═══════════════════════════════════════════════════════════════

-- 1. Dynamic client registry (RFC7591)
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id                    TEXT PRIMARY KEY,
  client_secret_hash           TEXT,
  client_name                  TEXT,
  redirect_uris                TEXT[] NOT NULL DEFAULT '{}',
  grant_types                  TEXT[] NOT NULL DEFAULT ARRAY['authorization_code','refresh_token'],
  token_endpoint_auth_method   TEXT NOT NULL DEFAULT 'none'
                               CHECK (token_endpoint_auth_method IN ('none', 'client_secret_post')),
  scope                        TEXT NOT NULL DEFAULT 'design.read design.write',
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Ephemeral authorization codes (hashed, single-use, 5-min TTL)
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash              TEXT PRIMARY KEY,
  client_id              TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id                UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  redirect_uri           TEXT NOT NULL,
  code_challenge         TEXT NOT NULL,
  code_challenge_method  TEXT NOT NULL DEFAULT 'S256',
  scope                  TEXT NOT NULL DEFAULT 'design.read design.write',
  access_token           TEXT,
  refresh_token          TEXT,
  token_expires_in       INTEGER NOT NULL DEFAULT 3600,
  approved               BOOLEAN NOT NULL DEFAULT false,
  used                   BOOLEAN NOT NULL DEFAULT false,
  expires_at             TIMESTAMPTZ NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oauth_codes_expires_idx ON oauth_codes (expires_at);
CREATE INDEX IF NOT EXISTS oauth_codes_user_idx    ON oauth_codes (user_id);

-- Service-role only: no anon/authenticated policies, ever.
ALTER TABLE oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_codes  ENABLE ROW LEVEL SECURITY;
