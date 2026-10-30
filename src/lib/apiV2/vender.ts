// apiV2/vender.ts — datos de las vistas VENDER del shell-v2 (kanban CRM).
// Fuentes reales: /api/content (calendario + attribution), /api/comments-share,
// y tablas Supabase crm_deals / crm_contacts / brands vía PostgREST con la
// sesión del usuario (RLS aplica por workspace). Stages REALES observados:
// discovery / negotiation / proposal (+ closed_won / closed_lost en el enum).
import { getData } from "./client";

interface Envelope<T> { success: boolean; data: T; total?: number; error?: string }

// ── Calendario / atribución (ya existían) ──
export interface CalendarEntry { [k: string]: unknown }

export async function fetchCalendar(workspaceId: string): Promise<CalendarEntry[]> {
  if (!workspaceId) throw new Error("workspaceId requerido por /api/content");
  const res = await getData<Envelope<CalendarEntry[]>>(
    `/api/content?workspaceId=${encodeURIComponent(workspaceId)}`
  );
  if (!res.success) throw new Error(res.error || "content failed");
  return res.data;
}

export async function fetchAttribution(workspaceId: string): Promise<unknown> {
  const res = await getData<Envelope<unknown>>(
    `/api/content/attribution?workspaceId=${encodeURIComponent(workspaceId)}`
  );
  if (!res.success) throw new Error(res.error || "attribution failed");
  return res.data;
}

export interface ShareStat { [k: string]: unknown }

export async function fetchShares(workspaceId?: string): Promise<ShareStat[]> {
  const qs = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
  const res = await getData<Envelope<ShareStat[]>>(`/api/comments-share${qs}`);
  if (!res.success) throw new Error(res.error || "shares failed");
  return res.data;
}

// ── CRM: deals (kanban) ──
export type DealStage = "discovery" | "negotiation" | "proposal" | string;

export interface CrmDeal {
  id: string;
  workspace_id: string;
  title: string;
  stage: DealStage | null;
  value?: number | null;
  final_value?: number | null;
  currency?: string | null;
  probability?: number | null;
  expected_close_date?: string | null;
  next_step_date?: string | null;
  next_step_note?: string | null;
  brand_id?: string | null;
  primary_contact_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export async function fetchDeals(workspaceId: string, limit = 200): Promise<CrmDeal[]> {
  const qs = new URLSearchParams({
    workspace_id: `eq.${workspaceId}`,
    select: ["id","title","stage","value","final_value","currency","probability",
      "expected_close_date","next_step_date","next_step_note","brand_id",
      "primary_contact_id","created_at","updated_at"].join(","),
    order: "updated_at.desc",
    limit: String(limit),
  });
  return getData<CrmDeal[]>(`/rest/v1/crm_deals?${qs}`);
}

/** Kanban listo: agrupa deals por stage en el orden del embudo. */
export const DEAL_STAGES: DealStage[] = ["discovery", "proposal", "negotiation", "closed_won", "closed_lost"];

export function groupDealsByStage(deals: CrmDeal[]): Record<string, CrmDeal[]> {
  const out: Record<string, CrmDeal[]> = {};
  for (const s of DEAL_STAGES) out[s] = [];
  for (const d of deals) {
    const s = d.stage && out[d.stage] ? d.stage : "discovery";
    out[s].push(d);
  }
  return out;
}

// ── CRM: contactos (tabla) ──
export type ContactStatus = "lead" | "active" | "inactive" | string;

export interface CrmContact {
  id: string;
  workspace_id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  job_title?: string | null;
  status?: ContactStatus | null;
  tags?: string[] | null;
  brand_id?: string | null;
  brand_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

export async function fetchContacts(workspaceId: string, limit = 200): Promise<CrmContact[]> {
  const qs = new URLSearchParams({
    workspace_id: `eq.${workspaceId}`,
    select: ["id","first_name","last_name","email","phone","company","job_title",
      "status","tags","brand_id","brand_name","created_at","updated_at"].join(","),
    order: "updated_at.desc",
    limit: String(limit),
  });
  return getData<CrmContact[]>(`/rest/v1/crm_contacts?${qs}`);
}

// ── CRM: empresas (brands) ──
export interface CrmBrand {
  id: string;
  workspace_id?: string;
  name: string;
  relationship_status?: string | null;
  crm_priority?: string | null;
  account_health?: string | null;
  logo_asset_id?: string | null;
  last_contacted_at?: string | null;
  next_follow_up_at?: string | null;
  created_at?: string;
}

export async function fetchBrands(workspaceId: string, limit = 200): Promise<CrmBrand[]> {
  const qs = new URLSearchParams({
    workspace_id: `eq.${workspaceId}`,
    select: ["id","name","relationship_status","crm_priority","account_health",
      "logo_asset_id","last_contacted_at","next_follow_up_at","created_at"].join(","),
    order: "name.asc",
    limit: String(limit),
  });
  return getData<CrmBrand[]>(`/rest/v1/brands?${qs}`);
}

// ── Embudo: agregación servida, la vista no calcula ──
export interface FunnelStage {
  stage: DealStage;
  cantidad: number;
  valorUsd: number;
  probabilidadPromedio: number;
}

export function buildFunnel(deals: CrmDeal[]): FunnelStage[] {
  return DEAL_STAGES.map((stage) => {
    const inStage = deals.filter((d) => (d.stage || "discovery") === stage);
    const valor = inStage.reduce((acc, d) => acc + Number(d.final_value ?? d.value ?? 0), 0);
    const probs = inStage.map((d) => Number(d.probability ?? 0)).filter((n) => !Number.isNaN(n));
    return {
      stage,
      cantidad: inStage.length,
      valorUsd: Math.round(valor),
      probabilidadPromedio: probs.length ? Math.round((probs.reduce((a, b) => a + b, 0) / probs.length) * 100) : 0,
    };
  });
}

// ── Loops: seguimientos próximos ──
export interface LoopItem {
  dealId: string;
  title: string;
  nextStepDate: string | null;
  nextStepNote: string | null;
  stage: DealStage | null;
  vencido: boolean;
}

export function buildLoops(deals: CrmDeal[]): LoopItem[] {
  const today = new Date().toISOString().slice(0, 10);
  return deals
    .filter((d) => d.next_step_date || d.next_step_note)
    .map((d) => ({
      dealId: d.id,
      title: d.title,
      nextStepDate: d.next_step_date ?? null,
      nextStepNote: d.next_step_note ?? null,
      stage: d.stage,
      vencido: Boolean(d.next_step_date && d.next_step_date < today),
    }))
    .sort((a, b) => (a.nextStepDate || "9999").localeCompare(b.nextStepDate || "9999"));
}

/** Paquete de la vista VENDER (kanban + tabla + embudo + loops en una carga). */
export interface VenderData {
  calendar: CalendarEntry[];
  attribution: unknown;
  shares: ShareStat[];
  deals: CrmDeal[];
  contacts: CrmContact[];
  brands: CrmBrand[];
}

export async function loadVender(workspaceId: string): Promise<VenderData> {
  const [calendar, attribution, shares, deals, contacts, brands] = await Promise.all([
    fetchCalendar(workspaceId),
    fetchAttribution(workspaceId).catch(() => null),
    fetchShares(workspaceId).catch(() => []),
    fetchDeals(workspaceId),
    fetchContacts(workspaceId),
    fetchBrands(workspaceId),
  ]);
  return { calendar, attribution, shares, deals, contacts, brands };
}
