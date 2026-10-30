// apiV2/planear.ts — datos de la vista PLANEAR del shell-v2.
// Endpoints reales: /api/copy-recipes, /api/research/sources, /api/research/items, /api/content
import { getData, postData, patchData, deleteData } from "./client";
import { fetchCalendar, type CalendarEntry } from "./vender";

export { fetchCalendar, type CalendarEntry };

interface Envelope<T> { success: boolean; data: T; total?: number; error?: string }

export interface CopyRecipe {
  id: string;
  name?: string;
  title?: string;
  [k: string]: unknown;
}

export async function fetchCopyRecipes(workspaceId?: string): Promise<CopyRecipe[]> {
  const qs = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
  const res = await getData<Envelope<CopyRecipe[]>>(`/api/copy-recipes${qs}`);
  if (!res.success) throw new Error(res.error || "copy-recipes failed");
  return res.data;
}

export interface ResearchSource {
  id: string;
  [k: string]: unknown;
}

export async function fetchResearchSources(): Promise<ResearchSource[]> {
  const res = await getData<Envelope<ResearchSource[]>>("/api/research/sources");
  if (!res.success) throw new Error(res.error || "research sources failed");
  return res.data;
}

export interface ResearchItem {
  id: string;
  [k: string]: unknown;
}

export async function fetchResearchItems(params?: { sourceId?: string; limit?: number }): Promise<ResearchItem[]> {
  const qs = new URLSearchParams();
  if (params?.sourceId) qs.set("sourceId", params.sourceId);
  if (params?.limit) qs.set("limit", String(params.limit));
  const suffix = qs.toString() ? `?${qs}` : "";
  const res = await getData<Envelope<ResearchItem[]>>(`/api/research/items${suffix}`);
  if (!res.success) throw new Error(res.error || "research items failed");
  return res.data;
}

export async function requestResearch(body: { url?: string; topic?: string; workspaceId: string }): Promise<unknown> {
  const res = await postData<Envelope<unknown>>("/api/research/requests", body);
  if (!res.success) throw new Error(res.error || "research request failed");
  return res.data;
}

export async function updateResearchItem(id: string, body: Record<string, unknown>): Promise<ResearchItem> {
  const res = await patchData<Envelope<ResearchItem>>(`/api/research/items/${id}`, body);
  if (!res.success) throw new Error(res.error || "update item failed");
  return res.data;
}

/** Paquete de la vista PLANEAR. */
export interface PlanearData {
  calendar: CalendarEntry[];
  copyRecipes: CopyRecipe[];
  researchSources: ResearchSource[];
  researchItems: ResearchItem[];
}

export async function loadPlanear(workspaceId: string): Promise<PlanearData> {
  const [calendar, copyRecipes, researchSources, researchItems] = await Promise.all([
    fetchCalendar(workspaceId),
    fetchCopyRecipes(workspaceId),
    fetchResearchSources(),
    fetchResearchItems({ limit: 50 }),
  ]);
  return { calendar, copyRecipes, researchSources, researchItems };
}
