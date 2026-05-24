/**
 * Template Versions Routes
 * ──────────────────────────────────────────────────────────────
 * Version history management for design templates. Each save
 * can create an immutable snapshot with auto-incrementing
 * version numbers. Supports restore to any previous version.
 *
 * @module routes/versions
 *
 * Database (Supabase: template_versions table):
 *   - id TEXT PK              → version identifier (ver_xxxxxxxx)
 *   - template_id TEXT FK     → parent template (CASCADE delete)
 *   - version_number INTEGER  → auto-incrementing (1, 2, 3...)
 *   - data JSONB              → full DesignTemplate snapshot
 *   - author TEXT             → who created this version
 *   - message TEXT            → optional changelog message
 *   - created_at TIMESTAMPTZ
 *
 * @webhook Fires: version.created
 */

import { Router } from "express";
import { v4 as uuid } from "uuid";
import { getSupabase } from "../services/supabase";
import { getTemplate } from "../services/templates";
import { validate, createVersionSchema } from "../middleware";

export const versionRoutes = Router();

const memoryStore = new Map<string, any[]>();

/**
 * POST /api/templates/:id/versions
 * ──────────────────────────────────────────────────────────────
 * Save a new version snapshot of the current template state.
 * Version numbers auto-increment per template.
 *
 * @param {string} id        Template ID
 * @body {object} [data]     Template data to snapshot (defaults to current state)
 * @body {string} [author]   Version author name
 * @body {string} [message]  Changelog message
 *
 * @returns {201} { success, data: Version }
 * @returns {404} Template not found
 *
 * DB: SELECT MAX(version_number) + 1 FROM template_versions
 *     INSERT INTO template_versions (id, template_id, version_number, data, author, message)
 */
versionRoutes.post("/:id/versions", validate(createVersionSchema), async (req, res) => {
  try {
    const templateId = req.params.id;
    const template = await getTemplate(templateId);
    if (!template) return res.status(404).json({ success: false, error: "Template not found" });

    // Get current version number
    let versionNumber = 1;
    const db = getSupabase();

    if (db) {
      const { data: existing } = await db
        .from("template_versions")
        .select("version_number")
        .eq("template_id", templateId)
        .order("version_number", { ascending: false })
        .limit(1)
        .single();
      if (existing) versionNumber = existing.version_number + 1;
    } else {
      const versions = memoryStore.get(templateId) || [];
      if (versions.length > 0) versionNumber = versions[versions.length - 1].versionNumber + 1;
    }

    const version = {
      id: `ver_${uuid().slice(0, 8)}`,
      templateId,
      versionNumber,
      data: req.body.data || template,
      author: req.body.author || null,
      message: req.body.message || null,
      createdAt: new Date().toISOString(),
    };

    if (db) {
      await db.from("template_versions").insert({
        id: version.id,
        template_id: templateId,
        version_number: versionNumber,
        data: version.data,
        author: version.author,
        message: version.message,
      });
    } else {
      const versions = memoryStore.get(templateId) || [];
      versions.push(version);
      memoryStore.set(templateId, versions);
    }

    res.status(201).json({ success: true, data: version });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/templates/:id/versions
 * ──────────────────────────────────────────────────────────────
 * List version history for a template with pagination.
 *
 * @param {string} id         Template ID
 * @query {number} [limit=50] Max results (capped at 100)
 * @query {number} [offset=0] Pagination offset
 *
 * @returns {200} { success, data: Version[], total, limit, offset }
 *
 * DB: SELECT * FROM template_versions WHERE template_id = :id
 *     ORDER BY version_number DESC LIMIT :limit OFFSET :offset
 */
versionRoutes.get("/:id/versions", async (req, res) => {
  try {
    const templateId = req.params.id;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

    const db = getSupabase();

    if (db) {
      const { data, count } = await db
        .from("template_versions")
        .select("*", { count: "exact" })
        .eq("template_id", templateId)
        .order("version_number", { ascending: false })
        .range(offset, offset + limit - 1);

      const versions = (data || []).map((r: any) => ({
        id: r.id,
        templateId: r.template_id,
        versionNumber: r.version_number,
        data: r.data,
        author: r.author,
        message: r.message,
        createdAt: r.created_at,
      }));

      res.json({ success: true, data: versions, total: count || 0, limit, offset });
    } else {
      const all = memoryStore.get(templateId) || [];
      const sorted = [...all].sort((a, b) => b.versionNumber - a.versionNumber);
      res.json({
        success: true,
        data: sorted.slice(offset, offset + limit),
        total: sorted.length,
        limit,
        offset,
      });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/templates/:id/versions/:versionId
 * @param {string} id          Template ID
 * @param {string} versionId   Version ID (ver_xxxxxxxx)
 * @returns {200} { success, data: Version } | {404}
 * DB: SELECT * FROM template_versions WHERE id = :versionId
 */
versionRoutes.get("/:id/versions/:versionId", async (req, res) => {
  try {
    const db = getSupabase();
    let version: any = null;

    if (db) {
      const { data } = await db
        .from("template_versions")
        .select("*")
        .eq("id", req.params.versionId)
        .single();
      if (data) {
        version = {
          id: data.id,
          templateId: data.template_id,
          versionNumber: data.version_number,
          data: data.data,
          author: data.author,
          message: data.message,
          createdAt: data.created_at,
        };
      }
    } else {
      const versions = memoryStore.get(req.params.id) || [];
      version = versions.find((v) => v.id === req.params.versionId) || null;
    }

    if (!version) return res.status(404).json({ success: false, error: "Version not found" });
    res.json({ success: true, data: version });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/templates/:id/versions/:versionId/restore
 * ──────────────────────────────────────────────────────────────
 * Restore the template to a previous version snapshot.
 * Replaces the current template data with the version's data.
 *
 * @param {string} id          Template ID
 * @param {string} versionId   Version ID to restore from
 *
 * @returns {200} { success, data: DesignTemplate }
 * @returns {404} Version or template not found
 *
 * DB: SELECT data FROM template_versions WHERE id = :versionId
 *     UPDATE templates SET data = :restoredData WHERE id = :templateId
 */
versionRoutes.post("/:id/versions/:versionId/restore", async (req, res) => {
  try {
    const templateId = req.params.id;
    const db = getSupabase();
    let version: any = null;

    if (db) {
      const { data } = await db
        .from("template_versions")
        .select("*")
        .eq("id", req.params.versionId)
        .single();
      if (data) {
        version = {
          data: data.data,
        };
      }
    } else {
      const versions = memoryStore.get(templateId) || [];
      version = versions.find((v) => v.id === req.params.versionId) || null;
    }

    if (!version) return res.status(404).json({ success: false, error: "Version not found" });

    // Restore template data
    const { updateTemplate } = await import("../services/templates");
    const restored = await updateTemplate(templateId, version.data);

    if (!restored) return res.status(404).json({ success: false, error: "Template not found" });
    res.json({ success: true, data: restored });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
