/**
 * musa-clon.mjs — REQ-072: clones propios de Musa (nuestro «HeyGen»), gratis.
 *
 * Personas (sesión Supabase):
 *   GET    /api/musa-clon/estado?ws=          → motor encendido, cola y cuota del día
 *   GET    /api/musa-clon/clones?ws=          → clones Musa del espacio (+ retrato firmado)
 *   POST   /api/musa-clon/clones              → {workspaceId, name, source:'take'|'photo', takeId?, photoBase64?, photoMime?, consent:true, brandId?}
 *   DELETE /api/musa-clon/clones/:id          → borra el clon, sus trabajos y sus archivos en R2
 *   POST   /api/musa-clon/videos              → {cloneId, script, vozId?, speaker?, idioma?, audioBase64?, audioMime?, aspect, title}
 *   GET    /api/musa-clon/jobs?cloneId=|ws=   → trabajos (con URL firmada del MP4 cuando terminan)
 *   GET    /api/musa-clon/jobs/:id            → un trabajo + posición en la cola
 *   POST   /api/musa-clon/jobs/:id/cancel     → cancela si sigue en cola
 *
 * Motor (Oracle A1, pull; Authorization: Bearer MUSA_CLON_ENGINE_SECRET):
 *   POST /api/musa-clon/engine/claim | progress | complete | fail
 *
 * Diseño: la voz la produce Musa Voz (REQ-071) antes de encolar; el motor solo
 * hace video. Todo archivo vive en R2 (bucket musa-voz) y se entrega con URLs
 * firmadas de vida corta. La cola es Supabase (musa_clon_jobs, migración 45).
 */

import { getSupabaseAdmin } from "../../../api/src/services/supabase.js";
import { parseHandlerJson } from "./http-encoding.mjs";
import { r2ConfigFromEnv, presignR2Url } from "./r2-presign.mjs";
import { musaVozCore } from "./musa-voz.mjs";
import { getUserKey } from "./keys.mjs";
import { callHeygen } from "./heygen.mjs";
import { buildAvatarVideoBody, heygenErrorPayload, normalizeAvatarLooks, normalizeVideoStatus } from "../../../shared/heygenMappers.ts";

const CUOTA_SEG_DIA = Number(process.env.MUSA_CLON_CUOTA_SEG || 180);
const MAX_SCRIPT = 1500;            // ~90 s de voz
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const MOTOR_ONLINE_SEG = 120;       // último latido para considerarlo encendido
const URL_MOTOR_SEG = 6 * 3600;     // las URLs del motor viven lo que dura un render largo
const URL_UI_SEG = 3600;
const ASPECTS = new Set(["9:16", "1:1", "16:9"]);
/* Topes para no pasar nunca de lo gratis de R2 (10 GB, compartido con Musa Voz) */
const TOPE_ESPACIO = Number(process.env.MUSA_CLON_TOPE_ESPACIO || 1.5 * 1024 ** 3);
const TOPE_TOTAL = Number(process.env.MUSA_CLON_TOPE_TOTAL || 8 * 1024 ** 3);
const mb = (b) => `${Math.round(Number(b || 0) / 1048576)} MB`;

function cors(extra = {}) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
    ...extra,
  };
}
const json = (statusCode, data) => ({ statusCode, headers: cors(), body: JSON.stringify(data) });
const err = (statusCode, code, mensaje) => json(statusCode, { error: mensaje, code });

const hoyUTC = () => new Date().toISOString().slice(0, 10);
const uid12 = () => {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
};

/* ── R2 ── */
function vozR2() {
  const cfg = r2ConfigFromEnv();
  return cfg ? { ...cfg, bucket: process.env.R2_VOZ_BUCKET || "musa-voz" } : null;
}
function takesR2() {
  return r2ConfigFromEnv();
}
const sign = (cfg, method, key, seg) => presignR2Url(cfg, method, key, seg);

async function r2PutBytes(cfg, key, bytes, mime) {
  const url = await sign(cfg, "PUT", key, 120);
  const r = await fetch(url, { method: "PUT", headers: { "Content-Type": mime || "application/octet-stream" }, body: bytes });
  if (!r.ok) throw new Error(`R2_PUT ${r.status}`);
}
async function r2Delete(cfg, key) {
  if (!key) return;
  try {
    const url = await sign(cfg, "DELETE", key, 120);
    await fetch(url, { method: "DELETE" });
  } catch { /* best-effort */ }
}
/** Copia un objeto entre buckets sin cargarlo entero en memoria (FixedLengthStream de Workers). */
async function r2Copy(fromCfg, fromKey, toCfg, toKey, mime) {
  return urlToR2(await sign(fromCfg, "GET", fromKey, 300), toCfg, toKey, mime);
}
/** Trae un archivo por URL (R2 firmado, HeyGen…) y lo guarda en R2 en streaming. Devuelve los bytes. */
async function urlToR2(url, toCfg, toKey, mime) {
  const src = await fetch(url, { redirect: "follow" });
  if (!src.ok || !src.body) throw new Error(`GET ${src.status}`);
  const len = Number(src.headers.get("content-length") || 0);
  let body;
  if (len > 0 && typeof FixedLengthStream === "function") {
    const fls = new FixedLengthStream(len);
    src.body.pipeTo(fls.writable);
    body = fls.readable;
  } else {
    body = await src.arrayBuffer();
  }
  const put = await fetch(await sign(toCfg, "PUT", toKey, 300), {
    method: "PUT",
    headers: { "Content-Type": mime || src.headers.get("content-type") || "application/octet-stream" },
    body,
  });
  if (!put.ok) throw new Error(`R2_PUT ${put.status}`);
  return len;
}

const clonDir = (ws, cloneId) => `clones/${ws}/${cloneId}`;
const extDe = (mime) => ({ "video/webm": "webm", "video/mp4": "mp4", "video/quicktime": "mov", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/webm": "webm", "audio/mp4": "m4a", "audio/ogg": "ogg" }[String(mime || "").split(";")[0]] || "bin");

function b64ToBytes(b64) {
  const clean = String(b64 || "").replace(/^data:[^,]*,/, "");
  return Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
}

/* ── Permisos ── */
const RANK = { viewer: 1, editor: 2, admin: 3, owner: 4 };
async function rolEn(sb, ws, userId) {
  if (!ws) return null;
  const { data, error } = await sb.rpc("workspace_role_for", { target_workspace: ws, target_user: userId });
  if (error) return null;
  return data || null;
}
async function exigeRol(sb, ws, userId, minimo) {
  const rol = await rolEn(sb, ws, userId);
  if (!rol || (RANK[rol] || 0) < RANK[minimo]) {
    const e = new Error(minimo === "viewer" ? "No tienes acceso a este espacio." : "Necesitas permiso de edición en este espacio.");
    e.status = 403; e.code = "FORBIDDEN";
    throw e;
  }
  return rol;
}

/* ── Lecturas compartidas ── */
async function motorEstado(sb) {
  const { data } = await sb.from("musa_clon_motor").select("worker,last_seen,info").order("last_seen", { ascending: false }).limit(5);
  const vivo = (data || []).find((m) => Date.now() - Date.parse(m.last_seen) < MOTOR_ONLINE_SEG * 1000) || null;
  return {
    online: !!vivo,
    lastSeen: data?.[0]?.last_seen || null,
    worker: vivo?.worker || null,
    info: vivo?.info || null,
  };
}
async function almacenamiento(sb, ws) {
  const { data } = await sb.rpc("musa_clon_bytes", { p_ws: ws });
  const r = Array.isArray(data) ? data[0] : data;
  return { espacio: Number(r?.espacio || 0), total: Number(r?.total || 0), topeEspacio: TOPE_ESPACIO, topeTotal: TOPE_TOTAL };
}
function exigeEspacio(a, extra = 0) {
  if (a.total + extra > TOPE_TOTAL) {
    const e = new Error("El almacenamiento gratis de clones de Musa está lleno por hoy. Inténtalo más tarde.");
    e.status = 507; e.code = "STORAGE_FULL"; throw e;
  }
  if (a.espacio + extra > TOPE_ESPACIO) {
    const e = new Error(`Este espacio ya guarda ${mb(a.espacio)} de clones (tope ${mb(TOPE_ESPACIO)}). Borra videos o clones viejos para seguir.`);
    e.status = 507; e.code = "STORAGE_FULL"; throw e;
  }
}
/* ── Plan: los clones propios de Musa son del plan Empresa (más admins y corporativas) ── */
async function habilitado(sb, ws) {
  const { data } = await sb.rpc("musa_clon_habilitado", { p_ws: ws });
  return data === true;
}
function errPlan() {
  const e = new Error("Los clones propios de Musa están habilitados en el plan Empresa. Mientras tanto, conecta tu API de HeyGen y trae tus clones a Musa: los videos los genera HeyGen y Musa los deja en tu editor.");
  e.status = 402; e.code = "PLAN_REQUIRED";
  return e;
}

/* ── HeyGen con la llave de cada persona: HeyGen genera el video, Musa lo importa a su editor ── */
async function llaveHeygen(userId) {
  try { const { key } = await getUserKey(userId, "heygen"); return key || null; } catch { return null; }
}
function errHeygenSinLlave() {
  const e = new Error("Conecta tu API de HeyGen en Configuración › Integraciones para usar tus clones de HeyGen.");
  e.status = 409; e.code = "HEYGEN_KEY_MISSING";
  return e;
}

/** Pide el video a HeyGen (con la llave de la persona) y deja el trabajo en Musa para importarlo al terminar. */
async function videoHeygen(sb, cfg, clone, userId, b) {
  const key = await llaveHeygen(userId);
  if (!key) throw errHeygenSinLlave();
  if (!clone.external_id) return err(409, "CLONE_NOT_READY", "Este clon de HeyGen no tiene identificador; vuelve a traer tus clones.");
  if (clone.status !== "listo") return err(409, "CLONE_NOT_READY", "HeyGen todavía está entrenando este clon.");
  const script = String(b.script || "").trim();
  if (!script) return err(400, "VALIDATION", "Escribe el guion.");
  if (script.length > 5000) return err(413, "TOO_LONG", "El guion supera 5000 caracteres.");
  exigeEspacio(await almacenamiento(sb, clone.workspace_id), 40 * 1048576);
  const aspect = ASPECTS.has(b.aspect) ? b.aspect : "9:16";
  const title = String(b.title || script.slice(0, 60) || "Video con clon").slice(0, 120);
  let body;
  try {
    body = buildAvatarVideoBody({ avatarId: clone.external_id, script, aspectRatio: aspect, voiceId: b.heygenVoiceId || null, title });
  } catch (e) {
    return err(400, e?.code || "HEYGEN_BAD_REQUEST", e?.message || "Datos inválidos para HeyGen.");
  }
  const r = await callHeygen(key, "POST", "/v3/videos", body);
  if (!r.ok) {
    const m = heygenErrorPayload(r.status || 502, r.payload);
    return json(r.status && r.status < 500 ? r.status : 502, { error: m.message || "HeyGen rechazó el pedido.", code: m.error || "HEYGEN_FAIL" });
  }
  const st = normalizeVideoStatus(r.payload);
  if (!st.videoId) return err(502, "HEYGEN_FAIL", "HeyGen no devolvió el video.");
  const ahora = new Date().toISOString();
  const { data: job, error } = await sb.from("musa_clon_jobs").insert({
    workspace_id: clone.workspace_id, clone_id: clone.id, kind: "render", provider: "heygen", status: "running",
    external_id: st.videoId, title, script, aspect, voice: { proveedor: "heygen", voiceId: b.heygenVoiceId || null },
    created_by: userId, started_at: ahora, heartbeat_at: ahora, progress: 1,
  }).select().single();
  if (error) return err(500, "DB", error.message);
  return json(200, { job: { ...(await conUrls(cfg, job)), position: 0 }, motor: { online: true, proveedor: "heygen" } });
}

/** Revisa en HeyGen un video en curso; al terminar lo importa a R2 (los enlaces de HeyGen vencen). */
async function refrescarHeygen(sb, cfg, job) {
  if (!job || job.provider !== "heygen" || job.status !== "running" || job.worker === "importando") return job;
  if (job.heartbeat_at && Date.now() - Date.parse(job.heartbeat_at) < 12000) return job;
  const ahora = new Date().toISOString();
  const key = await llaveHeygen(job.created_by);
  if (!key) return job;
  const r = await callHeygen(key, "GET", `/v3/videos/${encodeURIComponent(job.external_id || "")}`);
  if (!r.ok) {
    await sb.from("musa_clon_jobs").update({ heartbeat_at: ahora }).eq("id", job.id);
    return job;
  }
  const st = normalizeVideoStatus(r.payload);
  if (st.phase === "failed") {
    const error = st.errorMessage || "HeyGen no pudo generar el video.";
    await sb.from("musa_clon_jobs").update({ status: "error", error, finished_at: ahora, heartbeat_at: ahora }).eq("id", job.id);
    return { ...job, status: "error", error };
  }
  if (st.phase !== "ready" || !st.videoUrl) {
    const progress = Math.max(job.progress || 0, Math.min(95, Math.round(Number(st.progressPct) || 0)));
    await sb.from("musa_clon_jobs").update({ progress, heartbeat_at: ahora }).eq("id", job.id);
    return { ...job, progress, heartbeat_at: ahora };
  }
  // un solo import aunque lleguen dos consultas a la vez
  const { data: lock } = await sb.from("musa_clon_jobs").update({ worker: "importando", heartbeat_at: ahora, progress: 96 })
    .eq("id", job.id).eq("status", "running").is("worker", null).select("id");
  if (!lock || !lock.length || !cfg) return job;
  const dir = clonDir(job.workspace_id, job.clone_id);
  try {
    const outKey = `${dir}/videos/${job.id}.mp4`;
    const bytes = await urlToR2(st.videoUrl, cfg, outKey, "video/mp4");
    let posterKey = null, pbytes = 0;
    if (st.thumbnailUrl) {
      try {
        pbytes = await urlToR2(st.thumbnailUrl, cfg, `${dir}/videos/${job.id}.jpg`, "image/jpeg");
        posterKey = `${dir}/videos/${job.id}.jpg`;
      } catch { /* sin póster: el video igual queda */ }
    }
    const done = { status: "done", progress: 100, worker: null, output_key: outKey, poster_key: posterKey, seconds: st.durationSec || null, bytes: bytes + pbytes, finished_at: ahora, heartbeat_at: ahora, error: null };
    await sb.from("musa_clon_jobs").update(done).eq("id", job.id);
    return { ...job, ...done };
  } catch {
    await sb.from("musa_clon_jobs").update({ worker: null, error: "No se pudo traer el video de HeyGen todavía; se reintenta solo." }).eq("id", job.id);
    return job;
  }
}

/** Trae a Musa los clones propios de la cuenta HeyGen de la persona (ownership=private, todas las páginas). */
async function sincronizarHeygen(sb, ws, userId, key) {
  const looks = [];
  let token = null;
  for (let pag = 0; pag < 6; pag++) {
    const qs = new URLSearchParams({ ownership: "private", limit: "100" });
    if (token) qs.set("token", token);
    const r = await callHeygen(key, "GET", `/v3/avatars/looks?${qs.toString()}`);
    if (!r.ok) {
      const m = heygenErrorPayload(r.status || 502, r.payload);
      const e = new Error(m.message || "HeyGen no respondió.");
      e.status = r.status && r.status < 500 ? r.status : 502; e.code = m.error || "HEYGEN_FAIL";
      throw e;
    }
    looks.push(...normalizeAvatarLooks(r.payload));
    const d = r.payload?.data || r.payload || {};
    token = d.next_token || d.nextToken || null;
    if (!token || !(d.has_more ?? d.hasMore)) break;
  }
  const { data: ya } = await sb.from("workspace_clones").select("id,external_id,status,name,preview_url").eq("workspace_id", ws).eq("provider", "heygen");
  const porId = new Map((ya || []).map((c) => [c.external_id, c]));
  let nuevos = 0, actualizados = 0;
  for (const l of looks) {
    const status = l.ready ? "listo" : l.status === "failed" ? "error" : "entrenando";
    const prev = porId.get(l.id);
    if (!prev) {
      const { error } = await sb.from("workspace_clones").insert({ workspace_id: ws, kind: "avatar", provider: "heygen", external_id: l.id, name: l.name, status, preview_url: l.previewImageUrl, consent: true, created_by: userId });
      if (!error) nuevos++;
    } else if (prev.status !== status || prev.name !== l.name || prev.preview_url !== l.previewImageUrl) {
      await sb.from("workspace_clones").update({ status, name: l.name, preview_url: l.previewImageUrl, updated_at: new Date().toISOString() }).eq("id", prev.id);
      actualizados++;
    }
  }
  return { total: looks.length, nuevos, actualizados };
}

async function cuotaHoy(sb, ws) {
  const { data } = await sb.from("musa_clon_uso").select("segundos").eq("workspace_id", ws).eq("dia", hoyUTC()).maybeSingle();
  return Number(data?.segundos || 0);
}
async function posicionEnCola(sb, job) {
  if (job.status !== "queued") return 0;
  const { count } = await sb.from("musa_clon_jobs").select("id", { count: "exact", head: true })
    .eq("provider", "musa").eq("status", "queued").lt("created_at", job.created_at);
  return (count || 0) + 1;
}
/* ── Medios con URL estable: /api/musa-clon/media/<tipo>/<id>/<firma>.<ext> → 302 a R2 firmado ──
 * La firma (HMAC del secreto del motor) hace la URL imposible de adivinar y sirve para siempre
 * dentro de proyectos de video, sin exponer el bucket ni depender de la sesión. */
const MEDIA_EXT = { v: "mp4", p: "jpg", r: "png", m: "jpg" };
async function mediaSig(tipo, id) {
  const secret = process.env.MUSA_CLON_ENGINE_SECRET || process.env.R2_SECRET_ACCESS_KEY || "";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`musa-clon-media:${tipo}:${id}`)));
  return [...mac.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
let ORIGIN = "";
async function mediaUrl(tipo, id) {
  return `${ORIGIN}/api/musa-clon/media/${tipo}/${id}/${await mediaSig(tipo, id)}.${MEDIA_EXT[tipo]}`;
}
async function conUrls(_cfg, job) {
  const out = { ...job };
  if (job.status === "done") {
    if (job.output_key) out.video_url = await mediaUrl("v", job.id);
    if (job.poster_key) out.poster_url = await mediaUrl("p", job.id);
  }
  delete out.audio_key; delete out.worker;
  return out;
}
async function clonPublico(_cfg, c) {
  const out = {
    id: c.id, name: c.name, status: c.status, provider: c.provider, engine: c.engine,
    source_kind: c.source_kind, voice_id: c.voice_id, brand_id: c.brand_id, external_id: c.external_id || null,
    consent_at: c.consent_at, created_at: c.created_at, meta: c.meta || {},
  };
  if (c.portrait_key) out.portrait_url = await mediaUrl("r", c.id);
  else if (c.provider === "heygen" && c.preview_url) out.portrait_url = c.preview_url;
  if (c.meta?.preview_key) out.preview_url = await mediaUrl("m", c.id);
  return out;
}

/* ── Voz: Musa Voz produce el audio del guion ── */
async function sintetizarConMusaVoz(userId, sb, { script, vozId, speaker, idioma }) {
  const res = await musaVozCore({
    httpMethod: "POST",
    path: "/api/musa-voz/sintetizar",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ texto: script, vozId: vozId || undefined, speaker: speaker || undefined, idioma: idioma || undefined }),
  }, userId, sb);
  const data = JSON.parse(res.body || "{}");
  if (res.statusCode !== 200) {
    const e = new Error(data.error || "No se pudo generar la voz.");
    e.status = res.statusCode; e.code = data.code || "VOZ_FAIL";
    throw e;
  }
  return { bytes: b64ToBytes(data.audioBase64), mime: data.mimeType || "audio/mpeg" };
}

/** Estimación previa de duración (se corrige con los segundos reales al terminar). */
const segundosEstimados = (script) => Math.max(3, Math.round(String(script).trim().split(/\s+/).length / 2.4));

/* ═════════════════════════ Motor ═════════════════════════ */
async function engineRoutes(sb, metodo, sub, body) {
  const cfg = vozR2();
  if (!cfg) return err(503, "R2_NOT_CONFIGURED", "Falta la configuración R2 del worker.");
  const worker = String(body?.worker || "motor").slice(0, 60);

  if (metodo === "POST" && sub === "engine/claim") {
    const { data, error } = await sb.rpc("musa_clon_claim", { p_worker: worker, p_info: body?.info || {} });
    if (error) return err(500, "DB", error.message);
    const job = Array.isArray(data) ? data[0] : data;
    if (!job) return json(200, { job: null });
    const { data: clone } = await sb.from("workspace_clones").select("*").eq("id", job.clone_id).maybeSingle();
    if (!clone) {
      await sb.from("musa_clon_jobs").update({ status: "error", error: "El clon ya no existe.", finished_at: new Date().toISOString() }).eq("id", job.id);
      return json(200, { job: null });
    }
    const dir = clonDir(job.workspace_id, clone.id);
    const inputs = {}, outputs = {};
    if (job.kind === "prepare") {
      inputs.source = await sign(cfg, "GET", clone.source_key, URL_MOTOR_SEG);
      outputs.portrait = await sign(cfg, "PUT", `${dir}/portrait.png`, URL_MOTOR_SEG);
      outputs.preview = await sign(cfg, "PUT", `${dir}/preview.jpg`, URL_MOTOR_SEG);
      if (clone.source_kind === "take") {
        const vozId = `voc_${uid12()}`;
        outputs.voice_sample = await sign(cfg, "PUT", `voz-samples/${job.workspace_id}/${vozId}`, URL_MOTOR_SEG);
        outputs.voice_id = vozId;
      }
    } else {
      inputs.portrait = await sign(cfg, "GET", clone.portrait_key || clone.source_key, URL_MOTOR_SEG);
      inputs.audio = await sign(cfg, "GET", job.audio_key, URL_MOTOR_SEG);
      outputs.video = await sign(cfg, "PUT", `${dir}/videos/${job.id}.mp4`, URL_MOTOR_SEG);
      outputs.poster = await sign(cfg, "PUT", `${dir}/videos/${job.id}.jpg`, URL_MOTOR_SEG);
    }
    return json(200, {
      job: { id: job.id, kind: job.kind, aspect: job.aspect, title: job.title, attempts: job.attempts },
      clone: { id: clone.id, name: clone.name, source_kind: clone.source_kind, engine: clone.engine || "ditto" },
      inputs, outputs,
    });
  }

  const jobId = String(body?.jobId || "");
  if (!jobId) return err(400, "VALIDATION", "jobId requerido.");
  const { data: job } = await sb.from("musa_clon_jobs").select("*").eq("id", jobId).maybeSingle();
  if (!job) return err(404, "NOT_FOUND", "Trabajo inexistente.");
  if (job.status !== "running" || job.worker !== worker) return err(409, "NOT_OWNER", "Ese trabajo no está corriendo en este motor.");
  const ahora = new Date().toISOString();

  if (metodo === "POST" && sub === "engine/progress") {
    const progress = Math.max(0, Math.min(99, Math.round(Number(body?.progress) || 0)));
    await sb.from("musa_clon_jobs").update({ progress, heartbeat_at: ahora }).eq("id", jobId);
    await sb.from("musa_clon_motor").upsert({ worker, last_seen: ahora, info: body?.info || {} });
    return json(200, { ok: true, cancelled: false });
  }

  if (metodo === "POST" && sub === "engine/complete") {
    const r = body?.result || {};
    const dir = clonDir(job.workspace_id, job.clone_id);
    if (job.kind === "prepare") {
      const { data: cprev } = await sb.from("workspace_clones").select("bytes").eq("id", job.clone_id).maybeSingle();
      const patch = { status: "listo", portrait_key: `${dir}/portrait.png`, updated_at: ahora, bytes: Number(cprev?.bytes || 0) + Math.max(0, Number(r.bytes) || 0), meta: { preview_key: `${dir}/preview.jpg`, frame: r.frame ?? null, face_score: r.faceScore ?? null } };
      if (r.voiceId && /^voc_[0-9a-f]{12}$/.test(r.voiceId)) {
        const { data: clone } = await sb.from("workspace_clones").select("name,created_by").eq("id", job.clone_id).maybeSingle();
        const { error: ev } = await sb.from("musa_voces").insert({
          id: r.voiceId, workspace_id: job.workspace_id, user_id: clone?.created_by || job.created_by,
          nombre: `${clone?.name || "Clon"} · voz`, tipo: "clon", proveedor: "workers-ai",
          voice_ref: { mimeType: "audio/wav", bytes: r.voiceBytes || null, origen: "clon-musa", cloneId: job.clone_id },
          idiomas: [r.idioma || "es"], params: {},
        });
        if (!ev) patch.voice_id = r.voiceId;
      }
      await sb.from("workspace_clones").update(patch).eq("id", job.clone_id);
      await sb.from("musa_clon_jobs").update({ status: "done", progress: 100, finished_at: ahora, heartbeat_at: ahora }).eq("id", jobId);
    } else {
      const seconds = Math.max(0, Number(r.seconds) || 0);
      await sb.from("musa_clon_jobs").update({
        status: "done", progress: 100, finished_at: ahora, heartbeat_at: ahora, seconds,
        output_key: `${dir}/videos/${job.id}.mp4`, poster_key: `${dir}/videos/${job.id}.jpg`,
        bytes: Math.max(0, Number(r.bytes) || 0), audio_key: null,
      }).eq("id", jobId);
      await r2Delete(cfg, job.audio_key); // el audio era solo la entrada del motor
      if (seconds) await sb.rpc("musa_clon_uso_suma", { p_ws: job.workspace_id, p_dia: hoyUTC(), p_seg: seconds });
    }
    return json(200, { ok: true });
  }

  if (metodo === "POST" && sub === "engine/fail") {
    const mensaje = String(body?.error || "El motor no pudo completar el trabajo.").slice(0, 400);
    const reintentar = !!body?.retry && job.attempts < 3;
    await sb.from("musa_clon_jobs").update({
      status: reintentar ? "queued" : "error", error: mensaje, worker: null, heartbeat_at: ahora,
      finished_at: reintentar ? null : ahora,
    }).eq("id", jobId);
    if (!reintentar && job.kind === "render") {
      await r2Delete(cfg, job.audio_key);
      await sb.from("musa_clon_jobs").update({ audio_key: null }).eq("id", jobId);
    }
    if (!reintentar && job.kind === "prepare") {
      await sb.from("workspace_clones").update({ status: "error", updated_at: ahora, meta: { error: mensaje } }).eq("id", job.clone_id);
    }
    return json(200, { ok: true, requeued: reintentar });
  }

  return err(404, "NO_ROUTE", `Ruta de motor desconocida: ${sub}`);
}

/* ═════════════════════════ Handler ═════════════════════════ */
export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors(), body: "" };
  const sb = getSupabaseAdmin();
  if (!sb) return err(503, "NO_DB", "Base de datos no configurada.");

  const path = (event.path || "").replace(/^\/+|\/+$/g, "");
  const sub = path.split("/").slice(2).map((s) => decodeURIComponent(s)).join("/");
  const metodo = event.httpMethod || "GET";
  const bearer = (event.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  const host = event.headers?.host || event.headers?.Host || "";
  ORIGIN = host ? `https://${host}` : "";

  // ── Medios: video, póster, retrato y vista previa con URL estable firmada ──
  const mMedia = sub.match(/^media\/([vprm])\/([0-9a-f-]{36})\/([0-9a-f]{32})\.(mp4|jpg|png)$/);
  if (mMedia && metodo === "GET") {
    const [, tipo, id, firma] = mMedia;
    if (firma !== (await mediaSig(tipo, id))) return err(404, "NOT_FOUND", "Archivo no encontrado.");
    const cfgR = vozR2();
    if (!cfgR) return err(503, "R2_NOT_CONFIGURED", "Almacenamiento no configurado.");
    let key = null;
    if (tipo === "v" || tipo === "p") {
      const { data } = await sb.from("musa_clon_jobs").select("output_key,poster_key,status").eq("id", id).maybeSingle();
      key = data && data.status === "done" ? (tipo === "v" ? data.output_key : data.poster_key) : null;
    } else {
      const { data } = await sb.from("workspace_clones").select("portrait_key,meta").eq("id", id).maybeSingle();
      key = data ? (tipo === "r" ? data.portrait_key : data.meta?.preview_key) : null;
    }
    if (!key) return err(404, "NOT_FOUND", "Archivo no encontrado.");
    const url = await sign(cfgR, "GET", key, URL_UI_SEG);
    return { statusCode: 302, headers: { Location: url, "Cache-Control": "private, max-age=600", "Access-Control-Allow-Origin": "*" }, body: "" };
  }

  // ── Motor: secreto compartido, sin sesión de persona ──
  if (sub.startsWith("engine/")) {
    const secret = process.env.MUSA_CLON_ENGINE_SECRET || "";
    if (!secret || bearer.length !== secret.length || bearer !== secret) return err(401, "AUTH", "Motor no autorizado.");
    try {
      return await engineRoutes(sb, metodo, sub, parseHandlerJson(event) || {});
    } catch (e) {
      console.error("[musa-clon engine]", e?.message || e);
      return err(500, "INTERNAL", "Error interno.");
    }
  }

  if (!bearer) return err(401, "AUTH", "Inicia sesión.");
  let userId;
  try {
    const { data, error } = await sb.auth.getUser(bearer);
    if (error || !data?.user) return err(401, "AUTH", "Sesión inválida.");
    userId = data.user.id;
  } catch {
    return err(401, "AUTH", "Sesión inválida.");
  }
  return musaClonCore(event, userId, sb);
}

/** Núcleo con la persona ya autenticada (handler HTTP y paridad MCP). */
export async function musaClonCore(event, userId, sbIn) {
  const sb = sbIn || getSupabaseAdmin();
  if (!sb) return err(503, "NO_DB", "Base de datos no configurada.");
  const path = (event.path || "").replace(/^\/+|\/+$/g, "");
  const sub = path.split("/").slice(2).map((s) => decodeURIComponent(s)).join("/");
  const metodo = event.httpMethod || "GET";
  if (!ORIGIN) ORIGIN = String(process.env.EVENTS_PUBLIC_ORIGIN || process.env.URL || "https://musa-v2.renzo-08c.workers.dev").replace(/\/$/, "");
  const qs = event.queryStringParameters || {};
  const cfg = vozR2();

  try {
    // ── GET estado ──
    if (metodo === "GET" && sub === "estado") {
      const ws = String(qs.ws || "");
      await exigeRol(sb, ws, userId, "viewer");
      const [motor, usado, colaQ, alm, hab, llave] = await Promise.all([
        motorEstado(sb),
        cuotaHoy(sb, ws),
        sb.from("musa_clon_jobs").select("id", { count: "exact", head: true }).eq("provider", "musa").in("status", ["queued", "running"]),
        almacenamiento(sb, ws),
        habilitado(sb, ws),
        llaveHeygen(userId),
      ]);
      return json(200, { habilitado: hab, plan: hab ? "empresa" : null, heygen: !!llave, motor, cola: colaQ.count || 0, cuota: { usado, limite: CUOTA_SEG_DIA }, almacenamiento: alm, r2: !!cfg });
    }

    // ── GET clones ──
    if (metodo === "GET" && sub === "clones") {
      const ws = String(qs.ws || "");
      await exigeRol(sb, ws, userId, "viewer");
      const { data, error } = await sb.from("workspace_clones").select("*")
        .eq("workspace_id", ws).in("provider", ["musa", "heygen"]).order("created_at", { ascending: false }).limit(200);
      if (error) return err(500, "DB", error.message);
      return json(200, { clones: await Promise.all((data || []).map((c) => clonPublico(cfg, c))) });
    }

    // ── POST clones (crear) ──
    if (metodo === "POST" && sub === "clones") {
      if (!cfg) return err(503, "R2_NOT_CONFIGURED", "El almacenamiento de clones no está configurado en el servidor.");
      const b = parseHandlerJson(event) || {};
      const ws = String(b.workspaceId || "");
      await exigeRol(sb, ws, userId, "editor");
      if (!(await habilitado(sb, ws))) throw errPlan();
      const name = String(b.name || "").trim().slice(0, 80);
      if (!name) return err(400, "VALIDATION", "Ponle un nombre al clon.");
      if (b.consent !== true) return err(400, "CONSENT_REQUIRED", "Falta el consentimiento de la persona que aparece en el clon.");
      const consentText = String(b.consentText || "Confirmo que soy la persona del video o foto, o que tengo su autorización expresa para crear y usar este clon con IA.").slice(0, 600);

      exigeEspacio(await almacenamiento(sb, ws));
      const cloneId = crypto.randomUUID();
      const dir = clonDir(ws, cloneId);
      let sourceKey, sourceKind, sourceBytes = 0;
      if (b.source === "take") {
        const takeId = String(b.takeId || "");
        if (!takeId) return err(400, "VALIDATION", "Elige la toma que va a entrenar el clon.");
        const { data: take } = await sb.from("musa_video_takes").select("id, created_by, state, mime, expires_at, r2_key, size_bytes").eq("id", takeId).maybeSingle();
        if (!take) return err(404, "TAKE_NOT_FOUND", "La toma no existe.");
        if (String(take.created_by) !== String(userId)) return err(403, "TAKE_FORBIDDEN", "Solo puedes crear un clon con tus propias tomas.");
        if (take.state !== "ready") return err(409, "TAKE_NOT_READY", "La toma no terminó de subirse. Grábala de nuevo.");
        if (Date.parse(take.expires_at) <= Date.now()) return err(410, "TAKE_EXPIRED", "La toma venció (24 h). Vuelve a grabarla.");
        const tk = takesR2();
        sourceKind = "take";
        sourceKey = `${dir}/source.${extDe(take.mime)}`;
        try {
          sourceBytes = (await r2Copy(tk, take.r2_key, cfg, sourceKey, take.mime)) || Number(take.size_bytes || 0);
        } catch (e) {
          return err(502, "R2_COPY", "No se pudo guardar la toma para el clon: " + e.message);
        }
      } else if (b.source === "photo") {
        const mime = String(b.photoMime || "image/jpeg");
        if (!/^image\/(jpeg|png|webp)$/.test(mime)) return err(400, "VALIDATION", "La foto debe ser JPG, PNG o WebP.");
        const bytes = b64ToBytes(b.photoBase64);
        if (!bytes.length) return err(400, "VALIDATION", "Falta la foto.");
        if (bytes.length > MAX_PHOTO_BYTES) return err(413, "TOO_LARGE", "La foto supera 8 MB.");
        sourceKind = "photo";
        sourceBytes = bytes.length;
        sourceKey = `${dir}/source.${extDe(mime)}`;
        await r2PutBytes(cfg, sourceKey, bytes, mime);
      } else {
        return err(400, "VALIDATION", "La fuente debe ser una toma o una foto.");
      }

      const ahora = new Date().toISOString();
      const { data: clone, error } = await sb.from("workspace_clones").insert({
        id: cloneId, workspace_id: ws, name, kind: "avatar", provider: "musa", engine: "ditto",
        status: "entrenando", source_kind: sourceKind, source_key: sourceKey,
        consent: true, consent_text: consentText, consent_at: ahora, created_by: userId,
        brand_id: b.brandId || null, meta: {}, bytes: sourceBytes,
      }).select().single();
      if (error) {
        await r2Delete(cfg, sourceKey);
        return err(500, "DB", error.message);
      }
      const { data: job, error: ej } = await sb.from("musa_clon_jobs").insert({
        workspace_id: ws, clone_id: cloneId, kind: "prepare", created_by: userId, title: `Preparar ${name}`,
      }).select().single();
      if (ej) return err(500, "DB", ej.message);
      const motor = await motorEstado(sb);
      return json(200, { clone: await clonPublico(cfg, clone), job: await conUrls(cfg, job), motor });
    }

    // ── POST heygen/sync — traer a Musa los clones propios de HeyGen ──
    if (metodo === "POST" && sub === "heygen/sync") {
      const b = parseHandlerJson(event) || {};
      const ws = String(b.workspaceId || "");
      await exigeRol(sb, ws, userId, "editor");
      const key = await llaveHeygen(userId);
      if (!key) throw errHeygenSinLlave();
      return json(200, await sincronizarHeygen(sb, ws, userId, key));
    }

    // ── DELETE clones/:id ──
    const mDel = sub.match(/^clones\/([0-9a-f-]{36})$/);
    if (mDel && metodo === "DELETE") {
      const { data: clone } = await sb.from("workspace_clones").select("*").eq("id", mDel[1]).maybeSingle();
      if (!clone || clone.provider !== "musa") return err(404, "NOT_FOUND", "Clon no encontrado.");
      await exigeRol(sb, clone.workspace_id, userId, "editor");
      const { data: jobs } = await sb.from("musa_clon_jobs").select("output_key,poster_key,audio_key").eq("clone_id", clone.id);
      if (cfg) {
        const keys = [clone.source_key, clone.portrait_key, clone.meta?.preview_key];
        for (const j of jobs || []) keys.push(j.output_key, j.poster_key, j.audio_key);
        await Promise.all(keys.filter(Boolean).slice(0, 40).map((k) => r2Delete(cfg, k)));
      }
      const { error } = await sb.from("workspace_clones").delete().eq("id", clone.id);
      if (error) return err(500, "DB", error.message);
      return json(200, { ok: true, voiceKept: !!clone.voice_id });
    }

    // ── POST videos (generar) ──
    if (metodo === "POST" && sub === "videos") {
      if (!cfg) return err(503, "R2_NOT_CONFIGURED", "El almacenamiento de clones no está configurado en el servidor.");
      const b = parseHandlerJson(event) || {};
      const { data: clone } = await sb.from("workspace_clones").select("*").eq("id", String(b.cloneId || "")).maybeSingle();
      if (!clone || (clone.provider !== "musa" && clone.provider !== "heygen")) return err(404, "NOT_FOUND", "Clon no encontrado.");
      await exigeRol(sb, clone.workspace_id, userId, "editor");
      if (clone.provider === "heygen") return await videoHeygen(sb, cfg, clone, userId, b);
      if (!(await habilitado(sb, clone.workspace_id))) throw errPlan();
      if (clone.status !== "listo") return err(409, "CLONE_NOT_READY", clone.status === "error" ? "Este clon tuvo un error al prepararse; créalo de nuevo." : "El clon todavía se está preparando.");
      const script = String(b.script || "").trim();
      const aspect = ASPECTS.has(b.aspect) ? b.aspect : "9:16";
      if (!script && !b.audioBase64) return err(400, "VALIDATION", "Escribe el guion o sube el audio.");
      if (script.length > MAX_SCRIPT) return err(413, "TOO_LONG", `El guion supera ${MAX_SCRIPT} caracteres (~90 s). Divídelo en partes.`);

      exigeEspacio(await almacenamiento(sb, clone.workspace_id), 15 * 1048576);
      const usado = await cuotaHoy(sb, clone.workspace_id);
      const estimado = script ? segundosEstimados(script) : 30;
      if (usado + estimado > CUOTA_SEG_DIA) {
        return err(429, "QUOTA", `Hoy este espacio ya usó ${Math.round(usado)} de ${CUOTA_SEG_DIA} s de video con el motor gratis. Se renueva a medianoche (UTC).`);
      }

      let audio;
      if (b.audioBase64) {
        const bytes = b64ToBytes(b.audioBase64);
        if (bytes.length > MAX_AUDIO_BYTES) return err(413, "TOO_LARGE", "El audio supera 12 MB.");
        audio = { bytes, mime: String(b.audioMime || "audio/mpeg") };
      } else {
        audio = await sintetizarConMusaVoz(userId, sb, { script, vozId: b.vozId || clone.voice_id || null, speaker: b.speaker, idioma: b.idioma });
      }
      const jobId = crypto.randomUUID();
      const audioKey = `${clonDir(clone.workspace_id, clone.id)}/audio/${jobId}.${extDe(audio.mime)}`;
      await r2PutBytes(cfg, audioKey, audio.bytes, audio.mime);
      const { data: job, error } = await sb.from("musa_clon_jobs").insert({
        id: jobId, workspace_id: clone.workspace_id, clone_id: clone.id, kind: "render",
        title: String(b.title || script.slice(0, 60) || "Video con clon").slice(0, 120), script,
        aspect, voice: { vozId: b.vozId || clone.voice_id || null, speaker: b.speaker || null, idioma: b.idioma || null, subido: !!b.audioBase64 },
        audio_key: audioKey, created_by: userId,
      }).select().single();
      if (error) {
        await r2Delete(cfg, audioKey);
        return err(500, "DB", error.message);
      }
      const [pos, motor] = await Promise.all([posicionEnCola(sb, job), motorEstado(sb)]);
      return json(200, { job: { ...(await conUrls(cfg, job)), position: pos }, motor });
    }

    // ── GET jobs ──
    if (metodo === "GET" && sub === "jobs") {
      let q = sb.from("musa_clon_jobs").select("*").order("created_at", { ascending: false }).limit(40);
      if (qs.cloneId) {
        const { data: clone } = await sb.from("workspace_clones").select("workspace_id").eq("id", String(qs.cloneId)).maybeSingle();
        if (!clone) return err(404, "NOT_FOUND", "Clon no encontrado.");
        await exigeRol(sb, clone.workspace_id, userId, "viewer");
        q = q.eq("clone_id", String(qs.cloneId));
      } else {
        const ws = String(qs.ws || "");
        await exigeRol(sb, ws, userId, "viewer");
        q = q.eq("workspace_id", ws);
      }
      if (qs.kind) q = q.eq("kind", String(qs.kind));
      const { data, error } = await q;
      if (error) return err(500, "DB", error.message);
      let vivos = 0;
      const jobs = [];
      for (const j of data || []) jobs.push(j.provider === "heygen" && j.status === "running" && vivos++ < 3 ? await refrescarHeygen(sb, cfg, j) : j);
      return json(200, { jobs: await Promise.all(jobs.map((j) => conUrls(cfg, j))) });
    }

    // ── GET jobs/:id · POST jobs/:id/cancel ──
    const mJob = sub.match(/^jobs\/([0-9a-f-]{36})(\/cancel)?$/);
    if (mJob) {
      const { data: job } = await sb.from("musa_clon_jobs").select("*").eq("id", mJob[1]).maybeSingle();
      if (!job) return err(404, "NOT_FOUND", "Trabajo no encontrado.");
      if (!mJob[2] && metodo === "DELETE") {
        await exigeRol(sb, job.workspace_id, userId, "editor");
        if (job.kind !== "render") return err(409, "NOT_VIDEO", "Solo se pueden borrar videos.");
        if (job.status === "running") return err(409, "RUNNING", "Ese video se está generando; espera a que termine.");
        if (cfg) await Promise.all([job.output_key, job.poster_key, job.audio_key].filter(Boolean).map((k) => r2Delete(cfg, k)));
        const { error } = await sb.from("musa_clon_jobs").delete().eq("id", job.id);
        if (error) return err(500, "DB", error.message);
        return json(200, { ok: true });
      }
      if (mJob[2] && metodo === "POST") {
        await exigeRol(sb, job.workspace_id, userId, "editor");
        if (job.status !== "queued") return err(409, "NOT_QUEUED", "Solo se puede cancelar un trabajo que sigue en cola.");
        await sb.from("musa_clon_jobs").update({ status: "cancelled", finished_at: new Date().toISOString() }).eq("id", job.id).eq("status", "queued");
        if (cfg) await r2Delete(cfg, job.audio_key);
        return json(200, { ok: true });
      }
      if (metodo === "GET") {
        await exigeRol(sb, job.workspace_id, userId, "viewer");
        const actual = await refrescarHeygen(sb, cfg, job);
        const pos = await posicionEnCola(sb, actual);
        return json(200, { job: { ...(await conUrls(cfg, actual)), position: pos } });
      }
    }

    return err(404, "NO_ROUTE", `Ruta desconocida: ${metodo} /api/musa-clon/${sub}`);
  } catch (e) {
    if (e?.status) return err(e.status, e.code || "ERROR", e.message);
    console.error("[musa-clon]", e?.message || e);
    return err(500, "INTERNAL", e?.message || "Error interno.");
  }
}
