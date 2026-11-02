-- El usuario edita su perfil, pero no su plan (IA ni acceso) ni su atribución de referido: eso lo cambian Musa y los cobros.
begin;
create or replace function public.v2_guard_ai_plan() returns trigger language plpgsql as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon') and (
       new.ai_plan is distinct from old.ai_plan
    or new.access_plan is distinct from old.access_plan
    or new.referral_code is distinct from old.referral_code
    or new.referred_by is distinct from old.referred_by
    or new.referred_at is distinct from old.referred_at) then
    raise exception 'Ese dato del perfil solo lo cambia Musa';
  end if;
  return new;
end $$;
commit;
