-- ═══════════════════════════════════════════════════════════════════
-- v56 — Ghost jobs + presence: el canal MCP → pestaña del ghost (FASE 2)
-- ═══════════════════════════════════════════════════════════════════
-- ghost_perform (Parte 6 de REPORTE_MIRA_fase2_ghost.md) necesita dos
-- cosas que una función Netlify síncrona no puede hacer sola:
--
--   1. Saber si el usuario tiene una pestaña de la app abierta AHORA
--      → ghost_presence: heartbeat que el bridge en la pestaña refresca
--        (mount + cada 15s). El MCP lo considera fresco si <30s.
--   2. Entregarle un trabajo a esa pestaña sin sostener la conexión
--      → ghost_jobs: el MCP inserta queued; el bridge lo reclama
--        (queued→running), corre la tarea con el gate + teatro del
--        ghost y escribe done/aborted/failed con result y link.
--
-- Los logs de pasos viven en chatfab_decisions (session_id ghost_*):
-- estas tablas solo mueven el trabajo, no lo narran.
--
-- RLS: cada usuario ve y gestiona SOLO sus filas (user_id =
-- auth.uid()). El MCP usa service key, que hace bypass de RLS.
-- Idempotente: seguro de re-correr (IF NOT EXISTS / DROP POLICY IF EXISTS).
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ghost_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id TEXT,
  task TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'teacher' CHECK (mode IN ('teacher', 'full')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'aborted', 'failed')),
  result JSONB,
  link TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ghost_jobs_user_status_idx ON ghost_jobs (user_id, status);

CREATE TABLE IF NOT EXISTS ghost_presence (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  page TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ghost_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ghost_presence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ghost_jobs_owner_all" ON ghost_jobs;
CREATE POLICY "ghost_jobs_owner_all" ON ghost_jobs
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "ghost_presence_owner_all" ON ghost_presence;
CREATE POLICY "ghost_presence_owner_all" ON ghost_presence
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- El bridge se suscribe con postgres_changes: la tabla debe estar en la
-- publicación de Realtime. Idempotente a mano (no existe ADD IF NOT EXISTS).
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE ghost_jobs;
  EXCEPTION WHEN duplicate_object THEN NULL; -- ya era miembro
  END;
END $$;

COMMENT ON TABLE ghost_jobs IS 'FASE 2: trabajos del cursor fantasma. MCP inserta queued; el bridge de la pestaña abierta los reclama y ejecuta con teatro (REPORTE_MIRA_fase2_ghost.md Parte 6).';
COMMENT ON TABLE ghost_presence IS 'FASE 2: heartbeat del bridge en la pestaña. El MCP considera presencia fresca si updated_at < 30s.';
