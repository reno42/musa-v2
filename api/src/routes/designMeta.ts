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
import { canAccessWorkspace, listAccessibleWorkspaceIds } from "../services/tenancy.js";

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
    const { brand_id, brand, campaign_id, campaign, asset_type, tags, theme, format, file_type, cover_image_url, obsidian_link } = req.body;

    const patch: Record<string, any> = {};
    if (brand_id !== undefined) patch.brand_id = brand_id || null;
    if (brand !== undefined) patch.brand = brand;
    if (campaign_id !== undefined) patch.campaign_id = campaign_id || null;
    if (campaign !== undefined) patch.campaign = campaign;
    if (asset_type !== undefined) patch.asset_type = asset_type || "other";
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

    const { data: template } = await sb.from("templates")
      .select("workspace_id").eq("id", templateId).maybeSingle();
    if (!template?.workspace_id) return res.status(404).json({ success: false, error: "Template not found" });

    if (patch.brand_id) {
      const { data: selectedBrand } = await sb.from("brands").select("id, name")
        .eq("workspace_id", template.workspace_id).eq("id", patch.brand_id).maybeSingle();
      if (!selectedBrand) return res.status(400).json({ success: false, error: "Brand does not belong to this workspace" });
      patch.brand = selectedBrand.name;
    }

    if (patch.campaign === "" || patch.brand_id === null) {
      patch.campaign_id = null;
    } else if (patch.campaign && patch.brand_id) {
      const campaignName = String(patch.campaign).trim();
      const { data: existingCampaign } = await sb.from("campaigns").select("id, name")
        .eq("workspace_id", template.workspace_id)
        .eq("brand_id", patch.brand_id)
        .ilike("name", campaignName)
        .maybeSingle();
      if (existingCampaign) {
        patch.campaign_id = existingCampaign.id;
        patch.campaign = existingCampaign.name;
      } else {
        const { data: createdCampaign, error: campaignError } = await sb.from("campaigns").insert({
          workspace_id: template.workspace_id,
          brand_id: patch.brand_id,
          name: campaignName,
        }).select("id, name").single();
        if (campaignError) throw campaignError;
        patch.campaign_id = createdCampaign.id;
        patch.campaign = createdCampaign.name;
      }
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
      patch.template_id = templateId;
      patch.workspace_id = template.workspace_id;
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

    if (!req.auth) {
      res.status(401).json({ success: false, error: "Authentication required" });
      return;
    }

    const requestedWorkspaceId = typeof workspaceId === "string" ? workspaceId : "";
    const workspaceIds = requestedWorkspaceId
      ? [requestedWorkspaceId]
      : await listAccessibleWorkspaceIds(req.auth);
    if (requestedWorkspaceId && !(await canAccessWorkspace(req.auth, requestedWorkspaceId, "viewer"))) {
      res.status(403).json({ success: false, error: "You do not have access to this workspace" });
      return;
    }
    if (workspaceIds.length === 0) {
      res.json({ success: true, data: { workspace: null, brands: [], contacts: [], nodes: [], edges: [] } });
      return;
    }

    let query = sb.from("design_file_meta").select("*, templates!inner(id, name, thumbnail)");

    query = workspaceIds.length === 1
      ? query.eq("workspace_id", workspaceIds[0])
      : query.in("workspace_id", workspaceIds);
    if (brand) query = query.ilike("brand", brand as string);
    if (tag) query = query.contains("tags", [tag as string]);
    if (format) query = query.eq("format", format as string);

    const [designResult, workspaceResult, brandResult, contactResult] = await Promise.all([
      query,
      sb.from("workspaces").select("id, name").in("id", workspaceIds).order("name"),
      sb.from("brands").select("*").in("workspace_id", workspaceIds).order("name"),
      sb.from("crm_contacts")
        .select("id, workspace_id, brand_id, brand_name, first_name, last_name, email, job_title, status")
        .in("workspace_id", workspaceIds)
        .order("first_name"),
    ]);
    if (designResult.error) throw designResult.error;
    if (workspaceResult.error) throw workspaceResult.error;
    if (brandResult.error) throw brandResult.error;
    if (contactResult.error) throw contactResult.error;

    const nodes = (designResult.data || []).map((r: any) => ({
      id: r.template_id,
      name: r.templates?.name || r.template_id,
      brand_id: r.brand_id || null,
      brand: r.brand,
      campaign_id: r.campaign_id || null,
      campaign: r.campaign || null,
      asset_type: r.asset_type || null,
      tags: r.tags || [],
      theme: r.theme,
      format: r.format,
      file_type: r.file_type,
      cover: r.cover_image_url || r.templates?.thumbnail || null,
      obsidian_link: r.obsidian_link,
    }));

    const edges = buildDesignGraphEdges(nodes);
    const brands = (brandResult.data || [])
      .filter((item: any) => !brand || item.name?.toLocaleLowerCase() === String(brand).toLocaleLowerCase())
      .map((item: any) => ({
        id: item.id,
        name: item.name,
        relationship_status: item.relationship_status || null,
      }));
    const contacts = (contactResult.data || [])
      .filter((contact: any) => !brand || contact.brand_name?.toLocaleLowerCase() === String(brand).toLocaleLowerCase() || brands.some((item: any) => item.id === contact.brand_id));
    const workspaces = workspaceResult.data || [];
    const workspace = workspaces.length === 1 ? workspaces[0] : { id: "all", name: "Tus marcas" };

    res.json({ success: true, data: { workspace, brands, contacts, nodes, edges } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load design graph";
    res.status(500).json({ success: false, error: message });
  }
}

designMetaRoutes.get("/", getDesignGraph);

/** Workspace brands and campaigns available to this design file. */
designMetaRoutes.get("/:templateId/taxonomy", async (req, res) => {
  try {
    const sb = getSupabase();
    if (!sb) return res.json({ success: true, data: { brands: [], campaigns: [] } });
    const { data: template, error: templateError } = await sb.from("templates")
      .select("workspace_id").eq("id", req.params.templateId).maybeSingle();
    if (templateError) throw templateError;
    if (!template?.workspace_id) return res.status(404).json({ success: false, error: "Template not found" });

    const [brandResult, campaignResult] = await Promise.all([
      sb.from("brands").select("*").eq("workspace_id", template.workspace_id).order("name"),
      sb.from("campaigns").select("id, brand_id, name, status").eq("workspace_id", template.workspace_id).order("name"),
    ]);
    if (brandResult.error) throw brandResult.error;
    res.json({
      success: true,
      data: {
        brands: (brandResult.data || []).map((brand: any) => ({
          id: brand.id,
          name: brand.name,
          relationship_status: brand.relationship_status || "lead",
        })),
        campaigns: campaignResult.error ? [] : (campaignResult.data || []),
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

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
    const { data: template } = await sb.from("templates").select("workspace_id").eq("id", templateId).single();
    if (!template?.workspace_id) return res.status(404).json({ success: false, error: "Template not found" });
    const path = `${template.workspace_id}/covers/${templateId}.${ext}`;

    const { error: uploadErr } = await sb.storage
      .from("design-covers")
      .upload(path, buf, { contentType: mimeType, upsert: true });

    if (uploadErr) throw uploadErr;

    const { data: urlData } = await sb.storage.from("design-covers").createSignedUrl(path, 31_536_000);
    const coverUrl = urlData?.signedUrl || "";

    // Save URL to meta
    await sb.from("design_file_meta").upsert({
      template_id: templateId,
      workspace_id: template.workspace_id,
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
    brand_id: row.brand_id || null,
    campaign: row.campaign || "",
    campaign_id: row.campaign_id || null,
    asset_type: row.asset_type || "other",
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
