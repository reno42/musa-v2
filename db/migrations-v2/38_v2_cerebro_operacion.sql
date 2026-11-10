-- 38_v2_cerebro_operacion.sql — Segundo cerebro: cómo opera cada persona en Musa
--
-- brain_events registra TODO lo que pasa en un espacio, por persona: qué pantallas abre y cuánto tiempo
-- trabaja en cada una, qué crea, edita, publica, envía o borra en cualquier módulo (lo anota el servidor
-- en el único paso por el que pasan los datos: /rest/v1, /api y /mcp), y qué hace su IA por MCP (cada
-- herramienta, con qué resultado y en cuánto tiempo). Con eso las IAs leen el perfil de operación
-- (brain_operator) y aprenden de las correcciones de su humano (brain_learn).
--
-- Solo el servidor escribe (función brain_track con service_role); cada persona lee únicamente sus
-- propios eventos. Las acciones repetidas (autoguardado, varias ediciones seguidas del mismo ítem) se
-- agrupan en una fila con contador por tramo de tiempo (dedupe_key). Se guardan 180 días. Idempotente.

begin;

create table if not exists public.brain_events (
  id bigserial primary key,
  workspace_id text not null,
  user_id uuid,
  actor text not null default 'human' check (actor in ('human', 'agent', 'system')),
  channel text,                     -- web | api | mcp
  agent text,                       -- cliente IA (Claude, ChatGPT, nombre de la llave…) cuando actor = agent
  module text not null,             -- diseno, calendario, websites, publicar, cerebro…
  action text not null,             -- ver, crear, editar, borrar, publicar, enviar, importar, exportar, tool…
  entity_type text,                 -- tabla o tipo de ítem
  entity_id text,
  entity_name text,
  brand_id text,
  route text,                       -- pantalla en la que estaba la persona (hash de la maqueta)
  ok boolean not null default true,
  error text,
  duration_ms integer,
  count integer not null default 1,
  meta jsonb not null default '{}'::jsonb,
  dedupe_key text,
  created_at timestamptz not null default now(),
  last_at timestamptz not null default now()
);

create unique index if not exists brain_events_dedupe on public.brain_events (dedupe_key);
create index if not exists brain_events_ws_user_last on public.brain_events (workspace_id, user_id, last_at desc);
create index if not exists brain_events_ws_entity on public.brain_events (workspace_id, entity_id);

alter table public.brain_events enable row level security;
revoke all on public.brain_events from anon;
revoke insert, update, delete on public.brain_events from authenticated;
grant select on public.brain_events to authenticated;
drop policy if exists brain_events_own_read on public.brain_events;
create policy brain_events_own_read on public.brain_events for select to authenticated using (user_id = auth.uid());

-- Inserta un lote; si dedupe_key ya existe suma al contador, al tiempo y actualiza lo último visto.
create or replace function public.brain_track(evs jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer := 0;
begin
  if evs is null or jsonb_typeof(evs) <> 'array' then return 0; end if;
  insert into public.brain_events as b (workspace_id, user_id, actor, channel, agent, module, action, entity_type, entity_id, entity_name, brand_id, route, ok, error, duration_ms, count, meta, dedupe_key)
  select e->>'workspace_id',
         nullif(e->>'user_id', '')::uuid,
         coalesce(nullif(e->>'actor', ''), 'human'),
         e->>'channel', left(e->>'agent', 120),
         left(coalesce(nullif(e->>'module', ''), 'otro'), 60),
         left(coalesce(nullif(e->>'action', ''), 'accion'), 80),
         left(e->>'entity_type', 60), left(e->>'entity_id', 200), left(e->>'entity_name', 200), left(e->>'brand_id', 120),
         left(e->>'route', 200),
         coalesce((e->>'ok')::boolean, true), left(e->>'error', 500),
         nullif(e->>'duration_ms', '')::integer,
         greatest(1, coalesce(nullif(e->>'count', '')::integer, 1)),
         coalesce(e->'meta', '{}'::jsonb),
         nullif(e->>'dedupe_key', '')
  from jsonb_array_elements(evs) e
  where coalesce(e->>'workspace_id', '') <> ''
  on conflict (dedupe_key) do update set
    count = b.count + excluded.count,
    last_at = now(),
    duration_ms = case when b.duration_ms is null and excluded.duration_ms is null then null else coalesce(b.duration_ms, 0) + coalesce(excluded.duration_ms, 0) end,
    ok = excluded.ok,
    error = coalesce(excluded.error, b.error),
    entity_name = coalesce(excluded.entity_name, b.entity_name),
    brand_id = coalesce(excluded.brand_id, b.brand_id),
    -- los campos tocados se acumulan (varias ediciones seguidas del mismo ítem)
    meta = case when b.meta ? 'campos' and excluded.meta ? 'campos'
      then (b.meta || excluded.meta) || jsonb_build_object('campos', (select coalesce(jsonb_agg(distinct v), '[]'::jsonb) from jsonb_array_elements(coalesce(b.meta->'campos', '[]'::jsonb) || coalesce(excluded.meta->'campos', '[]'::jsonb)) v))
      else b.meta || excluded.meta end;
  get diagnostics n = row_count;
  -- retención: 180 días (1 de cada 50 lotes poda)
  if random() < 0.02 then delete from public.brain_events where last_at < now() - interval '180 days'; end if;
  return n;
end $$;

revoke all on function public.brain_track(jsonb) from public, anon, authenticated;
grant execute on function public.brain_track(jsonb) to service_role;

-- Todos los ítems de todos los módulos en UNA consulta (el vault del cerebro). SECURITY INVOKER: desde la
-- web aplica el RLS de cada tabla (privados de otros, invitados); una tabla que la persona no puede leer
-- se salta sin romper el resto. Devuelve [{t, id, n, b, e, u}] = tipo, id, nombre, marca, extra, fecha.
create or replace function public.brain_items(p_ws text, p_limit integer default 300)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  q record;
  part jsonb;
  out jsonb := '[]'::jsonb;
  lim integer := least(1000, greatest(1, coalesce(p_limit, 300)));
begin
  for q in select * from (values
    ('disenos', 'templates', 'name', 'coalesce((select m.brand_id from design_file_meta m where m.template_id = x.id limit 1), data->>''brandId'')', 'jsonb_build_object(''tipo'', brand_container_kind)', 'deleted_at is null and is_brand_manual is not true', 'updated_at'),
    ('calendario', 'content_calendar', 'coalesce(topic, ''Pieza sin tema'')', 'brand_id', 'jsonb_build_object(''fecha'', scheduled_date, ''estado'', status, ''formato'', visual_type, ''canales'', channels)', 'true', 'updated_at'),
    ('briefs', 'briefs', 'title', 'brand_id', 'jsonb_build_object(''estado'', status, ''objetivo'', left(objective, 300), ''publico'', left(audience, 200))', 'true', 'updated_at'),
    ('campanas', 'campaigns', 'name', 'brand_id', 'jsonb_build_object(''estado'', status, ''presupuesto_usd'', budget_plan_usd, ''tipo'', campaign_type)', 'true', 'updated_at'),
    ('eventos', 'workspace_events', 'name', 'brand_id', 'jsonb_build_object(''fecha'', date, ''publicado'', published)', 'true', 'updated_at'),
    ('mailing', 'workspace_mailings', 'coalesce(content->>''name'', subject)', 'content->>''brand_id''', 'jsonb_build_object(''tipo'', kind, ''estado'', status, ''asunto'', subject)', 'true', 'updated_at'),
    ('formularios', 'workspace_forms', 'name', 'schema->>''brand_id''', 'jsonb_build_object(''activo'', published, ''respuestas'', response_count)', 'true', 'updated_at'),
    ('cotizaciones', 'crm_quotes', 'concat_ws('' · '', number, title)', 'brand_id', 'jsonb_build_object(''estado'', status, ''total'', total, ''moneda'', currency)', 'true', 'updated_at'),
    ('oportunidades', 'crm_deals', 'title', 'brand_id', 'jsonb_build_object(''etapa'', stage, ''valor'', value, ''moneda'', currency, ''siguiente_paso'', left(next_step_note, 200))', 'true', 'updated_at'),
    ('personas', 'crm_contacts', 'coalesce(nullif(trim(concat_ws('' '', first_name, last_name)), ''''), email)', 'brand_id', 'jsonb_build_object(''email'', email, ''estado'', status)', 'true', 'updated_at'),
    ('interacciones', 'crm_interactions', 'concat_ws('' · '', interaction_type, interaction_date::date)', 'brand_id', 'jsonb_build_object(''tipo'', interaction_type, ''contacto'', contact_id, ''oportunidad'', deal_id)', 'true', 'updated_at'),
    ('proyectos', 'workspace_projects', 'name', 'brand_id', 'jsonb_build_object(''estado'', status)', 'true', 'updated_at'),
    ('tareas_proyecto', 'workspace_project_tasks', 'title', 'null', 'jsonb_build_object(''estado'', status, ''fecha'', due, ''proyecto'', project_id)', 'true', 'updated_at'),
    ('tareas', 'design_kanban_tasks', 'title', 'brand_id', 'jsonb_build_object(''estado'', status, ''prioridad'', priority, ''fecha'', deadline)', 'true', 'updated_at'),
    ('videos', 'musa_video_projects', 'name', 'brand_id', 'jsonb_build_object(''formato'', ratio)', 'is_template is not true', 'updated_at'),
    ('guiones', 'workspace_take_scripts', 'title', 'brand_id', 'jsonb_build_object(''formato'', format)', 'true', 'updated_at'),
    ('clones', 'workspace_clones', 'name', 'brand_id', 'jsonb_build_object(''tipo'', kind, ''estado'', status)', 'true', 'updated_at'),
    ('automatizaciones', 'flows', 'name', 'brand_id', 'jsonb_build_object(''activo'', enabled)', 'true', 'updated_at'),
    ('playbooks', 'workspace_playbooks', 'name', 'null', 'jsonb_build_object(''categoria'', category, ''usos'', uses)', 'true', 'updated_at'),
    ('skills', 'workspace_skills', 'name', 'null', 'jsonb_build_object(''descripcion'', left(description, 200), ''version'', version)', 'deleted_at is null', 'updated_at'),
    ('agentes', 'workspace_agents', 'name', 'null', 'jsonb_build_object(''rol'', role, ''estado'', state, ''modelo'', model)', 'true', 'updated_at'),
    ('websites', 'websites', 'name', 'brand_id', 'jsonb_build_object(''estado'', status, ''publicado'', published, ''slug'', slug)', 'deleted_at is null', 'updated_at'),
    ('publicaciones', 'publish_jobs', 'left(coalesce(nullif(caption, ''''), ''Publicación''), 80)', 'brand_id', 'jsonb_build_object(''estado'', status, ''modo'', mode)', 'true', 'updated_at'),
    ('cuentas_sociales', 'publisher_accounts', 'coalesce(display_name, username, provider)', 'brand_id', 'jsonb_build_object(''red'', provider, ''estado'', status)', 'true', 'updated_at'),
    ('bandeja', 'social_inbox', 'left(concat_ws('': '', author_name, content), 90)', 'null', 'jsonb_build_object(''red'', platform, ''tipo'', kind, ''estado'', status)', 'true', 'updated_at'),
    ('anuncios', 'ad_campaigns', 'name', 'brand_id', 'jsonb_build_object(''red'', network, ''estado'', status, ''objetivo'', objective, ''gasto'', spend, ''moneda'', currency)', 'true', 'updated_at'),
    ('audiencias', 'ad_audiences', 'name', 'brand_id', 'jsonb_build_object(''tipo'', kind, ''redes'', networks, ''tamano'', size)', 'true', 'updated_at'),
    ('investigacion', 'research_items', 'title', 'null', 'jsonb_build_object(''fuente'', source_name, ''estado'', status, ''link'', link)', 'true', 'created_at'),
    ('fuentes', 'research_sources', 'name', 'brand_id', 'jsonb_build_object(''tipo'', type, ''activa'', active)', 'true', 'updated_at'),
    ('copys', 'copy_recipes', 'name', 'brand_id', 'jsonb_build_object(''tipo'', type, ''usos'', usage_count)', 'true', 'updated_at'),
    ('recetas', 'recipes', 'name', 'null', 'jsonb_build_object(''descripcion'', left(description, 200))', 'deleted_at is null', 'updated_at'),
    ('biblioteca', 'assets', 'coalesce(name, filename)', 'null', 'jsonb_build_object(''tipo'', mime_type, ''bytes'', size_bytes)', 'deleted_at is null', 'updated_at'),
    ('aprobaciones', 'workspace_approvals', 'piece_name', 'null', 'jsonb_build_object(''marca'', brand_name, ''estado'', status, ''tipo'', piece_type)', 'true', 'updated_at'),
    ('areas', 'workspace_areas', 'name', 'null', 'jsonb_build_object(''lider'', lead_name, ''personas'', member_count)', 'true', 'updated_at'),
    ('agencias', 'workspace_agencies', 'name', 'null', 'jsonb_build_object(''plan'', plan, ''personas'', member_count)', 'true', 'updated_at'),
    ('fees', 'workspace_fees', 'concat_ws('' · '', brand_name, period)', 'brand_id', 'jsonb_build_object(''fee'', monthly_fee, ''moneda'', currency, ''piezas'', concat(pieces_delivered, ''/'', pieces_included))', 'true', 'updated_at'),
    ('loops', 'workspace_loops', 'concat_ws('' · '', brand_name, macro, sub)', 'null', '''{}''::jsonb', 'true', 'updated_at')
  ) v(t, tbl, n, b, e, f, o)
  loop
    begin
      execute format(
        'select coalesce(jsonb_agg(z), ''[]''::jsonb) from (select %L as t, x.id::text as id, (%s)::text as n, (%s)::text as b, %s as e, x.%I as u from public.%I x where x.workspace_id::text = $1 and (%s) order by x.%I desc nulls last limit $2) z',
        q.t, q.n, q.b, q.e, q.o, q.tbl, q.f, q.o)
      into part using p_ws, lim;
      out := out || part;
    exception when others then
      null; -- tabla que la persona no puede leer o que no existe en esta base
    end;
  end loop;
  return out;
end $$;

grant execute on function public.brain_items(text, integer) to authenticated, service_role;

-- Aprendizajes (carpeta «learning») viven como nota del cerebro, una por persona y espacio.
commit;
