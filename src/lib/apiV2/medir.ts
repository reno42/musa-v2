// apiV2/medir.ts — datos de la vista MEDIR del shell-v2.
// Endpoints reales: /api/metrics/activity, /api/storage/usage, y derivados
// de crm_deals (vender.ts) para embudos y loops.
import { getData } from "./client";
import { fetchActivity, type ActivityRange } from "./inicio";
import { fetchStorageUsage, type StorageUsage } from "./configuracion";
import { buildFunnel, buildLoops, fetchDeals, type FunnelStage, type LoopItem } from "./vender";

export { fetchActivity, type ActivityRange };

// F5: envelope para el refactor en curso de fetchAdsRows (GET /api/metrics/ads)
// — sin él el árbol no compila (TS2304). Mismo patrón privado que
// organizacion.ts/configuracion.ts. Si mueves Envelope a client.ts, borra esta.
interface Envelope<T> { success: boolean; data: T; total?: number; error?: string }

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

// ── medir/loops: reutiliza el builder de vender.ts (misma fuente crm_deals) ──

export { buildLoops, type LoopItem };

export async function loadLoops(workspaceId: string): Promise<LoopItem[]> {
  return buildLoops(await fetchDeals(workspaceId));
}

// ── F3: medir/ads — presupuesto y resultado por campaña (fuentes reales) ──

export interface AdsRow {
  campaignName: string;
  status: string | null;
  budgetPlanUsd: number;
  resultadoUsd: number;
}

/** Ads reales: join campaigns x deals SERVIDO en GET /api/metrics/ads (F5).
 *  El cliente ya no descarga campañas ni deals completos: una llamada. */
export async function fetchAdsRows(workspaceId: string): Promise<AdsRow[]> {
  const res = await getData<Envelope<AdsRow[]>>(
    `/api/metrics/ads?workspaceId=${encodeURIComponent(workspaceId)}`
  );
  if (!res.success) throw new Error(res.error || "ads metrics failed");
  return res.data;
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
