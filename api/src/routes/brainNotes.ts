/**
 * Brain Notes API — the Second Brain read/write surface for humans.
 *
 *  GET  /api/brain-notes/entity   → one living note (lazy-generates on read)
 *  PUT  /api/brain-notes/:slug/human → replaces ONLY the human zone
 *  POST /api/brain-notes/backfill    → emits the whole vault for a workspace
 *
 * Regeneration rule (harness/BRAIN_NOTES_SPEC.md): the generated zone is
 * always rebuilt from source tables; human/agent blocks survive verbatim.
 * Every read of a missing note creates it — the vault fills itself the first
 * time someone looks, and the backfill covers everything up front.
 */

import type { Request, Response } from "express";
import {
  archivoNoteSlug, archivosNoteSlug,
  brandNoteSlug, copywritingNoteSlug, crmNoteSlug, dsNoteSlug,
  emitArchivoNoteForTemplate, emitArchivosNote, emitBrandVault, emitCopywritingNote, emitCrmNote,
  emitDsNote, emitEstrategiaNote, emitMarcaNote, emitPersonaNote,
  emitPlantillasVaultNote, estrategiaNoteSlug,
  getBrainNote, getNoteBacklinks, listBrainNotes, loadBrandVaultInputs,
  personaNoteSlug, plantillasNoteSlug, setHumanSection,
} from "../services/brainNotes.js";
import { getSupabaseAdmin } from "../services/supabase.js";
import { canAccessWorkspace } from "../services/tenancy.js";

type EntityQuery = {
  workspaceId: string;
  kind: "marca" | "ds" | "plantillas" | "archivos" | "estrategia" | "copywriting" | "crm" | "persona" | "archivo";
  brandId: string;
  templateId: string;
  personaIndex: number;
};

function parseEntityQuery(req: Request): EntityQuery | { error: string } {
  const workspaceId = String(req.query.workspaceId || "").trim();
  const kind = String(req.query.kind || "").trim() as EntityQuery["kind"];
  const brandId = String(req.query.brandId || "").trim();
  const templateId = String(req.query.templateId || "").trim();
  const personaIndex = Number(req.query.personaIndex ?? 0);
  if (!workspaceId) return { error: "workspaceId is required" };
  if (!["marca", "ds", "plantillas", "archivos", "estrategia", "copywriting", "crm", "persona", "archivo"].includes(kind)) {
    return { error: "kind must be one of marca|ds|plantillas|archivos|estrategia|copywriting|crm|persona|archivo" };
  }
  if (kind === "archivo") {
    if (!templateId) return { error: "templateId is required for kind=archivo" };
  } else if (!brandId) {
    // No UUID check: CRM brands are born `brand_<hex>` (saas.ts), not uuids.
    // The brand lookup below is the real validation (404 when absent).
    return { error: "brandId is required for this kind" };
  }
  if (kind === "persona" && !Number.isInteger(personaIndex)) return { error: "personaIndex must be an integer" };
  return { workspaceId, kind, brandId, templateId, personaIndex };
}

/** Regenerate just this kind from source tables and return the fresh note. */
async function regenerateEntity(query: EntityQuery): Promise<void> {
  const { workspaceId, kind } = query;
  if (kind === "archivo") {
    await emitArchivoNoteForTemplate(query.templateId);
    return;
  }
  const inputs = await loadBrandVaultInputs(workspaceId, query.brandId);
  if (!inputs) return;
  if (kind === "marca") await emitMarcaNote(inputs);
  else if (kind === "crm") await emitCrmNote(inputs);
  else if (kind === "ds") await emitDsNote(inputs);
  else if (kind === "plantillas") await emitPlantillasVaultNote(inputs);
  else if (kind === "archivos") await emitArchivosNote(inputs);
  else if (kind === "estrategia") await emitEstrategiaNote(inputs);
  else if (kind === "copywriting") await emitCopywritingNote(inputs);
  else if (kind === "persona") {
    let persona: { name?: string; description?: string } | undefined;
    try {
      const doc = JSON.parse(inputs.style?.strategyJson || "null");
      persona = doc?.audience?.personas?.[query.personaIndex];
    } catch { /* strategy ausente */ }
    await emitPersonaNote(inputs, query.personaIndex, persona || {});
  }
}

function noteSlugFor(query: EntityQuery, brandName: string | null): string {
  const { kind } = query;
  if (kind === "archivo") return archivoNoteSlug(query.templateId);
  const name = brandName || "";
  if (kind === "marca") return brandNoteSlug(name);
  if (kind === "ds") return dsNoteSlug(name);
  if (kind === "plantillas") return plantillasNoteSlug(name);
  if (kind === "archivos") return archivosNoteSlug(name);
  if (kind === "estrategia") return estrategiaNoteSlug(name);
  if (kind === "copywriting") return copywritingNoteSlug(name);
  if (kind === "crm") return crmNoteSlug(name);
  return personaNoteSlug(name, query.personaIndex);
}

export async function getEntityBrainNote(req: Request, res: Response): Promise<void> {
  try {
    if (!req.auth) {
      res.status(401).json({ success: false, error: "Authentication required" });
      return;
    }
    const query = parseEntityQuery(req);
    if ("error" in query) {
      res.status(400).json({ success: false, error: query.error });
      return;
    }
    if (!(await canAccessWorkspace(req.auth, query.workspaceId, "viewer"))) {
      res.status(403).json({ success: false, error: "You do not have access to this workspace" });
      return;
    }

    // Brand name for slug resolution (archivo kind doesn't need it).
    let brandName: string | null = null;
    if (query.kind !== "archivo") {
      const sb = getSupabaseAdmin();
      const { data: brand } = await sb
        ?.from("brands").select("name").eq("id", query.brandId).maybeSingle() ?? { data: null };
      brandName = brand?.name || null;
      if (!brandName) {
        res.status(404).json({ success: false, error: "Brand not found" });
        return;
      }
    }

    // Lazy vault: reading regenerates from source tables first, so the note is
    // never stale and a first click creates it. Emitters are idempotent and
    // write via the service client; human/agent blocks always survive.
    await regenerateEntity(query);

    const slug = noteSlugFor(query, brandName);
    const [note, backlinks] = await Promise.all([
      getBrainNote(query.workspaceId, slug),
      getNoteBacklinks(query.workspaceId, slug),
    ]);
    res.json({ success: true, data: { note, backlinks, slug } });
  } catch (cause: unknown) {
    console.error("[brain-notes] entity error:", cause instanceof Error ? cause.message : cause);
    res.status(500).json({ success: false, error: cause instanceof Error ? cause.message : "Failed to load brain note" });
  }
}

export async function putBrainNoteHuman(req: Request, res: Response): Promise<void> {
  try {
    if (!req.auth) {
      res.status(401).json({ success: false, error: "Authentication required" });
      return;
    }
    const slug = String(req.params.slug || "").trim();
    const workspaceId = String(req.body?.workspaceId || "").trim();
    const humanMd = typeof req.body?.humanMd === "string" ? req.body.humanMd.slice(0, 100_000) : "";
    if (!slug || !workspaceId) {
      res.status(400).json({ success: false, error: "slug and workspaceId are required" });
      return;
    }
    if (!(await canAccessWorkspace(req.auth, workspaceId, "editor"))) {
      res.status(403).json({ success: false, error: "Editor role required" });
      return;
    }
    const note = await setHumanSection(workspaceId, slug, humanMd);
    if (!note) {
      res.status(404).json({ success: false, error: "Note not found — open it once to generate it first" });
      return;
    }
    res.json({ success: true, data: { note } });
  } catch (cause: unknown) {
    console.error("[brain-notes] human error:", cause instanceof Error ? cause.message : cause);
    res.status(500).json({ success: false, error: cause instanceof Error ? cause.message : "Failed to save human notes" });
  }
}

export async function postBrainNotesBackfill(req: Request, res: Response): Promise<void> {
  try {
    if (!req.auth) {
      res.status(401).json({ success: false, error: "Authentication required" });
      return;
    }
    const workspaceId = String(req.body?.workspaceId || "").trim();
    if (!workspaceId) {
      res.status(400).json({ success: false, error: "workspaceId is required" });
      return;
    }
    if (!(await canAccessWorkspace(req.auth, workspaceId, "editor"))) {
      res.status(403).json({ success: false, error: "Editor role required" });
      return;
    }
    const sb = getSupabaseAdmin();
    if (!sb) {
      res.status(503).json({ success: false, error: "Supabase is not configured" });
      return;
    }
    const { data: brandRows } = await sb.from("brands")
      .select("id").eq("workspace_id", workspaceId).order("name").limit(200);
    let brands = 0;
    let notes = 0;
    for (const row of brandRows || []) {
      const result = await emitBrandVault(workspaceId, row.id);
      if (result) { brands += 1; notes += result.notes; }
    }
    // Archivo notes for every filed design (name join for the title).
    const { data: metaRows } = await sb.from("design_file_meta")
      .select("template_id").eq("workspace_id", workspaceId).limit(500);
    let archivos = 0;
    for (const row of metaRows || []) {
      const note = await emitArchivoNoteForTemplate(row.template_id);
      if (note) archivos += 1;
    }
    res.json({ success: true, data: { brands, notes, archivos } });
  } catch (cause: unknown) {
    console.error("[brain-notes] backfill error:", cause instanceof Error ? cause.message : cause);
    res.status(500).json({ success: false, error: cause instanceof Error ? cause.message : "Backfill failed" });
  }
}

/**
 * GET /api/brain-notes/list?workspaceId=&limit=&offset=&entityType=
 * Lista plana de notas del workspace (REQ-070 F5: mata el N+1 de la vista
 * inicio/cerebro del shell-v2 — una llamada reemplaza N lecturas por entidad).
 */
export async function getListBrainNotes(req: Request, res: Response): Promise<void> {
  try {
    if (!req.auth) {
      res.status(401).json({ success: false, error: "Authentication required" });
      return;
    }
    const workspaceId = String(req.query.workspaceId || "").trim();
    if (!workspaceId) {
      res.status(400).json({ success: false, error: "workspaceId is required" });
      return;
    }
    if (!(await canAccessWorkspace(req.auth, workspaceId, "viewer"))) {
      res.status(403).json({ success: false, error: "You do not have access to this workspace" });
      return;
    }
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const entityType = String(req.query.entityType || "").trim() || undefined;
    const notes = await listBrainNotes(workspaceId, { limit, offset, entityType });
    res.json({ success: true, data: notes, total: notes.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}
