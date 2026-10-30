// apiV2/medir.ts — datos de la vista MEDIR del shell-v2.
// Endpoints reales: /api/metrics/activity, /api/storage/usage, y derivados
// de crm_deals (vender.ts) para embudos y loops.
import { getData } from "./client";
import { fetchActivity, type ActivityRange } from "./inicio";
import { fetchStorageUsage, type StorageUsage } from "./configuracion";
import { buildFunnel, fetchDeals, type CrmDeal, type FunnelStage } from "./vender";
import { fetchCampaigns, type Campaign } from "./anunciar";

export { fetchActivity, type ActivityRange };

export interface MedirData {
  activity: ActivityRange;
  storage: StorageUsage;
}

export async function loadMedir(workspaceId: string, days = 30): Promise<MedirData> {
  const [activity, storage] = await Promise.all([
    fetchActivity(days, workspaceId),
    fetchStorageUsage(workspaceId),
  ]);
  return { activity, storage };
}

/** Serie lista para graficar: la vista no hace agregaciones. */
export interface SeriesPoint { date: string; value: number }

type DayKey = "designOps" | "framesCreated" | "templatesCreated";

export function toSeries(days: ActivityRange["days"], key: DayKey): SeriesPoint[] {
  return days.map((d) => ({ date: d.date, value: Number(d[key] ?? 0) }));
}

// ── medir/embudos: pipeline CRM + actividad del periodo ──

/** Embudo real (por stage de crm_deals) + totales de actividad del rango. */
export interface FunnelTrends {
  funnel: FunnelStage[];
  totales: { designOps: number; framesCreated: number; templatesCreated: number; deals: number };
}

export async function buildFunnelTrends(workspaceId: string, days = 30): Promise<FunnelTrends> {
  const [activity, deals] = await Promise.all([
    fetchActivity(days, workspaceId),
    fetchDeals(workspaceId),
  ]);
  return {
    funnel: buildFunnel(deals),
    totales: {
      designOps: activity.totals.designOps,
      framesCreated: activity.totals.framesCreated,
      templatesCreated: activity.totals.templatesCreated,
      deals: deals.length,
    },
  };
}

// ── F3: medir/ads — presupuesto y resultado por campaña (fuentes reales) ──

export interface AdsRow {
  campaignName: string;
  status: string | null;
  budgetPlanUsd: number;
  resultadoUsd: number;
}

/** Ads reales: campaigns del workspace + deals asociados por campaign_id. */
export async function fetchAdsRows(workspaceId: string): Promise<AdsRow[]> {
  const [campaigns, deals] = await Promise.all([
    fetchCampaigns(workspaceId),
    fetchDeals(workspaceId),
  ]);
  const valueByCampaign = new Map<string, number>();
  for (const d of deals as (CrmDeal & { campaign_id?: string | null })[]) {
    if (!d.campaign_id) continue;
    valueByCampaign.set(d.campaign_id, (valueByCampaign.get(d.campaign_id) || 0) + Number(d.final_value ?? d.value ?? 0));
  }
  return campaigns.map((c: Campaign) => ({
    campaignName: c.name,
    status: c.status ?? null,
    budgetPlanUsd: Number((c as Campaign & { budget_plan_usd?: number }).budget_plan_usd ?? 0),
    resultadoUsd: Math.round(valueByCampaign.get(c.id) || 0),
  }));
}

/** medir/embudos: trends de deals + actividad combinados (fuente real hoy). */
export interface EmbudoTrendPoint { date: string; designOps: number; framesCreated: number }

export function buildEmbudoTrends(days: ActivityRange["days"]): EmbudoTrendPoint[] {
  return days.map((d) => ({
    date: d.date,
    designOps: d.designOps,
    framesCreated: d.framesCreated,
  }));
}
