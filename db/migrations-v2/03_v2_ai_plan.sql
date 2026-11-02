-- Plan de IA por usuario (2026-11-02).
--   byok     (por defecto): el usuario usa SOLO sus propias llaves (Configuración › Integraciones).
--   platform : el usuario puede usar las llaves de la plataforma (planes pagos de Musa) cuando no puso la suya.
-- El usuario no puede cambiarse el plan a sí mismo: solo service_role / admin.
alter table public.user_profiles add column if not exists ai_plan text not null default 'byok';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'user_profiles_ai_plan_check') then
    alter table public.user_profiles add constraint user_profiles_ai_plan_check check (ai_plan in ('byok','platform'));
  end if;
end $$;
create or replace function public.v2_guard_ai_plan() returns trigger language plpgsql as $$
begin
  if new.ai_plan is distinct from old.ai_plan and coalesce(auth.role(), '') in ('authenticated', 'anon') then
    raise exception 'ai_plan solo lo cambia Musa (plan de IA)';
  end if;
  return new;
end $$;
drop trigger if exists trg_user_profiles_ai_plan on public.user_profiles;
create trigger trg_user_profiles_ai_plan before update on public.user_profiles for each row execute function public.v2_guard_ai_plan();
notify pgrst, 'reload schema';
