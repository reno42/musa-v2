import { Router } from "express";
import { store } from "../services/store.js";
import { getSupabase } from "../services/supabase.js";
import { slugify } from "../services/slugify.js";
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
    const workspaces = (data || []).map((r: any) => rowToWorkspace(r));

    // If the workspaces table is empty but templates reference workspace IDs,
    // auto-create workspace records so the Dashboard Data tab isn't blank.
    if (workspaces.length === 0) {
      await syncWorkspacesFromTemplates(sb);
      // Re-fetch after sync
      const { data: refetched, error: refetchErr } = await sb.from("workspaces").select("*").order("updated_at", { ascending: false });
      if (refetchErr) throw refetchErr;
      return (refetched || []).map((r: any) => rowToWorkspace(r));
    }

    return workspaces;
  } catch (e) {
    console.warn("[workspaces] Supabase list failed:", (e as Error).message);
    return null;
  }
}

/** Auto-creates workspace records from template workspace_id references. */
async function syncWorkspacesFromTemplates(sb: ReturnType<typeof getSupabase>) {
  if (!sb) return;
  try {
    // Get all unique workspace_ids from templates
    const { data: tpls, error: tplErr } = await sb.from("templates")
      .select("workspace_id, name")
      .not("workspace_id", "is", null);
    if (tplErr || !tpls?.length) return;

    // Deduplicate by workspace_id, using the first template's name as workspace name
    const seen = new Map<string, string>();
    for (const t of tpls as any[]) {
      if (!seen.has(t.workspace_id) && t.workspace_id) {
        seen.set(t.workspace_id, t.name || "Workspace");
      }
    }

    // Upsert workspaces
    const rows = [...seen.entries()].map(([id, tplName]) => ({
      id,
      name: tplName.replace(/^(.+?)\s*[-–—].*$/, "$1").trim() || "Workspace",
      slug: slugify(tplName.replace(/^(.+?)\s*[-–—].*$/, "$1").trim() || "Workspace"),
      owner_id: "dev_user_default",
      data: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    if (rows.length > 0) {
      const { error: upsertErr } = await sb.from("workspaces").upsert(rows);
      if (upsertErr) {
        // slug column added by v7 migration — retry without it if missing
        if (upsertErr.message?.includes("slug") && upsertErr.message?.includes("does not exist")) {
          const rowsNoSlug = rows.map(({ slug: _, ...rest }) => rest);
          const { error: err2 } = await sb.from("workspaces").upsert(rowsNoSlug);
          if (err2) console.warn("[workspaces] sync upsert failed (retry):", err2.message);
        } else {
          console.warn("[workspaces] sync upsert failed:", upsertErr.message);
        }
      }
    }
  } catch (e) {
    console.warn("[workspaces] sync failed:", (e as Error).message);
  }
}

async function upsertSupabase(ws: Workspace) {
  const sb = getSupabase();
  if (!sb) return;
  try {
    const row: Record<string, any> = {
      id: ws.id,
      name: ws.name,
      slug: ws.slug || slugify(ws.name),
      owner_id: ws.ownerId,
      data: ws,
      updated_at: new Date().toISOString(),
    };
    const { error } = await sb.from("workspaces").upsert(row);
    if (error) {
      // slug column added by v7 migration — retry without it if missing
      if (error.message?.includes("slug") && error.message?.includes("does not exist")) {
        delete row.slug;
        await sb.from("workspaces").upsert(row);
      } else {
        console.warn("[workspaces] Supabase upsert failed:", error.message);
      }
    }
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
