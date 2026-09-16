-- FUTURARIA v52 — social_inbox.workspace_id: UUID → TEXT.
--
-- BUG (detectado 16-sep-2026, logs del api local): v43 tipó workspace_id como
-- UUID, pero los ids reales de workspace son TEXT ("ws_user_...") — igual que
-- workspace_mcp_connections.workspace_id (TEXT, verificado en
-- information_schema). Resultado: CUALQUIER lectura/escritura de la Bandeja
-- fallaba con "invalid input syntax for type uuid".
--
-- Sin FK constraints sobre la columna (solo el índice, que ALTER TYPE
-- reconstruye solo), sin filas aún (todo fallaba), y el api usa service key
-- (bypasea RLS), así que el cambio es seguro e inmediato.
--
-- Safe to re-run (idempotente: si ya es text, no-op).

ALTER TABLE social_inbox
  ALTER COLUMN workspace_id TYPE text USING workspace_id::text;

COMMENT ON COLUMN social_inbox.workspace_id IS
  'workspace id (TEXT, formato ws_user_...) — igual convención que workspaces.id y workspace_mcp_connections.workspace_id.';
