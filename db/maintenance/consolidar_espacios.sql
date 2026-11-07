/* ═══════════════════════════════════════════════════════════════════════════
   consolidar_espacios.sql — UNA cuenta = UN espacio (PRODUCCIÓN)
   Modelo (decisión del dueño, 2026-11-05):
   - Cada usuario tiene UN espacio con su nombre (o el de su agencia si está
     en plan agencia) y dentro puede tener varias marcas.
   - Todo el contenido de los demás espacios de MI cuenta se MUEVE al principal.
   - El contenido de OTRAS cuentas no se toca: vive en el espacio de su dueño.

   CÓMO USARLO (SQL editor de producción):
   1. PASO 0 (inventario): te muestra qué se mueve y qué se borra.
   2. PASO 1 v6 ya fue EJECUTADO en prod (2026-11-06) y quedó archivado
      comentado como registro. Para re-ejecutar en otra DB, quita los
      marcadores /* */ del bloque y córrelo: es atómico; si algo falla,
      no se aplicó nada.
   3. PASO 2b (backfill created_by + adopción de huérfanos) es idempotente:
      puedes correrlo cuantas veces haga falta.
   ═══════════════════════════════════════════════════════════════════════════ */

-- ── PASO 0 · Inventario: qué se mueve, qué se borra, qué no se toca ──
drop table if exists ws_consolidar;
create temp table ws_consolidar (id text, nombre text, creado timestamptz, destino text, marcas bigint, filas bigint);

do $inv$
declare
  v_owner uuid;
  v_main text;
  v_main_nombre text := 'Futuraria';  -- ← tu espacio único principal (cámbialo si hace falta)
  v_ws record;
  v_tab text;
  v_n bigint;
  v_total bigint;
  v_bn bigint;
begin
  select u.id into v_owner from auth.users u where u.email = 'renzo@futuraria.com';
  if v_owner is null then
    raise exception 'No existe el usuario renzo@futuraria.com en esta DB. ¿Estás en producción?';
  end if;

  /* El «Dueño» del selector viene de workspace_members, NO de workspaces.owner_id:
     resolvemos el principal por tus membresías. Orden: nombre exacto siendo owner,
     luego nombre exacto con cualquier rol, luego nombre parcial siendo owner. */
  select m.workspace_id::text into v_main
  from public.workspace_members m
  join public.workspaces w on w.id::text = m.workspace_id::text
  where m.user_id::text = v_owner::text and m.role = 'owner' and w.name = v_main_nombre
  limit 1;
  if v_main is null then
    select m.workspace_id::text into v_main
    from public.workspace_members m
    join public.workspaces w on w.id::text = m.workspace_id::text
    where m.user_id::text = v_owner::text and w.name = v_main_nombre
    limit 1;
  end if;
  if v_main is null then
    select m.workspace_id::text into v_main
    from public.workspace_members m
    join public.workspaces w on w.id::text = m.workspace_id::text
    where m.user_id::text = v_owner::text and m.role = 'owner'
      and w.name ilike '%' || v_main_nombre || '%'
    order by length(w.name)
    limit 1;
  end if;
  if v_main is null then
    raise exception 'No hallo "%" entre tus espacios. Tus espacios (nombre · rol): %',
      v_main_nombre,
      (select string_agg(w.name || ' · ' || coalesce(m.role, '?'), ' | ')
       from public.workspace_members m
       join public.workspaces w on w.id::text = m.workspace_id::text
       where m.user_id::text = v_owner::text);
  end if;

  for v_ws in
    select w.id, w.name, w.created_at
    from public.workspace_members m
    join public.workspaces w on w.id::text = m.workspace_id::text
    where m.user_id::text = v_owner::text and m.role = 'owner'
    order by w.created_at
  loop
    select count(*) into v_bn from public.brands b where b.workspace_id::text = v_ws.id::text;
    v_total := 0;
    for v_tab in
      select c.table_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public'
        and c.column_name = 'workspace_id'
        and t.table_type = 'BASE TABLE'
    loop
      execute format('select count(*) from public.%I where workspace_id::text = %L', v_tab, v_ws.id::text) into v_n;
      v_total := v_total + v_n;
    end loop;
    insert into ws_consolidar values (v_ws.id::text, v_ws.name, v_ws.created_at,
      case when v_ws.id::text = v_main then 'PRINCIPAL (se queda)' else '→ se mueve al principal' end, v_bn, v_total);
  end loop;
end
$inv$;

select nombre, creado, destino, marcas, filas as filas_de_contenido, id
from ws_consolidar
order by (destino = 'PRINCIPAL (se queda)') desc, creado;

/* ── PASO 1 v6 · CONSOLIDACIÓN — EJECUTADO EN PROD 2026-11-06 ✓ (se conserva como archivo) ──
   Alcance: espacios con owner_id nulo + espacios personales de las DOS cuentas de
   Renzo (renzo@futuraria.com y renzoperezbartra123@gmail.com). Los espacios de los
   demás usuarios NO se tocan.workspace_members se EXCLUYE del barrido y sus filas
   se borran aparte.

   Manejo de restricciones descubierto en prod (v2→v6, ver historial de errores):
   a) Unique por par (workspace_id, name|slug) — constraint o índice: dedup por
      rename (« · movido N» / «-mN»), calculado upfront con row_number.
   b) Cualquier otro índice/constraint único que incluya workspace_id (1..6 cols,
      con predicado parcial o sin él): mueve solo la primera fila de cada grupo
      conflictivo; el resto SE QUEDA (queda huérfana, inofensiva, y se ve en la
      verificación de huérfanos). Ej: uq_bg_name_per_workspace (ws) WHERE
      crm_brand_id IS NULL; idx_templates_brand_container_unique (ws, kind);
      workspace_loops (ws + 3 cols).
   c) FKs compuestas que incluyen workspace_id (crm_deals ↔ deliverables): se
      marcan DEFERRABLE + SET CONSTRAINTS ALL DEFERRED (validación al commit).
   d) workspace_id tipado uuid (workspace_usage): no puede apuntar a ids text →
      se PURGAN las filas de los espacios fusionados (métricas muertas).
   Nota v3: format('%L', quote_literal(x)) doble-comilla — pasar valores RAW a %L.
do $con$
declare
  v_me uuid; v_seg uuid; v_seg_ws text; v_main text;
  v_arr text[];
  v_swept_oids oid[] := '{}'; v_skip_oids oid[] := '{}';
  v_rec record; v_rec2 record; v_tab text; v_ws_at smallint;
  v_others text[]; v_pred text; v_k int; v_nx int; j int;
  v_cj text; v_eqs text; v_parts text; v_nulls text; v_pfrag text; v_ppart text;
  v_extra text; v_conds text; v_rename_set text; v_has_rename bool; v_has_restrict bool;
  v_ws_uuid bool; v_has_id bool;
  v_n bigint; v_tablas bigint := 0; v_fall text := ''; v_sql text;
begin
  select id into v_me from auth.users where email = 'renzo@futuraria.com';
  select id into v_seg from auth.users where email = 'renzoperezbartra123@gmail.com';
  if v_me is null then raise exception 'No hallo renzo@futuraria.com'; end if;

  select m.workspace_id::text into v_main
  from public.workspace_members m
  join public.workspaces w on w.id::text = m.workspace_id::text
  where m.user_id::text = v_me::text and w.name = 'Futuraria'
  limit 1;
  if v_main is null then raise exception 'No hallo Futuraria en tus membresías'; end if;

  select w.id::text into v_seg_ws
  from public.workspaces w
  where (w.owner_id::text = v_seg::text
      or exists (select 1 from public.workspace_members mm
                 where mm.workspace_id::text = w.id::text and mm.user_id::text = v_seg::text))
    and w.id::text <> v_main
  limit 1;

  v_arr := array(
    select distinct x.wid from (
      select w.id::text as wid from public.workspaces w
       where w.owner_id is null and w.id::text <> v_main
      union
      select m.workspace_id::text from public.workspace_members m
       where m.user_id::text = v_me::text and m.workspace_id::text <> v_main
      union
      select v_seg_ws where v_seg_ws is not null and v_seg_ws <> v_main
    ) x
  );
  if coalesce(array_length(v_arr, 1), 0) = 0 then
    raise notice 'Ya todo está consolidado.'; return;
  end if;

  select coalesce(array_agg(c.oid), '{}') into v_swept_oids
  from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
    and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'workspace_id' and not a.attisdropped)
    and c.relname not in ('workspaces', 'workspace_members');

  for v_rec in
    select c.conname, nc.nspname as cns, cc.relname as ctab, c.conrelid, c.confrelid
    from pg_constraint c
    join pg_class cc on cc.oid = c.conrelid
    join pg_namespace nc on nc.oid = cc.relnamespace
    join pg_attribute aw on aw.attrelid = c.confrelid and aw.attname = 'workspace_id' and not aw.attisdropped
    where c.contype = 'f'
      and c.confkey @> array[aw.attnum]
      and (c.conrelid = any(v_swept_oids) or c.confrelid = any(v_swept_oids))
      and c.conrelid <> 'public.workspaces'::regclass
      and c.conrelid <> 'public.workspace_members'::regclass
  loop
    begin
      execute format('alter table %I.%I alter constraint %I deferrable', v_rec.cns, v_rec.ctab, v_rec.conname);
    exception when others then
      v_skip_oids := v_skip_oids || v_rec.conrelid || v_rec.confrelid;
    end;
  end loop;
  set constraints all deferred;

  for v_rec in
    select cc.relname, cc.oid from pg_class cc
    where cc.oid = any(v_swept_oids) and not (cc.oid = any(v_skip_oids))
  loop
    v_tab := v_rec.relname;
    begin
      select coalesce(t.typname = 'uuid', false) into v_ws_uuid
      from pg_attribute a join pg_type t on t.oid = a.atttypid
      where a.attrelid = v_rec.oid and a.attname = 'workspace_id';
      if v_ws_uuid then
        execute format('delete from public.%I where workspace_id::text = any(%L::text[])', v_tab, v_arr);
        v_tablas := v_tablas + 1;
        continue;
      end if;
      select exists (select 1 from pg_attribute a where a.attrelid = v_rec.oid and a.attname = 'id' and not a.attisdropped) into v_has_id;
      select a.attnum into v_ws_at from pg_attribute a where a.attrelid = v_rec.oid and a.attname = 'workspace_id' and not a.attisdropped;

      v_extra := ''; v_conds := ''; v_rename_set := '';
      v_has_rename := false; v_has_restrict := false; v_nx := 0;

      for v_rec2 in
        select c.conkey::int2[] as cols, ''::text as pred
        from pg_constraint c
        where c.conrelid = v_rec.oid and c.contype in ('u','p')
          and v_ws_at = any(c.conkey)
        union all
        select ix.indkey::int2[] as cols, coalesce(pg_get_expr(ix.indpred, ix.indrelid), '') as pred
        from pg_index ix
        where ix.indrelid = v_rec.oid and ix.indisunique
          and v_ws_at = any(ix.indkey::int2[])
      loop
        select coalesce(array_agg(a.attname order by x.ord), '{}') into v_others
        from unnest(v_rec2.cols) with ordinality x(attnum, ord)
        join pg_attribute a on a.attrelid = v_rec.oid and a.attnum = x.attnum and not a.attisdropped
        where x.attnum <> v_ws_at;
        v_k := coalesce(array_length(v_others, 1), 0);
        v_pred := v_rec2.pred;
        v_pfrag := case when v_pred <> '' then ' and (' || v_pred || ')' else '' end;
        v_ppart := case when v_pred <> '' then '(' || v_pred || '), ' else '' end;

        if v_k = 1 and v_others[1] in ('name','slug') then
          if v_others[1] = 'name' and v_rename_set not like '%name = %' then
            v_extra := v_extra || format(', (select count(*) from public.%I x where x.workspace_id::text = %L and x.name = t.name) as ya, row_number() over (partition by t.name order by t.id) as rn', v_tab, v_main);
            v_rename_set := v_rename_set || format(', name = case when m.ya = 0 and m.rn = 1 then t.name else left(t.name, 36) || %L || (m.rn + m.ya) end', ' · movido ');
            v_has_rename := true;
          elsif v_others[1] = 'slug' and v_rename_set not like '%slug = %' then
            v_extra := v_extra || format(', (select count(*) from public.%I x where x.workspace_id::text = %L and x.slug = t.slug) as ya_s, row_number() over (partition by t.slug order by t.id) as rn_s', v_tab, v_main);
            v_rename_set := v_rename_set || format(', slug = case when m.ya_s = 0 and m.rn_s = 1 then t.slug else left(t.slug, 30) || %L || (m.rn_s + m.ya_s) end', '-m');
            v_has_rename := true;
          end if;
        elsif v_k <= 6 then
          v_nx := v_nx + 1; v_has_restrict := true;
          v_eqs := ''; v_parts := ''; v_nulls := '';
          for j in 1..v_k loop
            v_cj := v_others[j];
            v_eqs := v_eqs || ' and x.' || quote_ident(v_cj) || ' = t.' || quote_ident(v_cj);
            v_parts := v_parts || (case when j = 1 then v_ppart else '' end)
              || 't.' || quote_ident(v_cj) || (case when j < v_k then ', ' else '' end);
            v_nulls := v_nulls || 't.' || quote_ident(v_cj) || ' is null or ';
          end loop;
          if v_k = 0 then
            v_parts := case when v_pred <> '' then '(' || v_pred || ')' else 'true' end;
            v_eqs := v_pfrag;
          end if;
          v_extra := v_extra || ', (select count(*) from public.' || quote_ident(v_tab)
            || ' x where x.workspace_id::text = ' || quote_literal(v_main)
            || (case when v_k = 0 then v_pfrag else v_eqs end)
            || ') as ya_' || v_nx::text
            || ', row_number() over (partition by ' || v_parts || ' order by t.id) as rn_' || v_nx::text;
          v_conds := v_conds || ' and (' || v_nulls
            || (case when v_pred <> '' then 'not ((' || v_pred || ')) or ' else '' end)
            || '(m.ya_' || v_nx::text || ' = 0 and m.rn_' || v_nx::text || ' = 1))';
        else
          raise exception 'Tabla % tiene un índice único con workspace_id + % columnas: manejo manual', v_tab, v_k;
        end if;
      end loop;

      if v_has_id and (v_has_rename or v_has_restrict) then
        v_sql := 'with mov as (select t.id' || v_extra
          || format(' from public.%I t where t.workspace_id::text = any(%L::text[]) ) ', v_tab, v_arr)
          || format('update public.%I t set workspace_id = %L', v_tab, v_main)
          || v_rename_set
          || ' from mov m where t.id = m.id' || v_conds;
        execute v_sql;
      else
        execute format('update public.%I set workspace_id = %L where workspace_id::text = any(%L::text[])', v_tab, v_main, v_arr);
      end if;
      v_tablas := v_tablas + 1;
    exception when others then
      v_fall := v_fall || format('%s → %s; ', v_tab, SQLERRM);
    end;
  end loop;
  if v_fall <> '' then
    raise exception 'Tablas que no se pudieron mover (NADA se aplicó): %', v_fall;
  end if;

  delete from public.workspace_members where workspace_id::text = any(v_arr);

  v_sql := 'insert into public.workspace_members (workspace_id, user_id, role) select '
    || (case when coalesce((select t.typname = 'uuid' from pg_attribute a join pg_type t on t.oid = a.atttypid where a.attrelid = 'public.workspace_members'::regclass and a.attname = 'workspace_id'), false)
        then quote_literal(v_main) || '::uuid' else quote_literal(v_main) end)
    || ', ' || quote_literal(v_me::text) || ', ''owner'''
    || ' where not exists (select 1 from public.workspace_members m where m.workspace_id::text = ' || quote_literal(v_main)
    || ' and m.user_id::text = ' || quote_literal(v_me::text) || ')';
  execute v_sql;
  if v_seg is not null then
    v_sql := 'insert into public.workspace_members (workspace_id, user_id, role) select '
      || (case when coalesce((select t.typname = 'uuid' from pg_attribute a join pg_type t on t.oid = a.atttypid where a.attrelid = 'public.workspace_members'::regclass and a.attname = 'workspace_id'), false)
          then quote_literal(v_main) || '::uuid' else quote_literal(v_main) end)
      || ', ' || quote_literal(v_seg::text) || ', ''owner'''
      || ' where not exists (select 1 from public.workspace_members m where m.workspace_id::text = ' || quote_literal(v_main)
      || ' and m.user_id::text = ' || quote_literal(v_seg::text) || ')';
    execute v_sql;
  end if;

  delete from public.workspaces where id::text = any(v_arr);
  raise notice 'Fusionados % espacios en Futuraria. Tablas tocadas: %', coalesce(array_length(v_arr, 1), 0), v_tablas;
end
$con$;
*/

-- ── PASO 2b · Asignar created_by de lo no asignado + adoptar huérfanos (IDEMPOTENTE) ──
-- Requiere tabla con created_by Y workspace_id (text). Excluye comentados/guests.
-- Do-block: pasa do $cb$ ... para ejecutarlo.
/*
do $cb$
declare
  v_owner uuid; v_main text; v_tab text; v_n bigint; v_total bigint := 0;
begin
  select id into v_owner from auth.users where email = 'renzo@futuraria.com';
  select m.workspace_id::text into v_main
  from public.workspace_members m
  join public.workspaces w on w.id::text = m.workspace_id::text
  where m.user_id::text = v_owner::text and w.name = 'Futuraria' limit 1;
  if v_main is null then raise exception 'No hallo Futuraria'; end if;
  for v_tab in
    select c1.table_name
    from information_schema.columns c1
    join information_schema.columns c2
      on c2.table_schema = c1.table_schema and c2.table_name = c1.table_name and c2.column_name = 'workspace_id'
    join information_schema.tables t
      on t.table_schema = c1.table_schema and t.table_name = c1.table_name and t.table_type = 'BASE TABLE'
    where c1.table_schema = 'public' and c1.column_name = 'created_by'
      and c2.data_type in ('text','character varying','character')
      and c1.table_name not in ('content_comments','brand_guests')
  loop
    execute format('update public.%I set created_by = %L where workspace_id::text = %L and created_by is null', v_tab, v_owner::text, v_main);
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
  end loop;
  update public.templates set workspace_id = v_main where workspace_id::text = 'ws_0e3002d1-c5a';
end $cb$;
*/

-- ── PASO 2 · Verificación: qué quedó en tu cuenta ──
-- (corre de nuevo el PASO 0 después del PASO 1: debe quedar una sola fila
--  con destino «PRINCIPAL (se queda)» y todas las filas de contenido ahí)
