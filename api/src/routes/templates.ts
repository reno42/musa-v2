/**
 * Templates CRUD Routes
 * ──────────────────────────────────────────────────────────────
 * Full REST API for template lifecycle management with pagination.
 *
 * @module routes/templates
 * @requires express
 * @requires ../services/templates
 *
 * Database (Supabase: templates table):
 *   - id TEXT PK          → template identifier (tpl_xxxxxxxx)
 *   - name TEXT           → human-readable name
 *   - data JSONB          → full DesignTemplate object (canvas, layers, metadata)
 *   - user_id UUID        → owner (FK → auth.users)
 *   - created_at TIMESTAMPTZ
 *   - updated_at TIMESTAMPTZ (auto-updated via trigger)
 *
 * All endpoints require authentication (X-API-Key or Bearer token).
 */

import { Router } from "express";
import { v4 as uuid } from "uuid";
import DOMPurify from "dompurify";
import * as templates from "../services/templates.js";
import { store } from "../services/store.js";
import {
  validate,
  createTemplateSchema,
  updateTemplateSchema,
  duplicateTemplateSchema,
} from "../middleware/index.js";
import { canAccessWorkspace, listAccessibleWorkspaceIds } from "../services/tenancy.js";
import { createVersion, deleteAllVersions } from "../services/versionHistory.js";

export const templateRoutes = Router();

/**
 * POST /api/templates
 * ──────────────────────────────────────────────────────────────
 * Create a new design template. Optionally accepts a full canvas
 * JSON object for migration/import scenarios.
 *
 * @body {string} [name]          Template name (defaults to auto-generated)
 * @body {number} [width=1080]    Canvas width in pixels
 * @body {number} [height=1080]   Canvas height in pixels
 * @body {object} [canvas]        Canvas JSON for import (V2: use html/css/frames instead)
 *
 * @returns {201} { success, data: DesignTemplate }
 * @returns {400} Validation error
 *
 * DB: INSERT INTO templates
 */
templateRoutes.post("/", validate(createTemplateSchema), async (req, res) => {
  try {
    const { name, width, height, canvas, workspaceId, engine, html, css } = req.body;
    if (!req.auth || !(await canAccessWorkspace(req.auth, workspaceId, "editor"))) {
      return res.status(403).json({ success: false, error: "Editor access to the workspace is required" });
    }
    const tpl = await templates.createTemplate(name || "Untitled", width || 1080, height || 1080, canvas, req.auth!.userId, workspaceId);
    if (!tpl.id) {
      return res.status(500).json({ success: false, error: "Template creation failed: no ID returned" });
    }
    // HTML engine: create initial frame with content (consistent with MCP handler)
    if (engine === "html") {
      tpl.engine = "html";
      tpl.html = html || "";
      tpl.css = css || "";
      const defaultFrame = {
        id: `frame_${uuid().slice(0, 12)}`,
        templateId: tpl.id,
        name: name || "Frame 1",
        x: 0, y: 0,
        width: width || 1080, height: height || 1080,
        order: 0,
        objects: [],
        layoutMode: "NONE" as const,
        clipsContent: true,
        constraints: {},
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        html: html || "",
        css: css || "",
        background: "#ffffff",
      };
      tpl.frames = [defaultFrame as any];
      await templates.updateTemplate(tpl.id, {
        engine: "html",
        html: tpl.html,
        css: tpl.css,
        frames: tpl.frames,
      });
    } else if (engine || html !== undefined || css !== undefined) {
      if (engine) tpl.engine = engine;
      if (html !== undefined) tpl.html = html;
      if (css !== undefined) tpl.css = css;
      await templates.updateTemplate(tpl.id, {
        engine: tpl.engine,
        html: tpl.html,
        css: tpl.css,
        frames: tpl.frames || [],
      });
    }
    res.status(201).json({ success: true, data: tpl });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/templates
 * ──────────────────────────────────────────────────────────────
 * List templates with cursor-based pagination.
 *
 * @query {number} [limit=50]   Max items (capped at 100)
 * @query {number} [offset=0]   Skip N items from start
 *
 * @returns {200} { success, data: DesignTemplate[], total, limit, offset }
 *
 * DB: SELECT data FROM templates ORDER BY created_at DESC LIMIT/OFFSET
 */
templateRoutes.get("/", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
    const search = (req.query.search as string || "").toLowerCase();
    const workspaceId = req.query.workspaceId as string || undefined;
    const brandId = req.query.brandId as string || undefined;
    const accessibleIds = await listAccessibleWorkspaceIds(req.auth!);
    if (workspaceId && !accessibleIds.includes(workspaceId)) {
      return res.status(403).json({ success: false, error: "You do not have access to this workspace" });
    }

    // listTemplatesPaginated returns lean summaries (first frame only, no
    // versions/canvas) — see toListSummary in services/templates.ts (502 fix).
    let result;
    if (workspaceId) {
      result = await templates.listTemplatesPaginated(limit, offset, workspaceId, search);
    } else {
      const batches = await Promise.all(accessibleIds.map(id => templates.listTemplatesPaginated(1000, 0, id, search)));
      const all = batches.flatMap(batch => batch.data)
        .sort((a, b) => new Date(b.metadata.updatedAt).getTime() - new Date(a.metadata.updatedAt).getTime());
      result = { data: all.slice(offset, offset + limit), total: all.length };
    }

    // Brand filter: templates don't have brand_id directly; join via design_file_meta
    if (brandId && result.data.length > 0) {
      const { getSupabase } = await import("../services/supabase.js");
      const sb = getSupabase();
      if (sb) {
        const templateIds = result.data.map((t: any) => t.id);
        const { data: metaRows } = await sb.from("design_file_meta")
          .select("template_id")
          .eq("brand_id", brandId)
          .in("template_id", templateIds);
        const brandedIds = new Set((metaRows || []).map((r: any) => r.template_id));
        result.data = result.data.filter((t: any) => brandedIds.has(t.id));
        result.total = result.data.length;
      }
    }

    res.json({
      success: true,
      data: result.data,
      total: result.total,
      limit,
      offset,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/templates/trash
 * ──────────────────────────────────────────────────────────────
 * List soft-deleted templates (Trash view). Returns lean summaries
 * with deletedAt timestamp so the UI can show "X days remaining".
 *
 * NOTE: Registered BEFORE /:id so "trash" isn't captured as an ID param.
 *
 * @query {number} [limit=50]   Max items
 * @query {number} [offset=0]   Skip N items
 *
 * @returns {200} { success, data: DesignTemplate[], total, limit, offset }
 */
templateRoutes.get("/trash", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
    const result = await templates.listTrash(10_000, 0);
    const accessibleIds = await listAccessibleWorkspaceIds(req.auth!);
    result.data = result.data.filter((template) => accessibleIds.includes(template.workspaceId));
    result.total = result.data.length;
    res.json({ success: true, data: result.data.slice(offset, offset + limit), total: result.total, limit, offset });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/templates/:id
 * ──────────────────────────────────────────────────────────────
 * Fetch a single template by ID.
 *
 * @param {string} id  Template ID (tpl_xxxxxxxx)
 * @returns {200} { success, data: DesignTemplate }
 * @returns {404} Template not found
 *
 * DB: SELECT data FROM templates WHERE id = :id
 */
templateRoutes.get("/:id", async (req, res) => {
  try {
    const tpl = await templates.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    // Trim versions to last 10 on read to reduce payload size (502 fix)
    if (tpl.versions && tpl.versions.length > 10) {
      tpl.versions = tpl.versions.slice(-10);
    }
    res.json({ success: true, data: tpl });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PUT /api/templates/:id
 * ──────────────────────────────────────────────────────────────
 * Full replacement update. The editor sends the complete canvas
 * JSON (including objects, viewport) + optional metadata.
 *
 * @param {string} id              Template ID
 * @body {object} canvas           Canvas JSON with { objects[], viewport } (legacy — V2 uses html/css/frames)
 *
 * @returns {200} { success, data: DesignTemplate }
 * @returns {404} Template not found
 *
 * DB: UPDATE templates SET data = :data, name = :name WHERE id = :id
 */
templateRoutes.put("/:id", validate(updateTemplateSchema), async (req, res) => {
  try {
    const updates = { ...req.body };
    // Strip base64 images from HTML frames before storing (502 prevention)
    // Images should use Supabase Storage URLs, not inline data URIs
    if (updates.frames && Array.isArray(updates.frames)) {
      updates.frames = updates.frames.map((f: any) => {
        if (f.html && typeof f.html === "string" && f.html.includes("data:image/")) {
          f.html = f.html.replace(
            /data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/g,
            ""
          );
        }
        return f;
      });
    }
    if (updates.canvasObjects && Array.isArray(updates.canvasObjects)) {
      updates.canvasObjects = updates.canvasObjects.map((object: any) => ({
        ...object,
        frameId: null,
        html: typeof object.html === "string"
          ? object.html.replace(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/g, "")
          : "",
      }));
    }
    if (updates.html && typeof updates.html === "string" && updates.html.includes("data:image/")) {
      updates.html = updates.html.replace(
        /data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/g,
        ""
      );
    }
    // DOMPurify sanitization: if engine is html and html field is present
    const existing = await templates.getTemplate(req.params.id);
    const engine = updates.engine || existing?.engine;
    if (engine === "html" && updates.html) {
      try {
        updates.html = DOMPurify.sanitize(updates.html, {
          ALLOWED_TAGS: ["div","span","h1","h2","h3","h4","h5","h6","p","img","a","br","svg","path","g","circle","rect","line","polygon","polyline","text","tspan","section","article","header","footer","nav","main","ul","ol","li","button","strong","em","blockquote","code","pre","hr","table","tr","td","th","thead","tbody"],
          ALLOWED_ATTR: ["class","id","src","alt","href","data-layer-id","style","width","height","viewBox","fill","d","stroke","stroke-width","cx","cy","r","rx","ry","x","y","transform"],
        });
      } catch { /* keep original if sanitization fails */ }
    }
    // Snapshot the state BEFORE this write into the version history, so every
    // entry is a restorable earlier state. History lives in template_versions +
    // the design-versions bucket (see services/versionHistory.ts) — it used to
    // be appended to the data JSONB, which made every design open download its
    // whole history and was the original 502 source.
    //
    // Throttled: auto-save fires every couple of seconds while the user works,
    // and one stored version per keystroke burst is worthless and expensive.
    // Explicit saves (Ctrl/Cmd+S, Save button) bypass this via POST /versions.
    if (engine === "html" && existing && (updates.frames || updates.html !== undefined || updates.css !== undefined)) {
      const AUTO_VERSION_INTERVAL_MS = 5 * 60 * 1000;
      try {
        await createVersion(req.params.id, {
          kind: "auto",
          label: "Guardado automático",
          author: req.auth?.authType === "user" && req.auth.userId
            ? `human:${req.auth.userId}`
            : (req.headers["x-agent-name"] as string) || "human:local",
          minIntervalMs: AUTO_VERSION_INTERVAL_MS,
        });
      } catch (versionErr: any) {
        // History must never block a save.
        console.warn("[templates] auto version failed:", versionErr?.message);
      }
    }

    const tpl = await templates.updateTemplate(req.params.id, updates);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    res.json({ success: true, data: tpl });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/templates/:id
 * ──────────────────────────────────────────────────────────────
 * Soft-delete a template (move to Trash). Sets deleted_at so the
 * template is hidden from listings but recoverable for 30 days.
 *
 * @param {string} id  Template ID
 * @returns {200} { success: true }
 * @returns {404} Template not found
 *
 * DB: UPDATE templates SET deleted_at = NOW() WHERE id = :id
 */
templateRoutes.delete("/:id", async (req, res) => {
  try {
    const ok = await templates.deleteTemplate(req.params.id);
    if (!ok) return res.status(404).json({ success: false, error: "Template not found" });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Trash / Soft-delete routes ────────────────────────────

/**
 * PUT /api/templates/:id/restore
 * ──────────────────────────────────────────────────────────────
 * Restore a soft-deleted template from Trash (clears deleted_at).
 *
 * @param {string} id  Template ID
 * @returns {200} { success: true }
 * @returns {404} Template not found or not in trash
 */
templateRoutes.put("/:id/restore", async (req, res) => {
  try {
    const ok = await templates.restoreTemplate(req.params.id);
    if (!ok) return res.status(404).json({ success: false, error: "Template not found in trash" });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/templates/:id/permanent
 * ──────────────────────────────────────────────────────────────
 * Permanently delete a template (cannot be restored). Use only
 * from the Trash view for explicit user-initiated purge.
 *
 * @param {string} id  Template ID
 * @returns {200} { success: true }
 * @returns {404} Template not found
 *
 * DB: DELETE FROM templates WHERE id = :id
 */
templateRoutes.delete("/:id/permanent", async (req, res) => {
  try {
    const ok = await templates.purgeTemplate(req.params.id);
    if (!ok) return res.status(404).json({ success: false, error: "Template not found" });
    // Purging the design must take its history with it, or the version files
    // stay in the bucket forever with nothing pointing at them.
    await deleteAllVersions(req.params.id).catch(() => {});
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/templates/trash/purge-expired
 * ──────────────────────────────────────────────────────────────
 * Purge all templates that have been in trash for more than 30 days.
 * Called by a cron/scheduled job.
 *
 * @body {number} [olderThanDays=30]  Days threshold for purge
 *
 * @returns {200} { success, purged: number }
 */
templateRoutes.post("/trash/purge-expired", async (req, res) => {
  try {
    const olderThanDays = parseInt(req.body.olderThanDays as string) || 30;
    const workspaceId = String(req.body.workspaceId || "");
    if (!workspaceId || !req.auth || !(await canAccessWorkspace(req.auth, workspaceId, "editor"))) {
      return res.status(403).json({ success: false, error: "Editor access to the workspace is required" });
    }
    const count = await templates.purgeExpiredTemplates(olderThanDays, workspaceId);
    res.json({ success: true, purged: count });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/templates/:id/duplicate
 * ──────────────────────────────────────────────────────────────
 * Create an independent copy of an existing template.
 *
 * @param {string} id        Source template ID
 * @body {string} [name]     Name for the duplicate (default: "{original} (copy)")
 *
 * @returns {201} { success, data: DesignTemplate }
 * @returns {404} Source template not found
 *
 * DB: INSERT INTO templates (copied data with new id + timestamps)
 */
templateRoutes.post("/:id/duplicate", validate(duplicateTemplateSchema), async (req, res) => {
  try {
    const tpl = await templates.duplicateTemplate(req.params.id, req.body.name, req.auth?.userId);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    res.status(201).json({ success: true, data: tpl });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/templates/bulk/delete — delete multiple templates
templateRoutes.post("/bulk/delete", async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: "ids array required" });
    }
    const deleted: string[] = [];
    const notFound: string[] = [];
    for (const id of ids) {
      const template = await templates.getTemplate(id);
      if (!template || !req.auth || !(await canAccessWorkspace(req.auth, template.workspaceId, "editor"))) {
        notFound.push(id);
        continue;
      }
      const ok = await templates.deleteTemplate(id);
      if (ok) deleted.push(id);
      else notFound.push(id);
    }
    res.json({ success: true, data: { deleted, notFound, count: deleted.length } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/templates/:id/frames/bulk/delete — delete multiple frames
templateRoutes.post("/:id/frames/bulk/delete", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: "ids array required" });
    }
    const deleted: string[] = [];
    for (const id of ids) {
      const idx = tpl.frames.findIndex((f: any) => f.id === id);
      if (idx !== -1) { tpl.frames.splice(idx, 1); deleted.push(id); }
    }
    tpl.metadata.updatedAt = new Date().toISOString();
    res.json({ success: true, data: { deleted, count: deleted.length } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/templates/:id/export — export template as .futuraria JSON
templateRoutes.get("/:id/export", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    const exportData = {
      format: "futuraria/v1",
      exportedAt: new Date().toISOString(),
      template: {
        name: tpl.name,
        width: tpl.width,
        height: tpl.height,
        frames: tpl.frames,
        styles: tpl.styles,
        variables: tpl.variables,
        metadata: tpl.metadata,
      },
    };

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${tpl.name}.futuraria.json"`);
    res.json(exportData);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/templates/import — import a .futuraria JSON file
templateRoutes.post("/import", async (req, res) => {
  try {
    const { format, template: tplData, workspaceId } = req.body;

    if (format !== "futuraria/v1") {
      return res.status(400).json({ success: false, error: "Invalid format. Expected 'futuraria/v1'" });
    }
    if (!tplData || !tplData.name) {
      return res.status(400).json({ success: false, error: "template.name required" });
    }
    if (!workspaceId) {
      return res.status(400).json({ success: false, error: "workspaceId required" });
    }
    if (!req.auth || !(await canAccessWorkspace(req.auth, workspaceId, "editor"))) {
      return res.status(403).json({ success: false, error: "Editor access to the workspace is required" });
    }

    const newTpl = store.createTemplate({
      workspaceId,
      name: tplData.name,
      width: tplData.width || 1080,
      height: tplData.height || 1080,
      userId: req.auth!.userId,
    });

    // Restore additional data
    if (tplData.frames) newTpl.frames = tplData.frames;
    if (tplData.styles) newTpl.styles = tplData.styles;
    if (tplData.variables) newTpl.variables = tplData.variables;

    res.status(201).json({ success: true, data: newTpl });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
