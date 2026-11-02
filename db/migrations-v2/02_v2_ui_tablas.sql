-- v2_ui_tablas.sql — Tablas que la UI v2 (maqueta musa-plataforma-mticket) necesita y la base no tenía.
-- Solo agrega (aditivo): no modifica ni borra nada existente. Mismo patrón de seguridad que
-- workspace_events: RLS por rol en el workspace (viewer lee, editor escribe).

create or replace function public.v2_touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- Vender › Cotizaciones
create table if not exists public.crm_quotes (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  number text not null,                         -- COT-0142
  brand_id text references public.brands(id) on delete set null,
  brand_name text,
  deal_id uuid references public.crm_deals(id) on delete set null,
  title text not null,
  status text not null default 'Borrador' check (status in ('Borrador','Enviada','Firmada','Rechazada','Vencida')),
  items jsonb not null default '[]'::jsonb,     -- [{servicio, cantidad, precio}]
  currency text not null default 'PEN',
  total numeric not null default 0,
  sent_at timestamptz, signed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, number)
);

-- Planear › Briefs: usa public.briefs (ver v2_briefs_unificar.sql)

-- Planear › Playbooks (pasos con día relativo al día D)
create table if not exists public.workspace_playbooks (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  category text not null default 'General',
  name text not null,
  description text,
  steps jsonb not null default '[]'::jsonb,     -- [{dia, paso, ruta, responsable}]
  uses integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

-- Proyectos de cliente (portal, hub de marca, resumen)
create table if not exists public.workspace_projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  brand_id text references public.brands(id) on delete set null,
  brand_name text,
  name text not null,
  status text not null default 'Planificando' check (status in ('Planificando','En producción','En revisión','Entregado','Pausado','Cerrado')),
  brief_id uuid, -- FK a public.briefs en v2_briefs_unificar.sql
  quote_id uuid references public.crm_quotes(id) on delete set null,
  playbook_id uuid references public.workspace_playbooks(id) on delete set null,
  starts_on date, ends_on date,
  budget numeric not null default 0, spent numeric not null default 0,
  hours_planned numeric not null default 0, hours_used numeric not null default 0,
  team jsonb not null default '[]'::jsonb,
  files jsonb not null default '[]'::jsonb,     -- ids de templates entregables
  approvals jsonb not null default '{}'::jsonb, -- {template_id: 'cliente'|'interna'|'cambios'}
  progress integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

-- Fees / retainers mensuales por cliente
create table if not exists public.workspace_fees (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  brand_id text references public.brands(id) on delete set null,
  brand_name text,
  monthly_fee numeric not null default 0,
  currency text not null default 'PEN',
  hours_included numeric not null default 0, hours_used numeric not null default 0,
  pieces_included integer not null default 0, pieces_delivered integer not null default 0,
  out_of_scope jsonb not null default '[]'::jsonb,
  period date not null default date_trunc('month', now())::date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

-- Anunciar › Campañas de ads (pauta pagada)
create table if not exists public.ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  brand_id text references public.brands(id) on delete set null,
  brand_name text,
  campaign_id text references public.campaigns(id) on delete set null,
  name text not null,
  network text not null check (network in ('meta','tt','li','google','yt','x','other')),
  objective text,
  status text not null default 'Borrador' check (status in ('Borrador','Activa','Pausada','Terminada','En revisión')),
  budget numeric not null default 0, spend numeric not null default 0, currency text not null default 'USD',
  starts_at timestamptz, ends_at timestamptz,
  impressions bigint not null default 0, clicks bigint not null default 0,
  results integer not null default 0, result_label text, revenue numeric not null default 0,
  audience text, creatives integer not null default 0,
  event_id uuid references public.workspace_events(id) on delete set null,
  external_id text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

-- Anunciar › Audiencias de pauta
create table if not exists public.ad_audiences (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  brand_id text references public.brands(id) on delete set null,
  brand_name text,
  name text not null,
  kind text not null default 'Segmentación de la red',
  networks text[] not null default '{}',
  size bigint not null default 0,
  description text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

-- Agentes › Computadoras
create table if not exists public.workspace_agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  name text not null,
  color text default '#111',
  role text,
  template text,                                 -- musa, openclaw, hermes, claude…
  model text,
  os text,
  state text not null default 'idle' check (state in ('working','idle','sleep','prov')),
  brands text[] not null default '{}',
  permissions jsonb not null default '{}'::jsonb, -- {bandeja:'publicar', crm:'crear', …}
  wake text,
  task text,
  url text,
  disk_gb numeric not null default 0,
  uptime text,
  builtin boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

-- Agentes › Skills
create table if not exists public.agent_skills (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text,
  category text,
  agent_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

-- Agentes › Gobernanza: reglas y registro de acciones
create table if not exists public.agent_governance_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  rule text not null,
  description text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.agent_activity_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  agent_id uuid references public.workspace_agents(id) on delete set null,
  agent_name text,
  action text not null,
  verdict text not null default 'Permitido' check (verdict in ('Permitido','Bloqueado','Pidió aprobación')),
  created_at timestamptz not null default now()
);

-- Vender / Medir › Loops de crecimiento (valores de cada modelo)
create table if not exists public.workspace_loops (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  brand_name text,
  macro text not null,                           -- acq, ret, …
  sub text not null,                             -- viral, paid, …
  values jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, brand_name, macro, sub)
);

-- Índices, RLS, políticas, permisos y updated_at para todas
do $$
declare t text;
begin
  foreach t in array array['crm_quotes','workspace_playbooks','workspace_projects','workspace_fees',
    'ad_campaigns','ad_audiences','workspace_agents','agent_skills','agent_governance_rules','agent_activity_log','workspace_loops'] loop
    execute format('create index if not exists %I on public.%I (workspace_id)', 'idx_' || t || '_ws', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_workspace_read', t);
    execute format('create policy %I on public.%I for select using (has_workspace_role(workspace_id, %L))', t || '_workspace_read', t, 'viewer');
    execute format('drop policy if exists %I on public.%I', t || '_workspace_write', t);
    execute format('create policy %I on public.%I for all using (has_workspace_role(workspace_id, %L)) with check (has_workspace_role(workspace_id, %L))', t || '_workspace_write', t, 'editor', 'editor');
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if t <> 'agent_activity_log' then
      execute format('drop trigger if exists %I on public.%I', 'trg_' || t || '_updated_at', t);
      execute format('create trigger %I before update on public.%I for each row execute function public.v2_touch_updated_at()', 'trg_' || t || '_updated_at', t);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

-- La UI v2 es la única cara de musa-v2: todo workspace nuevo nace con v2 activo.
alter table public.workspaces alter column v2_enabled set default true;
