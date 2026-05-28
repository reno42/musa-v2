import { Router } from "express";
import { v4 as uuid } from "uuid";
import { store } from "../services/store.js";
import { z } from "zod";
import { validate } from "../middleware/validate.js";

export const commentRoutes = Router();

const createSchema = z.object({
  text: z.string().min(1).max(1000),
  x: z.number(),
  y: z.number(),
});

const updateSchema = z.object({
  text: z.string().min(1).max(1000),
});

commentRoutes.post("/:id/comments", validate(createSchema), async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

    const comment = {
      id: `cmt_${uuid().slice(0, 12)}`,
      userId: req.auth!.userId,
      text: req.body.text,
      x: req.body.x,
      y: req.body.y,
      resolved: false,
      createdAt: new Date().toISOString(),
    };
    tpl.comments.push(comment);
    tpl.metadata.updatedAt = new Date().toISOString();
    res.status(201).json({ success: true, data: comment });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

commentRoutes.get("/:id/comments", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    const resolved = req.query.resolved;
    let list = tpl.comments;
    if (resolved === "true") list = list.filter(c => c.resolved);
    else if (resolved === "false") list = list.filter(c => !c.resolved);
    res.json({ success: true, data: list, total: list.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

commentRoutes.put("/:id/comments/:commentId", validate(updateSchema), async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    const c = tpl.comments.find(co => co.id === req.params.commentId);
    if (!c) return res.status(404).json({ success: false, error: "Comment not found" });
    c.text = req.body.text;
    tpl.metadata.updatedAt = new Date().toISOString();
    res.json({ success: true, data: c });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

commentRoutes.post("/:id/comments/:commentId/resolve", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    const c = tpl.comments.find(co => co.id === req.params.commentId);
    if (!c) return res.status(404).json({ success: false, error: "Comment not found" });
    c.resolved = !c.resolved;
    tpl.metadata.updatedAt = new Date().toISOString();
    res.json({ success: true, data: c });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

commentRoutes.delete("/:id/comments/:commentId", async (req, res) => {
  try {
    const tpl = store.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
    const idx = tpl.comments.findIndex(co => co.id === req.params.commentId);
    if (idx === -1) return res.status(404).json({ success: false, error: "Comment not found" });
    tpl.comments.splice(idx, 1);
    tpl.metadata.updatedAt = new Date().toISOString();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
