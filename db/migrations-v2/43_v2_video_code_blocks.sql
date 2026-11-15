-- Video como código (Musa Video Code): el código de cada clip, tal como lo escribe el editor (muestreado del render
-- real), para que el MCP (video_code_get) devuelva exactamente lo que se ve aunque el movimiento sea compuesto
-- (órbitas, ráfagas, cámara, máscaras…). Una fila por clip: solo se reescriben los clips que cambian (antes iba todo
-- dentro de video_editor_state y cada guardado subía el código entero). Misma seguridad por workspace que
-- video_editor_state (04). Idempotente.
create table if not exists public.video_code_blocks (
  project_id text not null references public.musa_video_projects(id) on delete cascade,
  clip_id text not null,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  fp text not null,
  block jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (project_id, clip_id)
);
create index if not exists idx_video_code_blocks_ws on public.video_code_blocks (workspace_id);
alter table public.video_code_blocks enable row level security;
drop policy if exists video_code_blocks_read on public.video_code_blocks;
create policy video_code_blocks_read on public.video_code_blocks for select using (has_workspace_role(workspace_id, 'viewer'));
drop policy if exists video_code_blocks_write on public.video_code_blocks;
create policy video_code_blocks_write on public.video_code_blocks for all using (has_workspace_role(workspace_id, 'editor')) with check (has_workspace_role(workspace_id, 'editor'));
grant select, insert, update, delete on public.video_code_blocks to authenticated;
grant all on public.video_code_blocks to service_role;

notify pgrst, 'reload schema';
