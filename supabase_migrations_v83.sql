-- supabase_migrations_v83.sql
-- REQ-055 F2 — video_render async por tickets (el navegador de la cuenta renderiza).
--
-- Sin render server-side (un Worker no puede renderizar video: sin Chromium/
-- FFmpeg en edge — decisión de arquitectura vigente). El flujo:
--   1. El Worker (tool MCP video_render) INSERTA un ticket 'queued'.
--   2. Cualquier sesión del editor de la MISMA cuenta reclama el ticket más
--      viejo disponible: musa_claim_render_ticket — UPDATE condicionado por
--      estado bajo row lock (atómico; reclamar dos veces no duplica). Un
--      claim con más de 10 minutos (CLAIM_TIMEOUT_MS en shared/renderTickets.ts)
--      vuelve a ser reclamable: el navegador se cerró a media tarea.
--   3. La sesión renderiza client-side (core compartido REQ-055 F1), sube el
--      resultado a Storage y cierra con musa_complete_render_ticket; ante un
--      fallo, musa_fail_render_ticket guarda el error accionable.
--   4. video_render_status consulta por RLS (viewer puede leer).
-- Sin sesión abierta el ticket queda 'queued' con mensaje claro — nunca un
-- render fantasma.
--
-- El ticket es de la CUENTA (workspace_id), no del proyecto: sin colas
-- cruzadas entre workspaces multi-tenant.
--
-- Rollback: DROP TABLE musa_video_render_tickets; DROP FUNCTION musa_claim_render_ticket(TEXT,TEXT), musa_complete_render_ticket(TEXT,TEXT,TEXT), musa_fail_render_ticket(TEXT,TEXT,TEXT);
-- Idempotente: se puede re-ejecutar sin error.
-- ============================================================================

CREATE TABLE IF NOT EXISTS musa_video_render_tickets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES musa_video_projects(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- FSM espejo de shared/renderTickets.ts (RENDER_TICKET_STATES).
  state TEXT NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'running', 'completed', 'failed')),
  format TEXT NOT NULL DEFAULT 'mp4' CHECK (format IN ('mp4', 'webm')),
  -- Sesión que reclama (id efímero del editor, no user id: dos pestañas son
  -- dos sesiones). Solo el dueño del claim puede completar/fallar.
  claimed_by TEXT,
  claimed_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 50),
  -- Ruta en Storage del entregable (solo completed). Sin URLs firmadas acá.
  result_path TEXT,
  error TEXT,
  created_by TEXT NOT NULL DEFAULT 'ai:musa',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT musa_video_render_tickets_id_prefix CHECK (id LIKE 'vrt\_%'),
  CONSTRAINT musa_video_render_tickets_running_needs_claim CHECK (
    state <> 'running' OR (claimed_by IS NOT NULL AND claimed_at IS NOT NULL)
  ),
  CONSTRAINT musa_video_render_tickets_completed_needs_result CHECK (
    state <> 'completed' OR (result_path IS NOT NULL AND char_length(result_path) BETWEEN 1 AND 1024)
  )
);

-- El claim del RPC toma el ticket más viejo disponible del workspace.
CREATE INDEX IF NOT EXISTS idx_musa_video_render_tickets_claim
  ON musa_video_render_tickets (workspace_id, state, created_at);
-- Estado por ticket desde MCP/video_render_status.
CREATE INDEX IF NOT EXISTS idx_musa_video_render_tickets_project
  ON musa_video_render_tickets (project_id, created_at DESC);

-- ── RLS (mismo patrón v73: viewer lee, editor escribe) ─────────────────────
ALTER TABLE musa_video_render_tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "viewer can read musa_video_render_tickets" ON musa_video_render_tickets;
CREATE POLICY "viewer can read musa_video_render_tickets" ON musa_video_render_tickets
  FOR SELECT TO authenticated
  USING (has_workspace_role(workspace_id, 'viewer'));
DROP POLICY IF EXISTS "editor can write musa_video_render_tickets" ON musa_video_render_tickets;
CREATE POLICY "editor can write musa_video_render_tickets" ON musa_video_render_tickets
  FOR INSERT TO authenticated
  WITH CHECK (has_workspace_role(workspace_id, 'editor'));
DROP POLICY IF EXISTS "editor can update musa_video_render_tickets" ON musa_video_render_tickets;
CREATE POLICY "editor can update musa_video_render_tickets" ON musa_video_render_tickets
  FOR UPDATE TO authenticated
  USING (has_workspace_role(workspace_id, 'editor'))
  WITH CHECK (has_workspace_role(workspace_id, 'editor'));
DROP POLICY IF EXISTS "editor can delete musa_video_render_tickets" ON musa_video_render_tickets;
CREATE POLICY "editor can delete musa_video_render_tickets" ON musa_video_render_tickets
  FOR DELETE TO authenticated
  USING (has_workspace_role(workspace_id, 'editor'));

-- ── RPCs (SECURITY DEFINER: la transición completa es una sola sentencia) ──

-- Claim atómico del ticket más viejo disponible del workspace. Un UPDATE con
-- WHERE por estado es atómico bajo row lock: dos sesiones concurrentes →
-- exactamente una gana, la otra obtiene RENDER_TICKET_NOT_CLAIMABLE.
CREATE OR REPLACE FUNCTION musa_claim_render_ticket(
  p_workspace_id TEXT,
  p_session_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket RECORD;
BEGIN
  IF NULLIF(p_session_id, '') IS NULL THEN
    RAISE EXCEPTION 'RENDER_SESSION_REQUIRED: p_session_id es obligatorio' USING ERRCODE = '22023';
  END IF;
  IF NOT has_workspace_role(p_workspace_id, 'editor') THEN
    RAISE EXCEPTION 'RENDER_TICKET_FORBIDDEN: requiere rol editor en el workspace' USING ERRCODE = '42501';
  END IF;

  UPDATE musa_video_render_tickets t
  SET state = 'running',
      claimed_by = p_session_id,
      claimed_at = NOW(),
      attempts = t.attempts + 1,
      updated_at = NOW()
  WHERE t.id = (
    SELECT c.id
    FROM musa_video_render_tickets c
    WHERE c.workspace_id = p_workspace_id
      AND (
        c.state = 'queued'
        OR (c.state = 'running' AND c.claimed_at < NOW() - INTERVAL '10 minutes')
      )
    ORDER BY c.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING to_jsonb(t) INTO v_ticket;

  IF NOT FOUND THEN
    -- Honestidad del REQ: sin trabajo disponible se dice explícito — el
    -- editor puede volver a preguntar más tarde (poll del shim).
    RAISE EXCEPTION 'RENDER_TICKET_NONE: no hay tickets disponibles para reclamar' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_ticket;
END;
$$;

-- Cierra un claim con el entregable. Solo la sesión dueña del claim vigente.
CREATE OR REPLACE FUNCTION musa_complete_render_ticket(
  p_ticket_id TEXT,
  p_session_id TEXT,
  p_result_path TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket RECORD;
BEGIN
  UPDATE musa_video_render_tickets t
  SET state = 'completed',
      result_path = p_result_path,
      error = NULL,
      updated_at = NOW()
  WHERE t.id = p_ticket_id
    AND t.state = 'running'
    AND t.claimed_by = p_session_id
  RETURNING to_jsonb(t) INTO v_ticket;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RENDER_TICKET_NOT_OWNER: el ticket no está running para esta sesión' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_ticket;
END;
$$;

-- Marca fallido con el error accionable (el archivo local queda en el editor).
CREATE OR REPLACE FUNCTION musa_fail_render_ticket(
  p_ticket_id TEXT,
  p_session_id TEXT,
  p_error TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket RECORD;
BEGIN
  UPDATE musa_video_render_tickets t
  SET state = 'failed',
      error = LEFT(COALESCE(NULLIF(p_error, ''), 'RENDER_FAILED: sin detalle'), 1000),
      result_path = NULL,
      updated_at = NOW()
  WHERE t.id = p_ticket_id
    AND t.state = 'running'
    AND t.claimed_by = p_session_id
  RETURNING to_jsonb(t) INTO v_ticket;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RENDER_TICKET_NOT_OWNER: el ticket no está running para esta sesión' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_ticket;
END;
$$;

-- P0001 (clase 38) NO se reintenta por PostgREST — mismo criterio v80/v82:
-- los conflictos deterministas vuelven en un solo viaje. Las funciones son
-- invocables por la sesión del editor (claim/close con JWT de usuario) y por
-- el Worker (service_role, para barridos/estado).
REVOKE ALL ON FUNCTION musa_claim_render_ticket(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION musa_complete_render_ticket(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION musa_fail_render_ticket(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION musa_claim_render_ticket(TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION musa_complete_render_ticket(TEXT, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION musa_fail_render_ticket(TEXT, TEXT, TEXT) TO authenticated, service_role;
