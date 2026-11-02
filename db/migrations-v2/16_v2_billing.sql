-- Cobros con Creem (merchant of record) — Musa v2. Idempotente.
-- Los planes viven en billing_plans (se editan sin desplegar); cada uno apunta a un producto de Creem.
begin;
create table if not exists public.billing_plans (
  code text primary key,                       -- p. ej. freelance_byok_m
  name text not null,
  mode text not null check (mode in ('byok','musa_ia')),
  segment text not null check (segment in ('personal','freelance','agencia','corp')),
  interval text not null default 'month' check (interval in ('month','year','once')),
  price_usd numeric not null default 0,
  creem_product_id text,                       -- vacío = todavía no se vende
  creem_product_id_test text,
  entitlements jsonb not null default '{}'::jsonb,   -- marcas, asientos, clientes, créditos IA…
  active boolean not null default true,
  sort int not null default 0
);
alter table public.billing_plans enable row level security;
drop policy if exists billing_plans_read on public.billing_plans;
create policy billing_plans_read on public.billing_plans for select to anon, authenticated using (active);
grant select on public.billing_plans to anon, authenticated;

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id text references public.workspaces(id) on delete set null,
  plan_code text references public.billing_plans(code),
  status text not null default 'pending' check (status in ('pending','trialing','active','past_due','canceled','expired','refunded')),
  creem_subscription_id text unique,
  creem_customer_id text,
  creem_checkout_id text unique,
  current_period_end timestamptz,
  cancel_at timestamptz,
  referral_code text,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_subscriptions_user on public.subscriptions (user_id, status);
alter table public.subscriptions enable row level security;
drop policy if exists subscriptions_own on public.subscriptions;
create policy subscriptions_own on public.subscriptions for select to authenticated using (user_id = auth.uid());
grant select on public.subscriptions to authenticated;

-- eventos de Creem ya procesados (idempotencia del webhook)
create table if not exists public.billing_events (
  id text primary key,
  type text,
  received_at timestamptz not null default now(),
  payload jsonb
);
alter table public.billing_events enable row level security;

-- premios por referidos: el que invita gana cuando su invitado paga por primera vez
create table if not exists public.referral_rewards (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references auth.users(id) on delete cascade,
  referred_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  reward text not null default '1_month',
  discount_code text,
  status text not null default 'earned' check (status in ('earned','issued','used','void')),
  created_at timestamptz not null default now(),
  unique (referred_id)
);
alter table public.referral_rewards enable row level security;
drop policy if exists referral_rewards_own on public.referral_rewards;
create policy referral_rewards_own on public.referral_rewards for select to authenticated using (referrer_id = auth.uid());
grant select on public.referral_rewards to authenticated;
commit;
