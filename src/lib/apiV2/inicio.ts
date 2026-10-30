// apiV2/inicio.ts — datos de la vista INICIO (dashboard) del shell-v2.
// Endpoints reales: GET /api/workspaces, GET /api/templates, GET /api/metrics/activity,
// y derivados de reales: crm_deals (vender.ts) para los seguimientos de mi-trabajo.
import { getData } from "./client";
import { buildLoops, fetchDeals, type LoopItem } from "./vender";

export interface WorkspaceSummary {
  id: string;
  name?: string;
  slug?: string;
  role?: string;
  createdAt?: string;
  [k: string]: unknown;
}

export interface TemplateSummary {
  id: string;
  title?: string;
  name?: string;
  updatedAt?: string;
  createdAt?: string;
  [k: string]: unknown;
}

export interface DayMetrics {
  date: string;
  designOps: number;
  framesCreated: number;
  templatesCreated: number;
  byActor: { ia: number; human: number; system: number };
}

export interface ActivityRange {
  days: DayMetrics[];
  totals: { designOps: number; framesCreated: number; templatesCreated: number };
  from: string;
  to: string;
}

interface Envelope<T> { success: boolean; data: T; total?: number; error?: string }

export async function fetchWorkspaces(): Promise<WorkspaceSummary[]> {
  const res = await getData<Envelope<WorkspaceSummary[]>>("/api/workspaces");
  if (!res.success) throw new Error(res.error || "workspaces failed");
  return res.data;
}

export async function fetchRecentTemplates(limit = 8): Promise<TemplateSummary[]> {
  const res = await getData<{ data: TemplateSummary[]; total: number }>(
    `/api/templates?limit=${limit}&offset=0`
  );
  return res.data;
}

export async function fetchActivity(days = 30, workspaceId?: string): Promise<ActivityRange> {
  const to = new Date();
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const qs = new URLSearchParams({
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    ...(workspaceId ? { workspaceId } : {}),
  });
  const res = await getData<Envelope<ActivityRange>>(`/api/metrics/activity?${qs}`);
  if (!res.success) throw new Error(res.error || "metrics failed");
  return res.data;
}

/** Paquete único para la vista: una llamada por bloque del dashboard. */
export interface InicioData {
  workspaces: WorkspaceSummary[];
  recentTemplates: TemplateSummary[];
  activity: ActivityRange;
}

export async function loadInicio(): Promise<InicioData> {
  const [workspaces, recentTemplates, activity] = await Promise.all([
    fetchWorkspaces(),
    fetchRecentTemplates(),
    fetchActivity(30),
  ]);
  return { workspaces, recentTemplates, activity };
}

// ── inicio/mi-trabajo: derivado de datos reales, sin entidades inventadas ──

/** Paquete de la vista: seguimientos CRM (deals con next_step) + piezas recientes. */
export interface MiTrabajoData {
  followUps: LoopItem[];
  recentTemplates: TemplateSummary[];
}

export async function fetchMiTrabajo(workspaceId: string): Promise<MiTrabajoData> {
  const [deals, recentTemplates] = await Promise.all([
    fetchDeals(workspaceId),
    fetchRecentTemplates(8),
  ]);
  return { followUps: buildLoops(deals), recentTemplates };
}
