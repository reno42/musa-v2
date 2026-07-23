import type { SupabaseClient, User } from "@supabase/supabase-js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isLegacyWorkspaceOwner(ownerId: unknown): boolean {
  return typeof ownerId !== "string" || !UUID_PATTERN.test(ownerId);
}

export async function ensurePersonalWorkspace(
  sb: SupabaseClient,
  user: User,
): Promise<string | null> {
  const { data: owned, error: ownedError } = await sb
    .from("workspaces")
    .select("id")
    .eq("owner_id", user.id)
    .limit(1)
    .maybeSingle();
  if (ownedError) throw ownedError;
  if (owned?.id) {
    const { error: membershipError } = await sb.from("workspace_members").upsert({
      workspace_id: owned.id,
      user_id: user.id,
      role: "owner",
    }, { onConflict: "workspace_id,user_id" });
    if (membershipError) throw membershipError;
    return owned.id;
  }

  const compactUserId = user.id.replaceAll("-", "");
  const workspaceId = `ws_user_${compactUserId.slice(0, 20)}`;
  const slug = `workspace-${compactUserId.slice(0, 20)}`;
  const displayName = String(
    user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split("@")[0] || "Mi cuenta",
  ).trim();
  const name = `Workspace de ${displayName || "Mi cuenta"}`;
  const now = new Date().toISOString();
  const workspace = {
    id: workspaceId,
    name,
    slug,
    ownerId: user.id,
    memberIds: [user.id],
    createdAt: now,
    updatedAt: now,
  };

  const { error: workspaceError } = await sb.from("workspaces").upsert({
    id: workspaceId,
    name,
    slug,
    owner_id: user.id,
    member_ids: [user.id],
    data: workspace,
    created_at: now,
    updated_at: now,
  });
  if (workspaceError) throw workspaceError;

  const { error: membershipError } = await sb.from("workspace_members").upsert({
    workspace_id: workspaceId,
    user_id: user.id,
    role: "owner",
  }, { onConflict: "workspace_id,user_id" });
  if (membershipError) throw membershipError;
  return workspaceId;
}

/**
 * Transfers pre-SaaS workspaces to the initial account exactly once.
 * An explicit SAAS_INITIAL_OWNER_EMAIL wins; otherwise automatic claiming is
 * allowed only while this is the sole Supabase Auth account and no membership
 * has ever been created.
 */
export async function claimLegacyWorkspacesForInitialUser(
  sb: SupabaseClient,
  user: User,
): Promise<number> {
  const configuredEmail = process.env.SAAS_INITIAL_OWNER_EMAIL?.trim().toLowerCase();
  const userEmail = user.email?.trim().toLowerCase();
  if (configuredEmail && configuredEmail !== userEmail) return 0;

  const { count: membershipCount, error: membershipError } = await sb
    .from("workspace_members")
    .select("workspace_id", { count: "exact", head: true });
  if (membershipError) throw membershipError;
  if (!configuredEmail && (membershipCount || 0) > 0) return 0;

  if (!configuredEmail) {
    const { data, error } = await sb.auth.admin.listUsers({ page: 1, perPage: 2 });
    if (error) throw error;
    if (data.users.length !== 1 || data.users[0]?.id !== user.id) return 0;
  }

  const { data: workspaceRows, error: workspaceError } = await sb
    .from("workspaces")
    .select("id, owner_id");
  if (workspaceError) throw workspaceError;

  const workspaceIds = (workspaceRows || [])
    .filter((workspace: { owner_id: unknown }) => isLegacyWorkspaceOwner(workspace.owner_id))
    .map((workspace: { id: string }) => workspace.id);
  if (workspaceIds.length === 0) return 0;

  const now = new Date().toISOString();
  const { error: ownerError } = await sb
    .from("workspaces")
    .update({ owner_id: user.id, updated_at: now })
    .in("id", workspaceIds);
  if (ownerError) throw ownerError;

  const memberships = workspaceIds.map((workspaceId) => ({
    workspace_id: workspaceId,
    user_id: user.id,
    role: "owner",
  }));
  const { error: memberInsertError } = await sb
    .from("workspace_members")
    .upsert(memberships, { onConflict: "workspace_id,user_id" });
  if (memberInsertError) throw memberInsertError;

  const { error: templateOwnerError } = await sb
    .from("templates")
    .update({ user_id: user.id, updated_at: now })
    .in("workspace_id", workspaceIds);
  if (templateOwnerError) throw templateOwnerError;

  return workspaceIds.length;
}
