-- ═══════════════════════════════════════════════════════════════════════════════
-- FUTURARIA DESIGN — Consolidated Database Schema
-- Run ONCE in Supabase SQL Editor. Idempotent (safe to re-run).
--
-- MIGRATION ORDER (this file follows it automatically):
--   Phase 1: design_kanban.sql     — Design Kanban base (tasks, activity_log, cronjobs)
--   Phase 2: harness.sql           — Multi-agent harness (ALTERs kanban + harness tables + seed agents)
--   Phase 3: design_comments.sql   — Canvas comment pins (references kanban_tasks + templates)
--
-- PREREQUISITES: Supabase project with auth.users, workspaces, brands, templates tables.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ================================================================================
-- PHASE 1: DESIGN KANBAN
-- ================================================================================

-- ---------------------------------------------------------------------------
-- TABLE 1.1: design_kanban_tasks
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS design_kanban_tasks (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  brand_id      TEXT REFERENCES brands(id) ON DELETE SET NULL,
  workspace_id  TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  type          TEXT NOT NULL DEFAULT 'post'
                CHECK (type IN ('banner','post','deck','template','landing','factura','cotizacion','other')),
  format        TEXT,
  status        TEXT NOT NULL DEFAULT 'backlog'
                CHECK (status IN ('backlog','research','draft','design','review','feedback','done')),
  priority      INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
  deadline      DATE,
  brief         TEXT,
  copy_draft    TEXT,
  tone          TEXT,
  cta           TEXT,
  template_id   TEXT REFERENCES templates(id) ON DELETE SET NULL,
  frame_id      TEXT,
  render_url    TEXT,
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_to   TEXT DEFAULT 'default',
  cronjob_id    TEXT,
  tags          TEXT[] DEFAULT '{}'
);

-- ---------------------------------------------------------------------------
-- TABLE 1.2: design_kanban_activity_log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS design_kanban_activity_log (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES design_kanban_tasks(id) ON DELETE CASCADE,
  from_status   TEXT,
  to_status     TEXT NOT NULL,
  comment       TEXT,
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- TABLE 1.3: design_kanban_cronjobs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS design_kanban_cronjobs (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  schedule      TEXT NOT NULL,
  action        TEXT NOT NULL,
  enabled       BOOLEAN NOT NULL DEFAULT true,
  config        JSONB DEFAULT '{}',
  last_run_at   TIMESTAMPTZ,
  next_run_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- INDEXES (Phase 1)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_dkt_brand     ON design_kanban_tasks(brand_id);
CREATE INDEX IF NOT EXISTS idx_dkt_workspace ON design_kanban_tasks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_dkt_status    ON design_kanban_tasks(status);
CREATE INDEX IF NOT EXISTS idx_dkt_type      ON design_kanban_tasks(type);
CREATE INDEX IF NOT EXISTS idx_dkt_priority  ON design_kanban_tasks(priority, deadline);
CREATE INDEX IF NOT EXISTS idx_dkt_template  ON design_kanban_tasks(template_id);
CREATE INDEX IF NOT EXISTS idx_dkt_assigned  ON design_kanban_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_dkt_tags      ON design_kanban_tasks USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_dkt_created   ON design_kanban_tasks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dkal_task     ON design_kanban_activity_log(task_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- RLS (Phase 1 — basic)
-- ---------------------------------------------------------------------------
ALTER TABLE design_kanban_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_kanban_activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read kanban tasks" ON design_kanban_tasks;
CREATE POLICY "Anyone can read kanban tasks" ON design_kanban_tasks FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anyone can read activity log" ON design_kanban_activity_log;
CREATE POLICY "Anyone can read activity log" ON design_kanban_activity_log FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated can insert kanban tasks" ON design_kanban_tasks;
CREATE POLICY "Authenticated can insert kanban tasks" ON design_kanban_tasks FOR INSERT WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated can update kanban tasks" ON design_kanban_tasks;
CREATE POLICY "Authenticated can update kanban tasks" ON design_kanban_tasks FOR UPDATE USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated can insert activity log" ON design_kanban_activity_log;
CREATE POLICY "Authenticated can insert activity log" ON design_kanban_activity_log FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- TRIGGERS (Phase 1)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_dkt_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dkt_updated_at ON design_kanban_tasks;
CREATE TRIGGER trg_dkt_updated_at BEFORE UPDATE ON design_kanban_tasks FOR EACH ROW EXECUTE FUNCTION update_dkt_updated_at();

CREATE OR REPLACE FUNCTION log_kanban_status_change() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO design_kanban_activity_log (id, task_id, from_status, to_status, created_by)
    VALUES ('dkal_' || substr(md5(random()::text || clock_timestamp()::text), 1, 16), NEW.id, OLD.status, NEW.status, NEW.assigned_to);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dkt_status_change ON design_kanban_tasks;
CREATE TRIGGER trg_dkt_status_change AFTER UPDATE OF status ON design_kanban_tasks FOR EACH ROW EXECUTE FUNCTION log_kanban_status_change();

-- ---------------------------------------------------------------------------
-- REALTIME (Phase 1)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='design_kanban_tasks') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.design_kanban_tasks;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='design_kanban_activity_log') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.design_kanban_activity_log;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- VIEW: kanban_board
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW kanban_board AS
SELECT t.id, t.title, t.type, t.format, t.status, t.priority, t.deadline,
       t.brief, t.copy_draft, t.tone, t.cta, t.assigned_to, t.created_at, t.updated_at,
       w.name AS workspace_name, w.slug AS workspace_slug, b.name AS brand_name,
       tmpl.name AS template_name
FROM design_kanban_tasks t
LEFT JOIN workspaces w  ON w.id = t.workspace_id
LEFT JOIN brands b      ON b.id = t.brand_id
LEFT JOIN templates tmpl ON tmpl.id = t.template_id
ORDER BY t.priority ASC, t.deadline ASC NULLS LAST, t.created_at DESC;


-- ================================================================================
-- PHASE 2: MULTI-AGENT HARNESS
-- ================================================================================

-- ---------------------------------------------------------------------------
-- STEP 2.1: ALTER design_kanban_tasks — add account_id + harness columns
-- ---------------------------------------------------------------------------
ALTER TABLE design_kanban_tasks ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE design_kanban_tasks ADD COLUMN IF NOT EXISTS acceptance JSONB DEFAULT '[]'::jsonb;
ALTER TABLE design_kanban_tasks ADD COLUMN IF NOT EXISTS blocker_reason TEXT;
ALTER TABLE design_kanban_tasks ADD COLUMN IF NOT EXISTS checkpoint_json JSONB DEFAULT '{}'::jsonb;
ALTER TABLE design_kanban_tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

DO $$
DECLARE fallback_owner UUID;
BEGIN
  SELECT id INTO fallback_owner FROM auth.users ORDER BY created_at ASC LIMIT 1;
  IF fallback_owner IS NOT NULL THEN
    UPDATE design_kanban_tasks SET account_id = fallback_owner WHERE account_id IS NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dkt_account ON design_kanban_tasks(account_id);

-- ---------------------------------------------------------------------------
-- STEP 2.2: harness_agent_definitions
-- ---------------------------------------------------------------------------
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_had_default_name ON harness_agent_definitions(name) WHERE is_default=TRUE AND account_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_had_account ON harness_agent_definitions(account_id);

-- ---------------------------------------------------------------------------
-- STEP 2.3: harness_sessions
-- ---------------------------------------------------------------------------
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
CREATE INDEX IF NOT EXISTS idx_hs_active   ON harness_sessions(account_id, status) WHERE status='active';

-- ---------------------------------------------------------------------------
-- STEP 2.4: harness_entries (anti-context-degradation log)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS harness_entries (
  id              TEXT PRIMARY KEY,
  account_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id      TEXT REFERENCES harness_sessions(id) ON DELETE CASCADE,
  agent_name      TEXT NOT NULL,
  role            TEXT NOT NULL,
  entry_type      TEXT NOT NULL CHECK (entry_type IN ('plan','progress','blocker','review','verdict','summary','exploration','context_dump')),
  content         TEXT NOT NULL,
  files_touched   TEXT[] DEFAULT '{}',
  verdict         TEXT,
  prompt_used     TEXT,
  prompt_outcome  TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_he_session ON harness_entries(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_he_account ON harness_entries(account_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- STEP 2.5: harness_checkpoints
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- STEP 2.6: harness_cronjobs
-- ---------------------------------------------------------------------------
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
  encrypted_api_key TEXT,
  last_run_at     TIMESTAMPTZ,
  next_run_at     TIMESTAMPTZ,
  timezone        TEXT DEFAULT 'America/Lima',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hcr_account ON harness_cronjobs(account_id, enabled);

-- ---------------------------------------------------------------------------
-- STEP 2.7: RLS — multi-tenant isolation (replaces Phase 1 basic policies)
-- ---------------------------------------------------------------------------
ALTER TABLE harness_agent_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE harness_sessions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE harness_entries           ENABLE ROW LEVEL SECURITY;
ALTER TABLE harness_checkpoints       ENABLE ROW LEVEL SECURITY;
ALTER TABLE harness_cronjobs          ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_own_or_default_agent_defs" ON harness_agent_definitions;
CREATE POLICY "read_own_or_default_agent_defs" ON harness_agent_definitions FOR SELECT USING (account_id IS NULL OR account_id=auth.uid());

DROP POLICY IF EXISTS "manage_own_agent_defs" ON harness_agent_definitions;
CREATE POLICY "manage_own_agent_defs" ON harness_agent_definitions FOR ALL USING (account_id=auth.uid()) WITH CHECK (account_id=auth.uid());

DROP POLICY IF EXISTS "manage_own_sessions" ON harness_sessions;
CREATE POLICY "manage_own_sessions" ON harness_sessions FOR ALL USING (account_id=auth.uid()) WITH CHECK (account_id=auth.uid());

DROP POLICY IF EXISTS "manage_own_entries" ON harness_entries;
CREATE POLICY "manage_own_entries" ON harness_entries FOR ALL USING (account_id=auth.uid()) WITH CHECK (account_id=auth.uid());

DROP POLICY IF EXISTS "manage_own_checkpoints" ON harness_checkpoints;
CREATE POLICY "manage_own_checkpoints" ON harness_checkpoints FOR ALL USING (account_id=auth.uid()) WITH CHECK (account_id=auth.uid());

DROP POLICY IF EXISTS "manage_own_cronjobs" ON harness_cronjobs;
CREATE POLICY "manage_own_cronjobs" ON harness_cronjobs FOR ALL USING (account_id=auth.uid()) WITH CHECK (account_id=auth.uid());

-- Tighten kanban task policies to per-account
DROP POLICY IF EXISTS "Anyone can read kanban tasks" ON design_kanban_tasks;
DROP POLICY IF EXISTS "read_own_kanban_tasks" ON design_kanban_tasks;
CREATE POLICY "read_own_kanban_tasks" ON design_kanban_tasks FOR SELECT USING (account_id IS NULL OR account_id=auth.uid());

DROP POLICY IF EXISTS "Authenticated can insert kanban tasks" ON design_kanban_tasks;
DROP POLICY IF EXISTS "insert_own_kanban_tasks" ON design_kanban_tasks;
CREATE POLICY "insert_own_kanban_tasks" ON design_kanban_tasks FOR INSERT WITH CHECK (account_id IS NULL OR account_id=auth.uid());

DROP POLICY IF EXISTS "Authenticated can update kanban tasks" ON design_kanban_tasks;
DROP POLICY IF EXISTS "update_own_kanban_tasks" ON design_kanban_tasks;
CREATE POLICY "update_own_kanban_tasks" ON design_kanban_tasks FOR UPDATE USING (account_id IS NULL OR account_id=auth.uid());

-- ---------------------------------------------------------------------------
-- STEP 2.8: Seed default agent definitions (Leader, Implementer, Reviewer)
-- ---------------------------------------------------------------------------
INSERT INTO harness_agent_definitions (id, account_id, name, display_name, description, tools, labor, protocol, hard_rules, comm_rules, is_default)
VALUES
  ('agent_def_leader', NULL, 'leader', 'Leader',
   'Orquestador. Recibe la tarea principal, la descompone y lanza subagentes. NUNCA escribe codigo directamente.',
   ARRAY['Read','Glob','Grep','Bash','Agent','mcp:*'],
   'Descomponer y coordinar. Lanzar implementers y reviewers. Nunca implementar.',
   E'1. Lee AGENTS.md para orientarte.\n2. Lee harness_list_features({ status: "backlog" }) para ver tareas pendientes.\n3. Ejecuta harness_healthcheck(). Si falla, paras y reportas.',
   E'- No editas codigo directamente.\n- No marcas features como done.\n- No aceptas resultados sin referencia a entrada en harness_entries.',
   E'Tu respuesta final al humano es UNA linea:\n`done -> feature <id> completada (ver harness_entries)`\no\n`blocked -> ver sesion <sess_id>`',
   TRUE),
  ('agent_def_implementer', NULL, 'implementer', 'Implementer',
   'Trabajador. Implementa UNA feature del Kanban de principio a verificacion. Escribe codigo, escribe pruebas y se auto-verifica.',
   ARRAY['Read','Write','Edit','Glob','Grep','Bash','mcp:*'],
   'Ejecutar una sola feature. Escribir pruebas. Pedir revision al reviewer. Nunca autoaprobar.',
   E'1. Lee AGENTS.md, docs/architecture.md, docs/conventions.md via harness_get_context.\n2. harness_claim_feature({ taskId }) — si falla porque otra IA tomo la tarea, paras.\n3. harness_start_session({ taskId, role: "implementer" }) y anota plan.\n4. Implementa segun acceptance criteria.\n5. harness_healthcheck() para verificar.\n6. harness_submit_for_review({ sessionId }). NO marques done tu mismo.',
   E'- Una sola feature por sesion.\n- Toda escritura va acompanada de su verificacion.\n- Si una herramienta falla, NO improvises workaround. harness_log_entry({ type: "blocker" }) y termina.',
   E'Respuesta final UNA linea:\n`done -> feature <id> implementada (revision pendiente)`\no\n`blocked -> ver harness_entries de sesion <sess_id>`',
   TRUE),
  ('agent_def_reviewer', NULL, 'reviewer', 'Reviewer',
   'Revisor estricto. Aprueba o rechaza comparando contra acceptance criteria y CHECKPOINTS.md. No edita codigo.',
   ARRAY['Read','Glob','Grep','Bash','mcp:*'],
   'Aprobar o rechazar. Recorrer acceptance uno por uno. Ejecutar healthcheck. Marcar checkpoints. Nunca editar codigo.',
   E'1. Lee CHECKPOINTS.md via harness_get_context.\n2. harness_get_entries({ sessionId }) para ver que hizo el implementer.\n3. harness_healthcheck() — debe pasar.\n4. Por cada item de acceptance: harness_evaluate_checkpoint({ checkpointId, passed, notes }).\n5. Emitir veredicto: APPROVED o CHANGES_REQUESTED.',
   E'- Nunca apruebes con healthcheck rojo.\n- Nunca apruebes si quedan acceptance sin verificar.\n- Nunca edites el codigo del implementer.\n- Se concreto: cita archivos y lineas.',
   E'Respuesta final UNA linea:\n`APPROVED -> ver harness_entries de sesion <sess_id>`\no\n`CHANGES_REQUESTED -> ver harness_entries de sesion <sess_id>`',
   TRUE)
ON CONFLICT (id) DO UPDATE SET description=EXCLUDED.description, labor=EXCLUDED.labor, protocol=EXCLUDED.protocol, hard_rules=EXCLUDED.hard_rules, comm_rules=EXCLUDED.comm_rules, updated_at=NOW();

-- ---------------------------------------------------------------------------
-- STEP 2.9: Harness realtime
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='harness_sessions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.harness_sessions;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='harness_entries') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.harness_entries;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='harness_checkpoints') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.harness_checkpoints;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- STEP 2.10: Harness triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_harness_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_had_updated_at ON harness_agent_definitions;
CREATE TRIGGER trg_had_updated_at BEFORE UPDATE ON harness_agent_definitions FOR EACH ROW EXECUTE FUNCTION update_harness_updated_at();

DROP TRIGGER IF EXISTS trg_hcr_updated_at ON harness_cronjobs;
CREATE TRIGGER trg_hcr_updated_at BEFORE UPDATE ON harness_cronjobs FOR EACH ROW EXECUTE FUNCTION update_harness_updated_at();


-- ================================================================================
-- PHASE 3: DESIGN COMMENTS (Canvas Pins)
-- ================================================================================

-- ---------------------------------------------------------------------------
-- TABLE 3.1: design_comments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS design_comments (
  id            TEXT PRIMARY KEY DEFAULT ('comment_' || substr(md5(random()::text || clock_timestamp()::text), 1, 16)),
  template_id   TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  frame_id      TEXT,
  workspace_id  TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  account_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  x_pct         DOUBLE PRECISION DEFAULT 50,
  y_pct         DOUBLE PRECISION DEFAULT 50,
  body          TEXT NOT NULL,
  author_name   TEXT NOT NULL DEFAULT 'Anónimo',
  author_avatar TEXT,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'archived')),
  source        TEXT NOT NULL DEFAULT 'editor_pin' CHECK (source IN ('editor_pin', 'mobile_pin', 'kanban', 'ai_review', 'chat')),
  kanban_task_id TEXT REFERENCES design_kanban_tasks(id) ON DELETE SET NULL,
  parent_id     TEXT REFERENCES design_comments(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at   TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- INDEXES (Phase 3)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_dc_template  ON design_comments(template_id, frame_id);
CREATE INDEX IF NOT EXISTS idx_dc_workspace ON design_comments(workspace_id);
CREATE INDEX IF NOT EXISTS idx_dc_account   ON design_comments(account_id);
CREATE INDEX IF NOT EXISTS idx_dc_status    ON design_comments(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dc_source    ON design_comments(source);
CREATE INDEX IF NOT EXISTS idx_dc_parent    ON design_comments(parent_id);

-- ---------------------------------------------------------------------------
-- RLS (Phase 3)
-- ---------------------------------------------------------------------------
ALTER TABLE design_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read design_comments" ON design_comments;
CREATE POLICY "Authenticated can read design_comments" ON design_comments
  FOR SELECT USING (auth.role()='authenticated' OR account_id IS NULL OR account_id=auth.uid());

DROP POLICY IF EXISTS "Authenticated can insert design_comments" ON design_comments;
CREATE POLICY "Authenticated can insert design_comments" ON design_comments
  FOR INSERT WITH CHECK (auth.role()='authenticated');

DROP POLICY IF EXISTS "Authenticated can update design_comments" ON design_comments;
CREATE POLICY "Authenticated can update design_comments" ON design_comments
  FOR UPDATE USING (auth.role()='authenticated' AND (account_id IS NULL OR account_id=auth.uid()));

-- ---------------------------------------------------------------------------
-- TRIGGERS (Phase 3)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_dc_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dc_updated_at ON design_comments;
CREATE TRIGGER trg_dc_updated_at BEFORE UPDATE ON design_comments FOR EACH ROW EXECUTE FUNCTION update_dc_updated_at();

-- ---------------------------------------------------------------------------
-- REALTIME (Phase 3)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='design_comments') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.design_comments;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- DONE — All 3 phases applied.
-- Verify: SELECT * FROM design_kanban_tasks LIMIT 1;
--         SELECT * FROM harness_agent_definitions;
--         SELECT * FROM design_comments LIMIT 1;
-- ═══════════════════════════════════════════════════════════════════════════════
