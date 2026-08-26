-- ═══════════════════════════════════════════════════════════════
-- supabase_migrations_v31.sql — OAuth 2.1 para MCP (REQ-012)
-- (Futuraria Design, agosto 2026)
-- ═══════════════════════════════════════════════════════════════
--
-- WHAT: storage for the OAuth authorization-code + PKCE flow served
-- by the Netlify functions oauth-register / oauth-authorize /
-- oauth-token, so ChatGPT and Claude web can connect to
-- https://design.futuraria.com/mcp natively (MCP spec 2025-06-18,
-- Authorization: OAuth 2.1).
--
--   1. oauth_clients — RFC7591 dynamic-client-registration rows
--      (client_id, optional SHA-256 secret hash, redirect_uris).
--      Registration is open + rate-limited at the function; a junk
--      row is inert metadata.
--   2. oauth_codes — ephemeral authorization codes. The code column
--      is stored HASHED (sha256), never raw. Rows carry the user's
--      transient Supabase session tokens between consent and token
--      exchange (max 5 minutes, single use; the token endpoint
--      nulls+consumes the row and deletes expired ones on every
--      call). `approved` separates the pre-consent handle from the
--      post-consent code (see oauth-authorize.mjs).
--
-- NOTES:
--   * RLS enabled with NO policies: only the service role touches
--     these tables (functions use SUPABASE_SECRET_KEY) — same
--     pattern as user_provider_keys (v24) and nda_acceptances (v30).
--   * Issued tokens are USER tokens (Supabase Auth sessions), never
--     MCP_ADMIN_KEY. The scopes design.read/design.write are stored
--     and echoed but NOT enforced per-tool in v1: a user token
--     carries the same access that user has in the web app.
--   * v29 was consumed by a rolled-back migration (wider
--     harness_entries entry_type CHECK — applied to the DB, file no
--     longer in the repo; the wider constraint is inert). v30 was
--     the NDA gate. Hence OAuth = v31.
--
-- Idempotent: safe to re-run.
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
