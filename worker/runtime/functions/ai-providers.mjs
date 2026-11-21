/**
 * REQ-074 — Proveedores IA multi-modelo (fal.ai) + helpers compartidos.
 *
 *   falSubmit(path, body, key)     → encola en queue.fal.run → {requestId, statusUrl, responseUrl}
 *   falPoll(requestId|urls, key)   → estado normalizado {status, videoUrl|imageUrl}
 *   resolveFalKey(params, auth)    → cadena BYOK estándar de Musa:
 *       param falApiKey → user BYOK (provider 'fal') → FAL_KEY de plataforma
 *   persistVideoToAssets(videoUrl, workspaceId) → baja el mp4 temporal y lo
 *       sube al bucket design-assets (las URLs de los proveedores expiran).
 *   resolveImageEditKey(params, auth) → gemini (sync) o fal (queue).
 *
 * Por qué fal.ai: UNA sola key da acceso a Wan 2.2, LTX-2.5, Kling, Hunyuan,
 * MiniMax H3, Qwen-Image-Edit, FLUX Fill y decenas más — los pesos abiertos
 * de referencia ya están hosteados ahí. Self-hostear GPU propia rompería la
 * regla de la casa: BYOK, jamás contenedores nuevos.
 *
 * Honesty rules: la key nunca viaja a logs ni respuestas; los errores
 * upstream se traducen a códigos estables (FAL_*); el poll NO inventa
 * estados — refleja lo que dice la cola de fal.
 */

import { getUserKey } from "./keys.mjs";

const FAL_QUEUE_BASE = "https://queue.fal.run";
const FAL_RESULT_TIMEOUT_MS = 30_000;

/** Modelos de video sugeridos (cualquier id de fal.ai/queues es válido). */
export const FAL_VIDEO_MODELS = {
  "wan-2.2-5b": "fal-ai/wan/v2.2.5b/text-to-video",
  "wan-2.2-5b-i2v": "fal-ai/wan/v2.2.5b/image-to-video",
  "ltx-2.5": "fal-ai/ltx-video-2.5/text-to-video",
  "ltx-2.5-i2v": "fal-ai/ltx-video-2.5/image-to-video",
  "kling-2.5": "fal-ai/kling-video/v2.5-turbo/pro/text-to-video",
  "kling-2.5-i2v": "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
  "minimax-h3": "fal-ai/minimax/h3/text-to-video",
};

/** Editores de imagen por instrucción o máscara en fal. */
export const FAL_IMAGE_EDIT_MODELS = {
  "qwen-image-edit": "fal-ai/qwen-image-edit",
  "flux-fill": "fal-ai/flux-lab/flow-pro",
  "flux-kontext": "fal-ai/flux-pro/kontext",
};

/** Cadena BYOK estándar: param → user key → platform key. */
export async function resolveFalKey(params, auth) {
  let key = typeof params?.falApiKey === "string" ? params.falApiKey.trim() : "";
  if (!key && auth?.userId) {
    const userKey = await getUserKey(auth.userId, "fal");
    if (userKey?.key) key = userKey.key;
  }
  if (!key) {
    const envKey = (typeof process !== "undefined" && process.env && process.env.FAL_KEY) || "";
    if (envKey) key = String(envKey).trim();
  }
  return key || null;
}

/** Para image_edit: el usuario puede elegir motor gemini (sync) o fal (cola). */
export async function resolveImageEditKey(params, auth) {
  const engine = params.provider === "fal" || FAL_IMAGE_EDIT_MODELS[params.model] ? "fal" : "gemini";
  if (engine === "fal") {
    const falKey = await resolveFalKey(params, auth);
    if (falKey) return { engine: "fal", key: falKey };
    throw { code: -32000, message: "NO_FAL_KEY: el motor elegido necesita una key de fal.ai. Pasala en falApiKey, guardá tu key BYOK (provider 'fal') o definí FAL_KEY en el servidor." };
  }
  let gemKey = typeof params?.geminiApiKey === "string" ? params.geminiApiKey.trim() : "";
  if (!gemKey && auth?.userId) {
    const userKey = await getUserKey(auth.userId, "gemini");
    if (userKey?.key) gemKey = userKey.key;
  }
  if (!gemKey) {
    const envKey = (typeof process !== "undefined" && process.env && process.env.GEMINI_API_KEY) || "";
    if (envKey) gemKey = String(envKey).trim();
  }
  if (!gemKey) {
    throw { code: -32000, message: "NO_GEMINI_KEY: falta una Google Gemini API key para el motor por defecto (Nano Banana). Pasala en geminiApiKey, guardá tu key BYOK (provider 'gemini') o definí GEMINI_API_KEY — o elegí provider:'fal' con falApiKey." };
  }
  return { engine: "gemini", key: gemKey };
}

/** Encola un job en la cola de fal. path relativo tipo "fal-ai/wan/...". */
export async function falSubmit(modelPath, body, key) {
  const url = `${FAL_QUEUE_BASE}/${modelPath}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(FAL_RESULT_TIMEOUT_MS) : undefined,
  });
  if (resp.status === 401 || resp.status === 403) {
    throw { code: -32000, message: "FAL_AUTH: la key de fal.ai fue rechazada (401/403). Verificá la key en fal.ai/dashboard/keys." };
  }
  if (resp.status === 422) {
    let detail = "";
    try { detail = JSON.stringify(await resp.json()).slice(0, 400); } catch {}
    throw { code: -32000, message: `FAL_UNPROCESSABLE: fal rechazó los parámetros (422). ${detail}` };
  }
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw { code: -32000, message: `FAL_HTTP_${resp.status}: fal devolvió error al encolar. ${txt.slice(0, 200)}` };
  }
  const data = await resp.json().catch(() => null);
  if (!data || !data.request_id) {
    throw { code: -32000, message: "FAL_BAD_RESPONSE: la cola no devolvió request_id." };
  }
  return {
    requestId: data.request_id,
    statusUrl: data.status_url || `${FAL_QUEUE_BASE}/${modelPath}/requests/${data.request_id}/status`,
    responseUrl: data.response_url || `${FAL_QUEUE_BASE}/${modelPath}/requests/${data.request_id}`,
  };
}

/** Consulta el estado. NO inventa estados: traduce los de fal. */
export async function falPoll(statusUrl, responseUrl, key) {
  const headers = { Authorization: `Key ${key}`, Accept: "application/json" };
  const resp = await fetch(statusUrl, { headers, signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(FAL_RESULT_TIMEOUT_MS) : undefined });
  if (resp.status === 404) {
    // El job existe pero su status aún no está publicado → sigue en cola.
    return { status: "QUEUED" };
  }
  if (!resp.ok) {
    if (resp.status >= 500 || resp.status === 429) {
      return { status: "POLL_ERROR", note: `HTTP ${resp.status} — transitorio, reintentá` };
    }
    throw { code: -32000, message: `FAL_HTTP_${resp.status}: fal rechazó el poll del job.` };
  }
  const data = await resp.json().catch(() => ({}));
  const falStatus = String(data.status || "").toUpperCase();
  if (falStatus === "COMPLETED") {
    // Bajar el resultado real de response_url (ahí viven video_url / image.url).
    const r2 = await fetch(responseUrl, { headers, signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(FAL_RESULT_TIMEOUT_MS) : undefined });
    if (!r2.ok) return { status: "POLL_ERROR", note: `result HTTP ${r2.status} — reintentá` };
    const payload = await r2.json().catch(() => null);
    const videoUrl = payload?.video?.url || payload?.video_url || payload?.url || null;
    const imageUrl = payload?.image?.url || payload?.images?.[0]?.url || null;
    if (!videoUrl && !imageUrl) {
      return { status: "FAILED", error: "FAL_EMPTY_RESULT: el job terminó sin output (revisá el prompt/parámetros)." };
    }
    return { status: "SUCCEEDED", videoUrl, imageUrl, raw: payload };
  }
  if (falStatus === "FAILED" || falStatus === "ERROR") {
    return { status: "FAILED", error: data.error || "FAL_JOB_FAILED: el job falló en fal." };
  }
  if (falStatus === "IN_PROGRESS" || falStatus === "IN_QUEUE" || falStatus === "QUEUED") {
    return { status: falStatus === "IN_PROGRESS" ? "RUNNING" : "QUEUED", queuePosition: data.queue_position ?? null };
  }
  return { status: "RUNNING", note: `estado desconocido '${falStatus}' — tratado como en curso` };
}

/**
 * Baja el medio temporal del proveedor y lo guarda en design-assets.
 * Detecta el content-type real (mp4/png/jpeg/webp) para la extensión.
 * Retorna { ok, videoUrl, persistent } — persistent:false significa que el
 * proveedor borra el archivo pronto (el cliente debe avisarlo).
 */
export async function persistVideoToAssets(sb, mediaUrl, workspaceId) {
  const m = /^https?:\/\//.test(mediaUrl) ? mediaUrl : null;
  if (!m || !sb) return { ok: false, videoUrl: mediaUrl, persistent: false };
  const resp = await fetch(mediaUrl, { signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(120_000) : undefined });
  if (!resp.ok) return { ok: false, videoUrl: mediaUrl, persistent: false, note: `download HTTP ${resp.status}` };
  const buf = Buffer.from(await resp.arrayBuffer());
  const ct = String(resp.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : ct.includes("jpeg") || ct.includes("jpg") ? "jpg" : "mp4";
  const isImage = ext !== "mp4";
  const filePath = `ai-media/${workspaceId || "shared"}/${Date.now()}-gen.${ext}`;
  const { error } = await sb.storage.from("design-assets").upload(filePath, buf, {
    contentType: ct || (isImage ? "image/png" : "video/mp4"), upsert: true,
  });
  if (error) return { ok: false, videoUrl: mediaUrl, persistent: false, note: `upload: ${error.message}` };
  let videoUrl = mediaUrl;
  try { videoUrl = await (await import("./asset-proxy.mjs")).stableAssetUrl(globalThis.__musaEnv || {}, "design-assets", filePath); } catch {}
  return { ok: true, videoUrl, persistent: true, path: filePath, isImage };
}
