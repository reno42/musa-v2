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

// ── F3: áreas internas, aprobaciones y agencias (tablas workspace_* propias) ──
// Tablas creadas aditivamente por Hermes (docs/migrations/F3-hermes-aditivas.sql),
// RLS por workspace (patrón crm_deals: viewer lee, editor escribe).

export interface WorkspaceArea {
  id: string;
  workspace_id: string;
  name: string;
  lead_name?: string | null;
  member_count?: number;
  created_at?: string;
  updated_at?: string;
}

export async function fetchAreas(workspaceId: string, limit = 100): Promise<WorkspaceArea[]> {
  const qs = new URLSearchParams({
    workspace_id: `eq.${workspaceId}`,
    select: "id,workspace_id,name,lead_name,member_count,created_at,updated_at",
    order: "name.asc",
    limit: String(limit),
  });
  return getData<WorkspaceArea[]>(`/rest/v1/workspace_areas?${qs}`);
}

export interface WorkspaceApproval {
  id: string;
  workspace_id: string;
  piece_id?: string | null;
  piece_name?: string | null;
  brand_name?: string | null;
  requested_by?: string | null;
  status?: string | null;
  requested_at?: string;
  decided_at?: string | null;
  updated_at?: string;
}

export async function fetchApprovals(workspaceId: string, limit = 100): Promise<WorkspaceApproval[]> {
  const qs = new URLSearchParams({
    workspace_id: `eq.${workspaceId}`,
    select: "id,workspace_id,piece_id,piece_name,brand_name,requested_by,status,requested_at,decided_at,updated_at",
    order: "requested_at.desc",
    limit: String(limit),
  });
  return getData<WorkspaceApproval[]>(`/rest/v1/workspace_approvals?${qs}`);
}

export interface WorkspaceAgency {
  id: string;
  workspace_id: string;
  name: string;
  plan?: string | null;
  brands?: string[] | null;
  member_count?: number;
  created_at?: string;
  updated_at?: string;
}

export async function fetchAgencies(workspaceId: string, limit = 100): Promise<WorkspaceAgency[]> {
  const qs = new URLSearchParams({
    workspace_id: `eq.${workspaceId}`,
    select: "id,workspace_id,name,plan,brands,member_count,created_at,updated_at",
    order: "name.asc",
    limit: String(limit),
  });
  return getData<WorkspaceAgency[]>(`/rest/v1/workspace_agencies?${qs}`);
}
