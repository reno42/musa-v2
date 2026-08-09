import { store } from "./store.js";
import { getSupabase } from "./supabase.js";
import { slugify } from "./slugify.js";
import { v4 as uuid } from "uuid";
import type { DesignTemplate, CanvasData, LayerOverride } from "../types.js";

/** UUID v4 format (used to validate user_id before Supabase upsert) */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SupabaseTplRow = {
  id: string;
  name: string;
  workspace_id: string;
  data: DesignTemplate;
  user_id: string;
  created_at: string;
  updated_at: string;
};

function rowToTemplate(row: SupabaseTplRow): DesignTemplate {
  const data = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
  return {
    ...data,
    id: row.id,
    name: row.name,
    workspaceId: row.workspace_id,
    slug: (row as any).slug || null,
    isBrandManual: (row as any).is_brand_manual || false,
    metadata: {
      ...data.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  };
}

/**
 * Cap a thumbnail frame so a single huge frame (e.g. base64 images inlined
 * by batch generation) can't blow up the list payload. The dashboard falls
 * back to a placeholder card when html is empty.
 */
const THUMBNAIL_FRAME_BUDGET = 300_000;
function thumbnailFrame<T extends { html?: string; css?: string }>(frame: T): T {
  const size = (frame.html?.length || 0) + (frame.css?.length || 0);
  return size > THUMBNAIL_FRAME_BUDGET ? { ...frame, html: "", css: "" } : frame;
}

/**
 * Clone a template into a list summary: first frame only (thumbnail),
 * no canvas/versions/top-level html. Cloning matters — in-memory store
 * entries are returned by reference and must not be mutated by listings.
 */
function toListSummary(tpl: DesignTemplate): DesignTemplate {
  const first = tpl.frames?.[0];
  return {
    ...tpl,
    canvas: null,
    html: "",
    css: "",
    versions: [],
    frames: first ? [thumbnailFrame({ ...first })] : [],
  };
}

/** Race a Supabase query against a timeout so the Netlify Function doesn't hang. */
function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T | null> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

async function listFromSupabase(
  limit: number, offset: number, workspaceId?: string, search?: string
): Promise<{ data: DesignTemplate[]; total: number } | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    // Lean select: never pull the full `data` JSONB column when listing.
    // Postgres extracts the scalars and ONLY the first frame (dashboard
    // thumbnail) server-side. Pulling whole rows made the response grow
    // with every batch-generated design until Netlify answered 502.
    // slug column added by v7 migration — omit from SELECT if it doesn't exist yet
    const queryPromise = sb.from("templates")
      .select("id, name, workspace_id, created_at, updated_at, width:data->width, height:data->height, engine:data->>engine, thumbnail:data->>thumbnail, is_brand_manual, first_frame:data->frames->0", { count: "exact" })
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);

    // 6s timeout — leaves room for the Netlify Function to respond before its 10s limit
    const result = await withTimeout(queryPromise as any, 6000);
    if (!result) {
      console.warn("[templates] Supabase list timed out (6s) — returning empty");
      return null;
    }
    const { data, count, error } = result as any;
    if (error) throw error;
    let items = (data || []).map((r: any): DesignTemplate => ({
      id: r.id,
      name: r.name,
      slug: r.slug || null,
      workspaceId: r.workspace_id,
      width: Number(r.width) || 1080,
      height: Number(r.height) || 1080,
      engine: (r.engine as "html") || "html",
      canvas: null,
      thumbnail: r.thumbnail || null,
      isBrandManual: r.is_brand_manual || false,
      frames: r.first_frame ? [thumbnailFrame(r.first_frame)] : [],
      styles: [],
      comments: [],
      versions: [],
      variables: {} as DesignTemplate["variables"],
      components: [],
      metadata: {
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      } as DesignTemplate["metadata"],
    }));
    // Client-side filters (Supabase .eq on custom-format IDs may not match UUID columns)
    if (workspaceId) {
      items = items.filter((t: DesignTemplate) => t.workspaceId === workspaceId);
    }
    if (search) {
      items = items.filter((t: DesignTemplate) => t.name.toLowerCase().includes(search));
    }
    // Use filtered count when client-side filtering is active
    const total = (workspaceId || search) ? items.length : (count || items.length);
    return { data: items, total };
  } catch (e) {
    console.warn("[templates] Supabase list failed:", (e as Error).message);
    return null;
  }
}

async function getFromSupabase(id: string): Promise<DesignTemplate | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const queryPromise = sb.from("templates").select("*").eq("id", id).single();
    const result = await withTimeout(queryPromise as any, 6000);
    if (!result) {
      console.warn("[templates] Supabase get timed out (6s)");
      return null;
    }
    const { data, error } = result as any;
    if (error || !data) return null;
    const tpl = rowToTemplate(data as any);
    // Trim versions on read to avoid re-bloat (502 fix)
    if (tpl.versions && tpl.versions.length > 10) {
      tpl.versions = tpl.versions.slice(-10);
    }
    return tpl;
  } catch {
    return null;
  }
}

async function upsertSupabase(tpl: DesignTemplate, userId: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const row: Record<string, any> = {
      id: tpl.id,
      name: tpl.name,
      slug: tpl.slug || slugify(tpl.name),
      workspace_id: tpl.workspaceId || null,
      data: tpl,
      updated_at: new Date().toISOString(),
    };
    // Only include user_id if it's a valid UUID (column type is uuid with FK to auth.users)
    if (UUID_RE.test(userId)) {
      row.user_id = userId;
    }
    // 8s timeout — the data JSONB column can be several MB with inline images.
    // Without this, large payloads hang silently and Netlify returns 502.
    const upsertPromise = sb.from("templates").upsert(row);
    const result = await withTimeout(upsertPromise as any, 8000);
    if (!result) {
      console.error(`[templates] Supabase upsert TIMED OUT (8s) for template ${tpl.id}. Payload size: ${JSON.stringify(tpl).length} bytes. The design is in ephemeral memory only.`);
      return false;
    }
    const { error } = result as any;
    if (error) {
      // slug column added by v7 migration — retry without it if missing
      if (error.message?.includes("slug") && error.message?.includes("does not exist")) {
        delete row.slug;
        const retryResult = await withTimeout(sb.from("templates").upsert(row) as any, 8000);
        if (!retryResult) {
          console.error(`[templates] Supabase upsert retry TIMED OUT (8s) for template ${tpl.id}`);
          return false;
        }
        const { error: err2 } = retryResult as any;
        if (err2) {
          console.error(`[templates] Supabase upsert failed (retry): ${err2.message}. Template: ${tpl.id}`);
          return false;
        }
        return true;
      }
      console.error(`[templates] Supabase upsert failed: ${error.message}. Template: ${tpl.id}, Payload size: ${JSON.stringify(tpl).length} bytes`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[templates] Supabase upsert exception: ${(e as Error).message}. Template: ${tpl.id}`);
    return false;
  }
}

async function deleteFromSupabase(id: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    // Soft-delete: set deleted_at column. .select() reports whether a row matched
    // — needed because serverless invocations have an empty in-memory store.
    const { data, error } = await sb.from("templates")
      .update({ deleted_at: new Date().toISOString() }).eq("id", id).select("id");
    if (error) throw error;
    return (data?.length || 0) > 0;
  } catch (e) {
    console.warn("[templates] Supabase soft-delete failed:", (e as Error).message);
    return false;
  }
}

async function restoreSupabase(id: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const { data, error } = await sb.from("templates")
      .update({ deleted_at: null }).eq("id", id).select("id");
    if (error) throw error;
    return (data?.length || 0) > 0;
  } catch (e) {
    console.warn("[templates] Supabase restore failed:", (e as Error).message);
    return false;
  }
}

async function purgeFromSupabase(id: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const { data, error } = await sb.from("templates").delete().eq("id", id).select("id");
    if (error) throw error;
    return (data?.length || 0) > 0;
  } catch (e) {
    console.warn("[templates] Supabase purge failed:", (e as Error).message);
    return false;
  }
}

async function listTrashFromSupabase(limit: number, offset: number): Promise<{ data: DesignTemplate[]; total: number } | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    // Lean select — NEVER pull the data JSONB here: old trashed templates can
    // hold megabytes of base64 and blow Netlify's 6MB response cap (502).
    const queryPromise = sb.from("templates")
      .select("id, name, workspace_id, created_at, updated_at, deleted_at", { count: "exact" })
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .range(offset, offset + limit - 1);
    const result = await withTimeout(queryPromise as any, 6000);
    if (!result) return null;
    const { data, count, error } = result as any;
    if (error) throw error;
    const items = (data || []).map((r: any) => ({
      id: r.id,
      name: r.name,
      workspaceId: r.workspace_id,
      width: 1080,
      height: 1080,
      engine: "html" as const,
      canvas: null,
      frames: [],
      styles: [],
      comments: [],
      versions: [],
      variables: { collections: [], variables: [], bindings: {} } as DesignTemplate["variables"],
      components: [],
      metadata: {
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        deletedAt: r.deleted_at,
      },
      // Top-level fields the Trash UI reads directly
      createdAt: r.created_at,
      deletedAt: r.deleted_at,
    } as any));
    return { data: items, total: count || items.length };
  } catch {
    return null;
  }
}

/**
 * Generate a simple SVG placeholder thumbnail from frame metadata.
 * Produces a lightweight data:image/svg+xml URI so the dashboard
 * always has something to show. Real PNGs replace these via the
 * browser-side handleSnapshotAll → update_thumbnail flow.
 */
function generatePlaceholderThumbnail(
  name: string, width: number, height: number, background?: string
): string {
  const bg = background || "#0d0d1a";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="${bg}"/>
  <text x="50%" y="45%" text-anchor="middle" fill="rgba(255,255,255,0.15)" font-family="sans-serif" font-size="${Math.max(14, Math.round(width / 15))}px">${escapeXml(name)}</text>
  <text x="50%" y="58%" text-anchor="middle" fill="rgba(255,255,255,0.08)" font-family="sans-serif" font-size="${Math.max(10, Math.round(width / 30))}px">${width}×${height}</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Ensure a template has a thumbnail. Generate one from the first frame if missing. */
function ensureThumbnail(tpl: DesignTemplate): DesignTemplate {
  if (tpl.thumbnail) return tpl;
  const first = tpl.frames?.[0];
  if (first?.html) {
    // Extract background from first frame or CSS
    let bg = (first as any).background || first.fill || "#0d0d1a";
    const css = first.css || tpl.css || "";
    const bgMatch = css.match(/body\s*\{[^}]*background(?:-color)?\s*:\s*([^;}]+)[;}]/i)
      || css.match(/background(?:-color)?\s*:\s*([^;}]+)[;}]/i);
    if (bgMatch) bg = bgMatch[1].trim();
    tpl.thumbnail = generatePlaceholderThumbnail(tpl.name, tpl.width, tpl.height, bg);
  }
  return tpl;
}

export async function createTemplate(
  name: string, width: number, height: number,
  _canvas: CanvasData | undefined, userId: string, workspaceId: string
): Promise<DesignTemplate> {
  const tpl = store.createTemplate({ workspaceId, name, width, height, userId });
  const persisted = await upsertSupabase(tpl, userId);
  if (getSupabase() && !persisted) {
    store.purgeTemplate(tpl.id);
    throw new Error("Template could not be persisted");
  }
  return tpl;
}

export async function getTemplate(id: string): Promise<DesignTemplate | null> {
  const fromSb = await getFromSupabase(id);
  if (fromSb) {
    store.updateTemplate(id, fromSb);
    return fromSb;
  }
  return store.getTemplate(id) || null;
}

export async function listTemplatesPaginated(
  limit: number, offset: number, workspaceId?: string, search?: string
): Promise<{ data: DesignTemplate[]; total: number }> {
  const fromSb = await listFromSupabase(limit, offset, workspaceId, search);
  const fromStore = store.listTemplates(workspaceId, 99999, 0);

  // Merge Supabase + in-memory store, deduping by ID (store takes precedence).
  // Everything is reduced to a list summary (first frame only) so the response
  // stays small no matter how many heavy designs exist.
  const merged = new Map<string, DesignTemplate>();
  if (fromSb) {
    for (const t of fromSb.data) merged.set(t.id, t); // already lean from the DB
  }
  for (const t of fromStore.data) {
    merged.set(t.id, toListSummary(t)); // store overrides Supabase for same ID
  }

  let data = [...merged.values()];

  // Apply search filter (workspaceId already filtered by both sources)
  if (search) {
    data = data.filter(t => t.name.toLowerCase().includes(search));
  }

  data.sort((a, b) =>
    new Date(b.metadata.updatedAt).getTime() - new Date(a.metadata.updatedAt).getTime()
  );

  const total = data.length;
  data = data.slice(offset, offset + limit);
  return { data, total };
}

/**
 * Renaming used to go the long way round: read the whole design out of
 * Supabase, set one string, write the whole design back. On a heavy file that
 * upsert is megabytes of `data` JSONB and can exceed the 8s guard, at which
 * point updateTemplate answers null, the route 404s, and a rename that touched
 * nothing but a title looks like it silently did nothing.
 *
 * `name` is a real column and rowToTemplate reads it from the column, never
 * from data.name — so the column alone is the source of truth and a targeted
 * UPDATE is both correct and cheap. Returns null when it can't take this path.
 */
async function renameInSupabase(id: string, name: string): Promise<DesignTemplate | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    // slug is deliberately left alone: it is the file's stable URL, and the
    // upsert path has always kept an existing one across renames too.
    const patch = { name, updated_at: new Date().toISOString() };
    const result = await withTimeout(
      sb.from("templates").update(patch).eq("id", id).select("*").single() as any, 8000,
    );
    if (!result) {
      console.warn(`[templates] rename timed out (8s) for ${id}`);
      return null;
    }
    const { data, error } = result as any;
    if (error || !data) return null;
    const tpl = rowToTemplate(data);
    store.updateTemplate(id, { name } as any);
    return tpl;
  } catch {
    return null;
  }
}

export async function updateTemplate(
  id: string, updates: Partial<DesignTemplate> & Record<string, any>
): Promise<DesignTemplate | null> {
  // A rename on its own never needs the design blob rewritten.
  const touched = Object.keys(updates).filter(k => k !== "userId");
  if (touched.length === 1 && touched[0] === "name" && typeof updates.name === "string") {
    const renamed = await renameInSupabase(id, updates.name);
    if (renamed) return renamed;
  }

  let tpl = store.updateTemplate(id, updates);
  if (!tpl) {
    // Stateless Netlify edge: load from Supabase if not in memory
    const fromDb = await getFromSupabase(id);
    if (!fromDb) return null;
    // Apply updates and write back to in-memory store
    Object.assign(fromDb, updates);
    store.updateTemplate(id, fromDb);
    tpl = fromDb;
  }
  if (tpl) {
    // Auto-generate thumbnail from first frame if missing (pipeline)
    ensureThumbnail(tpl);
    const persisted = await upsertSupabase(tpl, updates.userId || (tpl as any).metadata?.createdBy || "dev_user_default");
    // Only treat a failed upsert as fatal when Supabase IS configured — local
    // dev runs memory-only by design, and failing here made every PUT answer
    // 404 "Template not found" for a template that exists.
    if (!persisted && getSupabase()) {
      console.error("[templates] Supabase upsert failed for template", id, "— data only in ephemeral memory, will vanish on cold start");
      return null;
    }
  }
  return tpl || null;
}

export async function deleteTemplate(id: string): Promise<boolean> {
  const sbOk = await deleteFromSupabase(id);
  const storeOk = store.deleteTemplate(id);
  // Either source succeeding counts: serverless invocations start with an
  // empty in-memory store, so Supabase is often the only one that knows the row.
  return sbOk || storeOk;
}

export async function restoreTemplate(id: string): Promise<boolean> {
  const sbOk = await restoreSupabase(id);
  const storeOk = store.restoreTemplate(id);
  return sbOk || storeOk;
}

export async function purgeTemplate(id: string): Promise<boolean> {
  const sbOk = await purgeFromSupabase(id);
  const storeOk = store.purgeTemplate(id);
  return sbOk || storeOk;
}

export async function listTrash(limit = 50, offset = 0): Promise<{ data: DesignTemplate[]; total: number }> {
  const fromSb = await listTrashFromSupabase(limit, offset);
  const fromStore = store.listTrash();
  const merged = new Map<string, DesignTemplate>();
  if (fromSb) for (const t of fromSb.data) merged.set(t.id, t);
  for (const t of fromStore) merged.set(t.id, t);
  const data = [...merged.values()];
  const total = data.length;
  return { data: data.slice(offset, offset + limit), total };
}

export async function purgeExpiredTemplates(olderThanDays = 30, workspaceId?: string): Promise<number> {
  const count = store.purgeExpiredTemplates(olderThanDays, workspaceId);
  // Also purge from Supabase
  const sb = getSupabase();
  if (sb) {
    const cutoff = new Date(Date.now() - olderThanDays * 86400000).toISOString();
    try {
      let query = sb.from("templates").delete().lt("deleted_at", cutoff);
      if (workspaceId) query = query.eq("workspace_id", workspaceId);
      await query;
    } catch { /* best-effort */ }
  }
  return count;
}

export async function duplicateTemplate(
  id: string, newName?: string, userId?: string
): Promise<DesignTemplate | null> {
  const source = await getTemplate(id);
  if (!source) return null;

  const uid = userId || "dev_user_default";
  const copy = store.createTemplate({
    workspaceId: source.workspaceId,
    name: newName || `${source.name} (copy)`,
    width: source.width,
    height: source.height,
    userId: uid,
  });

  copy.frames = source.frames.map(f => ({
    ...JSON.parse(JSON.stringify(f)),
    id: `frame_${uuid().slice(0, 12)}`,
    templateId: copy.id,
  }));

  store.updateTemplate(copy.id, copy);
  await upsertSupabase(copy, uid);
  return copy;
}

export async function applyLayerOverrides(
  templateId: string, overrides: Record<string, LayerOverride>
): Promise<DesignTemplate | null> {
  const tpl = store.getTemplate(templateId);
  if (!tpl) return null;

  const applyToObjects = (objs: any[]) => {
    for (const obj of objs) {
      const name = obj.layerName || obj.name;
      if (name && overrides[name]) {
        Object.assign(obj, overrides[name]);
      }
      if (obj.objects && Array.isArray(obj.objects)) {
        applyToObjects(obj.objects);
      }
    }
  };

  for (const frame of tpl.frames) {
    applyToObjects(frame.objects);
  }

  tpl.metadata.updatedAt = new Date().toISOString();
  return tpl;
}
