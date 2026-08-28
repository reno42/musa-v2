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
  // REQ-023: the exact frame inside that file — a grid has several designs
  // side by side, and "which file" alone cannot say which one is this piece.
  if (body.frame_id !== undefined) patch.frame_id = text(body.frame_id);
  if (body.asset_id !== undefined) patch.asset_id = text(body.asset_id);
  if (body.external_url !== undefined) patch.external_url = text(body.external_url);
  if (body.permalink !== undefined) patch.permalink = text(body.permalink);
  if (body.notes !== undefined) patch.notes = text(body.notes);
  if (body.brand_id !== undefined) patch.brand_id = text(body.brand_id);
  if (body.published_at !== undefined) patch.published_at = text(body.published_at);

  // Plan and actual figures. Empty means "no plan", which is not the same as
  // zero — a projection of 0 is a promise to spend nothing, and pacing has to
  // be able to tell those apart.
  for (const key of [
    "plan_spend", "plan_impressions", "plan_reach", "plan_clicks", "plan_views",
    "actual_spend", "actual_impressions", "actual_reach", "actual_clicks", "actual_views",
  ]) {
    if (body[key] === undefined) continue;
    const raw = String(body[key] ?? "").trim();
    if (raw === "") { patch[key] = null; continue; }
    const parsed = Number(raw.replace(/[^0-9.-]/g, ""));
    patch[key] = Number.isFinite(parsed) ? parsed : null;
  }

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

/**
 * PostgREST answers "Could not find the table 'public.content_calendar' in the
 * schema cache" (PGRST205) when v22 has not been run. That is a setup step,
 * not a failure — surfacing it as a 500 tells the user nothing about what to
 * do, which is exactly how this shipped and exactly what it cost.
 */
export function isMissingTable(error: unknown): boolean {
  const err = error as { code?: string; message?: string } | null;
  if (err?.code === "PGRST205" || err?.code === "42P01") return true;
  const message = String(err?.message ?? "").toLowerCase();
  return message.includes("content_calendar")
    && (message.includes("schema cache") || message.includes("does not exist"));
}

const SETUP_MESSAGE =
  "Falta crear la tabla del calendario. Ejecuta supabase_migrations_v22.sql en el "
  + "proyecto de Supabase que usa producción y recarga el esquema "
  + "(Settings → API → Reload schema cache).";

/**
 * PostgREST raises 42703 when the row exists but the frame_id column does
 * not — v22 ran, v34 did not. Same shape as the missing table above: a setup
 * step, surfaced with the exact file to run, not a 500 the user stares at.
 */
export function isMissingColumn(error: unknown): boolean {
  const err = error as { code?: string; message?: string } | null;
  if (err?.code === "42703") return true;
  const message = String(err?.message ?? "").toLowerCase();
  return message.includes("frame_id")
    && (message.includes("does not exist") || message.includes("no existe"));
}

const COLUMN_SETUP_MESSAGE =
  "Falta la columna frame_id en content_calendar. Ejecuta supabase_migrations_v34.sql "
  + "en el proyecto de Supabase que usa producción (es idempotente, se puede "
  + "re-ejecutar) y recarga el esquema (Settings → API → Reload schema cache).";

/** Wraps a handler so a missing table or column reads as setup, with the step. */
function withSetupCheck(fn: (req: any, res: any) => Promise<unknown>) {
  return asyncRoute(async (req: any, res: any) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (isMissingTable(err)) {
        return res.status(503).json({ success: false, error: SETUP_MESSAGE, setupRequired: true });
      }
      if (isMissingColumn(err)) {
        return res.status(503).json({ success: false, error: COLUMN_SETUP_MESSAGE, setupRequired: true });
      }
      throw err;
    }
  });
}

contentRoutes.get("/", withSetupCheck(async (req, res) => {
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

contentRoutes.post("/", withSetupCheck(async (req, res) => {
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

contentRoutes.patch("/:id", withSetupCheck(async (req, res) => {
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

contentRoutes.delete("/:id", withSetupCheck(async (req, res) => {
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
