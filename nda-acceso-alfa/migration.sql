-- =============================================================
-- Tabla de aceptaciones del Acuerdo Alfa (NDA)
-- ⚠️  IMPORTANTE: esta tabla vive en el Supabase del CRM:
--     https://unhiumdpcywchtsykakj.supabase.co  (proyecto "CRM Futuraria")
--     NO en el Supabase del editor (qqqcmtwzyaejlzffivri).
-- Ejecutar en: Supabase Dashboard → proyecto unhiumdpcywchtsykakj
--              → SQL Editor → pegar y Run.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.nda_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT,
  plan TEXT NOT NULL DEFAULT 'friends_family',
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address TEXT,
  user_agent TEXT,
  version TEXT NOT NULL DEFAULT '1.0',
  metadata JSONB DEFAULT '{}'::jsonb
);

ALTER TABLE public.nda_acceptances ENABLE ROW LEVEL SECURITY;

-- La app (rol anon) puede INSERTAR, pero NO leer (privacidad).
CREATE POLICY "anon_can_insert" ON public.nda_acceptances
  FOR INSERT TO anon WITH CHECK (true);

CREATE INDEX IF NOT EXISTS nda_acceptances_email_idx ON public.nda_acceptances (email);
CREATE INDEX IF NOT EXISTS nda_acceptances_plan_idx ON public.nda_acceptances (plan);
