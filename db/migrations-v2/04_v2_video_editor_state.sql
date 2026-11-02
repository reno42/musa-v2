-- Estado visual del editor de video por proyecto (transiciones, looks, efectos, animaciones, escenas armadas
-- a mano, música, fondo). Las pistas/segmentos/materiales siguen siendo la verdad del timeline; esto guarda
-- lo que el modelo de segmentos no tiene. Misma seguridad por workspace que el resto de tablas v2.
create table if not exists public.video_editor_state (
  project_id text primary key references public.musa_video_projects(id) on delete cascade,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists idx_video_editor_state_ws on public.video_editor_state (workspace_id);
alter table public.video_editor_state enable row level security;
drop policy if exists video_editor_state_read on public.video_editor_state;
create policy video_editor_state_read on public.video_editor_state for select using (has_workspace_role(workspace_id, 'viewer'));
drop policy if exists video_editor_state_write on public.video_editor_state;
create policy video_editor_state_write on public.video_editor_state for all using (has_workspace_role(workspace_id, 'editor')) with check (has_workspace_role(workspace_id, 'editor'));
grant select, insert, update, delete on public.video_editor_state to authenticated;
grant all on public.video_editor_state to service_role;
drop trigger if exists trg_video_editor_state_updated_at on public.video_editor_state;
create trigger trg_video_editor_state_updated_at before update on public.video_editor_state for each row execute function public.v2_touch_updated_at();
notify pgrst, 'reload schema';
