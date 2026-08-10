/**
 * Content Calendar API — one row per piece of content.
 *
 * GET    /api/content?workspaceId=&from=&to=   list, optionally windowed
 * POST   /api/content                          create
 * PATCH  /api/content/:id                      update one field or many
 * DELETE /api/content/:id                      remove
 *
 * Paid and organic share every dimension except spend, so they are one table
 * told apart by `kind`. campaign and ad_set are optional throughout: a post
 * with neither is still a post, and inventing a placeholder would erase the
 * difference between planned work and loose work — the same rule the brand
 * graph follows.
 */

import { Router } from "express";
import { asyncRoute } from "../middleware/asyncRoute.js";
import { getSupabase } from "../services/supabase.js";
import { canAccessWorkspace } from "../services/tenancy.js";

export const contentRoutes = Router();

const KINDS = new Set(["organic", "ad"]);
const STATUSES = new Set(["idea", "diseño", "aprobación", "programado", "publicado"]);

/** Only these can be written, and each is normalised on the way in. */
function buildPatch(body: Record<string, any>): Record<string, any> {
  const patch: Record<string, any> = {};
  const text = (v: unknown) => {
    const s = String(v ?? "").trim();
    return s === "" ? null : s;
  };

  if (body.scheduled_date !== undefined) patch.scheduled_date = text(body.scheduled_date);
  if (body.scheduled_time !== undefined) patch.scheduled_time = text(body.scheduled_time);
  if (body.topic !== undefined) patch.topic = text(body.topic);
  if (body.copy !== undefined) patch.copy = text(body.copy);
  if (body.campaign !== undefined) patch.campaign = text(body.campaign);
  if (body.ad_set !== undefined) patch.ad_set = text(body.ad_set);
  if (body.template_id !== undefined) patch.template_id = text(body.template_id);
  if (body.asset_id !== undefined) patch.asset_id = text(body.asset_id);
  if (body.external_url !== undefined) patch.external_url = text(body.external_url);
  if (body.permalink !== undefined) patch.permalink = text(body.permalink);
  if (body.notes !== undefined) patch.notes = text(body.notes);
  if (body.brand_id !== undefined) patch.brand_id = text(body.brand_id);
  if (body.published_at !== undefined) patch.published_at = text(body.published_at);

  if (body.kind !== undefined) {
    const kind = String(body.kind || "").trim();
    patch.kind = KINDS.has(kind) ? kind : "organic";
  }
  if (body.status !== undefined) {
    const status = String(body.status || "").trim();
    patch.status = STATUSES.has(status) ? status : "idea";
  }
  if (body.channels !== undefined) {
    // Always an array, deduplicated: a channel listed twice would double-count
    // the post in every per-channel roll-up downstream.
    const list = Array.isArray(body.channels) ? body.channels : [];
    patch.channels = [...new Set(list.map((c: unknown) => String(c).trim()).filter(Boolean))];
  }
  return patch;
}

const dbOr503 = (res: any) => {
  const sb = getSupabase();
  if (!sb) { res.status(503).json({ success: false, error: "Supabase no está configurado" }); return null; }
  return sb;
};

contentRoutes.get("/", asyncRoute(async (req, res) => {
  const sb = dbOr503(res);
  if (!sb) return;
  const workspaceId = String(req.query.workspaceId || "");
  if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
  if (!req.auth || !(await canAccessWorkspace(req.auth, workspaceId, "viewer"))) {
    return res.status(403).json({ success: false, error: "Workspace access is required" });
  }

  let query = sb.from("content_calendar").select("*").eq("workspace_id", workspaceId);
  // Windowed by date so a calendar month does not pull three years of history.
  if (req.query.from) query = query.gte("scheduled_date", String(req.query.from));
  if (req.query.to) query = query.lte("scheduled_date", String(req.query.to));
  const { data, error } = await query.order("scheduled_date").limit(1000);
  if (error) throw error;
  res.json({ success: true, data: data || [] });
}));

contentRoutes.post("/", asyncRoute(async (req, res) => {
  const sb = dbOr503(res);
  if (!sb) return;
  const workspaceId = String(req.body.workspaceId || "");
  if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
  if (!req.auth || !(await canAccessWorkspace(req.auth, workspaceId, "editor"))) {
    return res.status(403).json({ success: false, error: "Editor access to the workspace is required" });
  }
  const patch = buildPatch(req.body);
  if (!patch.scheduled_date) {
    return res.status(400).json({ success: false, error: "scheduled_date is required" });
  }
  patch.workspace_id = workspaceId;
  patch.kind ??= "organic";
  patch.status ??= "idea";
  patch.channels ??= [];

  const { data, error } = await sb.from("content_calendar").insert(patch).select("*").single();
  if (error) throw error;
  res.status(201).json({ success: true, data });
}));

contentRoutes.patch("/:id", asyncRoute(async (req, res) => {
  const sb = dbOr503(res);
  if (!sb) return;
  const { data: existing, error: readError } = await sb.from("content_calendar")
    .select("id, workspace_id").eq("id", req.params.id).maybeSingle();
  if (readError) throw readError;
  if (!existing) return res.status(404).json({ success: false, error: "Contenido no encontrado" });
  if (!req.auth || !(await canAccessWorkspace(req.auth, existing.workspace_id, "editor"))) {
    return res.status(403).json({ success: false, error: "Editor access to the workspace is required" });
  }

  const patch = buildPatch(req.body);
  if (Object.keys(patch).length === 0) {
    // A 200 here is how a table ends up looking broken: the request succeeds,
    // the cell snaps back, and nothing anywhere says why.
    return res.status(400).json({ success: false, error: "Nada que actualizar" });
  }
  patch.updated_at = new Date().toISOString();
  const { data, error } = await sb.from("content_calendar")
    .update(patch).eq("id", req.params.id).select("*").single();
  if (error) throw error;
  res.json({ success: true, data });
}));

contentRoutes.delete("/:id", asyncRoute(async (req, res) => {
  const sb = dbOr503(res);
  if (!sb) return;
  const { data: existing } = await sb.from("content_calendar")
    .select("id, workspace_id").eq("id", req.params.id).maybeSingle();
  if (!existing) return res.status(404).json({ success: false, error: "Contenido no encontrado" });
  if (!req.auth || !(await canAccessWorkspace(req.auth, existing.workspace_id, "editor"))) {
    return res.status(403).json({ success: false, error: "Editor access to the workspace is required" });
  }
  const { error } = await sb.from("content_calendar").delete().eq("id", req.params.id);
  if (error) throw error;
  res.json({ success: true });
}));
