-- Backend Musa v2: avances del carril datos (Hermes) para que Claude implemente la UI.
-- Aplicado en la BD de pruebas lnbsmnbvclxrwwcuuvud el 2026-11-02. Idempotente.

-- 1) Inbox real: columna para el botón "Asignar" (hoy rota nombres inventados en la maqueta)
alter table social_inbox add column if not exists assigned_to uuid references auth.users(id) on delete set null;

-- 2) Tabla briefs: la vista Briefs no tenía tabla (wipeDemo la vacía y nadie la llena)
create table if not exists briefs (
  id uuid default gen_random_uuid() primary key,
  workspace_id text not null,
  brand_id text,                          -- brands usa ids TEXT (brand_xxx), NO uuid
  title text not null,
  status text default 'borrador' not null,
  objective text,
  audience text,
  tone text,
  deliverables jsonb default '[]'::jsonb,
  content jsonb default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

alter table briefs enable row level security;

drop policy if exists briefs_read on briefs;
create policy briefs_read on briefs for select
  using (has_workspace_role(workspace_id, 'viewer'));

drop policy if exists briefs_write on briefs;
create policy briefs_write on briefs for all
  using (has_workspace_role(workspace_id, 'editor'))
  with check (has_workspace_role(workspace_id, 'editor'));

grant select, insert, update, delete on briefs to authenticated;
grant select on briefs to anon;

-- Notas de integración UI (public/musa + bridges):
--  * briefs es PostgREST-directo: GET/POST/PATCH https://lnbsmnbvclxrwwcuuvud.supabase.co/rest/v1/briefs
--    con la sesión del user (mismo helper api()/get()/patch() de bridge.js).
--  * workspace_events y workspace_mailings YA existían con RLS y quedaron con datos seed:
--    las vistas Events/Mailing pueden hookearse sin DDL nuevo (solo cargarlas en bridge.js
--    donde hoy wipeDemo las vacía: bridge.js:76-97).
--  * "Crear oportunidad" del inbox (index.html:7443) debe hacer POST a crm_deals con
--    brand_id/contact reales del inbox — tabla y RLS ya listos.
--  * "Asignar" (index.html:7441) → PATCH social_inbox.assigned_to con members reales
--    (join workspace_members → user_profiles.display_name; el ws de Renzo hoy tiene 1 member).
