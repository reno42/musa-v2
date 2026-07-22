import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { encryptWorkspaceSecret, decryptWorkspaceSecret } from "../api/src/services/secrets.ts";
import { hasMinimumWorkspaceRole, workspaceKeyAllows } from "../api/src/services/workspaceRoles.ts";
import { isLegacyWorkspaceOwner } from "../api/src/services/legacyOwnership.ts";
import { parseSupabaseKey } from "../api/src/services/supabase.ts";

test("workspace roles isolate viewers, editors and workspace API keys", () => {
  assert.equal(hasMinimumWorkspaceRole("owner", "admin"), true);
  assert.equal(hasMinimumWorkspaceRole("editor", "editor"), true);
  assert.equal(hasMinimumWorkspaceRole("viewer", "editor"), false);
  assert.equal(workspaceKeyAllows("workspace-a", "editor", "workspace-a", "editor"), true);
  assert.equal(workspaceKeyAllows("workspace-a", "editor", "workspace-b", "viewer"), false);
});

test("only non-UUID pre-SaaS owner identifiers are considered legacy", () => {
  assert.equal(isLegacyWorkspaceOwner("dev_user_default"), true);
  assert.equal(isLegacyWorkspaceOwner(null), true);
  assert.equal(isLegacyWorkspaceOwner("2bd6af57-94e3-4b24-8ae8-b616ee257bfa"), false);
});

test("modern Supabase key sets resolve their default publishable or secret key", () => {
  assert.equal(parseSupabaseKey("sb_publishable_direct"), "sb_publishable_direct");
  assert.equal(parseSupabaseKey('{"default":"sb_publishable_default","rotated":"sb_publishable_other"}'), "sb_publishable_default");
  assert.equal(parseSupabaseKey('{"primary":"sb_secret_primary"}'), "sb_secret_primary");
  assert.equal(parseSupabaseKey("{invalid"), undefined);
});

test("BYOK credentials use authenticated encryption and reject tampering", () => {
  const previous = process.env.WORKSPACE_SECRET_ENCRYPTION_KEY;
  process.env.WORKSPACE_SECRET_ENCRYPTION_KEY = "test-only-workspace-secret-with-32-characters";
  try {
    const encrypted = encryptWorkspaceSecret({ headers: { Authorization: "Bearer secret" } });
    assert.equal(encrypted.includes("Bearer secret"), false);
    assert.deepEqual(decryptWorkspaceSecret(encrypted), { headers: { Authorization: "Bearer secret" } });
    assert.throws(() => decryptWorkspaceSecret(`${encrypted.slice(0, -1)}A`));
  } finally {
    if (previous === undefined) delete process.env.WORKSPACE_SECRET_ENCRYPTION_KEY;
    else process.env.WORKSPACE_SECRET_ENCRYPTION_KEY = previous;
  }
});

test("v9 migration enables tenancy RLS for designs, storage, MCP and CRM", () => {
  const sql = readFileSync(new URL("../supabase_migrations_v9.sql", import.meta.url), "utf8");
  for (const table of ["workspace_members", "workspace_api_keys", "workspace_mcp_connections", "crm_contacts", "templates", "assets"]) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`, "i"));
  }
  assert.match(sql, /UPDATE storage\.buckets SET public = FALSE/i);
  assert.match(sql, /has_workspace_role\(workspace_id, 'editor'\)/i);
  assert.match(sql, /CREATE POLICY "crm_contacts_workspace_read"[\s\S]*FOR SELECT/i);
  assert.match(sql, /CREATE POLICY "crm_contacts_workspace_write"[\s\S]*has_workspace_role\(workspace_id, 'editor'\)/i);
  assert.match(sql, /CREATE POLICY "workspace_storage_read"[\s\S]*AS RESTRICTIVE FOR SELECT/i);
  assert.match(sql, /REVOKE SELECT ON workspace_mcp_connections FROM anon, authenticated/i);
  assert.match(sql, /prevent_client_workspace_owner_change/i);
  assert.match(sql, /to_regclass\('public\.api_keys'\)/i);
  assert.match(sql, /to_regclass\('public\.client_sessions'\)/i);
});

test("v10 migration links CRM accounts, campaigns, asset categories and graph RLS", () => {
  const sql = readFileSync(new URL("../supabase_migrations_v10.sql", import.meta.url), "utf8");
  assert.match(sql, /ALTER TABLE brands ADD COLUMN IF NOT EXISTS relationship_status/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS campaigns/i);
  assert.match(sql, /ALTER TABLE design_file_meta ADD COLUMN IF NOT EXISTS campaign TEXT/i);
  assert.match(sql, /ALTER TABLE design_file_meta ADD COLUMN IF NOT EXISTS brand_id/i);
  assert.match(sql, /ALTER TABLE design_file_meta ADD COLUMN IF NOT EXISTS campaign_id/i);
  assert.match(sql, /ALTER TABLE design_file_meta ADD COLUMN IF NOT EXISTS asset_type/i);
  assert.match(sql, /UPDATE crm_contacts[\s\S]*SET brand_id = b\.id/i);
  assert.match(sql, /ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /CREATE POLICY "campaigns_workspace_write"[\s\S]*has_workspace_role\(workspace_id, 'editor'\)/i);
});

test("v11 migration provisions personal workspaces and secures invitation lifecycle", () => {
  const sql = readFileSync(new URL("../supabase_migrations_v11.sql", import.meta.url), "utf8");
  for (const column of ["accepted_by", "declined_at", "revoked_at", "last_sent_at", "delivery_method", "requires_account_setup"]) {
    assert.match(sql, new RegExp(`workspace_invitations ADD COLUMN IF NOT EXISTS ${column}`, "i"));
  }
  assert.match(sql, /CREATE OR REPLACE FUNCTION handle_new_futuraria_user/i);
  assert.match(sql, /UPDATE OF email, email_confirmed_at ON auth\.users/i);
  assert.match(sql, /WHERE u\.email_confirmed_at IS NOT NULL/i);
  assert.match(sql, /INSERT INTO workspaces[\s\S]*ws_user_/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION accept_workspace_invitation/i);
  assert.match(sql, /FOR UPDATE/i);
  assert.match(sql, /lower\(target_invitation\.email\) <> current_email/i);
  assert.match(sql, /REVOKE EXECUTE ON FUNCTION accept_workspace_invitation\(TEXT, UUID\) FROM PUBLIC, anon/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION accept_workspace_invitation\(TEXT, UUID\) TO authenticated/i);
});

test("browser auth can load public Supabase config at runtime", () => {
  const client = readFileSync(new URL("../src/lib/supabaseClient.ts", import.meta.url), "utf8");
  const middleware = readFileSync(new URL("../api/src/middleware/auth.ts", import.meta.url), "utf8");
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const authScreen = readFileSync(new URL("../src/components/AuthScreen.tsx", import.meta.url), "utf8");
  const invitations = readFileSync(new URL("../api/src/services/workspaceInvitations.ts", import.meta.url), "utf8");
  const netlifyApi = readFileSync(new URL("../netlify/functions/api.mjs", import.meta.url), "utf8");
  assert.match(client, /fetch\("\/api\/auth\/config"/);
  assert.match(client, /config\?\.publishableKey \|\| config\?\.anonKey/);
  assert.match(middleware, /req\.path === "\/api\/auth\/config"/);
  assert.match(middleware, /req\.path\.startsWith\("\/api\/invitations\/"\)/);
  assert.match(app, /if \(authLoading\) return;/);
  assert.match(app, /<InvitationGate token=\{inviteToken\}/);
  assert.match(authScreen, /resetPasswordForEmail/);
  assert.match(authScreen, /updateUser\(\{ password/);
  assert.match(invitations, /inviteUserByEmail/);
  assert.match(invitations, /signInWithOtp/);
  assert.match(invitations, /maskEmail/);
  assert.match(netlifyApi, /if \(\/\^Bearer\\s\+\\S\+\/i\.test\(bearer\)\) return true/);
  assert.doesNotMatch(client, /SUPABASE_(?:SERVICE|SECRET)_KEY/);
});
