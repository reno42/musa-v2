import type { WorkspaceRole } from "./requestContext.js";

const ROLE_RANK: Record<WorkspaceRole, number> = { viewer: 1, editor: 2, admin: 3, owner: 4 };

export function hasMinimumWorkspaceRole(actual: WorkspaceRole | null | undefined, minimum: WorkspaceRole) {
  return Boolean(actual && ROLE_RANK[actual] >= ROLE_RANK[minimum]);
}
export function workspaceKeyAllows(
  keyWorkspaceId: string | undefined,
  keyRole: WorkspaceRole | undefined,
  targetWorkspaceId: string,
  minimum: WorkspaceRole,
) {
  return keyWorkspaceId === targetWorkspaceId && hasMinimumWorkspaceRole(keyRole || "viewer", minimum);
}
