-- 35_v2_websites.sql — módulo Websites: landings y sitios con CMS propio, SEO/GEO/AEO y dominios
--
-- Un website es del ESPACIO (todo el equipo lo ve y edita según su rol; los clientes de una agencia no,
-- porque no son miembros). Las tablas hijas no llevan workspace_id: heredan los permisos del website,
-- así que mover un website entre espacios (motor de la migración 32, tipo «website») se lleva todo.
--
--   websites            el sitio: tema, ajustes de SEO/IA, y la copia PUBLICADA (published) que sirve el público
--   website_pages       páginas en borrador: secciones (bloques) + SEO por página
--   website_collections colecciones del CMS (blog, productos, casos…) con sus campos
--   website_entries     entradas del CMS: contenido dinámico, se ve en vivo apenas se publica (sin volver a publicar el sitio)
--   website_domains     subdominios y dominios propios (solo los escribe el servidor)
--   website_versions    historial de publicaciones (para volver atrás)
--   website_stats/refs  visitas por día y página / por origen (solo el servidor escribe)
--   website_secrets     llaves de GitHub y Supabase propios, cifradas AES-256-GCM (solo servidor)
-- Límites por plan en v2_site_limits. Idempotente.

create table if not exists public.websites (
  id text primary key default ('web_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20)),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  brand_id text,
  name text not null,
  slug text not null,
  status text not null default 'draft' check (status in ('draft', 'published')),
  theme jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  published jsonb,
  published_at timestamptz,
  published_by uuid,
  version integer not null default 0,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index if not exists websites_slug_u on public.websites (lower(slug)) where deleted_at is null;
create index if not exists websites_ws on public.websites (workspace_id, updated_at desc) where deleted_at is null;

create table if not exists public.website_pages (
  id text primary key default ('wpg_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20)),
  website_id text not null references public.websites(id) on delete cascade,
  path text not null,
  title text not null default '',
  sections jsonb not null default '[]'::jsonb,
  seo jsonb not null default '{}'::jsonb,
  hidden boolean not null default false,
  sort integer not null default 0,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists website_pages_path_u on public.website_pages (website_id, lower(path));

create table if not exists public.website_collections (
  id text primary key default ('wcl_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20)),
  website_id text not null references public.websites(id) on delete cascade,
  name text not null,
  slug text not null,
  fields jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists website_collections_slug_u on public.website_collections (website_id, lower(slug));

create table if not exists public.website_entries (
  id text primary key default ('wen_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20)),
  collection_id text not null references public.website_collections(id) on delete cascade,
  website_id text not null references public.websites(id) on delete cascade,
  slug text not null,
  title text not null default '',
  data jsonb not null default '{}'::jsonb,
  seo jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'published')),
  publish_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists website_entries_slug_u on public.website_entries (collection_id, lower(slug));
create index if not exists website_entries_live on public.website_entries (website_id, collection_id, status, publish_at desc);

create table if not exists public.website_domains (
  id text primary key default ('wdm_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20)),
  website_id text not null references public.websites(id) on delete cascade,
  hostname text not null,
  kind text not null default 'custom' check (kind in ('subdomain', 'custom')),
  status text not null default 'pending' check (status in ('pending', 'verifying', 'active', 'error')),
  is_primary boolean not null default false,
  verify_token text not null default substr(md5(gen_random_uuid()::text), 1, 24),
  cf_id text,
  details jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists website_domains_host_u on public.website_domains (lower(hostname));

create table if not exists public.website_versions (
  id text primary key default ('wvr_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20)),
  website_id text not null references public.websites(id) on delete cascade,
  version integer not null,
  label text not null default '',
  snapshot jsonb not null,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists website_versions_site on public.website_versions (website_id, version desc);

create table if not exists public.website_stats (
  website_id text not null references public.websites(id) on delete cascade,
  day date not null,
  path text not null,
  views integer not null default 0,
  primary key (website_id, day, path)
);
create table if not exists public.website_refs (
  website_id text not null references public.websites(id) on delete cascade,
  day date not null,
  ref text not null,
  views integer not null default 0,
  primary key (website_id, day, ref)
);

create table if not exists public.website_secrets (
  website_id text not null references public.websites(id) on delete cascade,
  provider text not null check (provider in ('github', 'supabase')),
  encrypted text not null,
  meta jsonb not null default '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (website_id, provider)
);

-- ── updated_at ──
create or replace function public.v2_websites_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
do $$ declare t text; begin
  foreach t in array array['websites','website_pages','website_collections','website_entries','website_domains'] loop
    execute format('drop trigger if exists trg_%s_touch on public.%I', t, t);
    execute format('create trigger trg_%s_touch before update on public.%I for each row execute function public.v2_websites_touch()', t, t);
  end loop;
end $$;

-- ── permisos: los hijos heredan el espacio del website ──
create or replace function public.musa_site_ws(p_site text) returns text
language sql stable security definer set search_path = public as $$
  select workspace_id from public.websites where id = p_site and deleted_at is null
$$;
revoke all on function public.musa_site_ws(text) from public, anon;
grant execute on function public.musa_site_ws(text) to authenticated;

alter table public.websites enable row level security;
drop policy if exists websites_read on public.websites;
create policy websites_read on public.websites for select using (deleted_at is null and has_workspace_role(workspace_id, 'viewer'));
drop policy if exists websites_insert on public.websites;
create policy websites_insert on public.websites for insert with check (has_workspace_role(workspace_id, 'editor') and created_by = auth.uid());
drop policy if exists websites_update on public.websites;
create policy websites_update on public.websites for update using (has_workspace_role(workspace_id, 'editor')) with check (has_workspace_role(workspace_id, 'editor'));
drop policy if exists websites_delete on public.websites;
create policy websites_delete on public.websites for delete using (has_workspace_role(workspace_id, 'admin') or created_by = auth.uid());
grant select, insert, delete on public.websites to authenticated;
-- la copia publicada y el estado de publicación solo los escribe el servidor (publish_website):
-- la persona solo puede cambiar estas columnas
revoke update on public.websites from authenticated;
grant update (brand_id, name, slug, theme, settings, updated_by, deleted_at) on public.websites to authenticated;

do $$ declare t text; begin
  foreach t in array array['website_pages','website_collections','website_entries'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %s_read on public.%I', t, t);
    execute format('create policy %s_read on public.%I for select using (has_workspace_role(public.musa_site_ws(website_id), ''viewer''))', t, t);
    execute format('drop policy if exists %s_write on public.%I', t, t);
    execute format('create policy %s_write on public.%I for all using (has_workspace_role(public.musa_site_ws(website_id), ''editor'')) with check (has_workspace_role(public.musa_site_ws(website_id), ''editor''))', t, t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
  foreach t in array array['website_domains','website_versions','website_stats','website_refs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %s_read on public.%I', t, t);
    execute format('create policy %s_read on public.%I for select using (has_workspace_role(public.musa_site_ws(website_id), ''viewer''))', t, t);
    execute format('revoke insert, update, delete on public.%I from authenticated, anon', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
alter table public.website_secrets enable row level security;
revoke all on public.website_secrets from authenticated, anon;

-- una entrada siempre pertenece al website de su colección
create or replace function public.v2_website_entries_site() returns trigger language plpgsql as $$
begin
  select website_id into new.website_id from public.website_collections where id = new.collection_id;
  if new.website_id is null then raise exception 'Colección inexistente' using errcode = '23503'; end if;
  return new;
end $$;
drop trigger if exists trg_website_entries_site on public.website_entries;
create trigger trg_website_entries_site before insert or update of collection_id on public.website_entries
  for each row execute function public.v2_website_entries_site();

-- ── límites por plan ──
create or replace function public.v2_site_limits(p_workspace text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare owner text; e jsonb; tier text;
begin
  select owner_id into owner from workspaces where id = p_workspace;
  if owner is null or owner !~ '^[0-9a-f-]{36}$' then return jsonb_build_object('tier', 'gratis', 'sites', 1, 'pages', 5, 'entries', 50, 'custom_domains', 0, 'badge', true); end if;
  e := v2_entitlements(owner::uuid);
  tier := coalesce(e->>'tier', 'gratis');
  return case tier
    when 'gratis' then jsonb_build_object('tier', tier, 'sites', 1, 'pages', 5, 'entries', 50, 'custom_domains', 0, 'badge', true)
    when 'creador' then jsonb_build_object('tier', tier, 'sites', 3, 'pages', 50, 'entries', null, 'custom_domains', 1, 'badge', false)
    when 'agencia' then jsonb_build_object('tier', tier, 'sites', 25, 'pages', 100, 'entries', null, 'custom_domains', 25, 'badge', false)
    else jsonb_build_object('tier', tier, 'sites', null, 'pages', null, 'entries', null, 'custom_domains', null, 'badge', false) end;
end $$;
revoke all on function public.v2_site_limits(text) from public, anon;
grant execute on function public.v2_site_limits(text) to authenticated;

create or replace function public.v2_guard_site_limits() returns trigger language plpgsql security definer set search_path = public as $$
declare lim jsonb; n int; owner text; ws text;
begin
  if coalesce(current_setting('musa.trusted', true), '') = '1' then return new; end if;
  if tg_table_name = 'websites' then
    lim := v2_site_limits(new.workspace_id);
    select owner_id into owner from workspaces where id = new.workspace_id;
    select count(*) into n from websites s join workspaces w on w.id = s.workspace_id where w.owner_id = owner and s.deleted_at is null;
    if (lim->>'sites') is not null and n >= (lim->>'sites')::int then
      raise exception 'LIMIT_SITES: tu plan permite % website(s). Mejora tu plan para crear más.', lim->>'sites';
    end if;
  elsif tg_table_name = 'website_pages' then
    ws := musa_site_ws(new.website_id); lim := v2_site_limits(ws);
    select count(*) into n from website_pages where website_id = new.website_id;
    if (lim->>'pages') is not null and n >= (lim->>'pages')::int then
      raise exception 'LIMIT_PAGES: tu plan permite % páginas por website. Mejora tu plan para agregar más.', lim->>'pages';
    end if;
  elsif tg_table_name = 'website_entries' then
    ws := musa_site_ws(new.website_id); lim := v2_site_limits(ws);
    select count(*) into n from website_entries where website_id = new.website_id;
    if (lim->>'entries') is not null and n >= (lim->>'entries')::int then
      raise exception 'LIMIT_ENTRIES: tu plan permite % entradas de CMS por website. Mejora tu plan para agregar más.', lim->>'entries';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_site_limit on public.websites;
create trigger trg_site_limit before insert on public.websites for each row execute function public.v2_guard_site_limits();
drop trigger if exists trg_site_limit on public.website_pages;
create trigger trg_site_limit before insert on public.website_pages for each row execute function public.v2_guard_site_limits();
drop trigger if exists trg_site_limit on public.website_entries;
create trigger trg_site_limit after insert on public.website_entries for each row execute function public.v2_guard_site_limits();
-- (after insert para entradas: la fila ya cuenta; el límite se compara con > en vez de >=)
create or replace function public.v2_guard_site_entries() returns trigger language plpgsql security definer set search_path = public as $$
declare lim jsonb; n int;
begin
  if coalesce(current_setting('musa.trusted', true), '') = '1' then return new; end if;
  lim := v2_site_limits(musa_site_ws(new.website_id));
  select count(*) into n from website_entries where website_id = new.website_id;
  if (lim->>'entries') is not null and n > (lim->>'entries')::int then
    raise exception 'LIMIT_ENTRIES: tu plan permite % entradas de CMS por website. Mejora tu plan para agregar más.', lim->>'entries';
  end if;
  return new;
end $$;
drop trigger if exists trg_site_limit on public.website_entries;
create trigger trg_site_limit after insert on public.website_entries for each row execute function public.v2_guard_site_entries();

-- ── visitas (solo el servidor) ──
create or replace function public.v2_site_hit(p_site text, p_path text, p_ref text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into website_stats (website_id, day, path, views) values (p_site, current_date, left(coalesce(p_path, '/'), 300), 1)
    on conflict (website_id, day, path) do update set views = website_stats.views + 1;
  if coalesce(p_ref, '') <> '' then
    insert into website_refs (website_id, day, ref, views) values (p_site, current_date, left(p_ref, 200), 1)
      on conflict (website_id, day, ref) do update set views = website_refs.views + 1;
  end if;
end $$;
revoke all on function public.v2_site_hit(text, text, text) from public, anon, authenticated;

-- ── el motor de mover conoce el tipo «website» ──
create or replace function public.v2__move_type_table(p_type text) returns text
language sql immutable as $$
  select case lower(p_type)
    when 'design' then 'templates' when 'template' then 'templates'
    when 'brand' then 'brands'
    when 'piece' then 'content_calendar' when 'content' then 'content_calendar'
    when 'video' then 'musa_video_projects'
    when 'photo' then 'photo_documents'
    when 'composition' then 'photo_compositions'
    when 'asset' then 'assets' when 'file' then 'assets'
    when 'note' then 'brain_notes'
    when 'flow' then 'flows'
    when 'credential' then 'flow_credentials'
    when 'contact' then 'crm_contacts'
    when 'deal' then 'crm_deals'
    when 'quote' then 'crm_quotes'
    when 'task' then 'design_kanban_tasks'
    when 'copy' then 'copy_recipes'
    when 'recipe' then 'recipes'
    when 'brief' then 'briefs'
    when 'campaign' then 'campaigns'
    when 'form' then 'workspace_forms'
    when 'mailing' then 'workspace_mailings'
    when 'event' then 'workspace_events'
    when 'project' then 'workspace_projects'
    when 'research' then 'research_sources'
    when 'playbook' then 'workspace_playbooks'
    when 'script' then 'workspace_take_scripts'
    when 'take' then 'musa_video_takes'
    when 'guideline' then 'brand_guidelines'
    when 'audience' then 'ad_audiences'
    when 'ad' then 'ad_campaigns'
    when 'skill' then 'workspace_skills'
    when 'website' then 'websites' when 'site' then 'websites'
    else null end
$$;
revoke all on function public.v2__move_type_table(text) from public, anon, authenticated;

create or replace function public.v2__move_label(p_t text, p_id text) returns text
language plpgsql stable as $$
declare v text;
begin
  execute format('select %s from public.%I where id::text = $1',
    case p_t
      when 'templates' then 'name' when 'brands' then 'name' when 'content_calendar' then 'topic'
      when 'musa_video_projects' then 'name' when 'photo_documents' then 'source_url' when 'photo_compositions' then 'source_url'
      when 'assets' then 'name' when 'brain_notes' then 'title' when 'flows' then 'name' when 'flow_credentials' then 'name'
      when 'crm_contacts' then 'coalesce(nullif(trim(coalesce(first_name,'''')||'' ''||coalesce(last_name,'''')),''''), email)'
      when 'crm_deals' then 'title' when 'crm_quotes' then 'title' when 'design_kanban_tasks' then 'title'
      when 'copy_recipes' then 'name' when 'recipes' then 'name' when 'briefs' then 'title' when 'campaigns' then 'name'
      when 'workspace_forms' then 'name' when 'workspace_events' then 'name' when 'workspace_projects' then 'name'
      when 'research_sources' then 'name' when 'workspace_playbooks' then 'name' when 'workspace_take_scripts' then 'title'
      when 'brand_guidelines' then 'name' when 'ad_audiences' then 'name' when 'ad_campaigns' then 'name'
      when 'workspace_skills' then 'name' when 'websites' then 'name'
      else 'id::text' end, p_t) into v using p_id;
  return v;
exception when others then return null;
end $$;
revoke all on function public.v2__move_label(text, text) from public, anon, authenticated;
