/**
 * REQ-059 (bloque D) — Mapeos puros de HeyGen API v3.
 *
 * Por qué vive en shared/: lo consumen los DOS lados sin duplicar contrato —
 * el proxy del worker (worker/runtime/functions/heygen.mjs, que importa .ts
 * igual que video-takes.mjs importa takeTtl.ts) y el cliente (src/lib/heygen.ts
 * / AiClonesTab). Además es 100% puro: node-testable con strip-types.
 *
 * Decisiones de diseño:
 *  - v3 SOLO. v1/v2 tienen sunset el 2026-10-31; no tiene sentido escribir
 *    contra endpoints que van a desaparecer en días.
 *  - Los normalizadores son TOLERANTES: HeyGen envuelve en { code, data } y
 *    los listas cambian de clave entre versiones (items/looks/voices/videos).
 *    Aceptar cualquiera evita que un rename upstream rompa la UI.
 *  - Los builders VALIDAN y lanzan códigos explícitos: el proxy traduce esos
 *    códigos a 400 con mensaje humano, nunca un 500 opaco.
 *
 * Honesty rules: ningún mapeo inventa créditos ni estados — si la respuesta
 * no trae `video_url` con status ready, la fase sigue `processing`.
 */

export const HEYGEN_API_BASE = "https://api.heygen.com";

/** Whitelist oficial de aspect_ratio en POST /v3/videos. */
export const HEYGEN_ASPECT_RATIOS = ["16:9", "9:16", "4:5", "5:4", "1:1", "auto"] as const;
export type HeygenAspect = (typeof HEYGEN_ASPECT_RATIOS)[number];

/** Formato del estudio de tomas → aspect_ratio equivalente de HeyGen. */
const FORMAT_TO_ASPECT: Record<string, HeygenAspect> = {
  vertical: "9:16",
  square: "1:1",
  portrait: "4:5",
  horizontal: "16:9",
};

export function aspectForTakeFormat(formatId: string | null | undefined): HeygenAspect {
  return FORMAT_TO_ASPECT[String(formatId || "")] || "16:9";
}

export function isHeygenAspect(value: unknown): value is HeygenAspect {
  return typeof value === "string" && (HEYGEN_ASPECT_RATIOS as readonly string[]).includes(value);
}

/** Errores de mapeo con código estable — el proxy los pasa a JSON tal cual. */
export class HeygenMapError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "HeygenMapError";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Quita el envoltorio { code, data } de HeyGen (v3 usa data; a veces trae el objeto plano). */
export function heygenData(payload: unknown): Record<string, unknown> {
  const root = asRecord(payload);
  const data = root.data;
  if (data && typeof data === "object") return Array.isArray(data) ? { items: data } : (data as Record<string, unknown>);
  return root;
}

/** Clave de lista más común en v3: items | looks | voices | videos | avatars. */
export function heygenList(payload: unknown, ...preferred: string[]): Record<string, unknown>[] {
  const root = heygenData(payload);
  const candidates = [...preferred, "items", "looks", "voices", "videos", "avatars", "results"];
  for (const key of candidates) {
    const value = root[key];
    if (Array.isArray(value)) return value.map(asRecord);
  }
  return [];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

function nullableStr(value: unknown): string | null {
  const s = str(value);
  return s ? s : null;
}

function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

// ── Cuentas (GET /v3/users/me) ──────────────────────────────────────────────

export interface HeygenAccountInfo {
  userId: string | null;
  email: string | null;
  plan: string | null;
  remainingCredits: number | null;
}

export function normalizeAccount(payload: unknown): HeygenAccountInfo {
  const d = heygenData(payload);
  const credits = asRecord(d.credits);
  return {
    userId: nullableStr(d.user_id ?? d.id),
    email: nullableStr(d.email),
    plan: nullableStr(d.plan ?? asRecord(d.subscription).plan ?? d.tier),
    remainingCredits: num(credits.remaining_credits ?? d.remaining_credits ?? d.credits),
  };
}

// ── Avatares (GET /v3/avatars/looks — el `id` es el avatar_id de /v3/videos) ─

export interface HeygenAvatarLook {
  id: string;
  name: string;
  avatarType: string | null;
  groupId: string | null;
  previewImageUrl: string | null;
  /** 'completed' | 'processing' | 'failed' | null (status de entrenamiento). */
  status: string | null;
  ready: boolean;
}

function toLook(row: Record<string, unknown>): HeygenAvatarLook {
  const status = nullableStr(row.status ?? row.state) || null;
  const normalized = status ? status.toLowerCase() : null;
  return {
    id: str(row.id ?? row.look_id ?? row.avatar_id),
    name: str(row.name ?? row.title) || "Sin nombre",
    avatarType: nullableStr(row.avatar_type ?? row.type),
    groupId: nullableStr(row.group_id ?? row.avatar_group_id),
    previewImageUrl: nullableStr(row.preview_image_url ?? row.preview_url),
    status: normalized,
    // Sin status conocido asumimos listo: los looks de catálogo no lo traen.
    ready: normalized === null || normalized === "completed" || normalized === "ready" || normalized === "success",
  };
}

export function normalizeAvatarLooks(payload: unknown): HeygenAvatarLook[] {
  return heygenList(payload, "looks", "avatars")
    .map(toLook)
    .filter(look => look.id);
}

// ── Voces (GET /v3/voices) ──────────────────────────────────────────────────

export interface HeygenVoice {
  voiceId: string;
  name: string;
  language: string | null;
  gender: string | null;
  previewAudioUrl: string | null;
}

export function normalizeVoices(payload: unknown): HeygenVoice[] {
  return heygenList(payload, "voices")
    .map(row => ({
      voiceId: str(row.voice_id ?? row.id),
      name: str(row.name) || "Sin nombre",
      language: nullableStr(row.language ?? row.language_code),
      gender: nullableStr(row.gender),
      previewAudioUrl: nullableStr(row.preview_audio_url ?? row.preview_url),
    }))
    .filter(voice => voice.voiceId);
}

// ── Videos (POST /v3/videos, GET /v3/videos/{id}) ───────────────────────────

export type HeygenVideoPhase = "queued" | "processing" | "ready" | "failed";

export interface HeygenVideoStatus {
  videoId: string | null;
  rawStatus: string | null;
  phase: HeygenVideoPhase;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  captionedVideoUrl: string | null;
  subtitleUrl: string | null;
  durationSec: number | null;
  progressPct: number | null;
  errorCode: string | null;
  errorMessage: string | null;
}

/** Estatus crudos posibles en v3 (enum oficial + sinónimos históricos). */
const READY_WORDS = ["completed", "success", "succeeded", "ready", "done"];
const FAILED_WORDS = ["failed", "error", "cancelled", "canceled", "rejected"];
const PROCESSING_WORDS = ["processing", "transforming", "rendering", "in_progress", "generating"];
const QUEUED_WORDS = ["pending", "queued", "waiting", "submitted", "created"];

export function videoPhaseOf(rawStatus: string | null | undefined): HeygenVideoPhase {
  const s = String(rawStatus || "").toLowerCase();
  if (!s) return "processing";
  if (READY_WORDS.includes(s)) return "ready";
  if (FAILED_WORDS.includes(s)) return "failed";
  if (QUEUED_WORDS.includes(s)) return "queued";
  if (PROCESSING_WORDS.includes(s)) return "processing";
  return "processing";
}

export function normalizeVideoStatus(payload: unknown): HeygenVideoStatus {
  const d = heygenData(payload);
  const raw = nullableStr(d.status ?? d.state);
  const phase = videoPhaseOf(raw);
  const error = asRecord(d.error);
  // La URL solo cuenta si HeyGen dijo que está listo — si llega antes, la UI
  // igual sigue en processing (no prometemos un render que no es).
  const videoUrl = nullableStr(d.video_url ?? d.videoUrl);
  return {
    videoId: nullableStr(d.video_id ?? d.id),
    rawStatus: raw,
    phase,
    // Solo exponemos la URL cuando HeyGen confirmó 'ready': antes no hay
    // archivo que reproducir, aunque la respuesta traiga un campo suelto.
    videoUrl: phase === "ready" ? videoUrl : null,
    thumbnailUrl: nullableStr(d.thumbnail_url),
    captionedVideoUrl: nullableStr(d.captioned_video_url),
    subtitleUrl: nullableStr(d.subtitle_url),
    durationSec: num(d.duration ?? d.duration_sec),
    progressPct: num(d.progress ?? d.percent ?? d.progress_percentage),
    errorCode: nullableStr(error.code ?? d.error_code),
    errorMessage: nullableStr(error.message ?? d.error_message ?? d.failure_reason),
  };
}

export interface HeygenVideoListItem {
  videoId: string;
  title: string;
  phase: HeygenVideoPhase;
  rawStatus: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  createdAt: string | null;
  durationSec: number | null;
}

export function normalizeVideoList(payload: unknown): HeygenVideoListItem[] {
  return heygenList(payload, "videos")
    .map(row => {
      const status = normalizeVideoStatus(row);
      return {
        videoId: status.videoId || str(row.video_id ?? row.id),
        title: str(row.title ?? row.name) || "Video",
        phase: status.phase,
        rawStatus: status.rawStatus,
        videoUrl: status.videoUrl,
        thumbnailUrl: status.thumbnailUrl,
        createdAt: nullableStr(row.created_at ?? row.createdAt),
        durationSec: status.durationSec,
      };
    })
    .filter(item => item.videoId);
}

// ── Builders de request (validan ANTES de gastar un crédito) ────────────────

export interface AvatarVideoInput {
  avatarId: string;
  script: string;
  aspectRatio?: string | null;
  voiceId?: string | null;
  title?: string | null;
  resolution?: string | null;
  outputFormat?: string | null;
}

/**
 * Body de POST /v3/videos (type: "avatar"). Se omite voice_id cuando no hay:
 * HeyGen cae a la voz del avatar, que es el comportamiento deseado para un
 * clon entrenado desde una toma propia.
 */
export function buildAvatarVideoBody(input: AvatarVideoInput): Record<string, unknown> {
  const avatarId = String(input.avatarId || "").trim();
  const script = String(input.script || "").trim();
  if (!avatarId) throw new HeygenMapError("HEYGEN_AVATAR_REQUIRED", "Elegí un clon antes de generar el video.");
  if (!script) throw new HeygenMapError("HEYGEN_SCRIPT_REQUIRED", "El guion está vacío: escribí o pegá el texto a locutar.");
  const aspect = input.aspectRatio ? String(input.aspectRatio).trim() : "";
  if (aspect && !isHeygenAspect(aspect)) {
    throw new HeygenMapError("HEYGEN_ASPECT_INVALID", `Aspect ratio no soportado (${aspect}).`);
  }
  const body: Record<string, unknown> = { type: "avatar", avatar_id: avatarId, script };
  if (aspect) body.aspect_ratio = aspect;
  const voiceId = String(input.voiceId || "").trim();
  if (voiceId) body.voice_id = voiceId;
  const title = String(input.title || "").trim();
  if (title) body.title = title.slice(0, 120);
  const resolution = String(input.resolution || "").trim();
  if (resolution) body.resolution = resolution;
  const outputFormat = String(input.outputFormat || "").trim();
  if (outputFormat === "mp4" || outputFormat === "webm") body.output_format = outputFormat;
  return body;
}

/**
 * Body de POST /v3/avatars (type: "digital_twin"): entrenar un clon a partir
 * de footage. `videoUrl` DEBE ser públicamente accesible — el proxy la firma
 * con TTL largo desde R2; si llegara vacía, fallamos acá y no contra HeyGen.
 */
export function buildDigitalTwinBody(input: { name: string; videoUrl: string }): Record<string, unknown> {
  const name = String(input.name || "").trim();
  const videoUrl = String(input.videoUrl || "").trim();
  if (!name) throw new HeygenMapError("HEYGEN_NAME_REQUIRED", "Ponele un nombre al clon.");
  if (!/^https?:\/\//i.test(videoUrl)) {
    throw new HeygenMapError("HEYGEN_SOURCE_URL_REQUIRED", "El video de origen no tiene una URL descargable pública.");
  }
  return { type: "digital_twin", name: name.slice(0, 80), file: { type: "url", url: videoUrl } };
}

// ── Errores de upstream → contrato estable del proxy ────────────────────────

export interface HeygenErrorPayload {
  error: string;
  message: string;
}

/**
 * HeyGen responde { error: { code, message } } (y a veces { detail }). El
 * cliente nunca ve la key ni headers: solo código estable + mensaje humano.
 */
export function heygenErrorPayload(status: number, body: unknown): HeygenErrorPayload {
  const root = asRecord(body);
  const err = asRecord(root.error);
  const upstreamCode = str(err.code ?? root.code ?? root.detail).toLowerCase();
  const upstreamMsg = str(err.message ?? root.message ?? root.detail);

  if (status === 401 || status === 403 || upstreamCode.includes("unauthorized") || upstreamCode.includes("forbidden")) {
    return { error: "HEYGEN_KEY_INVALID", message: "HeyGen rechazó tu API key (401/403). Revisala o pegá una vigente." };
  }
  if (status === 402 || upstreamCode.includes("credit") || upstreamCode.includes("quota") || upstreamCode.includes("payment")) {
    return { error: "HEYGEN_NO_CREDITS", message: "Tu cuenta de HeyGen se quedó sin créditos o el plan no habilita esta operación." };
  }
  if (status === 429 || upstreamCode.includes("rate")) {
    return { error: "HEYGEN_RATE_LIMITED", message: "HeyGen está limitando tus requests. Esperá un momento y reintentá." };
  }
  if (status === 404 || upstreamCode.includes("not_found")) {
    return { error: "HEYGEN_NOT_FOUND", message: upstreamMsg || "Ese recurso de HeyGen no existe (404)." };
  }
  if (upstreamCode.includes("download")) {
    return { error: "HEYGEN_DOWNLOAD_FAILED", message: "HeyGen no pudo descargar el video de origen. La toma pudo haber vencido (24 h): volvé a generar el enlace." };
  }
  if (status >= 500) {
    return { error: "HEYGEN_UPSTREAM", message: `HeyGen respondió ${status}. Intentá de nuevo en unos minutos.` };
  }
  return { error: upstreamCode ? `HEYGEN_${upstreamCode.slice(0, 32).toUpperCase()}` : "HEYGEN_UPSTREAM", message: upstreamMsg || `HeyGen respondió ${status}.` };
}

// ── Guiones generados con nuestro LLM (topic → 3 opciones) ──────────────────

export interface GeneratedScript {
  title: string;
  text: string;
  words: number;
  estSeconds: number;
}

export function countScriptWords(text: string): number {
  const t = String(text || "").trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Locución neutra en español: ~150 palabras por minuto. */
export const SCRIPT_WORDS_PER_MIN = 150;

export function scriptEstimateSeconds(words: number): number {
  return words > 0 ? Math.ceil((words / SCRIPT_WORDS_PER_MIN) * 60) : 0;
}

/**
 * Prompt para el rol leader: tres guiones distintos, JSON estricto. Se pide
 * JSON (y no prosa) para que parseScriptsResponse sea determinístico.
 */
export function buildScriptPrompt(topic: string, tone: string | null | undefined, maxSeconds: number): string {
  const cap = Math.min(180, Math.max(15, Math.round(maxSeconds || 45)));
  const toneText = String(tone || "").trim();
  return [
    "Eres guionista de videos hablados para redes. Tema del video: " + JSON.stringify(String(topic || "").trim()) + ".",
    toneText ? "Tono pedido: " + toneText + "." : "Tono: natural, profesional, sin emojis.",
    `Escribí TRES guiones alternativos en español neutro, cada uno para decirse en voz alta en máximo ${cap} segundos (≈${Math.round((cap / 60) * SCRIPT_WORDS_PER_MIN)} palabras).`,
    "Cada uno con un ángulo distinto (gancho narrativo, gancho de dato, gancho de pregunta). Sin acotaciones de cámara, sin markdown, solo lo que se dice.",
    'Respondé EXCLUSIVAMENTE un JSON válido de esta forma, sin texto alrededor: {"scripts":[{"title":"...","text":"..."}]}',
  ].join(" ");
}

/**
 * Extrae el JSON del texto del modelo (tolera cercas ```json y prosa alrededor).
 * Devuelve al menos 1 script o lanza HEYGEN_SCRIPTS_UNPARSEABLE — la UI muestra
 * el crudo en ese caso, nunca texto roto como si fuera un guion.
 */
export function parseScriptsResponse(raw: unknown): GeneratedScript[] {
  const text = extractTextFromLlmResponse(raw);
  const candidates: string[] = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1]);
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(text.slice(firstBrace, lastBrace + 1));
  const firstBracket = text.indexOf("[");
  const lastBracket = text.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket) candidates.push(text.slice(firstBracket, lastBracket + 1));

  const rows: Record<string, unknown>[] = [];
  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (Array.isArray(parsed)) rows.push(...parsed.map(asRecord));
    else if (parsed && typeof parsed === "object") {
      const list = (parsed as Record<string, unknown>).scripts ?? (parsed as Record<string, unknown>).guiones;
      if (Array.isArray(list)) rows.push(...list.map(asRecord));
      else rows.push(parsed as Record<string, unknown>);
    }
    if (rows.length) break;
  }

  const scripts: GeneratedScript[] = [];
  for (const row of rows) {
    const body = str(row.text ?? row.script ?? row.body ?? row.guion).trim();
    if (!body) continue;
    const words = countScriptWords(body);
    scripts.push({
      title: str(row.title ?? row.name ?? row.titulo).trim() || `Guion ${scripts.length + 1}`,
      text: body,
      words,
      estSeconds: scriptEstimateSeconds(words),
    });
  }

  if (!scripts.length) {
    throw new HeygenMapError("HEYGEN_SCRIPTS_UNPARSEABLE", "El modelo no devolvió guiones legibles. Reintentá o pegá tu propio guion.");
  }
  return scripts.slice(0, 6);
}

/** Saca el texto de un response Anthropic (content[]) u OpenAI (choices[]). */
export function extractTextFromLlmResponse(raw: unknown): string {
  const d = asRecord(raw);
  if (typeof d.text === "string") return d.text;
  const choices = d.choices;
  if (Array.isArray(choices) && choices.length) {
    const msg = asRecord(asRecord(choices[0]).message);
    const content = msg.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content.map(asRecord).map(b => str(b.text)).filter(Boolean).join("\n");
    }
  }
  const content = d.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(asRecord).map(b => (b.type === "text" || !b.type ? str(b.text) : "")).filter(Boolean).join("\n");
  }
  return "";
}
