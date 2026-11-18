-- 46_v2_clones_musa_almacenamiento.sql — REQ-072: tope de almacenamiento de los clones Musa
-- para no pasar nunca de lo gratis de R2 (10 GB). Aplicar SOLO en lnbs (musa-v2). Idempotente.

alter table public.musa_clon_jobs add column if not exists bytes bigint not null default 0;
alter table public.workspace_clones add column if not exists bytes bigint not null default 0;

-- Bytes guardados por un espacio y en total (fuentes + retratos + videos de clones Musa)
create or replace function public.musa_clon_bytes(p_ws text)
returns table (espacio bigint, total bigint)
language sql stable security definer set search_path = public as $$
  select
    coalesce((select sum(bytes) from public.workspace_clones where provider = 'musa' and workspace_id = p_ws), 0)
      + coalesce((select sum(bytes) from public.musa_clon_jobs where workspace_id = p_ws), 0),
    coalesce((select sum(bytes) from public.workspace_clones where provider = 'musa'), 0)
      + coalesce((select sum(bytes) from public.musa_clon_jobs), 0);
$$;
revoke all on function public.musa_clon_bytes(text) from public, anon, authenticated;
grant execute on function public.musa_clon_bytes(text) to service_role;
