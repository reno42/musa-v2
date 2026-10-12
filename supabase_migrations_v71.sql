-- v71 · REQ-047 "Conecta tu IA" — scopes de tokens de agente + auditoría mínima
-- 1) workspace_api_keys.scopes: token de agente con alcance limitado
--    (p.ej. ["flows:read","flows:resume","assets:write"]). NULL/vacío =
--    sin restricción (tokens heredados: compatibilidad total). El MCP
--    degrada con gracia si esta columna aún no existe.
-- 2) mcp_token_calls: auditoría mínima de la bandeja IA (flow_ai_tasks /
--    flow_ai_complete / flow_resume) para "tu agente atendió N tareas este
--    mes". Retención 30 días — el MCP poda con muestreo 1% por inserción.

ALTER TABLE workspace_api_keys ADD COLUMN IF NOT EXISTS scopes text[];

CREATE TABLE IF NOT EXISTS mcp_token_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id uuid,
  workspace_id text,
  method text NOT NULL,
  status int,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mcp_token_calls_key_created
  ON mcp_token_calls (key_id, created_at DESC);

-- RLS sin políticas: solo el server (service role, que bypasea RLS) lee y
-- escribe esta tabla; los clientes anon/authenticated no ven nada.
ALTER TABLE mcp_token_calls ENABLE ROW LEVEL SECURITY;
