import { getSupabase, getSupabaseAdmin } from "./supabase.js";

// ═══════════════════════════════════════════════════════════════
// Segmentation job plumbing — shared by the REST route
// (routes/segmentation.ts) and the MCP tools (netlify/functions/mcp.mjs,
// which imports this file through the same ".js" esbuild bridge as the
// other api/src services). Inference itself never runs here: this module
// only inserts a queued `segment_jobs` row, dispatches the
// image-segment-background Netlify BACKGROUND function (immediate 202)
// and polls the row. Zero LLM tokens anywhere in the pipeline.
// ═══════════════════════════════════════════════════════════════

const SITE_URL = (process.env.URL || process.env.DEPLOY_URL || "https://design.futuraria.com").replace(/\/$/, "");
const SEGMENT_SECRET = process.env.SEGMENT_SECRET || process.env.MUSA_BATCH_SECRET || "";
const BACKGROUND_PATH = "/.netlify/functions/image-segment-background";

export function newSegmentJobId(): string {
  return `seg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface SegmentJobRow {
  id: string;
  workspace_id: string | null;
  kind: string;
  status: "queued" | "running" | "done" | "error";
  input_url: string | null;
  params_json: Record<string, unknown>;
  result_json: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Idempotency for remove_background: a cutout already derived from
 * `srcAssetId` in this workspace is returned instead of re-processing.
 * The cutout row carries tags ["cutout", "src:<id>"] and the companion
 * mask row ["mask", "src:<id>"] (tags have a GIN index, musa_segment.sql).
 */
export async function findExistingCutout(workspaceId: string, srcAssetId: string) {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.from("assets")
    .select("id, name, url, tags, workspace_id")
    .eq("workspace_id", workspaceId)
    .contains("tags", ["cutout", `src:${srcAssetId}`])
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  const cutout = data[0] as { id: string; name: string; url: string; tags: string[] };
  const { data: maskRows } = await sb.from("assets")
    .select("id, url")
    .eq("workspace_id", workspaceId)
    .contains("tags", ["mask", `src:${srcAssetId}`])
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  return {
    cutoutAssetId: cutout.id,
    cutoutUrl: cutout.url,
    cutoutName: cutout.name,
    maskAssetId: maskRows?.[0]?.id || null,
    maskUrl: maskRows?.[0]?.url || null,
  };
}

/** Insert a queued segment_jobs row (service-role: the table has RLS and no policies). */
export async function createSegmentJob(
  kind: string,
  inputUrl: string,
  workspaceId: string,
  params: Record<string, unknown> = {},
): Promise<SegmentJobRow> {
  const sb = getSupabaseAdmin();
  if (!sb) throw new Error("Supabase (service role) not configured — segment jobs need the segment_jobs table");
  const id = newSegmentJobId();
  const { data, error } = await sb.from("segment_jobs").insert({
    id,
    workspace_id: workspaceId,
    kind,
    status: "queued",
    input_url: inputUrl,
    params_json: params,
  }).select().single();
  if (error) throw new Error("Segment job insert failed: " + error.message);
  return data as SegmentJobRow;
}

/**
 * Dispatch the background function for a job. Netlify answers 202
 * immediately (invocation queued; the pipeline runs up to 15 min), so
 * this fetch finishes in well under a second. Any other status means the
 * dispatch failed — the job row stays queued and the background function's
 * own sweep (every invocation sweeps orphaned queued jobs) heals it.
 */
export async function dispatchSegmentJob(jobId: string): Promise<{ dispatched: boolean; dispatchStatus: number; error?: string }> {
  const url = `${SITE_URL}${BACKGROUND_PATH}?jobId=${encodeURIComponent(jobId)}`;
  const headers: Record<string, string> = {};
  if (SEGMENT_SECRET) headers["x-batch-secret"] = SEGMENT_SECRET;
  try {
    const res = await fetch(url, { method: "POST", headers, signal: AbortSignal.timeout(5000) });
    try { await res.arrayBuffer(); } catch { /* drain */ }
    if (res.status === 202) return { dispatched: true, dispatchStatus: 202 };
    let detail = "";
    try { detail = (await res.text().catch(() => "")).slice(0, 300); } catch { /* keep raw */ }
    return { dispatched: false, dispatchStatus: res.status, error: `image-segment-background respondió HTTP ${res.status}${detail ? `: ${detail}` : ""}` };
  } catch (e: any) {
    return { dispatched: false, dispatchStatus: 0, error: "No se pudo invocar image-segment-background: " + (e?.message || e) };
  }
}

/** Read one job row (service-role). */
export async function getSegmentJob(jobId: string): Promise<SegmentJobRow | null> {
  const sb = getSupabaseAdmin();
  if (!sb) return null;
  const { data, error } = await sb.from("segment_jobs")
    .select("id, workspace_id, kind, status, input_url, params_json, result_json, error, created_at, updated_at")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error("Segment job read failed: " + error.message);
  return (data as SegmentJobRow) || null;
}
