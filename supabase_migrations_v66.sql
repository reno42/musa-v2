-- v66 — Flows (F2): static_data del flow — storage persistente entre runs
-- (el "static data" de n8n). El engine lo expone como {{static.campo}} y las
-- tools flow_static_data_get/set lo leen/escriben (merge superficial ≤8KB).
-- Idempotente: ADD COLUMN IF NOT EXISTS; el default '{}' backfilla filas viejas
-- y prepareFlowRow no toca la columna (un flow_save jamás la pisa).

ALTER TABLE public.flows ADD COLUMN IF NOT EXISTS static_data jsonb NOT NULL DEFAULT '{}'::jsonb;
