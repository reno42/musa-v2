-- ============================================================================
-- Migración v61 — Flows builder MCP-first (REQ-027)
--
-- flows: definición de cada flow del workspace (nodos/edges JSONB, trigger
--        INFORMATIVO — no hay scheduler server-side; los horarios los manejan
--        las IAs del usuario llamando flow_run).
-- flow_runs: historial de ejecuciones (steps por nodo, para que las IAs lean
--        el log y se autocorrijan — mismo dato que expone flow_history).
-- flow_credentials: credenciales por workspace para nodos http/ai (LLM y no
--        LLM), cifradas con el MISMO esquema AES-256-GCM de keys.mjs. El
--        secreto jamás sale por ninguna tool.
--
-- NOTA de tipos (mismo criterio que v59/v60): workspaces.id es TEXT en este
-- proyecto, así que workspace_id es TEXT con FK CASCADE. Los ids propios son
-- TEXT prefijados (flow_ / run_ / fcred_) — convención del proyecto.
--
-- Idempotente: se puede re-ejecutar sin error.
-- ============================================================================

-- ── flows ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flows (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  -- {type: manual|webhook|schedule, cron?, timezone?, secretHash? (webhook)}
  trigger JSONB,
  -- [{id, type, label, enabled, onError, config, position:{x,y}}]
  nodes JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- [{from, to, when? (true|false solo desde nodos condition)}]
  edges JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- 'user' | 'ai:<model>' — quién lo creó (atribución, sin FK)
  created_by TEXT NOT NULL DEFAULT 'user'
    CHECK (created_by = 'user' OR created_by LIKE 'ai:%'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT flows_id_prefix CHECK (id LIKE 'flow\_%'),
  CONSTRAINT flows_trigger_type CHECK (
    trigger IS NULL OR trigger->>'type' IN ('manual', 'webhook', 'schedule')
  )
);

CREATE INDEX IF NOT EXISTS idx_flows_workspace
  ON flows (workspace_id, updated_at DESC);

-- ── flow_runs ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flow_runs (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'failed')),
  input JSONB,
  -- [{nodeId, label, type, ok, ms, output (truncado ~4KB), error:{code,message}?}]
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  error TEXT,
  -- Idempotencia de webhooks/reintentos: mismo requestId → mismo run
  request_id TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  CONSTRAINT flow_runs_id_prefix CHECK (id LIKE 'run\_%')
);

CREATE INDEX IF NOT EXISTS idx_flow_runs_flow
  ON flow_runs (flow_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_flow_runs_workspace
  ON flow_runs (workspace_id, started_at DESC);
-- Cap de concurrencia por workspace: cuenta de runs vivos (parcial, barata).
CREATE INDEX IF NOT EXISTS idx_flow_runs_running
  ON flow_runs (workspace_id, started_at DESC) WHERE status = 'running';

-- ── flow_credentials ────────────────────────────────────────────────────────
-- Cualquier credencial que un nodo necesite: LLM (ai_provider) y no-LLM
-- (bearer / api_key / basic). Cifrada server-side; las tools list/devuelven
-- solo metadata (nombre, tipo, provider, last4).
CREATE TABLE IF NOT EXISTS flow_credentials (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  type TEXT NOT NULL CHECK (type IN ('bearer', 'api_key', 'basic', 'ai_provider')),
  provider TEXT,          -- ai_provider: gemini|deepseek|glm|openrouter
  model TEXT,             -- ai_provider: modelo por defecto (opcional)
  header_name TEXT,       -- api_key: header (p.ej. X-API-Key)
  username TEXT,          -- basic: usuario (la contraseña va en secret_crypted)
  secret_crypted TEXT NOT NULL,
  last4 TEXT,
  created_by TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT flow_credentials_id_prefix CHECK (id LIKE 'fcred\_%'),
  CONSTRAINT flow_credentials_ws_name_unique UNIQUE (workspace_id, name)
);

CREATE INDEX IF NOT EXISTS idx_flow_credentials_workspace
  ON flow_credentials (workspace_id, updated_at DESC);

-- ============================================================================
-- RLS: el visor lee, solo editor escribe (mismo patrón que v60
-- photo_compositions). El MCP usa service_role (bypass), esto protege el
-- acceso directo desde clientes con sesión.
-- ============================================================================

ALTER TABLE flows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "viewer can read flows" ON flows;
CREATE POLICY "viewer can read flows" ON flows
  FOR SELECT TO authenticated
  USING (has_workspace_role(workspace_id, 'viewer'));
DROP POLICY IF EXISTS "editor can write flows" ON flows;
CREATE POLICY "editor can write flows" ON flows
  FOR INSERT TO authenticated
  WITH CHECK (has_workspace_role(workspace_id, 'editor'));
DROP POLICY IF EXISTS "editor can update flows" ON flows;
CREATE POLICY "editor can update flows" ON flows
  FOR UPDATE TO authenticated
  USING (has_workspace_role(workspace_id, 'editor'))
  WITH CHECK (has_workspace_role(workspace_id, 'editor'));
DROP POLICY IF EXISTS "editor can delete flows" ON flows;
CREATE POLICY "editor can delete flows" ON flows
  FOR DELETE TO authenticated
  USING (has_workspace_role(workspace_id, 'editor'));

ALTER TABLE flow_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "viewer can read flow_runs" ON flow_runs;
CREATE POLICY "viewer can read flow_runs" ON flow_runs
  FOR SELECT TO authenticated
  USING (has_workspace_role(workspace_id, 'viewer'));
DROP POLICY IF EXISTS "editor can write flow_runs" ON flow_runs;
CREATE POLICY "editor can write flow_runs" ON flow_runs
  FOR INSERT TO authenticated
  WITH CHECK (has_workspace_role(workspace_id, 'editor'));
DROP POLICY IF EXISTS "editor can update flow_runs" ON flow_runs;
CREATE POLICY "editor can update flow_runs" ON flow_runs
  FOR UPDATE TO authenticated
  USING (has_workspace_role(workspace_id, 'editor'))
  WITH CHECK (has_workspace_role(workspace_id, 'editor'));
DROP POLICY IF EXISTS "editor can delete flow_runs" ON flow_runs;
CREATE POLICY "editor can delete flow_runs" ON flow_runs
  FOR DELETE TO authenticated
  USING (has_workspace_role(workspace_id, 'editor'));

ALTER TABLE flow_credentials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "editor can read flow_credentials" ON flow_credentials;
CREATE POLICY "editor can read flow_credentials" ON flow_credentials
  FOR SELECT TO authenticated
  USING (has_workspace_role(workspace_id, 'editor'));
DROP POLICY IF EXISTS "editor can write flow_credentials" ON flow_credentials;
CREATE POLICY "editor can write flow_credentials" ON flow_credentials
  FOR INSERT TO authenticated
  WITH CHECK (has_workspace_role(workspace_id, 'editor'));
DROP POLICY IF EXISTS "editor can update flow_credentials" ON flow_credentials;
CREATE POLICY "editor can update flow_credentials" ON flow_credentials
  FOR UPDATE TO authenticated
  USING (has_workspace_role(workspace_id, 'editor'))
  WITH CHECK (has_workspace_role(workspace_id, 'editor'));
DROP POLICY IF EXISTS "editor can delete flow_credentials" ON flow_credentials;
CREATE POLICY "editor can delete flow_credentials" ON flow_credentials
  FOR DELETE TO authenticated
  USING (has_workspace_role(workspace_id, 'editor'));
