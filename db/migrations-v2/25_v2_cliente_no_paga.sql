-- ═══════════════════════════════════════════════════════════════════════════
-- Migración 25 — El cliente del portal NO paga.
--
-- Un invitado activo (brand_guests.status='activo') entra sin plan ni código:
-- el acceso se lo da su agencia, no una suscripción propia. Antes de esta
-- función, tras aceptar Términos le aparecía «Elige tu plan» (PlanGate) —
-- incidente 2026-11-06.
--
-- Coincide por uid O por email: la invitación se crea con el correo antes de
-- que exista la cuenta, y el lazy-link de /api/team/access escribe user_id en
-- el primer acceso. auth.users es legible desde funciones definer (precedente:
-- v2_is_platform_admin en la 20). Revocado o pendiente ⇒ sigue bloqueado.
--
-- Idempotente: create or replace sobre la definición de la 21. El grant
-- EXECUTE a authenticated (migración 18) sobrevive al replace.
--
-- CÓMO USARLO: Dashboard › SQL Editor → correr. Éxito = "Success. No rows
-- returned". Verificación: select v2_access_status(); con sesión de un
-- invitado activo debe devolver guest=true y has_access=true.
-- Ejecutado: (pendiente)
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.v2_access_status() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cfg jsonb; uid uuid := auth.uid(); p record; sub boolean; adm boolean; gst boolean;
begin
  select value into cfg from platform_config where key = 'billing';
  adm := v2_is_platform_admin();
  select free_pass_at, access_plan into p from user_profiles where id = uid;
  sub := exists (select 1 from subscriptions s join billing_plans bp on bp.code = s.plan_code where s.user_id = uid and s.status in ('active','trialing','past_due') and bp.kind = 'plan');
  gst := uid is not null and exists (
    select 1 from brand_guests g
    where g.status = 'activo'
      and (g.user_id = uid
           or lower(g.email) = lower(coalesce((select email from auth.users where id = uid), '')))
  );
  return jsonb_build_object(
    'paywall', coalesce((cfg->>'paywall')::boolean, false),
    'is_admin', adm, 'subscribed', sub, 'free_pass', p.free_pass_at is not null,
    'guest', gst,
    'has_access', not coalesce((cfg->>'paywall')::boolean, false) or adm or sub or p.free_pass_at is not null or p.access_plan = 'corporate' or gst);
end $$;
