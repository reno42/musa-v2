-- supabase_migrations_v49.sql — Public landing waitlist
-- The landing page only needs anonymous INSERT access. Keep reads and updates
-- private so submitted contact data is never exposed through the browser key.

CREATE TABLE IF NOT EXISTS public.waitlist_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  email TEXT NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
  company TEXT CHECK (company IS NULL OR char_length(company) <= 160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS waitlist_entries_email_lower_idx
  ON public.waitlist_entries (lower(email));

ALTER TABLE public.waitlist_entries ENABLE ROW LEVEL SECURITY;

GRANT INSERT ON TABLE public.waitlist_entries TO anon;

DROP POLICY IF EXISTS "waitlist public insert" ON public.waitlist_entries;
CREATE POLICY "waitlist public insert"
  ON public.waitlist_entries
  FOR INSERT
  TO anon
  WITH CHECK (true);
