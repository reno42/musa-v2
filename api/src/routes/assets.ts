import { Router } from "express";
import { getSupabase, uploadAsset, migrateBase64FromHtml, sanitizeAssetFileName } from "../services/supabase.js";
import { canAccessWorkspace } from "../services/tenancy.js";
import { assertSafeIntegrationEndpoint } from "../services/workspaceIntegrations.js";
import { fetchRemoteImage } from "../services/remoteImage.js";

export const assetRoutes = Router();

/** POST /api/assets/upload — upload image via base64 or URL */
assetRoutes.post("/upload", async (req, res) => {
  try {
    const { name, data, url, workspaceId, tags, replaceAssetId } = req.body;
    if (!name) return res.status(400).json({ success: false, error: "name is required" });
    if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
    if (!req.auth || !(await canAccessWorkspace(req.auth, workspaceId, "editor"))) {
      return res.status(403).json({ success: false, error: "Editor access to the workspace is required" });
    }

    // Reusing the id overwrites the row and the stored object instead of
    // leaving the heavy original orphaned next to its own replacement. Used by
    // the browser's second compression pass, which can only run once the
    // bytes are already in our bucket and readable across origins.
    const assetId = typeof replaceAssetId === "string" && replaceAssetId.trim()
      ? replaceAssetId.trim()
      : `asset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    let imageBuffer: Buffer;
    let mimeType = "image/png";
    let filename: string;

    if (data) {
      const matches = data.match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
      if (!matches) return res.status(400).json({ success: false, error: "Invalid base64 data format" });
      mimeType = matches[1];
      imageBuffer = Buffer.from(matches[2], "base64");
      const ext = mimeType.split("/")[1] === "svg+xml" ? "svg" : mimeType.split("/")[1] || "png";
      filename = `${assetId}.${ext}`;
    } else if (url) {
      try {
        // Follows redirects, revalidating each hop, and rewrites the share
        // links people actually paste. redirect:"error" used to reject almost
        // every real image URL, since Unsplash, Pexels and Drive all bounce.
        const image = await fetchRemoteImage(url);
        mimeType = image.mimeType;
        imageBuffer = image.buffer;
        const ext = mimeType.split("/")[1] === "svg+xml" ? "svg" : mimeType.split("/")[1] || "png";
        filename = `${assetId}.${ext}`;
      } catch (e: any) {
        // The message already says what to do about it — don't bury it.
        return res.status(400).json({ success: false, error: e.message });
      }
    } else {
      return res.status(400).json({ success: false, error: "Provide either data (base64) or url" });
    }
    // 5MB, not 10: the browser optimises before it uploads, so anything that
    // still arrives this heavy skipped that path and would bloat the workspace.
    if (imageBuffer.length > 5 * 1024 * 1024) {
      return res.status(413).json({
        success: false,
        error: "La imagen supera el límite de 5MB. Súbela desde el editor y se optimizará sola.",
      });
    }

    // Use the unified upload helper (Supabase Storage or local disk fallback)
    const publicUrl = await uploadAsset(filename, imageBuffer, mimeType, workspaceId);

    // Record in assets table if Supabase is available
    const sb = getSupabase();
    if (sb) {
      const { error } = await sb.from("assets").upsert({
        id: assetId, name, filename,
        mime_type: mimeType,
        size_bytes: imageBuffer.length,
        url: publicUrl,
        tags: tags || [],
        workspace_id: workspaceId || null,
      });
      if (error) throw error;
    }

    res.status(201).json({
      success: true,
      assetId, name, url: publicUrl, mimeType, sizeBytes: imageBuffer.length,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** GET /api/assets — list active (non-deleted) assets */
assetRoutes.get("/", async (req, res) => {
  try {
    const supabase = getSupabase();
    if (!supabase) return res.json({ success: true, assets: [], total: 0 });

    const { workspaceId, search, mimeType, limit, offset } = req.query as Record<string, string>;
    if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
    if (!req.auth || !(await canAccessWorkspace(req.auth, workspaceId, "viewer"))) {
      return res.status(403).json({ success: false, error: "Workspace access is required" });
    }
    let q = supabase.from("assets").select("*", { count: "exact" }).is("deleted_at", null);
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

/**
 * PATCH /api/assets/:id — rename an asset, or re-file it under a brand.
 *
 * An asset belongs to a brand by carrying that brand's name in its tags, which
 * is the rule buildBrandGraph files by. So "change this asset's brand" means
 * "swap whichever tag is a brand name for this one", and the brand table's
 * Marca cell writes through here. Tags that are not brand names — a
 * campaign, a topic — are left alone.
 */
assetRoutes.patch("/:id", async (req, res) => {
  try {
    const sb = getSupabase();
    if (!sb) return res.status(503).json({ success: false, error: "Supabase no está configurado" });

    const { data: asset, error: readError } = await sb.from("assets")
      .select("id, workspace_id, tags").eq("id", req.params.id).maybeSingle();
    if (readError) throw readError;
    if (!asset) return res.status(404).json({ success: false, error: "Asset no encontrado" });
    if (!req.auth || !(await canAccessWorkspace(req.auth, asset.workspace_id, "editor"))) {
      return res.status(403).json({ success: false, error: "Editor access to the workspace is required" });
    }

    const patch: Record<string, any> = {};
    if (typeof req.body.name === "string" && req.body.name.trim()) patch.name = req.body.name.trim();

    if (req.body.brand !== undefined) {
      const { data: brands } = await sb.from("brands").select("name")
        .eq("workspace_id", asset.workspace_id);
      const brandNames = new Set((brands || []).map((b: any) => String(b.name).trim().toLowerCase()));
      const current: string[] = Array.isArray(asset.tags) ? asset.tags : [];
      // Everything that is not a brand name survives untouched.
      const kept = current.filter(t => !brandNames.has(String(t).trim().toLowerCase()));
      const wanted = String(req.body.brand || "").trim();
      patch.tags = wanted ? [...kept, wanted] : kept;
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ success: false, error: "Nada que actualizar" });
    }
    patch.updated_at = new Date().toISOString();

    const { error } = await sb.from("assets").update(patch).eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err: any) {
    console.error(`[assets] PATCH ${req.params.id} failed:`, err?.code, err?.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/** DELETE /api/assets/:id — soft-delete asset (move to Trash) */
assetRoutes.delete("/:id", async (req, res) => {
  try {
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ success: false, error: "Supabase not configured" });
    const { data: asset } = await supabase.from("assets").select("id").eq("id", req.params.id).is("deleted_at", null).single();
    if (!asset) return res.status(404).json({ success: false, error: "Asset not found" });
    await supabase.from("assets").update({ deleted_at: new Date().toISOString() }).eq("id", req.params.id);
    res.json({ success: true, deleted: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** GET /api/assets/trash — list soft-deleted assets */
assetRoutes.get("/trash", async (req, res) => {
  try {
    const supabase = getSupabase();
    if (!supabase) return res.json({ success: true, data: [], total: 0 });
    const workspaceId = String(req.query.workspaceId || "");
    if (!workspaceId || !req.auth || !(await canAccessWorkspace(req.auth, workspaceId, "viewer"))) {
      return res.status(403).json({ success: false, error: "Workspace access is required" });
    }
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
    const { data, count, error } = await supabase.from("assets")
      .select("id, name, filename, mime_type, size_bytes, url, workspace_id, created_at, deleted_at", { count: "exact" })
      .eq("workspace_id", workspaceId)
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;
    const items = (data || []).map((r: any) => ({
      id: r.id, name: r.name, filename: r.filename, mimeType: r.mime_type,
      sizeBytes: r.size_bytes, url: r.url, workspaceId: r.workspace_id,
      createdAt: r.created_at, deletedAt: r.deleted_at,
    }));
    res.json({ success: true, data: items, total: count || items.length, limit, offset });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** PUT /api/assets/:id/restore — restore asset from Trash */
assetRoutes.put("/:id/restore", async (req, res) => {
  try {
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ success: false, error: "Supabase not configured" });
    const { data: asset } = await supabase.from("assets").select("id").eq("id", req.params.id).not("deleted_at", "is", null).single();
    if (!asset) return res.status(404).json({ success: false, error: "Asset not found in trash" });
    await supabase.from("assets").update({ deleted_at: null }).eq("id", req.params.id);
    res.json({ success: true, restored: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** DELETE /api/assets/:id/permanent — permanently delete asset from storage + DB */
assetRoutes.delete("/:id/permanent", async (req, res) => {
  try {
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ success: false, error: "Supabase not configured" });
    const { data: asset } = await supabase.from("assets").select("*").eq("id", req.params.id).single();
    if (!asset) return res.status(404).json({ success: false, error: "Asset not found" });
    if (asset.filename && asset.workspace_id) {
      try {
        await supabase.storage.from("design-assets").remove([`${asset.workspace_id}/${asset.filename}`]);
      } catch { /* file may already be gone */ }
    }
    await supabase.from("assets").delete().eq("id", req.params.id);
    res.json({ success: true, purged: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** POST /api/assets/trash/purge-expired — purge assets in trash >30 days */
assetRoutes.post("/trash/purge-expired", async (req, res) => {
  try {
    const supabase = getSupabase();
    if (!supabase) return res.json({ success: true, purged: 0 });
    const workspaceId = String(req.body?.workspaceId || "");
    if (!workspaceId || !req.auth || !(await canAccessWorkspace(req.auth, workspaceId, "editor"))) {
      return res.status(403).json({ success: false, error: "Editor access to the workspace is required" });
    }
    const olderThanDays = parseInt(req.body?.olderThanDays as string) || 30;
    const cutoff = new Date(Date.now() - olderThanDays * 86400000).toISOString();
    // Get expired assets
    const { data: expired } = await supabase.from("assets")
      .select("id, filename, workspace_id")
      .eq("workspace_id", workspaceId)
      .not("deleted_at", "is", null)
      .lt("deleted_at", cutoff);
    // Remove from storage
    for (const asset of (expired || [])) {
      if (asset.filename && asset.workspace_id) {
        try {
          await supabase.storage.from("design-assets").remove([`${asset.workspace_id}/${asset.filename}`]);
        } catch { /* skip */ }
      }
    }
    // Delete from DB
    const ids = (expired || []).map((a: any) => a.id);
    if (ids.length > 0) {
      await supabase.from("assets").delete().in("id", ids);
    }
    res.json({ success: true, purged: ids.length });
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
    if (!workspaceId || !req.auth || !(await canAccessWorkspace(req.auth, workspaceId, "editor"))) {
      return res.status(403).json({ success: false, error: "Editor access to the workspace is required" });
    }

    const matches = data.match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
    const mimeType = clientMime || (matches?.[1]) || "image/png";
    const b64 = matches?.[2] || data;
    const imageBuffer = Buffer.from(b64, "base64");
    // 5MB, not 10: the browser optimises before it uploads, so anything that
    // still arrives this heavy skipped that path and would bloat the workspace.
    if (imageBuffer.length > 5 * 1024 * 1024) {
      return res.status(413).json({
        success: false,
        error: "La imagen supera el límite de 5MB. Súbela desde el editor y se optimizará sola.",
      });
    }
    const ext = mimeType.split("/")[1] === "svg+xml" ? "svg" : mimeType.split("/")[1] || "png";
    const assetId = `asset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const filename = sanitizeAssetFileName(clientFilename || `${assetId}.${ext}`);

    const publicUrl = await uploadAsset(filename, imageBuffer, mimeType, workspaceId);

    const sb = getSupabase();
    if (sb) {
      const { error } = await sb.from("assets").upsert({
        id: assetId, name, filename,
        mime_type: mimeType,
        size_bytes: imageBuffer.length,
        url: publicUrl,
        workspace_id: workspaceId,
      });
      if (error) throw error;
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
    if (!req.auth || !(await canAccessWorkspace(req.auth, tpl.workspaceId, "editor"))) {
      return res.status(404).json({ success: false, error: "Template not found" });
    }

    let totalMigrated = 0;
    const migratedFrames: { frameId: string; migrated: number }[] = [];

    for (const frame of tpl.frames) {
      if (frame.html) {
        const result = await migrateBase64FromHtml(
          frame.html, frame.css || "", tpl.workspaceId
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
