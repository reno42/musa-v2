/**
 * REQ-063 — Mapeos puros de ElevenLabs API v1.
 *
 * Por qué vive en shared/: lo consumen los DOS lados sin duplicar contrato —
 * el proxy del worker (worker/runtime/functions/elevenlabs.mjs, que importa
 * .ts igual que heygen.mjs importa heygenMappers.ts) y el cliente
 * (src/lib/elevenlabs.ts). Es 100% puro: node-testable con strip-types.
 *
 * Decisiones de diseño:
 *  - Un proveedor, DOS capacidades: text-to-speech (voces) y speech-to-text
 *    (Scribe). La MISMA BYOK `elevenlabs` las habilita — el usuario carga
 *    una key, no dos.
 *  - Los normalizadores son TOLERANTES: ElevenLabs envuelve listas en la
 *    raíz (voices) o en data; aceptar ambas formas evita que un rename
 *    upstream rompa la UI.
 *  - Scribe: `words[]` trae start/end en SEGUNDOS (float) y `type`
 *    ("word" | "spacing"). Los cortes de muletillas se calculan sobre los
 *    type="word" — los "spacing" son los silencios entre palabras.
 *  - La key del usuario (xi_api_key) NUNCA se normaliza a la UI: los
 *    mapeos de cuenta solo exponen tier/usage.
 *
 * Honesty rules: ningún mapeo inventa créditos ni timestamps — si Scribe no
 * trae words con start/end, la palabra no entra al corte.
 */

export const ELEVENLABS_API_BASE = "https://api.elevenlabs.io";

/** Modelos TTS curados (el primero es el default). Multilingual v2 = mejor
 *  calidad es-ES; Flash v2.5 = latencia baja y la mitad del costo por char. */
export const ELEVENLABS_TTS_MODELS = [
  "eleven_multilingual_v2",
  "eleven_flash_v2_5",
  "eleven_turbo_v2_5",
] as const;
export type ElevenLabsTtsModel = (typeof ELEVENLABS_TTS_MODELS)[number];

/** Presupuesto por request: multilingual v2 admite 5k chars (los demás 10k,
 *  pero un techo único de 5k mantiene el chunking del cliente simple). */
export const ELEVENLABS_TTS_MAX_CHARS = 5_000;

/** Formato de audio del TTS: mp3 44.1kHz 128kbps — decodificable por
 *  WebAudio y muxable en la export MP4/WebM sin re-encode. */
export const ELEVENLABS_OUTPUT_FORMAT = "mp3_44100_128";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
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

// ── Cuenta (GET /v1/user) ───────────────────────────────────────────────────

export interface ElevenLabsAccountInfo {
  userId: string | null;
  firstName: string | null;
  tier: string | null;
  /** Créditos usados / totales del ciclo (los TTS gastan chars, Scribe minutos). */
  characterCount: number | null;
  characterLimit: number | null;
}

export function normalizeAccount(payload: unknown): ElevenLabsAccountInfo {
  const root = asRecord(payload);
  const sub = asRecord(root.subscription);
  return {
    userId: nullableStr(root.user_id),
    firstName: nullableStr(root.first_name),
    tier: nullableStr(sub.tier),
    characterCount: num(sub.character_count),
    characterLimit: num(sub.character_limit),
  };
}

// ── Voces (GET /v1/voices) ──────────────────────────────────────────────────

export interface ElevenLabsVoice {
  id: string;
  name: string;
  category: string | null;
  labels: Record<string, string>;
  /** URL pública del preview oficial (CDN de ElevenLabs, sin key). */
  previewUrl: string | null;
}

export function normalizeVoices(payload: unknown): ElevenLabsVoice[] {
  const root = asRecord(payload);
  const list = Array.isArray(root.voices)
    ? root.voices
    : Array.isArray(root) ? root : [];
  const out: ElevenLabsVoice[] = [];
  for (const raw of list) {
    const v = asRecord(raw);
    const id = str(v.voice_id ?? v.voiceId);
    if (!id) continue;
    const labelsRaw = asRecord(v.labels);
    const labels: Record<string, string> = {};
    for (const [k, val] of Object.entries(labelsRaw)) {
      const s = str(val);
      if (s) labels[k] = s;
    }
    out.push({
      id,
      name: str(v.name) || id,
      category: nullableStr(v.category),
      labels,
      previewUrl: nullableStr(v.preview_url ?? v.previewUrl),
    });
  }
  return out;
}

// ── Modelos (GET /v1/models) ────────────────────────────────────────────────

export interface ElevenLabsModel {
  id: string;
  name: string;
  canTts: boolean;
}

/**
 * GET /v1/models → modelos aptos para TTS, DEDUPEADOS y con los CURADOS
 * (ELEVENLABS_TTS_MODELS) primero para que el default estable de la UI no
 * cambie según el orden del upstream. Un modelo solo entra si
 * `can_do_text_to_speech` es exactamente true — honestidad: si el flag falta,
 * no se asume que sirve.
 */
export function normalizeModels(payload: unknown): ElevenLabsModel[] {
  const root = asRecord(payload);
  const list = Array.isArray(root.models)
    ? root.models
    : Array.isArray(root) ? root : [];
  const out: ElevenLabsModel[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const m = asRecord(raw);
    const id = str(m.model_id ?? m.modelId ?? m.id);
    if (!id || seen.has(id)) continue;
    if (m.can_do_text_to_speech !== true) continue;
    seen.add(id);
    out.push({ id, name: str(m.name) || id, canTts: true });
  }
  const rank = (id: string) => {
    const i = (ELEVENLABS_TTS_MODELS as readonly string[]).indexOf(id);
    return i === -1 ? ELEVENLABS_TTS_MODELS.length : i;
  };
  return out.sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
}

// ── Scribe (POST /v1/speech-to-text) ────────────────────────────────────────

/** Palabra con timestamp REAL — la base de subtítulos y cortes de muletillas. */
export interface ScribeWord {
  text: string;
  /** Segundos desde el inicio del audio subido. */
  startSec: number;
  endSec: number;
  /** "word" = hablada; "spacing" = pausa entre palabras. */
  kind: "word" | "spacing";
}

export interface ScribeResult {
  languageCode: string | null;
  text: string;
  words: ScribeWord[];
}

export function normalizeScribe(payload: unknown): ScribeResult {
  const root = asRecord(payload);
  const words: ScribeWord[] = [];
  const rawWords = Array.isArray(root.words) ? root.words : [];
  for (const raw of rawWords) {
    const w = asRecord(raw);
    const text = str(w.text);
    const start = num(w.start);
    const end = num(w.end);
    if (!text || start === null || end === null) continue;
    words.push({
      text,
      startSec: start,
      endSec: end,
      kind: w.type === "spacing" ? "spacing" : "word",
    });
  }
  return {
    languageCode: nullableStr(root.language_code),
    text: str(root.text),
    words,
  };
}

// ── Errores upstream → payload estable (mismos códigos-familia que HeyGen) ──

export interface ElevenLabsErrorPayload {
  error: string;
  message: string;
}

export function elevenlabsErrorPayload(status: number, body: unknown): ElevenLabsErrorPayload {
  const root = asRecord(body);
  const err = asRecord(root.error);
  const upstreamCode = str(err.status ?? err.code ?? asRecord(root.detail).status).toLowerCase();
  const upstreamMsg = str(err.message ?? root.message
    ?? (typeof root.detail === "string" ? root.detail : asRecord(root.detail).message));

  if (status === 401 || status === 403 || upstreamCode.includes("unauthorized") || upstreamCode.includes("forbidden")) {
    return { error: "ELEVENLABS_KEY_INVALID", message: "ElevenLabs rechazó tu API key (401/403). Revisala o pegá una vigente." };
  }
  if (status === 402 || upstreamCode.includes("quota") || upstreamCode.includes("credit") || upstreamCode.includes("payment") || upstreamCode.includes("free_unit")) {
    return { error: "ELEVENLABS_NO_CREDITS", message: "Tu cuenta de ElevenLabs se quedó sin créditos o el plan no habilita esta operación." };
  }
  if (status === 422 || upstreamCode.includes("invalid") || upstreamCode.includes("unprocessable")) {
    return { error: "ELEVENLABS_BAD_REQUEST", message: upstreamMsg || "ElevenLabs rechazó los parámetros del request." };
  }
  if (status === 429 || upstreamCode.includes("rate") || upstreamCode.includes("too_many")) {
    return { error: "ELEVENLABS_RATE_LIMITED", message: "ElevenLabs está limitando tus requests. Esperá un momento y reintentá." };
  }
  if (status === 404 || upstreamCode.includes("not_found")) {
    return { error: "ELEVENLABS_NOT_FOUND", message: upstreamMsg || "Ese recurso de ElevenLabs no existe (404): ¿voz o modelo válido?" };
  }
  if (status >= 500) {
    return { error: "ELEVENLABS_UPSTREAM", message: `ElevenLabs respondió ${status}. Intentá de nuevo en unos minutos.` };
  }
  return { error: upstreamCode ? `ELEVENLABS_${upstreamCode.slice(0, 32).toUpperCase()}` : "ELEVENLABS_UPSTREAM", message: upstreamMsg || `ElevenLabs respondió ${status}.` };
}

// ── Chunking de guion largo (TTS ≤ 5k chars por request) ────────────────────

/**
 * Divide un guion en trozos ≤ maxChars cortando por FRONTERA DE ORACIÓN
 * (., !, ?, …, salto de línea). Nunca corta una palabra por la mitad: si una
 * oración sola excede el máximo, se corta por coma y, como último recurso,
 * por espacio. Los trozos conservan su puntuación final para que
 * `previous_text` del próximo request continúe la prosodia natural.
 */
export function chunkScriptForTts(text: string, maxChars = ELEVENLABS_TTS_MAX_CHARS): string[] {
  const clean = String(text || "").trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  // 1) Partir en oraciones.
  const sentences = clean.match(/[^.!?\n]+[.!?]*\s*|\n+/g) || [clean];
  const chunks: string[] = [];
  let current = "";

  const pushCurrent = () => {
    const t = current.trim();
    if (t) chunks.push(t);
    current = "";
  };

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      // 2) Oración gigante: cortar por coma, luego por espacio.
      pushCurrent();
      const parts = sentence.split(/,\s*/);
      let piece = "";
      for (const part of parts) {
        const candidate = piece ? `${piece}, ${part}` : part;
        if (candidate.length <= maxChars) { piece = candidate; continue; }
        if (piece) chunks.push(piece.trim());
        // 3) Ni por comas: duro por espacios.
        piece = "";
        let wordRun = "";
        for (const word of part.split(/\s+/)) {
          const cand = wordRun ? `${wordRun} ${word}` : word;
          if (cand.length <= maxChars) { wordRun = cand; continue; }
          if (wordRun) chunks.push(wordRun.trim());
          wordRun = word.slice(0, maxChars);
        }
        if (wordRun) piece = wordRun;
      }
      if (piece) current = piece;
      continue;
    }
    if ((current + " " + sentence).trim().length > maxChars) pushCurrent();
    current = (current + " " + sentence).trim();
  }
  pushCurrent();
  return chunks;
}
