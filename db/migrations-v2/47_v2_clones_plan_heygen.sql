-- 47_v2_clones_plan_heygen.sql — REQ-072 (decisión 2026-11-17):
--   · Clones propios de Musa: solo plan Empresa (más admins y cuentas corporativas).
--   · HeyGen con la llave de cada persona: el video lo genera HeyGen y Musa lo importa a su editor.
-- Aplicar SOLO en lnbs (musa-v2). Idempotente.

alter table public.musa_clon_jobs add column if not exists provider text not null default 'musa';
alter table public.musa_clon_jobs drop constraint if exists musa_clon_jobs_provider_check;
alter table public.musa_clon_jobs add constraint musa_clon_jobs_provider_check check (provider in ('musa', 'heygen'));
alter table public.musa_clon_jobs add column if not exists external_id text;   -- id del video en HeyGen
create index if not exists idx_musa_clon_jobs_heygen on public.musa_clon_jobs (status) where provider = 'heygen';

-- ¿El espacio puede usar los clones propios de Musa? (plan del dueño)
create or replace function public.musa_clon_habilitado(p_ws text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare owner_txt text; owner_uuid uuid; ent jsonb; correo text; admins jsonb; plan_acceso text;
begin
  select owner_id into owner_txt from public.workspaces where id = p_ws;
  if owner_txt is null or owner_txt !~* '^[0-9a-f-]{36}$' then return false; end if;
  owner_uuid := owner_txt::uuid;
  ent := public.v2_entitlements(owner_uuid);
  if ent->>'tier' = 'empresa' then return true; end if;
  select access_plan into plan_acceso from public.user_profiles where id = owner_uuid;
  if plan_acceso = 'corporate' then return true; end if;
  select lower(email) into correo from auth.users where id = owner_uuid;
  select value->'admins' into admins from public.platform_config where key = 'launch';
  return coalesce(admins ? correo, false);
end $$;
revoke all on function public.musa_clon_habilitado(text) from public, anon, authenticated;
grant execute on function public.musa_clon_habilitado(text) to service_role;

-- El motor de Musa solo toma trabajos propios (los de HeyGen los procesa HeyGen)
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
   where provider = 'musa' and status = 'running' and coalesce(heartbeat_at, started_at) < now() - interval '10 minutes';

  select * into j from public.musa_clon_jobs
   where provider = 'musa' and status = 'queued'
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
