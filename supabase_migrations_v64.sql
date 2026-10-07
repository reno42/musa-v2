-- v64 — Flows: pausas B5 (wait_webhook/approval) y protección D4-lite.
-- resume_token/pending_state: estado del run en espera (flow_resume continúa
-- el MISMO run; el índice hace el lookup O(1) por token).
-- locked: edición congelada del flow (solo admin edita/desbloquea; flow_run
-- sigue permitido).
-- Idempotente: seguro de re-ejecutar (ADD COLUMN IF NOT EXISTS).

ALTER TABLE flow_runs ADD COLUMN IF NOT EXISTS resume_token text;
ALTER TABLE flow_runs ADD COLUMN IF NOT EXISTS pending_state jsonb;
CREATE INDEX IF NOT EXISTS idx_flow_runs_resume_token ON flow_runs(resume_token);
ALTER TABLE flows ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false;
