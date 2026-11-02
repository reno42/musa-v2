-- Ajustes a las tablas F3 de Hermes para conectarlas a la UI v2 (idempotente).
-- clones: registro propio de clones (lista instantánea, visible para agentes, sin llamar a HeyGen/ElevenLabs cada vez).
-- áreas / aprobaciones / agencias: lo que pide el módulo Organización (planes corporativos).
begin;

alter table public.workspace_clones
  add column if not exists kind text not null default 'voz',
  add column if not exists provider text,
  add column if not exists external_id text,
  add column if not exists brand_id text,
  add column if not exists preview_url text,
  add column if not exists consent boolean not null default false;
alter table public.workspace_clones drop constraint if exists workspace_clones_kind_check;
alter table public.workspace_clones add constraint workspace_clones_kind_check check (kind in ('voz','avatar'));
alter table public.workspace_clones drop constraint if exists workspace_clones_provider_check;
alter table public.workspace_clones add constraint workspace_clones_provider_check check (provider is null or provider in ('elevenlabs','heygen'));
alter table public.workspace_clones drop constraint if exists workspace_clones_status_check;
alter table public.workspace_clones add constraint workspace_clones_status_check check (status in ('entrenando','listo','error'));
create unique index if not exists workspace_clones_ext_key on public.workspace_clones (workspace_id, provider, external_id) where external_id is not null;
create index if not exists idx_workspace_clones_ws on public.workspace_clones (workspace_id, created_at desc);

alter table public.workspace_areas
  add column if not exists description text,
  add column if not exists lead_user_id uuid references auth.users(id) on delete set null,
  add column if not exists validates boolean not null default false,
  add column if not exists brand_ids text[] not null default '{}';
create index if not exists idx_workspace_areas_ws on public.workspace_areas (workspace_id);

alter table public.workspace_approvals
  add column if not exists area_id uuid references public.workspace_areas(id) on delete set null,
  add column if not exists piece_type text not null default 'template',
  add column if not exists checks jsonb not null default '[]'::jsonb,
  add column if not exists comment text,
  add column if not exists decided_by uuid references auth.users(id) on delete set null;
alter table public.workspace_approvals drop constraint if exists workspace_approvals_status_check;
alter table public.workspace_approvals add constraint workspace_approvals_status_check check (status in ('pendiente','aprobado','cambios'));
alter table public.workspace_approvals drop constraint if exists workspace_approvals_piece_type_check;
alter table public.workspace_approvals add constraint workspace_approvals_piece_type_check check (piece_type in ('template','video','content'));
create index if not exists idx_workspace_approvals_ws on public.workspace_approvals (workspace_id, status, requested_at desc);

alter table public.workspace_agencies
  add column if not exists contact_email text,
  add column if not exists area_ids uuid[] not null default '{}',
  add column if not exists sla_hours integer not null default 48,
  add column if not exists access_note text;
create index if not exists idx_workspace_agencies_ws on public.workspace_agencies (workspace_id);

-- FK al espacio (las tablas de Hermes no la tenían)
do $$ declare t text; begin
  foreach t in array array['workspace_clones','workspace_areas','workspace_approvals','workspace_agencies','workspace_events','workspace_mailings','workspace_forms'] loop
    if not exists (select 1 from pg_constraint where conname = t || '_workspace_id_fkey') then
      execute format('alter table public.%I add constraint %I foreign key (workspace_id) references public.workspaces(id) on delete cascade not valid', t, t || '_workspace_id_fkey');
    end if;
  end loop;
end $$;
commit;
