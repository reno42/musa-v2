-- ══════════════════════════════════════════════════════════════
-- chatfab_decisions — log estructurado de decisiones del ChatFAB
-- Propósito: dataset para el router (portero v0 → v1 ONNX).
-- Cada interacción del chat inserta una fila:
--   mensaje → veredicto del router → tool usada → resultado.
-- v0: router_verdict = 'llm' siempre (todo escala); la fila mide
-- lo que DESPUÉS será decisión del portero.
-- ══════════════════════════════════════════════════════════════

create table if not exists public.chatfab_decisions (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  session_id    text,
  user_ref      text,
  message       text not null,
  router_verdict text not null default 'llm'
                check (router_verdict in ('direct','llm','uncertain')),
  router_rule   text,
  tool_used     text,
  resolved_by   text check (resolved_by in ('heuristic','llm','user')),
  latency_ms    int,
  llm_tokens    int,
  outcome       text check (outcome in ('ok','corrected','failed')),
  notes         text
);

create index if not exists idx_chatfab_decisions_created
  on public.chatfab_decisions (created_at desc);
create index if not exists idx_chatfab_decisions_verdict
  on public.chatfab_decisions (router_verdict);

-- Privado: solo service_role (el backend) lee/escribe.
alter table public.chatfab_decisions enable row level security;
