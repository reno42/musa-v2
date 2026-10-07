-- v67 — F6 OAuth2 credentials (REQ-027 flows)
-- flow_credentials gana dos columnas para el tipo "oauth2" (apps OAuth2 propias
-- del usuario, modelo n8n self-hosted):
--   oauth_config : jsonb  — config NO secreta {clientId, authUrl, tokenUrl, scope}
--   oauth_tokens : text   — JSON cifrado AES-256-GCM {access_token, refresh_token,
--                           expires_at}; el secreto jamás sale del backend.
-- El client_secret vive en secret_crypted (columna existente, mismo cifrado).
-- Idempotente: seguro de re-ejecutar.

ALTER TABLE public.flow_credentials
  ADD COLUMN IF NOT EXISTS oauth_config jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.flow_credentials
  ADD COLUMN IF NOT EXISTS oauth_tokens text;

-- El CHECK de tipo existía solo en la DB live (no venía de ningún migration
-- del repo): se reemplaza para aceptar el nuevo tipo oauth2.
ALTER TABLE public.flow_credentials DROP CONSTRAINT IF EXISTS flow_credentials_type_check;

ALTER TABLE public.flow_credentials
  ADD CONSTRAINT flow_credentials_type_check
  CHECK (type = ANY (ARRAY['bearer'::text, 'api_key'::text, 'basic'::text, 'ai_provider'::text, 'oauth2'::text]));
