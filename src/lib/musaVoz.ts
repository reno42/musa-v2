/**
 * REQ-071 — Cliente del Módulo de Voces freemium (/api/musa-voz/*).
 *
 * Stock = Workers AI de la plataforma (aura-2 es/en): $0 para el usuario,
 * sin key. Mis voces = librería musa_voces (favoritos stock + clones BYOK
 * ElevenLabs + clones propios pendientes de backend). Clonar = POST /clonar
 * con WAV del micrófono o archivo.
 *
 * Igual que elevenlabs.ts: JSON va por apiFetch; el audio sintetizado vuelve
 * en base64 dentro del JSON (el proxy del worker ya resuelve el binario) y
 * acá se convierte a Blob para medir duración y subirlo como material.
 */

import { apiFetch } from "./supabase";

export interface VozStockSpeaker {
  id: string;
  nombre: string;
  rasgo: string;
}
export interface VozStockGrupo {
  modelo: string;
  idioma: string;
  etiqueta: string;
  speakers: VozStockSpeaker[];
}
export interface VozStockCatalogo {
  stock: VozStockGrupo[];
  backend: { aiBinding: boolean; once?: string };
  cuota: { charsDia: number };
}

export interface VozMia {
  id: string;
  nombre: string;
  tipo: "stock" | "clon" | "elevenlabs";
  proveedor: string;
  voice_ref: { modelo?: string; speaker?: string; voiceId?: string };
  idiomas: string[];
  params: Record<string, unknown>;
  created_at?: string;
}

export interface SintesisResult {
  audioBase64: string;
  mimeType: string;
  chars: number;
  voz: { id: string | null; nombre: string; tipo: string; proveedor: string };
  quota: { usado: number; limite: number };
}

function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime || "audio/mpeg" });
}

export async function fetchStockCatalogo(): Promise<VozStockCatalogo> {
  return apiFetch<VozStockCatalogo>("/api/musa-voz/stock");
}

export type MisVocesResult =
  | { ok: true; stock: VozStockGrupo[]; mias: VozMia[] }
  | { ok: false; code: string; mensaje: string };

export async function fetchMisVoces(): Promise<MisVocesResult> {
  try {
    const data = await apiFetch<{ stock: VozStockGrupo[]; mias: VozMia[] }>("/api/musa-voz/voces");
    return { ok: true, stock: data.stock, mias: data.mias || [] };
  } catch (cause) {
    // apiFetch lanza Error con el mensaje del server; distinguimos migración
    const msg = cause instanceof Error ? cause.message : "No se pudo cargar la librería.";
    const code = /migraci/i.test(msg) ? "MIGRATION_PENDING" : "ERROR";
    return { ok: false, code, mensaje: msg };
  }
}

export async function sintetizarVoz(body: {
  vozId?: string; speaker?: string; idioma?: string; texto: string;
}): Promise<{ blob: Blob; quota: { usado: number; limite: number }; voz: SintesisResult["voz"] }> {
  const res = await apiFetch<SintesisResult>("/api/musa-voz/sintetizar", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return { blob: base64ToBlob(res.audioBase64, res.mimeType), quota: res.quota, voz: res.voz };
}

export async function clonarVoz(body: {
  nombre: string; audioBase64: string; mimeType: string;
  idioma?: string; proveedor?: string;
}): Promise<{ voz: VozMia; nota?: string }> {
  return apiFetch<{ voz: VozMia; nota?: string }>("/api/musa-voz/clonar", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function guardarVozFavorita(body: {
  nombre: string; tipo: string; proveedor?: string;
  voiceRef?: Record<string, unknown>; idiomas?: string[];
}): Promise<{ voz: VozMia }> {
  return apiFetch<{ voz: VozMia }>("/api/musa-voz/voces", {
    method: "POST",
    body: JSON.stringify({
      nombre: body.nombre, tipo: body.tipo, proveedor: body.proveedor,
      voiceRef: body.voiceRef, idiomas: body.idiomas,
    }),
  });
}

/** ArrayBuffer → WAV PCM16 (el navegador graba webm/opus; ElevenLabs exige wav/mp3/...). */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numCh = Math.min(buffer.numberOfChannels, 2);
  const len = buffer.length * numCh * 2;
  const out = new ArrayBuffer(44 + len);
  const view = new DataView(out);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + len, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * numCh * 2, true);
  view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, len, true);
  let off = 44;
  const chans: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([out], { type: "audio/wav" });
}

/** Duración real del audio (decodifica con WebAudio). */
export async function decodeAudioDuration(blob: Blob): Promise<number> {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) throw new Error("Web Audio no disponible para medir el audio.");
  const ctx = new AC();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    return decoded.duration;
  } finally {
    void ctx.close();
  }
}

export async function blobToWavBase64(blob: Blob): Promise<{ b64: string; mimeType: string }> {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const wav = audioBufferToWav(decoded);
    const buf = new Uint8Array(await wav.arrayBuffer());
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < buf.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + CHUNK)) as unknown as number[]);
    }
    return { b64: btoa(bin), mimeType: "audio/wav" };
  } finally {
    void ctx.close();
  }
}
