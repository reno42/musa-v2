-- 23 — Modo freelancer/agencia: visibilidad privado/compartido, invitados por marca e intranet.
-- Modelo de producto acordado con el dueño (2026-11-05): UN workspace, la marca es el eje;
-- el contenido (diseños, videos, tomas, clones, calendario, briefs, eventos, mailing,
-- formularios, automatizaciones, playbooks, agentes, proyectos, notas del cerebro) se comporta
-- como un archivo: visibility = 'shared' | 'private'. El CRM, ads, embudos y loops de growth
-- NO llevan visibilidad: son del negocio, multi-marca, con reportes por marca (brands.is_house
-- marca la marca propia). Los clientes entran como invitados ligados a UNA marca y solo ven
-- lo compartido de esa marca (la intranet es una vista; el refuerzo vive aquí, en RLS).
--
-- Idempotente. Defensiva con tablas v1: si una tabla no existe o ya tiene RLS, no se toca
-- más de lo necesario. Enforcement real en Postgres: el proxy /rest/* del worker reenvía el
-- JWT del usuario, así que estas políticas son la barrera de verdad, no solo la UI.
--
-- ⚠ ANTES DE PRODUCCIÓN: correr primero en la DB de pruebas (lnbsmnbvclxrwwcuuvud) y validar
-- que design.futuraria.com (v1) sigue leyendo templates/content_calendar: para las tablas v1
-- que llegaron sin RLS, aquí se enciende con una política permissiva equivalente al acceso
-- actual por workspace (patrón has_workspace_role), y la capa restrictive agrega la privacidad.
--
-- ROLLBACK (por tabla tocada):
--   drop policy if exists <t>_ag_read, <t>_ag_write, <t>_ag_privacy, <t>_ag_guest_read on <t>;
--   alter table <t> disable row level security;  -- solo si este archivo la encendió
--   alter table <t> drop column if exists visibility, drop column if exists tags,
--                drop column if exists created_by, drop column if exists brand_id;
--   drop table if exists brand_guests, brand_portal, content_comments cascade;
begin;

-- ══ 0. Preflight: has_workspace_role (patrón crm_deals) ══
-- Toda la RLS v2 la usa, pero ninguna migración de este repo la define (se aplicó
-- a mano en las DBs). Si falta aquí, se crea con la semántica estándar del patrón
-- (owner > admin > editor > viewer, security definer para leer membresías desde
-- RLS). Si ya existe, no se toca: create solo si falta.
do $pre$
begin
  if to_regprocedure('public.has_workspace_role(text,text)') is null then
    raise notice 'has_workspace_role(text,text) no existía: creándola con la semántica del patrón crm_deals';
    execute $fn$
      create or replace function public.has_workspace_role(p_ws text, p_role text)
      returns boolean language sql stable security definer set search_path = public as $q$
        select exists (
          select 1 from public.workspace_members m
          where m.workspace_id = p_ws and m.user_id = auth.uid()
            and (
              (p_role = 'viewer' and m.role in ('owner','admin','editor','viewer')) or
              (p_role = 'editor' and m.role in ('owner','admin','editor')) or
              (p_role = 'admin'  and m.role in ('owner','admin'))
            )
        )
      $q$;
    $fn$;
  end if;
end
$pre$;

-- ══ 1. Tablas nuevas ══
create table if not exists public.brand_guests (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  brand_id text not null,
  email text not null,
  user_id uuid,
  status text not null default 'pendiente' check (status in ('pendiente','activo','revocado')),
  invited_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists brand_guests_ws_brand_email on public.brand_guests (workspace_id, brand_id, lower(email));
create index if not exists brand_guests_user on public.brand_guests (user_id);

create table if not exists public.brand_portal (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  brand_id text not null,
  display_name text,
  logo_url text,
  accent_color text,
  welcome_md text,
  sections jsonb not null default '{"resumen":true,"briefs":true,"disenos":true,"calendario":true,"campanas":true,"reportes":true,"notas":true}'::jsonb,
  enabled boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists brand_portal_ws_brand on public.brand_portal (workspace_id, brand_id);

create table if not exists public.content_comments (
  id text primary key default ('cmt_' || encode(gen_random_bytes(9), 'hex')),
  workspace_id text not null,
  entity_type text not null,
  entity_id text not null,
  brand_id text,
  body text not null check (char_length(body) between 1 and 500),
  author_user_id uuid,
  author_name text not null default '',
  author_role text not null default 'member' check (author_role in ('member','client','system')),
  parent_id text references public.content_comments(id) on delete set null,
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_content_comments_entity on public.content_comments (workspace_id, entity_type, entity_id, created_at desc);
create index if not exists idx_content_comments_brand on public.content_comments (workspace_id, brand_id);

grant select, insert, update, delete on public.brand_guests, public.brand_portal, public.content_comments to authenticated;

-- ══ 2. Helper: marcas de las que un usuario es invitado en un workspace ══
-- (después de crear brand_guests: el cuerpo se resuelve contra la tabla)
create or replace function public.musa_guest_brand_ids(p_user uuid, p_ws text)
returns text[] language sql stable as $q$
  select coalesce(array_agg(distinct brand_id) filter (where brand_id is not null), '{}')
  from public.brand_guests
  where user_id = p_user and workspace_id = p_ws and status = 'activo';
$q$;

-- ══ 3. RLS de las tablas nuevas ══
alter table public.brand_guests enable row level security;
drop policy if exists brand_guests_read on public.brand_guests;
create policy brand_guests_read on public.brand_guests for select to public
  using (user_id = auth.uid() or has_workspace_role(workspace_id, 'viewer')
         or coalesce(current_setting('musa.trusted', true), '') = '1');
drop policy if exists brand_guests_admin on public.brand_guests;
create policy brand_guests_admin on public.brand_guests for all to public
  using (has_workspace_role(workspace_id, 'admin') or coalesce(current_setting('musa.trusted', true), '') = '1')
  with check (has_workspace_role(workspace_id, 'admin') or coalesce(current_setting('musa.trusted', true), '') = '1');

alter table public.brand_portal enable row level security;
drop policy if exists brand_portal_read on public.brand_portal;
create policy brand_portal_read on public.brand_portal for select to public
  using (has_workspace_role(workspace_id, 'viewer')
         or (brand_id = any (public.musa_guest_brand_ids(auth.uid(), workspace_id)))
         or coalesce(current_setting('musa.trusted', true), '') = '1');
drop policy if exists brand_portal_admin on public.brand_portal;
create policy brand_portal_admin on public.brand_portal for all to public
  using (has_workspace_role(workspace_id, 'admin') or coalesce(current_setting('musa.trusted', true), '') = '1')
  with check (has_workspace_role(workspace_id, 'admin') or coalesce(current_setting('musa.trusted', true), '') = '1');

alter table public.content_comments enable row level security;
drop policy if exists content_comments_read on public.content_comments;
create policy content_comments_read on public.content_comments for select to public
  using (has_workspace_role(workspace_id, 'viewer')
         or (author_user_id = auth.uid())
         or (brand_id is not null and brand_id = any (public.musa_guest_brand_ids(auth.uid(), workspace_id)))
         or coalesce(current_setting('musa.trusted', true), '') = '1');
drop policy if exists content_comments_member on public.content_comments;
create policy content_comments_member on public.content_comments for insert to public
  with check (has_workspace_role(workspace_id, 'editor')
              or (author_role = 'client' and author_user_id = auth.uid()
                  and brand_id is not null and brand_id = any (public.musa_guest_brand_ids(auth.uid(), workspace_id)))
              or coalesce(current_setting('musa.trusted', true), '') = '1');
drop policy if exists content_comments_resolve on public.content_comments;
create policy content_comments_resolve on public.content_comments for update to public
  using (author_user_id = auth.uid() or has_workspace_role(workspace_id, 'admin')
         or coalesce(current_setting('musa.trusted', true), '') = '1')
  with check (author_user_id = auth.uid() or has_workspace_role(workspace_id, 'admin')
              or coalesce(current_setting('musa.trusted', true), '') = '1');

-- ══ 4. Marca propia del negocio (CRM/ads/embudos/loops/reportes «Mi negocio») ══
alter table public.brands add column if not exists is_house boolean not null default false;

-- ══ 5. Contenido: columnas visibility / tags / created_by (+ brand_id donde falta) ══
-- Lista acordada: todo lo que se comporta «como un archivo». El CRM y ads quedan fuera a propósito.
do $do$
declare t text;
begin
  foreach t in array array[
    'templates','content_calendar','briefs','workspace_events','workspace_mailings',
    'workspace_forms','workspace_clones','workspace_projects','workspace_playbooks',
    'workspace_agents','flows','musa_video_projects','workspace_take_scripts','brain_notes'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I add column if not exists visibility text not null default %L', t, 'shared');
      execute format('alter table public.%I add column if not exists tags text[] not null default %L::text[]', t, '{}');
      execute format('alter table public.%I add column if not exists created_by uuid', t);
    end if;
  end loop;
  -- brand_id explícito donde la marca hoy no existe como columna (invitados solo ven con marca)
  foreach t in array array['workspace_clones','flows','musa_video_projects','workspace_take_scripts'] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I add column if not exists brand_id text', t);
    end if;
  end loop;
end
$do$;

-- ══ 6. RLS del contenido: acceso por workspace + capa restrictive de privacidad + invitados ══
do $do$
declare t text; was_rls boolean;
begin
  foreach t in array array[
    'templates','content_calendar','briefs','workspace_events','workspace_mailings',
    'workspace_forms','workspace_clones','workspace_projects','workspace_playbooks',
    'workspace_agents','flows','musa_video_projects','workspace_take_scripts','brain_notes'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('grant select on public.%I to authenticated', t);
      select coalesce(c.relrowsecurity, false) into was_rls from pg_class c
      where c.oid = to_regclass('public.' || t);
      if not was_rls then
        -- Sin RLS previa (tablas Hermes/v1 sin políticas): encender con acceso de equipo
        -- equivalente al patrón crm_deals; la capa restrictive de abajo agrega la privacidad.
        execute format('alter table public.%I enable row level security', t);
        execute format('drop policy if exists %I on public.%I', t || '_ag_read', t);
        execute format('create policy %I on public.%I for select to public using (has_workspace_role(workspace_id, %L))', t || '_ag_read', t, 'viewer');
        execute format('drop policy if exists %I on public.%I', t || '_ag_write', t);
        execute format('create policy %I on public.%I for all to public using (has_workspace_role(workspace_id, %L)) with check (has_workspace_role(workspace_id, %L))', t || '_ag_write', t, 'editor', 'editor');
      end if;
      -- Capa restrictive: lo privado solo lo ve quien lo creó, un admin, o el servidor confiable.
      -- (restrictive = AND con las permissive existentes; patrón ya usado en 13_v2_cerebro)
      -- created_by::text: en tablas v1 la columna puede existir ya como text (p. ej. flows)
      -- y solo se agrega como uuid donde falta; comparar en text cubre ambos tipos.
      execute format('drop policy if exists %I on public.%I', t || '_ag_privacy', t);
      execute format($p$create policy %I on public.%I as restrictive for select to public using (
        coalesce(visibility, 'shared') = 'shared'
        or created_by::text = auth.uid()::text
        or has_workspace_role(workspace_id, 'admin')
        or coalesce(current_setting('musa.trusted', true), '') = '1'
      )$p$, t || '_ag_privacy', t);
    end if;
  end loop;
end
$do$;

-- Invitados: SOLO lo compartido de SU marca, en las tablas donde la marca es columna (o jsonb).
do $do$
declare r record;
begin
  for r in
    select * from (values
      ('templates',          'data',    '(data->>' || chr(39) || 'brandId' || chr(39) || ')'),
      ('content_calendar',   'brand_id','brand_id'),
      ('briefs',             'brand_id','brand_id'),
      ('workspace_events',   'brand_id','brand_id'),
      ('workspace_projects', 'brand_id','brand_id'),
      ('workspace_mailings', 'content', '(content->>' || chr(39) || 'brand_id' || chr(39) || ')'),
      ('workspace_forms',    'schema',  '(schema->>' || chr(39) || 'brand_id' || chr(39) || ')')
    ) as x(tbl, brand_col, brand_expr)
  loop
    if to_regclass('public.' || r.tbl) is not null
       and exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = r.tbl and column_name = r.brand_col) then
      execute format('drop policy if exists %I on public.%I', r.tbl || '_ag_guest_read', r.tbl);
      execute format($p$create policy %I on public.%I for select to public using (
        coalesce(visibility, 'shared') = 'shared'
        and %s is not null
        and %s = any (public.musa_guest_brand_ids(auth.uid(), workspace_id))
      )$p$, r.tbl || '_ag_guest_read', r.tbl, r.brand_expr, r.brand_expr);
    end if;
  end loop;
  -- Notas del cerebro: la marca vive en entity_type/entity_id (notas de marca, compartidas).
  if to_regclass('public.brain_notes') is not null then
    execute 'drop policy if exists brain_notes_ag_guest_read on public.brain_notes';
    execute $p$create policy brain_notes_ag_guest_read on public.brain_notes for select to public using (
      coalesce(visibility, 'shared') = 'shared'
      and entity_type = 'brand'
      and entity_id = any (public.musa_guest_brand_ids(auth.uid(), workspace_id))
    )$p$;
  end if;
end
$do$;

-- ══ 7. updated_at para las tablas nuevas (mismo trigger que el resto de la UI v2) ══
do $do$
declare t text;
begin
  if to_regprocedure('public.v2_touch_updated_at()') is not null then
    foreach t in array array['brand_guests','brand_portal','content_comments'] loop
      execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
      execute format('create trigger %I before update on public.%I for each row execute function v2_touch_updated_at()', t || '_touch', t);
    end loop;
  end if;
end
$do$;

commit;
