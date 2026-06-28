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
 * Prefers localStorage if it has newer data than the API (freemium resilience).
 */
export async function getTemplate(id: string): Promise<TemplateFull | null> {
  try {
    const res = await apiFetch<{ data: TemplateFull }>(`/api/templates/${id}`);
    const apiData = res.data;
    const localData = getLocalTemplate(id);
    console.error("[getTemplate] ═══ DECISION ═══", {
      id,
      apiHasFrames: !!(apiData as any)?.frames?.length,
      apiUpdated: (apiData as any)?.metadata?.updatedAt,
      localExists: !!localData,
      localHasFrames: localData?.frames?.length,
      localUpdated: localData?.updatedAt,
      localNewer: localData?.updatedAt > ((apiData as any)?.metadata?.updatedAt || ""),
    });

    // Helper: check if data has meaningful content (V2: html/css/frames)
    const hasContent = (d: any) =>
      Boolean(d?.html) || Boolean(d?.css) || (d?.frames?.length > 0);

    // If localStorage has a newer version with content, prefer it
    // Grace window: server clock is typically 200-800ms ahead of client clock.
    // Treat timestamps within 5s of each other as equal — prefer localStorage
    // in that case because it has the user's most recent edits.
    if (localData && apiData) {
      const apiUpdated = (apiData as any).metadata?.updatedAt || "";
      const localUpdated = localData.updatedAt || "";
      const apiMs = new Date(apiUpdated).getTime() || 0;
      const localMs = new Date(localUpdated).getTime() || 0;
      const GRACE_MS = 5000;
      const localIsNewer = (localMs > apiMs) || (Math.abs(localMs - apiMs) < GRACE_MS);
      if (localIsNewer && hasContent(localData)) {
        console.error("[getTemplate] ✓ Using LOCAL (newer or within grace)", { apiMs, localMs, diff: localMs - apiMs, grace: GRACE_MS });
        return {
          ...apiData,
          ...localData,
          html: localData.html || apiData.html,
          css: localData.css || apiData.css,
          pages: localData.pages || (apiData as any).pages,
          frames: localData.frames || (apiData as any).frames,
          styles: localData.styles || (apiData as any).styles,
          variables: localData.variables || (apiData as any).variables,
          name: localData.name || apiData.name,
        } as TemplateFull;
      }
    }

    // If API returned empty data but localStorage has content
    if (apiData && !hasContent(apiData) && hasContent(localData)) {
      console.error("[getTemplate] ✓ Using LOCAL (API empty)");
      return {
        ...apiData,
        ...localData,
        html: localData.html || apiData.html,
        css: localData.css || apiData.css,
        pages: localData.pages || (apiData as any).pages,
        frames: localData.frames || (apiData as any).frames,
        styles: localData.styles || (apiData as any).styles,
        variables: localData.variables || (apiData as any).variables,
        name: localData.name || apiData.name,
      } as TemplateFull;
    }

    return apiData;
  } catch (err: any) {
    console.error("[getTemplate] ✗ API fetch FAILED:", err.message);
    const msg = err.message || "";
    // Always try localStorage first for any error (freemium resilience)
    const local = getLocalTemplate(id);
    if (local) return local as TemplateFull;
    // Only throw for non-404 errors if localStorage was also empty
    if (!msg.includes("404") && !msg.includes("not found")) {
      throw err;
    }
    return null;
  }
}

/**
 * Create a new template.
 */
export async function createTemplate(
  name: string,
  width = 1080,
  height = 1080
): Promise<DesignTemplate> {
  const res = await apiFetch<{ data: DesignTemplate }>("/api/templates", {
    method: "POST",
    body: JSON.stringify({ name, width, height }),
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
 * Merges API results with localStorage to preserve locally-saved templates.
 */
export async function listTemplates(
  limit = 50,
  offset = 0
): Promise<{ data: DesignTemplate[]; total: number }> {
  try {
    const result = await apiFetch<{ data: DesignTemplate[]; total: number }>(
      `/api/templates?limit=${limit}&offset=${offset}`
    );
    // Merge with localStorage templates (don't lose local-only ones)
    const localTemplates = listLocalTemplates();
    const apiIds = new Set(result.data.map((t: any) => t.id));
    const merged = [...result.data];
    for (const local of localTemplates) {
      if (!apiIds.has(local.id)) {
        merged.push({
          id: local.id,
          name: local.name || "Untitled",
          width: local.width || 1080,
          height: local.height || 1080,
          pages: local.pages,
          frames: local.frames,
          styles: local.styles,
          variables: local.variables,
          metadata: { updatedAt: local.updatedAt },
        } as any);
      }
    }
    return { data: merged, total: merged.length };
  } catch {
    // API offline → show only localStorage templates
    const local = listLocalTemplates();
    return { data: local as any[], total: local.length };
  }
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
