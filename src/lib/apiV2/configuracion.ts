// apiV2/configuracion.ts — datos de la vista CONFIGURACIÓN del shell-v2.
// Endpoints reales: /api/workspaces (get/put), /api/fonts/custom,
// /api/storage/usage, /api/account/me (perfil), /api/keys (BYOK IA),
// /api/webhooks (hooks salientes de la cuenta)
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

// ── F4: papelera real (backend ya existía: GET /api/templates/trash + PUT /:id/restore) ──
// El service filtra deleted_at IS NULL en vivos y lista borrados con order deleted_at desc.

export interface TrashTemplate {
  id: string;
  name?: string;
  title?: string;
  workspaceId?: string;
  workspace_id?: string;
  deleted_at?: string | null;
  updated_at?: string;
  [k: string]: unknown;
}

/** GET /api/templates/trash — diseños borrados (soft-deleted) accesibles al usuario. */
export async function fetchPapelera(limit = 100, offset = 0): Promise<TrashTemplate[]> {
  const res = await getData<Envelope<TrashTemplate[]>>(
    `/api/templates/trash?limit=${limit}&offset=${offset}`
  );
  // F5: valida el envelope como sus hermanas — sin esto un error de API se
  // vería como "Papelera vacía" en la vista.
  if (!res.success) throw new Error(res.error || "trash failed");
  return res.data ?? [];
}

/** PUT /api/templates/:id/restore — saca un diseño de la papelera. */
export async function restoreFromTrash(id: string): Promise<void> {
  // F5: la ruta es PUT (api/src/routes/templates.ts: templateRoutes.put(":id/restore"));
  // estaba con getData (GET) y devolvía 404 en runtime.
  await putData<Envelope<unknown>>(`/api/templates/${id}/restore`, {});
}

// ── Cuenta de la sesión ──

/** Perfil del usuario autenticado: fila user_profiles servida por /api/account/me. */
export interface AccountProfile {
  id: string;
  email?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  website?: string | null;
  brand_name?: string | null;
  access_plan?: string | null;
  referral_code?: string | null;
  nda_accepted_at?: string | null;
  onboarding_completed?: boolean | null;
  created_at?: string;
  [k: string]: unknown;
}

export async function fetchAccount(): Promise<AccountProfile> {
  const res = await getData<Envelope<AccountProfile>>("/api/account/me");
  if (!res.success) throw new Error(res.error || "account failed");
  return res.data;
}

// ── Llaves BYOK de IA ──

/** Estado de la key de un proveedor: la key jamás viaja al cliente, solo last4. */
export interface LlmKeyStatus {
  configured?: boolean;
  model?: string | null;
  last4?: string | null;
}

/** GET /api/keys responde el mapa directo {provider: estado} — sin envelope. */
export async function fetchLlmKeys(): Promise<Record<string, LlmKeyStatus>> {
  return await getData<Record<string, LlmKeyStatus>>("/api/keys");
}

// ── Webhooks salientes ──

/** Hook registrado por la cuenta (el secret nunca viaja, solo su máscara). */
export interface WebhookHook {
  id?: string;
  label?: string | null;
  url?: string;
  events?: string[];
  active?: boolean;
  secretPreview?: string;
  createdAt?: string;
  updatedAt?: string;
  [k: string]: unknown;
}

export async function fetchWebhooks(): Promise<WebhookHook[]> {
  const res = await getData<Envelope<WebhookHook[]>>("/api/webhooks");
  if (!res.success) throw new Error(res.error || "webhooks failed");
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
