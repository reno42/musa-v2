-- ============================================================================
-- Migración v62 — Flows: blindaje freemium (REQ-027)
--
-- 1. RPC prune_flow_runs: el engine YA la llama tras cada run (best-effort,
--    flows-core.pruneRuns) para acotar el historial por flow — pero no existía
--    en DB, así que el prune era un no-op silencioso y flow_runs crecía sin
--    límite (cuota free de Supabase). Esta migración la instala de verdad.
--    SECURITY DEFINER + search_path fijado (convención Supabase), sin acceso
--    para PUBLIC: solo service_role (el rol que usa el MCP/engine) puede
--    ejecutarla.
-- 2. Índice parcial de flows agendados: metadata de la decisión de producto
--    "sin scheduler server-side" — el server NUNCA barre flows (los horarios
--    los ejecuta la IA del usuario vía flow_due_check + flow_run). Si algún
--    día hay un listado de agendados, este índice ya lo hace barato.
--
-- Idempotente: se puede re-ejecutar sin error.
-- ============================================================================

-- ── RPC de prune (la que el engine ya invoca vía sb.rpc) ───────────────────
CREATE OR REPLACE FUNCTION prune_flow_runs(p_flow_id text, p_keep int DEFAULT 200)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM flow_runs
  WHERE flow_id = p_flow_id
    AND id NOT IN (
      SELECT id FROM flow_runs
      WHERE flow_id = p_flow_id
      ORDER BY started_at DESC, id DESC
      LIMIT LEAST(GREATEST(p_keep, 1), 1000)
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION prune_flow_runs(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prune_flow_runs(text, int) TO service_role;

-- ── Índice parcial de flows agendados (metadata) ──────────────────────────
-- DECISIÓN DE PRODUCTO: el server NO agenda ni barre — la IA del usuario
-- consulta flow_due_check y llama flow_run desde su propio loop. El índice
-- queda como metadata barata por si el futuro trae un listado de agendados.
CREATE INDEX IF NOT EXISTS idx_flows_schedule_enabled
  ON flows (updated_at)
  WHERE enabled AND trigger->>'type' = 'schedule';

-- PostgREST cachea el esquema: sin este notify la RPC no es visible para
-- sb.rpc hasta el próximo reload.
NOTIFY pgrst, 'reload schema';
