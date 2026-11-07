-- ═══════════════════════════════════════════════════════════════════════════
-- Prueba de seguridad en vivo — migración 23 (modo freelancer/agencia).
-- Correr en el SQL editor de la DB DE PRUEBAS (lnbsmnbvclxrwwcuuvud), DESPUÉS
-- de aplicar db/migrations-v2/23_v2_agencia_privacidad.sql (obligatorio: crea
-- brand_guests/brand_portal/content_comments y las columnas visibility/created_by).
--
-- Usuarios REALES de auth.users (el FK workspace_members_user_id_fkey exige ids
-- que existan). Todo va en una transacción con ROLLBACK: no toca sus datos.
--   OWNER  e1016900-3888-410a-80dd-1b4b7ea06f6e  qa-dogfood-…@example.com
--   MEMBER 55645b04-0d2c-44b4-89bf-1cbff6a80f96  renzo+testinstinct@futuraria.com
--   GUEST  1a203fe4-61a5-4099-ae89-31ba7e6ea69d  ognewcap@gmail.com
--
-- Qué prueba (RLS real, impersonando con request.jwt.claims):
--   1. El owner ve TODO el contenido del workspace (4 templates).
--   2. Un miembro editor ve lo compartido (3); lo privado de otro NO (0).
--   3. El invitado (cliente) solo ve lo compartido de SU marca (1); un
--      privado jamás (0); musa_guest_brand_ids devuelve su marca.
--   4. El invitado NO inserta contenido (ag_write exige editor) ni comenta
--      la marca ajena (bloqueado); su marca SÍ (author_role client).
--   5. brand_portal: invitado lee solo el portal de su marca (1); miembro 2.
--   6. content_comments: miembro e invitado ven el hilo (2 c/u); el invitado
--      NO resuelve el comentario de otro (0 filas); el autor sí (1 fila).
--
-- Todo va dentro de una transacción con ROLLBACK: no deja datos.
-- ═══════════════════════════════════════════════════════════════════════════
begin;

-- ── Escape del servidor (solo fixtures) ──
-- Los insertos de prueba crean 2 marcas y 2 miembros, y los guardas de plan
-- (trg_brand_limit / trg_seat_limit, migración 20) los rechazarían con
-- LIMIT_BRANDS / LIMIT_SEATS. musa.trusted='1' es el MISMO escape que usa el
-- backend para trabajos internos; vive SOLO dentro de esta transacción y se
-- baja antes de las aserciones para que el RLS se mida sin privilegios.
select set_config('musa.trusted', '1', true);

-- ── Precondición: migración 23 aplicada en esta DB ──
do $pre$ begin
  if to_regclass('public.brand_guests') is null then
    raise exception 'FALLO precondición: brand_guests no existe. Corre PRIMERO db/migrations-v2/23_v2_agencia_privacidad.sql en esta DB.';
  end if;
end $pre$;

-- ── Fixtures (postgres es dueño de las tablas → RLS no aplica al dueño) ──
do $fix$
begin
  insert into public.workspaces (id, name, owner_id, data) values
    ('ws_agtest23', 'Agencia AGTEST', 'e1016900-3888-410a-80dd-1b4b7ea06f6e', '{}'::jsonb);
exception when others then raise exception 'FALLO fixture workspaces: %', sqlerrm; end $fix$;

do $fix$
begin
  insert into public.workspace_members (workspace_id, user_id, role) values
    ('ws_agtest23', 'e1016900-3888-410a-80dd-1b4b7ea06f6e', 'owner'),
    ('ws_agtest23', '55645b04-0d2c-44b4-89bf-1cbff6a80f96', 'editor');
exception when others then raise exception 'FALLO fixture workspace_members: %', sqlerrm; end $fix$;

do $fix$
begin
  insert into public.brands (id, workspace_id, name) values
    ('brand_agtest_a', 'ws_agtest23', 'Cliente A'),
    ('brand_agtest_b', 'ws_agtest23', 'Cliente B');
exception when others then raise exception 'FALLO fixture brands: %', sqlerrm; end $fix$;

do $fix$
begin
  -- El invitado llega ya ligado (user_id seteado): el lazy-link por email se
  -- prueba en el API (accessFor), no aquí.
  insert into public.brand_guests (workspace_id, brand_id, email, user_id, status, invited_by) values
    ('ws_agtest23', 'brand_agtest_a', 'cliente.a@test.local',
     '1a203fe4-61a5-4099-ae89-31ba7e6ea69d', 'activo',
     'e1016900-3888-410a-80dd-1b4b7ea06f6e');
exception when others then raise exception 'FALLO fixture brand_guests: %', sqlerrm; end $fix$;

do $fix$
begin
  insert into public.templates (id, workspace_id, name, data, visibility, created_by) values
    ('tpl_agtest_shared',  'ws_agtest23', 'Post compartido cliente A',
     '{"brandId":"brand_agtest_a","frames":[]}', 'shared',
     'e1016900-3888-410a-80dd-1b4b7ea06f6e'),
    ('tpl_agtest_priv',    'ws_agtest23', 'Borrador privado',
     '{"brandId":"brand_agtest_a","frames":[]}', 'private',
     'e1016900-3888-410a-80dd-1b4b7ea06f6e'),
    ('tpl_agtest_marcaB',  'ws_agtest23', 'Post cliente B',
     '{"brandId":"brand_agtest_b","frames":[]}', 'shared',
     'e1016900-3888-410a-80dd-1b4b7ea06f6e'),
    ('tpl_agtest_sinmarca','ws_agtest23', 'Archivo interno',
     '{"frames":[]}', 'shared',
     'e1016900-3888-410a-80dd-1b4b7ea06f6e');
exception when others then raise exception 'FALLO fixture templates (¿corriste la migración 23?): %', sqlerrm; end $fix$;

do $fix$
begin
  insert into public.brand_portal (workspace_id, brand_id, display_name) values
    ('ws_agtest23', 'brand_agtest_a', 'Portal Cliente A'),
    ('ws_agtest23', 'brand_agtest_b', 'Portal Cliente B');
exception when others then raise exception 'FALLO fixture brand_portal: %', sqlerrm; end $fix$;

do $fix$
begin
  insert into public.content_comments
    (id, workspace_id, entity_type, entity_id, brand_id, body, author_user_id, author_name, author_role) values
    ('cmt_agtest_member1', 'ws_agtest23', 'templates', 'tpl_agtest_shared', 'brand_agtest_a',
     'Me gusta esta versión', '55645b04-0d2c-44b4-89bf-1cbff6a80f96', 'Renzo Test', 'member');
exception when others then raise exception 'FALLO fixture content_comments: %', sqlerrm; end $fix$;

-- Se baja el escape: de aquí en adelante el RLS se mide real.
-- (reset role NO limpia musa.trusted — hay que bajarlo explícito.)
select set_config('musa.trusted', '', true);

-- ══ 1. Owner ve todo (4 templates del workspace) ══
do $a$
declare n int;
begin
  reset role;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"e1016900-3888-410a-80dd-1b4b7ea06f6e"}', true);
  select count(*) into n from public.templates where workspace_id = 'ws_agtest23';
  if n <> 4 then raise exception 'FALLO 1: owner ve % templates (esperaba 4)', n; end if;
end $a$;

-- ══ 2. Miembro editor: ve 3 compartidos; el privado de otro NO ══
do $a$
declare n int;
begin
  reset role;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"55645b04-0d2c-44b4-89bf-1cbff6a80f96"}', true);
  select count(*) into n from public.templates where workspace_id = 'ws_agtest23';
  if n <> 3 then raise exception 'FALLO 2a: miembro ve % templates (esperaba 3, sin el privado)', n; end if;
  select count(*) into n from public.templates where id = 'tpl_agtest_priv';
  if n <> 0 then raise exception 'FALLO 2b: el miembro VIO el privado de otro (% filas)', n; end if;
end $a$;

-- ══ 3. Invitado: solo lo compartido de SU marca; guest_brand_ids correcto ══
do $a$
declare n int; b text[];
begin
  reset role;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"1a203fe4-61a5-4099-ae89-31ba7e6ea69d"}', true);
  select count(*) into n from public.templates where workspace_id = 'ws_agtest23';
  if n <> 1 then raise exception 'FALLO 3a: invitado ve % templates (esperaba 1, el compartido de su marca)', n; end if;
  select count(*) into n from public.templates where id = 'tpl_agtest_priv';
  if n <> 0 then raise exception 'FALLO 3b: el invitado VIO un privado (% filas)', n; end if;
  b := public.musa_guest_brand_ids('1a203fe4-61a5-4099-ae89-31ba7e6ea69d'::uuid, 'ws_agtest23');
  if b is distinct from array['brand_agtest_a']::text[] then
    raise exception 'FALLO 3c: musa_guest_brand_ids devolvió % (esperaba {brand_agtest_a})', b;
  end if;
end $a$;

-- ══ 4. Escritura: invitado no inserta contenido ni comenta marca ajena ══
do $a$
begin
  reset role;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"1a203fe4-61a5-4099-ae89-31ba7e6ea69d"}', true);
  -- 4a: insertar un template debe FALLAR (ag_write exige editor del workspace)
  begin
    insert into public.templates (id, workspace_id, name, data, visibility, created_by) values
      ('tpl_agtest_guest', 'ws_agtest23', 'Intento de invitado',
       '{"brandId":"brand_agtest_a","frames":[]}', 'shared',
       '1a203fe4-61a5-4099-ae89-31ba7e6ea69d');
    raise exception 'NO_FALLÓ';
  exception when others then
    if sqlerrm = 'NO_FALLÓ' then
      raise exception 'FALLO 4a: el invitado PUDO insertar un template';
    end if;
  end;
  -- 4b: comentar la marca B debe FALLAR (no es invitado de esa marca)
  begin
    insert into public.content_comments
      (workspace_id, entity_type, entity_id, brand_id, body, author_user_id, author_name, author_role) values
      ('ws_agtest23', 'templates', 'tpl_agtest_marcaB', 'brand_agtest_b', 'Fuera de mi marca',
       '1a203fe4-61a5-4099-ae89-31ba7e6ea69d', 'Invitado', 'client');
    raise exception 'NO_FALLÓ';
  exception when others then
    if sqlerrm = 'NO_FALLÓ' then
      raise exception 'FALLO 4b: el invitado PUDO comentar la marca B';
    end if;
  end;
  -- 4c: comentar SU marca SÍ funciona (author_role client)
  insert into public.content_comments
    (id, workspace_id, entity_type, entity_id, brand_id, body, author_user_id, author_name, author_role) values
    ('cmt_agtest_guest1', 'ws_agtest23', 'templates', 'tpl_agtest_shared', 'brand_agtest_a',
     'Nos gusta, aprobado', '1a203fe4-61a5-4099-ae89-31ba7e6ea69d', 'Invitado', 'client');
end $a$;

-- ══ 5. Portal: invitado ve 1 portal (su marca); miembro ve 2 ══
do $a$
declare n int;
begin
  reset role;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"1a203fe4-61a5-4099-ae89-31ba7e6ea69d"}', true);
  select count(*) into n from public.brand_portal where workspace_id = 'ws_agtest23';
  if n <> 1 then raise exception 'FALLO 5a: invitado ve % portales (esperaba 1, su marca)', n; end if;
  perform set_config('request.jwt.claims', '{"sub":"55645b04-0d2c-44b4-89bf-1cbff6a80f96"}', true);
  select count(*) into n from public.brand_portal where workspace_id = 'ws_agtest23';
  if n <> 2 then raise exception 'FALLO 5b: miembro ve % portales (esperaba 2)', n; end if;
end $a$;

-- ══ 6. Comentarios: hilo visible; resolver SOLO el autor propio ══
do $a$
declare n int; r boolean;
begin
  reset role;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"1a203fe4-61a5-4099-ae89-31ba7e6ea69d"}', true);
  select count(*) into n from public.content_comments where workspace_id = 'ws_agtest23';
  if n <> 2 then raise exception 'FALLO 6a: invitado ve % comentarios (esperaba 2: el del miembro y el propio)', n; end if;
  -- 6b: resolver el comentario del MIEMBRO debe filtrarse por RLS (0 filas)
  update public.content_comments set resolved = true where id = 'cmt_agtest_member1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLO 6b: el invitado RESOLVIÓ el comentario de otro (% filas)', n; end if;
  -- cambio de usuario dentro del mismo bloque
  perform set_config('request.jwt.claims', '{"sub":"55645b04-0d2c-44b4-89bf-1cbff6a80f96"}', true);
  select count(*) into n from public.content_comments where workspace_id = 'ws_agtest23';
  if n <> 2 then raise exception 'FALLO 6c: miembro ve % comentarios (esperaba 2)', n; end if;
  -- 6d: el autor resuelve el propio (1 fila) y el flag queda en true
  update public.content_comments set resolved = true where id = 'cmt_agtest_member1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FALLO 6d: el autor no resolvió su propio comentario (% filas)', n; end if;
  select resolved into r from public.content_comments where id = 'cmt_agtest_member1';
  if r is not true then raise exception 'FALLO 6e: resolved no quedó en true'; end if;
end $a$;

rollback;

-- Si llegaste aquí sin errores: las 6 pruebas de seguridad pasaron.
do $done$ begin
  raise notice 'OK: migración 23 — owner/miembro/invitado, portal y comentarios se comportan según el modelo privado/compartido.';
end $done$;
