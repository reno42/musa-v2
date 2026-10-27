/**
 * REQ-063 — Cliente de Voces IA + transcripción (ElevenLabs) para Musa.
 *
 * Todo pasa por el proxy same-origin /api/elevenlabs/* (ver elevenlabs.mjs):
 * la API key NUNCA llega al navegador — se guarda cifrada con el BYOK
 * existente (PUT /api/keys/elevenlabs) y el server la lee con getUserKey.
 *
 * El TTS devuelve MP3 binario: acá se usa fetch directo (apiFetch es
 * JSON-only) con el MISMO auth de getApiHeaders. Los guiones largos se
 * trocean con chunkScriptForTts (frontera de oración) y los chunks se
 * concatenan — los frames MP3 son autocontenidos y la unión es válida.
 *
 * Honesty rules: los DTOs vienen de shared/elevenlabsMappers; los errores
 * del proxy son códigos estables con mensaje humano — nunca un 500 opaco.
 */

import { getApiHeaders } from "./apiKey";
import { apiFetch } from "./supabase";
import {
  ELEVENLABS_TTS_MAX_CHARS,
  chunkScriptForTts,
  type ElevenLabsAccountInfo,
  type ElevenLabsModel,
  type ElevenLabsTtsModel,
  type ElevenLabsVoice,
  type ScribeResult,
} from "../../shared/elevenlabsMappers";

export type {
  ElevenLabsAccountInfo,
  ElevenLabsModel,
  ElevenLabsTtsModel,
  ElevenLabsVoice,
  ScribeResult,
  ScribeWord,
} from "../../shared/elevenlabsMappers";

export interface ElevenLabsKeyStatus {
  configured: boolean;
  last4: string | null;
  updatedAt: string | null;
}

export async function fetchElevenlabsStatus(): Promise<ElevenLabsKeyStatus> {
  return apiFetch<ElevenLabsKeyStatus>("/api/elevenlabs/status");
}

/** GET /v1/user vía proxy: valida la key y trae tier + uso del ciclo. */
export async function validateElevenlabsKey(): Promise<ElevenLabsAccountInfo & { usagePct: number | null }> {
  const res = await apiFetch<{ valid: boolean; account: ElevenLabsAccountInfo & { usagePct: number | null } }>("/api/elevenlabs/validate", { method: "POST" });
  return res.account;
}

/**
 * Catálogo de voces — CACHE módulo (TTL 5 min) + dedupe de llamadas en vuelo.
 * VoiceTab y TakeStudioVoice se montan independientemente; sin esto cada mount
 * dispara un /v1/voices upstream. `force: true` (botón Recargar) salta el cache.
 */
const VOICES_TTL_MS = 5 * 60_000;
let voicesCache: { at: number; voices: ElevenLabsVoice[] } | null = null;
let voicesInflight: Promise<ElevenLabsVoice[]> | null = null;

export async function listElevenlabsVoices(options: { force?: boolean } = {}): Promise<ElevenLabsVoice[]> {
  const force = options.force === true;
  if (!force && voicesCache && Date.now() - voicesCache.at < VOICES_TTL_MS) return voicesCache.voices;
  if (!force && voicesInflight) return voicesInflight;
  const promise = apiFetch<{ voices: ElevenLabsVoice[] }>("/api/elevenlabs/voices?page_size=100")
    .then((res) => {
      const voices = res.voices ?? [];
      voicesCache = { at: Date.now(), voices };
      return voices;
    })
    .finally(() => { voicesInflight = null; });
  voicesInflight = promise;
  return promise;
}

/** Invalida el cache (lo usa el botón "Recargar voces" del VoiceTab). */
export function clearElevenlabsVoicesCache(): void {
  voicesCache = null;
}

/** Modelos TTS disponibles para la key (UI los fusiona con los curados). */
export async function listElevenlabsModels(): Promise<ElevenLabsModel[]> {
  const res = await apiFetch<{ models: ElevenLabsModel[] }>("/api/elevenlabs/models");
  return res.models ?? [];
}

export interface VoiceoverRequest {
  text: string;
  voiceId: string;
  modelId?: ElevenLabsTtsModel | string;
  voiceSettings?: { stability?: number; similarityBoost?: number };
  /** Inyectable para QA/ar harness. */
  poster?: typeof fetch;
}

/** Un request TTS crudo → Blob MP3 (o error con mensaje humano del proxy). */
async function ttsChunk(request: VoiceoverRequest, text: string, previousText: string | null, nextText: string | null, post: typeof fetch): Promise<Blob> {
  const resp = await post("/api/elevenlabs/tts", {
    method: "POST",
    headers: getApiHeaders(),
    body: JSON.stringify({
      text,
      voiceId: request.voiceId,
      modelId: request.modelId || "eleven_multilingual_v2",
      voiceSettings: request.voiceSettings || {},
      ...(previousText ? { previousText } : {}),
      ...(nextText ? { nextText } : {}),
    }),
  });
  if (!resp.ok) {
    // El proxy responde JSON con { error, message } de código estable.
    const detail = await resp.json().catch(() => null);
    const message = (detail as { message?: string; error?: string } | null)?.message
      || (detail as { error?: string } | null)?.error
      || `HTTP ${resp.status}`;
    throw new Error(message);
  }
  const blob = await resp.blob();
  if (!blob.size) throw new Error("ELEVENLABS_EMPTY_AUDIO");
  return blob;
}

/**
 * Guion → MP3. Trocea por oraciones (techo ELEVENLABS_TTS_MAX_CHARS) y
 * concatena los chunks; cada chunk recibe previous/next para que la prosodia
 * no "resetee" entre cortes. onChunk informa progreso (0..1) por chunk.
 */
export async function generateVoiceover(
  request: VoiceoverRequest,
  onChunk?: (done: number, total: number) => void,
): Promise<Blob> {
  const text = String(request.text || "").trim();
  if (!text) throw new Error("El guion está vacío.");
  if (!request.voiceId) throw new Error("Elegí una voz.");
  const post = request.poster || fetch;
  const chunks = chunkScriptForTts(text, ELEVENLABS_TTS_MAX_CHARS);
  const blobs: Blob[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const previous = i > 0 ? chunks[i - 1] : null;
    const next = i < chunks.length - 1 ? chunks[i + 1] : null;
    blobs.push(await ttsChunk(request, chunks[i], previous, next, post));
    onChunk?.(i + 1, chunks.length);
  }
  if (blobs.length === 1) return blobs[0];
  return new Blob(blobs, { type: "audio/mpeg" });
}

export interface TranscribeRequest {
  /** MP3/WAV binario del audio a transcribir (≤ ~30 MB por request). */
  audio: Blob;
  languageCode?: string | null;
  modelId?: string;
  poster?: typeof fetch;
}

/** Audio → Scribe words con timestamps (la base de subtítulos y cortes). */
export async function transcribeAudio(request: TranscribeRequest): Promise<ScribeResult> {
  const post = request.poster || fetch;
  const dataBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("No se pudo leer el audio"));
    reader.readAsDataURL(request.audio);
  });
  const resp = await post("/api/elevenlabs/stt", {
    method: "POST",
    headers: getApiHeaders(),
    body: JSON.stringify({
      audioBase64: dataBase64,
      mimeType: request.audio.type || "audio/mpeg",
      modelId: request.modelId || "scribe_v1",
      ...(request.languageCode ? { languageCode: request.languageCode } : {}),
    }),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok) {
    const message = (json as { message?: string } | null)?.message || `HTTP ${resp.status}`;
    throw new Error(message);
  }
  return json as ScribeResult;
}
