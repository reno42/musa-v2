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
import * as templates from "../services/templates.js";
import { store } from "../services/store.js";
import {
  validate,
  createTemplateSchema,
  updateTemplateSchema,
  duplicateTemplateSchema,
} from "../middleware/index.js";

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
 * @body {object} [canvas]        Full Fabric.js canvas JSON for import
 *
 * @returns {201} { success, data: DesignTemplate }
 * @returns {400} Validation error
 *
 * DB: INSERT INTO templates
 */
templateRoutes.post("/", validate(createTemplateSchema), async (req, res) => {
  try {
    const { name, width, height, canvas, workspaceId } = req.body;
    const tpl = await templates.createTemplate(name, width || 1080, height || 1080, canvas, req.auth!.userId, workspaceId);
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

    const result = await templates.listTemplatesPaginated(limit, offset, workspaceId, search);

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
 * @body {object} canvas           Fabric.js canvas JSON with { objects[], viewport }
 * @body {string} [name]           New name
 * @body {object} [metadata]       { updatedAt } timestamp
 *
 * @returns {200} { success, data: DesignTemplate }
 * @returns {404} Template not found
 *
 * DB: UPDATE templates SET data = :data, name = :name WHERE id = :id
 *     Note: layers[] in data is separate from canvas.objects (see services/templates.ts)
 */
templateRoutes.put("/:id", validate(updateTemplateSchema), async (req, res) => {
  try {
    const tpl = await templates.updateTemplate(req.params.id, req.body);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    res.json({ success: true, data: tpl });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/templates/:id
 * ──────────────────────────────────────────────────────────────
 * Permanently delete a template and all related data (cascading:
 * versions, comments, render_logs, variables).
 *
 * @param {string} id  Template ID
 * @returns {200} { success: true }
 * @returns {404} Template not found
 *
 * DB: DELETE FROM templates WHERE id = :id
 *     CASCADE: template_versions, comments, render_logs, variables
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
        canvas: tpl.canvas,
        frames: tpl.frames,
        styles: tpl.styles,
        variables: tpl.variables,
        metadata: tpl.metadata,
      },
    };

    res.setHeader("Content-Type", "application/json");
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

    const newTpl = store.createTemplate({
      workspaceId,
      name: tplData.name,
      width: tplData.width || 1080,
      height: tplData.height || 1080,
      canvas: tplData.canvas || { objects: [], viewport: { x: 0, y: 0, zoom: 1 } },
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
