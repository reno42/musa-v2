import { Router } from "express";
import { getSupabase } from "../services/supabase.js";
import { requireWorkspaceRole } from "../services/tenancy.js";

export const ghostRoutes = Router();

/**
 * REQ-069/070 (aditivo): REST de solo-lectura sobre ghost_jobs para la vista
 * AGENTES del shell-v2. La escritura sigue viviendo en el MCP (ghost_perform):
 * aquí NO se crean ni mutan jobs — la vista agentes consume estados y resultados.
 */

/** GET /api/ghost/jobs?workspaceId=…&limit=50
 * Lista los jobs del workspace, más recientes primero. */
ghostRoutes.get("/jobs", requireWorkspaceRole("viewer", "query"), async (req, res) => {
  try {
    const sb = getSupabase();
    if (!sb) return res.status(503).json({ success: false, error: "Supabase not configured" });
    const workspaceId = String(req.query.workspaceId || "");
    if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const { data, error } = await sb
      .from("ghost_jobs")
      .select("id, workspace_id, task, mode, status, link, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return res.json({ success: true, data: data || [], total: (data || []).length });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/** GET /api/ghost/jobs/:id
 * Detalle de un job (incluye result). Requiere pertenecer al mismo workspace del job. */
ghostRoutes.get("/jobs/:id", requireWorkspaceRole("viewer", "query"), async (req, res) => {
  try {
    const sb = getSupabase();
    if (!sb) return res.status(503).json({ success: false, error: "Supabase not configured" });
    const { data, error } = await sb
      .from("ghost_jobs")
      .select("*")
      .eq("id", String(req.params.id))
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ success: false, error: "Job not found" });
    return res.json({ success: true, data });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/** GET /api/ghost/summary?workspaceId=…
 * Conteos por estado para el header de la vista agentes (una consulta barata). */
ghostRoutes.get("/summary", requireWorkspaceRole("viewer", "query"), async (req, res) => {
  try {
    const sb = getSupabase();
    if (!sb) return res.status(503).json({ success: false, error: "Supabase not configured" });
    const workspaceId = String(req.query.workspaceId || "");
    if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
    const { data, error } = await sb
      .from("ghost_jobs")
      .select("status")
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    const byStatus: Record<string, number> = {};
    for (const row of data || []) {
      const s = String((row as { status?: string }).status || "unknown");
      byStatus[s] = (byStatus[s] || 0) + 1;
    }
    return res.json({ success: true, data: { byStatus, total: (data || []).length } });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
