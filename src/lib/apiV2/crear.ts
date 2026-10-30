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
