import { store } from "./store.js";
import { v4 as uuid } from "uuid";
import type { DesignTemplate, FabricCanvas, LayerOverride } from "../types.js";

export async function createTemplate(
  name: string, width: number, height: number,
  canvas: FabricCanvas | undefined, userId: string, workspaceId: string
): Promise<DesignTemplate> {
  return store.createTemplate({ workspaceId, name, width, height, canvas, userId });
}

export async function getTemplate(id: string): Promise<DesignTemplate | null> {
  return store.getTemplate(id) || null;
}

export async function listTemplatesPaginated(
  limit: number, offset: number, workspaceId?: string, search?: string
): Promise<{ data: DesignTemplate[]; total: number }> {
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
  return store.updateTemplate(id, updates) || null;
}

export async function deleteTemplate(id: string): Promise<boolean> {
  return store.deleteTemplate(id);
}

export async function duplicateTemplate(
  id: string, newName?: string, userId?: string
): Promise<DesignTemplate | null> {
  const source = store.getTemplate(id);
  if (!source) return null;

  const copy = store.createTemplate({
    workspaceId: source.workspaceId,
    name: newName || `${source.name} (copy)`,
    width: source.width,
    height: source.height,
    canvas: JSON.parse(JSON.stringify(source.canvas)),
    userId: userId || "dev_user_default",
  });

  copy.frames = source.frames.map(f => ({
    ...JSON.parse(JSON.stringify(f)),
    id: `frame_${uuid().slice(0, 12)}`,
    templateId: copy.id,
  }));

  store.updateTemplate(copy.id, copy);
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
