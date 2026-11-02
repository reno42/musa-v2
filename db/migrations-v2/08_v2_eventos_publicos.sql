-- Eventos publicables (página pública tipo Luma con inscripción) — Musa v2.
begin;
alter table public.workspace_events
  add column if not exists slug text,
  add column if not exists published boolean not null default false,
  add column if not exists published_at timestamptz,
  add column if not exists cover_url text,
  add column if not exists timezone text not null default 'America/Lima';
create unique index if not exists workspace_events_slug_key on public.workspace_events (slug) where slug is not null;
alter table public.workspace_events drop constraint if exists workspace_events_slug_check;
alter table public.workspace_events add constraint workspace_events_slug_check check (slug is null or slug ~ '^[a-z0-9][a-z0-9-]{2,79}$');

alter table public.workspace_event_regs add column if not exists phone text, add column if not exists source text not null default 'musa';
-- una inscripción por correo y evento (la página pública no duplica)
create unique index if not exists workspace_event_regs_event_email_key on public.workspace_event_regs (event_id, lower(email)) where email is not null;
create index if not exists idx_event_regs_event on public.workspace_event_regs (event_id);
commit;
