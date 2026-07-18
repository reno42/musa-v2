import { Router } from "express";
import { getSupabase } from "../services/supabase.js";

export const storageRoutes = Router();

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

    // ── Bucket info ──
    // Supabase Storage doesn't expose total size per bucket via client SDK easily.
    // We approximate from the assets table and provide bucket names.
    const buckets = [
      { name: "design-assets", label: "Images", icon: "🖼️", assetCount: activeAssets, sizeBytes: activeBytes },
      { name: "design-covers", label: "Covers", icon: "🎨", assetCount: 0, sizeBytes: 0 },
      { name: "design-exports", label: "Exports", icon: "📤", assetCount: 0, sizeBytes: 0 },
    ];

    // Try to get cover and export counts from DB if tables exist
    if (sb) {
      try {
        const { count: coverCount } = await sb.from("design_file_meta")
          .select("template_id", { count: "exact", head: true })
          .not("cover_image_url", "is", null);
        buckets[1].assetCount = coverCount || 0;
      } catch { /* table may not exist */ }
    }

    const totalBytes = activeBytes;

    res.json({
      success: true,
      data: {
        totalBytes,
        totalFiles: activeAssets + templatesCount + recipesCount,
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
