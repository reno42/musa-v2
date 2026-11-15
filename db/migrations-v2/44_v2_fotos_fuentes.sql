-- Crear › Fotos: cada foto dice de dónde viene (Musa, Google Drive, Dropbox o un enlace) y las cuentas conectadas.
-- La foto NO se copia a Supabase: de Drive se guarda la referencia y Musa la muestra con un proxy (/api/photo-sources/f/…);
-- de Dropbox y de un enlace, la URL directa. Así no se gasta el almacenamiento del plan gratis.
-- Una foto editada en Musa se guarda en el mismo lugar que el original (Drive → carpeta «Musa» de esa cuenta) y queda
-- unida al original con la receta del revelado (source_meta.from / source_meta.recipe): el original nunca se toca.
-- Idempotente.

alter table public.assets add column if not exists source text not null default 'musa';
alter table public.assets add column if not exists source_ref text;        -- id del archivo en Drive / ruta en Dropbox
alter table public.assets add column if not exists source_account text;    -- photo_sources.id (la cuenta conectada)
alter table public.assets add column if not exists source_meta jsonb not null default '{}'::jsonb;  -- carpeta, enlace para abrir, de qué foto salió, receta
do $$ begin
  alter table public.assets add constraint assets_source_chk check (source in ('musa', 'drive', 'dropbox', 'onedrive', 'link'));
exception when duplicate_object then null; end $$;
create index if not exists idx_assets_ws_source on public.assets (workspace_id, source) where deleted_at is null;
create index if not exists idx_assets_source_ref on public.assets (workspace_id, source_account, source_ref) where deleted_at is null and source_ref is not null;

-- Cuentas conectadas (Google Drive). El token de actualización va cifrado (AES-256-GCM con WORKSPACE_SECRET_ENCRYPTION_KEY)
-- y solo lo lee el servidor: el navegador recibe tokens de acceso de corta vida para el selector de Google.
create table if not exists public.photo_sources (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider in ('google_drive', 'dropbox')),
  account_email text,
  account_name text,
  encrypted text,
  meta jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_photo_sources_ws on public.photo_sources (workspace_id);
alter table public.photo_sources enable row level security;
revoke all on public.photo_sources from anon, authenticated;
