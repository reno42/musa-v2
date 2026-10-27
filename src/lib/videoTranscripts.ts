/**
 * videoTranscripts — REQ-063 (fases 3-4): transcripción del timeline y
 * persistencia del transcript/cortes.
 *
 * Extracción de audio: decodeAudioData de cada material con sonido (video y
 * audio) → OfflineAudioContext MONO 16 kHz con cada clip agendado en su
 * offset real del timeline → WAV PCM16 troceado en bloques de 60 s (con
 * solape de 0.75 s para no cortar palabras en la frontera) → Scribe por
 * chunk → words[] con tiempos ABSOLUTOS del timeline.
 *
 * Por qué 16 kHz mono WAV: 1.9 MB/min — un chunk de 60 s pesa ~2 MB
 * (base64 ~2.7 MB), muy lejos del techo del proxy, y Scribe transcribe voz
 * perfectamente a 16k. Cero dependencias de encoder (no hay MP3 nativo).
 *
 * Persistencia: `musa_video_transcripts` (migración v86, RLS por workspace)
 * vía browserSupabase directo — misma vía que musa_video_takes. Si la tabla
 * no existe todavía (v86 sin aplicar), el error lo dice explícitamente.
 *
 * Honesty rules: los segmentos con speed ≠ 1 se reportan como warnings (el
 * audio extraído suena a speed 1); la extracción NUNCA inventa palabras —
 * lo que Scribe no trae, no entra.
 */

import { browserSupabase } from "./supabaseClient";
import { transcribeAudio } from "./elevenlabs";
import type { ScribeWord } from "../../shared/elevenlabsMappers";
import type { SubtitleCue } from "../../shared/srtVtt";
import type { TimeCut } from "../../shared/fillerWords";
import type { VideoProjectDoc } from "./videoProjectStore";

const SAMPLE_RATE = 16_000;
const CHUNK_SEC = 60;
const OVERLAP_SEC = 0.75;
/** Techo duro: 30 min por transcripción (memoria de decode + costo Scribe). */
const MAX_TOTAL_SEC = 1_800;

export interface TranscriptRow {
  id: string;
  project_id: string;
  workspace_id: string;
  words: ScribeWord[];
  cues: SubtitleCue[];
  cuts: TimeCut[];
  custom_words: string[];
  engine: string;
  language_code: string | null;
  updated_at: string;
}

export interface TranscriptState {
  words: ScribeWord[];
  cues: SubtitleCue[];
  cuts: TimeCut[];
  customWords: string[];
  languageCode: string | null;
}

export function transcriptIdFor(projectId: string): string {
  // Determinístico: un transcript por proyecto (upsert por id).
  return ("vidtrn_" + projectId.replace(/[^a-zA-Z0-9_-]/g, "")).slice(0, 64);
}

/** Lee el transcript persistido. Null si no existe; Error si falta v86. */
export async function loadTranscript(projectId: string): Promise<TranscriptState | null> {
  if (!browserSupabase) return null;
  const { data, error } = await browserSupabase
    .from("musa_video_transcripts")
    .select("words, cues, cuts, custom_words, engine, language_code, updated_at")
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) {
    if (/relation .* does not exist|could not find the table/i.test(error.message)) {
      throw new Error("Falta la migración v86 (musa_video_transcripts) en Supabase.");
    }
    throw new Error(`No se pudo leer el transcript: ${error.message}`);
  }
  if (!data) return null;
  return {
    words: Array.isArray(data.words) ? (data.words as ScribeWord[]) : [],
    cues: Array.isArray(data.cues) ? (data.cues as SubtitleCue[]) : [],
    cuts: Array.isArray(data.cuts) ? (data.cuts as TimeCut[]) : [],
    customWords: Array.isArray(data.custom_words) ? (data.custom_words as string[]) : [],
    languageCode: data.language_code ?? null,
  };
}

/** Upsert del transcript (id determinístico por proyecto). */
export async function saveTranscript(projectId: string, workspaceId: string, state: TranscriptState): Promise<void> {
  if (!browserSupabase) throw new Error("Supabase no está configurado en el cliente.");
  const row = {
    id: transcriptIdFor(projectId),
    project_id: projectId,
    workspace_id: workspaceId,
    words: state.words,
    cues: state.cues,
    cuts: state.cuts,
    custom_words: state.customWords,
    engine: "elevenlabs_scribe",
    language_code: state.languageCode,
    updated_at: new Date().toISOString(),
  };
  const { error } = await browserSupabase
    .from("musa_video_transcripts")
    .upsert(row, { onConflict: "id" });
  if (error) {
    if (/relation .* does not exist|could not find the table/i.test(error.message)) {
      throw new Error("Falta la migración v86 (musa_video_transcripts) en Supabase.");
    }
    throw new Error(`No se pudo guardar el transcript: ${error.message}`);
  }
}

// ── Extracción de audio del timeline ────────────────────────────────────────

interface ScheduledClip {
  buffer: AudioBuffer;
  /** Offset dentro del buffer (trim del source, en segundos). */
  offsetSec: number;
  /** Segundo del timeline donde entra. */
  timelineSec: number;
  /** Duración en el timeline. */
  durSec: number;
}

export interface ExtractionResult {
  words: ScribeWord[];
  languageCode: string | null;
  warnings: string[];
}

function decodeAudioUrl(url: string): Promise<AudioBuffer> {
  return fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status} al leer ${url}`);
      return res.arrayBuffer();
    })
    .then((data) => {
      const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
        || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) throw new Error("Web Audio no disponible.");
      const ctx = new AC();
      return ctx.decodeAudioData(data).finally(() => { void ctx.close(); });
    });
}

/**
 * Audio del timeline → words[] absolutos. `onProgress` informa 0..1 por
 * etapa (decode → render → chunk n/m). Los clips con speed ≠ 1 se agendan a
 * 1× y se reportan en warnings (honestidad > magia).
 */
export async function extractTimelineWords(
  doc: VideoProjectDoc,
  onProgress?: (fraction: number, label: string) => void,
): Promise<ExtractionResult> {
  const warnings: string[] = [];
  const materials = new Map(doc.materials.map((m) => [m.id, m]));

  // 1) Agenda: cada segmento con media sonora, en su lugar del timeline.
  const scheduled: ScheduledClip[] = [];
  const bufferCache = new Map<string, AudioBuffer>();
  let totalSec = 0;
  for (const track of doc.tracks) {
    for (const seg of track.segments) {
      const material = materials.get(seg.material_id);
      if (!material || (material.kind !== "video" && material.kind !== "audio")) continue;
      const url = (material.payload as { url?: unknown }).url;
      if (typeof url !== "string" || !/^(https?:\/\/|\/)/.test(url)) continue;
      if (seg.speed && Math.abs(seg.speed - 1) > 0.01) {
        warnings.push(`«${material.kind}» en ${formatClock(seg.target_start_us / 1e6)} tiene velocidad ${seg.speed}× — se transcribe a 1×.`);
      }
      let buffer = bufferCache.get(url);
      if (!buffer) {
        onProgress?.(0.02, "Descargando y decodificando audio…");
        buffer = await decodeAudioUrl(url);
        bufferCache.set(url, buffer);
      }
      const srcStart = (seg.source_start_us ?? 0) / 1e6;
      const durSec = seg.target_dur_us / 1e6;
      scheduled.push({ buffer, offsetSec: srcStart, timelineSec: seg.target_start_us / 1e6, durSec });
      totalSec = Math.max(totalSec, seg.target_start_us / 1e6 + durSec);
    }
  }
  if (scheduled.length === 0) throw new Error("El timeline no tiene clips con audio para transcribir.");
  if (totalSec > MAX_TOTAL_SEC) {
    throw new Error(`El timeline dura ${Math.round(totalSec / 60)} min — el máximo por transcripción es ${MAX_TOTAL_SEC / 60} min.`);
  }

  // 2) Render offline mono 16k (resample automático del OfflineAudioContext).
  onProgress?.(0.1, "Mezclando audio del timeline…");
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(totalSec * SAMPLE_RATE)), SAMPLE_RATE);
  for (const clip of scheduled) {
    const src = offline.createBufferSource();
    src.buffer = clip.buffer;
    src.connect(offline.destination);
    src.start(clip.timelineSec, clip.offsetSec, clip.durSec);
  }
  const rendered = await offline.startRendering();
  const samples = rendered.getChannelData(0);

  // 3) Chunks WAV 60 s con solape → Scribe → words absolutos.
  const coreWords: ScribeWord[] = [];
  const chunkCount = Math.max(1, Math.ceil(totalSec / CHUNK_SEC));
  for (let n = 0; n < chunkCount; n++) {
    const chunkStart = n * CHUNK_SEC;
    const chunkEnd = Math.min(totalSec, (n + 1) * CHUNK_SEC);
    onProgress?.(0.15 + 0.8 * (n / chunkCount), `Transcribiendo parte ${n + 1}/${chunkCount}…`);
    const from = Math.max(0, Math.floor((chunkStart - OVERLAP_SEC) * SAMPLE_RATE));
    const to = Math.min(samples.length, Math.ceil((chunkEnd + OVERLAP_SEC) * SAMPLE_RATE));
    if (to - from < SAMPLE_RATE / 10) continue; // chunk residual (<100 ms)
    const wav = encodeWav(samples.subarray(from, to), SAMPLE_RATE);
    const result = await transcribeAudio({ audio: wav });
    // Solo palabras de la región CORE del chunk (el solape cubre cortes de
    // frontera; la región central evita duplicados entre chunks).
    for (const w of result.words) {
      if (w.kind !== "word") continue;
      const absStart = chunkStart - OVERLAP_SEC + w.startSec;
      if (absStart < chunkStart || absStart >= chunkEnd) continue;
      coreWords.push({ text: w.text, startSec: Math.max(0, absStart), endSec: chunkStart - OVERLAP_SEC + w.endSec, kind: "word" });
    }
  }
  coreWords.sort((a, b) => a.startSec - b.startSec);
  onProgress?.(1, "Transcripción lista.");
  return { words: coreWords, languageCode: null, warnings };
}

/** WAV PCM16 mono — header RIFF de 44 bytes + samples little-endian. */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);        // PCM
  view.setUint16(22, 1, true);        // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function formatClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
