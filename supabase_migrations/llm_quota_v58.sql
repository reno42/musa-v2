-- ═══════════════════════════════════════════════════════════════════
-- v58 — llm_quota_usage: cuota freemium de la capa plataforma (REQ-028 Item 2)
-- ═══════════════════════════════════════════════════════════════════
-- El Ghost funciona sin llave del usuario usando la IA del server
-- (ZHIPU/OPENROUTER env). La capa plataforma cobra 1 unidad POR RUN (job
-- aceptado por el gate de ghost_perform), no por microacción interna; un run
-- abortado a la mitad NO se devuelve (documentado en el req §2-Item 2.4).
--
-- Ventana rodante mensual: 1ero del mes UTC (date_trunc('month', now())).
-- Un run en el mes viejo no arrastra llamadas al mes nuevo: al cambiar la
-- ventana, el upsert reinicia platform_calls con el nuevo window_start.
--
-- ATOMICIDAD (req §2-Item 2.2): consume_llm_quota hace el upsert + el
-- incremento + el RETURNING en UNA sola sentencia (insert .. on conflict do
-- update .. returning). Nada de select-then-update: 2 claims simultáneos del
-- último run disponible ⇒ exactamente 1 gana (el otro lee used > limit y es
-- rechazado con FREEMIUM_QUOTA_EXHAUSTED, cero job creado).
--
-- FAIL-CLOSED (req §2-Item 2.5): si la tabla/rpc no responde, el gate y el
-- proxy RECHAZAN la capa plataforma con un mensaje técnico distinto — un
-- error de DB nunca regala cuota infinita.
--
-- RLS: habilitado SIN políticas — la tabla solo la toca el service role
-- (gate MCP + proxy /api/llm). El usuario NUNCA lee su cuota por PostgREST:
-- la ve por el header X-Musa-Quota-Remaining del proxy. Idempotente: seguro
-- de re-correr (IF NOT EXISTS / CREATE OR REPLACE).
--
-- ── Observabilidad (REQ-028 Item 3 — queries documentadas) ──────────────
-- Consumo platform por usuario y por mes (corriente):
--   select user_id, platform_calls, window_start
--   from llm_quota_usage
--   where window_start = date_trunc('month', now())
--   order by platform_calls desc;
--
-- Usuarios que tocaron el techo (target de conversión BYOK):
--   select user_id, platform_calls
--   from llm_quota_usage
--   where window_start = date_trunc('month', now())
--     and platform_calls >= 30;  -- = PLATFORM_FREE_GHOST_RUNS vigente
--
-- Costo por tier (trace de ghost_jobs, REQ-028 Item 1.4 — runs por capa):
--   select tier, count(*) as runs
--   from (
--     select jsonb_array_elements(result->'trace')->>'tier' as tier
--     from ghost_jobs
--     where result ? 'trace'
--   ) t
--   where tier is not null
--   group by tier;
--
-- ── ROLLBACK (documentado, req §6) ──────────────────────────────────────
--   DROP FUNCTION IF EXISTS consume_llm_quota(uuid, integer);
--   DROP TABLE IF EXISTS llm_quota_usage;
-- (Sin datos históricos irrecuperables: platform_calls se puede reconstruir
--  desde el trace de ghost_jobs con la query de tier de arriba.)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS llm_quota_usage (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  window_start TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', now()),
  platform_calls INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS llm_quota_usage_window_idx
  ON llm_quota_usage (window_start, platform_calls DESC);

ALTER TABLE llm_quota_usage ENABLE ROW LEVEL SECURITY;

-- El upsert atómico: ventana vieja ⇒ reset; ventana actual ⇒ +cost.
-- RETURNS TABLE con nombres out_* para no chocar con las columnas de la tabla.
CREATE OR REPLACE FUNCTION consume_llm_quota(p_user_id UUID, p_cost INTEGER DEFAULT 1)
RETURNS TABLE (out_calls INTEGER, out_window TIMESTAMPTZ)
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO llm_quota_usage AS q (user_id, window_start, platform_calls)
  VALUES (p_user_id, date_trunc('month', now()), GREATEST(p_cost, 1))
  ON CONFLICT (user_id) DO UPDATE SET
    platform_calls = CASE
      WHEN q.window_start = date_trunc('month', now()) THEN q.platform_calls + GREATEST(p_cost, 1)
      ELSE GREATEST(p_cost, 1)
    END,
    window_start = date_trunc('month', now()),
    updated_at = now()
  RETURNING q.platform_calls, q.window_start INTO out_calls, out_window;
  RETURN NEXT;
END;
$$;

COMMENT ON TABLE llm_quota_usage IS
  'REQ-028: cuota freemium de la capa plataforma del Ghost. 1 unidad por run aceptado (no por microacción). Ventana mensual UTC. Solo service role (RLS sin políticas): el usuario la ve por X-Musa-Quota-Remaining.';
COMMENT ON FUNCTION consume_llm_quota(UUID, INTEGER) IS
  'REQ-028 Item 2.2: consume cuota en UNA sentencia atómica (insert..on conflict..returning). 2 claims simultáneos del último run ⇒ 1 ganador.';
