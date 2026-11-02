-- Tablas creadas por la segunda ronda de Hermes y por la UI v2, reconstruidas desde el catálogo de la base de pruebas.
-- Idempotente: create if not exists. Las alteraciones posteriores están en los archivos 06+.
begin;
create table if not exists public.briefs (
  id uuid not null default gen_random_uuid(),
  workspace_id text not null,
  brand_id text,
  title text not null,
  status text not null default 'borrador'::text,
  objective text,
  audience text,
  tone text,
  deliverables jsonb default '[]'::jsonb,
  content jsonb default '{}'::jsonb,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  brand_name text,
  due_date date,
  budget numeric,
  primary key (id)
);
do $$ begin if not exists (select 1 from pg_constraint where conname='briefs_status_check') then alter table public.briefs add constraint briefs_status_check CHECK ((status = ANY (ARRAY['borrador'::text, 'por_completar'::text, 'aprobado'::text, 'en_proyecto'::text, 'publicado'::text, 'archivado'::text]))); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='briefs_brand_id_fkey') then alter table public.briefs add constraint briefs_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='briefs_created_by_fkey') then alter table public.briefs add constraint briefs_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='briefs_workspace_id_fkey') then alter table public.briefs add constraint briefs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE; end if; end $$;
create index if not exists idx_briefs_ws_updated ON public.briefs USING btree (workspace_id, updated_at DESC);
create index if not exists idx_briefs_brand ON public.briefs USING btree (brand_id);
alter table public.briefs enable row level security;
drop policy if exists briefs_read on public.briefs;
create policy briefs_read on public.briefs as permissive for select to public using (has_workspace_role(workspace_id, 'viewer'::text));
drop policy if exists briefs_write on public.briefs;
create policy briefs_write on public.briefs as permissive for all to public using (has_workspace_role(workspace_id, 'editor'::text)) with check (has_workspace_role(workspace_id, 'editor'::text));
grant insert, select, update, delete on public.briefs to authenticated;
drop trigger if exists trg_briefs_updated_at on public.briefs;
CREATE TRIGGER trg_briefs_updated_at BEFORE UPDATE ON public.briefs FOR EACH ROW EXECUTE FUNCTION v2_touch_updated_at();
create table if not exists public.workspace_rates (
  id uuid not null default gen_random_uuid(),
  workspace_id text not null,
  label text not null,
  price numeric not null default 0,
  unit text not null default 'pieza'::text,
  sort integer default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  primary key (id)
);
alter table public.workspace_rates enable row level security;
drop policy if exists workspace_rates_read on public.workspace_rates;
create policy workspace_rates_read on public.workspace_rates as permissive for select to public using (has_workspace_role(workspace_id, 'viewer'::text));
drop policy if exists workspace_rates_write on public.workspace_rates;
create policy workspace_rates_write on public.workspace_rates as permissive for all to public using (has_workspace_role(workspace_id, 'editor'::text)) with check (has_workspace_role(workspace_id, 'editor'::text));
grant insert, select, update, delete on public.workspace_rates to authenticated;
create table if not exists public.crm_quotes (
  id uuid not null default gen_random_uuid(),
  workspace_id text not null,
  number text not null,
  brand_id text,
  brand_name text,
  deal_id uuid,
  title text not null,
  status text not null default 'Borrador'::text,
  items jsonb not null default '[]'::jsonb,
  currency text not null default 'PEN'::text,
  total numeric not null default 0,
  sent_at timestamp with time zone,
  signed_at timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  primary key (id)
);
do $$ begin if not exists (select 1 from pg_constraint where conname='crm_quotes_status_check') then alter table public.crm_quotes add constraint crm_quotes_status_check CHECK ((status = ANY (ARRAY['Borrador'::text, 'Enviada'::text, 'Firmada'::text, 'Rechazada'::text, 'Vencida'::text]))); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='crm_quotes_brand_id_fkey') then alter table public.crm_quotes add constraint crm_quotes_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='crm_quotes_created_by_fkey') then alter table public.crm_quotes add constraint crm_quotes_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='crm_quotes_deal_id_fkey') then alter table public.crm_quotes add constraint crm_quotes_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES crm_deals(id) ON DELETE SET NULL; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='crm_quotes_workspace_id_fkey') then alter table public.crm_quotes add constraint crm_quotes_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='crm_quotes_workspace_id_number_key') then alter table public.crm_quotes add constraint crm_quotes_workspace_id_number_key UNIQUE (workspace_id, number); end if; end $$;
create index if not exists idx_crm_quotes_ws ON public.crm_quotes USING btree (workspace_id);
create unique index if not exists crm_quotes_workspace_id_number_key ON public.crm_quotes USING btree (workspace_id, number);
alter table public.crm_quotes enable row level security;
drop policy if exists crm_quotes_workspace_read on public.crm_quotes;
create policy crm_quotes_workspace_read on public.crm_quotes as permissive for select to public using (has_workspace_role(workspace_id, 'viewer'::text));
drop policy if exists crm_quotes_workspace_write on public.crm_quotes;
create policy crm_quotes_workspace_write on public.crm_quotes as permissive for all to public using (has_workspace_role(workspace_id, 'editor'::text)) with check (has_workspace_role(workspace_id, 'editor'::text));
grant insert, select, update, delete on public.crm_quotes to authenticated;
drop trigger if exists trg_crm_quotes_updated_at on public.crm_quotes;
CREATE TRIGGER trg_crm_quotes_updated_at BEFORE UPDATE ON public.crm_quotes FOR EACH ROW EXECUTE FUNCTION v2_touch_updated_at();
create table if not exists public.workspace_playbooks (
  id uuid not null default gen_random_uuid(),
  workspace_id text not null,
  category text not null default 'General'::text,
  name text not null,
  description text,
  steps jsonb not null default '[]'::jsonb,
  uses integer not null default 0,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  primary key (id)
);
do $$ begin if not exists (select 1 from pg_constraint where conname='workspace_playbooks_created_by_fkey') then alter table public.workspace_playbooks add constraint workspace_playbooks_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='workspace_playbooks_workspace_id_fkey') then alter table public.workspace_playbooks add constraint workspace_playbooks_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE; end if; end $$;
create index if not exists idx_workspace_playbooks_ws ON public.workspace_playbooks USING btree (workspace_id);
alter table public.workspace_playbooks enable row level security;
drop policy if exists workspace_playbooks_workspace_read on public.workspace_playbooks;
create policy workspace_playbooks_workspace_read on public.workspace_playbooks as permissive for select to public using (has_workspace_role(workspace_id, 'viewer'::text));
drop policy if exists workspace_playbooks_workspace_write on public.workspace_playbooks;
create policy workspace_playbooks_workspace_write on public.workspace_playbooks as permissive for all to public using (has_workspace_role(workspace_id, 'editor'::text)) with check (has_workspace_role(workspace_id, 'editor'::text));
grant insert, select, update, delete on public.workspace_playbooks to authenticated;
drop trigger if exists trg_workspace_playbooks_updated_at on public.workspace_playbooks;
CREATE TRIGGER trg_workspace_playbooks_updated_at BEFORE UPDATE ON public.workspace_playbooks FOR EACH ROW EXECUTE FUNCTION v2_touch_updated_at();
create table if not exists public.workspace_agents (
  id uuid not null default gen_random_uuid(),
  workspace_id text not null,
  name text not null,
  color text default '#111'::text,
  role text,
  template text,
  model text,
  os text,
  state text not null default 'idle'::text,
  brands text[] not null default '{}'::text[],
  permissions jsonb not null default '{}'::jsonb,
  wake text,
  task text,
  url text,
  disk_gb numeric not null default 0,
  uptime text,
  builtin boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  primary key (id)
);
do $$ begin if not exists (select 1 from pg_constraint where conname='workspace_agents_state_check') then alter table public.workspace_agents add constraint workspace_agents_state_check CHECK ((state = ANY (ARRAY['working'::text, 'idle'::text, 'sleep'::text, 'prov'::text]))); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='workspace_agents_workspace_id_fkey') then alter table public.workspace_agents add constraint workspace_agents_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE; end if; end $$;
create index if not exists idx_workspace_agents_ws ON public.workspace_agents USING btree (workspace_id);
alter table public.workspace_agents enable row level security;
drop policy if exists workspace_agents_workspace_read on public.workspace_agents;
create policy workspace_agents_workspace_read on public.workspace_agents as permissive for select to public using (has_workspace_role(workspace_id, 'viewer'::text));
drop policy if exists workspace_agents_workspace_write on public.workspace_agents;
create policy workspace_agents_workspace_write on public.workspace_agents as permissive for all to public using (has_workspace_role(workspace_id, 'editor'::text)) with check (has_workspace_role(workspace_id, 'editor'::text));
grant insert, select, update, delete on public.workspace_agents to authenticated;
drop trigger if exists trg_workspace_agents_updated_at on public.workspace_agents;
CREATE TRIGGER trg_workspace_agents_updated_at BEFORE UPDATE ON public.workspace_agents FOR EACH ROW EXECUTE FUNCTION v2_touch_updated_at();
create table if not exists public.workspace_projects (
  id uuid not null default gen_random_uuid(),
  workspace_id text not null,
  brand_id text,
  brand_name text,
  name text not null,
  status text not null default 'Planificando'::text,
  brief_id uuid,
  quote_id uuid,
  playbook_id uuid,
  starts_on date,
  ends_on date,
  budget numeric not null default 0,
  spent numeric not null default 0,
  hours_planned numeric not null default 0,
  hours_used numeric not null default 0,
  team jsonb not null default '[]'::jsonb,
  files jsonb not null default '[]'::jsonb,
  approvals jsonb not null default '{}'::jsonb,
  progress integer not null default 0,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  primary key (id)
);
do $$ begin if not exists (select 1 from pg_constraint where conname='workspace_projects_status_check') then alter table public.workspace_projects add constraint workspace_projects_status_check CHECK ((status = ANY (ARRAY['Planificando'::text, 'En producción'::text, 'En revisión'::text, 'Entregado'::text, 'Pausado'::text, 'Cerrado'::text]))); end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='workspace_projects_brief_id_fkey') then alter table public.workspace_projects add constraint workspace_projects_brief_id_fkey FOREIGN KEY (brief_id) REFERENCES briefs(id) ON DELETE SET NULL; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='workspace_projects_created_by_fkey') then alter table public.workspace_projects add constraint workspace_projects_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='workspace_projects_brand_id_fkey') then alter table public.workspace_projects add constraint workspace_projects_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='workspace_projects_quote_id_fkey') then alter table public.workspace_projects add constraint workspace_projects_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES crm_quotes(id) ON DELETE SET NULL; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='workspace_projects_workspace_id_fkey') then alter table public.workspace_projects add constraint workspace_projects_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='workspace_projects_playbook_id_fkey') then alter table public.workspace_projects add constraint workspace_projects_playbook_id_fkey FOREIGN KEY (playbook_id) REFERENCES workspace_playbooks(id) ON DELETE SET NULL; end if; end $$;
create index if not exists idx_workspace_projects_ws ON public.workspace_projects USING btree (workspace_id);
alter table public.workspace_projects enable row level security;
drop policy if exists workspace_projects_workspace_read on public.workspace_projects;
create policy workspace_projects_workspace_read on public.workspace_projects as permissive for select to public using (has_workspace_role(workspace_id, 'viewer'::text));
drop policy if exists workspace_projects_workspace_write on public.workspace_projects;
create policy workspace_projects_workspace_write on public.workspace_projects as permissive for all to public using (has_workspace_role(workspace_id, 'editor'::text)) with check (has_workspace_role(workspace_id, 'editor'::text));
grant insert, select, update, delete on public.workspace_projects to authenticated;
drop trigger if exists trg_workspace_projects_updated_at on public.workspace_projects;
CREATE TRIGGER trg_workspace_projects_updated_at BEFORE UPDATE ON public.workspace_projects FOR EACH ROW EXECUTE FUNCTION v2_touch_updated_at();
create table if not exists public.workspace_project_tasks (
  id uuid not null default gen_random_uuid(),
  workspace_id text not null,
  project_id uuid,
  title text not null,
  kind text not null default 'interna'::text,
  status text not null default 'todo'::text,
  due date,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  primary key (id)
);
do $$ begin if not exists (select 1 from pg_constraint where conname='workspace_project_tasks_project_id_fkey') then alter table public.workspace_project_tasks add constraint workspace_project_tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES workspace_projects(id) ON DELETE CASCADE; end if; end $$;
alter table public.workspace_project_tasks enable row level security;
drop policy if exists workspace_project_tasks_read on public.workspace_project_tasks;
create policy workspace_project_tasks_read on public.workspace_project_tasks as permissive for select to public using (has_workspace_role(workspace_id, 'viewer'::text));
drop policy if exists workspace_project_tasks_write on public.workspace_project_tasks;
create policy workspace_project_tasks_write on public.workspace_project_tasks as permissive for all to public using (has_workspace_role(workspace_id, 'editor'::text)) with check (has_workspace_role(workspace_id, 'editor'::text));
grant insert, select, update, delete on public.workspace_project_tasks to authenticated;
create table if not exists public.workspace_fees (
  id uuid not null default gen_random_uuid(),
  workspace_id text not null,
  brand_id text,
  brand_name text,
  monthly_fee numeric not null default 0,
  currency text not null default 'PEN'::text,
  hours_included numeric not null default 0,
  hours_used numeric not null default 0,
  pieces_included integer not null default 0,
  pieces_delivered integer not null default 0,
  out_of_scope jsonb not null default '[]'::jsonb,
  period date not null default (date_trunc('month'::text, now()))::date,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  primary key (id)
);
do $$ begin if not exists (select 1 from pg_constraint where conname='workspace_fees_brand_id_fkey') then alter table public.workspace_fees add constraint workspace_fees_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL; end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname='workspace_fees_workspace_id_fkey') then alter table public.workspace_fees add constraint workspace_fees_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE; end if; end $$;
create index if not exists idx_workspace_fees_ws ON public.workspace_fees USING btree (workspace_id);
alter table public.workspace_fees enable row level security;
drop policy if exists workspace_fees_workspace_read on public.workspace_fees;
create policy workspace_fees_workspace_read on public.workspace_fees as permissive for select to public using (has_workspace_role(workspace_id, 'viewer'::text));
drop policy if exists workspace_fees_workspace_write on public.workspace_fees;
create policy workspace_fees_workspace_write on public.workspace_fees as permissive for all to public using (has_workspace_role(workspace_id, 'editor'::text)) with check (has_workspace_role(workspace_id, 'editor'::text));
grant insert, select, update, delete on public.workspace_fees to authenticated;
drop trigger if exists trg_workspace_fees_updated_at on public.workspace_fees;
CREATE TRIGGER trg_workspace_fees_updated_at BEFORE UPDATE ON public.workspace_fees FOR EACH ROW EXECUTE FUNCTION v2_touch_updated_at();
create table if not exists public.workspace_form_responses (
  id uuid not null default gen_random_uuid(),
  workspace_id text not null,
  form_id uuid,
  data jsonb default '{}'::jsonb,
  email text,
  created_at timestamp with time zone not null default now(),
  primary key (id)
);
do $$ begin if not exists (select 1 from pg_constraint where conname='workspace_form_responses_form_id_fkey') then alter table public.workspace_form_responses add constraint workspace_form_responses_form_id_fkey FOREIGN KEY (form_id) REFERENCES workspace_forms(id) ON DELETE CASCADE; end if; end $$;
alter table public.workspace_form_responses enable row level security;
drop policy if exists workspace_form_responses_read on public.workspace_form_responses;
create policy workspace_form_responses_read on public.workspace_form_responses as permissive for select to public using (has_workspace_role(workspace_id, 'viewer'::text));
drop policy if exists workspace_form_responses_write on public.workspace_form_responses;
create policy workspace_form_responses_write on public.workspace_form_responses as permissive for all to public using (has_workspace_role(workspace_id, 'editor'::text)) with check (has_workspace_role(workspace_id, 'editor'::text));
grant insert, select, update, delete on public.workspace_form_responses to authenticated;
create table if not exists public.workspace_event_regs (
  id uuid not null default gen_random_uuid(),
  workspace_id text not null,
  event_id uuid,
  name text,
  email text,
  status text default 'confirmado'::text,
  created_at timestamp with time zone not null default now(),
  phone text,
  source text not null default 'musa'::text,
  primary key (id)
);
do $$ begin if not exists (select 1 from pg_constraint where conname='workspace_event_regs_event_id_fkey') then alter table public.workspace_event_regs add constraint workspace_event_regs_event_id_fkey FOREIGN KEY (event_id) REFERENCES workspace_events(id) ON DELETE CASCADE; end if; end $$;
create unique index if not exists workspace_event_regs_event_email_key ON public.workspace_event_regs USING btree (event_id, lower(email)) WHERE (email IS NOT NULL);
create index if not exists idx_event_regs_event ON public.workspace_event_regs USING btree (event_id);
alter table public.workspace_event_regs enable row level security;
drop policy if exists workspace_event_regs_read on public.workspace_event_regs;
create policy workspace_event_regs_read on public.workspace_event_regs as permissive for select to public using (has_workspace_role(workspace_id, 'viewer'::text));
drop policy if exists workspace_event_regs_write on public.workspace_event_regs;
create policy workspace_event_regs_write on public.workspace_event_regs as permissive for all to public using (has_workspace_role(workspace_id, 'editor'::text)) with check (has_workspace_role(workspace_id, 'editor'::text));
grant insert, select, update, delete on public.workspace_event_regs to authenticated;
-- columnas agregadas a tablas existentes
alter table public.social_inbox add column if not exists assigned_to uuid;
alter table public.workspace_mailings add column if not exists kind text default 'campana'::text not null;
alter table public.workspace_mailings add column if not exists content jsonb default '{}'::jsonb;
commit;
