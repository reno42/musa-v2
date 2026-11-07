-- Paywall con Creem + códigos de acceso gratis. Idempotente.
-- · platform_config.billing: { paywall: bool, referral_discount_code: text|null }. Con paywall apagado entra todo el mundo.
-- · access_codes: códigos que dan una cuenta gratis (p. ej. MUSAFREE). Se canjean en el registro o en la pantalla de planes.
-- · Tiene acceso: admin, plan pagado activo, cuenta corporativa o pase gratis (free_pass_at).
begin;
alter table public.user_profiles
  add column if not exists free_pass_at timestamptz,
  add column if not exists free_pass_code text;

-- las cuentas que ya existen no se quedan afuera cuando se encienda el cobro
update public.user_profiles set free_pass_at = now(), free_pass_code = 'EXISTENTE' where free_pass_at is null;

create table if not exists public.access_codes (
  code text primary key check (code ~ '^[A-Z0-9_-]{3,40}$'),
  note text,
  max_uses int,                 -- null = sin límite
  uses int not null default 0,
  expires_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.access_codes enable row level security;   -- sin políticas: solo el servidor y las funciones de abajo
insert into public.access_codes (code, note) values ('MUSAFREE', 'Cuenta gratis general') on conflict (code) do nothing;

insert into public.platform_config (key, value, updated_at)
values ('billing', jsonb_build_object('paywall', false, 'referral_discount_code', null), now())
on conflict (key) do nothing;

-- el usuario tampoco puede darse el pase gratis a mano
create or replace function public.v2_guard_ai_plan() returns trigger language plpgsql as $$
begin
  -- las funciones internas de Musa (canje de códigos) marcan la transacción con musa.trusted
  if coalesce(auth.role(), '') in ('authenticated', 'anon') and coalesce(current_setting('musa.trusted', true), '') <> '1' and (
       new.ai_plan is distinct from old.ai_plan
    or new.access_plan is distinct from old.access_plan
    or new.referral_code is distinct from old.referral_code
    or new.referred_by is distinct from old.referred_by
    or new.referred_at is distinct from old.referred_at
    or new.free_pass_at is distinct from old.free_pass_at
    or new.free_pass_code is distinct from old.free_pass_code) then
    raise exception 'Ese dato del perfil solo lo cambia Musa';
  end if;
  return new;
end $$;

create or replace function public.v2_is_platform_admin() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (value->'admins') ? lower(coalesce(auth.jwt()->>'email','')) from platform_config where key = 'launch'), false)
$$;

create or replace function public.v2_access_status() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cfg jsonb; uid uuid := auth.uid(); p record; sub boolean; adm boolean;
begin
  select value into cfg from platform_config where key = 'billing';
  adm := v2_is_platform_admin();
  select free_pass_at, access_plan into p from user_profiles where id = uid;
  sub := exists (select 1 from subscriptions where user_id = uid and status in ('active','trialing','past_due'));
  return jsonb_build_object(
    'paywall', coalesce((cfg->>'paywall')::boolean, false),
    'is_admin', adm,
    'subscribed', sub,
    'free_pass', p.free_pass_at is not null,
    'has_access', not coalesce((cfg->>'paywall')::boolean, false) or adm or sub or p.free_pass_at is not null or p.access_plan = 'corporate');
end $$;
grant execute on function public.v2_access_status() to authenticated;

create or replace function public.v2_redeem_access_code(p_code text) returns jsonb language plpgsql security definer set search_path = public as $$
declare c access_codes; k text := upper(regexp_replace(coalesce(p_code,''), '\s', '', 'g')); uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Inicia sesión'; end if;
  select * into c from access_codes where code = k for update;
  if c.code is null or not c.active then raise exception 'CODE_NOT_FOUND'; end if;
  if c.expires_at is not null and c.expires_at < now() then raise exception 'CODE_EXPIRED'; end if;
  if c.max_uses is not null and c.uses >= c.max_uses then raise exception 'CODE_USED_UP'; end if;
  if exists (select 1 from user_profiles where id = uid and free_pass_at is not null) then return v2_access_status(); end if;
  update access_codes set uses = uses + 1 where code = k;
  perform set_config('musa.trusted', '1', true);
  update user_profiles set free_pass_at = now(), free_pass_code = k where id = uid;
  return v2_access_status();
end $$;
grant execute on function public.v2_redeem_access_code(text) to authenticated;

-- admin: encender/apagar el cobro, código de descuento para referidos y códigos de acceso
create or replace function public.v2_billing_admin(p_action text, p jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if not v2_is_platform_admin() then raise exception 'Solo un administrador de la plataforma'; end if;
  if p_action = 'config' then
    update platform_config set value = value || (p - array(select jsonb_object_keys(p) except select unnest(array['paywall','referral_discount_code']))), updated_at = now() where key = 'billing';
  elsif p_action = 'code_upsert' then
    k := upper(regexp_replace(coalesce(p->>'code',''), '\s', '', 'g'));
    insert into access_codes (code, note, max_uses, expires_at, active)
    values (k, p->>'note', nullif(p->>'max_uses','')::int, nullif(p->>'expires_at','')::timestamptz, coalesce((p->>'active')::boolean, true))
    on conflict (code) do update set note = excluded.note, max_uses = excluded.max_uses, expires_at = excluded.expires_at, active = excluded.active;
  elsif p_action <> 'get' then raise exception 'Acción desconocida';
  end if;
  return jsonb_build_object(
    'config', (select value from platform_config where key = 'billing'),
    'codes', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at) from access_codes a), '[]'::jsonb));
end $$;
grant execute on function public.v2_billing_admin(text, jsonb) to authenticated;
commit;
