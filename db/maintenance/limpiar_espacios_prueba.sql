/* ═══════════════════════════════════════════════════════════════════════════
   limpiar_espacios_prueba.sql — limpieza de espacios de prueba (PRODUCCIÓN)
   Dueño: renzo@futuraria.com — 2026-11-05

   CÓMO USARLO (en el SQL editor de la DB de PRODUCCIÓN):
   1. Corre el PASO 1 (inventario) y el PASO 1b (chequeo de riesgos).
   2. Decide qué ids del inventario son espacios de prueba.
   3. Descomenta el PASO 2, pega esos ids en v_ids y corre TODO el script.
      Si algo falla a la mitad, la transacción no aplicó nada: pégame el error.

   El barrido es DINÁMICO: descubre las tablas con columna workspace_id, no
   lleva listas escritas a mano, así que no asume el esquema.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── PASO 1 · Inventario: espacios DE tu cuenta y cuánto contenido tiene cada uno ── */
drop table if exists ws_inventario;
-- id text: en la DB real workspaces.id puede ser text (así es en prod) o uuid;
-- normalizamos TODO a texto para que el script funcione en ambos casos
create temp table ws_inventario (id text, nombre text, creado timestamptz, contenido jsonb, filas bigint);

do $inv$
declare
  v_owner uuid;
  v_ws record;
  v_tab text;
  v_n bigint;
  v_total bigint;
  v_json jsonb;
begin
  select u.id into v_owner from auth.users u where u.email = 'renzo@futuraria.com';
  if v_owner is null then
    raise exception 'No existe el usuario renzo@futuraria.com en esta DB. ¿Estás en producción?';
  end if;

  for v_ws in
    select w.id, w.name, w.created_at
    from public.workspaces w
    where w.owner_id::text = v_owner::text
    order by w.created_at
  loop
    v_json := '{}'::jsonb;
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
      if v_n > 0 then
        v_json := v_json || jsonb_build_object(v_tab, v_n);
        v_total := v_total + v_n;
      end if;
    end loop;
    insert into ws_inventario values (v_ws.id::text, v_ws.name, v_ws.created_at, v_json, v_total);
  end loop;
end
$inv$;

select nombre, creado, filas as filas_de_contenido, contenido, id
from ws_inventario
order by creado;

/* ── PASO 1b · Chequeo de riesgos: tablas que apuntan a tablas de un espacio
      (workspaces, brands, templates…) pero NO tienen workspace_id propio.
      Si devuelve filas NO pasa nada: el paso 2 las barre primero por su FK
      (barrido de hijas). Solo avísame si el PASO 2 llega a fallar. ── */
select c.conname, c.conrelid::regclass as tabla_que_apunta, c.confrelid::regclass as tabla_padre
from pg_constraint c
where c.contype = 'f'
  and c.confrelid in (
    select (quote_ident(t.table_schema) || '.' || quote_ident(t.table_name))::regclass
    from information_schema.columns t
    where t.table_schema = 'public' and t.column_name = 'workspace_id'
  )
  and c.conrelid::regclass::text not in (
    select (quote_ident(t2.table_schema) || '.' || quote_ident(t2.table_name))::regclass::text
    from information_schema.columns t2
    where t2.table_schema = 'public' and t2.column_name = 'workspace_id'
  );

/* ── PASO 2 · BORRADO (descomentar TODO el bloque, pegar los ids en v_ids) ──
do $del$
declare
  v_ids text[] := array[
    'PEGA_AQUI_EL_ID_1'
    -- ,'PEGA_AQUI_EL_ID_2'
  ];  -- los ids van tal cual, como texto (copia el id de la columna id del paso 1)
  v_tab text;
  v_n bigint;
  v_total bigint := 0;
  v_pass int;
  v_round bigint;
  v_fk record;
  v_sql text;
  v_fall text := '';
begin
  -- cinturón de seguridad: solo espacios que te pertenecen
  v_ids := array(
    select w.id from public.workspaces w
    where w.id::text = any(v_ids)
      and w.owner_id::text = (select u.id::text from auth.users u where u.email = 'renzo@futuraria.com')
  );
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'Nada que borrar: revisa los ids del paso 1';
  end if;
  raise notice 'Borrando % espacio(s): %', coalesce(array_length(v_ids, 1), 0), v_ids;

  -- 1) HIJAS sin workspace_id (comments sobre templates, harness_* sobre tareas
  --    del kanban, video/motion/scene sobre proyectos, deliveries, rewards…).
  --    Descubre las FK desde el catálogo y borra hijos antes que padres, en
  --    pasadas hasta que no quede nada (profundidad arbitraria).
  for v_pass in 1..10 loop
    v_round := 0;
    for v_fk in
      select c.conrelid as child_oid, c.confrelid as parent_oid, c.conkey, c.confkey
      from pg_constraint c
      where c.contype = 'f'
        -- detección por OID directo en pg_attribute: regclass::text solo
        -- califica con esquema si la tabla NO está en search_path, así que
        -- partir por '.' puede devolver vacío y saltarse todo el barrido
        and exists (
          select 1 from pg_attribute pa
          where pa.attrelid = c.confrelid
            and pa.attname = 'workspace_id'
            and pa.attnum > 0 and not pa.attisdropped)
        and not exists (
          select 1 from pg_attribute pc
          where pc.attrelid = c.conrelid
            and pc.attname = 'workspace_id'
            and pc.attnum > 0 and not pc.attisdropped)
    loop
      select format(
        'delete from %s where (%s) in (select %s from %s where workspace_id::text = any(%L::text[]))',
        v_fk.child_oid::regclass,
        (select string_agg(quote_ident(a.attname), ', ' order by u.ord)
           from unnest(v_fk.conkey) with ordinality as u(attnum, ord)
           join pg_attribute a
             on a.attrelid = v_fk.child_oid and a.attnum = u.attnum
            and a.attnum > 0 and not a.attisdropped),
        (select string_agg(quote_ident(a.attname), ', ' order by u.ord)
           from unnest(v_fk.confkey) with ordinality as u(attnum, ord)
           join pg_attribute a
             on a.attrelid = v_fk.parent_oid and a.attnum = u.attnum
            and a.attnum > 0 and not a.attisdropped),
        v_fk.parent_oid::regclass,
        array(select x::text from unnest(v_ids) x)
      ) into v_sql;
      begin
        execute v_sql;
        get diagnostics v_n = row_count;
        v_round := v_round + v_n;
        if v_n > 0 then
          raise notice '%: % fila(s)', v_fk.child_oid::regclass, v_n;
        end if;
      exception when others then
        -- si una hija está bloqueada por otra tabla que ni siquiera salió en
        -- el chequeo, seguimos con las demás y al final avisamos con detalle
        v_fall := v_fall || format('%s → %s; ', v_fk.child_oid::regclass, SQLERRM);
      end;
    end loop;
    v_total := v_total + v_round;
    exit when v_round = 0;
  end loop;
  if v_fall <> '' then
    raise exception 'Tablas hijas que no se pudieron borrar (nada se aplicó): %', v_fall;
  end if;

  -- 2) tablas con workspace_id (el barrido genérico de siempre)
  for v_tab in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'workspace_id'
      and t.table_type = 'BASE TABLE'
  loop
    execute format('delete from public.%I where workspace_id::text = any(%L::text[])', v_tab, array(select x::text from unnest(v_ids) x));
    get diagnostics v_n = row_count;
    if v_n > 0 then
      raise notice '%: % fila(s)', v_tab, v_n;
      v_total := v_total + v_n;
    end if;
  end loop;

  delete from public.workspaces where id::text = any(v_ids);
  get diagnostics v_n = row_count;
  raise notice 'workspaces: % fila(s)', v_n;
  raise notice 'Listo. Filas de contenido borradas: %', v_total;
end
$del$;
*/
