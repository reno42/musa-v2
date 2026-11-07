-- ═══════════════════════════════════════════════════════════════════════════
-- Migración 24 — Perfil visible del cliente («Mi información» en su portal).
--
-- brand_guests.profile (jsonb) es la ÚNICA proyección del cliente que ve en
-- su intranet: display_name, title, company, phone. La lista de campos la
-- impone el server (services/clientAccess.ts → sanitizeProfile); NADA
-- comercial (tags, estado CRM, notas, deals, fees) vive aquí — eso queda en
-- crm_contacts, que los invitados jamás leen.
--
-- Idempotente, sin backfill (los perfiles se escriben al provisionar o al
-- editarlos desde el CRM / MCP). La tabla ya tiene sus políticas RLS; esta
-- columna hereda el mismo acceso (server la re-exige por código además).
--
-- CÓMO USARLO: Dashboard › SQL Editor → correr. Éxito = "Success. No rows
-- returned". Sin esta columna el sistema degrada con gracia (el portal
-- muestra solo correo y fecha; provisionar guarda sin perfil).
-- Ejecutado: 2026-11-06 (Success. No rows returned).
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.brand_guests add column if not exists profile jsonb;
