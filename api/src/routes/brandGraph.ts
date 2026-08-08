/**
 * Brand Graph API — returns the brand hierarchy tree for the "Red de Marcas" view.
 *
 * GET /api/brand-graph?workspaceId=X
 *
 * Returns:
 *   { success: true, data: { workspaceId, workspaceName, brands: BrandGraphNode[] } }
 */

import type { Request, Response } from "express";
import { buildBrandGraph } from "../services/brandGraph.js";
import { getSupabase } from "../services/supabase.js";
import { canAccessWorkspace } from "../services/tenancy.js";

export async function getBrandGraph(req: Request, res: Response): Promise<void> {
  try {
    const { workspaceId } = req.query;
    const wsId = typeof workspaceId === "string" ? workspaceId.trim() : "";

    if (!wsId) {
      res.status(400).json({ success: false, error: "workspaceId is required" });
      return;
    }

    if (!req.auth) {
      res.status(401).json({ success: false, error: "Authentication required" });
      return;
    }

    if (!(await canAccessWorkspace(req.auth, wsId, "viewer"))) {
      res.status(403).json({ success: false, error: "You do not have access to this workspace" });
      return;
    }

    // Resolve workspace name
    let workspaceName = "Mi cuenta";
    const sb = getSupabase();
    if (sb) {
      const { data: ws } = await sb.from("workspaces")
        .select("name")
        .eq("id", wsId)
        .maybeSingle();
      if (ws) workspaceName = ws.name;
    }

    const graph = await buildBrandGraph(wsId, workspaceName);
    res.json({ success: true, data: graph });
  } catch (cause: unknown) {
    console.error("[brand-graph] Error:", cause instanceof Error ? cause.message : cause);
    res.status(500).json({
      success: false,
      error: cause instanceof Error ? cause.message : "Failed to build brand graph",
    });
  }
}
