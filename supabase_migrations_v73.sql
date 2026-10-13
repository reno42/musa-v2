-- ============================================================================
-- Migración v73 — REQ-VID10: modelo de datos del módulo Video standalone
-- (modelo CapCut: draft_content.json → musa_video_*)
--
-- musa_video_projects:  proyecto de video STANDALONE del workspace. NO es el
--   Video Mode de templates (ese vive en templates.data JSONB y sigue igual);
--   este es el modelo propio de edición video que comparten la IA (MCP tools
--   video_*) y el humano (UI drag & drop) — ambos escriben estas tablas.
-- musa_video_tracks:    pistas; z_order ASCENDENTE = de abajo hacia arriba
--   (mismo criterio que el array de tracks de CapCut).
-- musa_video_segments:  el clip DELGADO de CapCut: referencia su asset por
--   material_id (UUID del formato), target_timerange (dónde suena en el
--   timeline) ≠ source_timerange (qué porción del source usa — trim sin
--   copiar), speed, transform normalizado y extra_refs[] a companions.
-- musa_video_materials: diccionario plano de TODOS los assets y companions
--   (velocidad/máscaras/fades/transiciones/efectos van POR REFERENCIA, no
--   anidados — así los efectos se agregan/quitan sin mutar el segment).
--
-- REGLAS DURAS del formato (heredadas de los gotchas de CapCut):
--   • TODO el tiempo en MICROSEGUNDOS (BIGINT). Prohibido guardar segundos.
--   • Posiciones normalizadas -1..1 (centro=0,0); scale 1.0 = tamaño source.
--   • Segmento de audio ⇒ clip NULL (un clip object en audio crashea CapCut).
--   • source_dur_us = round(target_dur_us × speed)  (regla de oro; speed 2.0
--     ⇒ source = 2× target).
--   • extra_refs[] apunta SIEMPRE a materials.id del MISMO project.
--   • Trim clampado al fin del source (nunca pasa el fin del material).
--
-- Estas invariantes cruzan tablas: SQL no puede chequearlas — las aplica
-- api/src/services/videoProjects.ts (validadores compartidos por las MCP
-- tools video_* y las rutas REST /api/video-projects).
--
-- NOTA de tipos (mismo criterio que v59-v61): workspaces.id es TEXT en este
-- proyecto, así que workspace_id es TEXT con FK CASCADE. Los ids propios son
-- TEXT prefijados (vidproj_ / vidtrk_ / vidseg_ / vidmat_).
-- Idempotente: se puede re-ejecutar sin error.
-- ============================================================================

-- ── musa_video_projects ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS musa_video_projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  -- Duración total del timeline (max de target_start+target_dur), µs.
  duration_us BIGINT NOT NULL DEFAULT 0 CHECK (duration_us >= 0),
  fps INTEGER NOT NULL DEFAULT 30 CHECK (fps BETWEEN 1 AND 60),
  canvas_w INTEGER NOT NULL DEFAULT 1080 CHECK (canvas_w BETWEEN 16 AND 8192),
  canvas_h INTEGER NOT NULL DEFAULT 1920 CHECK (canvas_h BETWEEN 16 AND 8192),
  ratio TEXT NOT NULL DEFAULT '9:16',
  -- VID13: un template = project con materials marcados con slot {key,label}.
  is_template BOOLEAN NOT NULL DEFAULT FALSE,
  -- 'user' | 'ai:<model>' — quién lo creó (atribución, sin FK).
  created_by TEXT NOT NULL DEFAULT 'user'
    CHECK (created_by = 'user' OR created_by LIKE 'ai:%'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT musa_video_projects_id_prefix CHECK (id LIKE 'vidproj\_%')
);

CREATE INDEX IF NOT EXISTS idx_musa_video_projects_workspace
  ON musa_video_projects (workspace_id, updated_at DESC);

-- ── musa_video_tracks ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS musa_video_tracks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES musa_video_projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('video', 'audio', 'text', 'sticker', 'effect')),
  -- Orden en la pila: ascendente = de abajo hacia arriba (z-order CapCut).
  z_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT musa_video_tracks_id_prefix CHECK (id LIKE 'vidtrk\_%')
);

CREATE INDEX IF NOT EXISTS idx_musa_video_tracks_project
  ON musa_video_tracks (project_id, z_order);

-- ── musa_video_segments ─────────────────────────────────────────────────────
-- material_id es TEXT SIN FK a propósito: los companions (speed, efectos,
-- fades) viven en la MISMA tabla de materials y la integridad referencial de
-- extra_refs la aplica el servicio (CapCut no la tiene en su formato y la
-- comunidad la resuelve en tooling — mismo criterio).
CREATE TABLE IF NOT EXISTS musa_video_segments (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL REFERENCES musa_video_tracks(id) ON DELETE CASCADE,
  material_id TEXT NOT NULL,
  -- Dónde suena en el timeline (µs desde el inicio del project).
  target_start_us BIGINT NOT NULL DEFAULT 0 CHECK (target_start_us >= 0),
  target_dur_us BIGINT NOT NULL CHECK (target_dur_us > 0),
  -- Qué porción del source usa (µs; trim sin copiar). NULL = clip "virtal"
  -- (texto/sticker/effect sin media detrás).
  source_start_us BIGINT CHECK (source_start_us IS NULL OR source_start_us >= 0),
  source_dur_us BIGINT CHECK (source_dur_us IS NULL OR source_dur_us > 0),
  -- INVARIANTE (servicio): source_dur_us = round(target_dur_us × speed).
  speed REAL NOT NULL DEFAULT 1.0 CHECK (speed > 0),
  -- Transform normalizado: {x,y ∈ -1..1 (centro=0,0), scale (1.0=source),
  -- rotation (grados horario), alpha 0..1, flip}. NULL en audio (regla dura).
  clip JSONB,
  -- Companions por referencia: UUIDs de materials del MISMO project
  -- (efectos, velocidad, máscara, fades, transición de entrada...).
  extra_refs TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT musa_video_segments_id_prefix CHECK (id LIKE 'vidseg\_%')
);

CREATE INDEX IF NOT EXISTS idx_musa_video_segments_track
  ON musa_video_segments (track_id, target_start_us);
-- Resolución de tenant para authorizeMcpCall (segmentId → project → workspace)
-- y limpieza de duración: la FK a tracks ya cascada, esto evita el join lento.
CREATE INDEX IF NOT EXISTS idx_musa_video_segments_id_track
  ON musa_video_segments (id, track_id);

-- ── musa_video_materials ────────────────────────────────────────────────────
-- Una tabla plana; kind discrimina (los diccionarios separados de CapCut —
-- videos/audios/texts/speeds/...— aquí son filas con kind distinto).
CREATE TABLE IF NOT EXISTS musa_video_materials (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES musa_video_projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN (
    'video', 'audio', 'text', 'sticker', 'effect', 'transition',
    'animation', 'mask', 'canvas', 'speed', 'audio_fade'
  )),
  -- Shape por kind (validado en el servicio):
  --  video/audio: {url, durationUs, name, width?, height?}
  --  text:        {text, style, ranges:[{start,end,attrs}]} — estilado por
  --               RANGOS DE CARACTERES (nunca un blob único).
  --  effect:      {manifest:{name,type,zorder,scriptPath?,resources}, params}
  --  speed:       {speed} · audio_fade: {in,fadeIn,fadeOut} · mask/canvas/...
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- VID13: placeholder de template {key, label} — solo en materials de
  -- video/text/audio de un project marcado is_template.
  slot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT musa_video_materials_id_prefix CHECK (id LIKE 'vidmat\_%')
);

CREATE INDEX IF NOT EXISTS idx_musa_video_materials_project
  ON musa_video_materials (project_id, kind);

-- ============================================================================
-- RLS: el visor lee, solo editor escribe (mismo patrón que v61 flows / v60
-- photo_compositions). El MCP y la API usan service_role (bypass); esto
-- protege el acceso directo desde clientes con sesión.
-- ============================================================================

ALTER TABLE musa_video_projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "viewer can read musa_video_projects" ON musa_video_projects;
CREATE POLICY "viewer can read musa_video_projects" ON musa_video_projects
  FOR SELECT TO authenticated
  USING (has_workspace_role(workspace_id, 'viewer'));
DROP POLICY IF EXISTS "editor can write musa_video_projects" ON musa_video_projects;
CREATE POLICY "editor can write musa_video_projects" ON musa_video_projects
  FOR INSERT TO authenticated
  WITH CHECK (has_workspace_role(workspace_id, 'editor'));
DROP POLICY IF EXISTS "editor can update musa_video_projects" ON musa_video_projects;
CREATE POLICY "editor can update musa_video_projects" ON musa_video_projects
  FOR UPDATE TO authenticated
  USING (has_workspace_role(workspace_id, 'editor'))
  WITH CHECK (has_workspace_role(workspace_id, 'editor'));
DROP POLICY IF EXISTS "editor can delete musa_video_projects" ON musa_video_projects;
CREATE POLICY "editor can delete musa_video_projects" ON musa_video_projects
  FOR DELETE TO authenticated
  USING (has_workspace_role(workspace_id, 'editor'));

ALTER TABLE musa_video_tracks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "viewer can read musa_video_tracks" ON musa_video_tracks;
CREATE POLICY "viewer can read musa_video_tracks" ON musa_video_tracks
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM musa_video_projects p
    WHERE p.id = musa_video_tracks.project_id
      AND has_workspace_role(p.workspace_id, 'viewer')
  ));
DROP POLICY IF EXISTS "editor can write musa_video_tracks" ON musa_video_tracks;
CREATE POLICY "editor can write musa_video_tracks" ON musa_video_tracks
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM musa_video_projects p
    WHERE p.id = musa_video_tracks.project_id
      AND has_workspace_role(p.workspace_id, 'editor')
  ));
DROP POLICY IF EXISTS "editor can update musa_video_tracks" ON musa_video_tracks;
CREATE POLICY "editor can update musa_video_tracks" ON musa_video_tracks
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM musa_video_projects p
    WHERE p.id = musa_video_tracks.project_id
      AND has_workspace_role(p.workspace_id, 'editor')
  ));
DROP POLICY IF EXISTS "editor can delete musa_video_tracks" ON musa_video_tracks;
CREATE POLICY "editor can delete musa_video_tracks" ON musa_video_tracks
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM musa_video_projects p
    WHERE p.id = musa_video_tracks.project_id
      AND has_workspace_role(p.workspace_id, 'editor')
  ));

ALTER TABLE musa_video_segments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "viewer can read musa_video_segments" ON musa_video_segments;
CREATE POLICY "viewer can read musa_video_segments" ON musa_video_segments
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM musa_video_tracks t
    JOIN musa_video_projects p ON p.id = t.project_id
    WHERE t.id = musa_video_segments.track_id
      AND has_workspace_role(p.workspace_id, 'viewer')
  ));
DROP POLICY IF EXISTS "editor can write musa_video_segments" ON musa_video_segments;
CREATE POLICY "editor can write musa_video_segments" ON musa_video_segments
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM musa_video_tracks t
    JOIN musa_video_projects p ON p.id = t.project_id
    WHERE t.id = musa_video_segments.track_id
      AND has_workspace_role(p.workspace_id, 'editor')
  ));
DROP POLICY IF EXISTS "editor can update musa_video_segments" ON musa_video_segments;
CREATE POLICY "editor can update musa_video_segments" ON musa_video_segments
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM musa_video_tracks t
    JOIN musa_video_projects p ON p.id = t.project_id
    WHERE t.id = musa_video_segments.track_id
      AND has_workspace_role(p.workspace_id, 'editor')
  ));
DROP POLICY IF EXISTS "editor can delete musa_video_segments" ON musa_video_segments;
CREATE POLICY "editor can delete musa_video_segments" ON musa_video_segments
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM musa_video_tracks t
    JOIN musa_video_projects p ON p.id = t.project_id
    WHERE t.id = musa_video_segments.track_id
      AND has_workspace_role(p.workspace_id, 'editor')
  ));

ALTER TABLE musa_video_materials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "viewer can read musa_video_materials" ON musa_video_materials;
CREATE POLICY "viewer can read musa_video_materials" ON musa_video_materials
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM musa_video_projects p
    WHERE p.id = musa_video_materials.project_id
      AND has_workspace_role(p.workspace_id, 'viewer')
  ));
DROP POLICY IF EXISTS "editor can write musa_video_materials" ON musa_video_materials;
CREATE POLICY "editor can write musa_video_materials" ON musa_video_materials
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM musa_video_projects p
    WHERE p.id = musa_video_materials.project_id
      AND has_workspace_role(p.workspace_id, 'editor')
  ));
DROP POLICY IF EXISTS "editor can update musa_video_materials" ON musa_video_materials;
CREATE POLICY "editor can update musa_video_materials" ON musa_video_materials
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM musa_video_projects p
    WHERE p.id = musa_video_materials.project_id
      AND has_workspace_role(p.workspace_id, 'editor')
  ));
DROP POLICY IF EXISTS "editor can delete musa_video_materials" ON musa_video_materials;
CREATE POLICY "editor can delete musa_video_materials" ON musa_video_materials
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM musa_video_projects p
    WHERE p.id = musa_video_materials.project_id
      AND has_workspace_role(p.workspace_id, 'editor')
  ));
