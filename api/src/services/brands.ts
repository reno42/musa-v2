import { v4 as uuid } from "uuid";
import type { BrandGuideline, DesignTemplate } from "../types.js";
import { getSupabase } from "./supabase.js";
import { getTemplate, createTemplate, updateTemplate, deleteTemplate, restoreTemplate } from "./templates.js";

// In-memory fallback for local development without Supabase.
const memoryStore = new Map<string, BrandGuideline>();

type SupabaseBrandRow = {
  id: string;
  workspace_id: string;
  name: string;
  data: BrandGuideline;
  created_at: string;
  updated_at: string;
};

export type BrandInput = {
  workspaceId: string;
  name: string;
  description?: string;
  tokensJson?: string;
  designMd?: string;
  sharedCss?: string;
  sourceHash?: string;
  styleFingerprint?: string;
  sourceTemplateIds?: string[];
};

export type TemplateResolver = (id: string) => Promise<DesignTemplate | null>;

export class StyleInvariantError extends Error {
  readonly code = "STYLE_INVALID";
}

export class StyleNameConflictError extends Error {
  readonly code = "STYLE_NAME_EXISTS";
}

export function cleanStyleName(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

export function styleNameIdentity(value: unknown): string {
  return cleanStyleName(value).toLowerCase();
}

export function normalizeSourceTemplateIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((id): id is string => typeof id === "string")
    .map(id => id.trim())
    .filter(Boolean))];
}

function stripBlockComments(value: string): string {
  return value.replace(/\/\*[\s\S]*?\*\//g, "");
}

function jsonValueIsSubstantive(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (typeof value === "string") return /[\p{L}\p{N}]/u.test(stripBlockComments(value));
  if (Array.isArray(value)) return value.some(jsonValueIsSubstantive);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).some(jsonValueIsSubstantive);
  return false;
}

export function tokensJsonHasSubstantiveValue(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    return jsonValueIsSubstantive(JSON.parse(value));
  } catch {
    return false;
  }
}

export function designMdHasSubstantiveContent(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const plainText = stripBlockComments(value)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[`*_~#>\[\](){}|:;.,!?'"/\\-]/g, " ");
  return /[\p{L}\p{N}]/u.test(plainText);
}

export function cssHasRealDeclaration(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const css = stripBlockComments(value);
  const declaration = /(?:^|[;{]\s*)((?:--[a-zA-Z_][\w-]*)|(?:[a-zA-Z][\w-]*))\s*:\s*([^;{}]+)/g;
  let match: RegExpExecArray | null;
  while ((match = declaration.exec(css)) !== null) {
    if (/[\p{L}\p{N}]/u.test(match[2])) return true;
  }
  return false;
}

export function htmlHasStyleMaterial(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const html = value
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  if (/<\s*(?:img|video|audio|svg|canvas|picture|iframe)\b/i.test(html)) return true;
  for (const styleMatch of html.matchAll(/\bstyle\s*=\s*["']([^"']*)["']/gi)) {
    if (cssHasRealDeclaration(styleMatch[1])) return true;
  }
  const visibleText = html.replace(/<[^>]*>/g, " ").replace(/&(?:#\d+|#x[\da-f]+|[a-z]+);/gi, " ");
  return /[\p{L}\p{N}]/u.test(visibleText);
}

export function hasSubstantiveStyleArtifacts(value: Partial<BrandGuideline>): boolean {
  return tokensJsonHasSubstantiveValue(value.tokensJson)
    || designMdHasSubstantiveContent(value.designMd)
    || cssHasRealDeclaration(value.sharedCss);
}

function objectArrayHasItems(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

export function templateHasStyleMaterial(template: DesignTemplate | null | undefined): boolean {
  if (!template) return false;
  const root = template as DesignTemplate & { html?: string; css?: string; canvasObjects?: unknown[] };
  if (htmlHasStyleMaterial(root.html) || cssHasRealDeclaration(root.css) || objectArrayHasItems(root.canvasObjects)) return true;
  if (root.canvas && objectArrayHasItems((root.canvas as any).objects)) return true;
  return (root.frames || []).some(frame => {
    const candidate = frame as typeof frame & { html?: string; css?: string; objects?: unknown[]; canvasObjects?: unknown[] };
    return htmlHasStyleMaterial(candidate.html)
      || cssHasRealDeclaration(candidate.css)
      || objectArrayHasItems(candidate.objects)
      || objectArrayHasItems(candidate.canvasObjects);
  });
}

export async function validateBrandState(
  value: Partial<BrandGuideline>,
  resolveTemplate: TemplateResolver = getTemplate,
  opts?: { allowEmptySources?: boolean },
): Promise<BrandGuideline> {
  const workspaceId = typeof value.workspaceId === "string" ? value.workspaceId.trim() : "";
  const name = cleanStyleName(value.name);
  const sourceTemplateIds = normalizeSourceTemplateIds(value.sourceTemplateIds);

  if (!workspaceId) throw new StyleInvariantError("workspaceId is required for a style");
  if (!name) throw new StyleInvariantError("Style name is required");
  if (name.length > 100) throw new StyleInvariantError("Style name must be 100 characters or fewer");

  // Allow brand creation without source templates (Design System file created empty).
  // Style extraction flow still validates sources.
  if (!opts?.allowEmptySources && sourceTemplateIds.length === 0) {
    throw new StyleInvariantError("A style must reference at least one source template");
  }
  if (!opts?.allowEmptySources && !hasSubstantiveStyleArtifacts(value)) {
    throw new StyleInvariantError("A style must include substantive tokensJson, designMd, or sharedCss");
  }

  for (const templateId of sourceTemplateIds) {
    const template = await resolveTemplate(templateId);
    if (!template) throw new StyleInvariantError(`Source template not found: ${templateId}`);
    if (template.workspaceId !== workspaceId) {
      throw new StyleInvariantError(`Source template ${templateId} belongs to another workspace`);
    }
    if (!templateHasStyleMaterial(template)) {
      throw new StyleInvariantError(`Source template ${templateId} has no usable design material`);
    }
  }

  const now = new Date().toISOString();
  return {
    id: value.id || "",
    workspaceId,
    name,
    description: value.description,
    tokensJson: value.tokensJson,
    designMd: value.designMd,
    sharedCss: value.sharedCss,
    sourceHash: value.sourceHash,
    styleFingerprint: value.styleFingerprint,
    sourceTemplateIds,
    designSystemTemplateId: value.designSystemTemplateId,
    createdAt: value.createdAt || now,
    updatedAt: now,
  };
}

function rowToBrand(row: SupabaseBrandRow): BrandGuideline {
  const data = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
  const r = row as any;
  return {
    ...data,
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    designSystemTemplateId: r.design_system_template_id || data?.designSystemTemplateId || null,
    deletedAt: r.deleted_at || data?.deletedAt || null,
  };
}

function brandRow(brand: BrandGuideline) {
  return {
    id: brand.id,
    workspace_id: brand.workspaceId,
    name: brand.name,
    data: brand,
    updated_at: brand.updatedAt,
  };
}

function isUniqueViolation(error: any): boolean {
  return error?.code === "23505" || /unique|duplicate/i.test(String(error?.message || ""));
}

function persistenceError(action: string, error: any): Error {
  if (isUniqueViolation(error)) {
    return new StyleNameConflictError("A style with this name already exists in the workspace");
  }
  return new Error(`Failed to ${action} style in Supabase: ${error?.message || "unknown database error"}`);
}

async function assertNameAvailable(workspaceId: string, name: string, exceptId?: string): Promise<void> {
  const identity = styleNameIdentity(name);
  const existing = await listBrandsByWorkspace(workspaceId);
  if (existing.some(brand => brand.id !== exceptId && styleNameIdentity(brand.name) === identity)) {
    throw new StyleNameConflictError(`A style named "${cleanStyleName(name)}" already exists in this workspace`);
  }
}

export async function createBrand(params: BrandInput, userId?: string): Promise<BrandGuideline> {
  const now = new Date().toISOString();
  const candidate = await validateBrandState({
    ...params,
    id: `brand_${uuid().slice(0, 12)}`,
    sourceTemplateIds: params.sourceTemplateIds || [],
    createdAt: now,
    updatedAt: now,
  }, undefined, { allowEmptySources: true });
  await assertNameAvailable(candidate.workspaceId, candidate.name);

  // Auto-create the Design System template for this brand.
  let dsTemplateId: string | undefined;
  try {
    const dsTpl = await createTemplate(
      `${candidate.name}_DesignSystem`,
      1920, 1080,
      undefined,
      userId || "system",
      candidate.workspaceId,
    );
    dsTemplateId = dsTpl.id;
    // Mark as brand manual so comments default to documentation type
    await updateTemplate(dsTpl.id, { isBrandManual: true } as any);
  } catch (e) {
    console.warn("[brands] Failed to auto-create Design System template:", (e as Error).message);
    // Don't fail the brand creation — the user can link it later.
  }

  if (dsTemplateId) {
    candidate.designSystemTemplateId = dsTemplateId;
  }

  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from("brand_guidelines")
      .insert(brandRow(candidate))
      .select("*")
      .single();
    if (error || !data) throw persistenceError("create", error);
    const saved = rowToBrand(data as SupabaseBrandRow);
    memoryStore.set(saved.id, saved);
    return saved;
  }

  memoryStore.set(candidate.id, candidate);
  return candidate;
}

export async function getBrand(id: string): Promise<BrandGuideline | null> {
  const brandId = typeof id === "string" ? id.trim() : "";
  if (!brandId) return null;
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from("brand_guidelines").select("*").eq("id", brandId).maybeSingle();
    if (error) throw persistenceError("read", error);
    if (!data) return null;
    const brand = rowToBrand(data as SupabaseBrandRow);
    memoryStore.set(brandId, brand);
    return brand;
  }
  return memoryStore.get(brandId) || null;
}

export async function listBrandsByWorkspace(workspaceId: string): Promise<BrandGuideline[]> {
  const cleanWorkspaceId = typeof workspaceId === "string" ? workspaceId.trim() : "";
  if (!cleanWorkspaceId) throw new StyleInvariantError("workspaceId is required to list styles");
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from("brand_guidelines")
      .select("*")
      .eq("workspace_id", cleanWorkspaceId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false });
    if (error) throw persistenceError("list", error);
    const brands = (data || []).map(row => rowToBrand(row as SupabaseBrandRow));
    for (const brand of brands) memoryStore.set(brand.id, brand);
    return brands;
  }
  return [...memoryStore.values()]
    .filter(brand => brand.workspaceId === cleanWorkspaceId && !brand.deletedAt)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function findBrandByName(workspaceId: string, name: string): Promise<BrandGuideline | null> {
  const identity = styleNameIdentity(name);
  if (!identity) return null;
  const brands = await listBrandsByWorkspace(workspaceId);
  return brands.find(brand => styleNameIdentity(brand.name) === identity) || null;
}

export async function updateBrand(
  id: string,
  updates: Partial<BrandGuideline>,
): Promise<BrandGuideline | null> {
  const current = await getBrand(id);
  if (!current) return null;
  if (updates.workspaceId !== undefined && updates.workspaceId !== current.workspaceId) {
    throw new StyleInvariantError("A style cannot be moved to another workspace");
  }

  const candidate = await validateBrandState({
    ...current,
    ...updates,
    id: current.id,
    workspaceId: current.workspaceId,
    createdAt: current.createdAt,
  });
  await assertNameAvailable(candidate.workspaceId, candidate.name, candidate.id);

  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from("brand_guidelines")
      .update({ name: candidate.name, data: candidate, updated_at: candidate.updatedAt })
      .eq("id", candidate.id)
      .eq("workspace_id", candidate.workspaceId)
      .select("*")
      .maybeSingle();
    if (error) throw persistenceError("update", error);
    if (!data) return null;
    const saved = rowToBrand(data as SupabaseBrandRow);
    memoryStore.set(saved.id, saved);
    return saved;
  }

  memoryStore.set(candidate.id, candidate);
  return candidate;
}

export async function deleteBrand(id: string, opts?: { cascadeDs?: boolean }): Promise<boolean> {
  const current = await getBrand(id);
  if (!current) return false;

  const sb = getSupabase();
  if (sb) {
    // Soft-delete the brand itself (set deleted_at, don't hard-delete)
    const now = new Date().toISOString();
    const { data, error } = await sb.from("brand_guidelines")
      .update({ deleted_at: now, updated_at: now })
      .eq("id", current.id)
      .eq("workspace_id", current.workspaceId)
      .select("id");
    if (error) throw persistenceError("delete", error);
    if (!data || data.length === 0) return false;

    // Cascade: soft-delete the Design System template if requested
    if (opts?.cascadeDs && current.designSystemTemplateId) {
      try {
        await deleteTemplate(current.designSystemTemplateId);
      } catch (e) {
        console.warn("[brands] Failed to cascade-delete DS template:", (e as Error).message);
      }
    }
  }

  // Update in-memory
  const cached = memoryStore.get(current.id);
  if (cached) {
    cached.deletedAt = new Date().toISOString();
    memoryStore.set(cached.id, cached);
  }
  return true;
}

/** Restore a soft-deleted brand and optionally its Design System template. */
export async function restoreBrand(id: string): Promise<boolean> {
  const sb = getSupabase();
  if (sb) {
    // Fetch even deleted brands to get the DS template ID
    const { data: row, error: readErr } = await sb.from("brand_guidelines")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (readErr || !row) return false;

    const now = new Date().toISOString();
    const { data, error } = await sb.from("brand_guidelines")
      .update({ deleted_at: null, updated_at: now })
      .eq("id", id)
      .select("id");
    if (error) throw persistenceError("restore", error);
    if (!data || data.length === 0) return false;

    // Also restore the DS template if it was soft-deleted
    const brand = rowToBrand(row as SupabaseBrandRow);
    if (brand.designSystemTemplateId) {
      try {
        await restoreTemplate(brand.designSystemTemplateId);
      } catch (e) {
        console.warn("[brands] Failed to restore DS template:", (e as Error).message);
      }
    }
  }

  const cached = memoryStore.get(id);
  if (cached) {
    cached.deletedAt = undefined;
    memoryStore.set(cached.id, cached);
  }
  return true;
}

/** List soft-deleted brands for the trash view. */
export async function listDeletedBrands(workspaceId: string): Promise<BrandGuideline[]> {
  const cleanWorkspaceId = typeof workspaceId === "string" ? workspaceId.trim() : "";
  if (!cleanWorkspaceId) throw new StyleInvariantError("workspaceId is required to list deleted styles");
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from("brand_guidelines")
      .select("*")
      .eq("workspace_id", cleanWorkspaceId)
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });
    if (error) throw persistenceError("list-deleted", error);
    return (data || []).map(row => rowToBrand(row as SupabaseBrandRow));
  }
  return [...memoryStore.values()]
    .filter(brand => brand.workspaceId === cleanWorkspaceId && brand.deletedAt)
    .sort((a, b) => new Date(b.deletedAt || "").getTime() - new Date(a.deletedAt || "").getTime());
}
