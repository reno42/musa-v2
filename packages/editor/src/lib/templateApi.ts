import { apiFetch } from "./supabase";
import type { DesignTemplate } from "@futuraria/shared";

export interface TemplateFull extends DesignTemplate {
  pages?: any[];
  frames?: any[];
  styles?: any[];
  comments?: any[];
  versions?: any[];
  variables?: {
    collections: any[];
    variables: any[];
    bindings: Record<string, any[]>;
  };
}

/**
 * Fetch a complete template with all nested data.
 */
export async function getTemplate(id: string): Promise<TemplateFull | null> {
  try {
    const res = await apiFetch<{ data: TemplateFull }>(`/api/templates/${id}`);
    return res.data;
  } catch (err: any) {
    const msg = err.message || "";
    // Network error or server down → try localStorage
    if (msg.includes("fetch") || msg.includes("NetworkError") || msg.includes("Failed to fetch") || msg.includes("500")) {
      const local = getLocalTemplate(id);
      if (local) return local as TemplateFull;
      return null;
    }
    if (msg.includes("404") || msg.includes("not found")) {
      return null;
    }
    throw err;
  }
}

/**
 * Create a new template.
 */
export async function createTemplate(
  name: string,
  width = 1080,
  height = 1080,
  canvasJson?: any
): Promise<DesignTemplate> {
  const res = await apiFetch<{ data: DesignTemplate }>("/api/templates", {
    method: "POST",
    body: JSON.stringify({ name, width, height, canvas: canvasJson }),
  });
  return res.data;
}

/**
 * Update a template (partial update).
 */
export async function updateTemplate(
  id: string,
  updates: Partial<DesignTemplate> & Record<string, any>
): Promise<DesignTemplate> {
  const res = await apiFetch<{ data: DesignTemplate }>(`/api/templates/${id}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });
  return res.data;
}

/**
 * Delete a template.
 */
export async function deleteTemplate(id: string): Promise<void> {
  await apiFetch(`/api/templates/${id}`, { method: "DELETE" });
}

/**
 * Duplicate a template.
 */
export async function duplicateTemplate(
  id: string,
  name?: string
): Promise<DesignTemplate> {
  const res = await apiFetch<{ data: DesignTemplate }>(
    `/api/templates/${id}/duplicate`,
    {
      method: "POST",
      body: JSON.stringify({ name }),
    }
  );
  return res.data;
}

/**
 * List templates with pagination.
 */
export async function listTemplates(
  limit = 50,
  offset = 0
): Promise<{ data: DesignTemplate[]; total: number }> {
  return apiFetch(`/api/templates?limit=${limit}&offset=${offset}`);
}

// ─── Local storage fallback ────────────────────────────────

const LS_KEY = "futuraria_local_templates";

function getLocalTemplates(): Record<string, any> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveLocalTemplate(id: string, data: any) {
  const all = getLocalTemplates();
  all[id] = { ...data, id, updatedAt: new Date().toISOString() };
  localStorage.setItem(LS_KEY, JSON.stringify(all));
}

export function getLocalTemplate(id: string): any | null {
  return getLocalTemplates()[id] || null;
}

export function saveLocal(id: string, data: any) {
  saveLocalTemplate(id, data);
}

export function listLocalTemplates(): any[] {
  return Object.values(getLocalTemplates()).sort(
    (a: any, b: any) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export function deleteLocalTemplate(id: string) {
  const all = getLocalTemplates();
  delete all[id];
  localStorage.setItem(LS_KEY, JSON.stringify(all));
}
