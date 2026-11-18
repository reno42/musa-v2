-- 45_v2_clones_musa.sql — REQ-072: clones propios de Musa (motor gratis en Oracle A1).
-- Aplicar SOLO en la base de musa-v2 (lnbsmnbvclxrwwcuuvud). Idempotente.

-- 1) workspace_clones: nuevo proveedor 'musa' + datos del motor propio
alter table public.workspace_clones drop constraint if exists workspace_clones_provider_check;
alter table public.workspace_clones add constraint workspace_clones_provider_check
  check (provider is null or provider in ('elevenlabs', 'heygen', 'musa'));
alter table public.workspace_clones
  add column if not exists engine text,                 -- 'ditto' (foto/cuadro) | 'musetalk' (fase 5)
  add column if not exists source_kind text,            -- 'take' | 'photo'
  add column if not exists source_key text,             -- R2 musa-voz: clones/<ws>/<clon>/source.*
  add column if not exists portrait_key text,           -- R2: retrato 512 elegido por el motor
  add column if not exists voice_id text,               -- voz de Musa Voz creada desde la toma (musa_voces.id)
  add column if not exists consent_text text,
  add column if not exists consent_at timestamptz,
  add column if not exists meta jsonb not null default '{}'::jsonb;

-- 2) Cola de trabajos del motor (la escribe solo el servidor)
create table if not exists public.musa_clon_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  clone_id uuid not null references public.workspace_clones(id) on delete cascade,
  kind text not null check (kind in ('prepare', 'render')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'error', 'cancelled')),
  progress integer not null default 0 check (progress between 0 and 100),
  title text,
  script text,
  aspect text not null default '9:16' check (aspect in ('9:16', '1:1', '16:9')),
  voice jsonb not null default '{}'::jsonb,
  audio_key text,
  output_key text,
  poster_key text,
  seconds numeric,
  error text,
  attempts integer not null default 0,
  worker text,
  heartbeat_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists idx_musa_clon_jobs_cola on public.musa_clon_jobs (created_at) where status in ('queued', 'running');
create index if not exists idx_musa_clon_jobs_ws on public.musa_clon_jobs (workspace_id, created_at desc);
create index if not exists idx_musa_clon_jobs_clon on public.musa_clon_jobs (clone_id, created_at desc);
alter table public.musa_clon_jobs enable row level security;
drop policy if exists musa_clon_jobs_read on public.musa_clon_jobs;
create policy musa_clon_jobs_read on public.musa_clon_jobs for select using (has_workspace_role(workspace_id, 'viewer'));

-- 3) Cuota justa del motor gratis: segundos de video por espacio y día
create table if not exists public.musa_clon_uso (
  workspace_id text not null references public.workspaces(id) on delete cascade,
  dia date not null,
  segundos numeric not null default 0,
  primary key (workspace_id, dia)
);
alter table public.musa_clon_uso enable row level security;
drop policy if exists musa_clon_uso_read on public.musa_clon_uso;
create policy musa_clon_uso_read on public.musa_clon_uso for select using (has_workspace_role(workspace_id, 'viewer'));

-- 4) Latido del motor (para mostrar si está encendido)
create table if not exists public.musa_clon_motor (
  worker text primary key,
  last_seen timestamptz not null default now(),
  info jsonb not null default '{}'::jsonb
);
alter table public.musa_clon_motor enable row level security;

-- 5) Tomar el siguiente trabajo (SKIP LOCKED) y reencolar los que perdieron latido
create or replace function public.musa_clon_claim(p_worker text, p_info jsonb default '{}'::jsonb)
returns setof public.musa_clon_jobs
language plpgsql security definer set search_path = public as $$
declare j public.musa_clon_jobs;
begin
  insert into public.musa_clon_motor (worker, last_seen, info) values (p_worker, now(), coalesce(p_info, '{}'::jsonb))
    on conflict (worker) do update set last_seen = now(), info = excluded.info;

  update public.musa_clon_jobs
     set status = case when attempts >= 3 then 'error' else 'queued' end,
         error = case when attempts >= 3 then 'El motor dejó de responder 3 veces con este trabajo.' else error end,
         worker = null
   where status = 'running' and coalesce(heartbeat_at, started_at) < now() - interval '10 minutes';

  select * into j from public.musa_clon_jobs
   where status = 'queued'
   order by (kind = 'prepare') desc, created_at
   limit 1
   for update skip locked;
  if not found then return; end if;

  update public.musa_clon_jobs
     set status = 'running', worker = p_worker, attempts = attempts + 1,
         started_at = now(), heartbeat_at = now(), progress = 0, error = null
   where id = j.id
   returning * into j;
  return next j;
end $$;
revoke all on function public.musa_clon_claim(text, jsonb) from public, anon, authenticated;
grant execute on function public.musa_clon_claim(text, jsonb) to service_role;

create or replace function public.musa_clon_uso_suma(p_ws text, p_dia date, p_seg numeric)
returns numeric language sql security definer set search_path = public as $$
  insert into public.musa_clon_uso (workspace_id, dia, segundos) values (p_ws, p_dia, greatest(p_seg, 0))
  on conflict (workspace_id, dia) do update set segundos = public.musa_clon_uso.segundos + greatest(excluded.segundos, 0)
  returning segundos;
$$;
revoke all on function public.musa_clon_uso_suma(text, date, numeric) from public, anon, authenticated;
grant execute on function public.musa_clon_uso_suma(text, date, numeric) to service_role;
