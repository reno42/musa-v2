-- REQ-082 — Zero-person final: budget caps por key + inbox unificado
-- multi-cliente + clientes de intranet. Aditivo e idempotente.

-- ═══ 1. Budget caps por key (el metering frena al agente) ═══
-- monthly_cap = NULL → sin cap (comportamiento actual).
ALTER TABLE public.workspace_api_keys
  ADD COLUMN IF NOT EXISTS monthly_cap INTEGER;

-- platform_config ya existe (agent_batch_last_day la usa desde REQ-080).
-- No toca datos: columna nueva NULL por defecto.

-- ═══ 2. Inbox unificado multi-cliente ═══
-- Conversaciones (DM/comments) de TODAS las cuentas conectadas del
-- workspace. tenant_key aísla por cliente: brand_id NULL = marca propia.
CREATE TABLE IF NOT EXISTS public.inbox_conversations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  brand_id TEXT,
  account_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'dm',              -- dm | comment
  external_id TEXT NOT NULL,                    -- thread id de la red
  participant_name TEXT,
  participant_handle TEXT,
  avatar_url TEXT,
  status TEXT NOT NULL DEFAULT 'open',          -- open | waiting | closed
  assigned_key_id TEXT,                         -- agente asignado (fdr_ws_ key)
  personality_id TEXT,                          -- personalidad de respuesta
  last_message_at TIMESTAMPTZ,
  last_message_preview TEXT,
  unread INTEGER NOT NULL DEFAULT 0,
  options JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_inbox_conv_ws ON public.inbox_conversations(workspace_id, status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbox_conv_brand ON public.inbox_conversations(workspace_id, brand_id);
CREATE INDEX IF NOT EXISTS idx_inbox_conv_acct ON public.inbox_conversations(account_id);

CREATE TABLE IF NOT EXISTS public.inbox_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES public.inbox_conversations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  direction TEXT NOT NULL,                      -- in | out
  body TEXT NOT NULL,
  author_kind TEXT NOT NULL DEFAULT 'customer', -- customer | agent | human
  author_name TEXT,
  external_id TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inbox_msg_conv ON public.inbox_messages(conversation_id, sent_at);

-- ═══ 3. Personalidades de respuesta (por marca, nunca mezcladas) ═══
CREATE TABLE IF NOT EXISTS public.inbox_personalities (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  brand_id TEXT,
  name TEXT NOT NULL,
  tone TEXT NOT NULL DEFAULT 'cercano',         -- cercano|formal|divertido|tecnico|custom
  language TEXT NOT NULL DEFAULT 'es',
  system_prompt TEXT NOT NULL,                  -- como escribe ESTA marca
  greeting TEXT,
  escalation_note TEXT,                         -- cuando pasar a humano
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inbox_pers_ws ON public.inbox_personalities(workspace_id);

-- ═══ 4. Clientes de intranet (acceso aislado por marca) ═══
-- NO son usuarios Supabase: login por email+PIN dentro del workspace del
-- operador. Ven SOLO su brand_id: piezas, aprobaciones, inbox de su marca.
CREATE TABLE IF NOT EXISTS public.intranet_clients (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  brand_id TEXT NOT NULL,
  email TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'active',        -- active | disabled
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_intranet_clients ON public.intranet_clients(workspace_id, email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_intranet_clients_uniq ON public.intranet_clients(workspace_id, brand_id, email);

-- ═══ RLS (defense-in-depth; el worker usa service role que la bypasea) ═══
ALTER TABLE public.inbox_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbox_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbox_personalities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intranet_clients ENABLE ROW LEVEL SECURITY;
