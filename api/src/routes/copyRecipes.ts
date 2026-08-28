/**
 * Copy Recipes API — writing recipes for the copywriting workflow (REQ-016).
 *
 * Hooks, communication tones and writing frameworks (AIDA, PAS…) that humans
 * and AIs share: same table, same CRUD, same permissions. The "Recetas" pane
 * reads/writes here, and the MCP tools (list/create/update/delete_copy_recipe)
 * hit the same rows — so a user can ask their AI to research frameworks online
 * and store them, then ask it to draft calendar copies USING them.
 *
 * REQ-020 (v33): the library has two tiers — factory defaults (is_default,
 * 10 classic frameworks, readable by every account, immutable) and personal
 * recipes owned by one user (owner_id; only that user sees or edits them).
 * The workspace stays as the entry gate, but listing/ownership is per USER.
 *
 * GET    /api/copy-recipes?workspaceId=&type=    list, optionally by type
 * POST   /api/copy-recipes                       create (name is enough)
 * PATCH  /api/copy-recipes/:id                   update
 * DELETE /api/copy-recipes/:id                   remove
 */

import { Router } from "express";
import { asyncRoute } from "../middleware/asyncRoute.js";
import { getSupabase } from "../services/supabase.js";
import { canAccessWorkspace } from "../services/tenancy.js";

export const copyRecipeRoutes = Router();

const TYPES = new Set(["hook", "tono", "framework", "otro"]);
const SOURCES = new Set(["humano", "ia"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeType(v: unknown): string {
  const s = String(v || "").trim().toLowerCase();
  return TYPES.has(s) ? s : "otro";
}

function normalizeSource(v: unknown): string {
  const s = String(v || "").trim().toLowerCase();
  return SOURCES.has(s) ? s : "humano";
}

/** PostgREST PGRST205/42P01 = table missing; 42703 = v33 columns missing. */
export function isMissingCopyTable(error: unknown): boolean {
  const err = error as { code?: string; message?: string } | null;
  if (err?.code === "PGRST205" || err?.code === "42P01" || err?.code === "42703") return true;
  const message = String(err?.message ?? "").toLowerCase();
  return message.includes("copy_recipes")
    && (message.includes("schema cache") || message.includes("does not exist"));
}

const SETUP_MESSAGE =
  "Falta crear/actualizar la tabla de recetas. Ejecuta supabase_migrations_v32.sql y "
  + "supabase_migrations_v33.sql (en ese orden) en el proyecto de Supabase que usa "
  + "producción y recarga el esquema (Settings → API → Reload schema cache).";

function withSetupCheck(fn: (req: any, res: any) => Promise<unknown>) {
  return asyncRoute(async (req: any, res: any) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (isMissingCopyTable(err)) {
        return res.status(503).json({ success: false, error: SETUP_MESSAGE, setupRequired: true });
      }
      throw err;
    }
  });
}

const dbOr503 = (res: any) => {
  const sb = getSupabase();
  if (!sb) { res.status(503).json({ success: false, error: "Supabase no está configurado" }); return null; }
  return sb;
};

/** Read the row's workspace first so tenant checks never trust the body. */
async function loadRow(sb: any, id: string) {
  const { data, error } = await sb.from("copy_recipes")
    .select("id, workspace_id, is_default, owner_id").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * REQ-020 tier rules on top of the workspace gate:
 *  - factory defaults are read-only for everyone (they are shared by ALL
 *    accounts — editing one here would edit it everywhere), and
 *  - personal recipes only answer to their owner.
 */
function rejectForeignOrDefault(existing: { is_default?: boolean; owner_id?: string | null }, req: any, res: any): boolean {
  if (existing.is_default) {
    res.status(403).json({
      success: false,
      error: "Las recetas default son de solo lectura: crea una copia propia para editarla.",
    });
    return true;
  }
  const uid = String(req.auth?.userId || "");
  if (existing.owner_id && existing.owner_id !== uid) {
    res.status(403).json({ success: false, error: "Esta receta pertenece a otro usuario." });
    return true;
  }
  return false;
}

copyRecipeRoutes.get("/", withSetupCheck(async (req, res) => {
  const sb = dbOr503(res);
  if (!sb) return;
  const workspaceId = String(req.query.workspaceId || "");
  if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
  if (!req.auth || !(await canAccessWorkspace(req.auth, workspaceId, "viewer"))) {
    return res.status(403).json({ success: false, error: "Workspace access is required" });
  }

  // REQ-020: the library = factory defaults (every account) + what THIS user
  // saved. The scoped client enforces the same via RLS; this is the query
  // side so the admin/dev fallback returns the identical shape.
  const uid = String(req.auth.userId || "");
  let query = sb.from("copy_recipes").select("*");
  query = UUID_RE.test(uid)
    ? query.or(`is_default.eq.true,owner_id.eq.${uid}`)
    : query.eq("is_default", true);
  if (req.query.type) query = query.eq("type", normalizeType(req.query.type));
  const { data, error } = await query.order("updated_at", { ascending: false }).limit(500);
  if (error) throw error;
  res.json({ success: true, data: data || [] });
}));

copyRecipeRoutes.post("/", withSetupCheck(async (req, res) => {
  const sb = dbOr503(res);
  if (!sb) return;
  const workspaceId = String(req.body.workspaceId || "");
  const name = String(req.body.name || "").trim();
  // REQ-020: a name is enough — the user can fill the recipe in later, inline.
  const content = String(req.body.content ?? "").trim();
  if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
  if (!name) return res.status(400).json({ success: false, error: "name es obligatorio" });
  if (!req.auth || !(await canAccessWorkspace(req.auth, workspaceId, "editor"))) {
    return res.status(403).json({ success: false, error: "Editor access to the workspace is required" });
  }

  const tags = Array.isArray(req.body.tags)
    ? [...new Set(req.body.tags.map((t: unknown) => String(t).trim()).filter(Boolean))]
    : [];
  // Personal by design (REQ-020): stamp the creating user so only they see it.
  const uid = String(req.auth.userId || "");
  const { data, error } = await sb.from("copy_recipes").insert({
    workspace_id: workspaceId,
    type: normalizeType(req.body.type),
    name, content, tags,
    source: normalizeSource(req.body.source),
    owner_id: UUID_RE.test(uid) ? uid : null,
  }).select("*").single();
  if (error) throw error;
  res.status(201).json({ success: true, data });
}));

copyRecipeRoutes.patch("/:id", withSetupCheck(async (req, res) => {
  const sb = dbOr503(res);
  if (!sb) return;
  const existing = await loadRow(sb, req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: "Receta no encontrada" });
  if (rejectForeignOrDefault(existing, req, res)) return;
  if (!req.auth || !(await canAccessWorkspace(req.auth, existing.workspace_id, "editor"))) {
    return res.status(403).json({ success: false, error: "Editor access to the workspace is required" });
  }

  const patch: Record<string, any> = {};
  if (req.body.type !== undefined) patch.type = normalizeType(req.body.type);
  if (req.body.name !== undefined) patch.name = String(req.body.name).trim();
  if (req.body.content !== undefined) patch.content = String(req.body.content);
  if (req.body.tags !== undefined) {
    patch.tags = Array.isArray(req.body.tags)
      ? [...new Set(req.body.tags.map((t: unknown) => String(t).trim()).filter(Boolean))]
      : [];
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ success: false, error: "Nada que actualizar" });
  }
  patch.updated_at = new Date().toISOString();
  const { data, error } = await sb.from("copy_recipes")
    .update(patch).eq("id", req.params.id).select("*").single();
  if (error) throw error;
  res.json({ success: true, data });
}));

copyRecipeRoutes.delete("/:id", withSetupCheck(async (req, res) => {
  const sb = dbOr503(res);
  if (!sb) return;
  const existing = await loadRow(sb, req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: "Receta no encontrada" });
  if (rejectForeignOrDefault(existing, req, res)) return;
  if (!req.auth || !(await canAccessWorkspace(req.auth, existing.workspace_id, "editor"))) {
    return res.status(403).json({ success: false, error: "Editor access to the workspace is required" });
  }
  const { error } = await sb.from("copy_recipes").delete().eq("id", req.params.id);
  if (error) throw error;
  res.json({ success: true });
}));
