import { Router } from "express";
import { getSupabase } from "../services/supabase.js";
import { canAccessWorkspace } from "../services/tenancy.js";

/**
 * REQ-PHOTO-PLATFORM-001 (REQ-32) — persistencia del Modo Foto.
 *
 * Modelo Lightroom: la foto NUNCA se sobrescribe. Cada edición es una receta
 * JSON versionada (photo_versions) dentro del documento de revelado
 * (photo_documents, uno por foto fuente por workspace). La metadata tipo
 * Library (rating/flag/keywords) vive en photo_catalog_items.
 *
 * Todo el procesamiento pesado es client-side (WebGL2); estas rutas solo
 * guardan instrucciones y metadata — bytes de variantes van por
 * /api/assets/upload al Storage existente. Esto corre igual en el CF Worker
 * (express-shim) y en el bridge local: cero rutas/colas de Netlify.
 */

export const photoRoutes = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function dbUserId(userId: string): string | null {
  return UUID_RE.test(userId) ? userId : null;
}

const PHOTO_SCHEMA_VERSION = 1;
const PHOTO_FLAGS = new Set(["pick", "reject", "unflagged"]);

function bad(res: any, status: number, error: string) {
  return res.status(status).json({ success: false, error });
}

/** POST /api/photos/documents — upsert del documento + primera versión opcional */
photoRoutes.post("/documents", async (req, res) => {
  try {
    const sb = getSupabase();
    if (!sb) return bad(res, 503, "Supabase no está configurado");
    const { workspaceId, sourceUrl, sourceAssetId, recipe, label, mode } = req.body || {};
    if (!workspaceId) return bad(res, 400, "workspaceId is required");
    if (!sourceUrl) return bad(res, 400, "sourceUrl is required");
    if (!req.auth || !(await canAccessWorkspace(req.auth, workspaceId, "editor"))) {
      return bad(res, 403, "Editor access to the workspace is required");
    }

    const { data: doc, error } = await sb.from("photo_documents").upsert(
      {
        workspace_id: workspaceId,
        source_url: sourceUrl,
        source_asset_id: typeof sourceAssetId === "string" && sourceAssetId ? sourceAssetId : null,
        mode: mode === "composition" ? "composition" : "develop",
        created_by: dbUserId(req.auth!.userId),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,source_url" }
    ).select("*").single();
    if (error) throw error;

    // Sembrar la primera versión solo cuando el documento es nuevo (sin
    // versiones): reabrir la misma foto nunca debe duplicar historial.
    let firstVersion: any = null;
    if (recipe && typeof recipe === "object") {
      const { count, error: countErr } = await sb.from("photo_versions")
        .select("id", { count: "exact", head: true }).eq("document_id", doc.id);
      if (countErr) throw countErr;
      if (!count) {
        const { data: version, error: vErr } = await sb.from("photo_versions").insert({
          document_id: doc.id,
          workspace_id: workspaceId,
          label: typeof label === "string" ? label : "Original",
          recipe_json: recipe,
          schema_version: PHOTO_SCHEMA_VERSION,
          created_by: dbUserId(req.auth!.userId),
        }).select("*").single();
        if (vErr) throw vErr;
        firstVersion = version;
        const { error: actErr } = await sb.from("photo_documents")
          .update({ active_version_id: version.id, updated_at: new Date().toISOString() })
          .eq("id", doc.id);
        if (actErr) throw actErr;
      }
    }

    res.status(201).json({ success: true, document: doc, version: firstVersion });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** GET /api/photos/documents?workspaceId&sourceUrl — documento + historial */
photoRoutes.get("/documents", async (req, res) => {
  try {
    const sb = getSupabase();
    if (!sb) return bad(res, 503, "Supabase no está configurado");
    const workspaceId = String(req.query.workspaceId || "");
    const sourceUrl = String(req.query.sourceUrl || "");
    if (!workspaceId) return bad(res, 400, "workspaceId is required");
    if (!req.auth || !(await canAccessWorkspace(req.auth, workspaceId, "viewer"))) {
      return bad(res, 403, "Workspace access is required");
    }

    let q = sb.from("photo_documents").select("*").eq("workspace_id", workspaceId);
    if (sourceUrl) q = q.eq("source_url", sourceUrl);
    q = q.order("updated_at", { ascending: false }).limit(sourceUrl ? 1 : 50);
    const { data: docs, error } = await q;
    if (error) throw error;
    const document = sourceUrl ? (docs || [])[0] || null : null;

    let versions: any[] = [];
    if (document) {
      const { data, error: vErr } = await sb.from("photo_versions")
        .select("id, parent_version_id, label, recipe_json, schema_version, created_by, created_at")
        .eq("document_id", document.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (vErr) throw vErr;
      versions = data || [];
    }

    res.json({ success: true, document, versions });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

async function loadDocumentForWrite(sb: any, req: any, res: any) {
  const { data: doc, error } = await sb.from("photo_documents")
    .select("*").eq("id", req.params.id).maybeSingle();
  if (error) throw error;
  if (!doc) {
    bad(res, 404, "Photo document not found");
    return null;
  }
  if (!req.auth || !(await canAccessWorkspace(req.auth, doc.workspace_id, "editor"))) {
    bad(res, 403, "Editor access to the workspace is required");
    return null;
  }
  return doc;
}

/** POST /api/photos/documents/:id/versions — nueva versión de receta */
photoRoutes.post("/documents/:id/versions", async (req, res) => {
  try {
    const sb = getSupabase();
    if (!sb) return bad(res, 503, "Supabase no está configurado");
    const doc = await loadDocumentForWrite(sb, req, res);
    if (!doc) return;
    const { recipe, label, parentVersionId } = req.body || {};
    if (!recipe || typeof recipe !== "object") return bad(res, 400, "recipe object is required");

    const { data: version, error } = await sb.from("photo_versions").insert({
      document_id: doc.id,
      workspace_id: doc.workspace_id,
      parent_version_id: typeof parentVersionId === "string" && parentVersionId ? parentVersionId : doc.active_version_id || null,
      label: typeof label === "string" && label.trim() ? label.trim() : "Edición",
      recipe_json: recipe,
      schema_version: PHOTO_SCHEMA_VERSION,
      created_by: dbUserId(req.auth!.userId),
    }).select("*").single();
    if (error) throw error;

    const { error: actErr } = await sb.from("photo_documents")
      .update({ active_version_id: version.id, updated_at: new Date().toISOString() })
      .eq("id", doc.id);
    if (actErr) throw actErr;

    res.status(201).json({ success: true, version });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** POST /api/photos/documents/:id/restore — volver a cualquier versión */
photoRoutes.post("/documents/:id/restore", async (req, res) => {
  try {
    const sb = getSupabase();
    if (!sb) return bad(res, 503, "Supabase no está configurado");
    const doc = await loadDocumentForWrite(sb, req, res);
    if (!doc) return;
    const versionId = String(req.body?.versionId || "");
    if (!versionId) return bad(res, 400, "versionId is required");

    const { data: version, error } = await sb.from("photo_versions")
      .select("id, label, recipe_json, created_at")
      .eq("id", versionId).eq("document_id", doc.id).maybeSingle();
    if (error) throw error;
    if (!version) return bad(res, 404, "Version not found for this document");

    const { error: actErr } = await sb.from("photo_documents")
      .update({ active_version_id: version.id, updated_at: new Date().toISOString() })
      .eq("id", doc.id);
    if (actErr) throw actErr;

    res.json({ success: true, version });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** GET /api/photos/catalog?workspaceId — metadata tipo Library del workspace */
photoRoutes.get("/catalog", async (req, res) => {
  try {
    const sb = getSupabase();
    if (!sb) return bad(res, 503, "Supabase no está configurado");
    const workspaceId = String(req.query.workspaceId || "");
    if (!workspaceId) return bad(res, 400, "workspaceId is required");
    if (!req.auth || !(await canAccessWorkspace(req.auth, workspaceId, "viewer"))) {
      return bad(res, 403, "Workspace access is required");
    }
    const { data, error } = await sb.from("photo_catalog_items")
      .select("*").eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false }).limit(200);
    if (error) throw error;
    res.json({ success: true, items: data || [] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** PUT /api/photos/catalog — rating / flag / color label / keywords por asset */
photoRoutes.put("/catalog", async (req, res) => {
  try {
    const sb = getSupabase();
    if (!sb) return bad(res, 503, "Supabase no está configurado");
    const { workspaceId, assetId, sourceUrl, rating, flag, colorLabel, keywords } = req.body || {};
    if (!workspaceId) return bad(res, 400, "workspaceId is required");
    if (!assetId) return bad(res, 400, "assetId is required");
    if (!req.auth || !(await canAccessWorkspace(req.auth, workspaceId, "editor"))) {
      return bad(res, 403, "Editor access to the workspace is required");
    }

    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    if (rating !== undefined) {
      const r = Number(rating);
      if (!Number.isFinite(r) || r < 0 || r > 5) return bad(res, 400, "rating must be 0..5");
      patch.rating = Math.round(r);
    }
    if (flag !== undefined) {
      if (!PHOTO_FLAGS.has(flag)) return bad(res, 400, "flag must be pick|reject|unflagged");
      patch.flag = flag;
    }
    if (colorLabel !== undefined) patch.color_label = colorLabel === null ? null : String(colorLabel);
    if (keywords !== undefined) {
      if (!Array.isArray(keywords)) return bad(res, 400, "keywords must be an array");
      patch.keywords = keywords.slice(0, 50).map((k: any) => String(k).slice(0, 60));
    }

    const { data: item, error } = await sb.from("photo_catalog_items").upsert(
      {
        workspace_id: workspaceId,
        asset_id: String(assetId),
        source_url: typeof sourceUrl === "string" ? sourceUrl : null,
        ...patch,
      },
      { onConflict: "workspace_id,asset_id" }
    ).select("*").single();
    if (error) throw error;

    res.json({ success: true, item });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
