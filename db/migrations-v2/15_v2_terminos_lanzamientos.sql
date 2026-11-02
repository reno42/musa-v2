-- Términos en el registro (reemplaza el acuerdo alfa) y lanzamientos por módulo. Idempotente.
begin;
alter table public.user_profiles
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text;
-- quienes ya aceptaron el acuerdo alfa quedan con los términos aceptados
update public.user_profiles set terms_accepted_at = nda_accepted_at, terms_version = coalesce(terms_version, 'alfa')
  where terms_accepted_at is null and nda_accepted_at is not null;

-- lanzamientos: qué módulos ve la gente; los admins ven todo para preparar el siguiente lanzamiento
insert into public.platform_config (key, value, updated_at)
values ('launch', jsonb_build_object(
  'modules', jsonb_build_array('inicio','planear','crear','conversar','anunciar','vender','clientes','agentes','medir','configuracion','organizacion','portal'),
  'hidden_subs', '[]'::jsonb,
  'admins', jsonb_build_array('renzo@futuraria.com','renzoperezbartra123@gmail.com','renzoperez@futuraria.com'),
  'schedule', '[]'::jsonb), now())
on conflict (key) do nothing;

create or replace function public.v2_launch_config() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select value - 'admins' || jsonb_build_object('is_admin', coalesce((value->'admins') ? lower(coalesce(auth.jwt()->>'email','')), false))
    from platform_config where key = 'launch'), '{}'::jsonb)
$$;
grant execute on function public.v2_launch_config() to anon, authenticated;

create or replace function public.v2_set_launch(p_modules jsonb, p_hidden_subs jsonb default null, p_schedule jsonb default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare cfg jsonb;
begin
  select value into cfg from platform_config where key = 'launch';
  if cfg is null or not coalesce((cfg->'admins') ? lower(coalesce(auth.jwt()->>'email','')), false) then
    raise exception 'Solo un administrador de la plataforma puede cambiar los lanzamientos';
  end if;
  if jsonb_typeof(p_modules) <> 'array' then raise exception 'modules debe ser una lista'; end if;
  cfg := cfg || jsonb_build_object('modules', p_modules);
  if p_hidden_subs is not null then cfg := cfg || jsonb_build_object('hidden_subs', p_hidden_subs); end if;
  if p_schedule is not null then cfg := cfg || jsonb_build_object('schedule', p_schedule); end if;
  update platform_config set value = cfg, updated_at = now() where key = 'launch';
  return cfg - 'admins';
end $$;
grant execute on function public.v2_set_launch(jsonb, jsonb, jsonb) to authenticated;
commit;
