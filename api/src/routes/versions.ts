import { Router } from "express";
import { v4 as uuid } from "uuid";
import { store } from "../services/store.js";
import { z } from "zod";
import { validate } from "../middleware/validate.js";

export const versionRoutes = Router();

const createSchema = z.object({
  label: z.string().min(1).max(200).optional(),
});

versionRoutes.post("/:id/versions", validate(createSchema), async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    const version = {
      id: `ver_${uuid().slice(0, 12)}`,
      templateId: tpl.id,
      label: req.body.label || `Snapshot ${new Date().toLocaleString()}`,
      canvas: null,
      html: tpl.html,
      css: tpl.css,
      createdAt: new Date().toISOString(),
    };
    tpl.versions.push(version);
    tpl.metadata.updatedAt = new Date().toISOString();
    res.status(201).json({ success: true, data: version });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

versionRoutes.get("/:id/versions", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
    const data = tpl.versions.slice(offset, offset + limit);
    res.json({ success: true, data, total: tpl.versions.length, limit, offset });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

versionRoutes.get("/:id/versions/:versionId", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    const v = tpl.versions.find(ver => ver.id === req.params.versionId);
    if (!v) return res.status(404).json({ success: false, error: "Version not found" });
    res.json({ success: true, data: v });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

versionRoutes.post("/:id/versions/:versionId/restore", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    const v = tpl.versions.find(ver => ver.id === req.params.versionId);
    if (!v) return res.status(404).json({ success: false, error: "Version not found" });
    // V2 restore: html/css/frames are restored from version
    if (v.html !== undefined) tpl.html = v.html;
    if (v.css !== undefined) tpl.css = v.css;
    tpl.metadata.updatedAt = new Date().toISOString();
    res.json({ success: true, data: { message: "Version restored" } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

versionRoutes.delete("/:id/versions/:versionId", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    const idx = tpl.versions.findIndex(ver => ver.id === req.params.versionId);
    if (idx === -1) return res.status(404).json({ success: false, error: "Version not found" });
    tpl.versions.splice(idx, 1);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
