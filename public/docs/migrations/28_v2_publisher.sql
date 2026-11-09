-- Musa Publisher (motor social propio, conviviendo con Zernio).
-- Todo se lee y escribe SOLO desde el servidor (service role): RLS encendido sin
-- políticas para anon/authenticated, así ni el navegador ni la API REST directa
-- ven tokens. Los tokens y client_secret van cifrados (AES-256-GCM, PUBLISHER_ENC_KEY).
-- Sin disparos automáticos: se publica cuando la persona aprieta «Publicar»
-- (y «Reintentar» para los destinos que fallaron). Solo imágenes en esta fase.
-- Idempotente.
begin;

create table if not exists public.publisher_oauth_apps (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  provider text not null,
  client_id text not null,
  client_secret_encrypted text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider)
);

create table if not exists public.publisher_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  provider text not null,
  kind text not null check (kind in ('oauth','token')),
  display_name text,
  username text,
  avatar_url text,
  external_id text not null,
  access_token_encrypted text not null,
  refresh_token_encrypted text,
  expires_at timestamptz,
  options jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active','expired','error')),
  last_error text,
  checked_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider, external_id)
);
create index if not exists publisher_accounts_ws on public.publisher_accounts (workspace_id);

create table if not exists public.publisher_oauth_states (
  state text primary key,
  workspace_id text not null,
  user_id uuid not null,
  provider text not null,
  code_verifier text,
  redirect_uri text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.publish_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  template_id text,
  content_id text,
  media_url text not null,
  media_mime text not null,
  caption text not null default '',
  mode text not null check (mode in ('dry-run','live')),
  status text not null default 'queued' check (status in ('queued','running','published','partial','failed','dry-run')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists publish_jobs_ws on public.publish_jobs (workspace_id, created_at desc);

create table if not exists public.publish_targets (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.publish_jobs(id) on delete cascade,
  account_id uuid references public.publisher_accounts(id) on delete set null,
  provider text not null,
  account_name text,
  status text not null default 'queued' check (status in ('queued','published','failed','skipped_dry_run')),
  external_id text,
  external_url text,
  error text,
  attempts int not null default 0,
  locked_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists publish_targets_job on public.publish_targets (job_id);

alter table public.publisher_oauth_apps enable row level security;
alter table public.publisher_accounts enable row level security;
alter table public.publisher_oauth_states enable row level security;
alter table public.publish_jobs enable row level security;
alter table public.publish_targets enable row level security;
revoke all on public.publisher_oauth_apps, public.publisher_accounts, public.publisher_oauth_states, public.publish_jobs, public.publish_targets from anon, authenticated;

commit;
