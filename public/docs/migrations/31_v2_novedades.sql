-- 31_v2_novedades — La campana de la barra superior: novedades de Musa para todas las personas.
-- product_news: cada novedad (la publica un admin de la plataforma; la ven todas las cuentas a la vez).
-- product_news_reads: qué leyó cada persona (una fila por persona y novedad). Así el número de la
-- campana es por persona: lo que se publicó y esa persona todavía no abrió.
-- Una cuenta nueva no hereda como "sin leer" lo publicado más de 14 días antes de crearse.
-- Idempotente.

create table if not exists public.product_news (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 140),
  body text not null default '' check (char_length(body) <= 4000),
  tag text not null default 'novedad' check (tag in ('novedad', 'mejora', 'arreglo', 'aviso')),
  link text check (link is null or link ~ '^(https://|#)'),
  published_at timestamptz not null default now(),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists product_news_published_idx on public.product_news (published_at desc) where active;

create table if not exists public.product_news_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  news_id uuid not null references public.product_news(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (user_id, news_id)
);

alter table public.product_news enable row level security;
alter table public.product_news_reads enable row level security;

drop policy if exists product_news_read on public.product_news;
create policy product_news_read on public.product_news for select to authenticated
  using (active and published_at <= now());

drop policy if exists product_news_reads_own on public.product_news_reads;
create policy product_news_reads_own on public.product_news_reads for select to authenticated
  using (user_id = auth.uid());
-- escribir lecturas y novedades solo por las funciones de abajo
revoke insert, update, delete on public.product_news from anon, authenticated;
revoke insert, update, delete on public.product_news_reads from anon, authenticated;
revoke all on public.product_news, public.product_news_reads from anon;

-- Lo que muestra la campana: últimas 30 novedades con leída / sin leer, y el total sin leer.
create or replace function public.v2_news_feed() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); since timestamptz; items jsonb; unread int;
begin
  if uid is null then raise exception 'Inicia sesión'; end if;
  select coalesce(created_at, now()) - interval '14 days' into since from auth.users where id = uid;
  with n as (
    select p.*, (r.news_id is not null or p.published_at < since) as is_read
      from product_news p left join product_news_reads r on r.news_id = p.id and r.user_id = uid
     where p.active and p.published_at <= now()
     order by p.published_at desc limit 30
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'body', body, 'tag', tag, 'link', link,
           'published_at', published_at, 'read', is_read) order by published_at desc), '[]'::jsonb),
         count(*) filter (where not is_read)
    into items, unread from n;
  return jsonb_build_object('items', items, 'unread', unread, 'is_admin', v2_is_platform_admin());
end $$;

-- Marcar como leídas: una lista de ids, o todas si viene null.
create or replace function public.v2_news_read(p_ids uuid[] default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Inicia sesión'; end if;
  insert into product_news_reads (user_id, news_id)
    select uid, p.id from product_news p
     where p.active and p.published_at <= now() and (p_ids is null or p.id = any (p_ids))
  on conflict do nothing;
  return v2_news_feed();
end $$;

-- Publicar, editar o quitar (solo admins de la plataforma).
create or replace function public.v2_news_admin(p_action text, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if not v2_is_platform_admin() then raise exception 'Solo un administrador de la plataforma'; end if;
  if p_action = 'upsert' then
    if coalesce(trim(p->>'title'), '') = '' then raise exception 'Falta el título'; end if;
    if nullif(p->>'id', '') is null then
      insert into product_news (title, body, tag, link, published_at, created_by)
      values (trim(p->>'title'), coalesce(p->>'body', ''), coalesce(nullif(p->>'tag', ''), 'novedad'), nullif(trim(p->>'link'), ''),
              coalesce((p->>'published_at')::timestamptz, now()), auth.uid())
      returning id into rid;
    else
      update product_news set title = trim(p->>'title'), body = coalesce(p->>'body', ''), tag = coalesce(nullif(p->>'tag', ''), 'novedad'),
             link = nullif(trim(p->>'link'), ''), updated_at = now()
       where id = (p->>'id')::uuid returning id into rid;
    end if;
    return jsonb_build_object('id', rid);
  elsif p_action = 'remove' then
    update product_news set active = false, updated_at = now() where id = (p->>'id')::uuid;
    return jsonb_build_object('ok', true);
  end if;
  raise exception 'Acción desconocida: %', p_action;
end $$;

revoke all on function public.v2_news_feed() from public, anon;
revoke all on function public.v2_news_read(uuid[]) from public, anon;
revoke all on function public.v2_news_admin(text, jsonb) from public, anon;
grant execute on function public.v2_news_feed() to authenticated;
grant execute on function public.v2_news_read(uuid[]) to authenticated;
grant execute on function public.v2_news_admin(text, jsonb) to authenticated;
