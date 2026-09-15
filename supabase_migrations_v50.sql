-- ═══════════════════════════════════════════════════════════════
-- supabase_migrations_v50.sql — Privado por defecto (share growth
-- loop, Futuraria Design, septiembre 2026)
-- ═══════════════════════════════════════════════════════════════
--
-- WHAT (decisión explícita de producto):
--   1. DEFAULT FALSE: todo diseño NUEVO nace privado. El enlace
--      /c/:templateId solo abre el diseño cuando el dueño activa
--      "Público" en el menú Compartir del editor.
--   2. UPDATE masivo: los diseños EXISTENTES también pasan a privado
--      (rompe enlaces públicos activos — los dueños deben re-activar
--      "Público" para volver a compartir; decidido así a propósito).
--
-- El endpoint /api/comments-share sigue fail-open para bases SIN la
-- columna (is_public === false nunca matchea undefined), pero con la
-- columna NOT NULL ya no hay undefined: la decisión vive en los datos.
--
-- Idempotente: seguro de re-ejecutar. Después de aplicar en
-- producción, actualizar .migration-version a v50.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE templates
  ALTER COLUMN is_public SET DEFAULT FALSE;

UPDATE templates
  SET is_public = FALSE
  WHERE is_public IS DISTINCT FROM FALSE;

COMMENT ON COLUMN templates.is_public IS
  'Whether the guest share link /c/:templateId opens the design (SharedDesignGate). FALSE = guests get the auth gate (data answers 403 PRIVATE). Private by default for ALL designs since v50.';
