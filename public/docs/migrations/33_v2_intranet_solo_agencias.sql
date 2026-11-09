-- 33_v2_intranet_solo_agencias.sql — la intranet de clientes es solo para agencias
--
-- Decisión de producto (2026-11-09): un cliente solo ve lo suyo, y solo una AGENCIA puede darle
-- intranet/portal a sus clientes. Un freelance (espacio personal) no tiene intranet de clientes:
-- para tenerla abre una agencia, aunque sea de una sola persona.
--
-- Todos los permisos de invitado pasan por musa_guest_brand_ids (políticas *_ag_guest_read,
-- brand_portal_read, content_comments_read…), así que basta con exigir aquí que el espacio sea agencia.
-- Los accesos de clientes de un espacio personal quedan guardados (no se borran): vuelven a funcionar
-- si esas marcas se mueven a una agencia.
-- Idempotente.

create or replace function public.musa_ws_is_agency(p_ws text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (w.data->>'kind') = 'agency' from public.workspaces w where w.id = p_ws), false)
$$;

create or replace function public.musa_guest_brand_ids(p_user uuid, p_ws text)
returns text[] language sql stable as $$
  select case when public.musa_ws_is_agency(p_ws) then
    coalesce((select array_agg(distinct brand_id) filter (where brand_id is not null)
              from public.brand_guests
              where user_id = p_user and workspace_id = p_ws and status = 'activo'), '{}')
  else '{}'::text[] end;
$$;

create or replace function public.v2_access_status()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare cfg jsonb; uid uuid := auth.uid(); p record; sub boolean; adm boolean; gst boolean;
begin
  select value into cfg from platform_config where key = 'billing';
  adm := v2_is_platform_admin();
  select free_pass_at, access_plan into p from user_profiles where id = uid;
  sub := exists (select 1 from subscriptions s join billing_plans bp on bp.code = s.plan_code where s.user_id = uid and s.status in ('active','trialing','past_due') and bp.kind = 'plan');
  -- solo cuenta como cliente quien tiene acceso a una marca de una AGENCIA
  gst := uid is not null and exists (
    select 1 from brand_guests g
    where g.status = 'activo' and public.musa_ws_is_agency(g.workspace_id)
      and (g.user_id = uid
           or lower(g.email) = lower(coalesce((select email from auth.users where id = uid), '')))
  );
  return jsonb_build_object(
    'paywall', coalesce((cfg->>'paywall')::boolean, false),
    'is_admin', adm, 'subscribed', sub, 'free_pass', p.free_pass_at is not null,
    'guest', gst,
    'has_access', not coalesce((cfg->>'paywall')::boolean, false) or adm or sub or p.free_pass_at is not null or p.access_plan = 'corporate' or gst);
end $function$;

revoke all on function public.musa_ws_is_agency(text) from public, anon;
grant execute on function public.musa_ws_is_agency(text) to authenticated, service_role;
