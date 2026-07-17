import { Router } from "express";
import { getSupabase, uploadAsset, migrateBase64FromHtml } from "../services/supabase.js";

export const assetRoutes = Router();

/** POST /api/assets/upload — upload image via base64 or URL */
assetRoutes.post("/upload", async (req, res) => {
  try {
    const { name, data, url, workspaceId, tags } = req.body;
    if (!name) return res.status(400).json({ success: false, error: "name is required" });

    const assetId = `asset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    let imageBuffer: Buffer;
    let mimeType = "image/png";
    let filename: string;

    if (data) {
      const matches = data.match(/^data:(image\/\w+);base64,(.+)$/);
      if (!matches) return res.status(400).json({ success: false, error: "Invalid base64 data format" });
      mimeType = matches[1];
      imageBuffer = Buffer.from(matches[2], "base64");
      const ext = mimeType.split("/")[1] === "svg+xml" ? "svg" : mimeType.split("/")[1] || "png";
      filename = `${assetId}.${ext}`;
    } else if (url) {
      try {
        const fetchResp = await fetch(url);
        if (!fetchResp.ok) throw new Error(`Fetch failed: ${fetchResp.status}`);
        const contentType = fetchResp.headers.get("content-type") || "image/png";
        mimeType = contentType.split(";")[0].trim();
        imageBuffer = Buffer.from(await fetchResp.arrayBuffer());
        const ext = mimeType.split("/")[1] === "svg+xml" ? "svg" : mimeType.split("/")[1] || "png";
        filename = `${assetId}.${ext}`;
      } catch (e: any) {
        return res.status(400).json({ success: false, error: `Failed to download: ${e.message}` });
      }
    } else {
      return res.status(400).json({ success: false, error: "Provide either data (base64) or url" });
    }

    // Use the unified upload helper (Supabase Storage or local disk fallback)
    const publicUrl = await uploadAsset(filename, imageBuffer, mimeType, workspaceId || "default");

    // Record in assets table if Supabase is available
    const sb = getSupabase();
    if (sb) {
      await sb.from("assets").upsert({
        id: assetId, name, filename,
        mime_type: mimeType,
        size_bytes: imageBuffer.length,
        url: publicUrl,
        tags: tags || [],
        workspace_id: workspaceId || null,
      });
    }

    res.status(201).json({
      success: true,
      assetId, name, url: publicUrl, mimeType, sizeBytes: imageBuffer.length,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** GET /api/assets — list assets */
assetRoutes.get("/", async (req, res) => {
  try {
    const supabase = getSupabase();
    if (!supabase) return res.json({ success: true, assets: [], total: 0 });

    const { workspaceId, search, mimeType, limit, offset } = req.query as Record<string, string>;
    let q = supabase.from("assets").select("*", { count: "exact" });
    if (workspaceId) q = q.eq("workspace_id", workspaceId);
    if (mimeType) q = q.eq("mime_type", mimeType);
    if (search) q = q.ilike("name", `%${search}%`);
    q = q.order("created_at", { ascending: false });
    q = q.range(parseInt(offset || "0"), parseInt(offset || "0") + parseInt(limit || "50") - 1);
    const { data, count, error } = await q;
    if (error) throw new Error(error.message);

    const assets = (data || []).map((r: any) => ({
      id: r.id, name: r.name, filename: r.filename,
      mimeType: r.mime_type, sizeBytes: r.size_bytes, url: r.url,
      width: r.width, height: r.height, tags: r.tags || [],
      workspaceId: r.workspace_id, createdAt: r.created_at,
    }));
    res.json({ success: true, assets, total: count || assets.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** DELETE /api/assets/:id — delete asset */
assetRoutes.delete("/:id", async (req, res) => {
  try {
    const supabase = getSupabase();
    if (!supabase) throw new Error("Supabase not configured");
    const { data: asset } = await supabase.from("assets").select("*").eq("id", req.params.id).single();
    if (!asset) return res.status(404).json({ success: false, error: "Asset not found" });
    if (asset.filename && asset.workspace_id) {
      await supabase.storage.from("design-assets").remove([`${asset.workspace_id}/${asset.filename}`]);
    }
    await supabase.from("assets").delete().eq("id", req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/assets/upload-file — multipart file upload.
 * Accepts a single file via form-data field "file".
 * Falls back to local disk when Supabase is not configured.
 */
assetRoutes.post("/upload-file", async (req, res) => {
  try {
    // Express with default body parser doesn't handle multipart.
    // Use the raw body approach: client sends base64 with filename/mimeType.
    const { name, data, filename: clientFilename, mimeType: clientMime, workspaceId } = req.body;
    if (!data || !name) {
      return res.status(400).json({ success: false, error: "name and data (base64) are required" });
    }

    const matches = data.match(/^data:(image\/\w+);base64,(.+)$/);
    const mimeType = clientMime || (matches?.[1]) || "image/png";
    const b64 = matches?.[2] || data;
    const imageBuffer = Buffer.from(b64, "base64");
    const ext = mimeType.split("/")[1] === "svg+xml" ? "svg" : mimeType.split("/")[1] || "png";
    const assetId = `asset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const filename = clientFilename || `${assetId}.${ext}`;

    const publicUrl = await uploadAsset(filename, imageBuffer, mimeType, workspaceId || "default");

    const sb = getSupabase();
    if (sb) {
      await sb.from("assets").upsert({
        id: assetId, name, filename,
        mime_type: mimeType,
        size_bytes: imageBuffer.length,
        url: publicUrl,
        workspace_id: workspaceId || null,
      });
    }

    res.status(201).json({
      success: true, assetId, name, url: publicUrl, mimeType, sizeBytes: imageBuffer.length,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/assets/migrate-base64 — extract base64 images from a template's
 * frame HTML and replace them with Storage URLs. Only migrates images >100KB.
 */
assetRoutes.post("/migrate-base64", async (req, res) => {
  try {
    const { templateId, workspaceId } = req.body;
    if (!templateId) return res.status(400).json({ success: false, error: "templateId is required" });

    // Load template (import here to avoid circular deps)
    const { getTemplate, updateTemplate } = await import("../services/templates.js");
    const tpl = await getTemplate(templateId);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    let totalMigrated = 0;
    const migratedFrames: { frameId: string; migrated: number }[] = [];

    for (const frame of tpl.frames) {
      if (frame.html) {
        const result = await migrateBase64FromHtml(
          frame.html, frame.css || "", workspaceId || tpl.workspaceId || "default"
        );
        if (result.migrated > 0) {
          frame.html = result.html;
          frame.css = result.css;
          totalMigrated += result.migrated;
          migratedFrames.push({ frameId: frame.id, migrated: result.migrated });
        }
      }
    }

    if (totalMigrated > 0) {
      await updateTemplate(templateId, { frames: tpl.frames });
    }

    res.json({
      success: true,
      templateId,
      totalMigrated,
      frames: migratedFrames,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
