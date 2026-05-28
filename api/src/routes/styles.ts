import { Router } from "express";
import { v4 as uuid } from "uuid";
import { store } from "../services/store.js";
import { z } from "zod";
import { validate } from "../middleware/validate.js";

export const styleRoutes = Router();

const createSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(["fill", "stroke", "text", "effect"]),
  properties: z.record(z.string(), z.any()),
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  properties: z.record(z.string(), z.any()).optional(),
});

const applySchema = z.object({
  layerNames: z.array(z.string()).min(1),
});

styleRoutes.post("/:id/styles", validate(createSchema), async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    const style = { id: `sty_${uuid().slice(0, 12)}`, ...req.body };
    tpl.styles.push(style);
    tpl.metadata.updatedAt = new Date().toISOString();
    res.status(201).json({ success: true, data: style });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

styleRoutes.get("/:id/styles", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    const search = (req.query.search as string || "").toLowerCase();
    const list = search ? tpl.styles.filter(s => s.name.toLowerCase().includes(search)) : tpl.styles;
    res.json({ success: true, data: list, total: list.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

styleRoutes.get("/:id/styles/:styleId", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    const style = tpl.styles.find(s => s.id === req.params.styleId);
    if (!style) return res.status(404).json({ success: false, error: "Style not found" });
    res.json({ success: true, data: style });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

styleRoutes.put("/:id/styles/:styleId", validate(updateSchema), async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    const style = tpl.styles.find(s => s.id === req.params.styleId);
    if (!style) return res.status(404).json({ success: false, error: "Style not found" });
    Object.assign(style, req.body);
    tpl.metadata.updatedAt = new Date().toISOString();
    res.json({ success: true, data: style });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

styleRoutes.delete("/:id/styles/:styleId", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    const idx = tpl.styles.findIndex(s => s.id === req.params.styleId);
    if (idx === -1) return res.status(404).json({ success: false, error: "Style not found" });
    tpl.styles.splice(idx, 1);
    tpl.metadata.updatedAt = new Date().toISOString();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

styleRoutes.post("/:id/styles/:styleId/apply", validate(applySchema), async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    const style = tpl.styles.find(s => s.id === req.params.styleId);
    if (!style) return res.status(404).json({ success: false, error: "Style not found" });

    const walk = (objs: any[]) => {
      for (const o of objs) {
        const name = o.layerName || o.name;
        if (req.body.layerNames.includes(name)) {
          for (const [k, v] of Object.entries(style.properties)) {
            o[k] = v;
          }
          if (style.type !== "text") (o as any).styleId = style.id;
        }
        if (o.objects && Array.isArray(o.objects)) walk(o.objects);
      }
    };
    walk(tpl.canvas.objects);
    for (const f of tpl.frames) walk(f.objects);

    tpl.metadata.updatedAt = new Date().toISOString();
    res.json({ success: true, data: { applied: req.body.layerNames.length } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
