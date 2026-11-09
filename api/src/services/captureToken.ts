/**
 * Pase de captura para render_frame_png y diff_against_reference.
 *
 * Antes la URL de captura llevaba la llave del espacio en ?key= y quedaba en el historial del
 * navegador, en logs y en capturas de pantalla. Ahora lleva un pase cifrado (AES-256-GCM con la
 * llave del servidor) que dice: esta llave, este diseño, este frame, hasta tal hora (15 minutos).
 * La llave nunca aparece en claro: el servidor la recupera al abrir la página, y la página solo
 * puede usar el pase para subir el PNG (upload_image) — nada más del MCP.
 */
import { open, seal } from "./publishers/crypto.ts";

export const CAPTURE_TTL_MS = 15 * 60 * 1000;

export interface CapturePass { k: string; t: string; f?: string; exp: number }

export async function sealCapture(key: string, templateId: string, frameId?: string) {
  if (!key) return "";
  const pass: CapturePass = { k: key, t: templateId, f: frameId, exp: Date.now() + CAPTURE_TTL_MS };
  return "c" + (await seal(JSON.stringify(pass)));
}

/** El pase si es válido y no venció; null si no. */
export async function openCapture(token: string | null | undefined): Promise<CapturePass | null> {
  if (!token || !token.startsWith("cp1.")) return null;
  try {
    const p = JSON.parse((await open(token.slice(1))) || "null") as CapturePass | null;
    if (!p || typeof p.k !== "string" || typeof p.t !== "string" || !(p.exp > Date.now())) return null;
    return p;
  } catch { return null; }
}
