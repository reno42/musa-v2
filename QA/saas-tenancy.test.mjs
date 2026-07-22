import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { encryptWorkspaceSecret, decryptWorkspaceSecret } from "../api/src/services/secrets.ts";
import { hasMinimumWorkspaceRole, workspaceKeyAllows } from "../api/src/services/workspaceRoles.ts";

test("workspace roles isolate viewers, editors and workspace API keys", () => {
  assert.equal(hasMinimumWorkspaceRole("owner", "admin"), true);
  assert.equal(hasMinimumWorkspaceRole("editor", "editor"), true);
  assert.equal(hasMinimumWorkspaceRole("viewer", "editor"), false);
  assert.equal(workspaceKeyAllows("workspace-a", "editor", "workspace-a", "editor"), true);
  assert.equal(workspaceKeyAllows("workspace-a", "editor", "workspace-b", "viewer"), false);
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
