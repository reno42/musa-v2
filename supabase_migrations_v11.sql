-- Futuraria Design — Migration v11: complete account lifecycle and workspace invitations
-- Apply after v10. Idempotent and safe to re-run.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Invitation lifecycle. Tokens are only stored as SHA-256 hashes; the raw
-- token exists only in the email/link returned at creation time.
ALTER TABLE workspace_invitations ADD COLUMN IF NOT EXISTS accepted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE workspace_invitations ADD COLUMN IF NOT EXISTS declined_at TIMESTAMPTZ;
ALTER TABLE workspace_invitations ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE workspace_invitations ADD COLUMN IF NOT EXISTS revoked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE workspace_invitations ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ;
ALTER TABLE workspace_invitations ADD COLUMN IF NOT EXISTS delivery_method TEXT NOT NULL DEFAULT 'link';
ALTER TABLE workspace_invitations ADD COLUMN IF NOT EXISTS requires_account_setup BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_invitations_delivery_method_check'
  ) THEN
    ALTER TABLE workspace_invitations
      ADD CONSTRAINT workspace_invitations_delivery_method_check
      CHECK (delivery_method IN ('link', 'supabase_invite', 'supabase_magic_link'));
  END IF;
END $$;

DROP INDEX IF EXISTS idx_workspace_invites_pending;
CREATE UNIQUE INDEX idx_workspace_invites_pending
  ON workspace_invitations(workspace_id, lower(email))
  WHERE accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_workspace_invites_recipient
  ON workspace_invitations(lower(email), created_at DESC)
  WHERE accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_workspace_invites_expiry
  ON workspace_invitations(expires_at)
  WHERE accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_email_lower
  ON user_profiles(lower(email)) WHERE email IS NOT NULL;

-- Every Auth user receives a profile and, unless they already own one, a
-- deterministic personal workspace. This also backfills existing accounts.
CREATE OR REPLACE FUNCTION handle_new_futuraria_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  personal_workspace_id TEXT := 'ws_user_' || substr(replace(NEW.id::text, '-', ''), 1, 20);
  personal_workspace_name TEXT;
  personal_workspace_slug TEXT := 'workspace-' || substr(replace(NEW.id::text, '-', ''), 1, 20);
  display_name_value TEXT;
BEGIN
  display_name_value := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''),
    NULLIF(trim(NEW.raw_user_meta_data->>'name'), ''),
    split_part(NEW.email, '@', 1),
    'Mi cuenta'
  );
  personal_workspace_name := 'Workspace de ' || display_name_value;

  INSERT INTO user_profiles (id, email, display_name, avatar_url)
  VALUES (NEW.id, lower(NEW.email), display_name_value, NEW.raw_user_meta_data->>'avatar_url')
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    display_name = COALESCE(NULLIF(user_profiles.display_name, ''), EXCLUDED.display_name),
    avatar_url = COALESCE(EXCLUDED.avatar_url, user_profiles.avatar_url),
    updated_at = NOW();

  IF NEW.email_confirmed_at IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM workspaces WHERE owner_id = NEW.id::text
  ) THEN
    INSERT INTO workspaces (id, name, slug, owner_id, member_ids, data, created_at, updated_at)
    VALUES (
      personal_workspace_id,
      personal_workspace_name,
      personal_workspace_slug,
      NEW.id::text,
      ARRAY[NEW.id::text],
      jsonb_build_object(
        'id', personal_workspace_id,
        'name', personal_workspace_name,
        'slug', personal_workspace_slug,
        'ownerId', NEW.id::text,
        'memberIds', jsonb_build_array(NEW.id::text),
        'createdAt', NOW(),
        'updatedAt', NOW()
      ),
      NOW(),
      NOW()
    ) ON CONFLICT (id) DO NOTHING;
  END IF;

  IF NEW.email_confirmed_at IS NOT NULL THEN
    INSERT INTO workspace_members (workspace_id, user_id, role)
    SELECT id, NEW.id, 'owner'
    FROM workspaces
    WHERE owner_id = NEW.id::text
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'owner';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_futuraria_user_created ON auth.users;
CREATE TRIGGER on_futuraria_user_created
  AFTER INSERT OR UPDATE OF email, email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_futuraria_user();

INSERT INTO user_profiles (id, email, display_name, avatar_url)
SELECT
  u.id,
  lower(u.email),
  COALESCE(NULLIF(trim(u.raw_user_meta_data->>'full_name'), ''), NULLIF(trim(u.raw_user_meta_data->>'name'), ''), split_part(u.email, '@', 1), 'Mi cuenta'),
  u.raw_user_meta_data->>'avatar_url'
FROM auth.users u
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, updated_at = NOW();

INSERT INTO workspaces (id, name, slug, owner_id, member_ids, data, created_at, updated_at)
SELECT
  'ws_user_' || substr(replace(u.id::text, '-', ''), 1, 20),
  'Workspace de ' || COALESCE(NULLIF(trim(u.raw_user_meta_data->>'full_name'), ''), NULLIF(trim(u.raw_user_meta_data->>'name'), ''), split_part(u.email, '@', 1), 'Mi cuenta'),
  'workspace-' || substr(replace(u.id::text, '-', ''), 1, 20),
  u.id::text,
  ARRAY[u.id::text],
  jsonb_build_object(
    'id', 'ws_user_' || substr(replace(u.id::text, '-', ''), 1, 20),
    'name', 'Workspace de ' || COALESCE(NULLIF(trim(u.raw_user_meta_data->>'full_name'), ''), NULLIF(trim(u.raw_user_meta_data->>'name'), ''), split_part(u.email, '@', 1), 'Mi cuenta'),
    'slug', 'workspace-' || substr(replace(u.id::text, '-', ''), 1, 20),
    'ownerId', u.id::text,
    'memberIds', jsonb_build_array(u.id::text),
    'createdAt', NOW(),
    'updatedAt', NOW()
  ),
  NOW(),
  NOW()
FROM auth.users u
WHERE u.email_confirmed_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.owner_id = u.id::text)
ON CONFLICT (id) DO NOTHING;

INSERT INTO workspace_members (workspace_id, user_id, role)
SELECT w.id, w.owner_id::uuid, 'owner'
FROM workspaces w
WHERE w.owner_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'owner';

-- Acceptance and decline are atomic, bound to auth.uid() and the verified
-- email in auth.users. They can be called either from a secret link or from
-- the signed-in account's pending-invitations list.
CREATE OR REPLACE FUNCTION accept_workspace_invitation(
  invitation_token_hash TEXT DEFAULT NULL,
  target_invitation_id UUID DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target_invitation workspace_invitations%ROWTYPE;
  current_email TEXT;
  current_email_confirmed_at TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT lower(u.email), u.email_confirmed_at
  INTO current_email, current_email_confirmed_at
  FROM auth.users u
  WHERE u.id = auth.uid();

  IF current_email IS NULL OR current_email_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'A verified email is required' USING ERRCODE = '42501';
  END IF;

  SELECT wi.* INTO target_invitation
  FROM workspace_invitations wi
  WHERE (
      (invitation_token_hash IS NOT NULL AND wi.token_hash = invitation_token_hash)
      OR (target_invitation_id IS NOT NULL AND wi.id = target_invitation_id)
    )
    AND wi.accepted_at IS NULL
    AND wi.declined_at IS NULL
    AND wi.revoked_at IS NULL
  FOR UPDATE;

  IF NOT FOUND OR target_invitation.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation not found or expired' USING ERRCODE = 'P0002';
  END IF;

  IF lower(target_invitation.email) <> current_email THEN
    RAISE EXCEPTION 'This invitation belongs to another email address' USING ERRCODE = '42501';
  END IF;

  INSERT INTO workspace_members (workspace_id, user_id, role, invited_by)
  VALUES (target_invitation.workspace_id, auth.uid(), target_invitation.role, target_invitation.invited_by)
  ON CONFLICT (workspace_id, user_id) DO UPDATE SET
    role = CASE
      WHEN workspace_role_rank(workspace_members.role) >= workspace_role_rank(EXCLUDED.role)
        THEN workspace_members.role
      ELSE EXCLUDED.role
    END,
    invited_by = COALESCE(workspace_members.invited_by, EXCLUDED.invited_by);

  UPDATE workspace_invitations
  SET accepted_at = NOW(), accepted_by = auth.uid()
  WHERE id = target_invitation.id;

  RETURN target_invitation.workspace_id;
END;
$$;

CREATE OR REPLACE FUNCTION decline_workspace_invitation(
  invitation_token_hash TEXT DEFAULT NULL,
  target_invitation_id UUID DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target_invitation workspace_invitations%ROWTYPE;
  current_email TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT lower(u.email) INTO current_email
  FROM auth.users u
  WHERE u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL;

  SELECT wi.* INTO target_invitation
  FROM workspace_invitations wi
  WHERE (
      (invitation_token_hash IS NOT NULL AND wi.token_hash = invitation_token_hash)
      OR (target_invitation_id IS NOT NULL AND wi.id = target_invitation_id)
    )
    AND wi.accepted_at IS NULL
    AND wi.declined_at IS NULL
    AND wi.revoked_at IS NULL
  FOR UPDATE;

  IF current_email IS NULL OR NOT FOUND OR target_invitation.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation not found or expired' USING ERRCODE = 'P0002';
  END IF;

  IF lower(target_invitation.email) <> current_email THEN
    RAISE EXCEPTION 'This invitation belongs to another email address' USING ERRCODE = '42501';
  END IF;

  UPDATE workspace_invitations SET declined_at = NOW() WHERE id = target_invitation.id;
  RETURN target_invitation.workspace_id;
END;
$$;

ALTER TABLE workspace_invitations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "workspace_invites_admin" ON workspace_invitations;
CREATE POLICY "workspace_invites_admin" ON workspace_invitations FOR ALL
  USING (has_workspace_role(workspace_id, 'admin'))
  WITH CHECK (has_workspace_role(workspace_id, 'admin'));

REVOKE EXECUTE ON FUNCTION accept_workspace_invitation(TEXT, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION decline_workspace_invitation(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION accept_workspace_invitation(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION decline_workspace_invitation(TEXT, UUID) TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_invitations TO authenticated;
