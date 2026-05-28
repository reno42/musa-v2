import { Router } from "express";
import { store } from "../services/store.js";
import {
  validate, createWorkspaceSchema, updateWorkspaceSchema, addMemberSchema,
} from "../middleware/index.js";

export const workspaceRoutes = Router();

workspaceRoutes.post("/", validate(createWorkspaceSchema), async (req, res) => {
  try {
    const ws = store.createWorkspace({
      name: req.body.name,
      description: req.body.description,
      ownerId: req.auth!.userId,
    });
    res.status(201).json({ success: true, data: ws });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

workspaceRoutes.get("/", async (req, res) => {
  try {
    const data = store.listWorkspaces(req.auth!.userId);
    res.json({ success: true, data, total: data.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

workspaceRoutes.get("/:id", async (req, res) => {
  try {
    const ws = store.getWorkspace(req.params.id);
    if (!ws) return res.status(404).json({ success: false, error: "Workspace not found" });
    res.json({ success: true, data: ws });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

workspaceRoutes.put("/:id", validate(updateWorkspaceSchema), async (req, res) => {
  try {
    const ws = store.updateWorkspace(req.params.id, req.body);
    if (!ws) return res.status(404).json({ success: false, error: "Workspace not found" });
    res.json({ success: true, data: ws });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

workspaceRoutes.delete("/:id", async (req, res) => {
  try {
    store.deleteWorkspace(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

workspaceRoutes.post("/:id/members", validate(addMemberSchema), async (req, res) => {
  try {
    const ws = store.addMember(req.params.id, req.body.userId);
    if (!ws) return res.status(404).json({ success: false, error: "Workspace not found" });
    res.json({ success: true, data: ws });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

workspaceRoutes.get("/:id/templates", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
    const result = store.listTemplates(req.params.id, limit, offset);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
