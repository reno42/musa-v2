-- ============================================================================
-- Migración v74 — Flows v2 (REQ-FLW1..8, aditiva sobre REQ-027)
--
-- 1) flow_versions: historial de versiones por flow (FLW1). CADA save
--    archiva UNA versión (create = v1); se conservan las últimas 20 por flow
--    (el prune lo hace el server, nunca un DELETE manual). El rollback carga
--    la versión elegida, la revalida con el validador de HOY y la guarda como
--    versión NUEVA — el historial jamás se reescribe.
-- 2) flows.pins: salidas congeladas de nodos para depurar (FLW3). Solo
--    borradores: el server rechaza enabled:true con pins. jsonb con default —
--    los flows existentes no cambian de forma.
-- 3) Fix relajante del CHECK flows_trigger_type (bug latente de v61): la
--    v61 solo admitía ('manual','webhook','schedule'), así que guardar un
--    flow con trigger {type:"error"} (plan B4, error workflow) violaba la
--    constraint. Se suelta y se recrea agregando 'error' — SOLO relaja, no
--    rompe nada existente.
--
-- NOTA de tipos (mismo criterio que v61..v73): workspaces.id es TEXT en este
-- proyecto, así que workspace_id es TEXT con FK CASCADE. Los ids propios son
-- TEXT prefijados (flow_ / run_ / fcred_).
--
-- Idempotente: se puede re-ejecutar sin error.
-- ============================================================================

-- ── flow_versions (FLW1) ────────────────────────────────────────────────────
-- PK compuesta (flow_id, version): version es 1..N POR flow, sin ids sueltos.
-- definition = snapshot EXACTO del contrato editable (name, enabled, trigger,
-- nodes, edges, tags, vars, inputs) via versionDefinition(flow) en
-- flows-core.mjs. La columna flows.versions (v63, snapshots en fila) queda
-- EXACTAMENTE igual: no se toca.
CREATE TABLE IF NOT EXISTS flow_versions (
  flow_id TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Snapshot del contrato editable del flow en el momento del save
  definition JSONB NOT NULL,
  -- 'user' | 'ai:<model>' — misma atribución que flows.created_by
  created_by TEXT NOT NULL DEFAULT 'user'
    CHECK (created_by = 'user' OR created_by LIKE 'ai:%'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (flow_id, version)
);

-- Lectura del historial más nuevo primero (flow_versions_list) y lookup por
-- versión exacta (flow_rollback) comparten este índice.
CREATE INDEX IF NOT EXISTS idx_flow_versions_flow
  ON flow_versions (flow_id, version DESC);

-- ── flows.pins (FLW3) ───────────────────────────────────────────────────────
-- {nodeId: <salida congelada>} — caps en el server (10KB/pin, 40KB/flow).
-- NUNCA se ejecuta en producción: solo flow_run con mode:"dev".
ALTER TABLE flows ADD COLUMN IF NOT EXISTS pins JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ── Fix relajante: flows_trigger_type admite 'error' (bug latente v61) ─────
ALTER TABLE flows DROP CONSTRAINT IF EXISTS flows_trigger_type;
ALTER TABLE flows ADD CONSTRAINT flows_trigger_type CHECK (
  trigger IS NULL OR trigger->>'type' IN ('manual', 'webhook', 'schedule', 'error')
);

-- ============================================================================
-- RLS flow_versions: mismo patrón viewer/editor que flows (v61). El MCP usa
-- service_role (bypass); esto protege el acceso directo desde clientes con
-- sesión. Escritura: solo editor (la tool inserta via service_role igual).
-- ============================================================================
ALTER TABLE flow_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "viewer can read flow_versions" ON flow_versions;
CREATE POLICY "viewer can read flow_versions" ON flow_versions
  FOR SELECT TO authenticated
  USING (has_workspace_role(workspace_id, 'viewer'));
DROP POLICY IF EXISTS "editor can write flow_versions" ON flow_versions;
CREATE POLICY "editor can write flow_versions" ON flow_versions
  FOR INSERT TO authenticated
  WITH CHECK (has_workspace_role(workspace_id, 'editor'));
DROP POLICY IF EXISTS "editor can update flow_versions" ON flow_versions;
CREATE POLICY "editor can update flow_versions" ON flow_versions
  FOR UPDATE TO authenticated
  USING (has_workspace_role(workspace_id, 'editor'))
  WITH CHECK (has_workspace_role(workspace_id, 'editor'));
DROP POLICY IF EXISTS "editor can delete flow_versions" ON flow_versions;
CREATE POLICY "editor can delete flow_versions" ON flow_versions
  FOR DELETE TO authenticated
  USING (has_workspace_role(workspace_id, 'editor'));
