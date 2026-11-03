-- Planes por valor (Creador / Agencia / Empresa × BYOK / IA de Musa), oferta de 3 meses, invitados 4 meses,
-- créditos de IA, personas extra, paquetes de créditos y límites (personas, marcas, correos). Idempotente salvo los inserts de planes.
begin;

-- ── planes ──
alter table public.billing_plans drop constraint if exists billing_plans_segment_check;
alter table public.billing_plans add constraint billing_plans_segment_check check (segment in ('personal','freelance','agencia','corp','creador','empresa','addon'));
alter table public.billing_plans
  add column if not exists kind text not null default 'plan' check (kind in ('plan','seat','pack')),
  add column if not exists credits_month int not null default 0,      -- créditos de IA que se recargan cada mes
  add column if not exists intro_credits int,                          -- créditos durante la oferta de los primeros meses
  add column if not exists seats int,                                  -- personas incluidas
  add column if not exists brands int,                                 -- marcas (null = ilimitadas)
  add column if not exists emails_month int,                           -- correos al mes enviados con el Resend de Musa
  add column if not exists intro_price_usd numeric,                    -- precio de la oferta (solo para mostrar; el descuento vive en Creem)
  add column if not exists intro_months int,
  add column if not exists annual_of text,                             -- el anual apunta a su mensual
  add column if not exists pack_credits int;                           -- créditos que da un paquete

-- los códigos de descuento de las ofertas no se publican (billing_plans se lee sin sesión)
create table if not exists public.billing_discounts (
  plan_code text not null references public.billing_plans(code) on delete cascade,
  kind text not null check (kind in ('intro','ref')),   -- intro = cuenta nueva (3 meses) · ref = llegó invitado (4 meses)
  code text not null,
  months int not null,
  primary key (plan_code, kind)
);
alter table public.billing_discounts enable row level security;

alter table public.subscriptions
  add column if not exists paid_count int not null default 0,
  add column if not exists last_transaction_id text,
  add column if not exists units int not null default 1,
  add column if not exists intro boolean not null default false,
  add column if not exists founder boolean not null default false;

-- fundadores: quien se suscribe antes de esta fecha tiene su precio congelado y créditos dobles los 3 primeros meses
update public.platform_config set value = value || jsonb_build_object('founder_until', coalesce(value->>'founder_until', '2027-01-31')), updated_at = now() where key = 'billing';
update public.platform_config set value = value - 'referral_discount_code' where key = 'billing';

-- ── créditos ──
create table if not exists public.credit_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_credits numeric not null default 0,    -- se reinician en cada renovación
  pack_credits numeric not null default 0,    -- paquetes y premios: no vencen
  updated_at timestamptz not null default now()
);
alter table public.credit_accounts enable row level security;
drop policy if exists credit_accounts_own on public.credit_accounts;
create policy credit_accounts_own on public.credit_accounts for select to authenticated using (user_id = auth.uid());
grant select on public.credit_accounts to authenticated;

create table if not exists public.credit_ledger (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid,
  delta numeric not null,
  reason text not null,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_credit_ledger_user on public.credit_ledger (user_id, created_at desc);
alter table public.credit_ledger enable row level security;
drop policy if exists credit_ledger_own on public.credit_ledger;
create policy credit_ledger_own on public.credit_ledger for select to authenticated using (user_id = auth.uid() or actor_id = auth.uid());
grant select on public.credit_ledger to authenticated;

-- quién paga los créditos de un usuario: él mismo, o el dueño de un espacio donde es miembro
create or replace function public.v2_credit_payer(p_user uuid) returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select user_id from credit_accounts where user_id = p_user and plan_credits + pack_credits > 0),
    (select w.owner_id::uuid from workspace_members m join workspaces w on w.id = m.workspace_id join credit_accounts c on c.user_id::text = w.owner_id
      where m.user_id = p_user and w.owner_id <> p_user::text and c.plan_credits + c.pack_credits > 0 order by m.joined_at nulls last limit 1))
$$;

-- cobra créditos (solo el servidor). Gasta primero los del plan y luego los de paquetes; puede quedar levemente en negativo.
create or replace function public.v2_charge_credits(p_user uuid, p_amount numeric, p_reason text, p_meta jsonb default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare payer uuid := v2_credit_payer(p_user); a credit_accounts; from_plan numeric;
begin
  if payer is null then return jsonb_build_object('ok', false); end if;
  select * into a from credit_accounts where user_id = payer for update;
  from_plan := least(greatest(a.plan_credits, 0), p_amount);
  update credit_accounts set plan_credits = plan_credits - from_plan, pack_credits = pack_credits - (p_amount - from_plan), updated_at = now() where user_id = payer;
  insert into credit_ledger (user_id, actor_id, delta, reason, meta) values (payer, p_user, -p_amount, p_reason, p_meta);
  return jsonb_build_object('ok', true, 'payer', payer, 'remaining', a.plan_credits + a.pack_credits - p_amount);
end $$;

-- recarga: p_plan reemplaza los créditos del plan (null = no tocar); p_pack se suma
create or replace function public.v2_grant_credits(p_user uuid, p_plan numeric, p_pack numeric, p_reason text, p_meta jsonb default null) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into credit_accounts (user_id, plan_credits, pack_credits) values (p_user, coalesce(p_plan, 0), coalesce(p_pack, 0))
  on conflict (user_id) do update set plan_credits = coalesce(p_plan, credit_accounts.plan_credits), pack_credits = credit_accounts.pack_credits + coalesce(p_pack, 0), updated_at = now();
  insert into credit_ledger (user_id, delta, reason, meta) values (p_user, coalesce(p_plan, 0) + coalesce(p_pack, 0), p_reason, p_meta);
end $$;
revoke execute on function public.v2_charge_credits(uuid, numeric, text, jsonb) from public, anon, authenticated;
revoke execute on function public.v2_grant_credits(uuid, numeric, numeric, text, jsonb) from public, anon, authenticated;
revoke execute on function public.v2_credit_payer(uuid) from public, anon, authenticated;

-- ── lo que permite la cuenta ──
-- null en seats/brands/emails = sin límite. Cuentas previas (EXISTENTE), corporativas y admins: sin límite.
create or replace function public.v2_entitlements(p_user uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare pr record; pl record; extra int; cfg jsonb; adm boolean;
begin
  select value into cfg from platform_config where key = 'billing';
  select coalesce((value->'admins') ? lower(coalesce((select email from auth.users where id = p_user), '')), false) into adm from platform_config where key = 'launch';
  select free_pass_at, free_pass_code, access_plan into pr from user_profiles where id = p_user;
  select bp.* into pl from subscriptions s join billing_plans bp on bp.code = s.plan_code
    where s.user_id = p_user and s.status in ('active','trialing','past_due') and bp.kind = 'plan' order by bp.price_usd desc limit 1;
  select coalesce(sum(s.units), 0) into extra from subscriptions s join billing_plans bp on bp.code = s.plan_code
    where s.user_id = p_user and s.status in ('active','trialing','past_due') and bp.kind = 'seat';
  if pl.code is not null then
    return jsonb_build_object('tier', pl.segment, 'mode', pl.mode, 'plan', pl.code, 'seats', pl.seats + extra, 'brands', pl.brands, 'emails', pl.emails_month);
  end if;
  if coalesce(adm, false) or pr.free_pass_code = 'EXISTENTE' or pr.access_plan = 'corporate' or not coalesce((cfg->>'paywall')::boolean, false) then
    return jsonb_build_object('tier', 'ilimitado', 'mode', 'byok', 'seats', null, 'brands', null, 'emails', null);
  end if;
  -- cuenta gratis con código (o sin acceso todavía)
  return jsonb_build_object('tier', 'gratis', 'mode', 'byok', 'seats', 1, 'brands', 1, 'emails', 100);
end $$;
revoke execute on function public.v2_entitlements(uuid) from public, anon;
grant execute on function public.v2_entitlements(uuid) to authenticated;

-- resumen para la interfaz: plan, uso y créditos de quien pregunta
create or replace function public.v2_my_plan() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); e jsonb; a credit_accounts; payer uuid; pa credit_accounts;
begin
  e := v2_entitlements(uid);
  select * into a from credit_accounts where user_id = uid;
  payer := v2_credit_payer(uid);
  if payer is not null and payer <> uid then select * into pa from credit_accounts where user_id = payer; end if;
  return e || jsonb_build_object(
    'brands_used', (select count(*) from brands b join workspaces w on w.id = b.workspace_id where w.owner_id = uid::text),
    'seats_used', 1 + (select count(distinct m.user_id) from workspace_members m join workspaces w on w.id = m.workspace_id where w.owner_id = uid::text and m.user_id <> uid),
    'emails_used', (select count(*) from workspace_email_sends s join workspaces w on w.id = s.workspace_id where w.owner_id = uid::text and s.provider = 'musa' and s.created_at >= date_trunc('month', now())),
    'credits', jsonb_build_object('plan', coalesce(a.plan_credits, 0), 'pack', coalesce(a.pack_credits, 0), 'team', case when pa.user_id is not null then pa.plan_credits + pa.pack_credits end));
end $$;
grant execute on function public.v2_my_plan() to authenticated;

-- límite de marcas: cuenta las marcas de todos los espacios del dueño
create or replace function public.v2_guard_brand_limit() returns trigger language plpgsql security definer set search_path = public as $$
declare owner text; lim int;
begin
  if coalesce(current_setting('musa.trusted', true), '') = '1' then return new; end if;
  select owner_id into owner from workspaces where id = new.workspace_id;
  if owner is null then return new; end if;
  lim := (v2_entitlements(owner::uuid)->>'brands')::int;
  if lim is not null and (select count(*) from brands b join workspaces w on w.id = b.workspace_id where w.owner_id = owner) >= lim then
    raise exception 'LIMIT_BRANDS: tu plan permite % marcas. Mejora tu plan para agregar más.', lim;
  end if;
  return new;
end $$;
drop trigger if exists trg_brand_limit on public.brands;
create trigger trg_brand_limit before insert on public.brands for each row execute function public.v2_guard_brand_limit();

-- límite de personas: el dueño + personas distintas en todos sus espacios
create or replace function public.v2_guard_seat_limit() returns trigger language plpgsql security definer set search_path = public as $$
declare owner text; lim int;
begin
  if coalesce(current_setting('musa.trusted', true), '') = '1' then return new; end if;
  select owner_id into owner from workspaces where id = new.workspace_id;
  if owner is null or new.user_id::text = owner then return new; end if;
  if exists (select 1 from workspace_members m join workspaces w on w.id = m.workspace_id where w.owner_id = owner and m.user_id = new.user_id) then return new; end if;
  lim := (v2_entitlements(owner::uuid)->>'seats')::int;
  if lim is not null and 1 + (select count(distinct m.user_id) from workspace_members m join workspaces w on w.id = m.workspace_id where w.owner_id = owner and m.user_id::text <> owner) >= lim then
    raise exception 'LIMIT_SEATS: tu plan incluye % personas. Agrega personas extra desde Configuración.', lim;
  end if;
  return new;
end $$;
drop trigger if exists trg_seat_limit on public.workspace_members;
create trigger trg_seat_limit before insert on public.workspace_members for each row execute function public.v2_guard_seat_limit();

-- código de acceso gratis: 10 créditos de bienvenida, una sola vez
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
  perform v2_grant_credits(uid, null, 10, 'bienvenida', jsonb_build_object('code', k));
  return v2_access_status();
end $$;

-- los planes viejos (sin suscripciones) se reemplazan
delete from public.billing_plans where code in ('freelance_byok_m','freelance_ia_m','agencia_byok_m','agencia_ia_m','corp_ia_m') and not exists (select 1 from subscriptions s where s.plan_code = billing_plans.code);
insert into public.billing_plans (code,name,mode,segment,interval,price_usd,creem_product_id,kind,credits_month,intro_credits,seats,brands,emails_month,intro_price_usd,intro_months,entitlements,annual_of,pack_credits,active,sort) values ('creador_byok_m','Musa Creador','byok','creador','month',79,'prod_FmeiDRP1aygnEIvyJ25LJ','plan',50,'50',1,'5',2000,'19','3','{"features": ["1 persona", "5 marcas", "Todos los módulos", "Tus llaves de IA (BYOK)", "50 créditos de prueba al mes", "2.000 correos al mes"]}'::jsonb,null,null,true,10);
insert into public.billing_plans (code,name,mode,segment,interval,price_usd,creem_product_id,kind,credits_month,intro_credits,seats,brands,emails_month,intro_price_usd,intro_months,entitlements,annual_of,pack_credits,active,sort) values ('creador_byok_y','Musa Creador','byok','creador','year',790,'prod_6xwMV8LpAigZ5HuuemityB','plan',50,null,1,'5',2000,null,null,'{"features": ["1 persona", "5 marcas", "Todos los módulos", "Tus llaves de IA (BYOK)", "50 créditos de prueba al mes", "2.000 correos al mes"]}'::jsonb,'creador_byok_m',null,true,11);
insert into public.billing_plans (code,name,mode,segment,interval,price_usd,creem_product_id,kind,credits_month,intro_credits,seats,brands,emails_month,intro_price_usd,intro_months,entitlements,annual_of,pack_credits,active,sort) values ('creador_ia_m','Musa Creador IA','musa_ia','creador','month',119,'prod_4zJ9EBpPflwJlh0MrWqzc1','plan',600,'300',1,'5',1000,'29','3','{"features": ["1 persona", "5 marcas", "Todos los módulos", "600 créditos de IA al mes", "1.000 correos al mes"]}'::jsonb,null,null,true,20);
insert into public.billing_plans (code,name,mode,segment,interval,price_usd,creem_product_id,kind,credits_month,intro_credits,seats,brands,emails_month,intro_price_usd,intro_months,entitlements,annual_of,pack_credits,active,sort) values ('creador_ia_y','Musa Creador IA','musa_ia','creador','year',1190,'prod_6w4fG89InW6pqcffBloahE','plan',600,null,1,'5',1000,null,null,'{"features": ["1 persona", "5 marcas", "Todos los módulos", "600 créditos de IA al mes", "1.000 correos al mes"]}'::jsonb,'creador_ia_m',null,true,21);
insert into public.billing_plans (code,name,mode,segment,interval,price_usd,creem_product_id,kind,credits_month,intro_credits,seats,brands,emails_month,intro_price_usd,intro_months,entitlements,annual_of,pack_credits,active,sort) values ('agencia_byok_m','Musa Agencia','byok','agencia','month',349,'prod_2SelAK56RMF13bSewOVqRq','plan',200,'200',5,'25',15000,'149','3','{"features": ["5 personas", "25 marcas", "Portal de clientes", "Roles de equipo", "Tus llaves de IA (BYOK)", "200 créditos de prueba al mes", "15.000 correos al mes"]}'::jsonb,null,null,true,30);
insert into public.billing_plans (code,name,mode,segment,interval,price_usd,creem_product_id,kind,credits_month,intro_credits,seats,brands,emails_month,intro_price_usd,intro_months,entitlements,annual_of,pack_credits,active,sort) values ('agencia_byok_y','Musa Agencia','byok','agencia','year',3490,'prod_2ULGEv89kusSDSImo31Gc8','plan',200,null,5,'25',15000,null,null,'{"features": ["5 personas", "25 marcas", "Portal de clientes", "Roles de equipo", "Tus llaves de IA (BYOK)", "200 créditos de prueba al mes", "15.000 correos al mes"]}'::jsonb,'agencia_byok_m',null,true,31);
insert into public.billing_plans (code,name,mode,segment,interval,price_usd,creem_product_id,kind,credits_month,intro_credits,seats,brands,emails_month,intro_price_usd,intro_months,entitlements,annual_of,pack_credits,active,sort) values ('agencia_ia_m','Musa Agencia IA','musa_ia','agencia','month',499,'prod_6duBxn04VIxht828PrsB2K','plan',3000,'1000',5,'25',15000,'199','3','{"features": ["5 personas", "25 marcas", "Portal de clientes", "Roles de equipo", "3.000 créditos de IA al mes", "15.000 correos al mes"]}'::jsonb,null,null,true,40);
insert into public.billing_plans (code,name,mode,segment,interval,price_usd,creem_product_id,kind,credits_month,intro_credits,seats,brands,emails_month,intro_price_usd,intro_months,entitlements,annual_of,pack_credits,active,sort) values ('agencia_ia_y','Musa Agencia IA','musa_ia','agencia','year',4990,'prod_7Kgt0CVGjSbuaT3V8AMn7p','plan',3000,null,5,'25',15000,null,null,'{"features": ["5 personas", "25 marcas", "Portal de clientes", "Roles de equipo", "3.000 créditos de IA al mes", "15.000 correos al mes"]}'::jsonb,'agencia_ia_m',null,true,41);
insert into public.billing_plans (code,name,mode,segment,interval,price_usd,creem_product_id,kind,credits_month,intro_credits,seats,brands,emails_month,intro_price_usd,intro_months,entitlements,annual_of,pack_credits,active,sort) values ('empresa_ia_m','Musa Empresa','musa_ia','empresa','month',1490,'prod_2TXCQ5FqCUJAx9C52lbDya','plan',10000,null,15,null,50000,null,null,'{"features": ["15 personas", "Marcas ilimitadas", "Áreas y aprobaciones", "Soporte prioritario", "10.000 créditos de IA al mes", "50.000 correos al mes"]}'::jsonb,null,null,true,50);
insert into public.billing_plans (code,name,mode,segment,interval,price_usd,creem_product_id,kind,credits_month,intro_credits,seats,brands,emails_month,intro_price_usd,intro_months,entitlements,annual_of,pack_credits,active,sort) values ('empresa_ia_y','Musa Empresa','musa_ia','empresa','year',14900,'prod_5xYyfc7AUqvIn4lj7PBtl8','plan',10000,null,15,null,50000,null,null,'{"features": ["15 personas", "Marcas ilimitadas", "Áreas y aprobaciones", "Soporte prioritario", "10.000 créditos de IA al mes", "50.000 correos al mes"]}'::jsonb,'empresa_ia_m',null,true,51);
insert into public.billing_plans (code,name,mode,segment,interval,price_usd,creem_product_id,kind,credits_month,intro_credits,seats,brands,emails_month,intro_price_usd,intro_months,entitlements,annual_of,pack_credits,active,sort) values ('seat_byok_m','Persona extra','byok','addon','month',49,'prod_3YvcUaZWk6eb7h6X9XPrkz','seat',0,null,1,'0',0,null,null,'{}'::jsonb,null,null,true,60);
insert into public.billing_plans (code,name,mode,segment,interval,price_usd,creem_product_id,kind,credits_month,intro_credits,seats,brands,emails_month,intro_price_usd,intro_months,entitlements,annual_of,pack_credits,active,sort) values ('seat_byok_y','Persona extra','byok','addon','year',490,'prod_W7sMUwekwKcmLObViNuXA','seat',0,null,1,'0',0,null,null,'{}'::jsonb,null,null,true,61);
insert into public.billing_plans (code,name,mode,segment,interval,price_usd,creem_product_id,kind,credits_month,intro_credits,seats,brands,emails_month,intro_price_usd,intro_months,entitlements,annual_of,pack_credits,active,sort) values ('seat_ia_m','Persona extra','musa_ia','addon','month',69,'prod_2Kam4vP2jlh9GAY1zbllTB','seat',150,null,1,'0',0,null,null,'{}'::jsonb,null,null,true,62);
insert into public.billing_plans (code,name,mode,segment,interval,price_usd,creem_product_id,kind,credits_month,intro_credits,seats,brands,emails_month,intro_price_usd,intro_months,entitlements,annual_of,pack_credits,active,sort) values ('seat_ia_y','Persona extra','musa_ia','addon','year',690,'prod_7SvqijnUoc4zz3bbWT8Isg','seat',150,null,1,'0',0,null,null,'{}'::jsonb,null,null,true,63);
insert into public.billing_plans (code,name,mode,segment,interval,price_usd,creem_product_id,kind,credits_month,intro_credits,seats,brands,emails_month,intro_price_usd,intro_months,entitlements,annual_of,pack_credits,active,sort) values ('pack_500','500 créditos','musa_ia','addon','once',45,'prod_1Lhsk8PHwWbXo47Dl3amw7','pack',0,null,0,'0',0,null,null,'{}'::jsonb,null,'500',true,70);
insert into public.billing_plans (code,name,mode,segment,interval,price_usd,creem_product_id,kind,credits_month,intro_credits,seats,brands,emails_month,intro_price_usd,intro_months,entitlements,annual_of,pack_credits,active,sort) values ('pack_2000','2.000 créditos','musa_ia','addon','once',160,'prod_6x5HFfIaCEhu6UCRo4y4yD','pack',0,null,0,'0',0,null,null,'{}'::jsonb,null,'2000',true,71);
insert into public.billing_discounts (plan_code,kind,code,months) values ('creador_byok_m','intro','M3CRBY6A4D45',3);
insert into public.billing_discounts (plan_code,kind,code,months) values ('creador_byok_m','ref','M4CRBY1BDFFE',4);
insert into public.billing_discounts (plan_code,kind,code,months) values ('creador_ia_m','intro','M3CRIAC42E4C',3);
insert into public.billing_discounts (plan_code,kind,code,months) values ('creador_ia_m','ref','M4CRIA0D5E3C',4);
insert into public.billing_discounts (plan_code,kind,code,months) values ('agencia_byok_m','intro','M3AGBY552BA4',3);
insert into public.billing_discounts (plan_code,kind,code,months) values ('agencia_byok_m','ref','M4AGBY5B500E',4);
insert into public.billing_discounts (plan_code,kind,code,months) values ('agencia_ia_m','intro','M3AGIA6AFA83',3);
insert into public.billing_discounts (plan_code,kind,code,months) values ('agencia_ia_m','ref','M4AGIA9C8A7A',4);
commit;
