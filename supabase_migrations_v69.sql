-- v69 — REQ-040 Flows wake: índice del filtro de estado en flow_history.
-- El fallback barato del wake es flow_history {status:"waiting"} (1 llamada
-- lista solo los runs pausados — "requiere atención"). Sin índice esa query
-- barre el historial completo del workspace. Mismo criterio que los índices
-- de v61 (started_at DESC); el parcial de 'running' de v61 no cubre 'waiting'.
-- Idempotente: IF NOT EXISTS (seguro de re-ejecutar).

CREATE INDEX IF NOT EXISTS flow_runs_status_idx
ON flow_runs (workspace_id, status, started_at DESC);
