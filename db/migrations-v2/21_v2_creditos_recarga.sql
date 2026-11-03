-- Recarga mensual de créditos (también para planes anuales), créditos disponibles y reembolsos de referidos. Idempotente.
begin;
alter table public.credit_accounts
  add column if not exists plan_grant numeric not null default 0,   -- créditos del plan por mes
  add column if not exists next_refill timestamptz;                  -- próxima recarga (anuales y respaldo de los mensuales)
alter table public.referral_rewards add column if not exists refund_tx text;

-- solo los planes dan acceso (no los paquetes ni las personas extra)
create or replace function public.v2_access_status() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cfg jsonb; uid uuid := auth.uid(); p record; sub boolean; adm boolean;
begin
  select value into cfg from platform_config where key = 'billing';
  adm := v2_is_platform_admin();
  select free_pass_at, access_plan into p from user_profiles where id = uid;
  sub := exists (select 1 from subscriptions s join billing_plans bp on bp.code = s.plan_code where s.user_id = uid and s.status in ('active','trialing','past_due') and bp.kind = 'plan');
  return jsonb_build_object(
    'paywall', coalesce((cfg->>'paywall')::boolean, false),
    'is_admin', adm, 'subscribed', sub, 'free_pass', p.free_pass_at is not null,
    'has_access', not coalesce((cfg->>'paywall')::boolean, false) or adm or sub or p.free_pass_at is not null or p.access_plan = 'corporate');
end $$;

-- recarga los créditos del plan si ya pasó el mes y el plan sigue activo
create or replace function public.v2_refill_credits(p_user uuid) returns void language plpgsql security definer set search_path = public as $$
declare a credit_accounts;
begin
  select * into a from credit_accounts where user_id = p_user for update;
  if a.user_id is null or a.next_refill is null or a.next_refill > now() or a.plan_grant <= 0 then return; end if;
  if not exists (select 1 from subscriptions s join billing_plans bp on bp.code = s.plan_code where s.user_id = p_user and s.status in ('active','trialing') and bp.kind = 'plan') then
    update credit_accounts set plan_credits = 0, next_refill = null, updated_at = now() where user_id = p_user;
    return;
  end if;
  update credit_accounts set plan_credits = a.plan_grant, next_refill = a.next_refill + ((floor(extract(epoch from now() - a.next_refill) / 2592000) + 1) * interval '30 days'), updated_at = now() where user_id = p_user;
  insert into credit_ledger (user_id, delta, reason) values (p_user, a.plan_grant, 'recarga mensual');
end $$;

-- ¿quién paga los créditos de este usuario? (recarga antes de mirar). Solo el servidor.
create or replace function public.v2_credit_available(p_user uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare o text;
begin
  perform v2_refill_credits(p_user);
  for o in select distinct w.owner_id from workspace_members m join workspaces w on w.id = m.workspace_id where m.user_id = p_user and w.owner_id <> p_user::text loop
    perform v2_refill_credits(o::uuid);
  end loop;
  return v2_credit_payer(p_user);
end $$;
revoke execute on function public.v2_refill_credits(uuid) from public, anon, authenticated;
revoke execute on function public.v2_credit_available(uuid) from public, anon, authenticated;

-- el resumen de la interfaz también recarga
create or replace function public.v2_my_plan() returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare uid uuid := auth.uid(); e jsonb; a credit_accounts; payer uuid; pa credit_accounts;
begin
  payer := v2_credit_available(uid);
  e := v2_entitlements(uid);
  select * into a from credit_accounts where user_id = uid;
  if payer is not null and payer <> uid then select * into pa from credit_accounts where user_id = payer; end if;
  return e || jsonb_build_object(
    'brands_used', (select count(*) from brands b join workspaces w on w.id = b.workspace_id where w.owner_id = uid::text),
    'seats_used', 1 + (select count(distinct m.user_id) from workspace_members m join workspaces w on w.id = m.workspace_id where w.owner_id = uid::text and m.user_id <> uid),
    'emails_used', (select count(*) from workspace_email_sends s join workspaces w on w.id = s.workspace_id where w.owner_id = uid::text and s.provider = 'musa' and s.created_at >= date_trunc('month', now())),
    'credits', jsonb_build_object('plan', coalesce(a.plan_credits, 0), 'pack', coalesce(a.pack_credits, 0), 'monthly', coalesce(a.plan_grant, 0), 'next_refill', a.next_refill,
      'team', case when pa.user_id is not null then pa.plan_credits + pa.pack_credits end));
end $$;
grant execute on function public.v2_my_plan() to authenticated;

-- cupo de correos con el Resend de Musa para un espacio (lo usa el servidor)
create or replace function public.v2_email_quota(p_workspace text) returns jsonb language plpgsql security definer set search_path = public as $$
declare owner text; lim int; used int;
begin
  select owner_id into owner from workspaces where id = p_workspace;
  if owner is null then return jsonb_build_object('limit', 0, 'used', 0); end if;
  lim := (v2_entitlements(owner::uuid)->>'emails')::int;
  select count(*) into used from workspace_email_sends s join workspaces w on w.id = s.workspace_id where w.owner_id = owner and s.provider = 'musa' and s.created_at >= date_trunc('month', now());
  return jsonb_build_object('limit', lim, 'used', used);
end $$;
revoke execute on function public.v2_email_quota(text) from public, anon, authenticated;
commit;
