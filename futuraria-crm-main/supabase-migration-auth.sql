-- ============================================
-- FUTURARIA CRM - Auth & API Keys Setup
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. Enable auth (Supabase Auth is enabled by default)
-- We'll use email/password auth, no registration page

-- 2. Create admin profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'viewer')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Create API keys table
CREATE TABLE IF NOT EXISTS public.api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,          -- first 8 chars for display (ftr_xxxx...)
  key_hash TEXT NOT NULL UNIQUE,     -- SHA-256 hash of the full key
  permissions TEXT[] NOT NULL DEFAULT ARRAY['read'],
  created_by UUID REFERENCES auth.users(id),
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON public.api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_is_active ON public.api_keys(is_active);

-- 5. RLS policies
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

-- Profiles: admins can read all, users can read own
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "profiles_select_admin" ON public.profiles
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- API Keys: only authenticated admins can manage
CREATE POLICY "api_keys_select" ON public.api_keys
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "api_keys_insert" ON public.api_keys
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "api_keys_update" ON public.api_keys
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "api_keys_delete" ON public.api_keys
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- 6. Auto-create profile on signup (trigger)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), 'admin');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 7. Create your admin user (REPLACE WITH YOUR EMAIL/PASSWORD)
-- Run this separately after the table is created:
-- Go to Supabase Dashboard → Authentication → Users → Invite user
-- Or use this SQL to create directly:
--
-- INSERT INTO auth.users (
--   instance_id, id, aud, role, email, encrypted_password,
--   email_confirmed_at, raw_user_meta_data, created_at, updated_at
-- ) VALUES (
--   '00000000-0000-0000-0000-000000000000',
--   gen_random_uuid(),
--   'authenticated',
--   'authenticated',
--   'renzo@futuraria.com',
--   crypt('TuPasswordSeguro123!', gen_salt('bf')),
--   now(),
--   '{"full_name": "Renzo Perez Bartra"}',
--   now(),
--   now()
-- );

-- 8. Migrate existing CRM API key into api_keys table
-- (Run this after you have at least one user)
-- INSERT INTO public.api_keys (name, key_prefix, key_hash, permissions, created_by)
-- VALUES (
--   'n8n Integration',
--   'ftr_xxxx',
--   encode(sha256('YOUR_EXISTING_N8N_KEY_HERE'::bytea), 'hex'),
--   ARRAY['read', 'write'],
--   (SELECT id FROM public.profiles LIMIT 1)
-- );
