-- v70 — Flows-brand: inputs declarados del flow (mini-formulario del run).
-- flow_save acepta definition.inputs = [{key, label?, type?, required?, default?}
-- ≤12] y executeFlow aplica defaults + exige los required sobre el payload
-- {{input.x}} (manual, schedule y webhook por igual). Sin la columna el save
-- degrada con gracia (OPTIONAL_COLUMNS reintenta sin ella) — igual que
-- tags/versions/vars en v63 y flows_wake en v68.
-- Idempotente: ADD COLUMN IF NOT EXISTS (seguro de re-ejecutar).

ALTER TABLE public.flows ADD COLUMN IF NOT EXISTS inputs jsonb NOT NULL DEFAULT '[]'::jsonb;
