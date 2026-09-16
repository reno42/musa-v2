import { Router } from "express";
import { getSupabase } from "../services/supabase.js";
import { requireWorkspaceRole } from "../services/tenancy.js";

export const storageRoutes = Router();

const KNOWN_BUCKETS = ["design-assets", "design-covers", "design-exports"] as const;

/** REQ-VID8: PUBLIC bucket for rendered reels — Zernio's publish_content
 *  needs a stable HTTPS mediaUrl, so signed URLs are not enough here. */
const REEL_BUCKET = "design-reels";

interface StorageFile {
  bucket: string;
  path: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  updatedAt: string | null;
  url: string;
}

/**
 * List real objects in a Storage bucket, one folder level deep (our buckets
 * use flat {folder}/{file} layouts: workspace ids, "covers", "thumbnails").
 */
async function listBucketFiles(sb: any, bucket: string, workspaceId: string, maxFiles = 400): Promise<StorageFile[]> {
  const baseUrl = process.env.SUPABASE_URL || "";

  // Phase 1: walk the folders and collect what is there. No signing yet.
  //
  // This used to sign each file as it was found — an awaited network round
  // trip per object, inside a sequential loop. Four hundred files meant four
  // hundred serial requests, which is why opening the Papelera took half a
  // minute. Listing is cheap; signing is what costs, so it is worth doing
  // separately and in bulk.
  const found: Array<{ path: string; item: any }> = [];
  const { data: root, error } = await sb.storage.from(bucket)
    .list(workspaceId, { limit: 100, sortBy: { column: "updated_at", order: "desc" } });
  if (error || !root) return [];

  // Folders are listed together rather than one after another: they are
  // independent, and waiting for each in turn is latency spent for nothing.
  const folders = root.filter((item: any) => !item.id);
  const folderContents = await Promise.all(folders.map((folder: any) =>
    sb.storage.from(bucket)
      .list(`${workspaceId}/${folder.name}`, { limit: 200, sortBy: { column: "updated_at", order: "desc" } })
      .then((r: any) => ({ folder: folder.name, children: r.data || [] }))
      .catch(() => ({ folder: folder.name, children: [] as any[] }))));

  for (const item of root) {
    if (found.length >= maxFiles) break;
    if (item.id) found.push({ path: `${workspaceId}/${item.name}`, item });
  }
  for (const { folder, children } of folderContents) {
    for (const child of children) {
      if (found.length >= maxFiles) break;
      if (child.id) found.push({ path: `${workspaceId}/${folder}/${child.name}`, item: child });
    }
  }
  if (found.length === 0) return [];

  // Phase 2: one signing call for every path, instead of one per path.
  let signed = new Map<string, string>();
  try {
    const { data } = await sb.storage.from(bucket)
      .createSignedUrls(found.map(f => f.path), 3600);
    for (const entry of data || []) {
      if (entry?.path && entry?.signedUrl) signed.set(entry.path, entry.signedUrl);
    }
  } catch {
    // An unsigned URL still identifies the object, and the list is more
    // useful than a failure — the row just cannot be previewed.
    signed = new Map();
  }

  return found.map(({ path, item }) => ({
    bucket,
    path,
    name: item.name,
    sizeBytes: item.metadata?.size || 0,
    mimeType: item.metadata?.mimetype || "application/octet-stream",
    updatedAt: item.updated_at || item.created_at || null,
    url: signed.get(path) || `${baseUrl}/storage/v1/object/authenticated/${bucket}/${path}`,
  }));
}

/**
 * GET /api/storage/files
 * ──────────────────────────────────────────────────────────────
 * Real Storage bucket contents (not the assets DB table): every object
 * in design-assets / design-covers / design-exports with size and URL.
 *
 * @returns {200} { success, data: { files: StorageFile[], byBucket } }
 */
storageRoutes.get("/files", requireWorkspaceRole("viewer", "query"), async (req, res) => {
  try {
    const sb = getSupabase();
    if (!sb) return res.json({ success: true, data: { files: [], byBucket: {} } });
    const only = req.query.bucket as string | undefined;
    const workspaceId = req.query.workspaceId as string;
    const buckets = only && (KNOWN_BUCKETS as readonly string[]).includes(only) ? [only] : [...KNOWN_BUCKETS];
    const results = await Promise.all(buckets.map(b => listBucketFiles(sb, b, workspaceId).catch(() => [] as StorageFile[])));
    const files = results.flat().sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    const byBucket: Record<string, { count: number; sizeBytes: number }> = {};
    for (const f of files) {
      byBucket[f.bucket] = byBucket[f.bucket] || { count: 0, sizeBytes: 0 };
      byBucket[f.bucket].count++;
      byBucket[f.bucket].sizeBytes += f.sizeBytes;
    }
    res.json({ success: true, data: { files, byBucket } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/storage/video
 * ──────────────────────────────────────────────────────────────────────
 * REQ-VID8: upload a rendered reel (WebM/MP4) to the public design-reels
 * bucket and return its stable public URL — the mediaUrl that
 * publish_content (Zernio) needs to publish an actual reel.
 *
 * Body is JSON with base64 (not multipart): the worker shim parses JSON
 * only, and the video comes straight from the browser's WebCodecs export.
 *
 * @body { workspaceId, filename, dataBase64, mimeType? } — mimeType must be video/*
 * @returns {200} { success, data: { url, path, bucket, sizeBytes } }
 */
storageRoutes.post("/video", requireWorkspaceRole("editor", "body"), async (req, res) => {
  try {
    const { workspaceId, filename, dataBase64, mimeType } = req.body || {};
    if (!workspaceId || !filename || !dataBase64) {
      return res.status(400).json({ success: false, error: "workspaceId, filename y dataBase64 requeridos" });
    }
    if (typeof filename !== "string" || filename.includes("/") || filename.includes("\\")) {
      return res.status(400).json({ success: false, error: "filename inválido" });
    }
    if (typeof mimeType === "string" && !mimeType.startsWith("video/")) {
      return res.status(415).json({ success: false, error: "Solo videos (video/*)" });
    }
    const sb = getSupabase();
    if (!sb) return res.status(500).json({ success: false, error: "Supabase not configured" });

    // Idempotent bucket bootstrap (public read is what makes the URL stable).
    try {
      const { data: buckets } = await sb.storage.listBuckets();
      if (!buckets?.some((b: any) => b.name === REEL_BUCKET)) {
        await sb.storage.createBucket(REEL_BUCKET, { public: true });
      }
    } catch { /* exists, or upload below reports the real problem */ }

    const bytes = Buffer.from(String(dataBase64), "base64");
    if (bytes.length === 0) return res.status(400).json({ success: false, error: "dataBase64 vacío" });
    if (bytes.length > 120 * 1024 * 1024) return res.status(413).json({ success: false, error: "Video > 120MB" });

    const safeName = filename.replace(/[^\w.\-]+/g, "_").slice(0, 120);
    const path = `${workspaceId}/${Date.now()}_${safeName}`;
    const { error } = await sb.storage.from(REEL_BUCKET).upload(path, bytes, {
      contentType: mimeType || "video/webm",
      upsert: false,
    });
    if (error) throw new Error(error.message);

    const url = `${process.env.SUPABASE_URL || ""}/storage/v1/object/public/${REEL_BUCKET}/${path}`;
    res.json({ success: true, data: { url, path, bucket: REEL_BUCKET, sizeBytes: bytes.length } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/storage/file
 * ──────────────────────────────────────────────────────────────
 * Permanently remove a raw object from a known Storage bucket. Used for
 * generated files (thumbnails, covers, exports) that have no assets-table
 * row and therefore no trash; they are regenerable.
 *
 * @body { bucket, path }
 */
storageRoutes.delete("/file", requireWorkspaceRole("editor", "body"), async (req, res) => {
  try {
    const { bucket, path } = req.body || {};
    if (!bucket || !path || !(KNOWN_BUCKETS as readonly string[]).includes(bucket)) {
      return res.status(400).json({ success: false, error: "Valid bucket and path required" });
    }
    if (typeof path !== "string" || path.includes("..")) {
      return res.status(400).json({ success: false, error: "Invalid path" });
    }
    if (!path.startsWith(`${req.body.workspaceId}/`)) {
      return res.status(403).json({ success: false, error: "Storage path belongs to another workspace" });
    }
    const sb = getSupabase();
    if (!sb) return res.status(500).json({ success: false, error: "Supabase not configured" });
    const { error } = await sb.storage.from(bucket).remove([path]);
    if (error) throw new Error(error.message);
    res.json({ success: true, deleted: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/storage/summary
 * ──────────────────────────────────────────────────────────────
 * Aggregated storage overview: total size, counts per bucket,
 * asset stats, and trash counts. Used by the Storage tab UI.
 *
 * @returns {200} { success, data: { totalBytes, buckets, counts, trash } }
 */
storageRoutes.get("/summary", requireWorkspaceRole("viewer", "query"), async (_req, res) => {
  try {
    const sb = getSupabase();
    const workspaceId = _req.query.workspaceId as string;

    // ── Asset stats from DB ──
    let activeAssets = 0;
    let activeBytes = 0;
    let trashAssets = 0;
    let trashTemplates = 0;
    let templatesCount = 0;
    let recipesCount = 0;

    if (sb) {
      try {
        // Active assets (not deleted)
        const { count: assetCount, data: assetData } = await sb.from("assets")
          .select("size_bytes", { count: "exact", head: false })
          .eq("workspace_id", workspaceId)
          .is("deleted_at", null);
        activeAssets = assetCount || 0;
        activeBytes = (assetData || []).reduce((sum: number, r: any) => sum + (r.size_bytes || 0), 0);

        // Trashed assets
        const { count: trashAssetCount } = await sb.from("assets")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .not("deleted_at", "is", null);
        trashAssets = trashAssetCount || 0;

        // Templates count (active)
        const { count: tplCount } = await sb.from("templates")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .is("deleted_at", null);
        templatesCount = tplCount || 0;

        // Trashed templates
        const { count: trashTplCount } = await sb.from("templates")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .not("deleted_at", "is", null);
        trashTemplates = trashTplCount || 0;

        // Recipes count
        const { count: recipeCount } = await sb.from("recipes")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .is("deleted_at", null);
        recipesCount = recipeCount || 0;
      } catch { /* DB queries optional; fall through to zeros */ }
    }

    // ── Bucket info: real object listings, not assets-table approximations ──
    const bucketMeta = [
      { name: "design-assets", label: "Images", icon: "🖼️" },
      { name: "design-covers", label: "Covers", icon: "🎨" },
      { name: "design-exports", label: "Exports", icon: "📤" },
    ];
    const buckets = bucketMeta.map(b => ({ ...b, assetCount: 0, sizeBytes: 0 }));
    if (sb) {
      const listings = await Promise.all(bucketMeta.map(b => listBucketFiles(sb, b.name, workspaceId).catch(() => [])));
      listings.forEach((files, i) => {
        buckets[i].assetCount = files.length;
        buckets[i].sizeBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0);
      });
    }

    const totalBytes = buckets.reduce((sum, b) => sum + b.sizeBytes, 0);

    res.json({
      success: true,
      data: {
        totalBytes,
        totalFiles: buckets.reduce((sum, b) => sum + b.assetCount, 0) + templatesCount,
        buckets,
        counts: {
          templates: templatesCount,
          assets: activeAssets,
          recipes: recipesCount,
          workspaces: 0, // populated by client if needed
        },
        trash: {
          templates: trashTemplates,
          assets: trashAssets,
          total: trashTemplates + trashAssets,
        },
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
