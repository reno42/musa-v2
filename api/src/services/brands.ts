import { getSupabase } from "./supabase.js";
import { v4 as uuid } from "uuid";
import type { BrandGuideline } from "../types.js";

// ── In-memory fallback ──
const memoryStore = new Map<string, BrandGuideline>();

type SupabaseBrandRow = {
  id: string;
  workspace_id: string;
  name: string;
  data: BrandGuideline;
  created_at: string;
  updated_at: string;
};

function rowToBrand(row: SupabaseBrandRow): BrandGuideline {
  const data = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
  return {
    ...data,
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function upsertSupabase(brand: BrandGuideline): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const row: Record<string, any> = {
      id: brand.id,
      workspace_id: brand.workspaceId,
      name: brand.name,
      data: brand,
      updated_at: new Date().toISOString(),
    };
    const { error } = await sb.from("brand_guidelines").upsert(row);
    if (error) {
      console.warn("[brands] Supabase upsert failed:", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[brands] Supabase upsert failed:", (e as Error).message);
    return false;
  }
}

// ── Public API ──

export async function createBrand(params: {
  workspaceId: string;
  name: string;
  description?: string;
  tokensJson?: string;
  designMd?: string;
  sharedCss?: string;
  sourceHash?: string;
  sourceTemplateIds?: string[];
}): Promise<BrandGuideline> {
  const now = new Date().toISOString();
  const brand: BrandGuideline = {
    id: `brand_${uuid().slice(0, 12)}`,
    workspaceId: params.workspaceId,
    name: params.name,
    description: params.description,
    tokensJson: params.tokensJson,
    designMd: params.designMd,
    sharedCss: params.sharedCss,
    sourceHash: params.sourceHash,
    sourceTemplateIds: params.sourceTemplateIds,
    createdAt: now,
    updatedAt: now,
  };
  memoryStore.set(brand.id, brand);
  await upsertSupabase(brand);
  return brand;
}

export async function getBrand(id: string): Promise<BrandGuideline | null> {
  // Try Supabase first
  const sb = getSupabase();
  if (sb) {
    try {
      const { data, error } = await sb.from("brand_guidelines").select("*").eq("id", id).single();
      if (!error && data) {
        const brand = rowToBrand(data as any);
        memoryStore.set(id, brand);
        return brand;
      }
    } catch { /* fall through */ }
  }
  return memoryStore.get(id) || null;
}

export async function listBrandsByWorkspace(workspaceId: string): Promise<BrandGuideline[]> {
  const sb = getSupabase();
  if (sb) {
    try {
      const { data, error } = await sb.from("brand_guidelines")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("updated_at", { ascending: false });
      if (!error && data) {
        const brands = (data as any[]).map(rowToBrand);
        for (const b of brands) memoryStore.set(b.id, b);
        return brands;
      }
    } catch { /* fall through */ }
  }
  // Fallback: filter from memory
  return [...memoryStore.values()]
    .filter(b => b.workspaceId === workspaceId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function updateBrand(
  id: string,
  updates: Partial<BrandGuideline>
): Promise<BrandGuideline | null> {
  let brand = memoryStore.get(id);
  if (!brand) {
    // Try loading from Supabase
    const fromDb = await getBrand(id);
    if (!fromDb) return null;
    brand = fromDb;
  }
  Object.assign(brand, updates, { updatedAt: new Date().toISOString() });
  memoryStore.set(id, brand);
  await upsertSupabase(brand);
  return brand;
}

export async function deleteBrand(id: string): Promise<boolean> {
  memoryStore.delete(id);
  const sb = getSupabase();
  if (sb) {
    try {
      await sb.from("brand_guidelines").delete().eq("id", id);
    } catch { /* non-blocking */ }
  }
  return true;
}
