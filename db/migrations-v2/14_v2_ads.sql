-- Integraciones de ads (Meta, TikTok, LinkedIn, Google): cuentas conectadas por espacio y campañas sincronizadas.
-- Las credenciales son BYOK (user_api_keys: meta-ads | tiktok-ads | linkedin-ads | google-ads) del dueño de la cuenta. Idempotente.
begin;
create table if not exists public.workspace_ad_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  network text not null check (network in ('meta','tiktok','linkedin','google')),
  account_id text not null,
  account_name text,
  currency text,
  brand_id text references public.brands(id) on delete set null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (workspace_id, network, account_id)
);
alter table public.workspace_ad_accounts enable row level security;
drop policy if exists ad_accounts_read on public.workspace_ad_accounts;
drop policy if exists ad_accounts_write on public.workspace_ad_accounts;
create policy ad_accounts_read on public.workspace_ad_accounts for select to authenticated using (has_workspace_role(workspace_id, 'viewer'));
create policy ad_accounts_write on public.workspace_ad_accounts for all to authenticated using (has_workspace_role(workspace_id, 'admin')) with check (has_workspace_role(workspace_id, 'admin') and owner_user_id = auth.uid());
grant select, insert, update, delete on public.workspace_ad_accounts to authenticated;

create table if not exists public.ad_campaigns_ext (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  account_ref uuid not null references public.workspace_ad_accounts(id) on delete cascade,
  network text not null,
  external_id text not null,
  name text,
  status text,
  objective text,
  daily_budget numeric,
  currency text,
  spend numeric not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  conversions numeric not null default 0,
  reach bigint,
  date_from date,
  date_to date,
  campaign_id text references public.campaigns(id) on delete set null,
  brand_id text references public.brands(id) on delete set null,
  synced_at timestamptz not null default now(),
  unique (account_ref, external_id)
);
create index if not exists idx_ad_campaigns_ext_ws on public.ad_campaigns_ext (workspace_id, network);
alter table public.ad_campaigns_ext enable row level security;
drop policy if exists ad_campaigns_ext_read on public.ad_campaigns_ext;
drop policy if exists ad_campaigns_ext_write on public.ad_campaigns_ext;
create policy ad_campaigns_ext_read on public.ad_campaigns_ext for select to authenticated using (has_workspace_role(workspace_id, 'viewer'));
create policy ad_campaigns_ext_write on public.ad_campaigns_ext for update to authenticated using (has_workspace_role(workspace_id, 'editor')) with check (has_workspace_role(workspace_id, 'editor'));
grant select, update on public.ad_campaigns_ext to authenticated;
commit;
