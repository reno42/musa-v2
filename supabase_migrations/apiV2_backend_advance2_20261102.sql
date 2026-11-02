-- Ronda 2 (2 nov 2026): tablas que faltaban para cubrir TODAS las vistas de clientes.
-- Aplicado en lnbsmnbvclxrwwcuuvud. Idempotente.

-- Tarifario (vista Cotizaciones, board derecho "Tarifario editable")
create table if not exists workspace_rates (
  id uuid default gen_random_uuid() primary key,
  workspace_id text not null,
  label text not null,
  price numeric not null default 0,
  unit text not null default 'pieza',
  sort int default 0,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Respuestas de formularios (vista Formularios, columna leads)
create table if not exists workspace_form_responses (
  id uuid default gen_random_uuid() primary key,
  workspace_id text not null,
  form_id uuid references workspace_forms(id) on delete cascade,
  data jsonb default '{}'::jsonb,
  email text,
  created_at timestamptz default now() not null
);

-- Tareas de proyectos (vista Proyectos: avance, aprobaciones interna/cliente)
create table if not exists workspace_project_tasks (
  id uuid default gen_random_uuid() primary key,
  workspace_id text not null,
  project_id uuid references workspace_projects(id) on delete cascade,
  title text not null,
  kind text default 'interna' not null,      -- interna | cliente
  status text default 'todo' not null,       -- todo | doing | review | done
  due date,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Inscritos de eventos (vista Eventos, columna regs / lista)
create table if not exists workspace_event_regs (
  id uuid default gen_random_uuid() primary key,
  workspace_id text not null,
  event_id uuid references workspace_events(id) on delete cascade,
  name text,
  email text,
  status text default 'confirmado',          -- confirmado | asistio | no_asistio
  created_at timestamptz default now() not null
);

-- Mailing: columnas para distinguir campañas de secuencias y guardar contenido
alter table workspace_mailings add column if not exists kind text default 'campana' not null;
alter table workspace_mailings add column if not exists content jsonb default '{}'::jsonb;

-- RLS (mismo patrón del proyecto: viewer lee, editor escribe)
alter table workspace_rates enable row level security;
alter table workspace_form_responses enable row level security;
alter table workspace_project_tasks enable row level security;
alter table workspace_event_regs enable row level security;
create policy workspace_rates_read on workspace_rates for select using (has_workspace_role(workspace_id, 'viewer'));
create policy workspace_rates_write on workspace_rates for all using (has_workspace_role(workspace_id, 'editor')) with check (has_workspace_role(workspace_id, 'editor'));
create policy workspace_form_responses_read on workspace_form_responses for select using (has_workspace_role(workspace_id, 'viewer'));
create policy workspace_form_responses_write on workspace_form_responses for all using (has_workspace_role(workspace_id, 'editor')) with check (has_workspace_role(workspace_id, 'editor'));
create policy workspace_project_tasks_read on workspace_project_tasks for select using (has_workspace_role(workspace_id, 'viewer'));
create policy workspace_project_tasks_write on workspace_project_tasks for all using (has_workspace_role(workspace_id, 'editor')) with check (has_workspace_role(workspace_id, 'editor'));
create policy workspace_event_regs_read on workspace_event_regs for select using (has_workspace_role(workspace_id, 'viewer'));
create policy workspace_event_regs_write on workspace_event_regs for all using (has_workspace_role(workspace_id, 'editor')) with check (has_workspace_role(workspace_id, 'editor'));
grant select, insert, update, delete on workspace_rates, workspace_form_responses, workspace_project_tasks, workspace_event_regs to authenticated;
