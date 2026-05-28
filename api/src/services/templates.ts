import { store } from "./store.js";
import { getSupabase } from "./supabase.js";
import { v4 as uuid } from "uuid";
import type { DesignTemplate, FabricCanvas, LayerOverride } from "../types.js";

type SupabaseTplRow = {
  id: string;
  name: string;
  workspace_id: string;
  data: DesignTemplate;
  user_id: string;
  created_at: string;
  updated_at: string;
};

function rowToTemplate(row: SupabaseTplRow): DesignTemplate {
  return {
    ...row.data,
    id: row.id,
    name: row.name,
    workspaceId: row.workspace_id,
    metadata: {
      ...row.data.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  };
}

async function listFromSupabase(
  limit: number, offset: number, workspaceId?: string, search?: string
): Promise<{ data: DesignTemplate[]; total: number } | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    let q = sb.from("templates").select("*", { count: "exact" });
    if (workspaceId) q = q.eq("workspace_id", workspaceId);
    q = q.order("updated_at", { ascending: false }).range(offset, offset + limit - 1);
    const { data, count, error } = await q;
    if (error) throw error;
    let items = (data || []).map((r: any) => rowToTemplate(r));
    if (search) {
      items = items.filter(t => t.name.toLowerCase().includes(search));
    }
    return { data: items, total: count || items.length };
  } catch (e) {
    console.warn("[templates] Supabase list failed:", (e as Error).message);
    return null;
  }
}

async function getFromSupabase(id: string): Promise<DesignTemplate | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data, error } = await sb.from("templates").select("*").eq("id", id).single();
    if (error || !data) return null;
    return rowToTemplate(data as any);
  } catch {
    return null;
  }
}

async function upsertSupabase(tpl: DesignTemplate, userId: string) {
  const sb = getSupabase();
  if (!sb) return;
  try {
    await sb.from("templates").upsert({
      id: tpl.id,
      name: tpl.name,
      workspace_id: tpl.workspaceId || null,
      data: tpl,
      user_id: userId,
      updated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn("[templates] Supabase upsert failed:", (e as Error).message);
  }
}

async function deleteFromSupabase(id: string) {
  const sb = getSupabase();
  if (!sb) return;
  try {
    await sb.from("templates").delete().eq("id", id);
  } catch (e) {
    console.warn("[templates] Supabase delete failed:", (e as Error).message);
  }
}

export async function createTemplate(
  name: string, width: number, height: number,
  canvas: FabricCanvas | undefined, userId: string, workspaceId: string
): Promise<DesignTemplate> {
  const tpl = store.createTemplate({ workspaceId, name, width, height, canvas, userId });
  await upsertSupabase(tpl, userId);
  return tpl;
}

export async function getTemplate(id: string): Promise<DesignTemplate | null> {
  const fromSb = await getFromSupabase(id);
  if (fromSb) {
    store.updateTemplate(id, fromSb);
    return fromSb;
  }
  return store.getTemplate(id) || null;
}

export async function listTemplatesPaginated(
  limit: number, offset: number, workspaceId?: string, search?: string
): Promise<{ data: DesignTemplate[]; total: number }> {
  const fromSb = await listFromSupabase(limit, offset, workspaceId, search);
  if (fromSb) return fromSb;

  let { data, total } = store.listTemplates(workspaceId, 99999, 0);
  if (search) {
    data = data.filter(t => t.name.toLowerCase().includes(search));
    total = data.length;
  }
  data = data.slice(offset, offset + limit);
  return { data, total };
}

export async function updateTemplate(
  id: string, updates: Partial<DesignTemplate> & Record<string, any>
): Promise<DesignTemplate | null> {
  const tpl = store.updateTemplate(id, updates);
  if (tpl) {
    await upsertSupabase(tpl, updates.userId || (tpl as any).metadata?.createdBy || "dev_user_default");
  }
  return tpl || null;
}

export async function deleteTemplate(id: string): Promise<boolean> {
  await deleteFromSupabase(id);
  return store.deleteTemplate(id);
}

export async function duplicateTemplate(
  id: string, newName?: string, userId?: string
): Promise<DesignTemplate | null> {
  const source = await getTemplate(id);
  if (!source) return null;

  const uid = userId || "dev_user_default";
  const copy = store.createTemplate({
    workspaceId: source.workspaceId,
    name: newName || `${source.name} (copy)`,
    width: source.width,
    height: source.height,
    canvas: JSON.parse(JSON.stringify(source.canvas)),
    userId: uid,
  });

  copy.frames = source.frames.map(f => ({
    ...JSON.parse(JSON.stringify(f)),
    id: `frame_${uuid().slice(0, 12)}`,
    templateId: copy.id,
  }));

  store.updateTemplate(copy.id, copy);
  await upsertSupabase(copy, uid);
  return copy;
}

export async function applyLayerOverrides(
  templateId: string, overrides: Record<string, LayerOverride>
): Promise<DesignTemplate | null> {
  const tpl = store.getTemplate(templateId);
  if (!tpl) return null;

  const applyToObjects = (objs: any[]) => {
    for (const obj of objs) {
      const name = obj.layerName || obj.name;
      if (name && overrides[name]) {
        Object.assign(obj, overrides[name]);
      }
      if (obj.objects && Array.isArray(obj.objects)) {
        applyToObjects(obj.objects);
      }
    }
  };

  applyToObjects(tpl.canvas.objects);
  for (const frame of tpl.frames) {
    applyToObjects(frame.objects);
  }

  tpl.metadata.updatedAt = new Date().toISOString();
  return tpl;
}
