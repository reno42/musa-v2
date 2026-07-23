import { Router } from "express";
import { store } from "../services/store.js";
import { getSupabase } from "../services/supabase.js";
import { slugify } from "../services/slugify.js";
import {
  validate, createWorkspaceSchema, updateWorkspaceSchema, addMemberSchema,
} from "../middleware/index.js";
import type { Workspace } from "../types.js";
import type { RequestAuth } from "../services/requestContext.js";
import { listAccessibleWorkspaceIds, requireWorkspaceRole } from "../services/tenancy.js";
import * as templates from "../services/templates.js";

type SupabaseWsRow = {
  id: string;
  name: string;
  owner_id: string;
  data: Workspace;
  created_at: string;
  updated_at: string;
};

function rowToWorkspace(row: SupabaseWsRow): Workspace {
  return {
    ...row.data,
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listFromSupabase(auth: RequestAuth): Promise<Workspace[] | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const accessibleIds = await listAccessibleWorkspaceIds(auth);
    if (accessibleIds.length === 0) return [];
    const { data, error } = await sb.from("workspaces").select("*").in("id", accessibleIds).order("updated_at", { ascending: false });
    if (error) throw error;
    const workspaces = (data || []).map((r: any) => rowToWorkspace(r));

    // If the workspaces table is empty but templates reference workspace IDs,
    // auto-create workspace records so the Dashboard Data tab isn't blank.
    if (workspaces.length === 0 && auth.authType === "dev") {
      await syncWorkspacesFromTemplates(sb);
      // Re-fetch after sync
      const { data: refetched, error: refetchErr } = await sb.from("workspaces").select("*").order("updated_at", { ascending: false });
      if (refetchErr) throw refetchErr;
      return (refetched || []).map((r: any) => rowToWorkspace(r));
    }

    return workspaces;
  } catch (e) {
    console.warn("[workspaces] Supabase list failed:", (e as Error).message);
    return null;
  }
}

/** Auto-creates workspace records from template workspace_id references. */
async function syncWorkspacesFromTemplates(sb: ReturnType<typeof getSupabase>) {
  if (!sb) return;
  try {
    // Get all unique workspace_ids from templates
    const { data: tpls, error: tplErr } = await sb.from("templates")
      .select("workspace_id, name")
      .not("workspace_id", "is", null);
    if (tplErr || !tpls?.length) return;

    // Deduplicate by workspace_id, using the first template's name as workspace name
    const seen = new Map<string, string>();
    for (const t of tpls as any[]) {
      if (!seen.has(t.workspace_id) && t.workspace_id) {
        seen.set(t.workspace_id, t.name || "Workspace");
      }
    }

    // Upsert workspaces
    const rows = [...seen.entries()].map(([id, tplName]) => ({
      id,
      name: tplName.replace(/^(.+?)\s*[-–—].*$/, "$1").trim() || "Workspace",
      slug: slugify(tplName.replace(/^(.+?)\s*[-–—].*$/, "$1").trim() || "Workspace"),
      owner_id: "dev_user_default",
      data: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    if (rows.length > 0) {
      const { error: upsertErr } = await sb.from("workspaces").upsert(rows);
      if (upsertErr) {
        // slug column added by v7 migration — retry without it if missing
        if (upsertErr.message?.includes("slug") && upsertErr.message?.includes("does not exist")) {
          const rowsNoSlug = rows.map(({ slug: _, ...rest }) => rest);
          const { error: err2 } = await sb.from("workspaces").upsert(rowsNoSlug);
          if (err2) console.warn("[workspaces] sync upsert failed (retry):", err2.message);
        } else {
          console.warn("[workspaces] sync upsert failed:", upsertErr.message);
        }
      }
    }
  } catch (e) {
    console.warn("[workspaces] sync failed:", (e as Error).message);
  }
}

async function upsertSupabase(ws: Workspace) {
  const sb = getSupabase();
  if (!sb) return;
  try {
    const row: Record<string, any> = {
      id: ws.id,
      name: ws.name,
      slug: ws.slug || slugify(ws.name),
      owner_id: ws.ownerId,
      data: ws,
      updated_at: new Date().toISOString(),
    };
    const { error } = await sb.from("workspaces").upsert(row);
    if (error) {
      // slug column added by v7 migration — retry without it if missing
      if (error.message?.includes("slug") && error.message?.includes("does not exist")) {
        delete row.slug;
        const { error: retryError } = await sb.from("workspaces").upsert(row);
        if (retryError) throw retryError;
      } else {
        throw error;
      }
    }
  } catch (e) {
    console.warn("[workspaces] Supabase upsert failed:", (e as Error).message);
    throw e;
  }
}

async function deleteFromSupabase(id: string) {
  const sb = getSupabase();
  if (!sb) return;
  try { await sb.from("workspaces").delete().eq("id", id); } catch {}
}

export const workspaceRoutes = Router();

workspaceRoutes.post("/", validate(createWorkspaceSchema), async (req, res) => {
  try {
    if (req.auth?.authType === "workspace_key") {
      return res.status(403).json({ success: false, error: "Workspace API keys cannot create workspaces" });
    }
    const ws = store.createWorkspace({
      name: req.body.name,
      description: req.body.description,
      ownerId: req.auth!.userId,
    });
    await upsertSupabase(ws);
    const sb = getSupabase();
    if (sb && /^[0-9a-f-]{36}$/i.test(req.auth!.userId)) {
      await sb.from("workspace_members").upsert({ workspace_id: ws.id, user_id: req.auth!.userId, role: "owner" });
    }
    res.status(201).json({ success: true, data: ws });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

workspaceRoutes.get("/", async (req, res) => {
  try {
    const fromSb = await listFromSupabase(req.auth!);
    if (fromSb) return res.json({ success: true, data: fromSb, total: fromSb.length });
    const data = store.listWorkspaces(req.auth!.userId);
    res.json({ success: true, data, total: data.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

workspaceRoutes.get("/:id", requireWorkspaceRole("viewer"), async (req, res) => {
  try {
    let ws = store.getWorkspace(req.params.id);
    if (!ws) {
      const sb = getSupabase();
      if (sb) {
        const { data } = await sb.from("workspaces").select("*").eq("id", req.params.id).maybeSingle();
        if (data) ws = rowToWorkspace(data as SupabaseWsRow);
      }
    }
    if (!ws) return res.status(404).json({ success: false, error: "Workspace not found" });
    res.json({ success: true, data: ws });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

workspaceRoutes.put("/:id", requireWorkspaceRole("admin"), validate(updateWorkspaceSchema), async (req, res) => {
  try {
    let ws = store.updateWorkspace(req.params.id, req.body);
    if (!ws) {
      const sb = getSupabase();
      if (sb) {
        const { data } = await sb.from("workspaces").select("*").eq("id", req.params.id).maybeSingle();
        if (data) ws = { ...rowToWorkspace(data as SupabaseWsRow), ...req.body, updatedAt: new Date().toISOString() };
      }
    }
    if (!ws) return res.status(404).json({ success: false, error: "Workspace not found" });
    await upsertSupabase(ws);
    res.json({ success: true, data: ws });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

workspaceRoutes.delete("/:id", requireWorkspaceRole("owner"), async (req, res) => {
  try {
    store.deleteWorkspace(req.params.id);
    await deleteFromSupabase(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

workspaceRoutes.post("/:id/members", requireWorkspaceRole("admin"), validate(addMemberSchema), async (req, res) => {
  try {
    const ws = store.addMember(req.params.id, req.body.userId);
    if (!ws) return res.status(404).json({ success: false, error: "Workspace not found" });
    await upsertSupabase(ws);
    res.json({ success: true, data: ws });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

workspaceRoutes.get("/:id/templates", requireWorkspaceRole("viewer"), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
    const result = await templates.listTemplatesPaginated(limit, offset, req.params.id);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/workspaces/:id/texts
 * ──────────────────────────────────────────────────────────────
 * Efficient text extraction: single Supabase query pulling only
 * frames data (not full template JSONB), then cheerio scan.
 * Replaces the heavy list_all_texts MCP call that timed out at 10s.
 */
workspaceRoutes.get("/:id/texts", requireWorkspaceRole("viewer"), async (req, res) => {
  try {
    const sb = getSupabase();
    if (!sb) {
      return res.json({ success: true, texts: [], frames: [], templatesScanned: 0 });
    }

    // Single query: only frames + thumbnail, NOT the full data column
    const { data: rows, error } = await sb
      .from("templates")
      .select("id, name, data->frames, data->>thumbnail")
      .eq("workspace_id", req.params.id)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    // Parallel fetch of design_file_meta for metadata enrichment
    const tplIds = (rows || []).map((r: any) => r.id);
    const metaMap = new Map<string, any>();
    if (tplIds.length > 0) {
      const { data: metaData } = await sb
        .from("design_file_meta")
        .select("template_id, brand, campaign, format, file_type, cover_image_url")
        .in("template_id", tplIds);
      if (metaData) {
        for (const row of metaData) metaMap.set(row.template_id, row);
      }
    }

    const TEXT_TAGS = "h1, h2, h3, h4, h5, h6, p, span, a, button, li, label, div, td, th, strong, em, blockquote, figcaption, caption, small, mark";
    const allTexts: any[] = [];
    const framePreviews = new Map<string, any>();

    // Import once outside the loop
    const { load: cheerioLoad } = await import("cheerio");

    for (const row of rows || []) {
      const frames: any[] = Array.isArray(row.frames) ? row.frames : [];
      if (frames.length === 0) continue;
      const meta = metaMap.get(row.id) || {};

      for (const frame of frames) {
        const f: any = frame;
        if (!f.html) continue;

        // Build frame preview
        if (!framePreviews.has(f.id)) {
          framePreviews.set(f.id, {
            frameId: f.id,
            frameName: f.name || f.id,
            templateId: row.id,
            templateName: row.name,
            frameWidth: f.width || 1080,
            frameHeight: f.height || 1080,
            frameHtml: f.html || "",
            frameCss: f.css || "",
            frameBackground: f.background || null,
            brand: meta.brand || "",
            campaign: meta.campaign || "",
            format: meta.format || "",
            fileType: meta.file_type || "",
            coverImage: meta.cover_image_url || row.thumbnail || null,
          });
        }

        const $ = cheerioLoad(f.html);
        $(TEXT_TAGS).each((_, el) => {
          const $el = $(el);
          let ownText = "";
          const node = $el[0];
          if (node && node.children) {
            for (const child of node.children) {
              if (child.type === "text") ownText += child.data || "";
            }
          }
          ownText = ownText.trim();
          if (!ownText) return;

          allTexts.push({
            templateId: row.id,
            templateName: row.name,
            frameId: f.id,
            frameName: f.name || f.id,
            location: "frame",
            layerId: $el.attr("data-layer-id") || null,
            layerName: $el.attr("data-layer-name") || null,
            tag: ($el.prop("tagName") || "").toLowerCase(),
            text: ownText,
            charCount: ownText.length,
            brand: meta.brand || "",
            campaign: meta.campaign || "",
            format: meta.format || "",
            fileType: meta.file_type || "",
          });
        });
      }
    }

    res.json({
      success: true,
      texts: allTexts,
      frames: [...framePreviews.values()],
      autoTagged: 0,
      templatesScanned: (rows || []).length,
      templatesUpdated: 0,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
