-- Editor de video (QA Instinct v16): historial de versiones del proyecto con «Restaurar» y presets de animación
-- del espacio. Misma seguridad por workspace que video_editor_state (04). Idempotente.

-- Versiones: una foto completa del estado del editor (la misma forma que video_editor_state.state).
create table if not exists public.video_editor_versions (
  id bigserial primary key,
  project_id text not null references public.musa_video_projects(id) on delete cascade,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  state jsonb not null,
  label text,
  clips integer,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists idx_video_editor_versions_project on public.video_editor_versions (project_id, created_at desc);
create index if not exists idx_video_editor_versions_ws on public.video_editor_versions (workspace_id);
alter table public.video_editor_versions enable row level security;
drop policy if exists video_editor_versions_read on public.video_editor_versions;
create policy video_editor_versions_read on public.video_editor_versions for select using (has_workspace_role(workspace_id, 'viewer'));
drop policy if exists video_editor_versions_write on public.video_editor_versions;
create policy video_editor_versions_write on public.video_editor_versions for all using (has_workspace_role(workspace_id, 'editor')) with check (has_workspace_role(workspace_id, 'editor'));
grant select, insert, update, delete on public.video_editor_versions to authenticated;
grant usage, select on sequence public.video_editor_versions_id_seq to authenticated;
grant all on public.video_editor_versions to service_role;

-- Presets de animación guardados por el espacio (entrada, duración, keyframes relativos, efecto, desenfoque…).
create table if not exists public.video_motion_presets (
  id bigserial primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  name text not null,
  kind text not null default 'any',
  preset jsonb not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists idx_video_motion_presets_ws on public.video_motion_presets (workspace_id, created_at desc);
alter table public.video_motion_presets enable row level security;
drop policy if exists video_motion_presets_read on public.video_motion_presets;
create policy video_motion_presets_read on public.video_motion_presets for select using (has_workspace_role(workspace_id, 'viewer'));
drop policy if exists video_motion_presets_write on public.video_motion_presets;
create policy video_motion_presets_write on public.video_motion_presets for all using (has_workspace_role(workspace_id, 'editor')) with check (has_workspace_role(workspace_id, 'editor'));
grant select, insert, update, delete on public.video_motion_presets to authenticated;
grant usage, select on sequence public.video_motion_presets_id_seq to authenticated;
grant all on public.video_motion_presets to service_role;

notify pgrst, 'reload schema';
