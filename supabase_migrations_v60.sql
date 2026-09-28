-- ============================================================================
-- Migración v60 — photo_compositions (REQ-PHOTO-FASE4: Modo Composición)
--
-- Una fila por (workspace_id, source_url): el documento de composición guarda
-- el stack de capas raster (photoComposition.CompositionLayer[]) en layers_json.
-- El contenido de cada capa viaja como dataUrl PNG dentro del JSON — el pincel
-- es 100% client-side, el API solo persiste instrucciones (mismo contrato que
-- photo_versions con recetas).
--
-- NOTA de tipos (mismo criterio que v59): workspaces.id es TEXT en este
-- proyecto, así que workspace_id es TEXT con FK CASCADE. created_by sigue
-- siendo UUID (auth.users.id SÍ es uuid).
--
-- Idempotente: se puede re-ejecutar sin error.
-- ============================================================================

CREATE TABLE IF NOT EXISTS photo_compositions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  schema_version INT NOT NULL DEFAULT 1,
  layers_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Una composición por foto fuente dentro del workspace (idéntico al
  -- contrato de photo_documents).
  CONSTRAINT photo_compositions_ws_source_unique UNIQUE (workspace_id, source_url)
);

-- Ids prefijados coherentes con el resto del proyecto (p.ej. cmp_xxxxxxxx).
-- Guard idempotente: ADD CONSTRAINT plano fallaría al re-ejecutar.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'photo_compositions_id_prefix'
  ) THEN
    ALTER TABLE photo_compositions
      ADD CONSTRAINT photo_compositions_id_prefix CHECK (id LIKE 'cmp\_%');
  END IF;
END $$;

-- Índice de listado por workspace (mirror de photo_documents).
CREATE INDEX IF NOT EXISTS idx_photo_compositions_workspace
  ON photo_compositions (workspace_id, updated_at DESC);

-- ============================================================================
-- RLS: el visor lee, solo editor escribe (mismo patrón que photo_documents).
-- ============================================================================
ALTER TABLE photo_compositions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "viewer can read compositions" ON photo_compositions;
CREATE POLICY "viewer can read compositions" ON photo_compositions
  FOR SELECT TO authenticated
  USING (has_workspace_role(workspace_id, 'viewer'));

DROP POLICY IF EXISTS "editor can write compositions" ON photo_compositions;
CREATE POLICY "editor can write compositions" ON photo_compositions
  FOR INSERT TO authenticated
  WITH CHECK (has_workspace_role(workspace_id, 'editor'));

DROP POLICY IF EXISTS "editor can update compositions" ON photo_compositions;
CREATE POLICY "editor can update compositions" ON photo_compositions
  FOR UPDATE TO authenticated
  USING (has_workspace_role(workspace_id, 'editor'))
  WITH CHECK (has_workspace_role(workspace_id, 'editor'));

DROP POLICY IF EXISTS "editor can delete compositions" ON photo_compositions;
CREATE POLICY "editor can delete compositions" ON photo_compositions
  FOR DELETE TO authenticated
  USING (has_workspace_role(workspace_id, 'editor'));
