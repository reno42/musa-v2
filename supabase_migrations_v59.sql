-- supabase_migrations_v59.sql
-- Apply after v58. Idempotent and safe to re-run.
--
-- REQ-PHOTO-PLATFORM-001 (REQ-32) — plataforma fotográfica, Fase 1 "Modo Foto".
--
--   1. photo_documents: UN documento de revelado por (workspace, foto fuente).
--      La foto nunca se toca: source_url es la URL canónica del asset original
--      y las ediciones viven como recetas versionadas en photo_versions.
--   2. photo_versions: receta JSON inmutable por versión (modelo Lightroom:
--      las modificaciones son instrucciones, el original no se sobrescribe).
--      Lleva workspace_id desnormalizado para que RLS no dependa de joins.
--   3. photo_catalog_items: metadata tipo Lightroom Library (rating, flag,
--      color label, keywords) por asset dentro del workspace.
--
-- Si esta migración NO corrió, el API responde con un error claro (503/500
-- pidiéndola); el Modo Foto sigue funcionando en memoria sin persistencia.

-- ── 1. photo_documents ──────────────────────────────────────────────────────
create table if not exists photo_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source_url text not null,
  source_asset_id text,
  mode text not null default 'develop' check (mode in ('develop', 'composition')),
  active_version_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, source_url)
);

-- ── 2. photo_versions ───────────────────────────────────────────────────────
create table if not exists photo_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references photo_documents(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  parent_version_id uuid,
  label text not null default '',
  recipe_json jsonb not null default '{}'::jsonb,
  schema_version integer not null default 1,
  created_by uuid,
  created_at timestamptz not null default now()
);

-- ── 3. photo_catalog_items ──────────────────────────────────────────────────
create table if not exists photo_catalog_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  asset_id text not null,
  source_url text,
  rating integer not null default 0 check (rating between 0 and 5),
  flag text not null default 'unflagged' check (flag in ('pick', 'reject', 'unflagged')),
  color_label text,
  keywords jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, asset_id)
);

-- ── Índices ─────────────────────────────────────────────────────────────────
create index if not exists photo_documents_workspace_idx
  on photo_documents (workspace_id, updated_at desc);
create index if not exists photo_versions_document_idx
  on photo_versions (document_id, created_at desc);
create index if not exists photo_catalog_items_workspace_idx
  on photo_catalog_items (workspace_id, asset_id);

-- ── RLS: aislamiento multi-tenant por workspace ─────────────────────────────
alter table photo_documents enable row level security;
alter table photo_versions enable row level security;
alter table photo_catalog_items enable row level security;

drop policy if exists "photo_documents_workspace_read" on photo_documents;
create policy "photo_documents_workspace_read" on photo_documents for select
  using (has_workspace_role(workspace_id, 'viewer'));

drop policy if exists "photo_documents_workspace_write" on photo_documents;
create policy "photo_documents_workspace_write" on photo_documents for all
  using (has_workspace_role(workspace_id, 'editor'))
  with check (has_workspace_role(workspace_id, 'editor'));

drop policy if exists "photo_versions_workspace_read" on photo_versions;
create policy "photo_versions_workspace_read" on photo_versions for select
  using (has_workspace_role(workspace_id, 'viewer'));

drop policy if exists "photo_versions_workspace_write" on photo_versions;
create policy "photo_versions_workspace_write" on photo_versions for all
  using (has_workspace_role(workspace_id, 'editor'))
  with check (has_workspace_role(workspace_id, 'editor'));

drop policy if exists "photo_catalog_items_workspace_read" on photo_catalog_items;
create policy "photo_catalog_items_workspace_read" on photo_catalog_items for select
  using (has_workspace_role(workspace_id, 'viewer'));

drop policy if exists "photo_catalog_items_workspace_write" on photo_catalog_items;
create policy "photo_catalog_items_workspace_write" on photo_catalog_items for all
  using (has_workspace_role(workspace_id, 'editor'))
  with check (has_workspace_role(workspace_id, 'editor'));
