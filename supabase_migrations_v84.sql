-- supabase_migrations_v84.sql
-- REQ-058 — Tomas de video (Take Studio): grabación del humano con TTL de 24 h.
--
-- Política de producto (decisión explícita): las tomas son INSUMO, no
-- archivo. El aviso de la UI promete "máximo 24 horas y luego se borran"
-- para motivar la descarga. La expiración es LAZY: listing y descarga
-- consultan expires_at, así la toma vencida sale del producto aunque el
-- objeto siga en R2 hasta el barrido manual.
--
-- La purga física NO es cronjob (decisión: gastaría recursos). El barrido
-- manual de fin de semana vive en `scripts/purge-expired-takes.mjs`:
-- borra los objetos en R2 y marca state='purged'. Los bytes VIVOS (cupo)
-- solo cuentan state IN (uploading, ready) AND expires_at > NOW(), así el
-- cupo se libera lazy aunque el sweep no haya corrido.
--
-- Los bytes del video viven en R2 (carril pesado); acá solo metadata.
-- El ticket (v83) fue de la cuenta; la toma también: workspace_id.
--
-- Rollback: DROP TABLE musa_video_takes; DROP FUNCTION musa_register_video_take(TEXT,BIGINT,INTEGER,TEXT), musa_complete_video_take(TEXT,BIGINT);
-- Idempotente: se puede re-ejecutar sin error.
-- ============================================================================

CREATE TABLE IF NOT EXISTS musa_video_takes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Llave del objeto dentro del bucket R2 (binding VIDEO_TAKES). Prefijo por
  -- workspace para que el barrido y una futura retención por cuenta sean triviales.
  r2_key TEXT NOT NULL UNIQUE,
  -- FSM: uploading (creada, PUT en vuelo) → ready (complete verificó el objeto).
  -- 'purged' lo marca el barrido manual tras borrar el objeto en R2 (queda
  -- como tumba de auditoría; los bytes ya no existen).
  state TEXT NOT NULL DEFAULT 'uploading'
    CHECK (state IN ('uploading', 'ready', 'purged')),
  mime TEXT NOT NULL DEFAULT 'video/webm',
  size_bytes BIGINT NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  -- Dueño (user id del JWT al registrar). Solo el dueño completa.
  created_by TEXT NOT NULL,
  -- Marcado al generar la primera URL firmada de descarga (badge en la UI).
  downloaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- TTL de 24 h — SIEMPRE lo calcula el server (register), nunca el cliente.
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT musa_video_takes_ttl CHECK (expires_at > created_at)
);

-- Listado del estudio: por workspace, vivas primero.
CREATE INDEX IF NOT EXISTS idx_musa_video_takes_list
  ON musa_video_takes (workspace_id, created_at DESC);
-- Barrido manual: las vencidas no purgadas.
CREATE INDEX IF NOT EXISTS idx_musa_video_takes_sweep
  ON musa_video_takes (expires_at) WHERE state <> 'purged';

-- ── RLS (mismo patrón v73/v83: viewer lee, editor escribe) ─────────────────
ALTER TABLE musa_video_takes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "viewer can read musa_video_takes" ON musa_video_takes;
CREATE POLICY "viewer can read musa_video_takes" ON musa_video_takes
  FOR SELECT TO authenticated
  USING (has_workspace_role(workspace_id, 'viewer'));
DROP POLICY IF EXISTS "editor can insert musa_video_takes" ON musa_video_takes;
CREATE POLICY "editor can insert musa_video_takes" ON musa_video_takes
  FOR INSERT TO authenticated
  WITH CHECK (has_workspace_role(workspace_id, 'editor'));
DROP POLICY IF EXISTS "editor can update musa_video_takes" ON musa_video_takes;
CREATE POLICY "editor can update musa_video_takes" ON musa_video_takes
  FOR UPDATE TO authenticated
  USING (has_workspace_role(workspace_id, 'editor'))
  WITH CHECK (has_workspace_role(workspace_id, 'editor'));
DROP POLICY IF EXISTS "editor can delete musa_video_takes" ON musa_video_takes;
CREATE POLICY "editor can delete musa_video_takes" ON musa_video_takes
  FOR DELETE TO authenticated
  USING (has_workspace_role(workspace_id, 'editor'));

-- ── RPCs (SECURITY DEFINER — quota y TTL se calculan del lado del server) ──

-- Registra la toma ANTES del PUT a R2: la fila nace 'uploading' con el TTL
-- de 24 h puesto por el reloj del server. Devuelve la fila completa
-- (incluye r2_key para que el handler firme el PUT). El cupo blando rechaza
-- con P0001 (no se reintenta por PostgREST — criterio v80/v82/v83).
CREATE OR REPLACE FUNCTION musa_register_video_take(
  p_workspace_id TEXT,
  p_size_bytes BIGINT,
  p_duration_ms INTEGER,
  p_mime TEXT DEFAULT 'video/webm'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_live_bytes BIGINT;
  v_id TEXT;
  v_row musa_video_takes;
BEGIN
  IF NOT has_workspace_role(p_workspace_id, 'editor') THEN
    RAISE EXCEPTION 'TAKE_FORBIDDEN: requiere rol editor en el workspace' USING ERRCODE = '42501';
  END IF;
  IF p_size_bytes IS NULL OR p_size_bytes <= 0 THEN
    RAISE EXCEPTION 'TAKE_SIZE_REQUIRED: size_bytes debe ser positivo' USING ERRCODE = '22023';
  END IF;
  -- Cupo blando de bytes VIVOS (mismo número que TAKES_SOFT_QUOTA_BYTES en
  -- shared/takeTtl.ts: 8 GB de los 10 GB free de R2).
  SELECT COALESCE(SUM(size_bytes), 0) INTO v_live_bytes
  FROM musa_video_takes
  WHERE workspace_id = p_workspace_id
    AND state IN ('uploading', 'ready')
    AND expires_at > NOW();
  IF v_live_bytes + p_size_bytes > 8 * 1024 * 1024 * 1024::BIGINT THEN
    RAISE EXCEPTION 'TAKE_QUOTA_EXCEEDED: cupo de tomas lleno (%%/%% bytes vivos) — descarga o espera el barrido' USING ERRCODE = 'P0001';
  END IF;

  v_id := 'vt_' || substr(md5(clock_timestamp()::text || random()::text), 1, 16);
  INSERT INTO musa_video_takes (id, workspace_id, r2_key, state, mime, size_bytes, duration_ms, created_by, created_at, expires_at)
  VALUES (
    v_id, p_workspace_id,
    'takes/' || p_workspace_id || '/' || v_id || '.webm',
    'uploading', COALESCE(NULLIF(p_mime, ''), 'video/webm'),
    p_size_bytes, GREATEST(0, COALESCE(p_duration_ms, 0)),
    auth.uid()::TEXT, NOW(), NOW() + INTERVAL '24 hours'
  )
  RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END;
$$;

-- Cierra el PUT: el handler verificó el objeto en R2 (HEAD) y confirma el
-- tamaño real. Solo el dueño, solo en uploading — reclamar dos veces no
-- duplica (idempotencia del REQ).
CREATE OR REPLACE FUNCTION musa_complete_video_take(
  p_take_id TEXT,
  p_size_bytes BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row musa_video_takes;
BEGIN
  UPDATE musa_video_takes t
  SET state = 'ready',
      size_bytes = GREATEST(COALESCE(p_size_bytes, t.size_bytes), 0)
  WHERE t.id = p_take_id
    AND t.state = 'uploading'
    AND t.created_by = auth.uid()::TEXT
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TAKE_NOT_OPEN: la toma no existe, no es tuya o ya estaba cerrada' USING ERRCODE = 'P0001';
  END IF;
  RETURN to_jsonb(v_row);
END;
$$;

-- P0001 (clase 38) NO se reintenta por PostgREST — mismo criterio v80/v82/v83.
-- El handler corre con service key; los RPC son invocables por la sesión del
-- editor (JWT de usuario) para el mismo contrato.
REVOKE ALL ON FUNCTION musa_register_video_take(TEXT, BIGINT, INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION musa_complete_video_take(TEXT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION musa_register_video_take(TEXT, BIGINT, INTEGER, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION musa_complete_video_take(TEXT, BIGINT) TO authenticated, service_role;
