/**
 * REQ-059 (bloque D) — AI Clones: proxy same-origin contra HeyGen API v3.
 *
 *   GET  /api/heygen/status                 → ¿hay BYOK de heygen? (solo last4)
 *   POST /api/heygen/validate               → GET /v3/users/me (key vigente + créditos)
 *   GET  /api/heygen/avatars                → GET /v3/avatars/looks (clon listos y en entrenamiento)
 *   GET  /api/heygen/voices                 → GET /v3/voices (?search=&language=)
 *   POST /api/heygen/avatars/digital-twin   → firma la toma en R2 + POST /v3/avatars
 *   POST /api/heygen/videos                 → POST /v3/videos (gasta crédito del usuario)
 *   GET  /api/heygen/videos                 → GET /v3/videos (biblioteca HeyGen)
 *   GET  /api/heygen/videos/:id             → GET /v3/videos/{id} (poll de estado)
 *
 * Por qué un proxy: api.heygen.com no es un destino fiable desde el navegador
 * (CORS) y la BYOK NUNCA debe bajar al client. La clave se lee cifrada con
 * getUserKey(userId, "heygen") — la misma tabla/cripto que /api/keys usa para
 * guardarla (PUT /api/keys/heygen), así que no hay migración nueva.
 *
 * Por qué solo v3: los endpoints v1/v2 tienen sunset el 2026-10-31 (doc
 * oficial). Escribir contra v2 hoy sería comprar una rotura.
 *
 * Entrenamiento de clones: HeyGen exige una URL públicamente descargable
 * (si no, 400 download_failed). Las tomas viven en R2 privado, entonces el
 * proxy firma un GET de 1 h — alcanza para que HeyGen baje el archivo en el
 * momento de encolar el entrenamiento, sin exponer el bucket.
 *
 * Honesty rules: ni la key ni los headers viajan a logs ni respuestas; los
 * errores upstream se traducen con heygenErrorPayload (códigos estables); el
 * proxy NO inventa estados de video — normaliza lo que dice HeyGen.
 */

import { getSupabaseAdmin, getPublicSupabaseConfig, supabaseClientOptions } from "../../../api/src/services/supabase.js";
import { createClient } from "@supabase/supabase-js";
import { decodeHandlerBody, JSON_UTF8_CONTENT_TYPE } from "./http-encoding.mjs";
import { getUserKey } from "./keys.mjs";
import { r2ConfigFromEnv, presignR2Url } from "./r2-presign.mjs";
import {
  HEYGEN_API_BASE,
  buildAvatarVideoBody,
  buildDigitalTwinBody,
  heygenErrorPayload,
  normalizeAccount,
  normalizeAvatarLooks,
  normalizeVideoList,
  normalizeVideoStatus,
  normalizeVoices,
} from "../../../shared/heygenMappers.ts";

/** TTL del enlace firmado para que HeyGen descargue la toma (1 hora). */
const CLONE_SOURCE_EXPIRES_SEG = 3600;
const UPSTREAM_TIMEOUT_MS = 30_000;

function corsHeaders() {
  return {
    "Content-Type": JSON_UTF8_CONTENT_TYPE,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
  };
}

function jsonBody(statusCode, data) {
  return { statusCode, headers: corsHeaders(), body: JSON.stringify(data) };
}

/** Cliente Supabase acotado al JWT: la lectura de la toma respeta RLS. */
function getScopedClient(bearer) {
  const cfg = getPublicSupabaseConfig();
  if (!cfg) return null;
  return createClient(cfg.url, cfg.publishableKey, supabaseClientOptions(bearer));
}

/**
 * Llamada upstream. `path` siempre relativo (/v3/...). Nunca se loggea la
 * key: solo método, ruta y status.
 */
async function callHeygen(apiKey, method, path, body) {
  const init = {
    method,
    headers: { "X-Api-Key": apiKey, Accept: "application/json" },
    signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) : undefined,
  };
  if (body !== undefined && body !== null) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let resp;
  try {
    resp = await fetch(HEYGEN_API_BASE + path, init);
  } catch (cause) {
    const name = cause instanceof Error ? cause.name : "";
    console.error("[heygen] upstream fetch falló:", method, path.split("?")[0], name);
    return { ok: false, status: 0, payload: { error: { code: "network", message: "No se pudo conectar con HeyGen." } } };
  }
  let payload = null;
  try {
    payload = await resp.json();
  } catch {
    payload = null;
  }
  if (!resp.ok) {
    console.error("[heygen] upstream error:", method, path.split("?")[0], resp.status);
    return { ok: false, status: resp.status, payload };
  }
  return { ok: true, status: resp.status, payload };
}

/** Respuesta de error ya envuelta, con 502 si la red cayó. */
function upstreamError(result) {
  const mapped = heygenErrorPayload(result.status || 502, result.payload);
  const status = result.status === 0 || result.status >= 500 ? 502 : result.status;
  return jsonBody(status, mapped);
}

function bodyOf(event) {
  try {
    return JSON.parse(decodeHandlerBody(event, "{}"));
  } catch {
    return null;
  }
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
  }

  const bearer = (event.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return jsonBody(401, { error: "Authentication required." });

  const sbAdmin = getSupabaseAdmin();
  if (!sbAdmin) return jsonBody(503, { error: "Database not configured on the server." });

  let userId;
  try {
    const { data, error } = await sbAdmin.auth.getUser(bearer);
    if (error || !data?.user) return jsonBody(401, { error: "Invalid session." });
    userId = data.user.id;
  } catch {
    return jsonBody(401, { error: "Invalid session." });
  }

  const path = (event.path || "").replace(/^\/+|\/+$/g, "");
  const segments = path.split("/").map(s => decodeURIComponent(s));
  const sub = segments.length >= 3 ? segments[2] : null;
  const action = segments.length >= 4 ? segments[3] : null;
  const id = segments.length >= 4 ? segments[3] : null;
  const query = event.queryStringParameters || {};

  // ── GET /api/heygen/status — sin upstream: solo metadatos de la BYOK ──
  if (event.httpMethod === "GET" && sub === "status") {
    const { data, error } = await sbAdmin
      .from("user_api_keys")
      .select("last4, model, updated_at")
      .eq("user_id", userId)
      .eq("provider", "heygen")
      .maybeSingle();
    if (error) return jsonBody(500, { error: error.message });
    return jsonBody(200, {
      configured: Boolean(data),
      last4: data?.last4 || null,
      updatedAt: data?.updated_at || null,
    });
  }

  // Todo lo demás necesita la key descifrada server-side.
  const { key: apiKey } = await getUserKey(userId, "heygen");
  if (!apiKey) {
    return jsonBody(409, {
      error: "HEYGEN_KEY_MISSING",
      message: "Guardá tu API key de HeyGen en Ajustes > IA (o en esta pestaña) para usar los clones.",
    });
  }

  // ── POST /api/heygen/validate — GET /v3/users/me ──
  if (event.httpMethod === "POST" && sub === "validate") {
    const result = await callHeygen(apiKey, "GET", "/v3/users/me");
    if (!result.ok) return upstreamError(result);
    return jsonBody(200, { valid: true, account: normalizeAccount(result.payload) });
  }

  // ── GET /api/heygen/avatars — looks propios + de catálogo ──
  if (event.httpMethod === "GET" && sub === "avatars") {
    const params = new URLSearchParams({ limit: String(Math.min(100, Math.max(10, Number(query.limit) || 50))) });
    if (query.avatar_type) params.set("avatar_type", String(query.avatar_type));
    const result = await callHeygen(apiKey, "GET", `/v3/avatars/looks?${params.toString()}`);
    if (!result.ok) return upstreamError(result);
    return jsonBody(200, { avatars: normalizeAvatarLooks(result.payload) });
  }

  // ── GET /api/heygen/voices — para elegir voz cuando el clon no trae default ──
  // v3 NO tiene búsqueda por texto (params oficiales: type/engine/language/
  // gender/limit/token): el filtro fino es trabajo de la UI en el cliente.
  if (event.httpMethod === "GET" && sub === "voices") {
    const params = new URLSearchParams({ limit: String(Math.min(100, Math.max(10, Number(query.limit) || 100))) });
    if (query.language) params.set("language", String(query.language));
    const result = await callHeygen(apiKey, "GET", `/v3/voices?${params.toString()}`);
    if (!result.ok) return upstreamError(result);
    return jsonBody(200, { voices: normalizeVoices(result.payload) });
  }

  // ── POST /api/heygen/avatars/digital-twin — entrenar clon desde una toma ──
  if (event.httpMethod === "POST" && sub === "avatars" && action === "digital-twin") {
    const body = bodyOf(event);
    if (!body) return jsonBody(400, { error: "Invalid JSON body." });
    const takeId = String(body.take_id || "");
    const name = String(body.name || "");
    if (!takeId) return jsonBody(400, { error: "HEYGEN_TAKE_REQUIRED", message: "Elegí la toma que va a entrenar el clon." });

    const sb = getScopedClient(bearer);
    if (!sb) return jsonBody(503, { error: "Database not configured on the server." });
    const { data: row } = await sb
      .from("musa_video_takes")
      .select("id, created_by, state, mime, expires_at, r2_key")
      .eq("id", takeId)
      .maybeSingle();
    if (!row) return jsonBody(404, { error: "TAKE_NOT_FOUND", message: "La toma no existe o no es tuya." });
    if (row.created_by !== userId) return jsonBody(403, { error: "TAKE_FORBIDDEN", message: "Solo podés entrenar un clon con tus propias tomas." });
    if (row.state !== "ready") return jsonBody(409, { error: "TAKE_NOT_READY", message: "La toma no terminó de subirse. Grabala de nuevo." });
    if (Date.parse(row.expires_at) <= Date.now()) {
      return jsonBody(410, { error: "TAKE_EXPIRED", message: "La toma venció (24 h). Volvé a grabarla para entrenar el clon." });
    }

    const r2Config = r2ConfigFromEnv();
    if (!r2Config) {
      return jsonBody(503, { error: "TAKE_STORAGE_NOT_CONFIGURED", message: "El almacenamiento de tomas no está configurado en el server." });
    }

    let sourceUrl;
    try {
      sourceUrl = await presignR2Url(r2Config, "GET", row.r2_key, CLONE_SOURCE_EXPIRES_SEG);
    } catch {
      return jsonBody(502, { error: "HEYGEN_SIGN_FAILED", message: "No se pudo generar el enlace de origen para HeyGen." });
    }

    let twinBody;
    try {
      twinBody = buildDigitalTwinBody({ name, videoUrl: sourceUrl });
    } catch (cause) {
      const code = cause?.code || "HEYGEN_BAD_REQUEST";
      return jsonBody(400, { error: code, message: cause instanceof Error ? cause.message : String(cause) });
    }

    const result = await callHeygen(apiKey, "POST", "/v3/avatars", twinBody);
    if (!result.ok) return upstreamError(result);
    // CreateAvatarResponse = { avatar_item, avatar_group }. Se normaliza el
    // item (el id del look es el avatar_id utilizable) y se expone el group.
    const data = result.payload?.data || result.payload || {};
    const item = data.avatar_item || null;
    const group = data.avatar_group || null;
    const looks = normalizeAvatarLooks({ data: item ? [item] : [] });
    return jsonBody(200, {
      avatar: looks[0] || null,
      avatarGroupId: group?.id || item?.group_id || item?.avatar_group_id || null,
      status: item?.status || group?.status || null,
    });
  }

  // ── POST /api/heygen/videos — generar con clon + guion (gasta crédito) ──
  if (event.httpMethod === "POST" && sub === "videos") {
    const body = bodyOf(event);
    if (!body) return jsonBody(400, { error: "Invalid JSON body." });
    let videoBody;
    try {
      videoBody = buildAvatarVideoBody({
        avatarId: String(body.avatar_id || ""),
        script: String(body.script || ""),
        aspectRatio: body.aspect_ratio ? String(body.aspect_ratio) : null,
        voiceId: body.voice_id ? String(body.voice_id) : null,
        title: body.title ? String(body.title) : null,
        resolution: body.resolution ? String(body.resolution) : null,
        outputFormat: body.output_format ? String(body.output_format) : null,
      });
    } catch (cause) {
      const code = cause?.code || "HEYGEN_BAD_REQUEST";
      return jsonBody(400, { error: code, message: cause instanceof Error ? cause.message : String(cause) });
    }
    const result = await callHeygen(apiKey, "POST", "/v3/videos", videoBody);
    if (!result.ok) return upstreamError(result);
    const status = normalizeVideoStatus(result.payload);
    return jsonBody(200, {
      videoId: status.videoId,
      status: status.rawStatus,
      phase: status.phase,
      videoUrl: status.videoUrl,
    });
  }

  // ── GET /api/heygen/videos — biblioteca del usuario en HeyGen ──
  // Paginación v3 oficial: limit + token (cursor). No existe page_size.
  if (event.httpMethod === "GET" && sub === "videos" && !id) {
    const params = new URLSearchParams({ limit: String(Math.min(50, Math.max(5, Number(query.limit) || 20))) });
    if (query.token) params.set("token", String(query.token));
    const result = await callHeygen(apiKey, "GET", `/v3/videos?${params.toString()}`);
    if (!result.ok) return upstreamError(result);
    return jsonBody(200, { videos: normalizeVideoList(result.payload) });
  }

  // ── GET /api/heygen/videos/:id — poll de un render ──
  if (event.httpMethod === "GET" && sub === "videos" && id) {
    const result = await callHeygen(apiKey, "GET", `/v3/videos/${encodeURIComponent(id)}`);
    if (!result.ok) return upstreamError(result);
    return jsonBody(200, { video: normalizeVideoStatus(result.payload) });
  }

  return jsonBody(405, { error: `Method ${event.httpMethod} not allowed.` });
}
