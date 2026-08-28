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
import { randomBytes } from "node:crypto";
import { getSupabase, removeStalePreviewFiles } from "../services/supabase.js";
import { store } from "../services/store.js";
import { canAccessWorkspace, listAccessibleWorkspaceIds } from "../services/tenancy.js";

export const designMetaRoutes = Router();

/** The branches a file can hang from in the brand graph. */
const CATEGORIES = ["Design System", "Plantillas", "Assets", "Archivos"];

/** Empty or unknown means "no explicit branch" — the graph falls back to Archivos. */
function normalizeCategory(value: unknown): string | null {
  const typed = String(value ?? "").trim();
  if (!typed) return null;
  return CATEGORIES.find(c => c.toLowerCase() === typed.toLowerCase()) ?? null;
}

/**
 * True when the database rejected the write because design_file_meta.category
 * is not there — v21 has not been run against THIS database.
 *
 * Two different wordings, and matching only the first is why this surfaced as
 * a blank 500 rather than the message below. Reading a missing column raises
 * Postgres 42703, "column ... does not exist". Writing one PostgREST rejects
 * before it ever reaches Postgres, against its own schema cache, as PGRST204
 * "Could not find the 'category' column ... in the schema cache". The write
 * path only ever produces the second.
 */
function isMissingCategoryColumn(error: unknown): boolean {
  const err = error as { message?: string; code?: string } | null;
  const code = String(err?.code ?? "");
  if (code === "PGRST204" || code === "42703") return true;
  const message = (error instanceof Error ? error.message : String(err?.message ?? "")).toLowerCase();
  if (!message.includes("category")) return false;
  return message.includes("does not exist") || message.includes("schema cache");
}

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
  const { templateId } = req.params; // outside the try so the catch can name it
  try {
    const { brand_id, brand, campaign_id, campaign, category, content_kind, asset_type, designer_type, is_permanent, production_data, tags, theme, format, file_type, cover_image_url, obsidian_link } = req.body;

    const patch: Record<string, any> = {};
    if (brand_id !== undefined) patch.brand_id = brand_id || null;
    if (brand !== undefined) patch.brand = brand;
    if (campaign_id !== undefined) patch.campaign_id = campaign_id || null;
    if (campaign !== undefined) patch.campaign = campaign;
    if (category !== undefined) patch.category = normalizeCategory(category);
    if (content_kind !== undefined) {
      // Provenance, not current state: what the design was FIRST used for.
      const kind = String(content_kind || "").trim().toLowerCase();
      patch.content_kind = kind === "ad" || kind === "organic" ? kind : null;
    }
    if (asset_type !== undefined) patch.asset_type = asset_type || "other";
    if (designer_type !== undefined) patch.designer_type = designer_type || "other";
    if (is_permanent !== undefined) patch.is_permanent = Boolean(is_permanent);
    if (production_data !== undefined) patch.production_data = production_data;
    if (tags !== undefined) patch.tags = tags;
    if (theme !== undefined) patch.theme = theme;
    if (format !== undefined) patch.format = format;
    if (file_type !== undefined) patch.file_type = file_type;
    if (cover_image_url !== undefined) patch.cover_image_url = cover_image_url;
    if (obsidian_link !== undefined) patch.obsidian_link = obsidian_link;

    // A body of nothing this route understands used to answer 200 and write
    // nothing, which is how the table's Categoria column looked broken for so
    // long: the request succeeded, the cell snapped back, no error anywhere.
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ success: false, error: "No recognised metadata fields in body" });
    }

    const sb = getSupabase();
    if (!sb) {
      // memory fallback
      store.setMeta?.(templateId, patch);
      return res.json({ success: true });
    }

    // requireTemplateAccess already resolved and authorised this; re-querying
    // it here only added a round trip to every write.
    const workspaceId = req.templateWorkspaceId
      || (await sb.from("templates").select("workspace_id").eq("id", templateId).maybeSingle()).data?.workspace_id;
    if (!workspaceId) return res.status(404).json({ success: false, error: "Template not found" });
    const template = { workspace_id: workspaceId };

    if (patch.brand_id) {
      const { data: selectedBrand } = await sb.from("brands").select("id, name")
        .eq("workspace_id", template.workspace_id).eq("id", patch.brand_id).maybeSingle();
      if (!selectedBrand) return res.status(400).json({ success: false, error: "Brand does not belong to this workspace" });
      patch.brand = selectedBrand.name;
    } else if (patch.brand !== undefined && !patch.brand_id) {
      // A caller that sends only a brand NAME (the data tables do — the user
      // types into the cell; the info panel sends the whole meta object with
      // brand_id null) used to have it stored as loose text while brand_id
      // kept pointing at the old brand. The graph reads brand_id first, so
      // the file never moved and the edit looked ignored. Resolve the name to
      // a real row here, creating the brand when it is new.
      const typed = String(patch.brand ?? "").trim();
      if (!typed) {
        patch.brand = null;
        patch.brand_id = null;
        patch.campaign_id = null;
      } else {
        const { data: match } = await sb.from("brands").select("id, name")
          .eq("workspace_id", template.workspace_id).ilike("name", typed).limit(1).maybeSingle();
        if (match) {
          patch.brand_id = match.id;
          patch.brand = match.name;
        } else {
          const { data: created, error: createError } = await sb.from("brands").insert({
            id: `brand_${randomBytes(10).toString("hex")}`,
            workspace_id: template.workspace_id,
            name: typed,
          }).select("id, name").single();
          if (createError) throw createError;
          patch.brand_id = created.id;
          patch.brand = created.name;
        }
      }
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

    // Upsert: try update first, insert if not found.
    //
    // limit(1) rather than maybeSingle(): design_file_meta is UNIQUE on
    // template_id only if the table was created by v4, and this database has
    // had tables arrive by other routes. maybeSingle() THROWS on a second row
    // (PGRST116) instead of returning one, which would turn a duplicate into
    // an unexplained 500 on that one file and no other.
    const { data: existingRows, error: lookupError } = await sb
      .from("design_file_meta")
      .select("id")
      .eq("template_id", templateId)
      .limit(1);
    if (lookupError) throw lookupError;

    if (existingRows && existingRows.length > 0) {
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
    if (isMissingCategoryColumn(err)) {
      console.warn(`[meta] missing column writing ${templateId}:`, err?.code, err?.message);
      return res.status(409).json({
        success: false,
        error: `Falta una columna en esta base de datos: ejecuta supabase_migrations_v21.sql en el proyecto de Supabase que usa produccion, y recarga el esquema (Settings -> API -> Reload schema cache). Detalle: ${err?.message || err}`,
      });
    }
    // Logged as well as returned: a 500 that only exists in the response body
    // cannot be looked up afterwards.
    console.error(`[meta] PUT ${templateId} failed:`, err?.code, err?.message, err?.details || "");
    res.status(500).json({ success: false, error: err?.message || "Error interno" });
  }
});

/** GET /api/graph?workspaceId=...&brand=...&tag=... */
export async function getDesignGraph(req: Request, res: Response): Promise<void> {
  try {
    const { workspaceId, brand, tag, format, designer_type } = req.query;
    const sb = getSupabase();
    if (!sb) {
      res.json({ success: true, data: { nodes: [] } });
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
      res.json({ success: true, data: { workspace: null, brands: [], contacts: [], nodes: [] } });
      return;
    }

    let query = sb.from("design_file_meta").select("*, templates!inner(id, name, thumbnail)");

    query = workspaceIds.length === 1
      ? query.eq("workspace_id", workspaceIds[0])
      : query.in("workspace_id", workspaceIds);
    if (brand) query = query.ilike("brand", brand as string);
    if (tag) query = query.contains("tags", [tag as string]);
    if (format) query = query.eq("format", format as string);
    if (designer_type) query = query.eq("designer_type", designer_type as string);

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
      brand: r.brand || "",
      campaign_id: r.campaign_id || null,
      campaign: r.campaign || null,
      asset_type: r.asset_type || null,
      designer_type: r.designer_type || "other",
      is_permanent: Boolean(r.is_permanent),
      tags: r.tags || [],
      theme: r.theme || "",
      format: r.format || "",
      file_type: r.file_type || "",
      cover: r.cover_image_url || r.templates?.thumbnail || null,
      obsidian_link: r.obsidian_link || "",
    }));

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

    res.json({ success: true, data: { workspace, brands, contacts, nodes } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load design graph";
    res.status(500).json({ success: false, error: message });
  }
}

designMetaRoutes.get("/", getDesignGraph);

/** POST /api/meta/batch — upsert metadata for multiple templates in one call.
 *  Body: { templates: [{ templateId, brand?, campaign?, tags?, ... }] } */
designMetaRoutes.post("/batch", async (req, res) => {
  try {
    const { templates } = req.body;
    if (!Array.isArray(templates) || templates.length === 0) {
      return res.status(400).json({ success: false, error: "templates array required" });
    }
    if (templates.length > 100) {
      return res.status(400).json({ success: false, error: "Max 100 templates per batch" });
    }

    const sb = getSupabase();
    const results: { templateId: string; ok: boolean; error?: string }[] = [];

    for (const entry of templates) {
      const templateId = entry.templateId || entry.template_id;
      if (!templateId) { results.push({ templateId: "", ok: false, error: "Missing templateId" }); continue; }
      try {
        const patch: Record<string, any> = {};
        if (entry.brand !== undefined) patch.brand = entry.brand;
        if (entry.brand_id !== undefined) patch.brand_id = entry.brand_id;
        if (entry.campaign !== undefined) patch.campaign = entry.campaign;
        if (entry.category !== undefined) patch.category = normalizeCategory(entry.category);
        if (entry.asset_type !== undefined) patch.asset_type = entry.asset_type;
        if (entry.tags !== undefined) patch.tags = entry.tags;
        if (entry.theme !== undefined) patch.theme = entry.theme;
        if (entry.format !== undefined) patch.format = entry.format;
        if (entry.file_type !== undefined) patch.file_type = entry.file_type;
        if (entry.obsidian_link !== undefined) patch.obsidian_link = entry.obsidian_link;
        if (entry.cover_image_url !== undefined) patch.cover_image_url = entry.cover_image_url;
        if (entry.is_permanent !== undefined) patch.is_permanent = Boolean(entry.is_permanent);
        if (entry.designer_type !== undefined) patch.designer_type = entry.designer_type;

        if (Object.keys(patch).length === 0) {
          results.push({ templateId, ok: true }); // no-op
          continue;
        }

        if (!sb) {
          store.setMeta?.(templateId, patch);
          results.push({ templateId, ok: true });
          continue;
        }

        const { data: tpl } = await sb.from("templates").select("workspace_id").eq("id", templateId).maybeSingle();
        if (!tpl?.workspace_id) { results.push({ templateId, ok: false, error: "Template not found" }); continue; }

        const { data: existing } = await sb.from("design_file_meta").select("id").eq("template_id", templateId).maybeSingle();
        if (existing) {
          patch.updated_at = new Date().toISOString();
          const { error } = await sb.from("design_file_meta").update(patch).eq("template_id", templateId);
          results.push({ templateId, ok: !error, error: error?.message });
        } else {
          patch.template_id = templateId;
          patch.workspace_id = tpl.workspace_id;
          const { error } = await sb.from("design_file_meta").insert(patch);
          results.push({ templateId, ok: !error, error: error?.message });
        }
      } catch (err: any) {
        results.push({ templateId, ok: false, error: err.message });
      }
    }
    const failed = results.filter(r => !r.ok).length;
    res.json({ success: true, data: { total: templates.length, succeeded: results.length - failed, failed, results } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

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
        // The panel needs the workspace id to hit the CRM brand endpoints
        // (POST /api/workspaces/:id/brands) when the user adds a brand in
        // place — one table, every surface (CRM, grafo, panel) stays in sync.
        workspaceId: template.workspace_id,
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
    // A cover saved earlier in another format would otherwise linger forever.
    await removeStalePreviewFiles("design-covers", `${template.workspace_id}/covers`, templateId, path);

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
    category: row.category || "",
    content_kind: row.content_kind || "",
    asset_type: row.asset_type || "other",
    designer_type: row.designer_type || "other",
    is_permanent: Boolean(row.is_permanent),
    production_data: row.production_data || {},
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
