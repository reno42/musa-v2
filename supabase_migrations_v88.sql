-- REQ-078 — Metering por key (usage por agente/conexión).
-- Complementa workspace_usage (v27, cuota mensual por espacio): aquí el
-- desglose POR KEY (fdr_ws_…, cada agente o conexión) con desglose de métodos.
-- Idempotente; RLS habilitado (el service role del worker es quien escribe).

CREATE TABLE IF NOT EXISTS key_usage_monthly (
  key_id         TEXT NOT NULL,             -- id de la fila en user_api_keys (no el secreto)
  workspace_id   TEXT NOT NULL,
  month          TEXT NOT NULL,             -- 'YYYY-MM' (UTC)
  mcp_calls      BIGINT NOT NULL DEFAULT 0,
  methods        JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {"create_html_frame": 12, "render_frame_png": 4}
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (key_id, month)
);
CREATE INDEX IF NOT EXISTS idx_key_usage_ws_month ON key_usage_monthly (workspace_id, month);
ALTER TABLE key_usage_monthly ENABLE ROW LEVEL SECURITY;

-- Incremento atómico (1 roundtrip): +1 llamada y +1 en el método dado.
CREATE OR REPLACE FUNCTION increment_key_usage(
  p_key_id TEXT,
  p_workspace_id TEXT,
  p_method TEXT,
  p_month TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO key_usage_monthly (key_id, workspace_id, month, mcp_calls, methods)
  VALUES (p_key_id, p_workspace_id, p_month, 1, jsonb_build_object(p_method, 1))
  ON CONFLICT (key_id, month)
  DO UPDATE SET
    mcp_calls = key_usage_monthly.mcp_calls + 1,
    methods = jsonb_set(
      key_usage_monthly.methods,
      ARRAY[p_method],
      (COALESCE(key_usage_monthly.methods->>p_method, '0')::bigint + 1)::text::jsonb,
      true
    ),
    updated_at = now();
END;
$$;

-- Vista de resumen: joins con workspace_api_keys (tabla de las fdr_ws_) para label/role.
-- Cast k.id::text (uuid→text, nunca falla) porque key_usage_monthly.key_id es TEXT.
CREATE OR REPLACE VIEW key_usage_summary AS
SELECT k.workspace_id, k.id AS key_id, k.label, k.role,
       u.month, u.mcp_calls, u.methods, u.updated_at
FROM key_usage_monthly u
JOIN workspace_api_keys k ON k.id::text = u.key_id;
