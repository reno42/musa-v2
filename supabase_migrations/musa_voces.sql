-- REQ-071 — Módulo de Voces: librería de voces + cuota de uso diario
-- Idempotente. Pegar en el SQL Editor (proyecto MusaTest y/o producción).
-- El worker detecta la migración sola (feature-detect): mientras no exista,
-- stock TTS funciona igual y la librería responde 503 MIGRATION_PENDING.

create table if not exists musa_voces (
  id text primary key,
  workspace_id text not null,
  user_id text not null,
  nombre text not null,
  tipo text not null default 'stock' check (tipo in ('stock','clon','elevenlabs')),
  proveedor text not null default 'workers-ai',
  voice_ref jsonb not null default '{}'::jsonb,
  idiomas text[] not null default array['es']::text[],
  params jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists musa_voces_workspace_idx on musa_voces (workspace_id);
create index if not exists musa_voces_user_idx on musa_voces (user_id);

create table if not exists musa_voz_uso (
  user_id text not null,
  dia text not null,
  chars bigint not null default 0,
  primary key (user_id, dia)
);

-- Incremento atómico del contador diario de chars
create or replace function musa_voz_uso_incrementa(p_user text, p_dia text, p_chars bigint)
returns void language sql as $$
  insert into musa_voz_uso (user_id, dia, chars) values (p_user, p_dia, p_chars)
  on conflict (user_id, dia) do update set chars = musa_voz_uso.chars + excluded.chars;
$$;

-- ── RLS musa_voces (patrón has_workspace_role, copiado de content_calendar) ──
alter table musa_voces enable row level security;

drop policy if exists musa_voces_select on musa_voces;
create policy musa_voces_select on musa_voces
for select to authenticated
using (has_workspace_role(workspace_id, 'viewer'));

drop policy if exists musa_voces_insert on musa_voces;
create policy musa_voces_insert on musa_voces
for insert to authenticated
with check (has_workspace_role(workspace_id, 'editor'));

drop policy if exists musa_voces_update on musa_voces;
create policy musa_voces_update on musa_voces
for update to authenticated
using (has_workspace_role(workspace_id, 'editor'))
with check (has_workspace_role(workspace_id, 'editor'));

drop policy if exists musa_voces_delete on musa_voces;
create policy musa_voces_delete on musa_voces
for delete to authenticated
using (user_id = auth.uid()::text or has_workspace_role(workspace_id, 'admin'));

grant select, insert, update, delete on musa_voces to authenticated;
grant select on musa_voces to anon;

-- musa_voz_uso: SIN políticas ni grants para usuarios — solo el worker
-- (secret key, bypassa RLS) lee/escribe la cuota.
alter table musa_voz_uso enable row level security;
