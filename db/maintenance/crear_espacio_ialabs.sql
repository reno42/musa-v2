/* ═══════════════════════════════════════════════════════════════════════════
   crear_espacio_ialabs.sql — Segundo espacio de agencia de Mayckol: «IA Labs»
   (servicios de IA, eventos y capacitaciones, a compartir con Jhon).

   Para qué: una cuenta puede tener UN espacio personal + VARIOS espacios de
   agencia (la creación ya existe en la plataforma: Configuración › Espacios y
   planes o «Crear espacio» en el desplegable). Este script provisiona el de
   Mayckol por SQL para que le aparezca en el selector sin que lo cree a mano.
   Jhon entra DESPUÉS: por invitación desde la UI (recomendado) o por SQL
   (bloque comentado al final) cuando su cuenta exista.

   Propiedades:
   · Idempotente: id fijo ws_ialabs + guarda por nombre (si ya lo creó desde
     la UI, no duplica); ON CONFLICT / WHERE NOT EXISTS en ambas tablas.
   · Transaccional: cualquier error revierte TODO (no queda a medias).
   · Puerta de evidencia: si el correo no resuelve a UN solo usuario, aborta
     avisando en vez de crear el espacio para nadie.

   CÓMO USARLO: Dashboard › SQL Editor → pega el bloque DO completo → correr.
   Éxito = NOTICE "IA Labs creado para <uid>" o "IA Labs ya existía: nada que
   hacer" (y "Success. No rows returned"). Después corre la VERIFICACIÓN del
   final y pega la rejilla.
   Ejecutado: pendiente.
   ═══════════════════════════════════════════════════════════════════════════ */

DO $$
DECLARE
  v_uid    uuid;
  v_ws     text := 'ws_ialabs';
  v_nombre text := 'IA Labs';
  v_n      int;
BEGIN
  -- puerta 1: el correo debe resolver a EXACTAMENTE un usuario
  SELECT count(*) INTO v_n FROM auth.users WHERE lower(email) = 'mayckco@gmail.com';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'esperaba 1 usuario para mayckco@gmail.com y hay % — ajusta el correo y reintenta', v_n;
  END IF;
  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = 'mayckco@gmail.com';

  -- puerta 2: idempotencia también por nombre (si ya lo creó desde la UI nueva)
  IF EXISTS (SELECT 1 FROM workspaces
             WHERE owner_id = v_uid::text AND lower(name) = lower(v_nombre)) THEN
    RAISE NOTICE 'IA Labs ya existía para este usuario: nada que hacer';
    RETURN;
  END IF;

  -- el espacio (mismas columnas mínimas que el backfill de personales + slug)
  INSERT INTO workspaces (id, name, slug, owner_id)
  VALUES (v_ws, v_nombre, 'ia-labs', v_uid::text)
  ON CONFLICT (id) DO NOTHING;

  -- su dueño como miembro (el trigger trg_seat_limit exime al dueño)
  INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
  SELECT v_ws, v_uid, 'owner', now()
  WHERE NOT EXISTS (SELECT 1 FROM workspace_members
                    WHERE workspace_id = v_ws AND user_id = v_uid);

  RAISE NOTICE 'IA Labs creado para %', v_uid;
END $$;

/* ── VERIFICACIÓN (correr aparte y pegar la rejilla) ──
   Espacios de Mayckol (deben salir: Nucleo + IA Labs + su espacio personal):

   SELECT w.id, w.name, m.role
   FROM workspace_members m
   JOIN workspaces w ON w.id = m.workspace_id
   JOIN auth.users  u ON u.id = m.user_id
   WHERE lower(u.email) = 'mayckco@gmail.com'
   ORDER BY w.id;
*/

/* ── CUANDO JHON TENGA CUENTA (elige UNA opción) ──
   Opción A — RECOMENDADA: Mayckol lo invita desde IA Labs › Configuración ›
   Equipo (correo o enlace de 7 días; rol editor/lectura/admin a elección).
   Queda registro en workspace_invitations y puede reenviar/anular.

   Opción B — SQL directo (acceso inmediato; reemplaza el correo de Jhon):
   DO $$
   DECLARE v_jhon uuid;
   BEGIN
     SELECT id INTO v_jhon FROM auth.users WHERE lower(email) = 'jhon@DOMINIO';
     IF v_jhon IS NULL THEN
       RAISE EXCEPTION 'aún no existe cuenta para Jhon con ese correo';
     END IF;
     INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
     SELECT 'ws_ialabs', v_jhon, 'owner', now()
     WHERE NOT EXISTS (SELECT 1 FROM workspace_members
                       WHERE workspace_id = 'ws_ialabs' AND user_id = v_jhon);
     RAISE NOTICE 'Jhon dentro de IA Labs como owner';
   END $$;

   (el límite de asientos no aplica: el plan de Mayckol es ilimitado; cambia
   'owner' por 'editor' o 'admin' si prefieres otro rol)
*/
