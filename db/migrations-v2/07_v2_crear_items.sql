-- Popups de «Nuevo …» (Musa v2): lo mínimo que la base necesita para crear cada ítem desde la UI.
begin;

-- Segundo cerebro: el usuario puede crear notas propias (source = 'human'); las de sistema siguen siendo del servidor.
grant insert, update on public.brain_notes to authenticated;
drop policy if exists brain_notes_human_insert on public.brain_notes;
create policy brain_notes_human_insert on public.brain_notes as restrictive for insert to authenticated
  with check (source = 'human');

-- Mi trabajo: las tareas se leen/escriben por pertenencia al espacio (antes: cualquier tarea sin dueño era visible para todos).
drop policy if exists read_own_kanban_tasks on public.design_kanban_tasks;
drop policy if exists insert_own_kanban_tasks on public.design_kanban_tasks;
drop policy if exists update_own_kanban_tasks on public.design_kanban_tasks;
drop policy if exists kanban_tasks_read on public.design_kanban_tasks;
create policy kanban_tasks_read on public.design_kanban_tasks for select to authenticated
  using ((workspace_id is not null and has_workspace_role(workspace_id, 'viewer')) or account_id = auth.uid());
drop policy if exists kanban_tasks_insert on public.design_kanban_tasks;
create policy kanban_tasks_insert on public.design_kanban_tasks for insert to authenticated
  with check (workspace_id is not null and has_workspace_role(workspace_id, 'editor') and (account_id is null or account_id = auth.uid()));
drop policy if exists kanban_tasks_update on public.design_kanban_tasks;
create policy kanban_tasks_update on public.design_kanban_tasks for update to authenticated
  using ((workspace_id is not null and has_workspace_role(workspace_id, 'editor')) or account_id = auth.uid())
  with check ((workspace_id is not null and has_workspace_role(workspace_id, 'editor')) or account_id = auth.uid());
drop policy if exists kanban_tasks_delete on public.design_kanban_tasks;
create policy kanban_tasks_delete on public.design_kanban_tasks for delete to authenticated
  using ((workspace_id is not null and has_workspace_role(workspace_id, 'editor')) or account_id = auth.uid());

-- Eventos: lo que pide el popup (hora, duración, plataforma, enlace, cupos, marca, descripción).
alter table public.workspace_events
  add column if not exists starts_at timestamptz,
  add column if not exists duration_min integer not null default 60,
  add column if not exists platform text not null default 'meet',
  add column if not exists link text,
  add column if not exists capacity integer not null default 100,
  add column if not exists brand_id text references public.brands(id) on delete set null,
  add column if not exists description text;
alter table public.workspace_events drop constraint if exists workspace_events_platform_check;
alter table public.workspace_events add constraint workspace_events_platform_check check (platform in ('meet','zoom'));

commit;
