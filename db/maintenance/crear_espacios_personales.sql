/* ═══════════════════════════════════════════════════════════════════════════
   crear_espacios_personales.sql — Cada usuario que trabaja en un espacio de
   agencia/empresa recibe su ESPACIO PERSONAL (ws_user_…), privado y solo
   suyo, con rol dueño.

   Para qué: el desplegable de la cuenta (bridge-account.js) lista Personal +
   Agencia. Al cambiar de espacio, bridge.js recarga TODOS los datos filtrando
   por workspace_id (loadWorkspace), así que los archivos personales nunca se
   mezclan con los de la agencia y nadie más los ve: el espacio personal no
   tiene otros miembros.

   Propiedades:
   · Idempotente: quien ya tiene un ws_user_ propio se salta; repeticiones no
     duplican (ON CONFLICT DO NOTHING).
   · Transaccional: cualquier error revierte TODO (no queda a medias).
   · Puerta de evidencia: si workspaces tuviera una columna obligatoria sin
     default que no estamos escribiendo, aborta AVISANDO en vez de fallar raro.

   CÓMO USARLO: Dashboard › SQL Editor → pega el bloque DO completo → correr.
   Éxito = NOTICE "espacios personales creados: N" (y "Success. No rows
   returned"). Después corre la VERIFICACIÓN del final y pega la rejilla.
   Ejecutado: 2026-11-06, éxito reportado por el usuario.
   ═══════════════════════════════════════════════════════════════════════════ */

DO $$
DECLARE
  r RECORD;
  v_ws text;
  v_n int := 0;
  v_malas text[];
BEGIN
  -- puerta: columnas de workspaces obligatorias y sin default que NO escribimos
  SELECT array_agg(c.column_name) INTO v_malas
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'workspaces'
    AND c.is_nullable = 'NO'
    AND c.column_default IS NULL
    AND c.column_name NOT IN ('id', 'name', 'owner_id');
  IF v_malas IS NOT NULL THEN
    RAISE EXCEPTION 'workspaces exige columnas que este script no escribe: % — detener y revisar esquema', v_malas;
  END IF;

  FOR r IN
    SELECT DISTINCT m.user_id
    FROM workspace_members m
    JOIN workspaces w ON w.id = m.workspace_id
    WHERE w.id !~ '^ws_user_'                       -- trabaja en un espacio de agencia/empresa
      AND NOT EXISTS (                              -- y aún no tiene espacio personal
        SELECT 1
        FROM workspace_members mp
        WHERE mp.user_id = m.user_id
          AND mp.workspace_id ~ '^ws_user_'
      )
  LOOP
    -- mismo molde que los personales de registro: ws_user_ + 20 hex estables del usuario
    v_ws := 'ws_user_' || substr(md5(r.user_id::text), 1, 20);

    INSERT INTO workspaces (id, name, owner_id)
    VALUES (v_ws, 'Workspace personal', r.user_id)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
    VALUES (v_ws, r.user_id, 'owner', now())
    ON CONFLICT DO NOTHING;

    v_n := v_n + 1;
  END LOOP;

  RAISE NOTICE 'espacios personales creados: %', v_n;
END $$;

/* ── VERIFICACIÓN (correr aparte y pegar la rejilla) ──
   1) Tus dos espacios como usuario:
   SELECT w.id, w.name, m.role
   FROM workspace_members m
   JOIN workspaces w ON w.id = m.workspace_id
   JOIN user_profiles up ON up.id = m.user_id
   WHERE up.email = 'renzo@futuraria.com'
   ORDER BY w.id;

   2) Nadie más entra a un personal (debe dar 0 filas):
   SELECT m.workspace_id, count(*) AS miembros
   FROM workspace_members m
   WHERE m.workspace_id ~ '^ws_user_'
   GROUP BY m.workspace_id HAVING count(*) > 1;
*/
