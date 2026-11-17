/**
 * Módulo de Voces (freemium) — REQ-071
 *
 *   GET    /api/musa-voz/stock            → catálogo stock Workers AI (ES 10 + EN 40) + estado
 *   GET    /api/musa-voz/voces            → librería del workspace {stock, mias}
 *   POST   /api/musa-voz/voces            → crear voz {nombre, tipo:'stock'|'clon'|'elevenlabs', ...}
 *   PATCH  /api/musa-voz/voces/:id        → renombrar / params / idiomas
 *   DELETE /api/musa-voz/voces/:id        → borrar (dueño o admin del workspace)
 *   POST   /api/musa-voz/clonar           → clonar {nombre, audioBase64, mimeType, idioma, proveedor}
 *                                            proveedor=elevenlabs → instant clone BYOK (funciona hoy)
 *                                            proveedor=workers-ai → guarda el clip en R2 y crea la
 *                                            voz clon (backend Chatterbox en Oracle A1)
 *   POST /api/musa-voz/sintetizar → {vozId, texto} → {audioBase64, mimeType, chars, quota}
 *                                            clon workers-ai → llama al backend Chatterbox con el
 *                                            sample en R2; audio resultante se cachea en R2 (24h)
 *   POST   /api/musa-voz/sintetizar       → {vozId, texto} → {audioBase64, mimeType, chars, quota}
 *
 * Freemium: voces stock corren en el binding AI de la cuenta de la plataforma
 * (10k neurons/día gratis de Cloudflare, $0 para el usuario). Cuota por
 * usuario en musa_voz_uso (si la tabla aún no existe, cuota in-memory
 * best-effort). La clonación BYOK usa la key elevenlabs del usuario con el
 * MISMO cifrado de /api/keys — cero migraciones nuevas para ese camino.
 *
 * Honesty rules: los errores upstream se traducen a códigos estables; sin
 * inventar audio; sin logs de keys; feature-detect de la migración con
 * mensaje accionable (el SQL vive en supabase_migrations/musa_voces.sql).
 */

import { getSupabaseAdmin } from "../../../api/src/services/supabase.js";
import { parseHandlerJson } from "./http-encoding.mjs";
import { getUserKey } from "./keys.mjs";
import { r2ConfigFromEnv, presignR2Url } from "./r2-presign.mjs";

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1";

/** Cuota free por usuario/día de chars sintetizados con voces de la plataforma. */
const QUOTA_CHARS_DIA = 10_000;
const TTS_MAX_CHARS = 5_000;

// ── Backend Chatterbox (Oracle A1) + R2 para samples y caché de audio ──
// VOZ_BACKEND_URL: https://host:8787 — secret compartido en VOZ_BACKEND_SECRET.
// Los samples de clonación viven en R2 (voz-samples/) y el audio sintetizado
// se cachea en voz-cache/ (borrado por lifecycle/ cron). Sin R2 config el
// módulo sigue sirviendo stock + elevenlabs igual que antes.
const VOZ_SAMPLE_TTL_DIAS = 180;
const VOZ_CACHE_TTL_HORAS = 24;
const VOZ_BACKEND_TIMEOUT_MS = 280_000;

function vozConfig(env = process.env) {
  const url = (env.VOZ_BACKEND_URL || "").replace(/\/$/, "");
  const secret = env.VOZ_BACKEND_SECRET || "";
  if (!url || !secret) return null;
  return { url, secret };
}

// ── Catálogo stock (Workers AI @cf/deepgram/aura-2-{es,en}) ──
const STOCK_ES = {
  modelo: "@cf/deepgram/aura-2-es",
  idioma: "es",
  etiqueta: "Español (latino neutro)",
  speakers: [
    { id: "carina", nombre: "Carina", rasgo: "cálida, narrativa" },
    { id: "celeste", nombre: "Celeste", rasgo: "clara, corporativa" },
    { id: "selena", nombre: "Selena", rasgo: "joven, energica" },
    { id: "estrella", nombre: "Estrella", rasgo: "expresiva, publicitaria" },
    { id: "diana", nombre: "Diana", rasgo: "serena, documental" },
    { id: "aquila", nombre: "Aquila", rasgo: "neutra, versatil" },
    { id: "sirio", nombre: "Sirio", rasgo: "masculina, profesional" },
    { id: "nestor", nombre: "Nestor", rasgo: "masculina, narrativa" },
    { id: "alvaro", nombre: "Alvaro", rasgo: "masculina, cercana" },
    { id: "javier", nombre: "Javier", rasgo: "masculina, institucional" },
  ],
};
const STOCK_EN = {
  modelo: "@cf/deepgram/aura-2-en",
  idioma: "en",
  etiqueta: "English (US)",
  speakers: [
    { id: "luna", nombre: "Luna", rasgo: "warm, narrative" },
    { id: "aurora", nombre: "Aurora", rasgo: "bright, upbeat" },
    { id: "athena", nombre: "Athena", rasgo: "clear, corporate" },
    { id: "cora", nombre: "Cora", rasgo: "calm, documentary" },
    { id: "iris", nombre: "Iris", rasgo: "young, energetic" },
    { id: "pandora", nombre: "Pandora", rasgo: "expressive, promo" },
    { id: "helena", nombre: "Helena", rasgo: "serene, storytelling" },
    { id: "apollo", nombre: "Apollo", rasgo: "male, professional" },
    { id: "atlas", nombre: "Atlas", rasgo: "male, deep narration" },
    { id: "orion", nombre: "Orion", rasgo: "male, friendly" },
    { id: "hermes", nombre: "Hermes", rasgo: "male, institutional" },
    { id: "draco", nombre: "Draco", rasgo: "male, dramatic" },
  ],
};

function corsHeaders(extra = {}) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
    ...extra,
  };
}
function jsonBody(statusCode, data, extraHeaders) {
  return { statusCode, headers: corsHeaders(extraHeaders), body: JSON.stringify(data) };
}
function err(statusCode, code, mensaje) {
  return jsonBody(statusCode, { error: mensaje, code });
}

/** Binding AI puentado por worker/index.js (globalThis.__musaEnv). */
function getAI() {
  return globalThis.__musaEnv?.AI || null;
}

function hoyUTC() {
  return new Date().toISOString().slice(0, 10);
}

function vocId() {
  const hex = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 12; i++) s += hex[Math.floor(Math.random() * 16)];
  return `voc_${s}`;
}

/** Workspace personal del usuario (owner, kind='personal' en el espejo data). */
async function resolverWorkspace(sb, userId) {
  const { data, error } = await sb
    .from("workspaces")
    .select("id, name, data")
    .eq("owner_id", userId);
  if (error) throw new Error(`workspaces: ${error.message}`);
  const rows = data || [];
  const personal = rows.find((w) => w?.data?.kind === "personal");
  if (personal) return personal.id;
  if (rows.length) return rows[0].id;
  return null;
}

// ── Cuota (musa_voz_uso: 1 fila por user/día, upsert) ──
const memCuota = new Map(); // best-effort si la tabla no existe

async function consumoHoy(sb, userId, tablaOk) {
  if (!tablaOk) return memCuota.get(`${userId}:${hoyUTC()}`) || 0;
  const { data, error } = await sb
    .from("musa_voz_uso")
    .select("chars")
    .eq("user_id", userId)
    .eq("dia", hoyUTC())
    .maybeSingle();
  if (error || !data) return 0;
  return data.chars || 0;
}

async function registrarConsumo(sb, userId, chars, tablaOk) {
  if (!tablaOk) {
    const k = `${userId}:${hoyUTC()}`;
    memCuota.set(k, (memCuota.get(k) || 0) + chars);
    return;
  }
  const { error } = await sb.rpc("musa_voz_uso_incrementa", {
    p_user: userId, p_dia: hoyUTC(), p_chars: chars,
  });
  if (error) {
    // sin la función (migración vieja): upsert manual best-effort
    await sb.from("musa_voz_uso").upsert(
      { user_id: userId, dia: hoyUTC(), chars },
      { onConflict: "user_id,dia", ignoreDuplicates: false }
    );
  }
}

/** ¿La migración de voces ya está aplicada? (cache por isolate) */
let _tablaOk = null;
async function vocesTablaOk(sb) {
  if (_tablaOk !== null) return _tablaOk;
  try {
    const { error } = await sb.from("musa_voces").select("id").limit(1);
    _tablaOk = !error;
  } catch {
    _tablaOk = false;
  }
  return _tablaOk;
}

// ── Síntesis stock con el binding AI ──
async function ttsStock(ai, modelo, speaker, texto) {
  const result = await ai.run(modelo, {
    text: texto,
    speaker,
    encoding: "mp3",
    // container NO va con encoding=mp3 (8007 del upstream Deepgram)
  });
  // El binding devuelve ReadableStream de audio MPEG
  const buf = await new Response(result).arrayBuffer();
  return new Uint8Array(buf);
}

// ── ElevenLabs upstream (BYOK del usuario) ──
async function elTts(key, voiceId, texto, params) {
  const res = await fetch(`${ELEVENLABS_API_BASE}/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      text: texto,
      model_id: params?.modelId || "eleven_multilingual_v2",
      voice_settings: {
        stability: params?.stability ?? 0.5,
        similarity_boost: params?.similarityBoost ?? 0.75,
        speed: params?.speed ?? 1.0,
      },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    const e = new Error(`ElevenLabs TTS ${res.status}`);
    e.upstream = t.slice(0, 300);
    throw e;
  }
  const buf = await res.arrayBuffer();
  return { bytes: new Uint8Array(buf), mime: res.headers.get("content-type") || "audio/mpeg" };
}

// ── R2 helpers (samples + caché de audio) ──
// Los clips de referencia del usuario son sensibles: keys no predecibles,
// lectura SOLO vía URLs firmadas de corta vida por el backend.
function vozR2Config() {
  const cfg = r2ConfigFromEnv();
  if (!cfg) return null;
  return { ...cfg, bucket: process.env.R2_VOZ_BUCKET || "musa-voz" };
}

async function r2Put(cfg, key, bytes, mime) {
  const expires = new Date(Date.now() + 60_000);
  const url = await presignR2Url(cfg, "PUT", key, 60, expires);
  const r = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": mime || "application/octet-stream" },
    body: bytes,
  });
  if (!r.ok) throw new Error(`R2_PUT ${r.status}`);
}

async function r2SignedGet(cfg, key, segundos = 900) {
  return presignR2Url(cfg, "GET", key, segundos);
}

async function r2Get(cfg, key) {
  const url = await presignR2Url(cfg, "GET", key, 120);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`R2_GET ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

function vozRefKey(wsId, vozId) {
  return `voz-samples/${wsId}/${vozId}`;
}

function vozCacheKey(wsId, vozId, texto) {
  // determinista: mismo texto+voz → caché hit sin exponer contenido
  return `voz-cache/${wsId}/${vozId}/${vozHashSync(texto)}.wav`;
}

function vozHashSync(texto) {
  // FNV-1a 32bit ×2 — suficiente para caché (no cripto, colisiones ~imposibles
  // con texto del usuario dentro del bucket de un workspace)
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    h1 = ((h1 ^ c) * 16777619) >>> 0;
    h2 = ((h2 + c * (i + 1)) * 2654435761) >>> 0;
  }
  return `${h1.toString(16)}${h2.toString(16)}`;
}

// ── Llamada al backend Chatterbox (Oracle A1) ──
async function vozBackendSintetiza(cfg, { texto, sampleBytes, mimeType, idioma }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), VOZ_BACKEND_TIMEOUT_MS);
  try {
    const r = await fetch(`${cfg.url}/sintetizar`, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${cfg.secret}`,
      },
      body: JSON.stringify({
        texto,
        sampleBase64: Buffer.from(sampleBytes).toString("base64"),
        mimeType: mimeType || "audio/mpeg",
        idioma: idioma || "es",
      }),
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(json.message || json.error || `backend ${r.status}`);
      e.code = json.code || "BACKEND_FAIL";
      throw e;
    }
    return json; // {audioBase64, mimeType, engine, rtf, seconds}
  } finally {
    clearTimeout(timer);
  }
}

async function elClonar(key, nombre, audioBytes, mime) {
  const fd = new FormData();
  fd.append("name", nombre);
  const ext = (mime || "audio/mpeg").includes("wav") ? "wav" : "mp3";
  fd.append("files", new Blob([audioBytes], { type: mime || "audio/mpeg" }), `ref.${ext}`);
  const res = await fetch(`${ELEVENLABS_API_BASE}/voices/add`, {
    method: "POST",
    headers: { "xi-api-key": key },
    body: fd,
    signal: AbortSignal.timeout(120_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(json?.detail?.message || `ElevenLabs voices/add ${res.status}`);
    e.upstream = JSON.stringify(json).slice(0, 300);
    throw e;
  }
  return json; // {voice_id, ...}
}

// ── Handler ──
export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
  }

  const bearer = (event.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return err(401, "AUTH", "Authentication required.");

  const sb = getSupabaseAdmin();
  if (!sb) return err(503, "NO_DB", "Database not configured on the server.");

  let userId;
  try {
    const { data, error } = await sb.auth.getUser(bearer);
    if (error || !data?.user) return err(401, "AUTH", "Invalid session.");
    userId = data.user.id;
  } catch {
    return err(401, "AUTH", "Invalid session.");
  }

  const path = (event.path || "").replace(/^\/+|\/+$/g, "");
  const segments = path.split("/").map((s) => decodeURIComponent(s));
  // segments: ['api', 'musa-voz', ...resto]
  const sub = segments.slice(2).join("/");
  const metodo = event.httpMethod || "GET";

  const tablaOk = await vocesTablaOk(sb);

  try {
    // ── GET /api/musa-voz/stock ──
    if (metodo === "GET" && sub === "stock") {
      const ai = getAI();
      return jsonBody(200, {
        stock: [STOCK_ES, STOCK_EN],
        backend: {
          aiBinding: !!ai,
          once: "neurons gratis de Cloudflare; $0 para el usuario",
        },
        cuota: { charsDia: QUOTA_CHARS_DIA },
      });
    }

    // ── GET /api/musa-voz/voces — librería ──
    if (metodo === "GET" && sub === "voces") {
      if (!tablaOk) {
        return err(503, "MIGRATION_PENDING",
          "La librería de voces necesita la migración supabase_migrations/musa_voces.sql (ejecútala en el SQL Editor).");
      }
      const wsId = await resolverWorkspace(sb, userId);
      const { data, error } = await sb
        .from("musa_voces")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) return err(500, "DB", error.message);
      // RLS filtra por workspace; además solo mostramos voces del workspace propio
      const mias = (data || []).filter((v) => !wsId || v.workspace_id === wsId);
      return jsonBody(200, { stock: [STOCK_ES, STOCK_EN], mias });
    }

    // ── POST /api/musa-voz/voces — guardar voz stock como favorita / entrada manual ──
    if (metodo === "POST" && sub === "voces") {
      if (!tablaOk) return err(503, "MIGRATION_PENDING",
        "Ejecuta supabase_migrations/musa_voces.sql para usar la librería.");
      const body = parseHandlerJson(event);
      const { nombre, tipo, proveedor, voiceRef, idiomas, params } = body || {};
      if (!nombre || !tipo) return err(400, "VALIDATION", "nombre y tipo son obligatorios.");
      const wsId = await resolverWorkspace(sb, userId);
      if (!wsId) return err(400, "NO_WORKSPACE", "No tienes un workspace.");
      const id = vocId();
      const { data, error } = await sb
        .from("musa_voces")
        .insert({
          id, workspace_id: wsId, user_id: userId,
          nombre, tipo, proveedor: proveedor || (tipo === "stock" ? "workers-ai" : tipo),
          voice_ref: voiceRef || {}, idiomas: idiomas || ["es"], params: params || {},
        })
        .select()
        .single();
      if (error) return err(500, "DB", error.message);
      return jsonBody(200, { voz: data });
    }

    // ── PATCH/DELETE /api/musa-voz/voces/:id ──
    const mVoz = sub.match(/^voces\/([^/]+)$/);
    if (mVoz && (metodo === "PATCH" || metodo === "DELETE")) {
      if (!tablaOk) return err(503, "MIGRATION_PENDING",
        "Ejecuta supabase_migrations/musa_voces.sql para usar la librería.");
      const id = mVoz[1];
      if (metodo === "PATCH") {
        const body = parseHandlerJson(event);
        const patch = {};
        for (const f of ["nombre", "params", "idiomas"]) {
          if (body && body[f] !== undefined) patch[f] = body[f];
        }
        patch.updated_at = new Date().toISOString();
        const { data, error } = await sb
          .from("musa_voces").update(patch).eq("id", id)
          .eq("user_id", userId).select().single();
        if (error) return err(404, "NOT_FOUND", "Voz no encontrada (o no es tuya).");
        return jsonBody(200, { voz: data });
      }
      // DELETE: dueño solamente; el clip ref de storage se limpia best-effort
      const { data: row } = await sb.from("musa_voces")
        .select("id, user_id, proveedor, voice_ref").eq("id", id).maybeSingle();
      if (!row || row.user_id !== userId) return err(404, "NOT_FOUND", "Voz no encontrada.");
      const { error } = await sb.from("musa_voces").delete().eq("id", id).eq("user_id", userId);
      if (error) return err(500, "DB", error.message);
      return jsonBody(200, { ok: true });
    }

    // ── POST /api/musa-voz/clonar ──
    if (metodo === "POST" && sub === "clonar") {
      const body = parseHandlerJson(event);
      const { nombre, audioBase64, mimeType, idioma, proveedor } = body || {};
      if (!nombre || !audioBase64) {
        return err(400, "VALIDATION", "nombre y audioBase64 son obligatorios.");
      }
      const prov = proveedor || "elevenlabs";

      if (prov === "elevenlabs") {
        // BYOK del usuario — camino completo disponible hoy
        const { key } = await getUserKey(userId, "elevenlabs");
        if (!key) {
          return err(409, "ELEVENLABS_KEY_MISSING",
            "Necesitas tu key de ElevenLabs (Configuración › Integraciones) para clonar con ElevenLabs.");
        }
        const audioBytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
        if (audioBytes.length > 25 * 1024 * 1024) {
          return err(413, "TOO_LARGE", "El clip supera 25 MB.");
        }
        const json = await elClonar(key, nombre, audioBytes, mimeType);
        // Si hay migración, guardar en la librería; si no, devolver el voiceId
        if (tablaOk) {
          const wsId = await resolverWorkspace(sb, userId);
          const id = vocId();
          const { data, error } = await sb.from("musa_voces").insert({
            id, workspace_id: wsId, user_id: userId, nombre,
            tipo: "clon", proveedor: "elevenlabs",
            voice_ref: { voiceId: json.voice_id, proveedorOriginal: "elevenlabs" },
            idiomas: idioma ? [idioma] : ["es", "en"], params: {},
          }).select().single();
          if (error) return err(500, "DB", error.message);
          return jsonBody(200, { voz: data });
        }
        return jsonBody(200, {
          voz: { id: json.voice_id, nombre, tipo: "clon", proveedor: "elevenlabs",
                 voice_ref: { voiceId: json.voice_id } },
          nota: "Librería pendiente de migración — la voz vive en tu cuenta ElevenLabs.",
        });
      }

      // clon gratis (proveedor workers-ai): sample → R2, voz → librería
      const audioBytesClon = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
      if (audioBytesClon.length > 26 * 1024 * 1024) {
        return err(413, "TOO_LARGE", "El clip supera 26 MB.");
      }
      const r2c = vozR2Config();
      if (!r2c) {
        return err(503, "R2_NOT_CONFIGURED",
          "Falta configuración R2 (R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY + bucket musa-voz) para guardar el sample del clon.");
      }
      if (!tablaOk) {
        return err(503, "MIGRATION_PENDING",
          "Ejecuta supabase_migrations/musa_voces.sql para guardar clones propios.");
      }
      const wsId = await resolverWorkspace(sb, userId);
      const id = vocId();
      const { data, error } = await sb.from("musa_voces").insert({
        id, workspace_id: wsId, user_id: userId, nombre,
        tipo: "clon", proveedor: "workers-ai",
        voice_ref: { mimeType: mimeType || "audio/mpeg", bytes: audioBytesClon.length },
        idiomas: idioma ? [idioma] : ["es"], params: {},
      }).select().single();
      if (error) return err(500, "DB", error.message);
      try {
        await r2Put(r2c, vozRefKey(wsId, id), audioBytesClon, mimeType || "audio/mpeg");
      } catch (e) {
        await sb.from("musa_voces").delete().eq("id", id);
        return err(502, "R2_PUT", "No se pudo guardar el sample en R2: " + e.message);
      }
      return jsonBody(200, {
        voz: data,
        nota: "Clon creado. La síntesis corre en el backend Chatterbox (CPU: ~1 min de espera por minuto de audio).",
      });
    }

    // ── POST /api/musa-voz/sintetizar ──
    if (metodo === "POST" && sub === "sintetizar") {
      const body = parseHandlerJson(event);
      const { vozId, texto, speaker, idioma } = body || {};
      if (!texto || !texto.trim()) return err(400, "VALIDATION", "texto vacío.");
      if (texto.length > TTS_MAX_CHARS) {
        return err(413, "TOO_LONG", `Máximo ${TTS_MAX_CHARS} chars por llamada.`);
      }
      const ai = getAI();
      if (!ai) return err(503, "NO_AI_BINDING",
        "El worker no tiene el binding AI (añade [ai] a wrangler.toml y redeploya).");

      // Cuota
      const usado = await consumoHoy(sb, userId, tablaOk);
      if (usado + texto.length > QUOTA_CHARS_DIA) {
        return err(429, "QUOTA", `Cuota diaria alcanzada (${QUOTA_CHARS_DIA} chars). Renovar a medianoche UTC.`);
      }

      // ¿voz stock o de la librería?
      let voz = null;
      if (vozId) {
        if (tablaOk && vozId.startsWith("voc_")) {
          const { data } = await sb.from("musa_voces")
            .select("*").eq("id", vozId).maybeSingle();
          voz = data || null;
        }
        if (!voz) {
          // puede ser un voiceId de ElevenLabs (stock BYOK o clon creado allá)
          voz = { tipo: "elevenlabs", proveedor: "elevenlabs", voice_ref: { voiceId: vozId }, nombre: "ElevenLabs", params: {} };
        }
      } else {
        // stock directo: {speaker, idioma} en el body
        const cat = (idioma === "en") ? STOCK_EN : STOCK_ES;
        const sp = cat.speakers.find((s) => s.id === (speaker || "carina")) || cat.speakers[0];
        voz = { tipo: "stock", proveedor: "workers-ai", voice_ref: { modelo: cat.modelo, speaker: sp.id }, nombre: sp.nombre };
      }

      let bytes, mime;
      if (voz.proveedor === "elevenlabs" || (voz.tipo === "elevenlabs")) {
        const { key } = await getUserKey(userId, "elevenlabs");
        if (!key) return err(409, "ELEVENLABS_KEY_MISSING",
          "Esa voz es de ElevenLabs y no tienes key configurada (Configuración › Integraciones).");
        const out = await elTts(key, voz.voice_ref.voiceId, texto, voz.params);
        bytes = out.bytes; mime = out.mime;
      } else if (voz.tipo === "clon" && voz.proveedor === "workers-ai") {
        const cfgVoz = vozConfig();
        const r2v = vozR2Config();
        if (!cfgVoz || !r2v) {
          return err(503, "BACKEND_NOT_CONFIGURED",
            "El clon propio requiere VOZ_BACKEND_URL/VOZ_BACKEND_SECRET y el bucket R2 musa-voz configurados en el worker.");
        }
        // 1) caché determinista por (workspace, voz, texto)
        const cacheK = vozCacheKey(voz.workspace_id, voz.id, texto);
        try {
          const cached = await r2Get(r2v, cacheK);
          await registrarConsumo(sb, userId, texto.length, tablaOk);
          return jsonBody(200, {
            audioBase64: Buffer.from(cached).toString("base64"),
            mimeType: "audio/wav",
            chars: texto.length,
            cached: true,
            voz: { id: vozId, nombre: voz.nombre, tipo: voz.tipo, proveedor: voz.proveedor },
            quota: { usado: usado + texto.length, limite: QUOTA_CHARS_DIA },
          });
        } catch { /* sin caché → backend */ }
        // 2) sample desde R2
        let sampleBytes;
        try {
          sampleBytes = await r2Get(r2v, vozRefKey(voz.workspace_id, voz.id));
        } catch {
          return err(410, "SAMPLE_MISSING", "El sample de esta voz ya no existe en R2 — vuelve a clonarla.");
        }
        // 3) backend Chatterbox
        const vr = voz.voice_ref || {};
        let out;
        try {
          out = await vozBackendSintetiza(cfgVoz, {
            texto, sampleBytes,
            mimeType: vr.mimeType,
            idioma: (voz.idiomas || ["es"])[0],
          });
        } catch (e) {
          if (e.code === "TOO_LONG") return err(413, "TOO_LONG", e.message);
          return err(502, "BACKEND_FAIL", "El backend de voz falló: " + e.message);
        }
        bytes = Uint8Array.from(atob(out.audioBase64), (c) => c.charCodeAt(0));
        mime = "audio/wav";
        // 4) caché best-effort (TTL 24h gestionado por lifecycle del bucket)
        try { await r2Put(r2v, cacheK, bytes, "audio/wav"); } catch {}
      } else {
        // stock Workers AI
        const vr = voz.voice_ref || {};
        const modelo = vr.modelo || ((idioma === "en") ? STOCK_EN.modelo : STOCK_ES.modelo);
        const sp = vr.speaker || speaker || "carina";
        bytes = await ttsStock(ai, modelo, sp, texto);
        mime = "audio/mpeg";
      }

      await registrarConsumo(sb, userId, texto.length, tablaOk);
      const nuevoUsado = usado + texto.length;
      return jsonBody(200, {
        audioBase64: Buffer.from(bytes).toString("base64"),
        mimeType: mime,
        chars: texto.length,
        voz: { id: vozId || null, nombre: voz.nombre, tipo: voz.tipo, proveedor: voz.proveedor },
        quota: { usado: nuevoUsado, limite: QUOTA_CHARS_DIA },
      });
    }

    return err(404, "NO_ROUTE", `Ruta desconocida: ${metodo} /api/musa-voz/${sub}`);
  } catch (e) {
    console.error("[musa-voz]", e?.message || e);
    const upstream = e?.upstream ? { upstream: e.upstream } : {};
    return jsonBody(500, { error: e?.message || "Error interno.", code: "INTERNAL", ...upstream });
  }
}
