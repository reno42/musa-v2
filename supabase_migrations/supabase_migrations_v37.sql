-- ═══════════════════════════════════════════════════════════════════
-- v37 — Custom fonts: per-user uploads (picker + MCP)
--
-- Bucket custom-fonts: public READ, private WRITE. The persisted design
-- css carries the font's @font-face with a stable URL — signed URLs
-- expire and header-auth cannot reach subresources inside the editor's
-- iframes, so the bucket is public-read and privacy comes from the
-- unguessable {user_id}/{uuid}.{ext} paths. Every WRITE goes through the
-- API/MCP with the service key, always under the owner's folder.
--
-- Table custom_fonts: the LIST is user-private via RLS.
--
-- Idempotent: converges to the final state (an earlier manual run may
-- have created the bucket private with fewer policies — this flips and
-- completes it). Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'custom-fonts', 'custom-fonts', true, 2097152,
  array[
    'font/ttf', 'font/otf', 'font/woff', 'font/woff2',
    'application/x-font-ttf', 'application/x-font-opentype',
    'application/font-woff', 'application/font-woff2', 'application/octet-stream'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create table if not exists custom_fonts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  family_name text not null,
  file_name text not null,
  storage_path text not null,
  format text not null,
  size_bytes bigint not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, family_name, format)
);
create index if not exists custom_fonts_user_idx on custom_fonts (user_id);
alter table custom_fonts enable row level security;

drop policy if exists "custom_fonts_owner_all" on custom_fonts;
create policy "custom_fonts_owner_all" on custom_fonts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Defense in depth for Storage: objects may only be touched inside the
-- owner's own first-level folder. (auth.uid() is uuid; the folder name is
-- text — the cast is mandatory, a bare comparison always fails.)
drop policy if exists "custom_fonts_read_own" on storage.objects;
create policy "custom_fonts_read_own" on storage.objects
  for select using (
    bucket_id = 'custom-fonts'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "custom_fonts_write_own" on storage.objects;
create policy "custom_fonts_write_own" on storage.objects
  for insert with check (
    bucket_id = 'custom-fonts'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "custom_fonts_delete_own" on storage.objects;
create policy "custom_fonts_delete_own" on storage.objects
  for delete using (
    bucket_id = 'custom-fonts'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
