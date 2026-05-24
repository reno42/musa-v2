// packages/api/src/services/templates.ts
// Templates service with pagination support

import { v4 as uuid } from "uuid";
import type { DesignTemplate, Layer, LayerOverride } from "@futuraria/shared";
import { getSupabase } from "./supabase";

// In-memory fallback store
const memoryStore = new Map<string, DesignTemplate>();

function createBlankTemplate(name: string, width: number, height: number): DesignTemplate {
  return {
    id: `tpl_${uuid().slice(0, 8)}`,
    name,
    schemaVersion: 1,
    canvas: { width, height, background: "#ffffff" },
    layers: [],
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
}

export async function createTemplate(
  name: string,
  width = 1080,
  height = 1080,
  canvasJson?: any,
  userId?: string
): Promise<DesignTemplate> {
  const tpl = canvasJson
    ? {
        ...canvasJson,
        id: `tpl_${uuid().slice(0, 8)}`,
        name,
        schemaVersion: 1 as const,
        metadata: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }
    : createBlankTemplate(name, width, height);

  const db = getSupabase();
  if (db) {
    const row: any = { id: tpl.id, name: tpl.name, data: tpl };
    if (userId) row.user_id = userId;
    await db.from("templates").insert(row);
  } else {
    memoryStore.set(tpl.id, tpl);
  }

  return tpl;
}

export async function listTemplates(): Promise<DesignTemplate[]> {
  const db = getSupabase();
  if (db) {
    const { data } = await db
      .from("templates")
      .select("data")
      .order("created_at", { ascending: false });
    return (data || []).map((r: any) => r.data);
  }
  return Array.from(memoryStore.values());
}

// ── Paginated list ──
export async function listTemplatesPaginated(
  limit: number,
  offset: number
): Promise<{ data: DesignTemplate[]; total: number }> {
  const db = getSupabase();

  if (db) {
    // Get total count
    const { count } = await db
      .from("templates")
      .select("*", { count: "exact", head: true });

    // Get page
    const { data } = await db
      .from("templates")
      .select("data")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    return {
      data: (data || []).map((r: any) => r.data),
      total: count || 0,
    };
  }

  // In-memory fallback
  const all = Array.from(memoryStore.values());
  return {
    data: all.slice(offset, offset + limit),
    total: all.length,
  };
}

export async function getTemplate(id: string): Promise<DesignTemplate | null> {
  const db = getSupabase();
  if (db) {
    const { data } = await db
      .from("templates")
      .select("data")
      .eq("id", id)
      .single();
    return data?.data || null;
  }
  return memoryStore.get(id) || null;
}

export async function updateTemplate(
  id: string,
  updates: Partial<DesignTemplate>
): Promise<DesignTemplate | null> {
  const existing = await getTemplate(id);
  if (!existing) return null;

  const updated = {
    ...existing,
    ...updates,
    metadata: { ...existing.metadata, updatedAt: new Date().toISOString() },
  };

  const db = getSupabase();
  if (db) {
    await db
      .from("templates")
      .update({ data: updated, name: updated.name })
      .eq("id", id);
  } else {
    memoryStore.set(id, updated);
  }

  return updated;
}

export async function deleteTemplate(id: string): Promise<boolean> {
  const db = getSupabase();
  if (db) {
    const { error } = await db.from("templates").delete().eq("id", id);
    return !error;
  }
  return memoryStore.delete(id);
}

export async function duplicateTemplate(
  id: string,
  newName?: string,
  userId?: string
): Promise<DesignTemplate | null> {
  const original = await getTemplate(id);
  if (!original) return null;

  return createTemplate(
    newName || `${original.name} (copy)`,
    original.canvas.width,
    original.canvas.height,
    {
      ...original,
      id: undefined,
      metadata: {
        ...original.metadata,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    },
    userId
  );
}

export async function applyLayerOverrides(
  templateId: string,
  overrides: Record<string, LayerOverride>
): Promise<DesignTemplate | null> {
  const tpl = await getTemplate(templateId);
  if (!tpl) return null;

  // Build a name→object map. Prefer tpl.layers, but fall back to
  // walking canvas.objects (which is how the editor saves templates).
  const layerMap = new Map<string, any>();

  if (tpl.layers && tpl.layers.length > 0) {
    for (const l of tpl.layers) {
      layerMap.set(l.name, l);
    }
  } else if (tpl.canvas.objects && tpl.canvas.objects.length > 0) {
    // Walk canvas.objects recursively to find named layers
    const walk = (objs: any[]) => {
      for (const o of objs) {
        const name = o.layerName || o.name;
        if (name) layerMap.set(name, o);
        if (o.objects && Array.isArray(o.objects)) walk(o.objects);
      }
    };
    walk(tpl.canvas.objects);
  }

  for (const [layerName, override] of Object.entries(overrides)) {
    const layer = layerMap.get(layerName);
    if (!layer) continue;

    // Apply text overrides for text/textbox layers
    if (
      override.text !== undefined &&
      (layer.type === "text" || (layer as any).type === "textbox" || (layer as any).type === "i-text")
    ) {
      (layer as any).text = override.text;
    }
    if (
      override.fontFamily !== undefined &&
      (layer.type === "text" || (layer as any).type === "textbox" || (layer as any).type === "i-text")
    ) {
      (layer as any).fontFamily = override.fontFamily;
    }
    if (
      override.fontSize !== undefined &&
      (layer.type === "text" || (layer as any).type === "textbox" || (layer as any).type === "i-text")
    ) {
      (layer as any).fontSize = override.fontSize;
    }
    if (override.fill !== undefined && "fill" in layer) {
      (layer as any).fill = override.fill;
    }
    if (override.stroke !== undefined && "stroke" in layer) {
      (layer as any).stroke = override.stroke;
    }
    if (override.imageUrl !== undefined && layer.type === "image") {
      (layer as any).src = override.imageUrl;
    }
    if (override.visible !== undefined) {
      (layer as any).visible = override.visible;
    }
    if (override.opacity !== undefined) {
      (layer as any).opacity = override.opacity;
    }
  }

  return updateTemplate(templateId, tpl);
}
