-- supabase_migrations_v58.sql
-- Apply after v57. Idempotent and safe to re-run.
--
-- REQ-030 Item 2 (CRM-001) + REQ-029 Item 3: interacciones sin marca y
-- touchpoints de comentario social.
--
--   1. crm_interactions.brand_id pasa a nullable: una persona capturada de la
--      Bandeja no tiene marca todavía, pero SÍ tiene timeline. El endpoint
--      POST /:id/interactions acepta brandId null y actualiza
--      last_contacted_at solo cuando hay marca.
--   2. El CHECK de interaction_type suma 'comentario' — el touchpoint que
--      crea la captura de un comentario de la Bandeja (REQ-029 Item 3).
--   3. La política RLS de escritura admite filas con brand_id NULL y el
--      chequeo contacto↔marca solo exige consistencia cuando hay marca.
--
-- Si esta migración NO corrió, el API responde con un error claro pidiéndola
-- (la captura igual crea el contacto; solo el touchpoint queda pendiente).

-- ── 1. brand_id nullable ─────────────────────────────────────────────
ALTER TABLE crm_interactions ALTER COLUMN brand_id DROP NOT NULL;

-- ── 2. 'comentario' entra al catálogo de touchpoints ────────────────
ALTER TABLE crm_interactions DROP CONSTRAINT IF EXISTS crm_interactions_interaction_type_check;
ALTER TABLE crm_interactions ADD CONSTRAINT crm_interactions_interaction_type_check CHECK (
  interaction_type IN (
    'primer_contacto', 'reunion', 'llamada', 'email', 'whatsapp',
    'propuesta_enviada', 'revision', 'aprobacion', 'publicacion',
    'pago', 'follow_up', 'objecion', 'otro', 'comentario'
  )
);

-- ── 3. RLS: filas sin marca y contacto↔marca solo cuando hay marca ──
ALTER TABLE crm_interactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "crm_interactions_workspace_write" ON crm_interactions;
CREATE POLICY "crm_interactions_workspace_write" ON crm_interactions FOR ALL
  USING (has_workspace_role(workspace_id, 'editor'))
  WITH CHECK (
    has_workspace_role(workspace_id, 'editor')
    AND (
      -- Sin marca: la fila vive colgada de la persona (o de nadie).
      crm_interactions.brand_id IS NULL
      OR EXISTS (
        SELECT 1 FROM brands b
        WHERE b.id = crm_interactions.brand_id
          AND b.workspace_id = crm_interactions.workspace_id
      )
    )
    AND (
      crm_interactions.contact_id IS NULL
      OR EXISTS (
        SELECT 1 FROM crm_contacts contact
        WHERE contact.id = crm_interactions.contact_id
          AND contact.workspace_id = crm_interactions.workspace_id
          -- Con marca, el contacto debe pertenecer a esa marca (igual que v45).
          -- Sin marca, basta que el contacto sea del workspace.
          AND (crm_interactions.brand_id IS NULL OR contact.brand_id = crm_interactions.brand_id)
      )
    )
  );
