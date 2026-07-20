/**
 * Design File Metadata Routes
 * ──────────────────────────────────────────────────────────────
 * CRUD for design_file_meta: brand, tags, theme, format, file_type,
 * cover_image_url, obsidian_link. Keyed by template_id.
 *
 * GET  /api/meta/:templateId        — read metadata
 * PUT  /api/meta/:templateId        — upsert metadata
 * GET  /api/graph?workspaceId=&brand=&tag=  — query graph nodes
 * POST /api/meta/:templateId/cover  — upload cover image
 *
 * @module routes/designMeta
 */

import { Router, type Request, type Response } from "express";
import { getSupabase } from "../services/supabase.js";
import { store } from "../services/store.js";
import { buildDesignGraphEdges } from "../services/designGraph.js";

export const designMetaRoutes = Router();

/** GET /api/meta/:templateId */
designMetaRoutes.get("/:templateId", async (req, res) => {
  try {
    const sb = getSupabase();
    if (!sb) {
      // fallback to memory store
      const meta = store.getMeta?.(req.params.templateId) ?? null;
      return res.json({ success: true, data: meta });
    }
    const { data, error } = await sb
      .from("design_file_meta")
      .select("*")
      .eq("template_id", req.params.templateId)
      .maybeSingle();
    if (error) throw error;
    res.json({ success: true, data: data ? rowToMeta(data) : null });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** PUT /api/meta/:templateId — upsert metadata fields */
designMetaRoutes.put("/:templateId", async (req, res) => {
  try {
    const { templateId } = req.params;
    const { brand, tags, theme, format, file_type, cover_image_url, obsidian_link } = req.body;

    const patch: Record<string, any> = {};
    if (brand !== undefined) patch.brand = brand;
    if (tags !== undefined) patch.tags = tags;
    if (theme !== undefined) patch.theme = theme;
    if (format !== undefined) patch.format = format;
    if (file_type !== undefined) patch.file_type = file_type;
    if (cover_image_url !== undefined) patch.cover_image_url = cover_image_url;
    if (obsidian_link !== undefined) patch.obsidian_link = obsidian_link;

    const sb = getSupabase();
    if (!sb) {
      // memory fallback
      store.setMeta?.(templateId, patch);
      return res.json({ success: true });
    }

    // Upsert: try update first, insert if not found
    const { data: existing } = await sb
      .from("design_file_meta")
      .select("id")
      .eq("template_id", templateId)
      .maybeSingle();

    if (existing) {
      patch.updated_at = new Date().toISOString();
      const { error } = await sb
        .from("design_file_meta")
        .update(patch)
        .eq("template_id", templateId);
      if (error) throw error;
    } else {
      // Need workspace_id for insert — derive from template
      const { data: tpl } = await sb
        .from("templates")
        .select("workspace_id")
        .eq("id", templateId)
        .maybeSingle();

      patch.template_id = templateId;
      patch.workspace_id = tpl?.workspace_id || null;
      const { error } = await sb.from("design_file_meta").insert(patch);
      if (error) throw error;
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** GET /api/graph?workspaceId=...&brand=...&tag=... */
export async function getDesignGraph(req: Request, res: Response): Promise<void> {
  try {
    const { workspaceId, brand, tag, format } = req.query;
    const sb = getSupabase();
    if (!sb) {
      res.json({ success: true, data: { nodes: [], edges: [] } });
      return;
    }

    let query = sb.from("design_file_meta").select("*, templates!inner(id, name, thumbnail)");

    if (workspaceId) query = query.eq("workspace_id", workspaceId as string);
    if (brand) query = query.eq("brand", brand as string);
    if (tag) query = query.contains("tags", [tag as string]);
    if (format) query = query.eq("format", format as string);

    const { data, error } = await query;
    if (error) throw error;

    const nodes = (data || []).map((r: any) => ({
      id: r.template_id,
      name: r.templates?.name || r.template_id,
      brand: r.brand,
      campaign: r.campaign || null,
      tags: r.tags || [],
      theme: r.theme,
      format: r.format,
      file_type: r.file_type,
      cover: r.cover_image_url || r.templates?.thumbnail || null,
      obsidian_link: r.obsidian_link,
    }));

    const edges = buildDesignGraphEdges(nodes);

    res.json({ success: true, data: { nodes, edges } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load design graph";
    res.status(500).json({ success: false, error: message });
  }
}

designMetaRoutes.get("/", getDesignGraph);

/** POST /api/meta/:templateId/cover — upload cover image (base64) */
designMetaRoutes.post("/:templateId/cover", async (req, res) => {
  try {
    const { templateId } = req.params;
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ success: false, error: "imageBase64 required" });

    const sb = getSupabase();
    if (!sb) return res.status(503).json({ success: false, error: "Supabase not connected" });

    // Decode base64
    const mimeMatch = imageBase64.match(/^data:(image\/\w+);base64,(.*)$/);
    let mimeType = "image/png";
    let b64Data = imageBase64;
    if (mimeMatch) {
      mimeType = mimeMatch[1];
      b64Data = mimeMatch[2];
    }

    // Size check: max 1MB
    const buf = Buffer.from(b64Data, "base64");
    if (buf.length > 1_048_576) {
      return res.status(413).json({ success: false, error: "Cover image exceeds 1MB limit" });
    }

    const ext = mimeType === "image/jpeg" ? "jpg" : "png";
    const path = `covers/${templateId}.${ext}`;

    const { error: uploadErr } = await sb.storage
      .from("design-covers")
      .upload(path, buf, { contentType: mimeType, upsert: true });

    if (uploadErr) throw uploadErr;

    const { data: urlData } = sb.storage.from("design-covers").getPublicUrl(path);
    const coverUrl = urlData?.publicUrl || "";

    // Save URL to meta
    await sb.from("design_file_meta").upsert({
      template_id: templateId,
      cover_image_url: coverUrl,
      updated_at: new Date().toISOString(),
    }, { onConflict: "template_id" });

    res.json({ success: true, data: { cover_image_url: coverUrl } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Helpers ──

function rowToMeta(row: any) {
  return {
    id: row.id,
    templateId: row.template_id,
    workspaceId: row.workspace_id,
    brand: row.brand || "",
    campaign: row.campaign || "",
    tags: row.tags || [],
    theme: row.theme || "",
    format: row.format || "",
    file_type: row.file_type || "",
    cover_image_url: row.cover_image_url || "",
    obsidian_link: row.obsidian_link || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
