/**
 * Layers Routes
 * ──────────────────────────────────────────────────────────────
 * CRUD for individual layers within a design template.
 *
 * @module routes/layers
 *
 * Database impact:
 *   - GET:  Reads templates.data → extracts layers
 *   - PATCH: Calls applyLayerOverrides → UPDATE templates SET data
 */

import { Router } from "express";
import * as templates from "../services/templates.js";

export const layerRoutes = Router();

function getLayers(tpl: any): any[] {
  return tpl.layers || [];
}

/**
 * GET /api/templates/:id/layers
 * ──────────────────────────────────────────────────────────────
 * List all layers in a template.
 *
 * DB: SELECT data FROM templates WHERE id = :id → walk layers
 */
layerRoutes.get("/:id/layers", async (req, res) => {
  try {
    const tpl = await templates.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    res.json({ success: true, data: getLayers(tpl) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/templates/:id/layers/:name
 * ──────────────────────────────────────────────────────────────
 * Get a single layer by name.
 */
layerRoutes.get("/:id/layers/:name", async (req, res) => {
  try {
    const tpl = await templates.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    const allLayers = getLayers(tpl);
    const layer = allLayers.find((l: any) => (l.layerName || l.name) === req.params.name);
    if (!layer) return res.status(404).json({ success: false, error: "Layer not found" });
    res.json({ success: true, data: layer });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PATCH /api/templates/:id/layers/:name
 * ──────────────────────────────────────────────────────────────
 * Modify a single layer's properties (text, fill, stroke, etc).
 * This is the primary agent-driven content update endpoint.
 *
 * @body {LayerOverride}  See LayerOverride in @futuraria/shared
 *
 * DB: UPDATE templates SET data = updated WHERE id = :id
 *
 * @webhook Fires: layer.updated
 */
layerRoutes.patch("/:id/layers/:name", async (req, res) => {
  try {
    const overrides = { [req.params.name]: req.body };
    const tpl = await templates.applyLayerOverrides(req.params.id, overrides);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    const allLayers = getLayers(tpl);
    const layer = allLayers.find((l: any) => (l.layerName || l.name) === req.params.name);
    res.json({ success: true, data: layer });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PATCH /api/templates/:id/layers
 * ──────────────────────────────────────────────────────────────
 * Batch update multiple layers at once. Accepts a map of
 * layerName → LayerOverride objects.
 *
 * @body {object} layers  { "layerName": LayerOverride, ... }
 *
 * DB: UPDATE templates SET data
 *
 * @webhook Fires: layer.updated (per modified layer)
 */
layerRoutes.patch("/:id/layers", async (req, res) => {
  try {
    const tpl = await templates.applyLayerOverrides(req.params.id, req.body.layers || {});
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    res.json({ success: true, data: getLayers(tpl) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
