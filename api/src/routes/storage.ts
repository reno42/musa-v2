import { Router } from "express";
import { getSupabase } from "../services/supabase.js";

export const storageRoutes = Router();

const KNOWN_BUCKETS = ["design-assets", "design-covers", "design-exports"] as const;

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
async function listBucketFiles(sb: any, bucket: string, maxFiles = 400): Promise<StorageFile[]> {
  const out: StorageFile[] = [];
  const baseUrl = process.env.SUPABASE_URL || "";
  const toFile = (path: string, item: any): StorageFile => ({
    bucket,
    path,
    name: item.name,
    sizeBytes: item.metadata?.size || 0,
    mimeType: item.metadata?.mimetype || "application/octet-stream",
    updatedAt: item.updated_at || item.created_at || null,
    url: `${baseUrl}/storage/v1/object/public/${bucket}/${path}`,
  });
  const { data: root, error } = await sb.storage.from(bucket).list("", { limit: 100, sortBy: { column: "updated_at", order: "desc" } });
  if (error || !root) return out;
  for (const item of root) {
    if (out.length >= maxFiles) break;
    if (item.id) {
      // A file at the bucket root
      out.push(toFile(item.name, item));
    } else {
      // A folder — list its contents
      const { data: children } = await sb.storage.from(bucket)
        .list(item.name, { limit: 200, sortBy: { column: "updated_at", order: "desc" } });
      for (const child of children || []) {
        if (out.length >= maxFiles) break;
        if (child.id) out.push(toFile(`${item.name}/${child.name}`, child));
      }
    }
  }
  return out;
}

/**
 * GET /api/storage/files
 * ──────────────────────────────────────────────────────────────
 * Real Storage bucket contents (not the assets DB table): every object
 * in design-assets / design-covers / design-exports with size and URL.
 *
 * @returns {200} { success, data: { files: StorageFile[], byBucket } }
 */
storageRoutes.get("/files", async (req, res) => {
  try {
    const sb = getSupabase();
    if (!sb) return res.json({ success: true, data: { files: [], byBucket: {} } });
    const only = req.query.bucket as string | undefined;
    const buckets = only && (KNOWN_BUCKETS as readonly string[]).includes(only) ? [only] : [...KNOWN_BUCKETS];
    const results = await Promise.all(buckets.map(b => listBucketFiles(sb, b).catch(() => [] as StorageFile[])));
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
 * DELETE /api/storage/file
 * ──────────────────────────────────────────────────────────────
 * Permanently remove a raw object from a known Storage bucket. Used for
 * generated files (thumbnails, covers, exports) that have no assets-table
 * row and therefore no trash; they are regenerable.
 *
 * @body { bucket, path }
 */
storageRoutes.delete("/file", async (req, res) => {
  try {
    const { bucket, path } = req.body || {};
    if (!bucket || !path || !(KNOWN_BUCKETS as readonly string[]).includes(bucket)) {
      return res.status(400).json({ success: false, error: "Valid bucket and path required" });
    }
    if (typeof path !== "string" || path.includes("..")) {
      return res.status(400).json({ success: false, error: "Invalid path" });
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
storageRoutes.get("/summary", async (_req, res) => {
  try {
    const sb = getSupabase();

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
          .is("deleted_at", null);
        activeAssets = assetCount || 0;
        activeBytes = (assetData || []).reduce((sum: number, r: any) => sum + (r.size_bytes || 0), 0);

        // Trashed assets
        const { count: trashAssetCount } = await sb.from("assets")
          .select("id", { count: "exact", head: true })
          .not("deleted_at", "is", null);
        trashAssets = trashAssetCount || 0;

        // Templates count (active)
        const { count: tplCount } = await sb.from("templates")
          .select("id", { count: "exact", head: true })
          .is("deleted_at", null);
        templatesCount = tplCount || 0;

        // Trashed templates
        const { count: trashTplCount } = await sb.from("templates")
          .select("id", { count: "exact", head: true })
          .not("deleted_at", "is", null);
        trashTemplates = trashTplCount || 0;

        // Recipes count
        const { count: recipeCount } = await sb.from("recipes")
          .select("id", { count: "exact", head: true })
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
      const listings = await Promise.all(bucketMeta.map(b => listBucketFiles(sb, b.name).catch(() => [])));
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
