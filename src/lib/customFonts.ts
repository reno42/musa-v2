/**
 * The user's own fonts, end to end.
 *
 * An upload (picker or MCP) lands the file in the custom-fonts bucket under
 * the owner's user id plus a row in custom_fonts. APPLYING one in the editor
 * does three things at once, because each consumer reads a different surface:
 * a FontFace in this document (properties preview), a <style> in every frame's
 * shadow root (the live canvas), and a persisted @font-face in the design css
 * (reloads, exports, MCP renders). The URL is the object's public bucket URL —
 * stable forever, so the persisted css never rots the way a signed URL would.
 */
import { getApiHeaders } from "./apiKey";
import { registerCustomFontFamily } from "./fontFamily.ts";

export interface CustomFont {
  id: string;
  familyName: string;
  fileName: string;
  format: "ttf" | "otf" | "woff" | "woff2";
  sizeBytes: number;
  publicUrl: string;
  createdAt: string;
}

export interface CustomFontUsage {
  count: number;
  bytes: number;
  limits: { maxCount: number; maxBytes: number };
  plan: string;
}

async function fontFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...options, headers: getApiHeaders() });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) throw new Error(json.error || `Request failed (${res.status})`);
  return json.data as T;
}

export async function listCustomFonts(): Promise<CustomFont[]> {
  const data = await fontFetch<{ fonts: CustomFont[] }>("/api/fonts/custom");
  for (const font of data.fonts || []) registerCustomFontFamily(font.familyName);
  return data.fonts || [];
}

export async function uploadCustomFont(file: File): Promise<CustomFont> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
  }
  const data = await fontFetch<{ font: CustomFont }>("/api/fonts/custom/upload", {
    method: "POST",
    body: JSON.stringify({ fileName: file.name, dataBase64: btoa(binary) }),
  });
  registerCustomFontFamily(data.font.familyName);
  return data.font;
}

export async function deleteCustomFont(id: string): Promise<void> {
  await fontFetch<{ deleted: boolean }>(`/api/fonts/custom/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function getCustomFontUsage(): Promise<CustomFontUsage> {
  return fontFetch<CustomFontUsage>("/api/fonts/custom/usage");
}

/** FontFace for THIS document — the picker's label and the properties panel. */
const loadedFonts = new Set<string>();

export async function loadCustomFontInDocument(font: CustomFont): Promise<void> {
  if (loadedFonts.has(font.id)) return;
  registerCustomFontFamily(font.familyName);
  const face = new FontFace(font.familyName, `url(${font.publicUrl})`, { display: "swap" });
  // A dead bucket URL rejects into whatever catch is nearest — historically
  // the picker's swallow — and the family silently rendered as fallback.
  try {
    await face.load();
  } catch {
    throw new Error(`No se pudo cargar «${font.familyName}» desde el almacenamiento`);
  }
  document.fonts.add(face);
  loadedFonts.add(font.id);
}

/** The format hint @font-face expects for each stored container. */
const CSS_FORMAT: Record<CustomFont["format"], string> = {
  ttf: "truetype",
  otf: "opentype",
  woff: "woff",
  woff2: "woff2",
};

export function customFontFaceCss(font: CustomFont): string {
  const safeFamily = font.familyName.replace(/['\\]/g, "");
  return `@font-face{font-family:'${safeFamily}';src:url(${font.publicUrl}) format('${CSS_FORMAT[font.format]}');font-display:swap}`;
}

/** Live frames render in shadow roots, which the persisted css only reaches
 *  after a reload — this styles them right now. */
export function injectCustomFontIntoFrames(font: CustomFont): void {
  const css = customFontFaceCss(font);
  for (const frame of document.querySelectorAll("[data-frame-id]")) {
    const host = [...frame.querySelectorAll("*")].find(element => (element as HTMLElement).shadowRoot) as HTMLElement | undefined;
    const shadow = host?.shadowRoot;
    if (!shadow || shadow.querySelector(`style[data-custom-font="${font.id}"]`)) continue;
    const style = document.createElement("style");
    style.setAttribute("data-custom-font", font.id);
    style.textContent = css;
    shadow.insertBefore(style, shadow.firstChild);
  }
}

/** Persisted into the design css so reloads and every renderer see the face. */
export function ensureCustomFontImport(css: string, font: CustomFont): string {
  if (css.includes(font.publicUrl)) return css;
  return `${customFontFaceCss(font)}\n${css}`;
}
