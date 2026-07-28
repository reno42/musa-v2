-- ═══════════════════════════════════════════════════════════════
-- Futuraria Design Kanban — Database Schema
-- Tablero Kanban para producción de diseños por marca.
-- Sincronizado con workspaces, templates, y brands existentes.
-- Ejecutar en Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════

-- ============================================================
-- TABLE 1: design_kanban_tasks
-- Cada fila = una tarjeta del Kanban. Representa una pieza de
-- diseño que pasa por el flujo:
--   backlog → research → draft → design → review → done
--                ↑            ↓         ↓          ↓
--                └── [feedback] ←────────┘──────────┘
-- ============================================================
CREATE TABLE IF NOT EXISTS design_kanban_tasks (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  brand_id      TEXT REFERENCES brands(id) ON DELETE SET NULL,
  workspace_id  TEXT REFERENCES workspaces(id) ON DELETE SET NULL,

  -- Clasificación
  type          TEXT NOT NULL DEFAULT 'post'
                CHECK (type IN ('banner','post','deck','template','landing','factura','cotizacion','other')),
  format        TEXT,       -- ej: linkedin_post, instagram_story, 1200x627
  status        TEXT NOT NULL DEFAULT 'backlog'
                CHECK (status IN ('backlog','research','draft','design','review','feedback','done')),
  priority      INTEGER NOT NULL DEFAULT 2
                CHECK (priority BETWEEN 1 AND 3),  -- 1=urgente, 2=normal, 3=cuando haya tiempo
  deadline      DATE,

  -- Contenido editorial
  brief         TEXT,       -- descripción inicial de la idea
  copy_draft    TEXT,       -- copy redactado (se llena en fase research)
  tone          TEXT,       -- tono del contenido (profesional, casual, etc.)
  cta           TEXT,       -- call to action

  -- Vinculación con Design Tool
  template_id   TEXT REFERENCES templates(id) ON DELETE SET NULL,
  frame_id      TEXT,       -- ID del frame específico dentro del template
  render_url    TEXT,       -- URL del preview renderizado

  -- Metadata
  created_by    TEXT,       -- 'mira', 'ren', nombre del agente/hermes profile
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_to   TEXT DEFAULT 'default',  -- perfil de Hermes que lo trabaja
  cronjob_id    TEXT,       -- ID del cronjob si fue generado automáticamente
  tags          TEXT[] DEFAULT '{}'      -- tags libres para filtrado adicional
);

-- ============================================================
-- TABLE 2: design_kanban_activity_log
-- Bitácora de transiciones de estado para trazabilidad.
-- ============================================================
CREATE TABLE IF NOT EXISTS design_kanban_activity_log (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES design_kanban_tasks(id) ON DELETE CASCADE,
  from_status   TEXT,
  to_status     TEXT NOT NULL,
  comment       TEXT,       -- razón del cambio, feedback de revisión, etc.
  created_by    TEXT,       -- quién ejecutó la transición
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE 3: design_kanban_cronjobs
-- Registro de cronjobs que alimentan el Kanban automáticamente.
-- ============================================================
CREATE TABLE IF NOT EXISTS design_kanban_cronjobs (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,           -- ej: 'Content Researcher', 'Design Producer'
  schedule      TEXT NOT NULL,           -- ej: '0 6 * * *' (cron expression)
  action        TEXT NOT NULL,           -- 'research', 'design', 'sync'
  enabled       BOOLEAN NOT NULL DEFAULT true,
  config        JSONB DEFAULT '{}',       -- parámetros extra (marca filtro, etc.)
  last_run_at   TIMESTAMPTZ,
  next_run_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
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

-- ============================================================
-- TRIGGER: auto-update updated_at on design_kanban_tasks
-- ============================================================
CREATE OR REPLACE FUNCTION update_dkt_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dkt_updated_at ON design_kanban_tasks;
CREATE TRIGGER trg_dkt_updated_at
  BEFORE UPDATE ON design_kanban_tasks
  FOR EACH ROW EXECUTE FUNCTION update_dkt_updated_at();

-- ============================================================
-- TRIGGER: log status transitions automatically
-- Cada vez que cambia el status de una tarjeta, se registra
-- en design_kanban_activity_log.
-- ============================================================
CREATE OR REPLACE FUNCTION log_kanban_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO design_kanban_activity_log (id, task_id, from_status, to_status, created_by)
    VALUES (
      'dkal_' || substr(md5(random()::text || clock_timestamp()::text), 1, 16),
      NEW.id,
      OLD.status,
      NEW.status,
      NEW.assigned_to
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dkt_status_change ON design_kanban_tasks;
CREATE TRIGGER trg_dkt_status_change
  AFTER UPDATE OF status ON design_kanban_tasks
  FOR EACH ROW EXECUTE FUNCTION log_kanban_status_change();

-- ============================================================
-- REALTIME: Habilitar en tablas Kanban para UI en vivo
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'design_kanban_tasks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.design_kanban_tasks;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'design_kanban_activity_log'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.design_kanban_activity_log;
  END IF;
END $$;

-- ============================================================
-- VIEW: kanban_board — Vista lista para el UI Kanban
-- Agrupa tarjetas por status con joins a workspace/brand/template
-- ============================================================
CREATE OR REPLACE VIEW kanban_board AS
SELECT
  t.id,
  t.title,
  t.type,
  t.format,
  t.status,
  t.priority,
  t.deadline,
  t.brief,
  t.copy_draft,
  t.tone,
  t.cta,
  t.assigned_to,
  t.created_at,
  t.updated_at,
  w.name  AS workspace_name,
  w.slug  AS workspace_slug,
  b.name  AS brand_name,
  tmpl.name AS template_name
FROM design_kanban_tasks t
LEFT JOIN workspaces w  ON w.id = t.workspace_id
LEFT JOIN brands b      ON b.id = t.brand_id
LEFT JOIN templates tmpl ON tmpl.id = t.template_id
ORDER BY t.priority ASC, t.deadline ASC NULLS LAST, t.created_at DESC;
