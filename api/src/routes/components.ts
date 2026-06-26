import { Router } from "express";
import { store } from "../services/store.js";

export const componentRoutes = Router();

// GET /api/templates/:id/components — list components
componentRoutes.get("/:id/components", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    res.json({ success: true, data: tpl.components, total: tpl.components.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/templates/:id/components/:compId
componentRoutes.delete("/:id/components/:compId", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    const idx = tpl.components.findIndex((c: any) => c.id === req.params.compId);
    if (idx === -1) return res.status(404).json({ success: false, error: "Component not found" });

    tpl.components.splice(idx, 1);
    tpl.metadata.updatedAt = new Date().toISOString();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
