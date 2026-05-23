import { Router } from "express";
import * as templates from "../services/templates";
import { renderTemplate } from "../services/renderer";
import type { RenderRequest } from "@futuraria/shared";

export const renderRoutes = Router();

// Render template to image
renderRoutes.post("/:id/render", async (req, res) => {
  try {
    const templateId = req.params.id;
    const request: RenderRequest = {
      format: req.body.format || "png",
      scale: req.body.scale || 2,
      quality: req.body.quality,
      overrides: req.body.overrides,
      webhookUrl: req.body.webhookUrl,
    };

    // Apply overrides before rendering
    if (request.overrides?.layers) {
      await templates.applyLayerOverrides(templateId, request.overrides.layers);
    }

    const result = await renderTemplate(templateId, request);

    if (result.status === "failed") {
      return res.status(500).json({ success: false, error: result.error });
    }

    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Check render status (for async renders)
renderRoutes.get("/renders/:renderId", async (req, res) => {
  // TODO: implement render status tracking
  res.json({ success: false, error: "Not implemented yet" });
});
