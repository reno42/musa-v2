// apiV2/medir.ts — datos de la vista MEDIR del shell-v2.
// Endpoints reales: /api/metrics/activity, /api/storage/usage
import { getData } from "./client";
import { fetchActivity, type ActivityRange } from "./inicio";
import { fetchStorageUsage, type StorageUsage } from "./configuracion";

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
