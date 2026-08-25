-- ═══════════════════════════════════════════════════════════════
-- FUTURARIA HARNESS — Multi-agent orchestration schema
-- Cloud-native, multi-tenant, fully on Supabase.
-- Depends on: design_kanban.sql (design_kanban_tasks), auth.users
-- Run in Supabase SQL Editor (idempotent).
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- STEP 1: Add account_id (auth.users.id) to design_kanban_tasks
-- Makes the Kanban multi-tenant. Existing rows backfilled to NULL
-- and then assigned to the first admin user (best-effort).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE design_kanban_tasks
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE design_kanban_tasks
  ADD COLUMN IF NOT EXISTS acceptance JSONB DEFAULT '[]'::jsonb;

ALTER TABLE design_kanban_tasks
  ADD COLUMN IF NOT EXISTS blocker_reason TEXT;

ALTER TABLE design_kanban_tasks
  ADD COLUMN IF NOT EXISTS checkpoint_json JSONB DEFAULT '{}'::jsonb;

ALTER TABLE design_kanban_tasks
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Backfill existing rows: assign to oldest auth user (best-effort)
DO $$
DECLARE
  fallback_owner UUID;
BEGIN
  SELECT id INTO fallback_owner FROM auth.users ORDER BY created_at ASC LIMIT 1;
  IF fallback_owner IS NOT NULL THEN
    UPDATE design_kanban_tasks
      SET account_id = fallback_owner
      WHERE account_id IS NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dkt_account ON design_kanban_tasks(account_id);

-- ─────────────────────────────────────────────────────────────
-- STEP 2: harness_agent_definitions
-- Replaces .claude/agents/*.md. One row per agent role.
-- Pre-seeded with leader, implementer, reviewer (is_default=true).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS harness_agent_definitions (
  id              TEXT PRIMARY KEY,
  account_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  display_name    TEXT,
  description     TEXT NOT NULL,
  tools           TEXT[] DEFAULT '{}',
  labor           TEXT NOT NULL,
  protocol        TEXT NOT NULL,
  hard_rules      TEXT NOT NULL,
  comm_rules      TEXT NOT NULL,
  is_default      BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Default roles are global (account_id IS NULL). Per-account overrides have account_id set.
CREATE UNIQUE INDEX IF NOT EXISTS idx_had_default_name
  ON harness_agent_definitions(name) WHERE is_default = TRUE AND account_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_had_account ON harness_agent_definitions(account_id);

-- ─────────────────────────────────────────────────────────────
-- STEP 3: harness_sessions
-- Replaces progress/current.md. Active session per agent + task.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS harness_sessions (
  id              TEXT PRIMARY KEY,
  account_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id         TEXT REFERENCES design_kanban_tasks(id) ON DELETE CASCADE,
  agent_name      TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('leader','implementer','reviewer','explorer','custom')),
  status          TEXT DEFAULT 'active' CHECK (status IN ('active','paused','completed','blocked')),
  plan            TEXT,
  context_summary TEXT,
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  ended_at        TIMESTAMPTZ,
  next_step       TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hs_account  ON harness_sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_hs_task     ON harness_sessions(task_id);
CREATE INDEX IF NOT EXISTS idx_hs_active   ON harness_sessions(account_id, status) WHERE status = 'active';

-- ─────────────────────────────────────────────────────────────
-- STEP 4: harness_entries
-- Replaces progress/*.md and progress/history.md. Append-only bitácora.
-- This is the anti-context-degradation table: every agent writes here,
-- no content circulates through chat.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS harness_entries (
  id              TEXT PRIMARY KEY,
  account_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id      TEXT REFERENCES harness_sessions(id) ON DELETE CASCADE,
  agent_name      TEXT NOT NULL,
  role            TEXT NOT NULL,
  entry_type      TEXT NOT NULL CHECK (entry_type IN
                    ('plan','progress','blocker','review','verdict','summary','exploration','context_dump')),
  content         TEXT NOT NULL,
  files_touched   TEXT[] DEFAULT '{}',
  verdict         TEXT,
  prompt_used     TEXT,
  prompt_outcome  TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_he_session ON harness_entries(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_he_account ON harness_entries(account_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────
-- STEP 5: harness_checkpoints
-- Replaces CHECKPOINTS.md. Objective pass/fail criteria per task.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS harness_checkpoints (
  id              TEXT PRIMARY KEY,
  account_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id         TEXT REFERENCES design_kanban_tasks(id) ON DELETE CASCADE,
  checkpoint_id   TEXT NOT NULL,
  description     TEXT NOT NULL,
  passed          BOOLEAN DEFAULT FALSE,
  reviewer_agent  TEXT,
  reviewed_at     TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hc_task ON harness_checkpoints(task_id);

-- ─────────────────────────────────────────────────────────────
-- STEP 6: harness_cronjobs
-- Scheduled automatic task creation + execution.
-- Each row is a pg_cron entry that fires an Edge Function.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS harness_cronjobs (
  id              TEXT PRIMARY KEY,
  account_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  schedule        TEXT NOT NULL,
  action          TEXT NOT NULL DEFAULT 'create_task',
  agent_definition_id TEXT,
  task_template   JSONB DEFAULT '{}'::jsonb,
  feature_type    TEXT DEFAULT 'post',
  workspace_id    TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  brand_id        TEXT REFERENCES brands(id) ON DELETE SET NULL,
  enabled         BOOLEAN DEFAULT TRUE,
  encrypted_api_key TEXT,                  -- account fdr_ws_ key for the cron runner
  last_run_at     TIMESTAMPTZ,
  next_run_at     TIMESTAMPTZ,
  timezone        TEXT DEFAULT 'America/Lima',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hcr_account ON harness_cronjobs(account_id, enabled);

-- ─────────────────────────────────────────────────────────────
-- STEP 7: RLS — multi-tenant isolation
-- ─────────────────────────────────────────────────────────────
ALTER TABLE harness_agent_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE harness_sessions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE harness_entries           ENABLE ROW LEVEL SECURITY;
ALTER TABLE harness_checkpoints       ENABLE ROW LEVEL SECURITY;
ALTER TABLE harness_cronjobs          ENABLE ROW LEVEL SECURITY;

-- harness_agent_definitions: own account OR global defaults (account_id IS NULL)
DROP POLICY IF EXISTS "read_own_or_default_agent_defs" ON harness_agent_definitions;
CREATE POLICY "read_own_or_default_agent_defs" ON harness_agent_definitions
  FOR SELECT USING (account_id IS NULL OR account_id = auth.uid());

DROP POLICY IF EXISTS "manage_own_agent_defs" ON harness_agent_definitions;
CREATE POLICY "manage_own_agent_defs" ON harness_agent_definitions
  FOR ALL USING (account_id = auth.uid()) WITH CHECK (account_id = auth.uid());

-- harness_sessions
DROP POLICY IF EXISTS "manage_own_sessions" ON harness_sessions;
CREATE POLICY "manage_own_sessions" ON harness_sessions
  FOR ALL USING (account_id = auth.uid()) WITH CHECK (account_id = auth.uid());

-- harness_entries
DROP POLICY IF EXISTS "manage_own_entries" ON harness_entries;
CREATE POLICY "manage_own_entries" ON harness_entries
  FOR ALL USING (account_id = auth.uid()) WITH CHECK (account_id = auth.uid());

-- harness_checkpoints
DROP POLICY IF EXISTS "manage_own_checkpoints" ON harness_checkpoints;
CREATE POLICY "manage_own_checkpoints" ON harness_checkpoints
  FOR ALL USING (account_id = auth.uid()) WITH CHECK (account_id = auth.uid());

-- harness_cronjobs
DROP POLICY IF EXISTS "manage_own_cronjobs" ON harness_cronjobs;
CREATE POLICY "manage_own_cronjobs" ON harness_cronjobs
  FOR ALL USING (account_id = auth.uid()) WITH CHECK (account_id = auth.uid());

-- Tighten design_kanban_tasks to per-account (preserve service_role bypass)
DROP POLICY IF EXISTS "Anyone can read kanban tasks" ON design_kanban_tasks;
DROP POLICY IF EXISTS "read_own_kanban_tasks" ON design_kanban_tasks;
CREATE POLICY "read_own_kanban_tasks" ON design_kanban_tasks
  FOR SELECT USING (account_id IS NULL OR account_id = auth.uid());

DROP POLICY IF EXISTS "Authenticated can insert kanban tasks" ON design_kanban_tasks;
DROP POLICY IF EXISTS "insert_own_kanban_tasks" ON design_kanban_tasks;
CREATE POLICY "insert_own_kanban_tasks" ON design_kanban_tasks
  FOR INSERT WITH CHECK (account_id IS NULL OR account_id = auth.uid());

DROP POLICY IF EXISTS "Authenticated can update kanban tasks" ON design_kanban_tasks;
DROP POLICY IF EXISTS "update_own_kanban_tasks" ON design_kanban_tasks;
CREATE POLICY "update_own_kanban_tasks" ON design_kanban_tasks
  FOR UPDATE USING (account_id IS NULL OR account_id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- STEP 8: Seed default agent definitions (3 base roles)
-- Global (account_id NULL). Per-account overrides allowed.
-- ─────────────────────────────────────────────────────────────
INSERT INTO harness_agent_definitions
  (id, account_id, name, display_name, description, tools, labor, protocol, hard_rules, comm_rules, is_default)
VALUES
  (
    'agent_def_leader',
    NULL,
    'leader',
    'Leader',
    'Orquestador. Recibe la tarea principal, la descompone y lanza subagentes. NUNCA escribe codigo directamente.',
    ARRAY['Read','Glob','Grep','Bash','Agent','mcp:*'],
    'Descomponer y coordinar. Lanzar implementers y reviewers. Nunca implementar.',
    E'1. Lee AGENTS.md para orientarte.\n2. Lee harness_list_features({ status: "backlog" }) para ver tareas pendientes.\n3. Ejecuta harness_healthcheck(). Si falla, paras y reportas.',
    E'- No editas codigo directamente.\n- No marcas features como done.\n- No aceptas resultados sin referencia a entrada en harness_entries.',
    E'Tu respuesta final al humano es UNA linea:\n`done -> feature <id> completada (ver harness_entries)`\no\n`blocked -> ver sesion <sess_id>`',
    TRUE
  ),
  (
    'agent_def_implementer',
    NULL,
    'implementer',
    'Implementer',
    'Trabajador. Implementa UNA feature del Kanban de principio a verificacion. Escribe codigo, escribe pruebas y se auto-verifica.',
    ARRAY['Read','Write','Edit','Glob','Grep','Bash','mcp:*'],
    'Ejecutar una sola feature. Escribir pruebas. Pedir revision al reviewer. Nunca autoaprobar.',
    E'1. Lee AGENTS.md, docs/architecture.md, docs/conventions.md via harness_get_context.\n2. harness_claim_feature({ taskId }) — si falla porque otra IA tomo la tarea, paras.\n3. harness_start_session({ taskId, role: "implementer" }) y anota plan.\n4. Implementa segun acceptance criteria.\n5. harness_healthcheck() para verificar.\n6. harness_submit_for_review({ sessionId }). NO marques done tu mismo.',
    E'- Una sola feature por sesion.\n- Toda escritura va acompanada de su verificacion.\n- Si una herramienta falla, NO improvises workaround. harness_log_entry({ type: "blocker" }) y termina.',
    E'Respuesta final UNA linea:\n`done -> feature <id> implementada (revision pendiente)`\no\n`blocked -> ver harness_entries de sesion <sess_id>`',
    TRUE
  ),
  (
    'agent_def_reviewer',
    NULL,
    'reviewer',
    'Reviewer',
    'Revisor estricto. Aprueba o rechaza comparando contra acceptance criteria y CHECKPOINTS.md. No edita codigo.',
    ARRAY['Read','Glob','Grep','Bash','mcp:*'],
    'Aprobar o rechazar. Recorrer acceptance uno por uno. Ejecutar healthcheck. Marcar checkpoints. Nunca editar codigo.',
    E'1. Lee CHECKPOINTS.md via harness_get_context.\n2. harness_get_entries({ sessionId }) para ver que hizo el implementer.\n3. harness_healthcheck() — debe pasar.\n4. Por cada item de acceptance: harness_evaluate_checkpoint({ checkpointId, passed, notes }).\n5. Emitir veredicto: APPROVED o CHANGES_REQUESTED.',
    E'- Nunca apruebes con healthcheck rojo.\n- Nunca apruebes si quedan acceptance sin verificar.\n- Nunca edites el codigo del implementer.\n- Se concreto: cita archivos y lineas.',
    E'Respuesta final UNA linea:\n`APPROVED -> ver harness_entries de sesion <sess_id>`\no\n`CHANGES_REQUESTED -> ver harness_entries de sesion <sess_id>`',
    TRUE
  )
ON CONFLICT (id) DO UPDATE SET
  description    = EXCLUDED.description,
  labor          = EXCLUDED.labor,
  protocol       = EXCLUDED.protocol,
  hard_rules     = EXCLUDED.hard_rules,
  comm_rules     = EXCLUDED.comm_rules,
  updated_at     = NOW();

-- ─────────────────────────────────────────────────────────────
-- STEP 9: Realtime — broadcast harness changes to UI
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'harness_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.harness_sessions;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'harness_entries'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.harness_entries;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'harness_checkpoints'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.harness_checkpoints;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- STEP 10: Trigger — auto-update updated_at
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_harness_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_had_updated_at ON harness_agent_definitions;
CREATE TRIGGER trg_had_updated_at
  BEFORE UPDATE ON harness_agent_definitions
  FOR EACH ROW EXECUTE FUNCTION update_harness_updated_at();

DROP TRIGGER IF EXISTS trg_hcr_updated_at ON harness_cronjobs;
CREATE TRIGGER trg_hcr_updated_at
  BEFORE UPDATE ON harness_cronjobs
  FOR EACH ROW EXECUTE FUNCTION update_harness_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- END — Futuraria Harness schema ready.
-- ═══════════════════════════════════════════════════════════════
