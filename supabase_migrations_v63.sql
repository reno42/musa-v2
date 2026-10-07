-- ============================================================================
-- Migración v63 — Flows: tags + versiones de edición + variables (paridad n8n)
--
-- Plan FLOW_BUILDER_GAP_VS_N8N:
--   D1 tags     — etiquetas libres por flow (≤10, ≤24 chars; las acota
--                 flows-core.validateFlowDefinition) para filtrar el board.
--   D2 versions — snapshot del estado ANTERIOR en cada flow_save (acotado a
--                 LIMITS.maxVersionsPerFlow = 10 por el propio engine, que
--                 recorta el arreglo antes de escribir). flow_get devuelve
--                 versions[] y el editor ofrece "Restaurar" en el Historial.
--   B10 vars    — variables del flow (escalares, ≤20, clave [A-Za-z0-9_]);
--                 los nodos las leen como {{vars.nombre}}.
--
-- Degradación con gracia: mientras esta migración NO esté aplicada,
-- insertFlow/updateFlow de flows-core reintentan sin estas columnas —
-- guardar un flow jamás se rompe por la migración pendiente.
--
-- Idempotente: se puede re-ejecutar sin error.
-- ============================================================================

ALTER TABLE flows ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]';
ALTER TABLE flows ADD COLUMN IF NOT EXISTS versions jsonb NOT NULL DEFAULT '[]';
ALTER TABLE flows ADD COLUMN IF NOT EXISTS vars jsonb NOT NULL DEFAULT '{}';
