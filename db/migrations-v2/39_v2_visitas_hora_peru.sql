-- 39_v2_visitas_hora_peru.sql — Websites › Visitas cuenta por día en hora de Perú (UTC−5, sin horario de verano).
-- Antes el día salía de current_date (UTC): una visita a las 9 p. m. en Lima quedaba en el día siguiente y la
-- serie terminaba «mañana». Idempotente.
create or replace function public.v2_site_hit(p_site text, p_path text, p_ref text) returns void
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'America/Lima')::date;
begin
  insert into website_stats (website_id, day, path, views) values (p_site, d, left(coalesce(p_path, '/'), 300), 1)
    on conflict (website_id, day, path) do update set views = website_stats.views + 1;
  if coalesce(p_ref, '') <> '' then
    insert into website_refs (website_id, day, ref, views) values (p_site, d, left(p_ref, 200), 1)
      on conflict (website_id, day, ref) do update set views = website_refs.views + 1;
  end if;
end $$;
revoke all on function public.v2_site_hit(text, text, text) from public, anon, authenticated;
