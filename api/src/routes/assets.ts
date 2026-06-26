import { Router } from "express";
import { getSupabase } from "../services/supabase.js";

export const assetRoutes = Router();

/** POST /api/assets/upload — upload image via base64 or URL */
assetRoutes.post("/upload", async (req, res) => {
  try {
    const supabase = getSupabase();
    if (!supabase) throw new Error("Supabase not configured");
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

    const filePath = `${workspaceId || "default"}/${filename}`;
    const { error: uploadErr } = await supabase.storage.from("design-assets").upload(filePath, imageBuffer, {
      contentType: mimeType,
      upsert: true,
    });
    if (uploadErr) throw new Error(uploadErr.message);

    const { data: publicUrlData } = supabase.storage.from("design-assets").getPublicUrl(filePath);
    const publicUrl = publicUrlData?.publicUrl || "";

    await supabase.from("assets").upsert({
      id: assetId, name, filename,
      mime_type: mimeType,
      size_bytes: imageBuffer.length,
      url: publicUrl,
      tags: tags || [],
      workspace_id: workspaceId || null,
    });

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
