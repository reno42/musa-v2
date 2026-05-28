import { Router } from "express";
import { v4 as uuid } from "uuid";
import { store } from "../services/store.js";
import { z } from "zod";
import { validate } from "../middleware/validate.js";

export const variableRoutes = Router();

const createCollectionSchema = z.object({
  name: z.string().min(1).max(100),
});

const createVariableSchema = z.object({
  collectionId: z.string().min(1),
  name: z.string().min(1).max(100),
  value: z.any(),
});

const updateVariableSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  value: z.any().optional(),
});

variableRoutes.post("/:id/variables/collections", validate(createCollectionSchema), async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    const col = { id: `col_${uuid().slice(0, 12)}`, name: req.body.name };
    tpl.variables.collections.push(col);
    tpl.metadata.updatedAt = new Date().toISOString();
    res.status(201).json({ success: true, data: col });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

variableRoutes.post("/:id/variables", validate(createVariableSchema), async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    if (!tpl.variables.collections.find(c => c.id === req.body.collectionId)) {
      return res.status(400).json({ success: false, error: "Collection not found" });
    }
    const v = { id: `var_${uuid().slice(0, 12)}`, collectionId: req.body.collectionId, name: req.body.name, value: req.body.value };
    tpl.variables.variables.push(v);
    tpl.metadata.updatedAt = new Date().toISOString();
    res.status(201).json({ success: true, data: v });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

variableRoutes.get("/:id/variables", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    res.json({ success: true, data: tpl.variables });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

variableRoutes.put("/:id/variables/:variableId", validate(updateVariableSchema), async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    const v = tpl.variables.variables.find(vr => vr.id === req.params.variableId);
    if (!v) return res.status(404).json({ success: false, error: "Variable not found" });
    if (req.body.name !== undefined) v.name = req.body.name;
    if (req.body.value !== undefined) v.value = req.body.value;
    tpl.metadata.updatedAt = new Date().toISOString();
    res.json({ success: true, data: v });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

variableRoutes.delete("/:id/variables/:variableId", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    const idx = tpl.variables.variables.findIndex(vr => vr.id === req.params.variableId);
    if (idx === -1) return res.status(404).json({ success: false, error: "Variable not found" });
    tpl.variables.variables.splice(idx, 1);
    tpl.metadata.updatedAt = new Date().toISOString();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
