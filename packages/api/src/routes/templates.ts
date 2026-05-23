// packages/api/src/routes/templates.ts
// Templates CRUD with pagination

import { Router } from "express";
import * as templates from "../services/templates";
import {
  validate,
  createTemplateSchema,
  updateTemplateSchema,
  duplicateTemplateSchema,
} from "../middleware";

export const templateRoutes = Router();

// Create template
templateRoutes.post("/", validate(createTemplateSchema), async (req, res) => {
  try {
    const { name, width, height, canvas } = req.body;
    const tpl = await templates.createTemplate(name, width || 1080, height || 1080, canvas, req.auth?.userId);
    res.status(201).json({ success: true, data: tpl });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// List templates with pagination
templateRoutes.get("/", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

    const result = await templates.listTemplatesPaginated(limit, offset);
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

// Get single template
templateRoutes.get("/:id", async (req, res) => {
  try {
    const tpl = await templates.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    res.json({ success: true, data: tpl });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update template (full replace)
templateRoutes.put("/:id", validate(updateTemplateSchema), async (req, res) => {
  try {
    const tpl = await templates.updateTemplate(req.params.id, req.body);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    res.json({ success: true, data: tpl });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete template
templateRoutes.delete("/:id", async (req, res) => {
  try {
    const ok = await templates.deleteTemplate(req.params.id);
    if (!ok) return res.status(404).json({ success: false, error: "Template not found" });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Duplicate template
templateRoutes.post("/:id/duplicate", validate(duplicateTemplateSchema), async (req, res) => {
  try {
    const tpl = await templates.duplicateTemplate(req.params.id, req.body.name, req.auth?.userId);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    res.status(201).json({ success: true, data: tpl });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
