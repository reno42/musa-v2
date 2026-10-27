/**
 * Design File Metadata Routes
 * ──────────────────────────────────────────────────────────────
 * CRUD for design_file_meta: brand, tags, theme, format, file_type,
 * cover_image_url, obsidian_link. Keyed by template_id.
 *
 * GET  /api/meta/:templateId        — read metadata
 * PUT  /api/meta/:templateId        — upsert metadata
 * GET  /api/graph?workspaceId=&brand=&tag=  — query graph nodes
 * GET  /api/meta/:templateId/taxonomy      — workspace brands/categories/tags
 * GET  /api/meta/:templateId/tag-suggestions — content-driven tag suggestions
 * POST /api/meta/:templateId/cover  — upload cover image
 *
 * @module routes/designMeta
 */

import { Router, type Request, type Response } from "express";
import { randomBytes } from "node:crypto";
import { getSupabase, removeStalePreviewFiles } from "../services/supabase.js";
import { templateRowIsRegularFile } from "../services/templates.js";
import { store } from "../services/store.js";
import { canAccessWorkspace, listAccessibleWorkspaceIds } from "../services/tenancy.js";
import { emitArchivoNoteForTemplate } from "../services/brainNotes.js";
import type { RequestAuth } from "../services/requestContext.js";
import { isPreviewSnoozeDays } from "../../../shared/previewReminder.ts";
import { buildCooccurrence, suggestTags } from "../../../shared/tagSuggest.ts";

export const designMetaRoutes = Router();

/** Same local-const convention as templates.ts / copyRecipes.ts. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Who owns a preview reminder: a signed-in user OR a workspace key whose
 * creator is that same user (key auth carries created_by as userId). It used
 * to demand authType === "user" strictly, which turned a routine token
 * refresh race into a silent feature loss: the editor fires GET /api/meta
 * before supabase-js finishes refreshing an expired access token, the request
 * falls back to the stored x-api-key, the reminder lookup was skipped — and
 * the popover reappeared on every re-entry with zero console noise.
 * Dev ids ("admin", "anonymous", raw bearers) are not UUIDs and never match.
 */
function reminderUserId(auth?: RequestAuth): string | null {
  if (!auth || (auth.authType !== "user" && auth.authType !== "workspace_key")) return null;
  const id = auth.userId || "";
  return UUID_RE.test(id) ? id : null;
}

/** The branches a file can hang from in the brand graph. */
const CATEGORIES = ["Design System", "Plantillas", "Assets", "Archivos"];

/** Empty or unknown means "no explicit branch" — the graph falls back to Archivos. */
function normalizeCategory(value: unknown): string | null {
  const typed = String(value ?? "").trim();
  if (!typed) return null;
  return CATEGORIES.find(c => c.toLowerCase() === typed.toLowerCase()) ?? null;
}

/**
 * True when the design_categories table itself is not there — REQ-061's v85
 * has not run against THIS database. Same failure family as the column
 * checks above: 42P01 from Postgres, PGRST205 from PostgREST's schema cache.
 */
function isMissingCategoriesTable(error: unknown): boolean {
  const err = error as { message?: string; code?: string } | null;
  const code = String(err?.code ?? "");
  if (code === "42P01" || code === "PGRST205") return true;
  const message = (error instanceof Error ? error.message : String(err?.message ?? "")).toLowerCase();
  return message.includes("design_categories") && (message.includes("does not exist") || message.includes("schema cache") || message.includes("could not find the table"));
}

/** Seed the four historical branches the first time a workspace is seen
 *  (REQ-061 lazy seeding). Idempotent: unique(workspace_id, name) + ignore
 *  duplicates makes re-runs no-ops. */
async function ensureWorkspaceCategories(sb: NonNullable<ReturnType<typeof getSupabase>>, workspaceId: string, createdBy: string): Promise<void> {
  const seed = CATEGORIES.map(name => ({ workspace_id: workspaceId, name, created_by: createdBy }));
  const { error } = await sb.from("design_categories")
    .upsert(seed, { onConflict: "workspace_id,name", ignoreDuplicates: true });
  if (error) throw error;
}

/**
 * REQ-061 — categories are rows, not a hardcoded enum. Resolve the typed
 * name against design_categories for the workspace, creating the row when
 * new (the same contract the brand field has had since the data tables).
 * Falls back to the legacy four branches while v85 is pending, so writes
 * never hard-fail on a database the migration has not reached yet.
 */
async function resolveDesignCategory(
  sb: NonNullable<ReturnType<typeof getSupabase>>,
  workspaceId: string,
  raw: unknown,
  createdBy: string,
): Promise<string | null> {
  const typed = String(raw ?? "").trim();
  if (!typed) return null;
  try {
    const { data: rows, error } = await sb.from("design_categories")
      .select("id, name").eq("workspace_id", workspaceId);
    if (error) throw error;
    let known = rows || [];
    if (known.length === 0) {
      await ensureWorkspaceCategories(sb, workspaceId, createdBy);
      const { data: seeded, error: seedError } = await sb.from("design_categories")
        .select("id, name").eq("workspace_id", workspaceId);
      if (seedError) throw seedError;
      known = seeded || [];
    }
    const match = known.find((c: any) => String(c.name).toLowerCase() === typed.toLowerCase());
    if (match) return match.name;
    const { data: created, error: createError } = await sb.from("design_categories")
      .insert({ workspace_id: workspaceId, name: typed, created_by: createdBy })
      .select("id, name").single();
    if (createError) {
      // A concurrent write registered the same branch first — reuse it.
      const { data: again } = await sb.from("design_categories")
        .select("id, name").eq("workspace_id", workspaceId).ilike("name", typed).limit(1).maybeSingle();
      if (again) return again.name;
      throw createError;
    }
    return created.name;
  } catch (err) {
    if (isMissingCategoriesTable(err)) return normalizeCategory(typed);
    throw err;
  }
}

/**
 * True when the database rejected the write because design_file_meta.category
 * is not there — v21 has not been run against THIS database.
 *
 * Two different wordings, and matching only the first is why this surfaced as
 * a blank 500 rather than the message below. Reading a missing column raises
 * Postgres 42703, "column ... does not exist". Writing one PostgREST rejects
 * before it ever reaches Postgres, against its own schema cache, as PGRST204
 * "Could not find the 'category' column ... in the schema cache". The write
 * path only ever produces the second.
 */
function isMissingCategoryColumn(error: unknown): boolean {
  const err = error as { message?: string; code?: string } | null;
  const code = String(err?.code ?? "");
  if (code === "PGRST204" || code === "42703") return true;
  const message = (error instanceof Error ? error.message : String(err?.message ?? "")).toLowerCase();
  if (!message.includes("category")) return false;
  return message.includes("does not exist") || message.includes("schema cache");
}

/** Igual que arriba pero para design_file_meta.notes_md — v48 (Second Brain)
 *  todavía no corrió en ESTA base. La firma del fallo es la misma familia
 *  PGRST204/42703, solo cambia el nombre de la columna en el mensaje. */
function isMissingNotesColumn(error: unknown): boolean {
  const err = error as { code?: string; message?: string } | null;
  const code = String(err?.code ?? "");
  const message = String(err?.message ?? "");
  const mentionsNotes = /notes_md/i.test(message);
  if (!mentionsNotes) return false;
  if (code === "PGRST204" || code === "42703") return true;
  return /does not exist|schema cache/i.test(message);
}

/** GET /api/meta/:templateId */
designMetaRoutes.get("/:templateId", async (req, res) => {
  try {
    const sb = getSupabase();
    if (!sb) {
      // fallback to memory store
      const meta = store.getMeta?.(req.params.templateId) ?? null;
      return res.json({ success: true, data: meta });
    }
    const userId = reminderUserId(req.auth);
    if (!userId && req.auth && req.auth.authType !== "dev") {
      // An authenticated caller whose identity can't own a reminder — visible
      // in the API log instead of silently answering preview_snoozed_until:null.
      console.warn(`[meta] GET ${req.params.templateId}: identidad sin recordatorio (authType=${req.auth.authType})`);
    }
    const [metaResult, templateResult, reminderResult] = await Promise.all([
      sb.from("design_file_meta").select("*").eq("template_id", req.params.templateId).maybeSingle(),
      sb.from("templates").select("content_updated_at, updated_at").eq("id", req.params.templateId).single(),
      userId
        ? sb.from("preview_reminder_preferences")
            .select("snoozed_until, snooze_days")
            .eq("user_id", userId)
            .eq("template_id", req.params.templateId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (metaResult.error) throw metaResult.error;
    if (templateResult.error) throw templateResult.error;
    if (reminderResult.error) throw reminderResult.error;
    res.json({
      success: true,
      data: {
        ...rowToMeta(metaResult.data || {}),
        content_updated_at: templateResult.data.content_updated_at || templateResult.data.updated_at,
        preview_snoozed_until: reminderResult.data?.snoozed_until || null,
        preview_snooze_days: reminderResult.data?.snooze_days || null,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** PUT /api/meta/:templateId/preview-reminder — snooze for this user and file. */
designMetaRoutes.put("/:templateId/preview-reminder", async (req, res) => {
  try {
    const ownerId = reminderUserId(req.auth);
    if (!ownerId) {
      return res.status(403).json({ success: false, error: "A signed-in user session is required" });
    }
    const days = Number(req.body.days);
    if (!isPreviewSnoozeDays(days)) {
      return res.status(400).json({ success: false, error: "days must be one of 1, 2, 3, 5, 20, 30" });
    }
    const sb = getSupabase();
    if (!sb) return res.status(503).json({ success: false, error: "Supabase not connected" });
    const snoozedUntil = new Date(Date.now() + days * 86_400_000).toISOString();
    const { error } = await sb.from("preview_reminder_preferences").upsert({
      user_id: ownerId,
      template_id: req.params.templateId,
      snoozed_until: snoozedUntil,
      snooze_days: days,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,template_id" });
    if (error) throw error;
    res.json({ success: true, data: { snoozed_until: snoozedUntil, snooze_days: days } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** PUT /api/meta/:templateId — upsert metadata fields */
designMetaRoutes.put("/:templateId", async (req, res) => {
  const { templateId } = req.params; // outside the try so the catch can name it
  try {
    const { brand_id, brand, campaign_id, campaign, category, content_kind, asset_type, designer_type, is_permanent, production_data, tags, theme, format, file_type, cover_image_url, obsidian_link, notes_md } = req.body;

    const patch: Record<string, any> = {};
    if (brand_id !== undefined) patch.brand_id = brand_id || null;
    if (brand !== undefined) patch.brand = brand;
    if (campaign_id !== undefined) patch.campaign_id = campaign_id || null;
    if (campaign !== undefined) patch.campaign = campaign;
    // REQ-061: resolved against design_categories once the workspace is
    // known (below); kept raw here so an empty string still clears the field.
    if (category !== undefined) patch.category = String(category ?? "").trim();
    if (content_kind !== undefined) {
      // Provenance, not current state: what the design was FIRST used for.
      const kind = String(content_kind || "").trim().toLowerCase();
      patch.content_kind = kind === "ad" || kind === "organic" ? kind : null;
    }
    if (asset_type !== undefined) patch.asset_type = asset_type || "other";
    if (designer_type !== undefined) patch.designer_type = designer_type || "other";
    if (is_permanent !== undefined) patch.is_permanent = Boolean(is_permanent);
    if (production_data !== undefined) patch.production_data = production_data;
    if (tags !== undefined) patch.tags = tags;
    if (theme !== undefined) patch.theme = theme;
    if (format !== undefined) patch.format = format;
    if (file_type !== undefined) patch.file_type = file_type;
    if (cover_image_url !== undefined) patch.cover_image_url = cover_image_url;
    if (obsidian_link !== undefined) patch.obsidian_link = obsidian_link;
    // v48 (Second Brain): notas Markdown del nodo — texto libre, el graph
    // drawer lo renderiza y lo edita; recortamos un tope generoso por sanidad.
    if (notes_md !== undefined) patch.notes_md = typeof notes_md === "string" ? notes_md.slice(0, 100_000) : null;

    // A body of nothing this route understands used to answer 200 and write
    // nothing, which is how the table's Categoria column looked broken for so
    // long: the request succeeded, the cell snapped back, no error anywhere.
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ success: false, error: "No recognised metadata fields in body" });
    }

    const sb = getSupabase();
    if (!sb) {
      // memory fallback — no design_categories table to resolve against.
      if (patch.category !== undefined) patch.category = normalizeCategory(patch.category);
      store.setMeta?.(templateId, patch);
      return res.json({ success: true });
    }

    // requireTemplateAccess already resolved and authorised this; re-querying
    // it here only added a round trip to every write.
    const workspaceId = req.templateWorkspaceId
      || (await sb.from("templates").select("workspace_id").eq("id", templateId).maybeSingle()).data?.workspace_id;
    if (!workspaceId) return res.status(404).json({ success: false, error: "Template not found" });
    const template = { workspace_id: workspaceId };

    if (patch.brand_id) {
      const { data: selectedBrand } = await sb.from("brands").select("id, name")
        .eq("workspace_id", template.workspace_id).eq("id", patch.brand_id).maybeSingle();
      if (!selectedBrand) return res.status(400).json({ success: false, error: "Brand does not belong to this workspace" });
      patch.brand = selectedBrand.name;
    } else if (patch.brand !== undefined && !patch.brand_id) {
      // A caller that sends only a brand NAME (the data tables do — the user
      // types into the cell; the info panel sends the whole meta object with
      // brand_id null) used to have it stored as loose text while brand_id
      // kept pointing at the old brand. The graph reads brand_id first, so
      // the file never moved and the edit looked ignored. Resolve the name to
      // a real row here, creating the brand when it is new.
      const typed = String(patch.brand ?? "").trim();
      if (!typed) {
        patch.brand = null;
        patch.brand_id = null;
        patch.campaign_id = null;
      } else {
        const { data: match } = await sb.from("brands").select("id, name")
          .eq("workspace_id", template.workspace_id).ilike("name", typed).limit(1).maybeSingle();
        if (match) {
          patch.brand_id = match.id;
          patch.brand = match.name;
        } else {
          const { data: created, error: createError } = await sb.from("brands").insert({
            id: `brand_${randomBytes(10).toString("hex")}`,
            workspace_id: template.workspace_id,
            name: typed,
          }).select("id, name").single();
          if (createError) throw createError;
          patch.brand_id = created.id;
          patch.brand = created.name;
        }
      }
    }

    if (patch.campaign === "" || patch.brand_id === null) {
      patch.campaign_id = null;
    } else if (patch.campaign && patch.brand_id) {
      const campaignName = String(patch.campaign).trim();
      const { data: existingCampaign } = await sb.from("campaigns").select("id, name")
        .eq("workspace_id", template.workspace_id)
        .eq("brand_id", patch.brand_id)
        .ilike("name", campaignName)
        .maybeSingle();
      if (existingCampaign) {
        patch.campaign_id = existingCampaign.id;
        patch.campaign = existingCampaign.name;
      } else {
        const { data: createdCampaign, error: campaignError } = await sb.from("campaigns").insert({
          workspace_id: template.workspace_id,
          brand_id: patch.brand_id,
          name: campaignName,
        }).select("id, name").single();
        if (campaignError) throw campaignError;
        patch.campaign_id = createdCampaign.id;
        patch.campaign = createdCampaign.name;
      }
    }

    // REQ-061 — category branches are rows in design_categories now: resolve
    // the typed name there (creating it when new), the same contract the
    // brand block above has. Null clears the field.
    if (patch.category !== undefined) {
      patch.category = await resolveDesignCategory(
        sb,
        template.workspace_id,
        patch.category,
        req.auth?.userId ? `user:${req.auth.userId}` : "key:api",
      );
    }

    // Upsert: try update first, insert if not found.
    //
    // limit(1) rather than maybeSingle(): design_file_meta is UNIQUE on
    // template_id only if the table was created by v4, and this database has
    // had tables arrive by other routes. maybeSingle() THROWS on a second row
    // (PGRST116) instead of returning one, which would turn a duplicate into
    // an unexplained 500 on that one file and no other.
    const { data: existingRows, error: lookupError } = await sb
      .from("design_file_meta")
      .select("id")
      .eq("template_id", templateId)
      .limit(1);
    if (lookupError) throw lookupError;

    if (existingRows && existingRows.length > 0) {
      patch.updated_at = new Date().toISOString();
      const { error } = await sb
        .from("design_file_meta")
        .update(patch)
        .eq("template_id", templateId);
      if (error) throw error;
    } else {
      patch.template_id = templateId;
      patch.workspace_id = template.workspace_id;
      const { error } = await sb.from("design_file_meta").insert(patch);
      if (error) throw error;
    }

    // The file's brain note regenerates when its filing changes (marca,
    // campaña, categoría, tags…). Fire-and-forget: la respuesta nunca espera
    // al vault, y lo escrito por el humano sobrevive (bloques protegidos).
    void emitArchivoNoteForTemplate(templateId).catch(() => { /* best-effort */ });

    res.json({ success: true });
  } catch (err: any) {
    if (isMissingNotesColumn(err)) {
      console.warn(`[meta] notes_md missing writing ${templateId}:`, err?.code, err?.message);
      return res.status(409).json({
        success: false,
        error: `Las notas del Second Brain necesitan la migración supabase_migrations_v48.sql en el proyecto de Supabase que usa produccion, y recargar el esquema (Settings -> API -> Reload schema cache). Detalle: ${err?.message || err}`,
      });
    }
    if (isMissingCategoryColumn(err)) {
      console.warn(`[meta] missing column writing ${templateId}:`, err?.code, err?.message);
      return res.status(409).json({
        success: false,
        error: `Falta una columna en esta base de datos: ejecuta supabase_migrations_v21.sql en el proyecto de Supabase que usa produccion, y recarga el esquema (Settings -> API -> Reload schema cache). Detalle: ${err?.message || err}`,
      });
    }
    // Logged as well as returned: a 500 that only exists in the response body
    // cannot be looked up afterwards.
    console.error(`[meta] PUT ${templateId} failed:`, err?.code, err?.message, err?.details || "");
    res.status(500).json({ success: false, error: err?.message || "Error interno" });
  }
});

/** GET /api/graph?workspaceId=...&brand=...&tag=... */
export async function getDesignGraph(req: Request, res: Response): Promise<void> {
  try {
    const { workspaceId, brand, tag, format, designer_type } = req.query;
    const sb = getSupabase();
    if (!sb) {
      res.json({ success: true, data: { nodes: [] } });
      return;
    }

    if (!req.auth) {
      res.status(401).json({ success: false, error: "Authentication required" });
      return;
    }

    const requestedWorkspaceId = typeof workspaceId === "string" ? workspaceId : "";
    const workspaceIds = requestedWorkspaceId
      ? [requestedWorkspaceId]
      : await listAccessibleWorkspaceIds(req.auth);
    if (requestedWorkspaceId && !(await canAccessWorkspace(req.auth, requestedWorkspaceId, "viewer"))) {
      res.status(403).json({ success: false, error: "You do not have access to this workspace" });
      return;
    }
    if (workspaceIds.length === 0) {
      res.json({ success: true, data: { workspace: null, brands: [], contacts: [], nodes: [] } });
      return;
    }

    // scope=archivos — alinea el universo de nodos con el listado de
    // Archivos (services/templates.ts). Sin esto el contador de facetas
    // contaba sobre TODA design_file_meta: archivos en la papelera y
    // contenedores de marca que el grid jamás muestra, así que «Marca (7)»
    // bajaba a 2 al filtrar. Con _contenedores se respetan trash y nada más
    // (el grid con «Contenedores de marca» tildado).
    //
    // REQ-062 hotfix: el filtrado va EN JS con el predicado compartido
    // (templateRowIsRegularFile) — los filtros PostgREST embebidos
    // (is/or= sobre templates.*) no parsean en el PostgREST de producción
    // ("failed to parse logic tree") y tumbaban /api/graph entero.
    // Los markers viajan como escalares en el embed (data->> extrae server-side).
    const scope = String(req.query.scope || "");
    const embedSelect = scope === "archivos" || scope === "archivos_contenedores"
      ? "*, templates!inner(id, name, thumbnail, deleted_at, is_brand_manual, brand_container_kind, mirror_kind:data->>brandContainerKind, mirror_manual:data->>isBrandManual)"
      : "*, templates!inner(id, name, thumbnail)";
    let query = sb.from("design_file_meta").select(embedSelect);

    query = workspaceIds.length === 1
      ? query.eq("workspace_id", workspaceIds[0])
      : query.in("workspace_id", workspaceIds);
    if (brand) query = query.ilike("brand", brand as string);
    if (tag) query = query.contains("tags", [tag as string]);
    if (format) query = query.eq("format", format as string);
    if (designer_type) query = query.eq("designer_type", designer_type as string);

    const [designResult, workspaceResult, brandResult, contactResult] = await Promise.all([
      query,
      sb.from("workspaces").select("id, name").in("id", workspaceIds).order("name"),
      sb.from("brands").select("*").in("workspace_id", workspaceIds).order("name"),
      sb.from("crm_contacts")
        .select("id, workspace_id, brand_id, brand_name, first_name, last_name, email, job_title, status")
        .in("workspace_id", workspaceIds)
        .order("first_name"),
    ]);
    if (designResult.error) throw designResult.error;
    if (workspaceResult.error) throw workspaceResult.error;
    if (brandResult.error) throw brandResult.error;
    if (contactResult.error) throw contactResult.error;

    // scope=archivos — filtra EN JS con el predicado compartido (mismo
    // contrato que brandContainerExcludeClauses del listado): sin papelera
    // y sin contenedores de marca. _contenedores solo saca la papelera.
    const rowsScoped: any[] = designResult.data || [];
    const rowsFinal = scope === "archivos"
      ? rowsScoped.filter((r: any) => templateRowIsRegularFile(r.templates))
      : scope === "archivos_contenedores"
        ? rowsScoped.filter((r: any) => !r.templates?.deleted_at)
        : rowsScoped;

    const nodes = rowsFinal.map((r: any) => ({
      id: r.template_id,
      name: r.templates?.name || r.template_id,
      brand_id: r.brand_id || null,
      brand: r.brand || "",
      campaign_id: r.campaign_id || null,
      campaign: r.campaign || null,
      category: r.category || "",
      content_kind: r.content_kind || null,
      asset_type: r.asset_type || null,
      designer_type: r.designer_type || "other",
      is_permanent: Boolean(r.is_permanent),
      tags: r.tags || [],
      theme: r.theme || "",
      format: r.format || "",
      file_type: r.file_type || "",
      cover: r.cover_image_url || r.templates?.thumbnail || null,
      obsidian_link: r.obsidian_link || "",
    }));

    const brands = (brandResult.data || [])
      .filter((item: any) => !brand || item.name?.toLocaleLowerCase() === String(brand).toLocaleLowerCase())
      .map((item: any) => ({
        id: item.id,
        name: item.name,
        relationship_status: item.relationship_status || null,
      }));
    const contacts = (contactResult.data || [])
      .filter((contact: any) => !brand || contact.brand_name?.toLocaleLowerCase() === String(brand).toLocaleLowerCase() || brands.some((item: any) => item.id === contact.brand_id));
    const workspaces = workspaceResult.data || [];
    const workspace = workspaces.length === 1 ? workspaces[0] : { id: "all", name: "Tus marcas" };

    res.json({ success: true, data: { workspace, brands, contacts, nodes } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load design graph";
    res.status(500).json({ success: false, error: message });
  }
}

designMetaRoutes.get("/", getDesignGraph);

/** POST /api/meta/batch — upsert metadata for multiple templates in one call.
 *  Body: { templates: [{ templateId, brand?, campaign?, tags?, ... }] } */
designMetaRoutes.post("/batch", async (req, res) => {
  try {
    const { templates } = req.body;
    if (!Array.isArray(templates) || templates.length === 0) {
      return res.status(400).json({ success: false, error: "templates array required" });
    }
    if (templates.length > 100) {
      return res.status(400).json({ success: false, error: "Max 100 templates per batch" });
    }

    const sb = getSupabase();
    const results: { templateId: string; ok: boolean; error?: string }[] = [];

    for (const entry of templates) {
      const templateId = entry.templateId || entry.template_id;
      if (!templateId) { results.push({ templateId: "", ok: false, error: "Missing templateId" }); continue; }
      try {
        const patch: Record<string, any> = {};
        if (entry.brand !== undefined) patch.brand = entry.brand;
        if (entry.brand_id !== undefined) patch.brand_id = entry.brand_id;
        if (entry.campaign !== undefined) patch.campaign = entry.campaign;
        if (entry.category !== undefined) patch.category = String(entry.category ?? "").trim();
        if (entry.asset_type !== undefined) patch.asset_type = entry.asset_type;
        if (entry.tags !== undefined) patch.tags = entry.tags;
        if (entry.theme !== undefined) patch.theme = entry.theme;
        if (entry.format !== undefined) patch.format = entry.format;
        if (entry.file_type !== undefined) patch.file_type = entry.file_type;
        if (entry.obsidian_link !== undefined) patch.obsidian_link = entry.obsidian_link;
        if (entry.cover_image_url !== undefined) patch.cover_image_url = entry.cover_image_url;
        if (entry.is_permanent !== undefined) patch.is_permanent = Boolean(entry.is_permanent);
        if (entry.designer_type !== undefined) patch.designer_type = entry.designer_type;

        if (Object.keys(patch).length === 0) {
          results.push({ templateId, ok: true }); // no-op
          continue;
        }

        if (!sb) {
          if (patch.category !== undefined) patch.category = normalizeCategory(patch.category);
          store.setMeta?.(templateId, patch);
          results.push({ templateId, ok: true });
          continue;
        }

        const { data: tpl } = await sb.from("templates").select("workspace_id").eq("id", templateId).maybeSingle();
        if (!tpl?.workspace_id) { results.push({ templateId, ok: false, error: "Template not found" }); continue; }

        // REQ-061: batch resolves categories through the same registry.
        if (patch.category !== undefined) {
          patch.category = await resolveDesignCategory(sb, tpl.workspace_id, patch.category, req.auth?.userId ? `user:${req.auth.userId}` : "key:api");
        }

        const { data: existing } = await sb.from("design_file_meta").select("id").eq("template_id", templateId).maybeSingle();
        if (existing) {
          patch.updated_at = new Date().toISOString();
          const { error } = await sb.from("design_file_meta").update(patch).eq("template_id", templateId);
          results.push({ templateId, ok: !error, error: error?.message });
        } else {
          patch.template_id = templateId;
          patch.workspace_id = tpl.workspace_id;
          const { error } = await sb.from("design_file_meta").insert(patch);
          results.push({ templateId, ok: !error, error: error?.message });
        }
      } catch (err: any) {
        results.push({ templateId, ok: false, error: err.message });
      }
    }
    const failed = results.filter(r => !r.ok).length;
    res.json({ success: true, data: { total: templates.length, succeeded: results.length - failed, failed, results } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** Workspace brands, campaigns, category branches and tag cloud for this design file. */
designMetaRoutes.get("/:templateId/taxonomy", async (req, res) => {
  try {
    const sb = getSupabase();
    if (!sb) return res.json({ success: true, data: { brands: [], campaigns: [], categories: [], tags: [] } });
    const { data: template, error: templateError } = await sb.from("templates")
      .select("workspace_id").eq("id", req.params.templateId).maybeSingle();
    if (templateError) throw templateError;
    if (!template?.workspace_id) return res.status(404).json({ success: false, error: "Template not found" });

    const [brandResult, campaignResult] = await Promise.all([
      sb.from("brands").select("*").eq("workspace_id", template.workspace_id).order("name"),
      sb.from("campaigns").select("id, brand_id, name, status").eq("workspace_id", template.workspace_id).order("name"),
    ]);
    if (brandResult.error) throw brandResult.error;

    // REQ-061 — the branches are workspace rows now (lazily seeded on first
    // read), and the tag cloud comes from actual usage with design_tags
    // registry metadata layered on when a tag is registered. Both degrade
    // gracefully while v85 is pending.
    let categories: any[] = [];
    let tags: any[] = [];
    try {
      let catRows: any[] = [];
      const { data: catData, error: catError } = await sb.from("design_categories")
        .select("id, name, color, scope, created_by")
        .eq("workspace_id", template.workspace_id).order("name");
      if (catError) throw catError;
      catRows = catData || [];
      if (catRows.length === 0) {
        await ensureWorkspaceCategories(sb, template.workspace_id, "seed:legacy");
        const { data: seededRows, error: seedError } = await sb.from("design_categories")
          .select("id, name, color, scope, created_by")
          .eq("workspace_id", template.workspace_id).order("name");
        if (seedError) throw seedError;
        catRows = seededRows || [];
      }
      const { data: metaRows, error: metaError } = await sb.from("design_file_meta")
        .select("category, tags").eq("workspace_id", template.workspace_id);
      if (metaError) throw metaError;
      const catCounts = new Map<string, number>();
      const tagCounts = new Map<string, number>();
      for (const row of metaRows || []) {
        const cat = String(row.category || "").trim();
        if (cat) catCounts.set(cat, (catCounts.get(cat) || 0) + 1);
        for (const t of Array.isArray(row.tags) ? row.tags : []) {
          const tag = String(t).trim();
          if (tag) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        }
      }
      const tagNames = [...tagCounts.keys()].sort((a, b) => (tagCounts.get(b) || 0) - (tagCounts.get(a) || 0));
      const registry = new Map<string, any>();
      if (tagNames.length) {
        const { data: regRows, error: regError } = await sb.from("design_tags")
          .select("name, parent_name, color, is_internal, created_by, workspace_id")
          .or(`workspace_id.eq.${template.workspace_id},workspace_id.is.null`)
          .in("name", tagNames.slice(0, 500));
        if (!regError) {
          for (const reg of regRows || []) registry.set(String(reg.name).toLowerCase(), reg);
        }
      }
      categories = catRows.map((c: any) => ({
        id: c.id,
        name: c.name,
        color: c.color || null,
        scope: c.scope || "workspace",
        created_by: c.created_by || null,
        count: catCounts.get(c.name) || 0,
      }));
      tags = tagNames.map(name => {
        const reg = registry.get(name.toLowerCase());
        return {
          name,
          count: tagCounts.get(name) || 0,
          parent: reg?.parent_name || null,
          color: reg?.color || null,
          // Fase 2: workspace_id NULL = vocabulario global de la cuenta.
          scope: reg ? (reg.workspace_id ? "workspace" : "global") : "workspace",
          is_internal: Boolean(reg?.is_internal),
          created_by: reg?.created_by || null,
        };
      });
    } catch (taxonomyError) {
      if (!isMissingCategoriesTable(taxonomyError)) throw taxonomyError;
      // v85 pending: keep the four legacy branches visible so the panel works.
      categories = CATEGORIES.map(name => ({ id: null, name, color: null, scope: "workspace", created_by: null, count: 0 }));
    }

    res.json({
      success: true,
      data: {
        // The panel needs the workspace id to hit the CRM brand endpoints
        // (POST /api/workspaces/:id/brands) when the user adds a brand in
        // place — one table, every surface (CRM, grafo, panel) stays in sync.
        workspaceId: template.workspace_id,
        brands: (brandResult.data || []).map((brand: any) => ({
          id: brand.id,
          name: brand.name,
          relationship_status: brand.relationship_status || "lead",
        })),
        campaigns: campaignResult.error ? [] : (campaignResult.data || []),
        categories,
        tags,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** REQ-061 Fase 2 — deterministic tag suggestions for this design file
 *  (pure engine in shared/tagSuggest.ts, zero LLM cost; MCP parity via
 *  design_tag_suggest). Context comes from the file itself (name, meta
 *  category, current tags); `theme`/`category`/`brand`/`limit` query params
 *  override for what-if previews. */
designMetaRoutes.get("/:templateId/tag-suggestions", async (req, res) => {
  try {
    const sb = getSupabase();
    if (!sb) return res.json({ success: true, data: { suggestions: [] } });
    const { data: template, error: templateError } = await sb.from("templates")
      .select("id, name, workspace_id").eq("id", req.params.templateId).maybeSingle();
    if (templateError) throw templateError;
    if (!template?.workspace_id) return res.status(404).json({ success: false, error: "Template not found" });

    const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 5));
    const metaRes = await sb.from("design_file_meta")
      .select("tags, category").eq("template_id", template.id).maybeSingle();
    const meta = metaRes.error ? null : metaRes.data;
    const currentTags = Array.isArray(meta?.tags)
      ? (meta.tags as unknown[]).map(t => String(t).trim()).filter(Boolean)
      : [];
    const category = typeof req.query.category === "string" && req.query.category.trim()
      ? req.query.category.trim()
      : (typeof meta?.category === "string" && meta.category.trim() ? meta.category.trim() : null);

    // Usage rows (popularity + co-occurrence) and the registry (workspace +
    // global scope). Both degrade to empty while v85/v78-era tables are
    // missing — free tags alone still produce suggestions.
    const [rowsRes, regRes] = await Promise.all([
      sb.from("design_file_meta").select("tags, category").eq("workspace_id", template.workspace_id),
      sb.from("design_tags").select("name, is_internal, parent_name")
        .or(`workspace_id.eq.${template.workspace_id},workspace_id.is.null`),
    ]);
    const rows = rowsRes.error ? [] : (rowsRes.data || []);
    const registry = regRes.error ? [] : (regRes.data || []);
    const tagCounts = new Map<string, number>();
    for (const row of rows) {
      for (const t of Array.isArray(row.tags) ? row.tags : []) {
        const tag = String(t).trim().toLowerCase();
        if (tag) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }
    const candByName = new Map<string, { name: string; count: number; isInternal: boolean; parent: string | null }>();
    for (const [name, count] of tagCounts) {
      candByName.set(name, { name, count, isInternal: false, parent: null });
    }
    for (const reg of registry) {
      const key = String(reg.name).trim().toLowerCase();
      if (!key) continue;
      candByName.set(key, {
        name: String(reg.name).trim(),
        count: tagCounts.get(key) || 0,
        isInternal: Boolean(reg.is_internal),
        parent: reg.parent_name || null,
      });
    }
    const cooccurrence = buildCooccurrence(rows, { currentTags, category });
    const suggestions = suggestTags(
      {
        fileName: template.name,
        theme: typeof req.query.theme === "string" ? req.query.theme : null,
        category,
        brand: typeof req.query.brand === "string" ? req.query.brand : null,
        currentTags,
      },
      [...candByName.values()],
      { limit, cooccurrence },
    );
    res.json({ success: true, data: { suggestions } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/** POST /api/meta/:templateId/cover — upload cover image (base64) */
designMetaRoutes.post("/:templateId/cover", async (req, res) => {
  try {
    const { templateId } = req.params;
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ success: false, error: "imageBase64 required" });

    const sb = getSupabase();
    if (!sb) return res.status(503).json({ success: false, error: "Supabase not connected" });

    // Decode base64
    const mimeMatch = imageBase64.match(/^data:(image\/\w+);base64,(.*)$/);
    let mimeType = "image/png";
    let b64Data = imageBase64;
    if (mimeMatch) {
      mimeType = mimeMatch[1];
      b64Data = mimeMatch[2];
    }

    // Size check: max 1MB
    const buf = Buffer.from(b64Data, "base64");
    if (buf.length > 1_048_576) {
      return res.status(413).json({ success: false, error: "Cover image exceeds 1MB limit" });
    }

    const ext = mimeType === "image/jpeg" ? "jpg" : "png";
    const coverSource = req.body.coverSource === "snapshot" ? "snapshot" : "upload";
    const capturedAt = new Date().toISOString();
    const { data: template } = await sb.from("templates").select("workspace_id").eq("id", templateId).single();
    if (!template?.workspace_id) return res.status(404).json({ success: false, error: "Template not found" });
    const path = `${template.workspace_id}/covers/${templateId}.${ext}`;

    const { error: uploadErr } = await sb.storage
      .from("design-covers")
      .upload(path, buf, { contentType: mimeType, upsert: true });

    if (uploadErr) throw uploadErr;
    // A cover saved earlier in another format would otherwise linger forever.
    await removeStalePreviewFiles("design-covers", `${template.workspace_id}/covers`, templateId, path);

    const { data: urlData } = await sb.storage.from("design-covers").createSignedUrl(path, 31_536_000);
    const coverUrl = urlData?.signedUrl || "";

    // Save URL to meta
    await sb.from("design_file_meta").upsert({
      template_id: templateId,
      workspace_id: template.workspace_id,
      cover_image_url: coverUrl,
      cover_captured_at: capturedAt,
      cover_source: coverSource,
      updated_at: capturedAt,
    }, { onConflict: "template_id" });
    const coverOwnerId = reminderUserId(req.auth);
    if (coverOwnerId) {
      await sb.from("preview_reminder_preferences")
        .delete()
        .eq("user_id", coverOwnerId)
        .eq("template_id", templateId);
    }

    res.json({ success: true, data: { cover_image_url: coverUrl, cover_captured_at: capturedAt, cover_source: coverSource } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Helpers ──

function rowToMeta(row: any) {
  return {
    id: row.id,
    templateId: row.template_id,
    workspaceId: row.workspace_id,
    brand: row.brand || "",
    brand_id: row.brand_id || null,
    campaign: row.campaign || "",
    campaign_id: row.campaign_id || null,
    category: row.category || "",
    content_kind: row.content_kind || "",
    asset_type: row.asset_type || "other",
    designer_type: row.designer_type || "other",
    is_permanent: Boolean(row.is_permanent),
    production_data: row.production_data || {},
    tags: row.tags || [],
    theme: row.theme || "",
    format: row.format || "",
    file_type: row.file_type || "",
    cover_image_url: row.cover_image_url || "",
    cover_captured_at: row.cover_captured_at || null,
    cover_source: row.cover_source || null,
    obsidian_link: row.obsidian_link || "",
    notes_md: row.notes_md || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
