-- Unifica briefs: queda public.briefs (columnas tipadas) y se elimina public.workspace_briefs (vacía).
-- Se le da a briefs la integridad que tenía workspace_briefs: FKs, índice, updated_at automático y estados válidos.
begin;

alter table public.briefs
  add column if not exists brand_name text,
  add column if not exists due_date date,
  add column if not exists budget numeric;

alter table public.briefs drop constraint if exists briefs_workspace_id_fkey;
alter table public.briefs add constraint briefs_workspace_id_fkey
  foreign key (workspace_id) references public.workspaces(id) on delete cascade;
alter table public.briefs drop constraint if exists briefs_brand_id_fkey;
alter table public.briefs add constraint briefs_brand_id_fkey
  foreign key (brand_id) references public.brands(id) on delete set null;

alter table public.briefs drop constraint if exists briefs_status_check;
alter table public.briefs add constraint briefs_status_check
  check (status in ('borrador','por_completar','aprobado','en_proyecto','publicado','archivado'));

create index if not exists idx_briefs_ws_updated on public.briefs (workspace_id, updated_at desc);
create index if not exists idx_briefs_brand on public.briefs (brand_id);

drop trigger if exists trg_briefs_updated_at on public.briefs;
create trigger trg_briefs_updated_at before update on public.briefs
  for each row execute function public.v2_touch_updated_at();

-- proyectos apuntan ahora a briefs
alter table public.workspace_projects drop constraint if exists workspace_projects_brief_id_fkey;
alter table public.workspace_projects add constraint workspace_projects_brief_id_fkey
  foreign key (brief_id) references public.briefs(id) on delete set null;

drop table if exists public.workspace_briefs;

commit;
