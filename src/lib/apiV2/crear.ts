// apiV2/crear.ts — datos de la vista CREAR (proyectos + automatizaciones) del shell-v2.
// Endpoints reales: /api/templates (list/create), /api/recipes (CRUD)
import { getData, postData, patchData, deleteData } from "./client";

export interface CreateTemplateInput {
  name: string;
  width?: number;
  height?: number;
  workspaceId: string;
  engine?: string;
  html?: string;
  css?: string;
}

export interface Recipe {
  id: string;
  workspaceId?: string;
  name?: string;
  title?: string;
  status?: string;
  updatedAt?: string;
  [k: string]: unknown;
}

interface Envelope<T> { success: boolean; data: T; total?: number; error?: string }

export async function fetchTemplates(limit = 50, offset = 0): Promise<{ items: unknown[]; total: number }> {
  const res = await getData<{ data: unknown[]; total: number }>(
    `/api/templates?limit=${limit}&offset=${offset}`
  );
  return { items: res.data, total: res.total };
}

export async function createTemplate(input: CreateTemplateInput): Promise<unknown> {
  const res = await postData<Envelope<unknown>>("/api/templates", input);
  if (!res.success) throw new Error(res.error || "create failed");
  return res.data;
}

export async function fetchRecipes(workspaceId?: string): Promise<Recipe[]> {
  const qs = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
  const res = await getData<Envelope<Recipe[]>>(`/api/recipes${qs}`);
  if (!res.success) throw new Error(res.error || "recipes failed");
  return res.data;
}

export async function createRecipe(body: Partial<Recipe>): Promise<Recipe> {
  const res = await postData<Envelope<Recipe>>("/api/recipes", body);
  if (!res.success) throw new Error(res.error || "create recipe failed");
  return res.data;
}

export async function updateRecipe(id: string, body: Partial<Recipe>): Promise<Recipe> {
  const res = await patchData<Envelope<Recipe>>(`/api/recipes/${id}`, body);
  if (!res.success) throw new Error(res.error || "update recipe failed");
  return res.data;
}

export async function deleteRecipe(id: string): Promise<void> {
  await deleteData(`/api/recipes/${id}`);
}

/** Paquete de la vista CREAR. */
export interface CrearData {
  templates: { items: unknown[]; total: number };
  recipes: Recipe[];
}

export async function loadCrear(workspaceId?: string): Promise<CrearData> {
  const [templates, recipes] = await Promise.all([
    fetchTemplates(50, 0),
    fetchRecipes(workspaceId),
  ]);
  return { templates, recipes };
}

// ── F2: videos (videoProjects), marcas (brands), tomas (photos) ──

export interface VideoProject {
  id: string;
  workspaceId?: string;
  title?: string;
  name?: string;
  status?: string;
  updatedAt?: string;
  [k: string]: unknown;
}

/** GET /api/video-projects?workspaceId=… (endpoint real, 13 rutas). */
export async function fetchVideoProjects(workspaceId: string): Promise<VideoProject[]> {
  const res = await getData<Envelope<VideoProject[]>>(
    `/api/video-projects?workspaceId=${encodeURIComponent(workspaceId)}`
  );
  if (!res.success) throw new Error(res.error || "video projects failed");
  return res.data;
}

export interface BrandTokens {
  id: string;
  name: string;
  colors?: unknown;
  fonts?: unknown;
  spacing?: unknown;
  logo_asset_id?: string | null;
  updated_at?: string;
}

/** Marcas con tokens reales (JSONB colors/fonts/spacing en la tabla brands). */
export async function fetchBrandTokens(workspaceId: string): Promise<BrandTokens[]> {
  const qs = new URLSearchParams({
    workspace_id: `eq.${workspaceId}`,
    select: "id,name,colors,fonts,spacing,logo_asset_id,updated_at",
    order: "updated_at.desc",
    limit: "100",
  });
  return getData<BrandTokens[]>(`/rest/v1/brands?${qs}`);
}

export interface PhotoDocument {
  id: string;
  workspaceId?: string;
  name?: string;
  title?: string;
  url?: string;
  createdAt?: string;
  [k: string]: unknown;
}

/** Tomas/grabaciones: GET /api/photos/documents?workspaceId=… */
export async function fetchTomas(workspaceId: string): Promise<PhotoDocument[]> {
  const res = await getData<Envelope<PhotoDocument[]>>(
    `/api/photos/documents?workspaceId=${encodeURIComponent(workspaceId)}`
  );
  if (!res.success) throw new Error(res.error || "photos failed");
  return res.data;
}

/** Fila real de photo_catalog_items (select *, orden updated_at desc, ≤200). */
export interface PhotoCatalogItem {
  id?: string;
  asset_id?: string | null;
  source_url?: string | null;
  rating?: number | null;
  flag?: string | null;
  color_label?: string | null;
  keywords?: string[] | null;
  updated_at?: string;
  created_at?: string;
  [k: string]: unknown;
}

/**
 * Biblioteca de fotos del workspace: GET /api/photos/catalog ({success, items}).
 * NOTA: /api/photos/documents NO lista documentos sin sourceUrl (responde
 * document:null), por eso la vista de tomas lista desde /catalog.
 */
export async function fetchPhotoCatalog(workspaceId: string): Promise<PhotoCatalogItem[]> {
  const res = await getData<{ success: boolean; items?: PhotoCatalogItem[]; error?: string }>(
    `/api/photos/catalog?workspaceId=${encodeURIComponent(workspaceId)}`
  );
  if (!res.success) throw new Error(res.error || "photos catalog failed");
  return res.items ?? [];
}
