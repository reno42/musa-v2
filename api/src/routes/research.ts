/**
 * Research API — news/blog ingestion and the one-click encargo (REQ-051).
 *
 * Same dual-door contract as copy recipes: the «Research» pane reads/writes
 * here and the research_* MCP tools hit the same rows, so the encargo a human
 * creates from a card is the exact same row the user's MCP-connected AI
 * discovers via research_ai_tasks and completes with research_ai_complete.
 *
 * GET    /api/research/sources?workspaceId=            list sources
 * POST   /api/research/sources                         create (+ first ingest)
 * PATCH  /api/research/sources/:id                     update
 * DELETE /api/research/sources/:id                     remove (items cascade)
 * POST   /api/research/sources/refresh                 manual refresh (button)
 * GET    /api/research/items?workspaceId=&status=&sourceId=   the cards
 * PATCH  /api/research/items/:id                       status new/used/dismissed
 * POST   /api/research/requests                        the encargo (briefing+token)
 * GET    /api/research/requests?workspaceId=           encargo status for the pane
 */

import { Router } from "express";
import { asyncRoute } from "../middleware/asyncRoute.js";
import { getSupabase } from "../services/supabase.js";
import { canAccessWorkspace } from "../services/tenancy.js";
import {
  buildResearchBriefing,
  ingestDueSources,
  newResumeToken,
  normalizeKeywords,
  normalizeRequestArgs,
  RESEARCH_LIMITS,
  ResearchArgsError,
} from "../../../worker/runtime/functions/research-ingest.mjs";

export const researchRoutes = Router();

const SOURCE_TYPES = new Set(["rss", "nitter"]);
const ITEM_STATUSES = new Set(["new", "used", "dismissed"]);

/** PostgREST PGRST205/42P01 = table missing; 42703 = columns missing. */
function isMissingResearchTable(error: unknown): boolean {
  const err = error as { code?: string; message?: string } | null;
  if (err?.code === "PGRST205" || err?.code === "42P01" || err?.code === "42703") return true;
  const message = String(err?.message ?? "").toLowerCase();
  return message.includes("research_")
    && (message.includes("schema cache") || message.includes("does not exist"));
}

const SETUP_MESSAGE =
  "Falta crear las tablas de research. Ejecuta supabase_migrations_v78.sql en el proyecto "
  + "de Supabase que usa producción y recarga el esquema (Settings → API → Reload schema cache).";

function withSetupCheck(fn: (req: any, res: any) => Promise<unknown>) {
  return asyncRoute(async (req: any, res: any) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (isMissingResearchTable(err)) {
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
async function loadSource(sb: any, id: string) {
  const { data, error } = await sb.from("research_sources")
    .select("id, workspace_id").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

async function loadItem(sb: any, id: string) {
  const { data, error } = await sb.from("research_items").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

function requireViewer(req: any) { return Boolean(req.auth); }
async function gateViewer(req: any, workspaceId: string, res: any): Promise<boolean> {
  if (!requireViewer(req) || !(await canAccessWorkspace(req.auth, workspaceId, "viewer"))) {
    res.status(403).json({ success: false, error: "Workspace access is required" });
    return false;
  }
  return true;
}
async function gateEditor(req: any, workspaceId: string, res: any): Promise<boolean> {
  if (!req.auth || !(await canAccessWorkspace(req.auth, workspaceId, "editor"))) {
    res.status(403).json({ success: false, error: "Editor access to the workspace is required" });
    return false;
  }
  return true;
}

/** Brand scope: the id must be a brand of THIS workspace (trust-no-body). */
async function checkBrand(sb: any, workspaceId: string, brandId: string | null): Promise<string | null> {
  if (!brandId) return null;
  const { data: brand } = await sb.from("brands").select("id, name")
    .eq("id", brandId).eq("workspace_id", workspaceId).maybeSingle();
  if (!brand) throw new ResearchArgsError("La marca no pertenece a este workspace");
  return brandId;
}

function parseSourceUrl(raw: unknown): string {
  const url = String(raw || "").trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ResearchArgsError("URL inválida");
  }
  if (parsed.protocol !== "https:") throw new ResearchArgsError("La URL del feed debe ser https://");
  return url;
}

function parseRefreshMinutes(raw: unknown): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return 60;
  return Math.min(1440, Math.max(RESEARCH_LIMITS.minRefreshMinutes, n));
}

// ── Sources ─────────────────────────────────────────────────────────────────

researchRoutes.get("/sources", withSetupCheck(async (req, res) => {
  const sb = dbOr503(res);
  if (!sb) return;
  const workspaceId = String(req.query.workspaceId || "");
  if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
  if (!(await gateViewer(req, workspaceId, res))) return;
  const { data, error } = await sb.from("research_sources")
    .select("*").eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  res.json({ success: true, data: data || [] });
}));

researchRoutes.post("/sources", withSetupCheck(async (req, res) => {
  const sb = dbOr503(res);
  if (!sb) return;
  const workspaceId = String(req.body.workspaceId || "");
  const name = String(req.body.name || "").trim();
  if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
  if (!name) return res.status(400).json({ success: false, error: "name es obligatorio" });
  if (!(await gateEditor(req, workspaceId, res))) return;

  let url: string;
  try {
    url = parseSourceUrl(req.body.url);
  } catch (err) {
    return res.status(400).json({ success: false, error: (err as Error).message });
  }
  const type = SOURCE_TYPES.has(String(req.body.type || "rss")) ? String(req.body.type || "rss") : "rss";

  let brandId: string | null = null;
  try {
    brandId = await checkBrand(sb, workspaceId, String(req.body.brandId || "").trim() || null);
  } catch (err) {
    if (err instanceof ResearchArgsError) {
      return res.status(400).json({ success: false, error: err.message });
    }
    throw err;
  }

  const { count, error: countError } = await sb.from("research_sources")
    .select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
  if (countError) throw countError;
  if ((count || 0) >= RESEARCH_LIMITS.maxSourcesPerWorkspace) {
    return res.status(400).json({
      success: false,
      error: `Límite de ${RESEARCH_LIMITS.maxSourcesPerWorkspace} fuentes por workspace alcanzado`,
    });
  }

  const { data: created, error } = await sb.from("research_sources").insert({
    workspace_id: workspaceId,
    name,
    url,
    type,
    include_keywords: normalizeKeywords(req.body.includeKeywords),
    exclude_keywords: normalizeKeywords(req.body.excludeKeywords),
    ...(brandId ? { brand_id: brandId } : {}),
    refresh_minutes: parseRefreshMinutes(req.body.refreshMinutes),
  }).select("*").single();
  if (error) throw error;

  // First ingest right away: the pane shows cards the moment the source is
  // added. A dead feed does NOT reject the creation — it starts as «error»
  // with the reason attached, same as the sweep would leave it.
  let warning: string | null = null;
  try {
    const sweep = await ingestDueSources(sb, { forceSourceIds: [created.id], workspaceId });
    if (sweep.errors.length) warning = `Fuente creada, pero la primera lectura falló: ${sweep.errors[0].error}`;
  } catch (err) {
    warning = `Fuente creada, pero la primera lectura falló: ${(err as Error).message}`;
  }

  const { data: fresh } = await sb.from("research_sources").select("*").eq("id", created.id).maybeSingle();
  res.status(201).json({ success: true, data: fresh || created, ...(warning ? { warning } : {}) });
}));

researchRoutes.patch("/sources/:id", withSetupCheck(async (req, res) => {
  const sb = dbOr503(res);
  if (!sb) return;
  const existing = await loadSource(sb, req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: "Fuente no encontrada" });
  if (!(await gateEditor(req, existing.workspace_id, res))) return;

  const patch: Record<string, unknown> = {};
  try {
    if (req.body.name !== undefined) {
      const name = String(req.body.name || "").trim();
      if (!name) throw new ResearchArgsError("name no puede quedar vacío");
      patch.name = name;
    }
    if (req.body.url !== undefined) patch.url = parseSourceUrl(req.body.url);
    if (req.body.type !== undefined) {
      if (!SOURCE_TYPES.has(String(req.body.type))) throw new ResearchArgsError("type debe ser rss o nitter");
      patch.type = String(req.body.type);
    }
    if (req.body.includeKeywords !== undefined) patch.include_keywords = normalizeKeywords(req.body.includeKeywords);
    if (req.body.excludeKeywords !== undefined) patch.exclude_keywords = normalizeKeywords(req.body.excludeKeywords);
    if (req.body.refreshMinutes !== undefined) patch.refresh_minutes = parseRefreshMinutes(req.body.refreshMinutes);
    if (req.body.active !== undefined) patch.active = Boolean(req.body.active);
    if (req.body.brandId !== undefined) {
      const next = String(req.body.brandId || "").trim() || null;
      patch.brand_id = await checkBrand(sb, existing.workspace_id, next);
    }
  } catch (err) {
    if (err instanceof ResearchArgsError) {
      return res.status(400).json({ success: false, error: err.message });
    }
    throw err;
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ success: false, error: "Nada que actualizar" });
  }
  // A new URL/type invalidates the previous diagnostics: the chip starts clean.
  if (patch.url !== undefined || patch.type !== undefined) {
    patch.last_status = null;
    patch.last_error = null;
  }
  patch.updated_at = new Date().toISOString();
  const { data, error } = await sb.from("research_sources")
    .update(patch).eq("id", req.params.id).select("*").single();
  if (error) throw error;
  res.json({ success: true, data });
}));

researchRoutes.delete("/sources/:id", withSetupCheck(async (req, res) => {
  const sb = dbOr503(res);
  if (!sb) return;
  const existing = await loadSource(sb, req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: "Fuente no encontrada" });
  if (!(await gateEditor(req, existing.workspace_id, res))) return;
  const { error } = await sb.from("research_sources").delete().eq("id", req.params.id);
  if (error) throw error;
  res.json({ success: true });
}));

/** Manual refresh — the pane's button (and research_refresh_sources parity).
 *  Scoped to THIS workspace; optional sourceIds refresh only those. */
researchRoutes.post("/sources/refresh", withSetupCheck(async (req, res) => {
  const sb = dbOr503(res);
  if (!sb) return;
  const workspaceId = String(req.body.workspaceId || "");
  if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
  if (!(await gateEditor(req, workspaceId, res))) return;
  const requested = Array.isArray(req.body.sourceIds) ? req.body.sourceIds.map((id: unknown) => String(id)) : null;
  if (requested) {
    const { data: owned } = await sb.from("research_sources").select("id")
      .eq("workspace_id", workspaceId).in("id", requested);
    const ownedIds = new Set((owned || []).map((r: { id: string }) => r.id));
    if (requested.some((id: string) => !ownedIds.has(id))) {
      return res.status(404).json({ success: false, error: "Hay sourceIds que no pertenecen a este workspace" });
    }
  }
  const sweep = await ingestDueSources(sb, {
    forceSourceIds: requested && requested.length ? requested : null,
    workspaceId,
  });
  res.json({ success: true, data: sweep });
}));

// ── Items (the cards) ───────────────────────────────────────────────────────

researchRoutes.get("/items", withSetupCheck(async (req, res) => {
  const sb = dbOr503(res);
  if (!sb) return;
  const workspaceId = String(req.query.workspaceId || "");
  if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
  if (!(await gateViewer(req, workspaceId, res))) return;
  let query = sb.from("research_items").select("*").eq("workspace_id", workspaceId);
  if (req.query.status) {
    if (!ITEM_STATUSES.has(String(req.query.status))) {
      return res.status(400).json({ success: false, error: "status debe ser new, used o dismissed" });
    }
    query = query.eq("status", String(req.query.status));
  }
  if (req.query.sourceId) query = query.eq("source_id", String(req.query.sourceId));
  const limit = Math.min(200, Math.max(1, Math.round(Number(req.query.limit)) || 50));
  const { data, error } = await query.order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  res.json({ success: true, data: data || [] });
}));

researchRoutes.patch("/items/:id", withSetupCheck(async (req, res) => {
  const sb = dbOr503(res);
  if (!sb) return;
  const { data: existing, error: loadError } = await sb.from("research_items")
    .select("id, workspace_id").eq("id", req.params.id).maybeSingle();
  if (loadError) throw loadError;
  if (!existing) return res.status(404).json({ success: false, error: "Item no encontrado" });
  if (!(await gateEditor(req, existing.workspace_id, res))) return;
  const status = String(req.body.status || "");
  if (!ITEM_STATUSES.has(status)) {
    return res.status(400).json({ success: false, error: "status debe ser new, used o dismissed" });
  }
  const { data, error } = await sb.from("research_items")
    .update({ status }).eq("id", req.params.id).select("*").single();
  if (error) throw error;
  res.json({ success: true, data });
}));

// ── Requests (the encargo «un click») ───────────────────────────────────────

researchRoutes.post("/requests", withSetupCheck(async (req, res) => {
  const sb = dbOr503(res);
  if (!sb) return;
  const workspaceId = String(req.body.workspaceId || "");
  const itemId = String(req.body.itemId || "");
  if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
  if (!itemId) return res.status(400).json({ success: false, error: "itemId is required" });
  if (!(await gateEditor(req, workspaceId, res))) return;

  const item = await loadItem(sb, itemId);
  if (!item || item.workspace_id !== workspaceId) {
    return res.status(404).json({ success: false, error: "Item no encontrado en este workspace" });
  }
  if (item.status === "dismissed") {
    return res.status(400).json({ success: false, error: "El item está descartado: re habilítalo antes de generar contenido" });
  }

  let args;
  try {
    args = normalizeRequestArgs(req.body);
  } catch (err) {
    if (err instanceof ResearchArgsError) {
      return res.status(400).json({ success: false, error: err.message });
    }
    throw err;
  }

  let brandName: string | null = null;
  if (args.brandId) {
    const { data: brand } = await sb.from("brands").select("id, name")
      .eq("id", args.brandId).eq("workspace_id", workspaceId).maybeSingle();
    if (!brand) return res.status(400).json({ success: false, error: "La marca no pertenece a este workspace" });
    brandName = brand.name || null;
  }

  const resumeToken = newResumeToken();
  const expiresAt = new Date(Date.now() + RESEARCH_LIMITS.requestTtlMinutes * 60_000).toISOString();
  const briefing = buildResearchBriefing({
    item,
    networks: args.networks,
    formats: args.formats,
    includeDesign: args.includeDesign,
    brandName,
    notes: args.notes,
    scheduledDate: args.scheduledDate,
    resumeToken,
    sourceName: item.source_name,
  });

  const { data, error } = await sb.from("research_requests").insert({
    workspace_id: workspaceId,
    item_id: itemId,
    networks: args.networks,
    formats: args.formats,
    include_design: args.includeDesign,
    ...(args.brandId ? { brand_id: args.brandId } : {}),
    notes: args.notes,
    scheduled_date: args.scheduledDate,
    briefing,
    resume_token: resumeToken,
    expires_at: expiresAt,
  }).select("*").single();
  if (error) throw error;
  res.status(201).json({ success: true, data });
}));

researchRoutes.get("/requests", withSetupCheck(async (req, res) => {
  const sb = dbOr503(res);
  if (!sb) return;
  const workspaceId = String(req.query.workspaceId || "");
  if (!workspaceId) return res.status(400).json({ success: false, error: "workspaceId is required" });
  if (!(await gateViewer(req, workspaceId, res))) return;
  let query = sb.from("research_requests")
    .select("*, research_items(id, title, link, image_url, source_name, status)")
    .eq("workspace_id", workspaceId);
  if (req.query.itemId) query = query.eq("item_id", String(req.query.itemId));
  if (req.query.status) {
    if (!["pending", "done", "error"].includes(String(req.query.status))) {
      return res.status(400).json({ success: false, error: "status debe ser pending, done o error" });
    }
    query = query.eq("status", String(req.query.status));
  }
  const { data, error } = await query.order("created_at", { ascending: false }).limit(50);
  if (error) throw error;
  res.json({ success: true, data: data || [] });
}));
