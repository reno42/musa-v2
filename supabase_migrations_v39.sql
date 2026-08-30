-- v39 — Landing waitlist ("Únete a la lista de espera").
--
-- The landing exposes a public form (name, email, company). Anyone —
-- including unauthenticated visitors — must be able to INSERT, but never
-- read, update or delete: RLS is enabled with an insert-only policy for
-- anon/authenticated, so the list can't be scraped from the browser.
-- The unique email doubles as dedupe: the form surfaces the 23505
-- unique-violation as a friendly "ya estabas en la lista".
--
-- Idempotent: IF NOT EXISTS / DROP POLICY IF EXISTS — safe to re-run.
-- Apply BEFORE (or together with) the landing deploy that renders the form;
-- until this runs, the form renders but every submit fails gracefully.

create table if not exists waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  company text,
  created_at timestamptz not null default now()
);

alter table waitlist_entries enable row level security;

-- Insert-only: no SELECT/UPDATE/DELETE policies on purpose.
drop policy if exists "waitlist_anon_insert" on waitlist_entries;
create policy "waitlist_anon_insert"
  on waitlist_entries
  for insert
  to anon, authenticated
  with check (true);

create index if not exists waitlist_entries_created_at_idx
  on waitlist_entries (created_at desc);
