// apiV2/configuracion.ts — datos de la vista CONFIGURACIÓN del shell-v2.
// Endpoints reales: /api/workspaces (get/put), /api/fonts/custom, /api/storage/usage
import { getData, putData } from "./client";
import type { WorkspaceSummary } from "./inicio";

interface Envelope<T> { success: boolean; data: T; total?: number; error?: string }

export async function fetchWorkspace(id: string): Promise<WorkspaceSummary> {
  const res = await getData<Envelope<WorkspaceSummary>>(`/api/workspaces/${id}`);
  if (!res.success) throw new Error(res.error || "workspace failed");
  return res.data;
}

export async function updateWorkspace(
  id: string,
  body: Partial<WorkspaceSummary>
): Promise<WorkspaceSummary> {
  const res = await putData<Envelope<WorkspaceSummary>>(`/api/workspaces/${id}`, body);
  if (!res.success) throw new Error(res.error || "update workspace failed");
  return res.data;
}

export interface CustomFont {
  id: string;
  family_name: string;
  file_name: string;
  format?: string;
  size_bytes?: number;
  created_at?: string;
}

export async function fetchCustomFonts(): Promise<CustomFont[]> {
  const res = await getData<{ success: boolean; data: { fonts: CustomFont[] } }>("/api/fonts/custom");
  return res.data?.fonts ?? [];
}

export interface StorageUsage {
  bytes?: number;
  objectCount?: number;
  [k: string]: unknown;
}

export async function fetchStorageUsage(workspaceId: string): Promise<StorageUsage> {
  const res = await getData<Envelope<StorageUsage>>(
    `/api/storage/usage?workspaceId=${encodeURIComponent(workspaceId)}`
  );
  if (!res.success) throw new Error(res.error || "storage usage failed");
  return res.data;
}

/** Paquete de la vista CONFIGURACIÓN. */
export interface ConfiguracionData {
  workspace: WorkspaceSummary;
  fonts: CustomFont[];
  storage: StorageUsage;
}

export async function loadConfiguracion(workspaceId: string): Promise<ConfiguracionData> {
  const [workspace, fonts, storage] = await Promise.all([
    fetchWorkspace(workspaceId),
    fetchCustomFonts(),
    fetchStorageUsage(workspaceId),
  ]);
  return { workspace, fonts, storage };
}
