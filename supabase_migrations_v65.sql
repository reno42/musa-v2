-- v65 — Flows: flow_runs.status admite 'waiting' (B5 pausa/reanudación).
-- v64 agregó resume_token/pending_state pero el CHECK flow_runs_status_check
-- seguía limitando status a running/success/failed: updateRun({status:'waiting'})
-- fallaba con 23514 y el run no podía pausar (el runtime degradaba a WAIT_STATE).
-- Idempotente: DROP IF EXISTS + ADD (seguro de re-ejecutar; la tabla solo trae
-- estados running/success/failed hoy, sin filas 'waiting' que violen el nuevo CHECK).

ALTER TABLE flow_runs DROP CONSTRAINT IF EXISTS flow_runs_status_check;
ALTER TABLE flow_runs ADD CONSTRAINT flow_runs_status_check
  CHECK (status IN ('running', 'success', 'failed', 'waiting'));
