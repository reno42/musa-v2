/**
 * REQ-058 — Herramientas MCP para las tomas del Take Studio.
 *
 * El agente NO graba (eso lo hace el humano en el estudio); supervisa el
 * material crudo disponible, consigue URLs de descarga para el humano y
 * borra tomas. Los schemas viven como literales en MCP_TOOLS (mcp.mjs) —
 * así sync-skill-tools.mjs los ve — y SOLO la implementación vive acá.
 *
 * Trust model: corre con service key (RLS bypass) PERO el gate ya corrió en
 * authorizeMcpCall — viewer para list/download (MCP_READ_PREFIX/METHODS),
 * editor para delete; el tenant de video_takes_delete se resuelve en DB
 * contra musa_video_takes (mcp.mjs), así una workspace_key no cruza tenants
 * aunque el id sea adivinable.
 *
 * Política TTL: la salida SIEMPRE recuerda que la toma se borra a las 24 h —
 * el agente es otro canal del aviso que motiva la descarga.
 */

import { getSupabaseAdmin } from "../../../api/src/services/supabase.js";
import { r2ConfigFromEnv, presignR2Url, deleteR2Object } from "./r2-presign.mjs";
import { TAKES_SOFT_QUOTA_BYTES, humanBytes, takeFilename, takeStatus } from "../../../shared/takeTtl.ts";

const DOWNLOAD_EXPIRES_SEG = 300;

function extFromMime(mime) {
  return typeof mime === "string" && mime.includes("mp4") ? "mp4" : "webm";
}

function serializeTake(row, nowMs = Date.now()) {
  const info = takeStatus(row.state, Date.parse(row.expires_at), nowMs);
  return {
    takeId: row.id,
    state: row.state,
    mime: row.mime,
    sizeBytes: Number(row.size_bytes) || 0,
    sizeLabel: humanBytes(Number(row.size_bytes) || 0),
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

function requireWorkspaceId(params) {
  const wsId = String(params.workspaceId || "").trim();
  if (!wsId) {
    throw { code: -32602, message: "workspaceId es requerido (list_workspaces para ver los accesibles)." };
  }
  return wsId;
}

function storageConfigOrThrow() {
  const config = r2ConfigFromEnv();
  if (!config) {
    throw { code: -32000, message: "TAKE_STORAGE_NOT_CONFIGURED: el almacenamiento de tomas no está configurado en el server (docs/REQ-058 §8)." };
  }
  return config;
}

async function getTakeRow(sb, takeId, workspaceId) {
  let query = sb
    .from("musa_video_takes")
    .select("id, workspace_id, state, mime, size_bytes, duration_ms, created_by, downloaded_at, created_at, expires_at")
    .eq("id", String(takeId || "").trim());
  if (workspaceId) query = query.eq("workspace_id", workspaceId);
  const { data, error } = await query.maybeSingle();
  if (error) throw { code: -32000, message: error.message };
  if (!data) {
    throw { code: -32004, message: `Toma no encontrada (o de otro workspace): ${takeId}` };
  }
  return data;
}

export async function handleVideoTakesTool(method, params) {
  const sb = getSupabaseAdmin();
  if (!sb) throw { code: -32000, message: "Database not configured on the server." };

  // ── video_takes_list — material crudo vivo del workspace (viewer) ──
  if (method === "video_takes_list") {
    const workspaceId = requireWorkspaceId(params);
    const { data, error } = await sb
      .from("musa_video_takes")
      .select("id, state, mime, size_bytes, duration_ms, created_by, downloaded_at, created_at, expires_at")
      .eq("workspace_id", workspaceId)
      .neq("state", "purged")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
    if (error) throw { code: -32000, message: error.message };
    const takes = (data || []).map(row => serializeTake(row));
    const liveBytes = takes.reduce((acc, t) => acc + t.sizeBytes, 0);
    return {
      workspaceId,
      takes,
      liveBytes,
      liveBytesLabel: humanBytes(liveBytes),
      quotaBytes: TAKES_SOFT_QUOTA_BYTES,
      note: "Las tomas vencen a las 24 horas y se borran (insumo, no archivo). Sugiere al humano descargarlas desde Video > Tomas antes del vencimiento.",
    };
  }

  // ── video_takes_download — URL firmada para el humano (viewer) ──
  if (method === "video_takes_download") {
    const workspaceId = requireWorkspaceId(params);
    const takeId = String(params.takeId || "").trim();
    if (!takeId) throw { code: -32602, message: "takeId es requerido." };
    const row = await getTakeRow(sb, takeId, workspaceId);
    if (row.state !== "ready" || Date.parse(row.expires_at) <= Date.now()) {
      throw { code: -32000, message: "TAKE_EXPIRED: la toma venció (24 h) o no terminó de subirse." };
    }
    const config = storageConfigOrThrow();
    const downloadUrl = await presignR2Url(config, "GET", row.r2_key, DOWNLOAD_EXPIRES_SEG);
    // Badge de la UI (best-effort, no bloquea la entrega).
    if (!row.downloaded_at) {
      try {
        await sb.from("musa_video_takes").update({ downloaded_at: new Date().toISOString() }).eq("id", row.id);
      } catch { /* cosmético */ }
    }
    return {
      takeId: row.id,
      downloadUrl,
      filename: takeFilename(Date.parse(row.created_at), extFromMime(row.mime)),
      expiresInSeg: DOWNLOAD_EXPIRES_SEG,
      remainingLabel: takeStatus(row.state, Date.parse(row.expires_at), Date.now()).label,
      note: "URL firmada válida 5 minutos. La toma se borra del server a las 24 h — el humano debe guardar el archivo localmente.",
    };
  }

  // ── video_takes_delete — borra ya (editor; tenant resuelto en mcp.mjs) ──
  if (method === "video_takes_delete") {
    const takeId = String(params.takeId || "").trim();
    if (!takeId) throw { code: -32602, message: "takeId es requerido." };
    const row = await getTakeRow(sb, takeId, String(params.workspaceId || "").trim() || null);
    const config = storageConfigOrThrow();
    try {
      await deleteR2Object(config, row.r2_key);
    } catch {
      throw { code: -32000, message: "No se pudo borrar el objeto en R2 — la fila NO se marca purged (sin bytes huérfanos sin rastro)." };
    }
    const { error } = await sb.from("musa_video_takes").update({ state: "purged" }).eq("id", row.id);
    if (error) throw { code: -32000, message: error.message };
    return { takeId: row.id, deleted: true, note: "Objeto borrado en R2 y fila marcada purged (tumba de auditoría)." };
  }

  throw { code: -32601, message: `Método desconocido: ${method}` };
}
