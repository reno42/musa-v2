-- Futuraria Design — Migration v9: SaaS tenancy, BYOK MCP and CRM
-- Apply after v8. Idempotent and safe to re-run.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS workspace_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('admin', 'editor', 'viewer')),
  token_hash TEXT NOT NULL UNIQUE,
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_invites_pending
  ON workspace_invitations(workspace_id, lower(email)) WHERE accepted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id);

CREATE TABLE IF NOT EXISTS workspace_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('editor', 'viewer')),
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_api_keys_workspace ON workspace_api_keys(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_api_keys_hash ON workspace_api_keys(key_hash) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS workspace_mcp_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'mcp' CHECK (kind IN ('mcp', 'model_api')),
  provider TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  public_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  credentials_encrypted TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_mcp_connections_workspace
  ON workspace_mcp_connections(workspace_id, enabled);

CREATE TABLE IF NOT EXISTS crm_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  brand_id TEXT REFERENCES brands(id) ON DELETE SET NULL,
  brand_name TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  job_title TEXT,
  company TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('lead', 'active', 'inactive')),
  tags TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS crm_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('note', 'email', 'call', 'meeting')),
  body TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_contacts_workspace ON crm_contacts(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_email ON crm_contacts(workspace_id, lower(email));
CREATE INDEX IF NOT EXISTS idx_crm_activities_contact ON crm_activities(contact_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION workspace_role_rank(input_role TEXT)
RETURNS INTEGER LANGUAGE SQL IMMUTABLE AS $$
  SELECT CASE input_role
    WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'editor' THEN 2 WHEN 'viewer' THEN 1 ELSE 0 END
$$;

CREATE OR REPLACE FUNCTION workspace_role_for(target_workspace TEXT, target_user UUID DEFAULT auth.uid())
RETURNS TEXT
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM workspaces w WHERE w.id = target_workspace AND w.owner_id = target_user::text)
      THEN 'owner'
    ELSE (SELECT wm.role FROM workspace_members wm
          WHERE wm.workspace_id = target_workspace AND wm.user_id = target_user LIMIT 1)
  END
$$;

CREATE OR REPLACE FUNCTION has_workspace_role(target_workspace TEXT, minimum_role TEXT DEFAULT 'viewer')
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT workspace_role_rank(workspace_role_for(target_workspace, auth.uid())) >= workspace_role_rank(minimum_role)
$$;

CREATE OR REPLACE FUNCTION handle_new_futuraria_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO user_profiles (id, email, display_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  ) ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_client_workspace_owner_change()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id
     AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'workspace ownership can only be transferred by the server';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_futuraria_user_created ON auth.users;
CREATE TRIGGER on_futuraria_user_created
  AFTER INSERT OR UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_futuraria_user();

DROP TRIGGER IF EXISTS protect_workspace_owner_change ON workspaces;
CREATE TRIGGER protect_workspace_owner_change
  BEFORE UPDATE OF owner_id ON workspaces
  FOR EACH ROW EXECUTE FUNCTION prevent_client_workspace_owner_change();

INSERT INTO user_profiles (id, email, display_name)
SELECT id, email, COALESCE(raw_user_meta_data->>'full_name', split_part(email, '@', 1))
FROM auth.users
ON CONFLICT (id) DO NOTHING;

INSERT INTO workspace_members (workspace_id, user_id, role)
SELECT id, owner_id::uuid, 'owner'
FROM workspaces
WHERE owner_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'owner';

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_mcp_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_file_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE section_locks ENABLE ROW LEVEL SECURITY;

-- These are legacy v5 tables. SaaS uses workspace_api_keys, so installations
-- which never enabled the old session/key persistence must still be able to
-- apply the tenant migration.
DO $$
BEGIN
  IF to_regclass('public.api_keys') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY';
  END IF;

  IF to_regclass('public.client_sessions') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.client_sessions ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

-- Replace any legacy permissive policies on tenant-owned tables. Keeping even
-- one old USING (true) policy would bypass the isolation policies below.
DO $$
DECLARE policy_row RECORD;
BEGIN
  FOR policy_row IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'user_profiles', 'workspace_members', 'workspace_invitations',
        'workspace_api_keys', 'workspace_mcp_connections', 'crm_contacts',
        'crm_activities', 'workspaces', 'templates', 'recipes', 'assets',
        'brands', 'design_file_meta', 'batch_jobs', 'section_locks',
        'api_keys', 'client_sessions'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', policy_row.policyname, policy_row.schemaname, policy_row.tablename);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "profiles_shared_workspace_read" ON user_profiles;
CREATE POLICY "profiles_shared_workspace_read" ON user_profiles FOR SELECT USING (
  id = auth.uid() OR EXISTS (
    SELECT 1 FROM workspace_members mine
    JOIN workspace_members theirs ON theirs.workspace_id = mine.workspace_id
    WHERE mine.user_id = auth.uid() AND theirs.user_id = user_profiles.id
  )
);
DROP POLICY IF EXISTS "profiles_self_update" ON user_profiles;
CREATE POLICY "profiles_self_update" ON user_profiles FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "workspace_member_read" ON workspaces;
CREATE POLICY "workspace_member_read" ON workspaces FOR SELECT USING (has_workspace_role(id, 'viewer'));
DROP POLICY IF EXISTS "workspace_owner_insert" ON workspaces;
CREATE POLICY "workspace_owner_insert" ON workspaces FOR INSERT WITH CHECK (owner_id = auth.uid()::text);
DROP POLICY IF EXISTS "workspace_admin_update" ON workspaces;
CREATE POLICY "workspace_admin_update" ON workspaces FOR UPDATE USING (has_workspace_role(id, 'admin')) WITH CHECK (has_workspace_role(id, 'admin'));
DROP POLICY IF EXISTS "workspace_owner_delete" ON workspaces;
CREATE POLICY "workspace_owner_delete" ON workspaces FOR DELETE USING (has_workspace_role(id, 'owner'));

DROP POLICY IF EXISTS "workspace_members_read" ON workspace_members;
CREATE POLICY "workspace_members_read" ON workspace_members FOR SELECT USING (has_workspace_role(workspace_id, 'viewer'));
DROP POLICY IF EXISTS "workspace_members_admin_insert" ON workspace_members;
CREATE POLICY "workspace_members_admin_insert" ON workspace_members FOR INSERT WITH CHECK (
  has_workspace_role(workspace_id, 'admin')
  AND (role <> 'owner' OR (user_id = auth.uid() AND has_workspace_role(workspace_id, 'owner')))
);
DROP POLICY IF EXISTS "workspace_members_admin_update" ON workspace_members;
CREATE POLICY "workspace_members_admin_update" ON workspace_members FOR UPDATE
  USING (has_workspace_role(workspace_id, 'admin'))
  WITH CHECK (
    has_workspace_role(workspace_id, 'admin')
    AND (role <> 'owner' OR (user_id = auth.uid() AND has_workspace_role(workspace_id, 'owner')))
  );
DROP POLICY IF EXISTS "workspace_members_admin_delete" ON workspace_members;
CREATE POLICY "workspace_members_admin_delete" ON workspace_members FOR DELETE USING (has_workspace_role(workspace_id, 'admin') AND role <> 'owner');

DROP POLICY IF EXISTS "workspace_invites_admin" ON workspace_invitations;
CREATE POLICY "workspace_invites_admin" ON workspace_invitations FOR ALL USING (has_workspace_role(workspace_id, 'admin')) WITH CHECK (has_workspace_role(workspace_id, 'admin'));
DROP POLICY IF EXISTS "workspace_keys_admin" ON workspace_api_keys;
CREATE POLICY "workspace_keys_admin" ON workspace_api_keys FOR ALL USING (has_workspace_role(workspace_id, 'admin')) WITH CHECK (has_workspace_role(workspace_id, 'admin'));
DROP POLICY IF EXISTS "workspace_connections_read" ON workspace_mcp_connections;
CREATE POLICY "workspace_connections_read" ON workspace_mcp_connections FOR SELECT USING (has_workspace_role(workspace_id, 'viewer'));
DROP POLICY IF EXISTS "workspace_connections_admin" ON workspace_mcp_connections;
CREATE POLICY "workspace_connections_admin" ON workspace_mcp_connections FOR ALL USING (has_workspace_role(workspace_id, 'admin')) WITH CHECK (has_workspace_role(workspace_id, 'admin'));

DROP POLICY IF EXISTS "templates_workspace_read" ON templates;
CREATE POLICY "templates_workspace_read" ON templates FOR SELECT USING (has_workspace_role(workspace_id, 'viewer'));
DROP POLICY IF EXISTS "templates_workspace_write" ON templates;
CREATE POLICY "templates_workspace_write" ON templates FOR ALL USING (has_workspace_role(workspace_id, 'editor')) WITH CHECK (has_workspace_role(workspace_id, 'editor'));

DROP POLICY IF EXISTS "recipes_workspace_read" ON recipes;
CREATE POLICY "recipes_workspace_read" ON recipes FOR SELECT USING (has_workspace_role(workspace_id, 'viewer'));
DROP POLICY IF EXISTS "recipes_workspace_write" ON recipes;
CREATE POLICY "recipes_workspace_write" ON recipes FOR ALL USING (has_workspace_role(workspace_id, 'editor')) WITH CHECK (has_workspace_role(workspace_id, 'editor'));
DROP POLICY IF EXISTS "assets_workspace_read" ON assets;
CREATE POLICY "assets_workspace_read" ON assets FOR SELECT USING (has_workspace_role(workspace_id, 'viewer'));
DROP POLICY IF EXISTS "assets_workspace_write" ON assets;
CREATE POLICY "assets_workspace_write" ON assets FOR ALL USING (has_workspace_role(workspace_id, 'editor')) WITH CHECK (has_workspace_role(workspace_id, 'editor'));
DROP POLICY IF EXISTS "brands_workspace_read" ON brands;
CREATE POLICY "brands_workspace_read" ON brands FOR SELECT USING (has_workspace_role(workspace_id, 'viewer'));
DROP POLICY IF EXISTS "brands_workspace_write" ON brands;
CREATE POLICY "brands_workspace_write" ON brands FOR ALL USING (has_workspace_role(workspace_id, 'editor')) WITH CHECK (has_workspace_role(workspace_id, 'editor'));
DROP POLICY IF EXISTS "design_meta_workspace_read" ON design_file_meta;
CREATE POLICY "design_meta_workspace_read" ON design_file_meta FOR SELECT USING (has_workspace_role(workspace_id, 'viewer'));
DROP POLICY IF EXISTS "design_meta_workspace_write" ON design_file_meta;
CREATE POLICY "design_meta_workspace_write" ON design_file_meta FOR ALL USING (has_workspace_role(workspace_id, 'editor')) WITH CHECK (has_workspace_role(workspace_id, 'editor'));
DROP POLICY IF EXISTS "batch_jobs_workspace_read" ON batch_jobs;
CREATE POLICY "batch_jobs_workspace_read" ON batch_jobs FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM templates
    WHERE templates.id = batch_jobs.template_id
      AND has_workspace_role(templates.workspace_id, 'viewer')
  )
);
DROP POLICY IF EXISTS "batch_jobs_workspace_write" ON batch_jobs;
CREATE POLICY "batch_jobs_workspace_write" ON batch_jobs FOR ALL USING (
  EXISTS (
    SELECT 1 FROM templates
    WHERE templates.id = batch_jobs.template_id
      AND has_workspace_role(templates.workspace_id, 'editor')
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM templates
    WHERE templates.id = batch_jobs.template_id
      AND has_workspace_role(templates.workspace_id, 'editor')
  )
);
DROP POLICY IF EXISTS "section_locks_workspace_read" ON section_locks;
CREATE POLICY "section_locks_workspace_read" ON section_locks FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM templates
    WHERE templates.id = section_locks.template_id
      AND has_workspace_role(templates.workspace_id, 'viewer')
  )
);
DROP POLICY IF EXISTS "section_locks_workspace_write" ON section_locks;
CREATE POLICY "section_locks_workspace_write" ON section_locks FOR ALL USING (
  EXISTS (
    SELECT 1 FROM templates
    WHERE templates.id = section_locks.template_id
      AND has_workspace_role(templates.workspace_id, 'editor')
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM templates
    WHERE templates.id = section_locks.template_id
      AND has_workspace_role(templates.workspace_id, 'editor')
  )
);
DROP POLICY IF EXISTS "crm_contacts_workspace_read" ON crm_contacts;
CREATE POLICY "crm_contacts_workspace_read" ON crm_contacts FOR SELECT USING (has_workspace_role(workspace_id, 'viewer'));
DROP POLICY IF EXISTS "crm_contacts_workspace_write" ON crm_contacts;
CREATE POLICY "crm_contacts_workspace_write" ON crm_contacts FOR ALL USING (has_workspace_role(workspace_id, 'editor')) WITH CHECK (has_workspace_role(workspace_id, 'editor'));
DROP POLICY IF EXISTS "crm_activities_workspace_read" ON crm_activities;
CREATE POLICY "crm_activities_workspace_read" ON crm_activities FOR SELECT USING (has_workspace_role(workspace_id, 'viewer'));
DROP POLICY IF EXISTS "crm_activities_workspace_write" ON crm_activities;
CREATE POLICY "crm_activities_workspace_write" ON crm_activities FOR ALL USING (has_workspace_role(workspace_id, 'editor')) WITH CHECK (has_workspace_role(workspace_id, 'editor'));

REVOKE ALL ON FUNCTION workspace_role_for(TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION handle_new_futuraria_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION prevent_client_workspace_owner_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION has_workspace_role(TEXT, TEXT) TO authenticated;

-- Credentials are only decrypted by the server. Authenticated browser clients
-- may read connection metadata but can never select the encrypted payload.
REVOKE SELECT ON workspace_mcp_connections FROM anon, authenticated;
GRANT SELECT (id, workspace_id, name, kind, provider, endpoint_url, enabled, public_config, created_by, created_at, updated_at)
  ON workspace_mcp_connections TO authenticated;

-- Private workspace storage. The first path segment is always the workspace id.
UPDATE storage.buckets SET public = FALSE
WHERE id IN ('design-assets', 'design-covers', 'design-exports');

DROP POLICY IF EXISTS "Public read design-assets" ON storage.objects;
DROP POLICY IF EXISTS "Insert to design-assets" ON storage.objects;
DROP POLICY IF EXISTS "Delete from design-assets" ON storage.objects;
DROP POLICY IF EXISTS "Public read design-covers" ON storage.objects;
DROP POLICY IF EXISTS "Insert to design-covers" ON storage.objects;
DROP POLICY IF EXISTS "Delete from design-covers" ON storage.objects;
DROP POLICY IF EXISTS "workspace_storage_read" ON storage.objects;
CREATE POLICY "workspace_storage_read" ON storage.objects AS RESTRICTIVE FOR SELECT USING (
  bucket_id IN ('design-assets', 'design-covers', 'design-exports')
  AND has_workspace_role((storage.foldername(name))[1], 'viewer')
);
DROP POLICY IF EXISTS "workspace_storage_read_grant" ON storage.objects;
CREATE POLICY "workspace_storage_read_grant" ON storage.objects FOR SELECT USING (
  bucket_id IN ('design-assets', 'design-covers', 'design-exports')
  AND has_workspace_role((storage.foldername(name))[1], 'viewer')
);
DROP POLICY IF EXISTS "workspace_storage_insert" ON storage.objects;
CREATE POLICY "workspace_storage_insert" ON storage.objects AS RESTRICTIVE FOR INSERT WITH CHECK (
  bucket_id IN ('design-assets', 'design-covers', 'design-exports')
  AND has_workspace_role((storage.foldername(name))[1], 'editor')
);
DROP POLICY IF EXISTS "workspace_storage_insert_grant" ON storage.objects;
CREATE POLICY "workspace_storage_insert_grant" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id IN ('design-assets', 'design-covers', 'design-exports')
  AND has_workspace_role((storage.foldername(name))[1], 'editor')
);
DROP POLICY IF EXISTS "workspace_storage_update" ON storage.objects;
CREATE POLICY "workspace_storage_update" ON storage.objects AS RESTRICTIVE FOR UPDATE USING (
  bucket_id IN ('design-assets', 'design-covers', 'design-exports')
  AND has_workspace_role((storage.foldername(name))[1], 'editor')
) WITH CHECK (has_workspace_role((storage.foldername(name))[1], 'editor'));
DROP POLICY IF EXISTS "workspace_storage_update_grant" ON storage.objects;
CREATE POLICY "workspace_storage_update_grant" ON storage.objects FOR UPDATE USING (
  bucket_id IN ('design-assets', 'design-covers', 'design-exports')
  AND has_workspace_role((storage.foldername(name))[1], 'editor')
) WITH CHECK (has_workspace_role((storage.foldername(name))[1], 'editor'));
DROP POLICY IF EXISTS "workspace_storage_delete" ON storage.objects;
CREATE POLICY "workspace_storage_delete" ON storage.objects AS RESTRICTIVE FOR DELETE USING (
  bucket_id IN ('design-assets', 'design-covers', 'design-exports')
  AND has_workspace_role((storage.foldername(name))[1], 'editor')
);
DROP POLICY IF EXISTS "workspace_storage_delete_grant" ON storage.objects;
CREATE POLICY "workspace_storage_delete_grant" ON storage.objects FOR DELETE USING (
  bucket_id IN ('design-assets', 'design-covers', 'design-exports')
  AND has_workspace_role((storage.foldername(name))[1], 'editor')
);
