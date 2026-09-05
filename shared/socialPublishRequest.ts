/** Only this signed endpoint may bypass session/API-key authentication. */
export function isZernioWebhookRequest(method: string, path: string): boolean {
  return method === "POST" && /^\/api\/content\/webhooks\/zernio\/[A-Za-z0-9_-]+$/.test(path);
}

export function publicSocialMediaUrl(value: string): string {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || host === "localhost" || host.endsWith(".localhost") || !host.includes(".") || host.includes(":") || /^(?:127|10|0|169\.254|192\.168|172\.(?:1[6-9]|2\d|3[01]))\./.test(host)) {
    throw new Error("La publicación necesita una URL HTTPS pública de imagen o video");
  }
  return url.href;
}

export function socialMediaType(url: string, contentType: string): "image" | "video" {
  const video = /\.(?:mp4|mov)$/i.test(new URL(url).pathname);
  if (contentType === "reel" && !video) throw new Error("El Reel necesita una URL pública de video MP4 o MOV");
  return video ? "video" : "image";
}

interface MediaRow {
  id: string;
  workspace_id: string;
  template_id?: string | null;
  frame_id?: string | null;
  external_url?: string | null;
}
interface DesignFrame { id?: string; html?: string; css?: string; width?: number; height?: number; background?: string }
interface DesignTemplate extends DesignFrame { workspaceId?: string; frames?: DesignFrame[] }

/** The browser supplies the existing rasterizer; tests supply an inert renderer. */
export async function prepareSocialMedia(row: MediaRow, explicitUrl: string, contentType: string, deps: {
  loadTemplate: (id: string) => Promise<DesignTemplate>;
  render: (source: { html: string; css: string; width: number; height: number; background: string }) => Promise<string>;
  upload: (data: string) => Promise<string>;
}): Promise<string | undefined> {
  const checkedMedia = (value: string) => {
    const url = publicSocialMediaUrl(value);
    socialMediaType(url, contentType);
    return url;
  };
  if (explicitUrl.trim()) return checkedMedia(explicitUrl.trim());
  if (!row.template_id && !row.frame_id) return row.external_url ? checkedMedia(row.external_url) : undefined;
  if (contentType === "reel") {
    if (row.external_url) return checkedMedia(row.external_url);
    throw new Error("Un Reel necesita un video exportado; no se puede enviar el diseño como imagen");
  }
  if (!row.template_id) throw new Error("El diseño no tiene archivo vinculado");
  const template = await deps.loadTemplate(row.template_id);
  if (template.workspaceId !== row.workspace_id) throw new Error("El diseño no pertenece a este workspace");
  const frames = template.frames || [];
  const frame = row.frame_id ? frames.find(item => item.id === row.frame_id) : frames.length === 1 ? frames[0] : frames.length === 0 ? template : null;
  if (!frame) throw new Error("Selecciona un diseño específico del archivo antes de publicar");
  const html = frame.html ?? template.html ?? "";
  if (!html.trim()) throw new Error("El diseño está vacío y no se puede publicar");
  const data = await deps.render({ html, css: frame.css ?? template.css ?? "", width: Number(frame.width) || 1080, height: Number(frame.height) || 1080, background: frame.background || "#ffffff" });
  return publicSocialMediaUrl(await deps.upload(data));
}
