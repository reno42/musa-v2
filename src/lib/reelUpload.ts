/**
 * reelUpload — REQ-VID8 v2: get a rendered reel to a stable public URL.
 *
 * Path 1 (preferred): browser → Supabase Storage directly with the user's
 * JWT (needs the v53 storage policies). Kills the worker's 120MB base64
 * JSON body — the whole reason POST /video had a size ceiling on CF's
 * 128MB isolates.
 *
 * Path 2 (fallback): the existing worker shim POST /api/storage/video —
 * still works before v53 is applied (e.g. local dev today).
 */

import { browserSupabase } from "./supabaseClient";

const REEL_BUCKET = "design-reels";

/** RF-035 D: soft storage ceiling per workspace (Supabase free bucket
 *  scale, ~1GB). The editor blocks uploads BEFORE Supabase fails with an
 *  opaque error — the quota readout comes from /api/storage/usage. */
export const REEL_STORAGE_SOFT_LIMIT_BYTES = 1024 * 1024 * 1024;

export async function uploadReelVideo(workspaceId: string, blob: Blob, filename: string): Promise<string> {
  if (browserSupabase) {
    try {
      const safe = filename.replace(/[^\w.\-]+/g, "_").slice(0, 120);
      const path = `${workspaceId}/${Date.now()}_${safe}`;
      const { error } = await browserSupabase.storage.from(REEL_BUCKET).upload(path, blob, {
        contentType: blob.type || "video/webm",
        upsert: false,
      });
      if (!error) {
        const { data } = browserSupabase.storage.from(REEL_BUCKET).getPublicUrl(path);
        if (data?.publicUrl) return data.publicUrl;
      }
      // No error but also no URL? Still fall through to the shim.
    } catch {
      /* policies missing / not authenticated — worker shim next */
    }
  }

  const dataBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("No se pudo leer el blob"));
    reader.readAsDataURL(blob);
  });
  const res = await fetch("/api/storage/video", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, filename, dataBase64, mimeType: blob.type || "video/webm" }),
  });
  const json = await res.json().catch(() => null);
  if (res.ok && json?.success && json?.data?.url) return String(json.data.url);
  throw new Error(json?.error || `HTTP ${res.status}`);
}

/** V3.4: video/image clips for the timeline's overlay lanes. Same two-path
 *  strategy as reels — browser→Supabase direct with the v53 policies, then
 *  the worker shim POST /api/storage/media as fallback. */
export async function uploadReelMedia(workspaceId: string, file: File): Promise<{ url: string; kind: "video" | "image" }> {
  const kind: "video" | "image" = file.type.startsWith("image/") ? "image" : "video";
  const mime = file.type || (kind === "video" ? "video/mp4" : "image/png");
  if (browserSupabase) {
    try {
      const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(0, 120);
      const path = `${workspaceId}/media/${Date.now()}_${safe}`;
      const { error } = await browserSupabase.storage.from(REEL_BUCKET).upload(path, file, {
        contentType: mime,
        upsert: false,
      });
      if (!error) {
        const { data } = browserSupabase.storage.from(REEL_BUCKET).getPublicUrl(path);
        if (data?.publicUrl) return { url: data.publicUrl, kind };
      }
      // No error but also no URL? Still fall through to the shim.
    } catch {
      /* policies missing / not authenticated — worker shim next */
    }
  }

  const dataBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsDataURL(file);
  });
  const res = await fetch("/api/storage/media", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, filename: file.name, dataBase64, mimeType: mime }),
  });
  const json = await res.json().catch(() => null);
  if (res.ok && json?.success && json?.data?.url) return { url: String(json.data.url), kind };
  throw new Error(json?.error || `HTTP ${res.status}`);
}

/** V3.4→RF-035 D: audio clips — same two-path strategy as reels/media:
 *  browser→Supabase direct first (v53 policies), worker shim as fallback.
 *  Music files up to ~10MB no longer ride base64 through the CF worker
 *  (base64 JSON + Worker CPU on the free plan was borderline). */
export async function uploadReelAudio(workspaceId: string, file: File): Promise<string> {
  if (browserSupabase) {
    try {
      const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(0, 120);
      const path = `${workspaceId}/audio/${Date.now()}_${safe}`;
      const { error } = await browserSupabase.storage.from(REEL_BUCKET).upload(path, file, {
        contentType: file.type || "audio/mpeg",
        upsert: false,
      });
      if (!error) {
        const { data } = browserSupabase.storage.from(REEL_BUCKET).getPublicUrl(path);
        if (data?.publicUrl) return data.publicUrl;
      }
      // No error but also no URL? Still fall through to the shim.
    } catch {
      /* policies missing / not authenticated — worker shim next */
    }
  }

  const data = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(data);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const dataBase64 = btoa(binary);
  const res = await fetch("/api/storage/audio", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, filename: file.name, dataBase64, mimeType: file.type || "audio/mpeg" }),
  });
  const json = await res.json().catch(() => null);
  if (res.ok && json?.success && json?.data?.url) return String(json.data.url);
  throw new Error(json?.error || `HTTP ${res.status}`);
}
