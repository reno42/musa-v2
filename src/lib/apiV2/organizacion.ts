// apiV2/organizacion.ts — datos de la vista ORGANIZACIÓN del shell-v2.
// Endpoints reales: /api/workspaces (lista), /api/workspaces/:id/members
// NOTA REQ-070: roles/invitaciones completas dependen de /api/invitations (fase 2).
import { getData, postData } from "./client";
import type { WorkspaceSummary } from "./inicio";

interface Envelope<T> { success: boolean; data: T; total?: number; error?: string }

export interface WorkspaceMember {
  id?: string;
  userId?: string;
  email?: string;
  role?: string;
  [k: string]: unknown;
}

export async function fetchMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  const res = await getData<Envelope<WorkspaceMember[]>>(`/api/workspaces/${workspaceId}/members`);
  if (!res.success) throw new Error(res.error || "members failed");
  return res.data;
}

export async function inviteMember(
  workspaceId: string,
  body: { email: string; role?: string }
): Promise<unknown> {
  const res = await postData<Envelope<unknown>>(`/api/workspaces/${workspaceId}/members`, body);
  if (!res.success) throw new Error(res.error || "invite failed");
  return res.data;
}

export async function fetchAllWorkspaces(): Promise<WorkspaceSummary[]> {
  const res = await getData<Envelope<WorkspaceSummary[]>>("/api/workspaces");
  if (!res.success) throw new Error(res.error || "workspaces failed");
  return res.data;
}

/** Paquete de la vista ORGANIZACIÓN. */
export interface OrganizacionData {
  workspaces: WorkspaceSummary[];
  members: WorkspaceMember[];
}

export async function loadOrganizacion(workspaceId: string): Promise<OrganizacionData> {
  const [workspaces, members] = await Promise.all([
    fetchAllWorkspaces(),
    fetchMembers(workspaceId).catch(() => [] as WorkspaceMember[]),
  ]);
  return { workspaces, members };
}
