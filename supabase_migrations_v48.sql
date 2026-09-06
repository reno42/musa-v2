-- supabase_migrations_v48.sql — Second Brain + timeline por deal
-- ─────────────────────────────────────────────────────────────────────────────
-- 1) crm_interactions.deal_id: la tercera lupa del timeline comercial.
--    Hoy una interacción vive a nivel marca (y persona con contact_id); con
--    deal_id la ficha de un deal muestra "la historia de ESTA negociación",
--    con atribución por persona (influencer vs decisor) vía contact_id.
-- 2) crm_deals.next_step_*: próximo paso declarado por el humano (nota +
--    fecha). El sistema NUNCA lo sugiere — solo lo muestra y lo vence en rojo.
-- 3) design_file_meta.notes_md: notas Markdown por nodo del grafo (Second
--    Brain): briefs, contexto, lo que sea — legible para humanos y para IAs.
--
-- Degradación: el API detecta la falta de estas columnas (42703/PGRST204) y
-- sigue funcionando sin ellas; la UI avisa "ejecuta supabase_migrations_v48.sql".

-- 1) Timeline por deal ────────────────────────────────────────────────────────
ALTER TABLE crm_interactions
  ADD COLUMN IF NOT EXISTS deal_id UUID REFERENCES crm_deals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_crm_interactions_deal
  ON crm_interactions(deal_id);

-- 2) Próximo paso por deal ────────────────────────────────────────────────────
ALTER TABLE crm_deals
  ADD COLUMN IF NOT EXISTS next_step_note TEXT;

ALTER TABLE crm_deals
  ADD COLUMN IF NOT EXISTS next_step_date DATE;

-- 3) Notas Markdown por nodo del grafo ────────────────────────────────────────
ALTER TABLE design_file_meta
  ADD COLUMN IF NOT EXISTS notes_md TEXT;
