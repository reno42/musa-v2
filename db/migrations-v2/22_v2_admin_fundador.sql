-- El panel de admin también guarda la fecha límite del precio fundador.
begin;
create or replace function public.v2_billing_admin(p_action text, p jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if not v2_is_platform_admin() then raise exception 'Solo un administrador de la plataforma'; end if;
  if p_action = 'config' then
    update platform_config set value = value || (p - array(select jsonb_object_keys(p) except select unnest(array['paywall','founder_until']))), updated_at = now() where key = 'billing';
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
commit;
