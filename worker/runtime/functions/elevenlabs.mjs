/**
 * REQ-063 — Voces IA + transcripción: proxy same-origin contra ElevenLabs v1.
 *
 *   GET  /api/elevenlabs/status     → ¿hay BYOK de elevenlabs? (solo last4)
 *   POST /api/elevenlabs/validate   → GET /v1/user (key vigente + tier/uso)
 *   GET  /api/elevenlabs/voices     → GET /v1/voices (catálogo con preview_url)
 *   GET  /api/elevenlabs/models     → GET /v1/models (modelos TTS de la key)
 *   POST /api/elevenlabs/tts        → POST /v1/text-to-speech/{voice_id} (MP3 binario)
 *   POST /api/elevenlabs/stt        → POST /v1/speech-to-text (Scribe, word timestamps)
 *
 * Por qué un proxy: api.elevenlabs.io no expone CORS para este uso y la BYOK
 * NUNCA debe bajar al client. La clave se lee cifrada con
 * getUserKey(userId, "elevenlabs") — la misma tabla/cripto que /api/keys usa
 * para guardarla (PUT /api/keys/elevenlabs), así que no hay migración nueva.
 *
 * Binario: el TTS responde audio/mp3. El puente del worker (index.js) decodifica
 * `isBase64Encoded`, así que el proxy devuelve base64 puro — sin buffering
 * extra en el cliente ni keys en tránsito.
 *
 * Scribe: el cliente manda { audioBase64, mimeType } en JSON (el propio
 * toWorkerEvent ya usa ese camino para binarios); acá se recompone el
 * multipart/form-data que ElevenLabs exige y se reenvía streaming.
 *
 * Honesty rules: ni la key ni los headers viajan a logs ni respuestas; los
 * errores upstream se traducen con elevenlabsErrorPayload (códigos estables);
 * el proxy NO inventa timestamps — si Scribe no trae words, responde words: [].
 */

import { getSupabaseAdmin } from "../../../api/src/services/supabase.js";
import { decodeHandlerBody, JSON_UTF8_CONTENT_TYPE } from "./http-encoding.mjs";
import { getUserKey } from "./keys.mjs";
import {
  ELEVENLABS_API_BASE,
  ELEVENLABS_OUTPUT_FORMAT,
  ELEVENLABS_TTS_MAX_CHARS,
  elevenlabsErrorPayload,
  normalizeAccount,
  normalizeModels,
  normalizeScribe,
  normalizeVoices,
} from "../../../shared/elevenlabsMappers.ts";

const VALIDATE_TIMEOUT_MS = 15_000;
const VOICES_TIMEOUT_MS = 20_000;
/** El TTS de un chunk de 5k chars puede tardar ~30-60 s en colas ocupadas. */
const TTS_TIMEOUT_MS = 90_000;
/** Scribe transcribe ~10× real-time: un chunk de 15 min puede tardar minutos. */
const STT_TIMEOUT_MS = 240_000;
/** Techo del audio para STT (base64 JSON): ~30 MB binario ≈ 40 MB b64. */
const STT_MAX_AUDIO_BYTES = 30 * 1024 * 1024;

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

/** Respuesta binaria (audio MP3): base64 para el puente del worker. */
function binaryBody(bytes, contentType) {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return {
    statusCode: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
    body: btoa(bin),
    isBase64Encoded: true,
  };
}

/** Cliente Supabase admin — la lectura de la BYOK es por user_id. */
function getAdmin() {
  return getSupabaseAdmin();
}

/**
 * Llamada upstream. `path` siempre relativo (/v1/...). Nunca se loggea la
 * key: solo método, ruta y status.
 */
async function callElevenlabs(apiKey, method, path, { body, timeoutMs, headers } = {}) {
  const init = {
    method,
    headers: { "xi-api-key": apiKey, Accept: "application/json", ...(headers || {}) },
    signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs || VALIDATE_TIMEOUT_MS) : undefined,
  };
  if (body !== undefined && body !== null) init.body = body;
  let resp;
  try {
    resp = await fetch(ELEVENLABS_API_BASE + path, init);
  } catch (cause) {
    const name = cause instanceof Error ? cause.name : "";
    console.error("[elevenlabs] upstream fetch falló:", method, path.split("?")[0], name);
    return { ok: false, status: 0, payload: { error: { message: "No se pudo conectar con ElevenLabs." } } };
  }
  // El TTS responde AUDIO, no JSON: se leen los bytes UNA vez y el decode
  // JSON se intenta sobre esa copia — nunca se pierde el binario.
  let rawBytes = null;
  try {
    const buf = await resp.arrayBuffer();
    rawBytes = new Uint8Array(buf);
  } catch {
    rawBytes = null;
  }
  let payload = null;
  if (rawBytes) {
    try {
      payload = JSON.parse(new TextDecoder().decode(rawBytes));
    } catch {
      payload = null; // binario real (audio) o cuerpo vacío
    }
  }
  if (!resp.ok) {
    console.error("[elevenlabs] upstream error:", method, path.split("?")[0], resp.status);
    return { ok: false, status: resp.status, payload };
  }
  return { ok: true, status: resp.status, payload, rawBytes };
}

/** Respuesta de error ya envuelta, con 502 si la red cayó. */
function upstreamError(result) {
  const mapped = elevenlabsErrorPayload(result.status || 502, result.payload);
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

/** Str con techo — los params de voz/modelo llegan del cliente y se saneaan. */
function boundedStr(raw, max) {
  const s = String(raw || "").trim();
  return s ? s.slice(0, max) : null;
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
  }

  const bearer = (event.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return jsonBody(401, { error: "Authentication required." });

  const sbAdmin = getAdmin();
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
  const query = event.queryStringParameters || {};

  // ── GET /api/elevenlabs/status — sin upstream: solo metadatos de la BYOK ──
  if (event.httpMethod === "GET" && sub === "status") {
    const { data, error } = await sbAdmin
      .from("user_api_keys")
      .select("last4, model, updated_at")
      .eq("user_id", userId)
      .eq("provider", "elevenlabs")
      .maybeSingle();
    if (error) return jsonBody(500, { error: error.message });
    return jsonBody(200, {
      configured: Boolean(data),
      last4: data?.last4 || null,
      updatedAt: data?.updated_at || null,
    });
  }

  // Todo lo demás necesita la key descifrada server-side.
  const { key: apiKey } = await getUserKey(userId, "elevenlabs");
  if (!apiKey) {
    return jsonBody(409, {
      error: "ELEVENLABS_KEY_MISSING",
      message: "Guardá tu API key de ElevenLabs en Ajustes > Integraciones para usar voces IA.",
    });
  }

  // ── POST /api/elevenlabs/validate — GET /v1/user ──
  if (event.httpMethod === "POST" && sub === "validate") {
    const result = await callElevenlabs(apiKey, "GET", "/v1/user", { timeoutMs: VALIDATE_TIMEOUT_MS });
    if (!result.ok) return upstreamError(result);
    const account = normalizeAccount(result.payload);
    return jsonBody(200, {
      valid: true,
      account: {
        ...account,
        // Uso legible para la UI (chars TTS del ciclo actual).
        usagePct: account.characterLimit
          ? Math.min(100, Math.round(((account.characterCount || 0) / account.characterLimit) * 100))
          : null,
      },
    });
  }

  // ── GET /api/elevenlabs/voices — catálogo completo con previews ──
  if (event.httpMethod === "GET" && sub === "voices") {
    const params = new URLSearchParams({ page_size: String(Math.min(100, Math.max(10, Number(query.page_size) || 100))) });
    const result = await callElevenlabs(apiKey, "GET", `/v1/voices?${params.toString()}`, { timeoutMs: VOICES_TIMEOUT_MS });
    if (!result.ok) return upstreamError(result);
    return jsonBody(200, { voices: normalizeVoices(result.payload) });
  }

  // ── GET /api/elevenlabs/models — modelos TTS aptos para la key ──
  if (event.httpMethod === "GET" && sub === "models") {
    const result = await callElevenlabs(apiKey, "GET", "/v1/models", { timeoutMs: VOICES_TIMEOUT_MS });
    if (!result.ok) return upstreamError(result);
    return jsonBody(200, { models: normalizeModels(result.payload) });
  }

  // ── POST /api/elevenlabs/tts — texto → MP3 (binario base64) ──
  if (event.httpMethod === "POST" && sub === "tts") {
    const body = bodyOf(event);
    if (!body) return jsonBody(400, { error: "Invalid JSON body." });
    const voiceId = boundedStr(body.voiceId, 64);
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!voiceId) return jsonBody(400, { error: "ELEVENLABS_VOICE_REQUIRED", message: "Elegí una voz." });
    if (!text) return jsonBody(400, { error: "ELEVENLABS_TEXT_REQUIRED", message: "El guion está vacío." });
    if (text.length > ELEVENLABS_TTS_MAX_CHARS) {
      return jsonBody(400, {
        error: "ELEVENLABS_TEXT_TOO_LONG",
        message: `El guion supera ${ELEVENLABS_TTS_MAX_CHARS} caracteres — dividilo en partes (el cliente lo hace solo).`,
      });
    }
    const modelId = boundedStr(body.modelId, 64) || "eleven_multilingual_v2";
    const settings = typeof body.voiceSettings === "object" && body.voiceSettings !== null ? body.voiceSettings : {};
    const payload = {
      text,
      model_id: modelId,
      ...(settings.stability !== undefined ? { stability: Math.min(1, Math.max(0, Number(settings.stability) || 0)) } : {}),
      ...(settings.similarityBoost !== undefined ? { similarity_boost: Math.min(1, Math.max(0, Number(settings.similarityBoost) || 0)) } : {}),
      ...(body.previousText ? { previous_text: String(body.previousText).slice(-500) } : {}),
      ...(body.nextText ? { next_text: String(body.nextText).slice(0, 500) } : {}),
    };
    const result = await callElevenlabs(apiKey, "POST", `/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${ELEVENLABS_OUTPUT_FORMAT}`, {
      timeoutMs: TTS_TIMEOUT_MS,
      headers: { "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify(payload),
    });
    if (!result.ok) return upstreamError(result);
    // El upstream OK es audio crudo (Accept: audio/mpeg): payload=null y los
    // bytes llegan en rawBytes.
    const bytes = result.rawBytes instanceof Uint8Array ? result.rawBytes : null;
    if (!bytes || bytes.length === 0) {
      return jsonBody(502, { error: "ELEVENLABS_EMPTY_AUDIO", message: "ElevenLabs respondió sin audio. Reintentá." });
    }
    return binaryBody(bytes, "audio/mpeg");
  }

  // ── POST /api/elevenlabs/stt — audio → Scribe words con timestamps ──
  if (event.httpMethod === "POST" && sub === "stt") {
    const body = bodyOf(event);
    if (!body) return jsonBody(400, { error: "Invalid JSON body." });
    const audioB64 = typeof body.audioBase64 === "string" ? body.audioBase64 : "";
    if (!audioB64) return jsonBody(400, { error: "ELEVENLABS_AUDIO_REQUIRED", message: "No llegó el audio a transcribir." });
    let bytes;
    try {
      const bin = atob(audioB64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch {
      return jsonBody(400, { error: "ELEVENLABS_AUDIO_INVALID", message: "El audio en base64 no se pudo decodificar." });
    }
    if (bytes.length === 0) return jsonBody(400, { error: "ELEVENLABS_AUDIO_EMPTY", message: "El audio está vacío." });
    if (bytes.length > STT_MAX_AUDIO_BYTES) {
      return jsonBody(413, { error: "ELEVENLABS_AUDIO_TOO_LARGE", message: "El audio supera el máximo por request — dividilo en partes más cortas." });
    }
    const modelId = boundedStr(body.modelId, 64) || "scribe_v1";
    const languageCode = boundedStr(body.languageCode, 12);
    const mime = boundedStr(body.mimeType, 64) || "audio/mpeg";

    // ElevenLabs exige multipart/form-data con el campo `file`.
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: mime }), "audio.mp3");
    form.append("model_id", modelId);
    if (languageCode) form.append("language_code", languageCode);

    const init = {
      method: "POST",
      headers: { "xi-api-key": apiKey, Accept: "application/json" },
      body: form,
      signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(STT_TIMEOUT_MS) : undefined,
    };
    let resp;
    try {
      resp = await fetch(`${ELEVENLABS_API_BASE}/v1/speech-to-text`, init);
    } catch (cause) {
      const name = cause instanceof Error ? cause.name : "";
      console.error("[elevenlabs] stt fetch falló:", name);
      return jsonBody(502, { error: "ELEVENLABS_UPSTREAM", message: "No se pudo conectar con ElevenLabs para transcribir." });
    }
    let payload = null;
    try {
      payload = await resp.json();
    } catch {
      payload = null;
    }
    if (!resp.ok) return upstreamError({ ok: false, status: resp.status, payload });
    return jsonBody(200, normalizeScribe(payload));
  }

  return jsonBody(405, { error: `Method ${event.httpMethod} not allowed.` });
}
