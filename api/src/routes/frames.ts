import { Router } from "express";
import { store } from "../services/store.js";
import { validate, createFrameSchema, updateFrameSchema } from "../middleware/index.js";

export const frameRoutes = Router();

frameRoutes.post("/:id/frames", validate(createFrameSchema), async (req, res) => {
  try {
    const frame = store.createFrame(req.params.id, req.body);
    if (!frame) return res.status(404).json({ success: false, error: "Template not found" });
    res.status(201).json({ success: true, data: frame });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

frameRoutes.get("/:id/frames", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    res.json({ success: true, data: tpl.frames, total: tpl.frames.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

frameRoutes.get("/:id/frames/:frameId", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    const frame = tpl.frames.find(f => f.id === req.params.frameId);
    if (!frame) return res.status(404).json({ success: false, error: "Frame not found" });
    res.json({ success: true, data: frame });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

frameRoutes.put("/:id/frames/:frameId", validate(updateFrameSchema), async (req, res) => {
  try {
    const frame = store.updateFrame(req.params.id, req.params.frameId, req.body);
    if (!frame) return res.status(404).json({ success: false, error: "Template or frame not found" });
    res.json({ success: true, data: frame });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

frameRoutes.delete("/:id/frames/:frameId", async (req, res) => {
  try {
    const ok = store.deleteFrame(req.params.id, req.params.frameId);
    if (!ok) return res.status(404).json({ success: false, error: "Template or frame not found" });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
