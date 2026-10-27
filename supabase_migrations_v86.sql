-- supabase_migrations_v86.sql
-- REQ-063 — Voces IA + subtítulos: transcript del proyecto (words/cues/cuts).
--
-- Un transcript POR PROYECTO (id determinístico vidtrn_<projectId>, upsert
-- por id). Guarda:
--   words  — palabras de Scribe con timestamps absolutos del timeline
--   cues   — cues de subtítulos derivados (editable)
--   cuts   — regiones de corte de muletillas (estilo Descript; no destructivo:
--            el medio original nunca se toca, el remapeo vive en el export)
--   custom_words — lista custom de muletillas del usuario
--
-- Por qué tabla propia y no JSONB en musa_video_projects: el transcript es
-- opcional (la mayoría de proyectos no lo tiene), puede crecer a ~150 KB por
-- 10 min (words con timestamps) y conviene isolarlo del save frecuente del
-- doc. RLS espejo de musa_video_tracks (v73): vía project → workspace →
-- has_workspace_role.
--
-- Rollback: DROP TABLE musa_video_transcripts;
-- Idempotente: se puede re-ejecutar sin error.
-- ============================================================================

CREATE TABLE IF NOT EXISTS musa_video_transcripts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES musa_video_projects(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Palabras con timestamp (shared/elevenlabsMappers ScribeWord): [{text,startSec,endSec,kind}]
  words JSONB NOT NULL DEFAULT '[]',
  -- Cues de subtítulos (shared/srtVtt SubtitleCue): [{startSec,endSec,text}]
  cues JSONB NOT NULL DEFAULT '[]',
  -- Regiones de corte fundidas (shared/fillerWords TimeCut): [{startSec,endSec}]
  cuts JSONB NOT NULL DEFAULT '[]',
  -- Lista custom de muletillas del usuario (tokens o frases).
  custom_words JSONB NOT NULL DEFAULT '[]',
  engine TEXT NOT NULL DEFAULT 'elevenlabs_scribe',
  language_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT musa_video_transcripts_id_prefix CHECK (id LIKE 'vidtrn_%'),
  CONSTRAINT musa_video_transcripts_one_per_project UNIQUE (project_id)
);

CREATE INDEX IF NOT EXISTS idx_musa_video_transcripts_project
  ON musa_video_transcripts (project_id);

ALTER TABLE musa_video_transcripts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "viewer can read musa_video_transcripts" ON musa_video_transcripts;
CREATE POLICY "viewer can read musa_video_transcripts" ON musa_video_transcripts
  FOR SELECT TO authenticated
  USING (has_workspace_role(workspace_id, 'viewer'));

DROP POLICY IF EXISTS "editor can write musa_video_transcripts" ON musa_video_transcripts;
CREATE POLICY "editor can write musa_video_transcripts" ON musa_video_transcripts
  FOR INSERT TO authenticated
  WITH CHECK (has_workspace_role(workspace_id, 'editor'));

DROP POLICY IF EXISTS "editor can update musa_video_transcripts" ON musa_video_transcripts;
CREATE POLICY "editor can update musa_video_transcripts" ON musa_video_transcripts
  FOR UPDATE TO authenticated
  USING (has_workspace_role(workspace_id, 'editor'))
  WITH CHECK (has_workspace_role(workspace_id, 'editor'));

DROP POLICY IF EXISTS "editor can delete musa_video_transcripts" ON musa_video_transcripts;
CREATE POLICY "editor can delete musa_video_transcripts" ON musa_video_transcripts
  FOR DELETE TO authenticated
  USING (has_workspace_role(workspace_id, 'editor'));
