/**
 * videoProjects — REQ-VID10: modelo de datos video standalone (modelo CapCut).
 *
 * Una sola implementación para DOS consumidores (cero drift):
 *   • MCP tools video_* (worker/runtime/functions/mcp.mjs)
 *   • REST /api/video-projects (api/src/routes/videoProjects.ts)
 *
 * Modelo (migración v73): projects → tracks (z_order ASC = de abajo hacia
 * arriba) → segments; materials es el diccionario plano de assets y
 * companions. El segment es DELGADO: referencia su asset por material_id y
 * sus companions (efectos/velocidad/fades) via extra_refs[] — nunca copia.
 *
 * Reglas duras heredadas de CapCut (las cruces de tabla que SQL no puede
 * chequear viven aquí, en los validadores):
 *   • TODO en microsegundos (µs). Prohibido guardar segundos.
 *   • Posiciones normalizadas -1..1 (centro=0,0); scale 1.0 = tamaño source.
 *   • Segmento de audio ⇒ clip null.
 *   • source_dur_us = round(target_dur_us × speed) — regla de oro.
 *   • extra_refs[] solo apunta a materials del MISMO project.
 *   • Trim clampado al fin del source (nunca pasa el fin del material).
 */

import { randomBytes } from "node:crypto";
// .ts explícito (convención figImport): este módulo se importa directo en los
// QA tests con node --experimental-strip-types, que no resuelve .js → .ts.
import { getSupabaseAdmin } from "./supabase.ts";

// ── Errors ──────────────────────────────────────────────────────────────────

/** Error con código ESTABLE para que la IA se autocorrija (mismo criterio que
 *  los flowCode de flows-core) y status HTTP para el REST. El código viaja
 *  DENTRO del mensaje ([CODE] ...) — mismo formato que devuelven las MCP
 *  tools — así el agente lo lee sin importar la capa que falló. */
export class VideoProjectError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(`[${code}] ${message}`);
    this.code = code;
    this.status = status;
  }
}

const err = (code: string, message: string, status = 400) =>
  new VideoProjectError(code, message, status);

// ── Tipos (filas snake_case tal cual salen de Supabase, como flows) ─────────

export interface VideoProjectRow {
  id: string;
  workspace_id: string;
  name: string;
  duration_us: number;
  fps: number;
  canvas_w: number;
  canvas_h: number;
  ratio: string;
  is_template: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface VideoTrackRow {
  id: string;
  project_id: string;
  type: "video" | "audio" | "text" | "sticker" | "effect";
  z_order: number;
  created_at: string;
}

export interface VideoSegmentRow {
  id: string;
  track_id: string;
  material_id: string;
  target_start_us: number;
  target_dur_us: number;
  source_start_us: number | null;
  source_dur_us: number | null;
  speed: number;
  clip: ClipTransform | null;
  extra_refs: string[];
  created_at: string;
}

export interface VideoMaterialRow {
  id: string;
  project_id: string;
  kind: VideoMaterialKind;
  payload: Record<string, unknown>;
  slot: { key: string; label?: string } | null;
  created_at: string;
}

export type VideoMaterialKind =
  | "video" | "image" | "audio" | "text" | "sticker" | "effect" | "transition"
  | "animation" | "mask" | "canvas" | "speed" | "audio_fade";

export const VIDEO_MATERIAL_KINDS: VideoMaterialKind[] = [
  "video", "image", "audio", "text", "sticker", "effect", "transition",
  "animation", "mask", "canvas", "speed", "audio_fade",
];

export const VIDEO_TRACK_TYPES = ["video", "audio", "text", "sticker", "effect"] as const;

export interface VideoProjectTree {
  project: VideoProjectRow;
  tracks: Array<VideoTrackRow & { segments: VideoSegmentRow[] }>;
  materials: VideoMaterialRow[];
}

/** Transform del clip — posiciones normalizadas -1..1, centro (0,0). */
export interface ClipTransform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  alpha: number;
  flip: { x: boolean; y: boolean } | null;
}

// ── Límites ─────────────────────────────────────────────────────────────────

export const VIDEO_LIMITS = {
  payloadBytes: 65_536,        // un material es URL+números+estilos, nunca binarios
  maxSpeed: 100,
  minSpeed: 0.01,
  maxNameLen: 120,
  maxTextLen: 4_000,
  maxRefsPerSegment: 32,
  defaultTargetDurUs: 5_000_000,
  maxTracksPerProject: 32,
  maxMaterialsPerProject: 2_000,
};

// ── Validadores puros (unit-testeables sin Supabase) ────────────────────────

const US = 1_000_000;

/** µs entero ≥ min (default 0). Rechaza segundos por diseño: si el campo viene
 *  en fracción de µs (número no entero) es un bug del caller, no se redondea. */
export function validateUsInt(value: unknown, field: string, min = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw err("TIME_INVALID", `${field} debe ser un entero de microsegundos (recibido: ${JSON.stringify(value)}). Prohibido segundos — 1s = 1000000.`);
  }
  if (value < min) throw err("TIME_INVALID", `${field} debe ser ≥ ${min} µs (recibido: ${value}).`);
  return value;
}

/** Duración en µs > 0. */
export function validateDurUs(value: unknown, field: string): number {
  return validateUsInt(value, field, 1);
}

/** Regla de oro CapCut: source_dur = round(target_dur × speed). */
export function sourceDurForTarget(targetDurUs: number, speed: number): number {
  return Math.round(targetDurUs * speed);
}

/** Inversa: target_dur = round(source_dur / speed) — mínimo 1 µs. */
export function targetDurForSource(sourceDurUs: number, speed: number): number {
  return Math.max(1, Math.round(sourceDurUs / speed));
}

/** speed > 0 y dentro del cap (clamp suave fuera de rango extremo). */
export function validateSpeed(value: unknown): number {
  if (value === undefined || value === null) return 1;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw err("SPEED_INVALID", `speed debe ser un número > 0 (recibido: ${JSON.stringify(value)}). Regla: source_dur = target_dur × speed.`);
  }
  return Math.min(VIDEO_LIMITS.maxSpeed, Math.max(VIDEO_LIMITS.minSpeed, n));
}

/** clip transform: normaliza y clampea (x,y ∈ -1..1, scale 0.01..100,
 *  alpha 0..1, rotation grados horario -3600..3600). null/undefined → null.
 *  En audio el caller PROHIBE el clip (regla dura de CapCut). */
export function normalizeClipTransform(raw: unknown): ClipTransform | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw err("CLIP_INVALID", "clip debe ser un objeto {x, y, scale, rotation, alpha, flip}.");
  }
  const c = raw as Record<string, unknown>;
  const num = (v: unknown, def: number) => (typeof v === "number" && Number.isFinite(v) ? v : def);
  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  const flipRaw = c.flip as { x?: unknown; y?: unknown } | null | undefined;
  const flip = flipRaw && typeof flipRaw === "object"
    ? {
        x: flipRaw.x === true,
        y: flipRaw.y === true,
      }
    : null;
  return {
    x: clamp(num(c.x, 0), -1, 1),
    y: clamp(num(c.y, 0), -1, 1),
    scale: clamp(num(c.scale, 1), 0.01, 100),
    rotation: clamp(num(c.rotation, 0), -3600, 3600),
    alpha: clamp(num(c.alpha, 1), 0, 1),
    flip: flip && (flip.x || flip.y) ? flip : null,
  };
}

/** Payload por kind: shape mínimo validado, tamaño capeado. Los bins jamás
 *  van aquí (solo URLs públicas de Storage). Texto = estilado por rangos. */
export function validateMaterialPayload(kind: VideoMaterialKind, raw: unknown): Record<string, unknown> {
  if (raw === undefined || raw === null) throw err("PAYLOAD_INVALID", `payload es requerido para kind=${kind}.`);
  if (typeof raw !== "object" || Array.isArray(raw)) throw err("PAYLOAD_INVALID", "payload debe ser un objeto.");
  const payload = raw as Record<string, unknown>;

  const size = JSON.stringify(payload).length;
  if (size > VIDEO_LIMITS.payloadBytes) {
    throw err("PAYLOAD_TOO_LARGE", `payload supera ${VIDEO_LIMITS.payloadBytes} bytes (${size}). Los binarios van a Storage; aquí solo metadata.`);
  }

  if (kind === "video" || kind === "image" || kind === "audio") {
    const url = String(payload.url ?? "");
    if (!/^(https?:\/\/|\/)/.test(url)) throw err("PAYLOAD_INVALID", `payload.url es requerido (http(s) o ruta) para kind=${kind}.`);
    if (payload.durationUs !== undefined) validateUsInt(payload.durationUs, "payload.durationUs", 0);
  }
  if (kind === "text") {
    const text = payload.text;
    if (typeof text !== "string" || !text.trim()) throw err("PAYLOAD_INVALID", "payload.text es requerido para kind=text.");
    if (text.length > VIDEO_LIMITS.maxTextLen) throw err("PAYLOAD_INVALID", `payload.text supera ${VIDEO_LIMITS.maxTextLen} caracteres.`);
    // Estilado por RANGOS de caracteres (gotcha CapCut: nada de blobs).
    if (payload.ranges !== undefined) {
      if (!Array.isArray(payload.ranges)) throw err("PAYLOAD_INVALID", "payload.ranges debe ser un array de {start, end, style}.");
      for (const r of payload.ranges as Array<Record<string, unknown>>) {
        if (typeof r !== "object" || r === null) throw err("PAYLOAD_INVALID", "payload.ranges[] inválido.");
        validateUsInt(r.start as number, "ranges[].start", 0);
        validateUsInt(r.end as number, "ranges[].end", 1);
        if (Number(r.end) <= Number(r.start)) throw err("PAYLOAD_INVALID", "ranges[].end debe ser > start.");
        if (r.style !== undefined && (typeof r.style !== "object" || r.style === null)) throw err("PAYLOAD_INVALID", "ranges[].style debe ser un objeto.");
      }
    }
  }
  return payload;
}

/** Efectos builtin fase 1 (VID14): sin shader — el manifest es el contrato
 *  estilo lumi {name, type, zorder, scriptPath?, resources}. El player/render
 *  los consume cuando exista el pase standalone; por ahora viajan como
 *  companion material y quedan descritos para la IA. */
export const BUILTIN_VIDEO_EFFECTS: Array<{
  id: string; label: string; type: string; zorder: number;
  params: Record<string, { type: string; description: string }>;
}> = [
  {
    id: "fx-overlay", label: "Overlay de color/gradiente", type: "ScriptInfoSticker", zorder: 60,
    params: {
      color: { type: "string", description: "CSS color del overlay (default rgba(0,0,0,0.35))" },
      blend: { type: "string", description: "normal | multiply | screen | overlay (default normal)" },
    },
  },
  {
    id: "fx-lut", label: "Filtro LUT (CSS filter)", type: "AmazingFeature", zorder: 55,
    params: {
      css: { type: "string", description: "Filtro CSS, ej: saturate(1.2) contrast(1.1)" },
    },
  },
  {
    id: "fx-text-anim", label: "Texto animado (caption)", type: "InfoSticker", zorder: 70,
    params: {
      text: { type: "string", description: "Contenido del caption animado" },
      anim: { type: "string", description: "fade | slide-up | pop | typewriter (default fade)" },
      style: { type: "object", description: "Estilos CSS del texto (color, fontSize 0.04..0.28, fontWeight 100..900)" },
    },
  },
  {
    id: "fx-sticker-kf", label: "Sticker con keyframes", type: "ScriptInfoSticker", zorder: 65,
    params: {
      url: { type: "string", description: "URL pública del sticker (png/webp)" },
      keyframes: { type: "array", description: "[{tUs, x, y, scale, rotation, alpha}] — transform por tiempo" },
    },
  },
];

export function builtinEffectById(effectId: string) {
  return BUILTIN_VIDEO_EFFECTS.find((e) => e.id === effectId) || null;
}

/** Resuelve el input de video_effect_apply a un payload de material kind=effect:
 *  effectId builtin | manifest crudo estilo lumi. */
export function resolveEffectPayload(effectId: unknown, manifest: unknown, params: unknown): Record<string, unknown> {
  const cleanParams = params !== undefined && params !== null && typeof params === "object" && !Array.isArray(params)
    ? (params as Record<string, unknown>)
    : {};
  if (typeof effectId === "string" && effectId) {
    const builtin = builtinEffectById(effectId);
    if (!builtin) {
      throw err("EFFECT_UNKNOWN", `Efecto desconocido: ${effectId}. Builtin: ${BUILTIN_VIDEO_EFFECTS.map((e) => e.id).join(", ")}. O pasa un manifest {name,type,zorder} estilo lumi.`);
    }
    return { manifest: { name: builtin.id, type: builtin.type, zorder: builtin.zorder }, params: cleanParams, builtin: true };
  }
  if (manifest && typeof manifest === "object" && !Array.isArray(manifest)) {
    const m = manifest as Record<string, unknown>;
    if (typeof m.name !== "string" || !m.name.trim() || typeof m.type !== "string" || !m.type.trim()) {
      throw err("EFFECT_MANIFEST_INVALID", "manifest requiere {name, type} (estilo lumi: scriptPath/zorder/resources opcionales).");
    }
    if (JSON.stringify(m).length > 8_192) throw err("EFFECT_MANIFEST_INVALID", "manifest supera 8KB.");
    return { manifest: m, params: cleanParams, builtin: false };
  }
  throw err("EFFECT_TARGET_INVALID", "Pasa effectId (builtin: fx-overlay, fx-lut, fx-text-anim, fx-sticker-kf) o manifest {name, type}.");
}

// ── Store ───────────────────────────────────────────────────────────────────

const newId = (prefix: string) => `${prefix}${randomBytes(6).toString("hex")}`;

/** Id explícito opcional (REQ-VID11): el undo de un delete re-crea la MISMA
 *  fila con el id original del journal. Acepta prefijo + 6..40 chars
 *  [A-Za-z0-9_-] o genera uno nuevo con newId. */
function resolveExplicitId(rawId: unknown, prefix: string): string {
  if (rawId === undefined || rawId === null || rawId === "") return newId(prefix);
  const id = String(rawId);
  if (!id.startsWith(prefix) || !new RegExp(`^${prefix}[A-Za-z0-9_-]{6,40}$`).test(id)) {
    throw err("ID_INVALID", `id debe respetar ${prefix}<6..40 chars> o omitirse (recibido: ${id.slice(0, 48)}).`);
  }
  return id;
}

function sbClient() {
  const sb = getSupabaseAdmin();
  if (!sb) throw err("SUPABASE_NOT_CONFIGURED", "Video requiere Supabase (service role) en este entorno.", 503);
  return sb;
}

async function getProjectRow(projectId: string): Promise<VideoProjectRow> {
  const { data, error } = await sbClient()
    .from("musa_video_projects").select("*").eq("id", projectId).maybeSingle();
  if (error) throw err("STORAGE", `Lectura de project falló: ${error.message}`, 503);
  if (!data) throw err("NOT_FOUND", `Video project not found: ${projectId}`, 404);
  return data as VideoProjectRow;
}

async function getMaterialRow(projectId: string, materialId: string): Promise<VideoMaterialRow> {
  const { data, error } = await sbClient()
    .from("musa_video_materials").select("*").eq("id", materialId).maybeSingle();
  if (error) throw err("STORAGE", `Lectura de material falló: ${error.message}`, 503);
  if (!data || data.project_id !== projectId) {
    throw err("REF_FOREIGN_PROJECT", `Material ${materialId} no existe en el project ${projectId} — extra_refs y material_id apuntan SIEMPRE al mismo project.`);
  }
  return data as VideoMaterialRow;
}

/** Segmento + su track, verificado contra el project (anti cross-tenant). */
async function getSegmentInProject(projectId: string, segmentId: string): Promise<{ segment: VideoSegmentRow; track: VideoTrackRow }> {
  const sb = sbClient();
  const { data: segment, error } = await sb
    .from("musa_video_segments").select("*").eq("id", segmentId).maybeSingle();
  if (error) throw err("STORAGE", `Lectura de segment falló: ${error.message}`, 503);
  if (!segment) throw err("NOT_FOUND", `Segment not found: ${segmentId}`, 404);
  const { data: track, error: trackErr } = await sb
    .from("musa_video_tracks").select("*").eq("id", (segment as VideoSegmentRow).track_id).maybeSingle();
  if (trackErr || !track || (track as VideoTrackRow).project_id !== projectId) {
    throw err("REF_FOREIGN_PROJECT", `Segment ${segmentId} no pertenece al project ${projectId}.`);
  }
  return { segment: segment as VideoSegmentRow, track: track as VideoTrackRow };
}

/** duration_us del project = max(target_start + target_dur) de sus segments. */
export function projectDurationUs(segments: Array<Pick<VideoSegmentRow, "target_start_us" | "target_dur_us">>): number {
  return segments.reduce((max, s) => Math.max(max, s.target_start_us + s.target_dur_us), 0);
}

async function touchProject(projectId: string, patch: Record<string, unknown> = {}) {
  const sb = sbClient();
  const { error } = await sb
    .from("musa_video_projects")
    .update({ updated_at: new Date().toISOString(), ...patch })
    .eq("id", projectId);
  if (error) throw err("STORAGE", `Update de project falló: ${error.message}`, 503);
}

/** Recalcula duration_us del project desde sus segments (post-mutación). */
async function recomputeProjectDuration(projectId: string): Promise<number> {
  const sb = sbClient();
  const { data: tracks } = await sb.from("musa_video_tracks").select("id").eq("project_id", projectId);
  const ids = (tracks || []).map((t: any) => t.id);
  let duration = 0;
  if (ids.length > 0) {
    const { data: segs } = await sb
      .from("musa_video_segments")
      .select("target_start_us, target_dur_us")
      .in("track_id", ids);
    duration = projectDurationUs((segs || []) as any);
  }
  await touchProject(projectId, { duration_us: duration });
  return duration;
}

// ── Projects ────────────────────────────────────────────────────────────────

export async function createVideoProject(
  workspaceId: string,
  input: { name: string; fps?: number; canvasW?: number; canvasH?: number; ratio?: string; durationUs?: number },
  author = "user",
): Promise<VideoProjectRow> {
  const sb = sbClient();
  const name = String(input.name ?? "").trim().slice(0, VIDEO_LIMITS.maxNameLen);
  if (!name) throw err("NAME_REQUIRED", "name es requerido (1-120 caracteres).");
  const fps = Math.min(60, Math.max(1, Math.round(Number(input.fps) || 30)));
  const canvasW = Math.min(8192, Math.max(16, Math.round(Number(input.canvasW) || 1080)));
  const canvasH = Math.min(8192, Math.max(16, Math.round(Number(input.canvasH) || 1920)));
  const ratio = String(input.ratio ?? (canvasW >= canvasH ? "16:9" : "9:16")).slice(0, 12);
  const row = {
    id: newId("vidproj_"),
    workspace_id: workspaceId,
    name,
    duration_us: input.durationUs !== undefined ? validateUsInt(input.durationUs, "durationUs", 0) : 0,
    fps,
    canvas_w: canvasW,
    canvas_h: canvasH,
    ratio,
    is_template: false,
    created_by: author === "user" || author.startsWith("ai:") ? author : "user",
  };
  const { data, error } = await sb.from("musa_video_projects").insert(row).select().single();
  if (error) throw err("STORAGE", `Insert de project falló: ${error.message}`, 503);
  return data as VideoProjectRow;
}

export async function listVideoProjects(workspaceId: string, opts: { templatesOnly?: boolean } = {}): Promise<VideoProjectRow[]> {
  const sb = sbClient();
  let q = sb.from("musa_video_projects").select("*").eq("workspace_id", workspaceId);
  if (opts.templatesOnly) q = q.eq("is_template", true);
  const { data, error } = await q.order("updated_at", { ascending: false }).limit(200);
  if (error) throw err("STORAGE", `List de projects falló: ${error.message}`, 503);
  return (data || []) as VideoProjectRow[];
}

export async function getVideoProjectTree(projectId: string): Promise<VideoProjectTree | null> {
  const sb = sbClient();
  const { data: project } = await sb.from("musa_video_projects").select("*").eq("id", projectId).maybeSingle();
  if (!project) return null;
  const [{ data: tracks }, { data: materials }] = await Promise.all([
    sb.from("musa_video_tracks").select("*").eq("project_id", projectId).order("z_order", { ascending: true }),
    sb.from("musa_video_materials").select("*").eq("project_id", projectId),
  ]);
  const trackRows = (tracks || []) as VideoTrackRow[];
  let segments: VideoSegmentRow[] = [];
  if (trackRows.length > 0) {
    const { data: segs } = await sb
      .from("musa_video_segments")
      .select("*")
      .in("track_id", trackRows.map((t) => t.id))
      .order("target_start_us", { ascending: true });
    segments = (segs || []) as VideoSegmentRow[];
  }
  return {
    project: project as VideoProjectRow,
    tracks: trackRows.map((t) => ({ ...t, segments: segments.filter((s) => s.track_id === t.id) })),
    materials: (materials || []) as VideoMaterialRow[],
  };
}

export async function deleteVideoProject(projectId: string): Promise<boolean> {
  const sb = sbClient();
  const { data, error } = await sb.from("musa_video_projects").delete().eq("id", projectId).select("id");
  if (error) throw err("STORAGE", `Delete de project falló: ${error.message}`, 503);
  return (data || []).length > 0;
}

// ── Tracks ──────────────────────────────────────────────────────────────────

export async function addVideoTrack(
  projectId: string,
  input: { type: string; zOrder?: number; id?: unknown },
): Promise<VideoTrackRow> {
  const project = await getProjectRow(projectId);
  void project;
  const sb = sbClient();
  const type = String(input.type ?? "");
  if (!VIDEO_TRACK_TYPES.includes(type as any)) {
    throw err("TRACK_TYPE_INVALID", `type debe ser uno de: ${VIDEO_TRACK_TYPES.join(" | ")} (recibido: ${type}).`);
  }
  const { count } = await sb.from("musa_video_tracks").select("id", { count: "exact", head: true }).eq("project_id", projectId);
  if ((count ?? 0) >= VIDEO_LIMITS.maxTracksPerProject) {
    throw err("TRACKS_LIMIT", `El project ya tiene ${count} tracks (cap ${VIDEO_LIMITS.maxTracksPerProject}).`);
  }
  const zOrder = Number.isFinite(Number(input.zOrder)) ? Math.round(Number(input.zOrder)) : (count ?? 0);
  const { data, error } = await sb
    .from("musa_video_tracks")
    .insert({ id: resolveExplicitId(input.id, "vidtrk_"), project_id: projectId, type, z_order: zOrder })
    .select().single();
  if (error) throw err("STORAGE", `Insert de track falló: ${error.message}`, 503);
  await touchProject(projectId);
  return data as VideoTrackRow;
}

export async function deleteVideoTrack(projectId: string, trackId: string): Promise<boolean> {
  const sb = sbClient();
  const { data: track } = await sb.from("musa_video_tracks").select("id, project_id").eq("id", trackId).maybeSingle();
  if (!track || (track as any).project_id !== projectId) throw err("NOT_FOUND", `Track not found in project: ${trackId}`, 404);
  const { error } = await sb.from("musa_video_tracks").delete().eq("id", trackId);
  if (error) throw err("STORAGE", `Delete de track falló: ${error.message}`, 503);
  await recomputeProjectDuration(projectId);
  return true;
}

// ── Materials ───────────────────────────────────────────────────────────────

export async function addVideoMaterial(
  projectId: string,
  input: { kind: string; payload: unknown; slot?: unknown; id?: unknown },
  author = "user",
): Promise<VideoMaterialRow> {
  void author;
  await getProjectRow(projectId);
  const sb = sbClient();
  const kind = String(input.kind ?? "") as VideoMaterialKind;
  if (!VIDEO_MATERIAL_KINDS.includes(kind)) {
    throw err("KIND_INVALID", `kind debe ser uno de: ${VIDEO_MATERIAL_KINDS.join(" | ")} (recibido: ${input.kind}).`);
  }
  const payload = validateMaterialPayload(kind, input.payload);
  const { count } = await sb.from("musa_video_materials").select("id", { count: "exact", head: true }).eq("project_id", projectId);
  if ((count ?? 0) >= VIDEO_LIMITS.maxMaterialsPerProject) {
    throw err("MATERIALS_LIMIT", `El project ya tiene ${count} materials (cap ${VIDEO_LIMITS.maxMaterialsPerProject}).`);
  }
  let slot: { key: string; label?: string } | null = null;
  if (input.slot !== undefined && input.slot !== null) {
    slot = validateSlotMarker(input.slot);
  }
  const { data, error } = await sb
    .from("musa_video_materials")
    .insert({ id: resolveExplicitId(input.id, "vidmat_"), project_id: projectId, kind, payload, slot })
    .select().single();
  if (error) throw err("STORAGE", `Insert de material falló: ${error.message}`, 503);
  await touchProject(projectId);
  return data as VideoMaterialRow;
}

export async function deleteVideoMaterial(projectId: string, materialId: string): Promise<boolean> {
  const sb = sbClient();
  await getMaterialRow(projectId, materialId); // 404 si no es del project
  const { error } = await sb.from("musa_video_materials").delete().eq("id", materialId);
  if (error) throw err("STORAGE", `Delete de material falló: ${error.message}`, 503);
  // Limpia extra_refs colgantes: los companions van por referencia; un ref
  // roto crashea el render igual que en CapCut.
  const { data: tracks } = await sb.from("musa_video_tracks").select("id").eq("project_id", projectId);
  const ids = (tracks || []).map((t: any) => t.id);
  if (ids.length > 0) {
    const { data: segs } = await sb.from("musa_video_segments").select("id, extra_refs").in("track_id", ids);
    for (const s of (segs || []) as Array<{ id: string; extra_refs: string[] }>) {
      if (Array.isArray(s.extra_refs) && s.extra_refs.includes(materialId)) {
        await sb.from("musa_video_segments").update({ extra_refs: s.extra_refs.filter((r) => r !== materialId) }).eq("id", s.id);
      }
    }
  }
  await touchProject(projectId);
  return true;
}

/** PATCH de payload de un material (VID12: el estilo del texto se edita sin
 *  recrear el material ni romper los segments que lo referencian). Re-valida
 *  con el MISMO shape por kind; id/slot/kind son inmutables por acá. Los
 *  companions kind=effect se administran con video_effect_apply/delete. */
export async function updateVideoMaterial(
  projectId: string,
  materialId: string,
  input: { payload?: unknown },
): Promise<VideoMaterialRow> {
  const existing = await getMaterialRow(projectId, materialId);
  if (existing.kind === "effect") {
    throw err("MATERIAL_IMMUTABLE", "Los materials kind=effect se administran con video_effect_apply/delete — el payload del companion no se edita directo.");
  }
  if (input.payload === undefined || input.payload === null) {
    throw err("PAYLOAD_INVALID", "payload es requerido.");
  }
  const payload = validateMaterialPayload(existing.kind, input.payload);
  const sb = sbClient();
  const { data, error } = await sb
    .from("musa_video_materials")
    .update({ payload })
    .eq("id", materialId)
    .select().single();
  if (error) throw err("STORAGE", `Update de material falló: ${error.message}`, 503);
  await touchProject(projectId);
  return data as VideoMaterialRow;
}

// ── Segmentos ───────────────────────────────────────────────────────────────

/** Slots de template (VID13): marcador en material de video/text/audio. */
export function validateSlotMarker(raw: unknown): { key: string; label?: string } {
  if (typeof raw !== "object" || raw === null) throw err("SLOT_INVALID", "slot debe ser {key, label?}.");
  const s = raw as Record<string, unknown>;
  const key = String(s.key ?? "").trim();
  if (!/^[a-z0-9_]{1,40}$/.test(key)) throw err("SLOT_INVALID", `slot.key debe ser snake_case 1-40 chars (recibido: ${key}).`);
  return { key, ...(s.label !== undefined ? { label: String(s.label).slice(0, 80) } : {}) };
}

export async function addVideoSegment(
  input: {
    projectId: string; trackId: string; materialId: string;
    targetStartUs?: number; targetDurUs?: number;
    sourceStartUs?: number; sourceDurUs?: number;
    speed?: number; clip?: unknown; extraRefs?: string[]; id?: unknown;
  },
): Promise<VideoSegmentRow> {
  await getProjectRow(input.projectId);
  const sb = sbClient();
  const { data: track, error: trackErr } = await sb.from("musa_video_tracks").select("*").eq("id", input.trackId).maybeSingle();
  if (trackErr || !track || (track as VideoTrackRow).project_id !== input.projectId) {
    throw err("NOT_FOUND", `Track ${input.trackId} no existe en el project ${input.projectId}.`, 404);
  }
  const trackRow = track as VideoTrackRow;
  const material = await getMaterialRow(input.projectId, input.materialId);

  // ── Regla dura de CapCut: audio ⇒ clip null ──
  const isAudio = trackRow.type === "audio" || material.kind === "audio";
  let clip: ClipTransform | null = null;
  if (isAudio) {
    if (input.clip !== undefined && input.clip !== null) {
      throw err("AUDIO_CLIP_FORBIDDEN", "Regla CapCut: un segmento de audio lleva clip:null — un clip object en audio crashea. Pasa clip solo en tracks de video/text/sticker.");
    }
  } else {
    clip = normalizeClipTransform(input.clip);
  }

  const speed = validateSpeed(input.speed);
  const sourceStart = input.sourceStartUs !== undefined && input.sourceStartUs !== null
    ? validateUsInt(input.sourceStartUs, "sourceStartUs", 0)
    : 0;

  // Duración del source real (si el material la declara) para clampear trim.
  const materialDurUs = typeof material.payload?.durationUs === "number"
    ? validateUsInt(material.payload.durationUs, "payload.durationUs", 0)
    : null;

  let targetStart: number;
  let targetDur: number;
  let sourceDur: number;

  if (input.targetDurUs !== undefined && input.targetDurUs !== null && input.sourceDurUs !== undefined && input.sourceDurUs !== null) {
    // Ambos explícitos → se exige la regla de oro (±1 µs de redondeo).
    targetDur = validateDurUs(input.targetDurUs, "targetDurUs");
    sourceDur = validateDurUs(input.sourceDurUs, "sourceDurUs");
    const expected = sourceDurForTarget(targetDur, speed);
    if (Math.abs(sourceDur - expected) > 1) {
      throw err("SPEED_MISMATCH", `Regla de oro CapCut violada: source_dur_us (${sourceDur}) ≠ round(target_dur_us × speed) (${expected}) con speed=${speed}. Ajusta uno de los dos o pasa speed.`);
    }
  } else if (input.sourceDurUs !== undefined && input.sourceDurUs !== null) {
    sourceDur = validateDurUs(input.sourceDurUs, "sourceDurUs");
    targetDur = targetDurForSource(sourceDur, speed);
  } else if (input.targetDurUs !== undefined && input.targetDurUs !== null) {
    targetDur = validateDurUs(input.targetDurUs, "targetDurUs");
    sourceDur = sourceDurForTarget(targetDur, speed);
  } else if (materialDurUs !== null) {
    // Ni target ni source: el clip entra completo (duración del material).
    sourceDur = Math.max(1, materialDurUs - sourceStart);
    targetDur = targetDurForSource(sourceDur, speed);
  } else {
    // Sin media conocida (texto/sticker): ventana default.
    targetDur = VIDEO_LIMITS.defaultTargetDurUs;
    sourceDur = sourceDurForTarget(targetDur, speed);
  }

  // Clamp CapCut: el trim NUNCA pasa el fin del source.
  if (materialDurUs !== null && sourceStart + sourceDur > materialDurUs) {
    sourceDur = Math.max(1, materialDurUs - sourceStart);
    targetDur = targetDurForSource(sourceDur, speed);
  }

  // extra_refs: companions del MISMO project (integridad en el servicio).
  const extraRefs: string[] = [];
  if (Array.isArray(input.extraRefs) && input.extraRefs.length > 0) {
    if (input.extraRefs.length > VIDEO_LIMITS.maxRefsPerSegment) {
      throw err("REFS_LIMIT", `extraRefs supera el cap de ${VIDEO_LIMITS.maxRefsPerSegment}.`);
    }
    for (const ref of input.extraRefs) {
      await getMaterialRow(input.projectId, String(ref));
      if (!extraRefs.includes(String(ref))) extraRefs.push(String(ref));
    }
  }

  targetStart = input.targetStartUs !== undefined && input.targetStartUs !== null
    ? validateUsInt(input.targetStartUs, "targetStartUs", 0)
    : 0;

  const { data, error } = await sb
    .from("musa_video_segments")
    .insert({
      id: resolveExplicitId(input.id, "vidseg_"),
      track_id: input.trackId,
      material_id: input.materialId,
      target_start_us: targetStart,
      target_dur_us: targetDur,
      source_start_us: materialDurUs !== null || input.sourceStartUs !== undefined ? sourceStart : null,
      source_dur_us: sourceDur,
      speed,
      clip,
      extra_refs: extraRefs,
    })
    .select().single();
  if (error) throw err("STORAGE", `Insert de segment falló: ${error.message}`, 503);
  await recomputeProjectDuration(input.projectId);
  return data as VideoSegmentRow;
}

export async function moveVideoSegment(projectId: string, segmentId: string, targetStartUs: number): Promise<VideoSegmentRow> {
  const start = validateUsInt(targetStartUs, "targetStartUs", 0);
  await getSegmentInProject(projectId, segmentId); // existe y es del project
  const sb = sbClient();
  const { data, error } = await sb
    .from("musa_video_segments")
    .update({ target_start_us: start })
    .eq("id", segmentId)
    .select().single();
  if (error) throw err("STORAGE", `Move de segment falló: ${error.message}`, 503);
  await recomputeProjectDuration(projectId);
  return data as VideoSegmentRow;
}

/** Trim: recalcula source y re-deriva target vía speed. Clamp al fin del
 *  material — CapCut nunca deja que el trim pase el fin del source. */
export async function trimVideoSegment(
  projectId: string,
  segmentId: string,
  input: { sourceStartUs?: number; sourceDurUs?: number },
): Promise<VideoSegmentRow> {
  const { segment } = await getSegmentInProject(projectId, segmentId);
  const material = await getMaterialRow(projectId, segment.material_id);
  const materialDurUs = typeof material.payload?.durationUs === "number"
    ? validateUsInt(material.payload.durationUs, "payload.durationUs", 0)
    : null;

  let sourceStart = input.sourceStartUs !== undefined && input.sourceStartUs !== null
    ? validateUsInt(input.sourceStartUs, "sourceStartUs", 0)
    : (segment.source_start_us ?? 0);
  let sourceDur = input.sourceDurUs !== undefined && input.sourceDurUs !== null
    ? validateDurUs(input.sourceDurUs, "sourceDurUs")
    : (segment.source_dur_us ?? segment.target_dur_us);

  if (materialDurUs !== null) {
    if (sourceStart >= materialDurUs) {
      throw err("TRIM_PAST_SOURCE", `sourceStartUs (${sourceStart}) pasa el fin del material (${materialDurUs} µs) — CapCut clampea el trim al source.`);
    }
    if (sourceStart + sourceDur > materialDurUs) {
      sourceDur = materialDurUs - sourceStart; // clamp, no error
    }
  }

  const targetDur = targetDurForSource(sourceDur, segment.speed);
  const sb = sbClient();
  const { data, error } = await sb
    .from("musa_video_segments")
    .update({ source_start_us: sourceStart, source_dur_us: sourceDur, target_dur_us: targetDur })
    .eq("id", segmentId)
    .select().single();
  if (error) throw err("STORAGE", `Trim de segment falló: ${error.message}`, 503);
  await recomputeProjectDuration(projectId);
  return data as VideoSegmentRow;
}

/** Speed (VID12): mantiene el source físico — materializando nulls con la
 *  speed VIEJA, igual que el cliente — y re-deriva target_dur con la nueva
 *  (regla de oro CapCut: target = round(source / speed)). */
export async function setSegmentSpeed(projectId: string, segmentId: string, speed: unknown): Promise<VideoSegmentRow> {
  const v = validateSpeed(speed);
  const { segment } = await getSegmentInProject(projectId, segmentId);
  const oldSpeed = segment.speed > 0 ? segment.speed : 1;
  const sourceDur = segment.source_dur_us ?? Math.max(1, Math.round(segment.target_dur_us * oldSpeed));
  const targetDur = targetDurForSource(sourceDur, v);
  const sb = sbClient();
  const { data, error } = await sb
    .from("musa_video_segments")
    .update({ speed: v, target_dur_us: targetDur })
    .eq("id", segmentId)
    .select().single();
  if (error) throw err("STORAGE", `Speed de segment falló: ${error.message}`, 503);
  await recomputeProjectDuration(projectId);
  return data as VideoSegmentRow;
}

/** Transform del clip (x/y/scale/rotation/alpha/flip). Audio ⇒ prohibido. */
export async function transformVideoSegment(projectId: string, segmentId: string, clip: unknown): Promise<VideoSegmentRow> {
  const { segment, track } = await getSegmentInProject(projectId, segmentId);
  const material = await getMaterialRow(projectId, segment.material_id);
  if (track.type === "audio" || material.kind === "audio") {
    throw err("AUDIO_CLIP_FORBIDDEN", "Regla CapCut: un segmento de audio lleva clip:null — no acepta transform.");
  }
  const normalized = normalizeClipTransform(clip);
  const sb = sbClient();
  const { data, error } = await sb
    .from("musa_video_segments")
    .update({ clip: normalized })
    .eq("id", segmentId)
    .select().single();
  if (error) throw err("STORAGE", `Transform de segment falló: ${error.message}`, 503);
  return data as VideoSegmentRow;
}

export async function deleteVideoSegment(projectId: string, segmentId: string): Promise<boolean> {
  await getSegmentInProject(projectId, segmentId);
  const sb = sbClient();
  const { error } = await sb.from("musa_video_segments").delete().eq("id", segmentId);
  if (error) throw err("STORAGE", `Delete de segment falló: ${error.message}`, 503);
  await recomputeProjectDuration(projectId);
  return true;
}

// ── Efectos (VID14, companion por referencia) ───────────────────────────────

/** Crea UN material kind=effect y lo agrega a extra_refs de los segments
 *  objetivo (segmentId, o trackId = todos los segments de la pista — un
 *  solo companion compartido, como CapCut). */
export async function applyVideoEffect(
  projectId: string,
  input: { segmentId?: string; trackId?: string; effectId?: string; manifest?: unknown; params?: unknown },
  author = "user",
): Promise<{ material: VideoMaterialRow; appliedTo: string[] }> {
  void author;
  await getProjectRow(projectId);
  const payload = resolveEffectPayload(input.effectId, input.manifest, input.params);

  const sb = sbClient();
  let targetSegmentIds: string[] = [];
  if (input.segmentId) {
    await getSegmentInProject(projectId, input.segmentId);
    targetSegmentIds = [input.segmentId];
  } else if (input.trackId) {
    const { data: track } = await sb.from("musa_video_tracks").select("id, project_id").eq("id", input.trackId).maybeSingle();
    if (!track || (track as any).project_id !== projectId) throw err("NOT_FOUND", `Track not found in project: ${input.trackId}`, 404);
    const { data: segs } = await sb.from("musa_video_segments").select("id").eq("track_id", input.trackId);
    targetSegmentIds = ((segs || []) as Array<{ id: string }>).map((s) => s.id);
    if (targetSegmentIds.length === 0) {
      throw err("EFFECT_TARGET_INVALID", `El track ${input.trackId} no tiene segments — agrega clips primero o apunta a un segmentId.`);
    }
  } else {
    throw err("EFFECT_TARGET_INVALID", "Indica segmentId o trackId — el efecto viaja como companion en extra_refs del segment.");
  }

  const material = await addVideoMaterial(projectId, { kind: "effect", payload });

  for (const segId of targetSegmentIds) {
    const { data: seg } = await sb.from("musa_video_segments").select("id, extra_refs").eq("id", segId).maybeSingle();
    const refs = Array.isArray((seg as any)?.extra_refs) ? [...((seg as any).extra_refs as string[])] : [];
    if (!refs.includes(material.id)) refs.push(material.id);
    if (refs.length > VIDEO_LIMITS.maxRefsPerSegment) {
      throw err("REFS_LIMIT", `El segment ${segId} supera ${VIDEO_LIMITS.maxRefsPerSegment} companions.`);
    }
    const { error } = await sb.from("musa_video_segments").update({ extra_refs: refs }).eq("id", segId);
    if (error) throw err("STORAGE", `No se pudo linkear el efecto al segment ${segId}: ${error.message}`, 503);
  }
  return { material, appliedTo: targetSegmentIds };
}

// ── Templates con slots (VID13) ─────────────────────────────────────────────

/** Registra el project como template: marca materials con slot {key,label} y
 *  flips is_template. Los slots viven en materials de video/text/audio. */
export async function registerVideoTemplate(
  projectId: string,
  slots: Array<{ materialId: string; key: string; label?: string }>,
): Promise<VideoProjectRow> {
  const project = await getProjectRow(projectId);
  void project;
  if (!Array.isArray(slots) || slots.length === 0) {
    throw err("SLOTS_REQUIRED", "slots es requerido: [{materialId, key, label?}] — al menos un placeholder.");
  }
  const seen = new Set<string>();
  for (const s of slots) {
    const marker = validateSlotMarker({ key: s.key, label: s.label });
    if (seen.has(marker.key)) throw err("SLOT_DUPLICATED", `slot.key duplicado: ${marker.key}.`);
    seen.add(marker.key);
    const material = await getMaterialRow(projectId, String(s.materialId));
    if (!["video", "text", "audio"].includes(material.kind)) {
      throw err("SLOT_KIND_INVALID", `El slot ${marker.key} apunta a un material kind=${material.kind} — solo video|text|audio son rellenables.`);
    }
  }
  const sb = sbClient();
  for (const s of slots) {
    const marker = validateSlotMarker({ key: s.key, label: s.label });
    const { error } = await sb.from("musa_video_materials").update({ slot: marker }).eq("id", s.materialId);
    if (error) throw err("STORAGE", `No se pudo marcar el slot en ${s.materialId}: ${error.message}`, 503);
  }
  await touchProject(projectId, { is_template: true });
  return getProjectRow(projectId);
}

/**
 * Instancia un template: clona project/tracks/materials/segments con ids
 * nuevos y RELLENA los slots con materiales nuevos del cliente. Reglas:
 *   • target se mantiene (el layout del diseño no cambia)…
 *   • … salvo que el nuevo material sea más corto: ahí se acorta el target
 *     (no se estira el source más allá del fin del material — clamp CapCut).
 *   • extra_refs se remapea vía el mapa de materials clonados.
 */
export async function instantiateVideoTemplate(
  templateProjectId: string,
  input: { name?: string; slots?: Record<string, { kind: string; payload: unknown }> },
  author = "user",
): Promise<VideoProjectTree> {
  const template = await getVideoProjectTree(templateProjectId);
  if (!template) throw err("NOT_FOUND", `Template project not found: ${templateProjectId}`, 404);
  if (!template.project.is_template) {
    throw err("NOT_TEMPLATE", `El project ${templateProjectId} no está registrado como template (video_template_register primero).`);
  }
  const slotMaterials = template.materials.filter((m) => m.slot);
  const fillers = input.slots && typeof input.slots === "object" ? input.slots : {};
  const missing = slotMaterials.filter((m) => !fillers[m.slot!.key]);
  if (missing.length > 0) {
    throw err("SLOTS_MISSING", `Faltan slots: ${missing.map((m) => m.slot!.key).join(", ")}. Cada slot espera {kind, payload}.`);
  }

  const sb = sbClient();
  const wsId = template.project.workspace_id;

  // 1) Project clonado.
  const cloneProject = await createVideoProject(wsId, {
    name: (input.name ?? "").trim() || `${template.project.name} — copia`,
    fps: template.project.fps,
    canvasW: template.project.canvas_w,
    canvasH: template.project.canvas_h,
    ratio: template.project.ratio,
  }, author);

  try {
    // 2) Tracks clonados (mismo z_order — el orden ES el z-order).
    const trackIdMap = new Map<string, string>();
    for (const t of template.tracks) {
      const clone = await addVideoTrack(cloneProject.id, { type: t.type, zOrder: t.z_order });
      trackIdMap.set(t.id, clone.id);
    }

    // 3) Materials clonados; los de slot se REEMPLAZAN por el filler.
    const materialIdMap = new Map<string, string>();
    for (const m of template.materials) {
      if (m.slot) {
        const filler = fillers[m.slot.key];
        const kind = String(filler.kind ?? "") as VideoMaterialKind;
        if (!["video", "text", "audio"].includes(kind)) {
          throw err("SLOT_KIND_INVALID", `slot ${m.slot.key}: kind debe ser video|text|audio (recibido: ${filler.kind}).`);
        }
        const newMat = await addVideoMaterial(cloneProject.id, { kind, payload: filler.payload }, author);
        materialIdMap.set(m.id, newMat.id);
      } else {
        const clone = await addVideoMaterial(cloneProject.id, { kind: m.kind, payload: m.payload }, author);
        materialIdMap.set(m.id, clone.id);
      }
    }

    // 4) Segmentos clonados con remapeo completo.
    const newDurationByMaterial = new Map<string, number | null>();
    for (const m of template.materials) {
      if (m.slot) {
        const filler = fillers[m.slot.key];
        newDurationByMaterial.set(m.id, typeof (filler.payload as any)?.durationUs === "number" ? (filler.payload as any).durationUs : null);
      } else {
        newDurationByMaterial.set(m.id, typeof m.payload?.durationUs === "number" ? (m.payload as any).durationUs : null);
      }
    }
    for (const t of template.tracks) {
      for (const s of t.segments) {
        const newMaterialId = materialIdMap.get(s.material_id);
        if (!newMaterialId) continue; // no debería pasar (FK lógica interna)
        const matDur = newDurationByMaterial.get(s.material_id) ?? null;
        let sourceStart = s.source_start_us ?? 0;
        let sourceDur = s.source_dur_us ?? s.target_dur_us;
        let targetDur = s.target_dur_us;
        // target se mantiene; clamp solo si el nuevo material es más corto.
        if (matDur !== null) {
          if (sourceStart >= matDur) { sourceStart = 0; sourceDur = matDur; }
          else if (sourceStart + sourceDur > matDur) { sourceDur = matDur - sourceStart; targetDur = targetDurForSource(sourceDur, s.speed); }
        }
        const extraRefs = (s.extra_refs || [])
          .map((r) => materialIdMap.get(r))
          .filter((r): r is string => Boolean(r));
        await addVideoSegment({
          projectId: cloneProject.id,
          trackId: trackIdMap.get(t.id)!,
          materialId: newMaterialId,
          targetStartUs: s.target_start_us,
          targetDurUs: targetDur,
          sourceStartUs: s.source_start_us !== null || matDur !== null ? sourceStart : undefined,
          sourceDurUs: sourceDur,
          speed: s.speed,
          clip: s.clip,
          extraRefs,
        });
      }
    }

    const tree = await getVideoProjectTree(cloneProject.id);
    if (!tree) throw err("STORAGE", "El clone no se pudo releer.", 503);
    return tree;
  } catch (cause) {
    // Best-effort: no dejar clones huérfanos a medio instanciar.
    try { await deleteVideoProject(cloneProject.id); } catch { /* noop */ }
    throw cause;
  }
}
