import type { Request, Response, NextFunction } from "express";
import { asyncRoute } from "../middleware/asyncRoute.js";
import { getSupabaseAdmin } from "./supabase.js";
import { store } from "./store.js";
import type { RequestAuth, WorkspaceRole } from "./requestContext.js";
import { hasMinimumWorkspaceRole, workspaceKeyAllows } from "./workspaceRoles.js";

export async function getWorkspaceRole(auth: RequestAuth, workspaceId: string): Promise<WorkspaceRole | null> {
  if (auth.isAdmin) return "owner";
  if (auth.authType === "workspace_key") {
    return workspaceKeyAllows(auth.workspaceId, auth.workspaceRole, workspaceId, "viewer") ? (auth.workspaceRole || "viewer") : null;
  }

  const sb = getSupabaseAdmin();
  if (sb) {
    const [{ data: workspace }, { data: membership }] = await Promise.all([
      sb.from("workspaces").select("owner_id").eq("id", workspaceId).maybeSingle(),
      sb.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", auth.userId).maybeSingle(),
    ]);
    if (workspace?.owner_id === auth.userId) return "owner";
    if (hasMinimumWorkspaceRole(membership?.role as WorkspaceRole, "viewer")) return membership!.role as WorkspaceRole;
    return null;
  }

  const workspace = store.getWorkspace(workspaceId);
  if (!workspace) return null;
  if (workspace.ownerId === auth.userId) return "owner";
  return workspace.memberIds.includes(auth.userId) ? "editor" : null;
}

export async function canAccessWorkspace(auth: RequestAuth, workspaceId: string, minimum: WorkspaceRole = "viewer") {
  const role = await getWorkspaceRole(auth, workspaceId);
  return hasMinimumWorkspaceRole(role, minimum);
}

export async function listAccessibleWorkspaceIds(auth: RequestAuth): Promise<string[]> {
  if (auth.workspaceId) return [auth.workspaceId];
  const sb = getSupabaseAdmin();
  if (sb) {
    if (auth.isAdmin) {
      const { data } = await sb.from("workspaces").select("id");
      return (data || []).map((row: any) => row.id);
    }
    const [{ data: owned, error: ownedErr }, { data: memberships, error: membershipsErr }] = await Promise.all([
      sb.from("workspaces").select("id").eq("owner_id", auth.userId),
      sb.from("workspace_members").select("workspace_id").eq("user_id", auth.userId),
    ]);
    // Ambos vacíos = el usuario queda sin listado en silencio (403/empty). Un
    // error transitorio de red se ve igual que "no tiene workspaces": avisar.
    if (ownedErr || membershipsErr) {
      console.warn(`[tenancy] ids u=${auth.userId.slice(0, 8)} error owned="${ownedErr?.message || "-"}" memberships="${membershipsErr?.message || "-"}"`);
    } else if (!owned?.length && !memberships?.length) {
      console.warn(`[tenancy] ids u=${auth.userId.slice(0, 8)} sin workspaces (owned=0 memberships=0)`);
    }
    return [...new Set([...(owned || []).map((row: any) => row.id), ...(memberships || []).map((row: any) => row.workspace_id)])];
  }
  return store.listWorkspaces(auth.userId).map((workspace) => workspace.id);
}

export async function getTemplateWorkspaceId(templateId: string): Promise<string | null> {
  const sb = getSupabaseAdmin();
  if (sb) {
    const { data } = await sb.from("templates").select("workspace_id").eq("id", templateId).maybeSingle();
    if (data?.workspace_id) return data.workspace_id;
  }
  return store.getTemplate(templateId)?.workspaceId || null;
}

// Every gate below talks to Supabase, so every one of them can reject — a
// dropped connection under a burst of writes is enough. Wrapped at the
// definition rather than at each app.use, so no call site can forget: an
// unwrapped rejection here writes no response at all, and on Netlify that is
// a hung invocation the browser eventually sees as a bodyless 503.
export function requireWorkspaceRole(minimum: WorkspaceRole = "viewer", source: "params" | "body" | "query" = "params") {
  return asyncRoute(async (req: Request, res: Response, next: NextFunction) => {
    const workspaceId = source === "params" ? req.params.id : String((source === "body" ? req.body?.workspaceId : req.query.workspaceId) || "");
    if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
    if (!req.auth || !(await canAccessWorkspace(req.auth, workspaceId, minimum))) {
      return res.status(403).json({ success: false, error: "You do not have access to this workspace" });
    }
    next();
  });
}

export const requireTemplateAccess = asyncRoute(async (req: Request, res: Response, next: NextFunction) => {
  const templateId = req.params.templateId;
  if (["trash", "bulk", "import", "batch-ready"].includes(templateId)) return next();
  const workspaceId = await getTemplateWorkspaceId(templateId);
  const minimum: WorkspaceRole = ["GET", "HEAD"].includes(req.method) ? "viewer" : "editor";
  if (!workspaceId || !req.auth || !(await canAccessWorkspace(req.auth, workspaceId, minimum))) {
    return res.status(404).json({ success: false, error: "Template not found" });
  }
  // Handed on so the route does not run the identical query a second time.
  // Every saved cell was two round trips for one answer, and this is the path
  // that fell over under a burst of them.
  req.templateWorkspaceId = workspaceId;
  next();
});

export function requireResourceAccess(table: string, staticSegments: string[] = []) {
  return asyncRoute(async (req: Request, res: Response, next: NextFunction) => {
    const resourceId = req.params.resourceId;
    if (staticSegments.includes(resourceId)) return next();
    const sb = getSupabaseAdmin();
    if (!sb) return next();
    const { data } = await sb.from(table).select("workspace_id").eq("id", resourceId).maybeSingle();
    const minimum: WorkspaceRole = ["GET", "HEAD"].includes(req.method) ? "viewer" : "editor";
    if (!data?.workspace_id || !req.auth || !(await canAccessWorkspace(req.auth, data.workspace_id, minimum))) {
      return res.status(404).json({ success: false, error: "Resource not found" });
    }
    next();
  });
}

export function enforceWorkspaceKeyScope(req: Request, res: Response, next: NextFunction) {
  const scopedWorkspace = req.auth?.authType === "workspace_key" ? req.auth.workspaceId : undefined;
  if (!scopedWorkspace) return next();
  const requested = String(req.body?.workspaceId || req.query.workspaceId || "");
  if (requested && requested !== scopedWorkspace) {
    return res.status(403).json({ success: false, error: "This API key is restricted to another workspace" });
  }
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) req.body.workspaceId ??= scopedWorkspace;
  if (!req.query.workspaceId) req.query.workspaceId = scopedWorkspace;
  next();
}
