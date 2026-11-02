-- Migración F3 (Hermes, carril datos REQ-070) — 2026-10-30
-- ADITIVA (REQ-069): solo tablas nuevas + 1 columna con default. Nada existente se modifica.
-- Aplicada vía postgres directo (db.qqqcmtwzyaejlzffivri.supabase.co:5432).
-- RLS replica el patrón de crm_deals: has_workspace_role(workspace_id,'viewer'|'editor').

CREATE TABLE workspace_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL,
  name text NOT NULL,
  date date,
  location text,
  attendees int DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE workspace_mailings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL,
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'borrador',
  send_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE workspace_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL,
  name text NOT NULL,
  published boolean NOT NULL DEFAULT false,
  response_count int NOT NULL DEFAULT 0,
  public_url text,
  schema jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE workspace_clones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'entrenando',
  model text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE workspace_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL,
  name text NOT NULL,
  lead_name text,
  member_count int NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE workspace_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL,
  piece_id text,
  piece_name text,
  brand_name text,
  requested_by text,
  status text NOT NULL DEFAULT 'pendiente',
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE workspace_agencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL,
  name text NOT NULL,
  plan text,
  brands text[],
  member_count int NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_wevents_ws ON workspace_events(workspace_id);
CREATE INDEX idx_wmail_ws ON workspace_mailings(workspace_id);
CREATE INDEX idx_wforms_ws ON workspace_forms(workspace_id);
CREATE INDEX idx_wclones_ws ON workspace_clones(workspace_id);
CREATE INDEX idx_wareas_ws ON workspace_areas(workspace_id);
CREATE INDEX idx_wapprovals_ws ON workspace_approvals(workspace_id);
CREATE INDEX idx_wagencies_ws ON workspace_agencies(workspace_id);

ALTER TABLE campaigns ADD COLUMN budget_plan_usd numeric NOT NULL DEFAULT 0;

-- RLS (aplicada por separado, patrón crm_deals):
-- ALTER TABLE <tabla> ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY <tabla>_workspace_read  ON <tabla> FOR SELECT USING (has_workspace_role(workspace_id,'viewer'));
-- CREATE POLICY <tabla>_workspace_write ON <tabla> FOR ALL    USING (has_workspace_role(workspace_id,'editor'))
--   WITH CHECK (has_workspace_role(workspace_id,'editor'));
