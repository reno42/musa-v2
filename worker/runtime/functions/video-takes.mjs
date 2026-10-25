/**
 * REQ-058 — Tomas de video (Take Studio): API server-side.
 *
 *   GET    /api/video-takes?workspace_id=X      → tomas vivas del workspace
 *   POST   /api/video-takes/sign                → registra + URL firmada de PUT
 *   POST   /api/video-takes/complete            → verifica el objeto y cierra
 *   GET    /api/video-takes/:id/download        → URL firmada de GET (5 min)
 *   DELETE /api/video-takes/:id                 → borra en R2 y marca 'purged'
 *
 * Diseño: TODA operación de DB corre por un cliente Supabase acotado al JWT
 * del caller (no el admin) — así RLS y los RPC de la migración v84 (cupo,
 * rol editor, TTL de 24 h con auth.uid()) son la ÚNICA fuente de verdad y
 * este handler no duplica invariantes. Aquí solo se hace lo que R2 exige:
 * firmar URLs SigV4 (r2-presign.mjs, sin binding) y verificar el objeto.
 *
 * Expiración LAZY (shared/takeTtl.ts): el listado filtra expires_at > NOW()
 * y la descarga rechaza vencidas — la promesa de 24 h del aviso se cumple
 * aunque el barrido manual de fin de semana no haya corrido.
 *
 * Honesty rules: sin claves en logs ni respuestas; los errores de quota/rol
 * salen con los códigos del RPC; storage sin configurar responde 503 sin
 * filtrar nombres de env.
 */

import { getSupabaseAdmin, getPublicSupabaseConfig, supabaseClientOptions } from "../../../api/src/services/supabase.js";
import { createClient } from "@supabase/supabase-js";
import { decodeHandlerBody, JSON_UTF8_CONTENT_TYPE } from "./http-encoding.mjs";
import { r2ConfigFromEnv, presignR2Url, deleteR2Object, headR2Object } from "./r2-presign.mjs";
import { takeStatus, takeFilename } from "../../../shared/takeTtl.ts";

const PUT_EXPIRES_SEG = 600;   // 10 min para subir una toma de ≤3 min
const DOWNLOAD_EXPIRES_SEG = 300; // 5 min para descargar

function corsHeaders() {
  return {
    "Content-Type": JSON_UTF8_CONTENT_TYPE,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
  };
}

function jsonBody(statusCode, data) {
  return { statusCode, headers: corsHeaders(), body: JSON.stringify(data) };
}

/** Fila de musa_video_takes → DTO del cliente (sin r2_key) + estado derivado. */
function serializeTake(row, nowMs = Date.now()) {
  const expiresAtMs = Date.parse(row.expires_at);
  const info = takeStatus(row.state, expiresAtMs, nowMs);
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    state: row.state,
    mime: row.mime,
    sizeBytes: Number(row.size_bytes) || 0,
    durationMs: Number(row.duration_ms) || 0,
    createdBy: row.created_by,
    downloadedAt: row.downloaded_at || null,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    status: info.status,
    remainingMs: info.remainingMs,
    remainingLabel: info.label,
  };
}

function extFromMime(mime) {
  if (typeof mime === "string" && mime.includes("mp4")) return "mp4";
  return "webm";
}

/** Mapea el error de un RPC (código Postgres) a status HTTP. */
function rpcErrorStatus(error) {
  const code = error?.code || "";
  const message = error?.message || "";
  if (code === "42501" || message.startsWith("TAKE_FORBIDDEN")) {
    return { status: 403, payload: { error: "TAKE_FORBIDDEN", message: "Requiere rol editor en el workspace." } };
  }
  if (code === "22023" || message.startsWith("TAKE_SIZE_REQUIRED")) {
    return { status: 400, payload: { error: "TAKE_SIZE_REQUIRED", message: "size_bytes debe ser positivo." } };
  }
  if (code === "P0001" && message.startsWith("TAKE_QUOTA_EXCEEDED")) {
    return { status: 409, payload: { error: "TAKE_QUOTA_EXCEEDED", message: "Cupo de tomas lleno. Descarga tus tomas y espera el barrido, o borra alguna." } };
  }
  if (message.startsWith("TAKE_NOT_OPEN")) {
    return { status: 409, payload: { error: "TAKE_NOT_OPEN", message: "La toma no existe, no es tuya o ya estaba cerrada." } };
  }
  return null;
}

/** Cliente Supabase acotado al JWT — RLS aplica y auth.uid() resuelve en RPCs. */
function getScopedClient(bearer) {
  const cfg = getPublicSupabaseConfig();
  if (!cfg) return null;
  return createClient(cfg.url, cfg.publishableKey, supabaseClientOptions(bearer));
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
  }

  const bearer = (event.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  if (!bearer) {
    return jsonBody(401, { error: "Authentication required." });
  }

  const sbAdmin = getSupabaseAdmin();
  if (!sbAdmin) {
    return jsonBody(503, { error: "Database not configured on the server." });
  }

  let userId;
  try {
    const { data, error } = await sbAdmin.auth.getUser(bearer);
    if (error || !data?.user) return jsonBody(401, { error: "Invalid session." });
    userId = data.user.id;
  } catch {
    return jsonBody(401, { error: "Invalid session." });
  }

  const sb = getScopedClient(bearer);
  if (!sb) {
    return jsonBody(503, { error: "Database not configured on the server." });
  }

  // ── Path: ["api", "video-takes", (sub | :id), ("download")] ──
  const path = (event.path || "").replace(/^\/+|\/+$/g, "");
  const segments = path.split("/").map(s => decodeURIComponent(s));
  const sub = segments.length >= 3 ? segments[2] : null;
  const action = segments.length >= 4 ? segments[3] : null;

  // ── GET /api/video-takes?workspace_id=X — listing (lazy: solo vivas) ──
  if (event.httpMethod === "GET" && !sub) {
    const workspaceId = event.queryStringParameters?.workspace_id || "";
    if (!workspaceId) {
      return jsonBody(400, { error: "TAKE_WORKSPACE_REQUIRED", message: "Falta workspace_id." });
    }
    const { data, error } = await sb
      .from("musa_video_takes")
      .select("id, workspace_id, state, mime, size_bytes, duration_ms, created_by, downloaded_at, created_at, expires_at")
      .eq("workspace_id", workspaceId)
      .neq("state", "purged")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
    if (error) return jsonBody(500, { error: error.message });
    // RLS (viewer+) ya filtró por membresía: sin membresía la lista sale vacía.
    return jsonBody(200, { takes: (data || []).map(row => serializeTake(row)) });
  }

  // ── POST /api/video-takes/sign — registra y firma el PUT ──
  if (event.httpMethod === "POST" && sub === "sign") {
    let body;
    try {
      body = JSON.parse(decodeHandlerBody(event, "{}"));
    } catch {
      return jsonBody(400, { error: "Invalid JSON body." });
    }
    const workspaceId = String(body.workspace_id || "");
    const sizeBytes = Number(body.size_bytes);
    const durationMs = Number.isFinite(Number(body.duration_ms)) ? Math.max(0, Math.trunc(Number(body.duration_ms))) : 0;
    const mime = String(body.mime || "video/webm").slice(0, 120);
    if (!workspaceId) {
      return jsonBody(400, { error: "TAKE_WORKSPACE_REQUIRED", message: "Falta workspace_id." });
    }

    const r2Config = r2ConfigFromEnv();
    if (!r2Config) {
      // Sin nombres de env al cliente — el setup vive en docs/REQ-058.
      return jsonBody(503, { error: "TAKE_STORAGE_NOT_CONFIGURED", message: "El almacenamiento de tomas no está configurado en el server. Contacta al admin." });
    }

    const { data: take, error } = await sb.rpc("musa_register_video_take", {
      p_workspace_id: workspaceId,
      p_size_bytes: sizeBytes,
      p_duration_ms: durationMs,
      p_mime: mime,
    });
    if (error) {
      const mapped = rpcErrorStatus(error);
      if (mapped) return jsonBody(mapped.status, mapped.payload);
      return jsonBody(500, { error: error.message });
    }

    const uploadUrl = await presignR2Url(r2Config, "PUT", take.r2_key, PUT_EXPIRES_SEG);
    return jsonBody(200, {
      take: serializeTake(take),
      upload: {
        url: uploadUrl,
        method: "PUT",
        headers: { "Content-Type": mime },
        expiresInSeg: PUT_EXPIRES_SEG,
      },
    });
  }

  // ── POST /api/video-takes/complete — HEAD en R2 + cierre ──
  if (event.httpMethod === "POST" && sub === "complete") {
    let body;
    try {
      body = JSON.parse(decodeHandlerBody(event, "{}"));
    } catch {
      return jsonBody(400, { error: "Invalid JSON body." });
    }
    const takeId = String(body.take_id || "");
    if (!takeId) return jsonBody(400, { error: "TAKE_ID_REQUIRED" });

    const { data: row } = await sb
      .from("musa_video_takes")
      .select("*")
      .eq("id", takeId)
      .maybeSingle();
    if (!row || row.created_by !== userId) {
      return jsonBody(404, { error: "TAKE_NOT_FOUND" });
    }
    if (row.state !== "uploading") {
      return jsonBody(409, { error: "TAKE_NOT_OPEN", message: "La toma ya estaba cerrada." });
    }
    if (Date.parse(row.expires_at) <= Date.now()) {
      return jsonBody(410, { error: "TAKE_EXPIRED", message: "La toma venció (24 h). Grábala de nuevo." });
    }

    const r2Config = r2ConfigFromEnv();
    if (!r2Config) {
      return jsonBody(503, { error: "TAKE_STORAGE_NOT_CONFIGURED", message: "El almacenamiento de tomas no está configurado en el server. Contacta al admin." });
    }

    // Verificamos que el PUT del navegador realmente llegó — sin HEAD no hay
    // 'ready' (evita tomas fantasma que ocupan cupo sin existir).
    let head;
    try {
      head = await headR2Object(r2Config, row.r2_key);
    } catch {
      return jsonBody(502, { error: "R2_HEAD_FAILED", message: "No se pudo verificar la toma en el almacenamiento." });
    }
    if (!head) {
      return jsonBody(409, { error: "TAKE_NOT_UPLOADED", message: "El upload no llegó al almacenamiento. Grábala de nuevo." });
    }

    const { data: take, error } = await sb.rpc("musa_complete_video_take", {
      p_take_id: takeId,
      p_size_bytes: head.size,
    });
    if (error) {
      const mapped = rpcErrorStatus(error);
      if (mapped) return jsonBody(mapped.status, mapped.payload);
      return jsonBody(500, { error: error.message });
    }
    return jsonBody(200, { take: serializeTake(take) });
  }

  // ── GET /api/video-takes/:id/download — URL firmada de GET ──
  if (event.httpMethod === "GET" && sub && action === "download") {
    const { data: row } = await sb
      .from("musa_video_takes")
      .select("*")
      .eq("id", sub)
      .maybeSingle();
    if (!row) return jsonBody(404, { error: "TAKE_NOT_FOUND" });
    if (row.state !== "ready" || Date.parse(row.expires_at) <= Date.now()) {
      return jsonBody(410, { error: "TAKE_EXPIRED", message: "La toma venció (24 h) o no terminó de subirse." });
    }

    const r2Config = r2ConfigFromEnv();
    if (!r2Config) {
      return jsonBody(503, { error: "TAKE_STORAGE_NOT_CONFIGURED", message: "El almacenamiento de tomas no está configurado en el server. Contacta al admin." });
    }

    const downloadUrl = await presignR2Url(r2Config, "GET", row.r2_key, DOWNLOAD_EXPIRES_SEG);

    // Badge de la UI: marcamos la primera descarga (best-effort, no bloquea).
    if (!row.downloaded_at) {
      try {
        await sb.from("musa_video_takes").update({ downloaded_at: new Date().toISOString() }).eq("id", row.id);
      } catch { /* cosmético */ }
    }

    const filename = takeFilename(Date.parse(row.created_at), extFromMime(row.mime));
    return jsonBody(200, { downloadUrl, filename, expiresInSeg: DOWNLOAD_EXPIRES_SEG });
  }

  // ── DELETE /api/video-takes/:id — borra en R2 + tumba 'purged' ──
  if (event.httpMethod === "DELETE" && sub && !action) {
    const { data: row } = await sb
      .from("musa_video_takes")
      .select("*")
      .eq("id", sub)
      .maybeSingle();
    if (!row) return jsonBody(404, { error: "TAKE_NOT_FOUND" });

    const r2Config = r2ConfigFromEnv();
    if (!r2Config) {
      return jsonBody(503, { error: "TAKE_STORAGE_NOT_CONFIGURED", message: "El almacenamiento de tomas no está configurado en el server. Contacta al admin." });
    }

    try {
      await deleteR2Object(r2Config, row.r2_key);
    } catch {
      // Si R2 falla NO marcamos purged: los bytes seguirían vivos sin rastro.
      return jsonBody(502, { error: "TAKE_DELETE_FAILED", message: "No se pudo borrar en el almacenamiento. Intenta de nuevo." });
    }

    // UPDATE por cliente acotado: la policy editor de RLS decide.
    const { error } = await sb
      .from("musa_video_takes")
      .update({ state: "purged" })
      .eq("id", row.id);
    if (error) return jsonBody(500, { error: error.message });
    return jsonBody(200, { success: true, id: row.id });
  }

  return jsonBody(405, { error: `Method ${event.httpMethod} not allowed.` });
}
