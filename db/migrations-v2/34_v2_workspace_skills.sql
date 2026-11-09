-- 34_v2_workspace_skills.sql — skills propias de cada espacio, hechas desde un flujograma
--
-- Dos tipos de skills en Musa:
--   · Las de la PLATAFORMA: fijas, públicas para todos, viven en el repo (.agents/skills) y no están en esta tabla.
--   · Las del ESPACIO (esta tabla): las crea una persona desde un flujograma (constructor visual o Mermaid) y el
--     conversor determinista (public/musa/skillflow.js, sin IA) genera la skill con el qué, el cómo y las
--     herramientas de Musa de cada paso.
-- Visibilidad: 'private' (solo quien la creó) o 'workspace' (todo el equipo del espacio). Nunca los clientes
-- de una agencia: los invitados no son miembros del espacio, así que has_workspace_role no los deja ver nada.
-- Se mueven entre espacios como el resto (tipo «skill» en el motor de la migración 32).
-- Idempotente.

create table if not exists public.workspace_skills (
  id text primary key default ('skl_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20)),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  name text not null,
  slug text not null,
  description text not null default '',
  meta jsonb not null default '{}'::jsonb,        -- name, when, goal, inputs, outputs, rules
  graph jsonb not null default '{}'::jsonb,       -- nodos (qué/cómo/herramienta/posición) y flechas
  mermaid text not null default '',              -- fuente compatible con Mermaid (con anotaciones %% @…)
  markdown text not null default '',             -- la skill generada (lo que lee la IA)
  steps jsonb not null default '[]'::jsonb,       -- pasos numerados para seguir sin ambigüedad
  tools text[] not null default '{}',             -- herramientas de Musa que usa, en orden
  issues jsonb not null default '[]'::jsonb,      -- validación al guardar (errores y avisos)
  visibility text not null default 'private' check (visibility in ('private', 'workspace')),
  version integer not null default 1,
  fingerprint text not null default '',
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index if not exists workspace_skills_ws_slug on public.workspace_skills (workspace_id, slug) where deleted_at is null;
create index if not exists workspace_skills_ws on public.workspace_skills (workspace_id, updated_at desc) where deleted_at is null;

-- versión: sube sola cuando cambia el contenido; updated_at siempre
create or replace function public.v2_workspace_skills_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    if new.fingerprint is distinct from old.fingerprint or new.markdown is distinct from old.markdown then
      new.version := coalesce(old.version, 1) + 1;
    else
      new.version := old.version;
    end if;
    -- al cambiar de espacio, si el nombre corto ya existe allá, se le agrega un sufijo
    if new.workspace_id is distinct from old.workspace_id and exists (
      select 1 from public.workspace_skills z where z.workspace_id = new.workspace_id and z.slug = new.slug and z.deleted_at is null and z.id <> new.id) then
      new.slug := new.slug || '-' || substr(md5(new.id), 1, 4);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_workspace_skills_touch on public.workspace_skills;
create trigger trg_workspace_skills_touch before insert or update on public.workspace_skills
  for each row execute function public.v2_workspace_skills_touch();

alter table public.workspace_skills enable row level security;
drop policy if exists workspace_skills_read on public.workspace_skills;
create policy workspace_skills_read on public.workspace_skills for select
  using (deleted_at is null and has_workspace_role(workspace_id, 'viewer') and (visibility = 'workspace' or created_by = auth.uid()));
drop policy if exists workspace_skills_insert on public.workspace_skills;
create policy workspace_skills_insert on public.workspace_skills for insert
  with check (has_workspace_role(workspace_id, 'editor') and created_by = auth.uid());
drop policy if exists workspace_skills_update on public.workspace_skills;
create policy workspace_skills_update on public.workspace_skills for update
  using (has_workspace_role(workspace_id, 'editor') and (created_by = auth.uid() or visibility = 'workspace'))
  with check (has_workspace_role(workspace_id, 'editor') and (created_by = auth.uid() or visibility = 'workspace'));
drop policy if exists workspace_skills_delete on public.workspace_skills;
create policy workspace_skills_delete on public.workspace_skills for delete
  using (created_by = auth.uid() or has_workspace_role(workspace_id, 'admin'));
grant select, insert, update, delete on public.workspace_skills to authenticated;

-- el motor de mover (migración 32) conoce el tipo «skill»
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
      when 'workspace_skills' then 'name'
      else 'id::text' end, p_t) into v using p_id;
  return v;
exception when others then return null;
end $$;
revoke all on function public.v2__move_label(text, text) from public, anon, authenticated;
