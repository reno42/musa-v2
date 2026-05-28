import { store } from "./store.js";
import type { RenderJob, RenderOptions } from "../types.js";

export async function renderTemplate(
  templateId: string, options: RenderOptions
): Promise<RenderJob | null> {
  const tpl = store.getTemplate(templateId);
  if (!tpl) return null;

  const format = options.format || "png";
  const scale = options.scale || 2;

  const job = store.createRenderJob(templateId, format, scale);
  console.log(`[renderer] Job ${job.id} queued for template ${templateId} (${format}, ${scale}x)`);
  return job;
}
