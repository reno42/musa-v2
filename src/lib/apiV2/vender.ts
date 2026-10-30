// apiV2/vender.ts — datos de la vista VENDER del shell-v2.
// Endpoints reales: /api/content (calendario + attribution), /api/comments-share
import { getData } from "./client";

interface Envelope<T> { success: boolean; data: T; total?: number; error?: string }

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

/** Paquete de la vista VENDER. */
export interface VenderData {
  calendar: CalendarEntry[];
  attribution: unknown;
  shares: ShareStat[];
}

export async function loadVender(workspaceId: string): Promise<VenderData> {
  const [calendar, attribution, shares] = await Promise.all([
    fetchCalendar(workspaceId),
    fetchAttribution(workspaceId),
    fetchShares(workspaceId),
  ]);
  return { calendar, attribution, shares };
}
