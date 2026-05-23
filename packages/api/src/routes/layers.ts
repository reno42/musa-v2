import { Router } from "express";
import * as templates from "../services/templates";

export const layerRoutes = Router();

// List layers in a template
layerRoutes.get("/:id/layers", async (req, res) => {
  try {
    const tpl = await templates.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    res.json({ success: true, data: tpl.layers });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get specific layer by name
layerRoutes.get("/:id/layers/:name", async (req, res) => {
  try {
    const tpl = await templates.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    const layer = tpl.layers.find((l) => l.name === req.params.name);
    if (!layer) return res.status(404).json({ success: false, error: "Layer not found" });
    res.json({ success: true, data: layer });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Modify layer properties (the money endpoint)
layerRoutes.patch("/:id/layers/:name", async (req, res) => {
  try {
    const overrides = { [req.params.name]: req.body };
    const tpl = await templates.applyLayerOverrides(req.params.id, overrides);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    const layer = tpl.layers.find((l) => l.name === req.params.name);
    res.json({ success: true, data: layer });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Batch modify multiple layers
layerRoutes.patch("/:id/layers", async (req, res) => {
  try {
    const tpl = await templates.applyLayerOverrides(req.params.id, req.body.layers || {});
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    res.json({ success: true, data: tpl.layers });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
