-- ═══════════════════════════════════════════════════════════════
-- FUTURARIA v25 — Kanban card detail enrichment
--
-- Every card in the Studio Board now carries provenance (who or what
-- created it), content classification (ad vs organic), and cumulative
-- cost tracking so the user can see at a glance how much agent time,
-- how many tokens, and what dollar cost went into any task.
--
-- A deterministic pricing table (ai_model_pricing) is seeded so the
-- system can calculate cost from model + tokens without ever hitting
-- the internet. Per-agent contributions are tracked in
-- design_kanban_agent_time and summed into the card totals.
--
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. New columns on design_kanban_tasks ──
ALTER TABLE design_kanban_tasks
  ADD COLUMN IF NOT EXISTS source TEXT;

COMMENT ON COLUMN design_kanban_tasks.source IS
  'mcp | chat_internal | human — provenance of this task';

ALTER TABLE design_kanban_tasks
  ADD COLUMN IF NOT EXISTS ai_model TEXT;

COMMENT ON COLUMN design_kanban_tasks.ai_model IS
  'AI model that worked on this task (e.g. claude-sonnet-4, gpt-4o). NULL if human-only.';

ALTER TABLE design_kanban_tasks
  ADD COLUMN IF NOT EXISTS content_type TEXT DEFAULT 'organico';

COMMENT ON COLUMN design_kanban_tasks.content_type IS
  'ad | organico — paid advertisement or organic content';

ALTER TABLE design_kanban_tasks
  ADD COLUMN IF NOT EXISTS total_agent_time_ms BIGINT DEFAULT 0;

COMMENT ON COLUMN design_kanban_tasks.total_agent_time_ms IS
  'Cumulative agent time in milliseconds, summed from design_kanban_agent_time';

ALTER TABLE design_kanban_tasks
  ADD COLUMN IF NOT EXISTS total_tokens BIGINT DEFAULT 0;

COMMENT ON COLUMN design_kanban_tasks.total_tokens IS
  'Total tokens consumed across all agent sessions for this task';

ALTER TABLE design_kanban_tasks
  ADD COLUMN IF NOT EXISTS total_cost_cents BIGINT DEFAULT 0;

COMMENT ON COLUMN design_kanban_tasks.total_cost_cents IS
  'Total cost in cents (USD), calculated from ai_model_pricing × tokens';

-- ── 2. AI model pricing table ──
CREATE TABLE IF NOT EXISTS ai_model_pricing (
  id                       TEXT PRIMARY KEY,
  model_name               TEXT NOT NULL UNIQUE,
  provider                 TEXT NOT NULL,
  input_price_per_1m       NUMERIC NOT NULL,
  output_price_per_1m      NUMERIC NOT NULL,
  notes                    TEXT,
  created_at               TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE ai_model_pricing IS
  'Deterministic lookup: model name → per-1M-token prices. Seeded once, updated manually when prices change.';

-- Seed: 12 models covering all providers the platform uses.
-- Prices as of Aug 2026. Run is idempotent (ON CONFLICT DO NOTHING).
INSERT INTO ai_model_pricing (id, model_name, provider, input_price_per_1m, output_price_per_1m, notes) VALUES
  ('amp_claude_sonnet_4',    'claude-sonnet-4',    'anthropic',  3.00,  15.00,  'Claude Sonnet 4'),
  ('amp_claude_opus_4',      'claude-opus-4',      'anthropic', 15.00,  75.00,  'Claude Opus 4'),
  ('amp_gpt_4o',             'gpt-4o',             'openai',     2.50,  10.00,  'GPT-4o'),
  ('amp_gpt_4o_mini',        'gpt-4o-mini',        'openai',     0.15,   0.60,  'GPT-4o mini'),
  ('amp_o4_mini',            'o4-mini',            'openai',     1.10,   4.40,  'o4-mini'),
  ('amp_gemini_25_pro',      'gemini-2.5-pro',     'google',     1.25,  10.00,  'Gemini 2.5 Pro'),
  ('amp_gemini_25_flash',    'gemini-2.5-flash',   'google',     0.15,   0.60,  'Gemini 2.5 Flash'),
  ('amp_deepseek_v3',        'deepseek-v3',        'deepseek',   0.27,   1.10,  'DeepSeek V3'),
  ('amp_qoder_default',      'qoder-default',      'qoder',      0.00,   0.00,  'Qoder built-in — no extra token cost'),
  ('amp_hermes_default',     'hermes-default',     'hermes',     0.00,   0.00,  'Hermes local agent — no token cost'),
  ('amp_chat_internal',      'chat-internal',      'internal',   0.00,   0.00,  'Internal chat — no external AI calls'),
  ('amp_unknown',            'unknown',            'unknown',    0.00,   0.00,  'Fallback for unidentified models')
ON CONFLICT (model_name) DO NOTHING;

ALTER TABLE ai_model_pricing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read model pricing" ON ai_model_pricing;
CREATE POLICY "Anyone can read model pricing" ON ai_model_pricing
  FOR SELECT USING (true);

-- ── 3. Per-agent time tracking ──
CREATE TABLE IF NOT EXISTS design_kanban_agent_time (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES design_kanban_tasks(id) ON DELETE CASCADE,
  agent_role    TEXT NOT NULL,
  agent_name    TEXT,
  duration_ms   BIGINT NOT NULL DEFAULT 0,
  tokens_used   BIGINT DEFAULT 0,
  ai_model      TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE design_kanban_agent_time IS
  'Per-agent contribution: one row per agent session. Summed into design_kanban_tasks totals by studio_log_agent_time.';

CREATE INDEX IF NOT EXISTS idx_dkat_task ON design_kanban_agent_time(task_id);

ALTER TABLE design_kanban_agent_time ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read agent time" ON design_kanban_agent_time;
CREATE POLICY "Anyone can read agent time" ON design_kanban_agent_time
  FOR SELECT USING (true);

-- ── 4. Realtime ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'design_kanban_agent_time'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.design_kanban_agent_time;
  END IF;
END $$;
