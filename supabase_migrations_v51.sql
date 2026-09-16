-- supabase_migrations_v51.sql — REQ Planilla de Contenidos v2 (Hermes, 15-sep-2026)
--
-- 1) content_calendar: 3 columnas nuevas (icp, conversion_goal, visual_type).
--    Regla de comportamiento (acordado con Ren): vacío = la IA decide con el
--    contexto; lleno = la IA obedece (aunque el copy sugiera otra cosa).
-- 2) crm_signals: señales inbound (comentarios, DMs, respuestas) con nivel de
--    confianza — la materia prima de la vista Atribución (3 niveles).
--    Tabla propia, NO crm_interactions: el CHECK enum de interactions es
--    cerrado y mezclar señales inbound con touchpoints comerciales ensuciaría
--    el funnel 360.
-- 3) crm_contacts: origen de atribución (directa/asistida/correlación).
--
-- PROTOCOLO: aplicar este SQL en Supabase (cloud), reload del schema cache,
-- y RECIÉN AHÍ subir .migration-version a v51. scripts/check-migrations.mjs
-- advierte mientras el código esté adelante del schema.
-- Idempotente: segura de re-ejecutar (ADD COLUMN IF NOT EXISTS / IF NOT EXISTS).

-- ── 1. content_calendar: segmento, objetivo y tipo de gráfico ──────────────

ALTER TABLE content_calendar ADD COLUMN IF NOT EXISTS icp TEXT;
ALTER TABLE content_calendar ADD COLUMN IF NOT EXISTS conversion_goal TEXT;
ALTER TABLE content_calendar ADD COLUMN IF NOT EXISTS visual_type TEXT;

COMMENT ON COLUMN content_calendar.icp IS
  'Segmento/ICP objetivo de la pieza. Vacío = la IA decide con el contexto; lleno = copy y visual se dirigen a ese segmento.';
COMMENT ON COLUMN content_calendar.conversion_goal IS
  'Acción/conversión esperada (que escriban DM, comenten, agenden, link en bio, descarguen…). Alimenta la vista Atribución.';
COMMENT ON COLUMN content_calendar.visual_type IS
  'Tipo de gráfico del catálogo de formatos visuales (timeline, mindmap, versus, matrix2x2…). Vacío = la IA elige el formato; lleno = obliga al tipo.';

-- ── 2. crm_signals ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crm_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES crm_deals(id) ON DELETE SET NULL,
  -- Pieza que originó (o se asocia a) la señal — el ancla de la Atribución.
  -- TEXT (no UUID): content_calendar.id es TEXT con prefijo cc_ (v22).
  origin_content_id TEXT REFERENCES content_calendar(id) ON DELETE SET NULL,
  -- Tipo de señal inbound.
  signal_type TEXT NOT NULL CHECK (
    signal_type IN ('comentario', 'dm', 'story_reply', 'respuesta_post', 'otro')
  ),
  -- Nivel de confianza (regla de honestidad de la Atribución):
  --   directa     = la Bandeja conoce el post de origen (Zernio)
  --   asistida    = el contacto declaró origen en el capture
  --   correlacion = pico en ventana tras publicar; se REPORTA como asociado
  confidence TEXT NOT NULL CHECK (
    confidence IN ('directa', 'asistida', 'correlacion')
  ),
  -- Referencia cruda en la plataforma (permalink del comentario/DM, story id).
  external_ref TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_signals_workspace_brand
  ON crm_signals(workspace_id, brand_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_signals_workspace_origin
  ON crm_signals(workspace_id, origin_content_id, occurred_at DESC)
  WHERE origin_content_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_signals_workspace_contact
  ON crm_signals(workspace_id, contact_id, occurred_at DESC)
  WHERE contact_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_signals_id_workspace
  ON crm_signals(id, workspace_id);

ALTER TABLE crm_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "crm_signals_workspace_read" ON crm_signals;
CREATE POLICY "crm_signals_workspace_read" ON crm_signals FOR SELECT
  USING (has_workspace_role(workspace_id, 'viewer'));

DROP POLICY IF EXISTS "crm_signals_workspace_write" ON crm_signals;
CREATE POLICY "crm_signals_workspace_write" ON crm_signals FOR ALL
  USING (has_workspace_role(workspace_id, 'editor'))
  WITH CHECK (
    has_workspace_role(workspace_id, 'editor')
    AND EXISTS (
      SELECT 1 FROM brands b
      WHERE b.id = crm_signals.brand_id AND b.workspace_id = crm_signals.workspace_id
    )
    AND (
      crm_signals.contact_id IS NULL OR EXISTS (
        SELECT 1 FROM crm_contacts contact
        WHERE contact.id = crm_signals.contact_id
          AND contact.workspace_id = crm_signals.workspace_id
          AND contact.brand_id = crm_signals.brand_id
      )
    )
    AND (
      crm_signals.deal_id IS NULL OR EXISTS (
        SELECT 1 FROM crm_deals deal
        WHERE deal.id = crm_signals.deal_id
          AND deal.workspace_id = crm_signals.workspace_id
          AND deal.brand_id = crm_signals.brand_id
      )
    )
    AND (
      crm_signals.origin_content_id IS NULL OR EXISTS (
        SELECT 1 FROM content_calendar cc
        WHERE cc.id = crm_signals.origin_content_id
          AND cc.workspace_id = crm_signals.workspace_id
      )
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON crm_signals TO authenticated;

-- ── 3. crm_contacts: origen de atribución ───────────────────────────────────

ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS origin_source TEXT;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS origin_content_id TEXT REFERENCES content_calendar(id) ON DELETE SET NULL;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS origin_post_ref TEXT;

COMMENT ON COLUMN crm_contacts.origin_source IS
  'Cómo llegó el contacto: directa (citeó el post), asistida (declaró origen en el capture), correlacion (pico en ventana — nunca reportar como generado).';
