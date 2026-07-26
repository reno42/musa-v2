import { gzipSync, gunzipSync } from "node:zlib";
import { getSupabase } from "./supabase.js";
import { getTemplate, updateTemplate } from "./templates.js";
import type { DesignTemplate } from "../types.js";
import { compareFrameSets, hashFrameContent, type FrameDiff, type VersionFrame } from "./versionDiff.js";
import { legacyVersionDataToPayload } from "./versionPayload.js";

// Re-exported so callers have one import site for the whole feature.
export { compareFrameSets, hashFrameContent };
export type { FrameDiff, VersionFrame, FrameDiffStatus } from "./versionDiff.js";

/**
 * Version history — hybrid storage.
 *
 * Metadata (who, when, which frames changed) lives in the `template_versions`
 * table; the payload (every frame's html/css) is a gzipped JSON file in the
 * `design-versions` bucket. Keeping payloads out of templates.data is what
 * makes this affordable: opening a design no longer downloads its history,
 * and history bytes land in the 1GB storage budget instead of the 500MB
 * database one — roughly 3x more designs on the free tier.
 *
 * Two kinds of version:
 *   'auto'   — written by a save; only the newest AUTO_RETENTION survive.
 *   'marked' — written by Ctrl/Cmd+S or the Save button; never auto-deleted.
 */

const BUCKET = "design-versions";
const AUTO_RETENTION = 10;

// ── In-memory fallback for local dev without Supabase ──
const memVersions = new Map<string, { meta: VersionMeta; payload: VersionPayload }>();
let memVersionSeq = 0;
function memVersionId(): string { memVersionSeq++; return `local-${Date.now().toString(36)}-${memVersionSeq}`; }

export interface VersionMeta {
  id: string;
  templateId: string;
  kind: "auto" | "marked";
  label: string | null;
  author: string;
  frameHashes: Record<string, string>;
  frameCount: number;
  sizeBytes: number;
  createdAt: string;
}

export interface VersionPayload {
  frames: VersionFrame[];
  canvasObjects?: unknown[];
  templateName?: string;
}

function rowToMeta(row: any): VersionMeta {
  return {
    id: row.id,
    templateId: row.template_id,
    kind: row.kind === "auto" ? "auto" : "marked",
    label: row.label ?? row.message ?? null,
    author: row.author ?? "unknown",
    frameHashes: row.frame_hashes ?? {},
    frameCount: row.frame_count ?? 0,
    sizeBytes: row.size_bytes ?? 0,
    createdAt: row.created_at,
  };
}

/**
 * Snapshot a template's current state as a new version.
 * Returns null when Supabase is not configured (local dev runs history-less).
 */
export async function createVersion(
  templateId: string,
  options: {
    kind?: "auto" | "marked";
    label?: string;
    author?: string;
    /** Skip when a version of the same kind is younger than this (auto-save throttle). */
    minIntervalMs?: number;
  } = {},
): Promise<VersionMeta | null> {
  const sb = getSupabase();

  const kindWanted = options.kind === "marked" ? "marked" : "auto";

  const tpl = await getTemplate(templateId);
  if (!tpl) return null;

  const frames = (tpl.frames || []) as unknown as VersionFrame[];
  const payload: VersionPayload = {
    frames,
    canvasObjects: (tpl as any).canvasObjects ?? [],
    templateName: tpl.name,
  };
  const frameHashes: Record<string, string> = {};
  for (const frame of frames) {
    frameHashes[frame.id] = hashFrameContent(String(frame.html || ""), String(frame.css || ""));
  }

  // ── In-memory fallback when Supabase isn't configured ──
  if (!sb) {
    const kind = kindWanted;
    const id = memVersionId();
    const meta: VersionMeta = {
      id,
      templateId,
      kind,
      label: options.label ?? null,
      author: options.author || "unknown",
      frameHashes,
      frameCount: frames.length,
      sizeBytes: JSON.stringify(payload).length,
      createdAt: new Date().toISOString(),
    };
    memVersions.set(id, { meta, payload });
    // Prune auto versions in memory
    if (kind === "auto") {
      const autoVersions = [...memVersions.entries()]
        .filter(([, v]) => v.meta.templateId === templateId && v.meta.kind === "auto")
        .sort((a, b) => b[1].meta.createdAt.localeCompare(a[1].meta.createdAt));
      for (const [vid] of autoVersions.slice(AUTO_RETENTION)) memVersions.delete(vid);
    }
    return meta;
  }

  if (options.minIntervalMs) {
    const { data: newest } = await sb.from("template_versions")
      .select("created_at")
      .eq("template_id", templateId)
      .eq("kind", kindWanted)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (newest?.created_at
      && Date.now() - new Date(newest.created_at).getTime() < options.minIntervalMs) {
      return null;
    }
  }

  const kind = kindWanted;
  // gzip typically shrinks HTML/CSS 4-6x — the difference between ~2,500 and
  // ~7,000 designs fitting in the free tier's storage budget.
  const body = gzipSync(Buffer.from(JSON.stringify(payload), "utf8"));

  const { data: inserted, error } = await sb.from("template_versions").insert({
    template_id: templateId,
    workspace_id: (tpl as any).workspaceId || null,
    kind,
    label: options.label ?? null,
    author: options.author || "unknown",
    frame_hashes: frameHashes,
    frame_count: frames.length,
    size_bytes: body.length,
    // Placeholder: the real path needs the generated id, patched right after.
    storage_path: "pending",
  }).select("*").single();
  if (error || !inserted) {
    console.warn("[versions] insert failed:", error?.message);
    return null;
  }

  const storagePath = `${templateId}/${inserted.id}.json.gz`;
  const { error: upErr } = await sb.storage.from(BUCKET).upload(storagePath, body, {
    contentType: "application/gzip",
    upsert: true,
  });
  if (upErr) {
    // Never leave a metadata row pointing at a file that does not exist.
    await sb.from("template_versions").delete().eq("id", inserted.id);
    console.warn("[versions] upload failed:", upErr.message);
    return null;
  }
  await sb.from("template_versions").update({ storage_path: storagePath }).eq("id", inserted.id);

  if (kind === "auto") await pruneAutoVersions(templateId);

  return rowToMeta({ ...inserted, storage_path: storagePath });
}

/** Drop the oldest 'auto' versions past the retention window, files included. */
export async function pruneAutoVersions(templateId: string, keep = AUTO_RETENTION): Promise<number> {
  const sb = getSupabase();
  if (!sb) return 0;
  const { data } = await sb.from("template_versions")
    .select("id, storage_path")
    .eq("template_id", templateId)
    .eq("kind", "auto")
    .order("created_at", { ascending: false });
  const stale = (data || []).slice(keep);
  if (stale.length === 0) return 0;
  await sb.storage.from(BUCKET).remove(stale.map((row: any) => row.storage_path).filter(Boolean));
  await sb.from("template_versions").delete().in("id", stale.map((row: any) => row.id));
  return stale.length;
}

export async function listVersions(templateId: string, limit = 50): Promise<VersionMeta[]> {
  const sb = getSupabase();
  if (!sb) {
    return [...memVersions.values()]
      .filter(v => v.meta.templateId === templateId)
      .sort((a, b) => b.meta.createdAt.localeCompare(a.meta.createdAt))
      .slice(0, limit)
      .map(v => v.meta);
  }
  const { data, error } = await sb.from("template_versions")
    .select("*")
    .eq("template_id", templateId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.warn("[versions] list failed:", error.message);
    return [];
  }
  return (data || []).map(rowToMeta);
}

export async function getVersionMeta(versionId: string): Promise<VersionMeta | null> {
  const sb = getSupabase();
  if (!sb) return memVersions.get(versionId)?.meta ?? null;
  const { data } = await sb.from("template_versions").select("*").eq("id", versionId).maybeSingle();
  return data ? rowToMeta(data) : null;
}

/** Download and inflate one version's frames. */
export async function getVersionPayload(versionId: string): Promise<VersionPayload | null> {
  const sb = getSupabase();
  if (!sb) return memVersions.get(versionId)?.payload ?? null;
  const { data: row } = await sb.from("template_versions")
    .select("storage_path, data").eq("id", versionId).maybeSingle();
  if (!row) return null;
  if (row.storage_path) {
    const { data: file, error } = await sb.storage.from(BUCKET).download(row.storage_path);
    if (!error && file) {
      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        return JSON.parse(gunzipSync(buffer).toString("utf8")) as VersionPayload;
      } catch (e) {
        console.warn("[versions] inflate failed:", (e as Error).message);
      }
    } else {
      console.warn("[versions] download failed:", error?.message);
    }
  }
  return legacyVersionDataToPayload(row.data);
}

/**
 * Restore a design to a stored version. The current state is snapshotted as a
 * 'marked' version first, so restoring is itself undoable.
 */
export async function restoreVersion(
  templateId: string,
  versionId: string,
  author = "unknown",
): Promise<DesignTemplate | null> {
  const payload = await getVersionPayload(versionId);
  if (!payload?.frames) return null;

  await createVersion(templateId, {
    kind: "marked",
    label: `Antes de restaurar`,
    author,
  });

  const updates: Record<string, unknown> = { frames: payload.frames };
  if (payload.canvasObjects) updates.canvasObjects = payload.canvasObjects;
  // Keep the flat html/css mirrors in step with the active frame.
  const first = payload.frames[0];
  if (first) {
    updates.html = String(first.html || "");
    updates.css = String(first.css || "");
  }
  return updateTemplate(templateId, updates as any);
}

export async function deleteVersion(versionId: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) { memVersions.delete(versionId); return true; }
  const { data: row } = await sb.from("template_versions")
    .select("storage_path").eq("id", versionId).maybeSingle();
  if (row?.storage_path) await sb.storage.from(BUCKET).remove([row.storage_path]);
  const { error } = await sb.from("template_versions").delete().eq("id", versionId);
  return !error;
}

/** Remove every version of a design — used when a template is purged. */
export async function deleteAllVersions(templateId: string): Promise<number> {
  const sb = getSupabase();
  if (!sb) return 0;
  const { data } = await sb.from("template_versions")
    .select("id, storage_path").eq("template_id", templateId);
  const rows = data || [];
  if (rows.length === 0) return 0;
  await sb.storage.from(BUCKET).remove(rows.map((r: any) => r.storage_path).filter(Boolean));
  await sb.from("template_versions").delete().eq("template_id", templateId);
  return rows.length;
}

/**
 * Per-frame comparison between two stored versions (or a version and the live
 * design when `toVersionId` is omitted). This is the half the agents were
 * missing: `get_frame_changes` said THAT a frame changed, never WHAT changed.
 */
export async function diffVersions(
  templateId: string,
  fromVersionId: string,
  toVersionId?: string,
  frameId?: string,
): Promise<{
  from: VersionMeta | null;
  to: VersionMeta | { id: "current"; author: string; createdAt: string } | null;
  frames: FrameDiff[];
} | null> {
  const fromPayload = await getVersionPayload(fromVersionId);
  if (!fromPayload) return null;

  let toPayload: VersionPayload | null;
  let toMeta: VersionMeta | { id: "current"; author: string; createdAt: string } | null;
  if (toVersionId) {
    toPayload = await getVersionPayload(toVersionId);
    toMeta = await getVersionMeta(toVersionId);
  } else {
    const tpl = await getTemplate(templateId);
    if (!tpl) return null;
    toPayload = { frames: (tpl.frames || []) as unknown as VersionFrame[] };
    toMeta = { id: "current", author: "current", createdAt: new Date().toISOString() };
  }
  if (!toPayload) return null;

  const frames = compareFrameSets(fromPayload.frames, toPayload.frames, frameId);
  return { from: await getVersionMeta(fromVersionId), to: toMeta, frames };
}
