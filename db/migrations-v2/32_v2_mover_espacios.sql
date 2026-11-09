-- 32_v2_mover_espacios.sql — mover cosas entre espacios (personal ↔ agencia ↔ agencia)
--
-- Un movimiento cambia el workspace_id de lo elegido y de todo lo que depende de ello (versiones,
-- comentarios, piezas, tomas, entregables…), en UNA transacción: se mueve todo o nada.
-- Enlaces a cosas que no viajan: la marca se reasigna a la del mismo nombre en el destino (o se
-- copia si no existe); los demás enlaces que quedarían apuntando a otro espacio se limpian.
-- Nombres que chocan en el destino se renombran; duplicados exactos (misma foto, misma cuenta) se
-- omiten. Todo queda registrado para «Deshacer».
--
-- Los permisos (editor en origen y destino) los verifica la API antes de llamar: estas funciones
-- solo las puede ejecutar service_role.
-- Idempotente: se puede correr varias veces.

create table if not exists public.workspace_moves (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  target_ws text not null,
  source_ws text[] not null default '{}',
  roots jsonb not null default '[]'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  created_brands text[] not null default '{}',
  deleted_rows jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by uuid
);
create index if not exists workspace_moves_target_idx on public.workspace_moves (target_ws, created_at desc);
create index if not exists workspace_moves_source_idx on public.workspace_moves using gin (source_ws);

create table if not exists public.workspace_move_rows (
  move_id uuid not null references public.workspace_moves(id) on delete cascade,
  t text not null,
  id text not null,
  old_ws text not null,
  primary key (move_id, t, id)
);
create table if not exists public.workspace_move_patches (
  move_id uuid not null references public.workspace_moves(id) on delete cascade,
  seq bigserial,
  t text not null,
  id text not null,
  col text not null,
  old jsonb,
  primary key (move_id, seq)
);

alter table public.workspace_moves enable row level security;
alter table public.workspace_move_rows enable row level security;
alter table public.workspace_move_patches enable row level security;
-- Sin políticas: solo service_role (la API) lee y escribe.

-- ── tipos que una persona o una IA puede mover ──
create or replace function public.v2__move_type_table(p_type text) returns text
language sql immutable as $$
  select case lower(p_type)
    when 'design' then 'templates' when 'template' then 'templates'
    when 'brand' then 'brands'
    when 'piece' then 'content_calendar' when 'content' then 'content_calendar'
    when 'video' then 'musa_video_projects'
    when 'photo' then 'photo_documents'
    when 'composition' then 'photo_compositions'
    when 'asset' then 'assets' when 'file' then 'assets'
    when 'note' then 'brain_notes'
    when 'flow' then 'flows'
    when 'credential' then 'flow_credentials'
    when 'contact' then 'crm_contacts'
    when 'deal' then 'crm_deals'
    when 'quote' then 'crm_quotes'
    when 'task' then 'design_kanban_tasks'
    when 'copy' then 'copy_recipes'
    when 'recipe' then 'recipes'
    when 'brief' then 'briefs'
    when 'campaign' then 'campaigns'
    when 'form' then 'workspace_forms'
    when 'mailing' then 'workspace_mailings'
    when 'event' then 'workspace_events'
    when 'project' then 'workspace_projects'
    when 'research' then 'research_sources'
    when 'playbook' then 'workspace_playbooks'
    when 'script' then 'workspace_take_scripts'
    when 'take' then 'musa_video_takes'
    when 'guideline' then 'brand_guidelines'
    when 'audience' then 'ad_audiences'
    when 'ad' then 'ad_campaigns'
    else null end
$$;

-- Nombre legible de una fila (para el resumen).
create or replace function public.v2__move_label(p_t text, p_id text) returns text
language plpgsql stable as $$
declare v text;
begin
  execute format('select %s from public.%I where id::text = $1',
    case p_t
      when 'templates' then 'name' when 'brands' then 'name' when 'content_calendar' then 'topic'
      when 'musa_video_projects' then 'name' when 'photo_documents' then 'source_url' when 'photo_compositions' then 'source_url'
      when 'assets' then 'name' when 'brain_notes' then 'title' when 'flows' then 'name' when 'flow_credentials' then 'name'
      when 'crm_contacts' then 'coalesce(nullif(trim(coalesce(first_name,'''')||'' ''||coalesce(last_name,'''')),''''), email)'
      when 'crm_deals' then 'title' when 'crm_quotes' then 'title' when 'design_kanban_tasks' then 'title'
      when 'copy_recipes' then 'name' when 'recipes' then 'name' when 'briefs' then 'title' when 'campaigns' then 'name'
      when 'workspace_forms' then 'name' when 'workspace_events' then 'name' when 'workspace_projects' then 'name'
      when 'research_sources' then 'name' when 'workspace_playbooks' then 'name' when 'workspace_take_scripts' then 'title'
      when 'brand_guidelines' then 'name' when 'ad_audiences' then 'name' when 'ad_campaigns' then 'name'
      else 'id::text' end, p_t) into v using p_id;
  return v;
exception when others then return null;
end $$;

-- ── junta lo elegido + todo lo que depende de ello en la tabla temporal _mv ──
create or replace function public.v2__move_collect(p_items jsonb, p_target text) returns void
language plpgsql as $$
declare
  it jsonb; tbl text; rid text; rws text; n_before int; n_after int; r record; guard int := 0;
  -- (A, columna de A, B, columna de B): una fila de A viaja si A.acol = B.bcol para una fila de B que viaja (mismo espacio)
  rules text[][] := array[
    -- diseño
    ['template_versions','template_id','templates','id'],
    ['design_file_meta','template_id','templates','id'],
    ['design_comments','template_id','templates','id'],
    ['design_import_jobs','template_id','templates','id'],
    ['content_calendar','template_id','templates','id'],
    ['design_kanban_tasks','template_id','templates','id'],
    ['templates','id','content_calendar','template_id'],
    ['content_comments','entity_id','content_calendar','id'],
    ['templates','id','design_file_meta','template_id'],
    ['templates','id','brand_guidelines','design_system_template_id'],
    -- marca: todo lo que es de la marca
    ['brand_guidelines','crm_brand_id','brands','id'],
    ['brand_portal','brand_id','brands','id'],
    ['brand_guests','brand_id','brands','id'],
    ['content_calendar','brand_id','brands','id'],
    ['content_comments','brand_id','brands','id'],
    ['design_file_meta','brand_id','brands','id'],
    ['campaigns','brand_id','brands','id'],
    ['crm_contacts','brand_id','brands','id'],
    ['crm_deals','brand_id','brands','id'],
    ['crm_interactions','brand_id','brands','id'],
    ['crm_quotes','brand_id','brands','id'],
    ['crm_signals','brand_id','brands','id'],
    ['briefs','brand_id','brands','id'],
    ['ad_audiences','brand_id','brands','id'],
    ['ad_campaigns','brand_id','brands','id'],
    ['ad_campaigns_ext','brand_id','brands','id'],
    ['workspace_events','brand_id','brands','id'],
    ['workspace_projects','brand_id','brands','id'],
    ['workspace_take_scripts','brand_id','brands','id'],
    ['research_sources','brand_id','brands','id'],
    ['research_requests','brand_id','brands','id'],
    ['flows','brand_id','brands','id'],
    ['copy_recipes','brand_id','brands','id'],
    ['musa_video_projects','brand_id','brands','id'],
    ['design_kanban_tasks','brand_id','brands','id'],
    ['publisher_accounts','brand_id','brands','id'],
    ['workspace_fees','brand_id','brands','id'],
    ['workspace_ad_accounts','brand_id','brands','id'],
    ['workspace_clones','brand_id','brands','id'],
    ['harness_cronjobs','brand_id','brands','id'],
    ['templates','data->>''brandId''','brands','id'],
    ['assets','id','brands','logo_asset_id'],
    -- video
    ['musa_motion_specs','project_id','musa_video_projects','id'],
    ['musa_scene_specs','project_id','musa_video_projects','id'],
    ['musa_video_render_tickets','project_id','musa_video_projects','id'],
    ['musa_video_transcripts','project_id','musa_video_projects','id'],
    -- fotos y archivos
    ['photo_versions','document_id','photo_documents','id'],
    ['photo_catalog_items','asset_id','assets','id'],
    -- flujos
    ['flow_runs','flow_id','flows','id'],
    -- CRM
    ['crm_interactions','contact_id','crm_contacts','id'],
    ['crm_signals','contact_id','crm_contacts','id'],
    ['crm_deals','primary_contact_id','crm_contacts','id'],
    ['crm_contacts','id','crm_deals','primary_contact_id'],
    ['crm_deal_deliverables','deal_id','crm_deals','id'],
    ['crm_interactions','deal_id','crm_deals','id'],
    ['crm_signals','deal_id','crm_deals','id'],
    ['crm_quotes','deal_id','crm_deals','id'],
    -- marketing y operación
    ['workspace_form_responses','form_id','workspace_forms','id'],
    ['workspace_email_sends','mailing_id','workspace_mailings','id'],
    ['workspace_event_regs','event_id','workspace_events','id'],
    ['workspace_email_sends','event_id','workspace_events','id'],
    ['workspace_project_tasks','project_id','workspace_projects','id'],
    ['research_items','source_id','research_sources','id'],
    ['research_requests','item_id','research_items','id'],
    ['ad_campaigns','campaign_id','campaigns','id'],
    ['ad_campaigns_ext','campaign_id','campaigns','id'],
    ['design_comments','kanban_task_id','design_kanban_tasks','id']
  ];
  i int;
begin
  -- raíces
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    tbl := public.v2__move_type_table(it->>'type');
    rid := it->>'id';
    if tbl is null then raise exception 'Tipo que no se puede mover: %', coalesce(it->>'type', '(vacío)') using errcode = '22023'; end if;
    if rid is null or rid = '' then raise exception 'Falta el id de un elemento' using errcode = '22023'; end if;
    execute format('select workspace_id::text from public.%I where id::text = $1', tbl) into rws using rid;
    if rws is null then raise exception 'No existe: % %', it->>'type', rid using errcode = 'P0002'; end if;
    insert into _mv(t, id, ws, root) values (tbl, rid, rws, true) on conflict (t, id) do update set root = true;
  end loop;

  -- dependencias hasta que no entre nada nuevo
  loop
    guard := guard + 1;
    select count(*) into n_before from _mv;
    for i in 1 .. array_length(rules, 1) loop
      execute format(
        'insert into _mv(t, id, ws) select %L, a.id::text, a.workspace_id::text from public.%I a
           join public.%I b on (a.%s)::text = (b.%s)::text and a.workspace_id::text = b.workspace_id::text
           join _mv m on m.t = %L and m.id = b.id::text
         where a.workspace_id is not null and a.workspace_id::text <> %L
         on conflict (t, id) do nothing',
        rules[i][1], rules[i][1], rules[i][3],
        case when rules[i][2] like '%>%' then rules[i][2] else quote_ident(rules[i][2]) end,
        quote_ident(rules[i][4]), rules[i][3], p_target);
    end loop;
    -- credenciales de flujos: viajan si solo las usan flujos que viajan
    insert into _mv(t, id, ws)
      select 'flow_credentials', c.id::text, c.workspace_id from public.flow_credentials c
      where c.workspace_id <> p_target
        and exists (select 1 from public.flows f join _mv m on m.t = 'flows' and m.id = f.id::text
                    where f.workspace_id = c.workspace_id and f.nodes::text like '%' || c.id || '%')
        and not exists (select 1 from public.flows f where f.workspace_id = c.workspace_id
                        and not exists (select 1 from _mv m where m.t = 'flows' and m.id = f.id::text)
                        and f.nodes::text like '%' || c.id || '%')
      on conflict (t, id) do nothing;
    select count(*) into n_after from _mv;
    exit when n_after = n_before or guard > 30;
  end loop;

  -- lo que ya está en el destino no se mueve
  delete from _mv where ws = p_target;
end $$;

-- Prepara la tabla temporal (una por transacción).
create or replace function public.v2__move_tmp() returns void language plpgsql as $$
begin
  create temp table if not exists _mv (t text not null, id text not null, ws text not null, root boolean not null default false, skip text, primary key (t, id)) on commit drop;
  truncate _mv;
end $$;

-- Marca como omitidos los duplicados exactos que ya existen en el destino (y sus dependientes directos).
create or replace function public.v2__move_mark_dupes(p_target text) returns void language plpgsql as $$
begin
  update _mv m set skip = 'Ya hay una foto con el mismo archivo en el destino' from public.photo_documents d
   where m.t = 'photo_documents' and d.id::text = m.id and exists (select 1 from public.photo_documents x where x.workspace_id = p_target and x.source_url = d.source_url);
  update _mv m set skip = 'Su foto se queda (duplicada en el destino)' from public.photo_versions v
   where m.t = 'photo_versions' and v.id::text = m.id and exists (select 1 from _mv p where p.t = 'photo_documents' and p.id = v.document_id::text and p.skip is not null);
  update _mv m set skip = 'Ya hay una composición del mismo archivo en el destino' from public.photo_compositions d
   where m.t = 'photo_compositions' and d.id::text = m.id and exists (select 1 from public.photo_compositions x where x.workspace_id = p_target and x.source_url = d.source_url);
  update _mv m set skip = 'El archivo ya está en el catálogo del destino' from public.photo_catalog_items d
   where m.t = 'photo_catalog_items' and d.id::text = m.id and exists (select 1 from public.photo_catalog_items x where x.workspace_id = p_target and x.asset_id = d.asset_id);
  update _mv m set skip = 'La misma noticia ya está en el destino' from public.research_items d
   where m.t = 'research_items' and d.id::text = m.id and exists (select 1 from public.research_items x where x.workspace_id = p_target and x.link_hash = d.link_hash);
  update _mv m set skip = 'Su noticia se queda (duplicada en el destino)' from public.research_requests r
   where m.t = 'research_requests' and r.id::text = m.id and exists (select 1 from _mv p where p.t = 'research_items' and p.id = r.item_id::text and p.skip is not null);
  update _mv m set skip = 'La misma cuenta ya está conectada en el destino' from public.publisher_accounts d
   where m.t = 'publisher_accounts' and d.id::text = m.id and exists (select 1 from public.publisher_accounts x where x.workspace_id = p_target and x.provider = d.provider and x.external_id = d.external_id);
  update _mv m set skip = 'La misma cuenta de anuncios ya está en el destino' from public.workspace_ad_accounts d
   where m.t = 'workspace_ad_accounts' and d.id::text = m.id and exists (select 1 from public.workspace_ad_accounts x where x.workspace_id = p_target and x.network = d.network and x.account_id = d.account_id);
  update _mv m set skip = 'El mismo clon ya está en el destino' from public.workspace_clones d
   where m.t = 'workspace_clones' and d.id::text = m.id and d.external_id is not null and exists (select 1 from public.workspace_clones x where x.workspace_id = p_target and x.provider = d.provider and x.external_id = d.external_id);
  update _mv m set skip = 'Ya tiene acceso a esa marca en el destino' from public.brand_guests d
   where m.t = 'brand_guests' and d.id::text = m.id and exists (select 1 from public.brand_guests x where x.workspace_id = p_target and x.brand_id = d.brand_id and lower(x.email) = lower(d.email));
  update _mv m set skip = 'El portal de esa marca ya existe en el destino' from public.brand_portal d
   where m.t = 'brand_portal' and d.id::text = m.id and exists (select 1 from public.brand_portal x where x.workspace_id = p_target and x.brand_id = d.brand_id);
end $$;

-- Marcas que lo movido usa y que no viajan: a cuál quedan enlazadas en el destino.
create or replace function public.v2__move_brand_plan(p_target text, p_brand_mode text) returns jsonb language plpgsql as $$
declare res jsonb := '[]'::jsonb; r record; tn text; match_id text; must boolean;
  btables text[] := array['brand_guidelines:crm_brand_id','brand_portal:brand_id','brand_guests:brand_id','content_calendar:brand_id','content_comments:brand_id','design_file_meta:brand_id','campaigns:brand_id','crm_contacts:brand_id','crm_deals:brand_id','crm_interactions:brand_id','crm_quotes:brand_id','crm_signals:brand_id','briefs:brand_id','ad_audiences:brand_id','ad_campaigns:brand_id','ad_campaigns_ext:brand_id','workspace_events:brand_id','workspace_projects:brand_id','workspace_take_scripts:brand_id','research_sources:brand_id','research_requests:brand_id','flows:brand_id','copy_recipes:brand_id','musa_video_projects:brand_id','design_kanban_tasks:brand_id','publisher_accounts:brand_id','workspace_fees:brand_id','workspace_ad_accounts:brand_id','workspace_clones:brand_id','harness_cronjobs:brand_id'];
  req_tabs text[] := array['brand_portal','brand_guests','campaigns','crm_deals','crm_signals'];
  x text;
begin
  create temp table if not exists _mvb (brand_id text primary key, required boolean not null default false) on commit drop;
  truncate _mvb;
  foreach x in array btables loop
    tn := split_part(x, ':', 1);
    execute format('insert into _mvb(brand_id, required) select distinct a.%I::text, %L::boolean from public.%I a join _mv m on m.t = %L and m.id = a.id::text and m.skip is null
                    where a.%I is not null and not exists (select 1 from _mv mb where mb.t = ''brands'' and mb.id = a.%I::text and mb.skip is null)
                    on conflict (brand_id) do update set required = _mvb.required or excluded.required',
      split_part(x, ':', 2), tn = any(req_tabs), tn, tn, split_part(x, ':', 2), split_part(x, ':', 2));
  end loop;
  insert into _mvb(brand_id) select distinct tp.data->>'brandId' from public.templates tp join _mv m on m.t = 'templates' and m.id = tp.id::text and m.skip is null
    where coalesce(tp.data->>'brandId', '') <> '' and not exists (select 1 from _mv mb where mb.t = 'brands' and mb.id = tp.data->>'brandId')
    on conflict (brand_id) do nothing;
  for r in select mb.brand_id, mb.required, b.name, b.workspace_id from _mvb mb join public.brands b on b.id = mb.brand_id where b.workspace_id is distinct from p_target loop
    select b2.id into match_id from public.brands b2 where b2.workspace_id = p_target and lower(trim(b2.name)) = lower(trim(r.name)) order by b2.created_at limit 1;
    res := res || jsonb_build_object('brand_id', r.brand_id, 'name', r.name,
      'action', case when match_id is not null then 'match' when p_brand_mode = 'unlink' and not r.required then 'unlink' else 'copy' end,
      'target_brand_id', match_id, 'required', r.required);
  end loop;
  return res;
end $$;

-- ── vista previa: qué se moverá, sin cambiar nada ──
create or replace function public.v2_move_preview(p_items jsonb, p_target text, p_brand_mode text default 'copy') returns jsonb
language plpgsql security definer set search_path = public as $$
declare res jsonb; roots jsonb; counts jsonb; skipped jsonb; brands jsonb; srcs text[];
begin
  if not exists (select 1 from public.workspaces where id = p_target) then raise exception 'El espacio de destino no existe' using errcode = 'P0002'; end if;
  perform public.v2__move_tmp();
  perform public.v2__move_collect(p_items, p_target);
  perform public.v2__move_mark_dupes(p_target);
  select coalesce(jsonb_agg(jsonb_build_object('t', t, 'id', id, 'ws', ws, 'label', public.v2__move_label(t, id))), '[]'::jsonb) into roots from _mv where root;
  select coalesce(jsonb_object_agg(t, n), '{}'::jsonb) into counts from (select t, count(*) n from _mv where skip is null group by t) c;
  select coalesce(jsonb_agg(jsonb_build_object('t', t, 'id', id, 'reason', skip, 'label', public.v2__move_label(t, id))), '[]'::jsonb) into skipped from _mv where skip is not null;
  select array_agg(distinct ws) into srcs from _mv;
  brands := public.v2__move_brand_plan(p_target, p_brand_mode);
  res := jsonb_build_object('target', p_target, 'sources', coalesce(to_jsonb(srcs), '[]'::jsonb), 'roots', roots, 'counts', counts,
    'total', (select count(*) from _mv where skip is null), 'skipped', skipped, 'brands', brands,
    'already_there', (select count(*) from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))) - (select count(*) from _mv where root));
  return res;
end $$;

-- Guarda el valor anterior de una columna y la cambia.
create or replace function public.v2__move_patch(p_move uuid, p_t text, p_col text, p_where text, p_set text) returns int
language plpgsql as $$
declare n int;
begin
  execute format('insert into public.workspace_move_patches(move_id, t, id, col, old) select %L, %L, a.id::text, %L, to_jsonb(a.%I) from public.%I a where %s',
    p_move, p_t, p_col, p_col, p_t, p_where);
  execute format('update public.%I a set %I = %s where %s', p_t, p_col, p_set, p_where);
  get diagnostics n = row_count;
  return n;
end $$;

-- ── mover ──
create or replace function public.v2_move_apply(p_items jsonb, p_target text, p_actor uuid, p_brand_mode text default 'copy') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  mv_id uuid; pre jsonb; b jsonb; newb text; created text[] := '{}'; tn text; ids text[]; n int; x text; col text; reft text;
  bmap jsonb := '{}'::jsonb; deleted jsonb := '[]'::jsonb; cleared int := 0; renamed int := 0;
  btables text[] := array['brand_guidelines:crm_brand_id','brand_portal:brand_id','brand_guests:brand_id','content_calendar:brand_id','content_comments:brand_id','design_file_meta:brand_id','campaigns:brand_id','crm_contacts:brand_id','crm_deals:brand_id','crm_interactions:brand_id','crm_quotes:brand_id','crm_signals:brand_id','briefs:brand_id','ad_audiences:brand_id','ad_campaigns:brand_id','ad_campaigns_ext:brand_id','workspace_events:brand_id','workspace_projects:brand_id','workspace_take_scripts:brand_id','research_sources:brand_id','research_requests:brand_id','flows:brand_id','copy_recipes:brand_id','musa_video_projects:brand_id','design_kanban_tasks:brand_id','publisher_accounts:brand_id','workspace_fees:brand_id','workspace_ad_accounts:brand_id','workspace_clones:brand_id','harness_cronjobs:brand_id'];
  -- (tabla, columna, tabla a la que apunta): tras mover, un enlace entre espacios distintos se limpia
  refs text[] := array[
    'content_calendar:template_id:templates','design_kanban_tasks:template_id:templates','design_import_jobs:template_id:templates',
    'brand_guidelines:design_system_template_id:templates',
    'crm_contacts:origin_content_id:content_calendar','crm_signals:origin_content_id:content_calendar',
    'crm_deals:campaign_id:campaigns','design_file_meta:campaign_id:campaigns','ad_campaigns:campaign_id:campaigns','ad_campaigns_ext:campaign_id:campaigns',
    'crm_deals:primary_contact_id:crm_contacts','crm_interactions:contact_id:crm_contacts','crm_signals:contact_id:crm_contacts',
    'workspace_email_sends:contact_id:crm_contacts','workspace_form_responses:contact_id:crm_contacts','social_inbox:crm_contact_id:crm_contacts',
    'crm_interactions:deal_id:crm_deals','crm_quotes:deal_id:crm_deals','crm_signals:deal_id:crm_deals',
    'workspace_projects:brief_id:briefs','workspace_projects:quote_id:crm_quotes','workspace_projects:playbook_id:workspace_playbooks',
    'ad_campaigns:event_id:workspace_events','workspace_email_sends:event_id:workspace_events','workspace_email_sends:mailing_id:workspace_mailings',
    'design_comments:kanban_task_id:design_kanban_tasks','brands:logo_asset_id:assets'];
begin
  pre := public.v2_move_preview(p_items, p_target, p_brand_mode);
  if (pre->>'total')::int = 0 then raise exception 'Nada que mover: ya está en ese espacio' using errcode = '22023'; end if;

  insert into public.workspace_moves(actor_id, target_ws, source_ws, roots, summary)
    values (p_actor, p_target, array(select jsonb_array_elements_text(pre->'sources')), pre->'roots', pre)
    returning id into mv_id;

  set constraints all deferred;

  -- marcas que no viajan: enlazar a la del destino o copiar
  for b in select * from jsonb_array_elements(pre->'brands') loop
    if b->>'action' = 'match' then bmap := bmap || jsonb_build_object(b->>'brand_id', b->>'target_brand_id');
    elsif b->>'action' = 'copy' then
      newb := 'brand_' || replace(gen_random_uuid()::text, '-', '');
      newb := substr(newb, 1, 26);
      insert into public.brands select (jsonb_populate_record(null::public.brands, to_jsonb(br) || jsonb_build_object('id', newb, 'workspace_id', p_target, 'logo_asset_id', null, 'created_at', now(), 'updated_at', now()))).*
        from public.brands br where br.id = b->>'brand_id';
      created := created || newb;
      bmap := bmap || jsonb_build_object(b->>'brand_id', newb);
    else bmap := bmap || jsonb_build_object(b->>'brand_id', null);
    end if;
  end loop;

  insert into public.workspace_move_rows(move_id, t, id, old_ws) select mv_id, t, id, ws from _mv where skip is null;

  -- nombres que chocan en el destino
  renamed := renamed + public.v2__move_patch(mv_id, 'templates', 'slug',
    format('a.id::text in (select id from _mv where t = ''templates'' and skip is null) and a.slug is not null and exists (select 1 from public.templates z where z.workspace_id = %L and z.slug = a.slug)', p_target),
    'a.slug || ''-'' || substr(md5(a.id::text), 1, 5)');
  renamed := renamed + public.v2__move_patch(mv_id, 'brain_notes', 'slug',
    format('a.id::text in (select id from _mv where t = ''brain_notes'' and skip is null) and a.slug is not null and exists (select 1 from public.brain_notes z where z.workspace_id = %L and z.slug = a.slug)', p_target),
    'a.slug || ''-'' || substr(md5(a.id::text), 1, 5)');
  renamed := renamed + public.v2__move_patch(mv_id, 'brand_guidelines', 'name',
    format('a.id::text in (select id from _mv where t = ''brand_guidelines'' and skip is null) and a.deleted_at is null and exists (select 1 from public.brand_guidelines z where z.workspace_id = %L and z.deleted_at is null and lower(btrim(z.name)) = lower(btrim(a.name)))', p_target),
    'a.name || '' (movida)''');
  renamed := renamed + public.v2__move_patch(mv_id, 'crm_quotes', 'number',
    format('a.id::text in (select id from _mv where t = ''crm_quotes'' and skip is null) and a.number is not null and exists (select 1 from public.crm_quotes z where z.workspace_id = %L and z.number = a.number)', p_target),
    'a.number || ''-'' || substr(md5(a.id::text), 1, 4)');
  update public.design_import_jobs a set idempotency_key = null
   where a.id::text in (select id from _mv where t = 'design_import_jobs' and skip is null)
     and exists (select 1 from public.design_import_jobs z where z.workspace_id = p_target and z.idempotency_key = a.idempotency_key);

  -- reenlazar marcas ANTES de mover (los nombres de campañas son únicos por marca)
  foreach x in array btables loop
    tn := split_part(x, ':', 1); col := split_part(x, ':', 2);
    perform public.v2__move_patch(mv_id, tn, col,
      format('a.id::text in (select id from _mv where t = %L and skip is null) and a.%I::text in (select jsonb_object_keys(%L::jsonb))', tn, col, bmap),
      format('(%L::jsonb ->> a.%I::text)', bmap, col));
  end loop;
  insert into public.workspace_move_patches(move_id, t, id, col, old)
    select mv_id, 'templates', tp.id::text, 'data.brandId', to_jsonb(tp.data->>'brandId') from public.templates tp
    where tp.id::text in (select id from _mv where t = 'templates' and skip is null) and (tp.data->>'brandId') in (select jsonb_object_keys(bmap));
  update public.templates tp set data = case when bmap->>(tp.data->>'brandId') is null then tp.data - 'brandId' else jsonb_set(tp.data, '{brandId}', to_jsonb(bmap->>(tp.data->>'brandId'))) end
    where tp.id::text in (select id from _mv where t = 'templates' and skip is null) and (tp.data->>'brandId') in (select jsonb_object_keys(bmap));
  -- campañas que chocan dentro de la misma marca en el destino
  renamed := renamed + public.v2__move_patch(mv_id, 'campaigns', 'name',
    format('a.id::text in (select id from _mv where t = ''campaigns'' and skip is null) and exists (select 1 from public.campaigns z where z.workspace_id = %L and z.brand_id = a.brand_id and lower(z.name) = lower(a.name))', p_target),
    'a.name || '' (movida)''');

  -- entregables del CRM que enlazan un diseño que se va, pero el entregable se queda: se suelta el enlace
  select coalesce(jsonb_agg(jsonb_build_object('t', 'crm_deliverable_files', 'row', to_jsonb(f))), '[]'::jsonb) into deleted
    from public.crm_deliverable_files f
   where f.template_id in (select id from _mv where t = 'templates' and skip is null)
     and f.deliverable_id::text not in (select id from _mv where t = 'crm_deal_deliverables' and skip is null);
  delete from public.crm_deliverable_files f
   where f.template_id in (select id from _mv where t = 'templates' and skip is null)
     and f.deliverable_id::text not in (select id from _mv where t = 'crm_deal_deliverables' and skip is null);

  -- mover
  for tn in select distinct m.t from _mv m where m.skip is null loop
    select array_agg(id) into ids from _mv where _mv.t = tn and skip is null;
    execute format('update public.%I set workspace_id = $1 where id::text = any($2)', tn) using p_target, ids;
  end loop;
  -- tablas hijas sin id propio: siguen a su padre
  update public.flow_versions set workspace_id = p_target where flow_id in (select id from _mv where t = 'flows' and skip is null);
  update public.video_editor_state set workspace_id = p_target where project_id in (select id from _mv where t = 'musa_video_projects' and skip is null);
  update public.crm_deliverable_files set workspace_id = p_target where deliverable_id::text in (select id from _mv where t = 'crm_deal_deliverables' and skip is null);

  -- enlaces que quedaron entre espacios distintos: se limpian (en lo movido y en lo que se quedó)
  foreach x in array refs loop
    tn := split_part(x, ':', 1); col := split_part(x, ':', 2); reft := split_part(x, ':', 3);
    cleared := cleared + public.v2__move_patch(mv_id, tn, col,
      format('a.%I is not null and (a.id::text in (select id from _mv where t = %L and skip is null) or a.%I::text in (select id from _mv where t = %L and skip is null))
              and exists (select 1 from public.%I r where r.id::text = a.%I::text and r.workspace_id::text is distinct from a.workspace_id::text)',
        col, tn, col, reft, reft, col),
      'null');
  end loop;

  update public.workspace_moves set created_brands = created, deleted_rows = deleted,
    summary = summary || jsonb_build_object('renamed', renamed, 'links_cleared', cleared, 'deliverable_links_removed', jsonb_array_length(deleted), 'brands_created', coalesce(array_length(created, 1), 0))
   where id = mv_id;
  return (select summary || jsonb_build_object('move_id', id) from public.workspace_moves where id = mv_id);
end $$;

-- ── deshacer ──
create or replace function public.v2_move_undo(p_move uuid, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare mv record; tn text; n int := 0; moved_back int := 0; stale int := 0; p record; d jsonb; b text; refs int; x text;
  btables text[] := array['brand_guidelines:crm_brand_id','brand_portal:brand_id','brand_guests:brand_id','content_calendar:brand_id','content_comments:brand_id','design_file_meta:brand_id','campaigns:brand_id','crm_contacts:brand_id','crm_deals:brand_id','crm_interactions:brand_id','crm_quotes:brand_id','crm_signals:brand_id','briefs:brand_id','ad_audiences:brand_id','ad_campaigns:brand_id','ad_campaigns_ext:brand_id','workspace_events:brand_id','workspace_projects:brand_id','workspace_take_scripts:brand_id','research_sources:brand_id','research_requests:brand_id','flows:brand_id','copy_recipes:brand_id','musa_video_projects:brand_id','design_kanban_tasks:brand_id','publisher_accounts:brand_id','workspace_fees:brand_id','workspace_ad_accounts:brand_id','workspace_clones:brand_id','harness_cronjobs:brand_id'];
begin
  select * into mv from public.workspace_moves where id = p_move for update;
  if mv.id is null then raise exception 'Movimiento no encontrado' using errcode = 'P0002'; end if;
  if mv.undone_at is not null then raise exception 'Ese movimiento ya se deshizo' using errcode = '22023'; end if;
  set constraints all deferred;

  -- volver cada fila a su espacio (solo si sigue en el destino de este movimiento)
  for tn in select distinct r.t from public.workspace_move_rows r where r.move_id = p_move loop
    execute format('update public.%I a set workspace_id = r.old_ws from public.workspace_move_rows r
                    where r.move_id = $1 and r.t = %L and a.id::text = r.id and a.workspace_id::text = $2', tn, tn) using p_move, mv.target_ws;
    get diagnostics n = row_count; moved_back := moved_back + n;
  end loop;
  select count(*) - moved_back into stale from public.workspace_move_rows where move_id = p_move;
  update public.flow_versions v set workspace_id = r.old_ws from public.workspace_move_rows r where r.move_id = p_move and r.t = 'flows' and v.flow_id = r.id and v.workspace_id = mv.target_ws;
  update public.video_editor_state v set workspace_id = r.old_ws from public.workspace_move_rows r where r.move_id = p_move and r.t = 'musa_video_projects' and v.project_id = r.id and v.workspace_id = mv.target_ws;
  update public.crm_deliverable_files v set workspace_id = r.old_ws from public.workspace_move_rows r where r.move_id = p_move and r.t = 'crm_deal_deliverables' and v.deliverable_id::text = r.id and v.workspace_id = mv.target_ws;

  -- valores anteriores (enlaces, nombres, marcas), del último al primero
  for p in select * from public.workspace_move_patches where move_id = p_move order by seq desc loop
    if p.col = 'data.brandId' then
      update public.templates set data = case when p.old is null or p.old = 'null'::jsonb then data - 'brandId' else jsonb_set(data, '{brandId}', p.old) end where id::text = p.id;
    else
      execute format('update public.%I a set %I = (jsonb_populate_record(null::public.%I, jsonb_build_object(%L, $1))).%I where a.id::text = $2', p.t, p.col, p.t, p.col, p.col) using p.old, p.id;
    end if;
  end loop;

  -- enlaces de entregables que se soltaron
  for d in select * from jsonb_array_elements(mv.deleted_rows) loop
    if d->>'t' = 'crm_deliverable_files' then
      insert into public.crm_deliverable_files select (jsonb_populate_record(null::public.crm_deliverable_files, d->'row')).* on conflict do nothing;
    end if;
  end loop;

  -- marcas que se copiaron al mover: se borran si ya nada las usa
  foreach b in array mv.created_brands loop
    refs := 0;
    foreach x in array btables loop
      execute format('select count(*) from public.%I where %I::text = $1', split_part(x, ':', 1), split_part(x, ':', 2)) into n using b;
      refs := refs + n;
    end loop;
    select refs + count(*) into refs from public.templates where data->>'brandId' = b;
    if refs = 0 then delete from public.brands where id = b; end if;
  end loop;

  update public.workspace_moves set undone_at = now(), undone_by = p_actor where id = p_move;
  return jsonb_build_object('move_id', p_move, 'moved_back', moved_back, 'not_restored', stale);
end $$;

revoke all on function public.v2_move_preview(jsonb, text, text) from public, anon, authenticated;
revoke all on function public.v2_move_apply(jsonb, text, uuid, text) from public, anon, authenticated;
revoke all on function public.v2_move_undo(uuid, uuid) from public, anon, authenticated;
grant execute on function public.v2_move_preview(jsonb, text, text) to service_role;
grant execute on function public.v2_move_apply(jsonb, text, uuid, text) to service_role;
grant execute on function public.v2_move_undo(uuid, uuid) to service_role;

-- Las funciones internas tampoco se exponen por la API pública.
revoke all on function public.v2__move_type_table(text) from public, anon, authenticated;
revoke all on function public.v2__move_label(text, text) from public, anon, authenticated;
revoke all on function public.v2__move_collect(jsonb, text) from public, anon, authenticated;
revoke all on function public.v2__move_tmp() from public, anon, authenticated;
revoke all on function public.v2__move_mark_dupes(text) from public, anon, authenticated;
revoke all on function public.v2__move_brand_plan(text, text) from public, anon, authenticated;
revoke all on function public.v2__move_patch(uuid, text, text, text, text) from public, anon, authenticated;
