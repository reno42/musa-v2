-- supabase_migrations_v87.sql
-- REQ-074 — Storyboards: guion → escenas → visuales generados.
--
-- Un storyboard = un guion estructurado en escenas ordenadas. Cada escena
-- lleva narración (voz en off), visualPrompt (para el modelo de video/imagen),
-- copy (texto en pantalla), durationSec, job (estado del último submit) y
-- result (URL persistida del visual generado).
--
-- Por qué JSONB scenes y no tabla hija: las escenas se leen y escriben
-- SIEMPRE juntas (el editor pinta el storyboard completo), son ≤ ~40 por
-- storyboard y la forma evoluciona rápido (job/result hoy, references
-- mañana). Espeja el patrón de musa_video_transcripts (v86): tabla propia
-- porque es opcional y puede crecer, JSONB adentro porque es un documento.
--
-- RLS espejo de musa_video_transcripts (v86): vía workspace →
-- has_workspace_role. project_id es soft-reference (sin FK): un storyboard
-- puede existir sin proyecto de video y ganarse después.
--
-- Rollback: DROP TABLE musa_storyboards;
-- Idempotente: se puede re-ejecutar sin error.
-- ============================================================================

CREATE TABLE IF NOT EXISTS musa_storyboards (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Soft reference: puede preceder al proyecto de video.
  project_id TEXT,
  title TEXT NOT NULL,
  -- Guion completo original (para re-derivar escenas sin perder texto).
  script TEXT NOT NULL,
  -- Estilo visual global aplicado a todas las escenas.
  style TEXT NOT NULL DEFAULT '',
  -- [{n, label, narration, visualPrompt, copy, durationSec, job, result}]
  scenes JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT musa_storyboards_id_prefix CHECK (id LIKE 'sb_%'),
  CONSTRAINT musa_storyboards_scenes_array CHECK (jsonb_typeof(scenes) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_musa_storyboards_workspace
  ON musa_storyboards (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_musa_storyboards_project
  ON musa_storyboards (project_id) WHERE project_id IS NOT NULL;

ALTER TABLE musa_storyboards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "viewer can read musa_storyboards" ON musa_storyboards;
CREATE POLICY "viewer can read musa_storyboards" ON musa_storyboards
  FOR SELECT TO authenticated
  USING (has_workspace_role(workspace_id, 'viewer'));

DROP POLICY IF EXISTS "editor can write musa_storyboards" ON musa_storyboards;
CREATE POLICY "editor can write musa_storyboards" ON musa_storyboards
  FOR INSERT TO authenticated
  WITH CHECK (has_workspace_role(workspace_id, 'editor'));

DROP POLICY IF EXISTS "editor can update musa_storyboards" ON musa_storyboards;
CREATE POLICY "editor can update musa_storyboards" ON musa_storyboards
  FOR UPDATE TO authenticated
  USING (has_workspace_role(workspace_id, 'editor'))
  WITH CHECK (has_workspace_role(workspace_id, 'editor'));

DROP POLICY IF EXISTS "editor can delete musa_storyboards" ON musa_storyboards;
CREATE POLICY "editor can delete musa_storyboards" ON musa_storyboards
  FOR DELETE TO authenticated
  USING (has_workspace_role(workspace_id, 'editor'));

-- Service role (el worker MCP) pasa por encima de RLS con la service key:
-- los tools storyboard_create / storyboard_scene_generate usan
-- getSupabaseAdmin() como el resto de los módulos de video.
