import { Router } from "express";
import { store } from "../services/store.js";
import { getSupabase } from "../services/supabase.js";
import {
  validate, createWorkspaceSchema, updateWorkspaceSchema, addMemberSchema,
} from "../middleware/index.js";
import type { Workspace } from "../types.js";

type SupabaseWsRow = {
  id: string;
  name: string;
  owner_id: string;
  data: Workspace;
  created_at: string;
  updated_at: string;
};

function rowToWorkspace(row: SupabaseWsRow): Workspace {
  return {
    ...row.data,
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listFromSupabase(userId: string): Promise<Workspace[] | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data, error } = await sb.from("workspaces").select("*").order("updated_at", { ascending: false });
    if (error) throw error;
    return (data || []).map((r: any) => rowToWorkspace(r));
  } catch (e) {
    console.warn("[workspaces] Supabase list failed:", (e as Error).message);
    return null;
  }
}

async function upsertSupabase(ws: Workspace) {
  const sb = getSupabase();
  if (!sb) return;
  try {
    await sb.from("workspaces").upsert({
      id: ws.id,
      name: ws.name,
      owner_id: ws.ownerId,
      data: ws,
      updated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn("[workspaces] Supabase upsert failed:", (e as Error).message);
  }
}

async function deleteFromSupabase(id: string) {
  const sb = getSupabase();
  if (!sb) return;
  try { await sb.from("workspaces").delete().eq("id", id); } catch {}
}

export const workspaceRoutes = Router();

workspaceRoutes.post("/", validate(createWorkspaceSchema), async (req, res) => {
  try {
    const ws = store.createWorkspace({
      name: req.body.name,
      description: req.body.description,
      ownerId: req.auth!.userId,
    });
    await upsertSupabase(ws);
    res.status(201).json({ success: true, data: ws });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

workspaceRoutes.get("/", async (req, res) => {
  try {
    const fromSb = await listFromSupabase(req.auth!.userId);
    if (fromSb) return res.json({ success: true, data: fromSb, total: fromSb.length });
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
    await upsertSupabase(ws);
    res.json({ success: true, data: ws });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

workspaceRoutes.delete("/:id", async (req, res) => {
  try {
    store.deleteWorkspace(req.params.id);
    await deleteFromSupabase(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

workspaceRoutes.post("/:id/members", validate(addMemberSchema), async (req, res) => {
  try {
    const ws = store.addMember(req.params.id, req.body.userId);
    if (!ws) return res.status(404).json({ success: false, error: "Workspace not found" });
    await upsertSupabase(ws);
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
