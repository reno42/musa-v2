-- Guiones del teleprompter (Crear › Tomas), creables por la UI, por código y por agentes (MCP take_script_save).
begin;
create table if not exists public.workspace_take_scripts (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  brand_id text references public.brands(id) on delete set null,
  title text not null default 'Guion',
  script text not null default '',
  format text not null default '9:16' check (format in ('9:16','16:9','1:1','4:5')),
  speed integer not null default 40 check (speed between 10 and 120),
  size integer not null default 40 check (size between 20 and 80),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_take_scripts_ws on public.workspace_take_scripts (workspace_id, updated_at desc);
alter table public.workspace_take_scripts enable row level security;
drop policy if exists take_scripts_read on public.workspace_take_scripts;
drop policy if exists take_scripts_write on public.workspace_take_scripts;
create policy take_scripts_read on public.workspace_take_scripts for select to authenticated using (has_workspace_role(workspace_id, 'viewer'));
create policy take_scripts_write on public.workspace_take_scripts for all to authenticated using (has_workspace_role(workspace_id, 'editor')) with check (has_workspace_role(workspace_id, 'editor'));
grant select, insert, update, delete on public.workspace_take_scripts to authenticated;
drop trigger if exists trg_take_scripts_updated_at on public.workspace_take_scripts;
create trigger trg_take_scripts_updated_at before update on public.workspace_take_scripts for each row execute function public.v2_touch_updated_at();
commit;
