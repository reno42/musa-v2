// Crear › Fotos: las fotos de la persona estén donde estén (Musa, Google Drive, Dropbox o un enlace), sin copiarlas
// a Supabase (plan gratis: no se gasta almacenamiento).
//
// · Google Drive: cada persona conecta su cuenta (OAuth con la app de Google de Musa). Con el permiso básico
//   `drive.file` (no requiere auditoría de Google) Musa ve solo lo que la persona elige en el selector de Google; si la
//   plataforma tiene el permiso completo verificado (GOOGLE_DRIVE_SCOPE=full) también puede explorar todo el Drive.
//   La foto queda en Drive: Musa guarda la referencia (assets.source = 'drive') y la sirve con un proxy firmado
//   (/api/photo-sources/f/<cuenta>/<archivo>/<firma>) que cualquier diseño, video o web publicada puede usar.
// · Dropbox y enlaces: se guarda el enlace directo (Dropbox ?raw=1, Drive público, OneDrive, cualquier https).
// · Una foto editada en Musa se guarda donde está el original (Drive → carpeta «Musa» de esa cuenta; el resto → Musa)
//   y queda unida al original con su receta (source_meta.from / recipe): el original nunca se toca.
//
// Variables de entorno: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (cliente OAuth «Aplicación web»), GOOGLE_API_KEY
// (para el selector de Google), GOOGLE_APP_ID (número del proyecto de Google Cloud), GOOGLE_DRIVE_SCOPE (file | full),
// DROPBOX_APP_KEY (selector de Dropbox, opcional), APP_ORIGIN. Migración: db/migrations-v2/44_v2_fotos_fuentes.sql.
import { getSupabaseAdmin, uploadAsset } from "../../../api/src/services/supabase.js";
import { canAccessWorkspace } from "../../../api/src/services/tenancy.js";
import { normalizeImageUrl } from "../../../api/src/services/imageLinks.ts";
import { encrypt, decrypt } from "./keys.mjs";

const env = (k) => (typeof process !== "undefined" && process.env && process.env[k]) || "";
const ORIGIN = () => (env("APP_ORIGIN") || "https://musa-v2.renzo-08c.workers.dev").replace(/\/$/, "");
const DRIVE = "https://www.googleapis.com/drive/v3";
const FILE_FIELDS = "id,name,mimeType,size,imageMediaMetadata(width,height),thumbnailLink,webViewLink,modifiedTime,parents";
const NO_TABLE = /photo_sources|source_ref|source_account|source_meta|column .*source|schema cache/i;

function db() { const sb = getSupabaseAdmin(); if (!sb) throw herr(503, "La base de datos no está configurada"); return sb; }
function herr(status, message) { const e = new Error(message); e.status = status; return e; }
function googleCfg() {
  const id = env("GOOGLE_CLIENT_ID"), secret = env("GOOGLE_CLIENT_SECRET");
  const full = /^full$/i.test(env("GOOGLE_DRIVE_SCOPE"));
  return { ok: !!(id && secret), id, secret, apiKey: env("GOOGLE_API_KEY"), appId: env("GOOGLE_APP_ID"), full,
    scope: ["openid", "email", "profile", "https://www.googleapis.com/auth/drive.file"].concat(full ? ["https://www.googleapis.com/auth/drive.readonly"] : []).join(" ") };
}
const redirectUri = () => ORIGIN() + "/api/photo-sources/google/callback";
function rid(p) { const a = "abcdefghijklmnopqrstuvwxyz0123456789"; let s = ""; for (let i = 0; i < 14; i++) s += a[Math.floor(Math.random() * 36)]; return p + s; }

/* ── firma de los enlaces del proxy y del estado de OAuth (HMAC-SHA256) ── */
let HK = null;
async function hkey() {
  if (HK) return HK;
  const sec = env("PHOTO_PROXY_SECRET") || env("WORKSPACE_SECRET_ENCRYPTION_KEY") || env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
  if (!sec) throw herr(503, "Falta el secreto del servidor para firmar enlaces");
  HK = await crypto.subtle.importKey("raw", new TextEncoder().encode("musa-fotos:" + sec), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return HK;
}
function b64u(buf) { let s = ""; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
async function sign(text, n) { return b64u((await crypto.subtle.sign("HMAC", await hkey(), new TextEncoder().encode(text))).slice(0, n || 12)); }
async function verify(text, sig, n) { const want = await sign(text, n); if (!sig || sig.length !== want.length) return false; let d = 0; for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ sig.charCodeAt(i); return d === 0; }
async function driveUrl(sid, fileId) { return ORIGIN() + "/api/photo-sources/f/" + sid + "/" + encodeURIComponent(fileId) + "/" + (await sign(sid + ":" + fileId)); }
async function linkProxyUrl(assetId) { return ORIGIN() + "/api/photo-sources/l/" + encodeURIComponent(assetId) + "/" + (await sign("l:" + assetId)); }

/* ── Google: tokens ── */
async function tokenCall(form) {
  const g = googleCfg(); if (!g.ok) throw herr(503, "Google Drive aún no está configurado en Musa");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...form, client_id: g.id, client_secret: g.secret }).toString() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw herr(r.status === 400 || r.status === 401 ? 401 : 502, "Google: " + (j.error_description || j.error || r.status) + (j.error === "invalid_grant" ? " (vuelve a conectar la cuenta)" : ""));
  return j;
}
const TOK = new Map();
async function sourceRow(sid) {
  const { data, error } = await db().from("photo_sources").select("id,workspace_id,provider,account_email,account_name,encrypted,meta").eq("id", sid).maybeSingle();
  if (error) throw herr(NO_TABLE.test(error.message) ? 503 : 500, NO_TABLE.test(error.message) ? "Falta aplicar la migración 44 (fotos)" : error.message);
  if (!data) throw herr(404, "Esa cuenta ya no está conectada");
  return data;
}
async function accessToken(sid, force) {
  const c = TOK.get(sid);
  if (c && !force && c.exp > Date.now() + 60000) return c;
  const row = await sourceRow(sid);
  if (row.provider !== "google_drive" || !row.encrypted) throw herr(400, "Esa cuenta no es de Google Drive");
  const j = await tokenCall({ grant_type: "refresh_token", refresh_token: decrypt(row.encrypted) });
  const v = { at: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000, row };
  TOK.set(sid, v);
  return v;
}
async function gapi(sid, path, init) {
  let T = await accessToken(sid);
  const go = (tok) => fetch(path.startsWith("http") ? path : DRIVE + path, { ...(init || {}), headers: { ...((init && init.headers) || {}), Authorization: "Bearer " + tok } });
  let r = await go(T.at);
  if (r.status === 401) { T = await accessToken(sid, true); r = await go(T.at); }
  return r;
}
async function gjson(sid, path, init) {
  const r = await gapi(sid, path, init), j = await r.json().catch(() => ({}));
  if (!r.ok) throw herr(r.status === 404 ? 404 : r.status === 403 ? 403 : 502, "Drive: " + ((j.error && (j.error.message || j.error.status)) || r.status));
  return j;
}

/* ── auth de la persona (Bearer JWT de Supabase) ── */
async function userOf(event) {
  const bearer = String((event.headers && (event.headers.authorization || event.headers.Authorization)) || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return null;
  try { const { data, error } = await db().auth.getUser(bearer); return error || !data || !data.user ? null : data.user; } catch (e) { return null; }
}
async function need(auth, ws, role) {
  if (!ws) throw herr(400, "workspaceId es requerido");
  if (!(await canAccessWorkspace(auth, ws, role || "viewer"))) throw herr(403, role === "editor" ? "Necesitas ser editor de este espacio" : "No tienes acceso a este espacio");
}

/* ── filas de fotos ── */
const kindOfUrl = (u) => /dropbox(usercontent)?\.com/i.test(u) ? "dropbox" : /drive\.google\.com|googleusercontent\.com|docs\.google\.com/i.test(u) ? "drive" : /1drv\.ms|onedrive\.live\.com|sharepoint\.com/i.test(u) ? "onedrive" : "link";
async function findAsset(ws, source, account, ref) {
  let q = db().from("assets").select("id,name,url,mime_type,size_bytes,width,height,tags,source,source_ref,source_account,source_meta,created_at").eq("workspace_id", ws).eq("source", source).eq("source_ref", ref).is("deleted_at", null);
  q = account ? q.eq("source_account", account) : q.is("source_account", null);
  const { data, error } = await q.limit(1);
  if (error) throw herr(NO_TABLE.test(error.message) ? 503 : 500, NO_TABLE.test(error.message) ? "Falta aplicar la migración 44 (fotos)" : error.message);
  return data && data[0] || null;
}
async function insertAsset(row) {
  const { data, error } = await db().from("assets").insert(row).select("id,name,url,mime_type,size_bytes,width,height,tags,source,source_ref,source_account,source_meta,created_at").single();
  if (error && NO_TABLE.test(error.message) && row.source === "musa") {
    /* sin la migración 44, una foto de Musa se guarda igual (sin el vínculo con el original) */
    const plain = { ...row }; delete plain.source; delete plain.source_ref; delete plain.source_account; delete plain.source_meta;
    const r2 = await db().from("assets").insert(plain).select("id,name,url,mime_type,size_bytes,width,height,tags,created_at").single();
    if (r2.error) throw herr(500, r2.error.message);
    return { ...r2.data, source: "musa" };
  }
  if (error) throw herr(NO_TABLE.test(error.message) ? 503 : 500, NO_TABLE.test(error.message) ? "Falta aplicar la migración 44 (fotos)" : error.message);
  return data;
}
export function assetOut(r) {
  if (!r) return r;
  const m = r.source_meta || {};
  return { id: r.id, name: r.name, url: r.url, thumb: r.source === "drive" && r.source_account ? r.url + "?s=480" : r.url, editUrl: m.proxy || r.url, mimeType: r.mime_type, sizeBytes: r.size_bytes, width: r.width, height: r.height, tags: r.tags || [],
    source: r.source || "musa", sourceRef: r.source_ref || null, sourceAccount: r.source_account || null, openUrl: m.webViewLink || m.link || null, folder: m.folder || null, from: m.from || null, recipe: m.recipe || null, createdAt: r.created_at };
}
async function driveAsset(ws, sid, f, extra) {
  const had = await findAsset(ws, "drive", sid, f.id);
  if (had) return { asset: had, existed: true };
  const url = await driveUrl(sid, f.id), im = f.imageMediaMetadata || {};
  const row = { id: "asset_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8), workspace_id: ws, name: String(f.name || "Foto de Drive").replace(/\.[a-z0-9]{2,5}$/i, "").slice(0, 160), filename: String(f.name || "foto").slice(0, 200),
    mime_type: f.mimeType || "image/jpeg", size_bytes: Number(f.size) || 0, url, width: im.width || null, height: im.height || null, tags: (extra && extra.tags) || [],
    source: "drive", source_ref: f.id, source_account: sid, source_meta: Object.assign({ webViewLink: f.webViewLink || null, modifiedTime: f.modifiedTime || null, parents: f.parents || [] }, (extra && extra.meta) || {}) };
  return { asset: await insertAsset(row), existed: false };
}
async function linkAsset(ws, rawUrl, name, tags, uid) {
  let u = String(rawUrl || "").trim();
  if (!/^https:\/\/\S+$/i.test(u)) throw herr(400, "El enlace tiene que empezar con https://");
  const direct = normalizeImageUrl(u), source = kindOfUrl(u);
  const ref = direct.slice(0, 900);
  const had = await findAsset(ws, source, null, ref); if (had) return { asset: had, existed: true };
  /* se comprueba que sea una imagen (solo los primeros bytes) */
  let mime = "", size = 0;
  try {
    const r = await fetch(direct, { headers: { Range: "bytes=0-2047", "User-Agent": "MusaFotos/1.0" }, redirect: "follow" });
    mime = (r.headers.get("content-type") || "").split(";")[0].trim(); size = Number((r.headers.get("content-range") || "").split("/")[1]) || Number(r.headers.get("content-length")) || 0;
    if (r.body) try { await r.body.cancel(); } catch (e) { /* ya cerrado */ }
    if (!r.ok && r.status !== 206) throw herr(400, "El enlace respondió " + r.status + (source === "drive" ? " (en Drive, compártelo como «Cualquier persona con el enlace» o conecta tu cuenta)" : ""));
  } catch (e) { if (e.status) throw e; throw herr(400, "No pude abrir el enlace: " + (e.message || e)); }
  if (mime && !/^image\//.test(mime)) throw herr(400, "El enlace no es una imagen (" + mime + ")" + (source === "drive" ? ": en Drive, compártelo como «Cualquier persona con el enlace»" : ""));
  const id = "asset_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  const nm = String(name || decodeURIComponent((direct.split("?")[0].split("/").pop() || "Foto"))).replace(/\.[a-z0-9]{2,5}$/i, "").slice(0, 160) || "Foto";
  const asset = await insertAsset({ id, workspace_id: ws, name: nm, filename: nm, mime_type: mime || "image/jpeg", size_bytes: size, url: direct, tags: tags || [], source, source_ref: ref, source_account: null,
    source_meta: { link: u, proxy: await linkProxyUrl(id), by: uid || null } });
  return { asset, existed: false };
}

/* ── Drive: carpeta «Musa» (donde van las fotos editadas) ── */
async function musaFolder(sid) {
  const row = (TOK.get(sid) && TOK.get(sid).row) || (await sourceRow(sid));
  const meta = row.meta || {};
  if (meta.folderId) {
    const r = await gapi(sid, "/files/" + meta.folderId + "?fields=id,trashed&supportsAllDrives=true");
    if (r.ok) { const j = await r.json(); if (!j.trashed) return meta.folderId; }
  }
  const f = await gjson(sid, "/files?fields=id", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Musa", mimeType: "application/vnd.google-apps.folder" }) });
  await db().from("photo_sources").update({ meta: { ...meta, folderId: f.id }, updated_at: new Date().toISOString() }).eq("id", sid);
  TOK.delete(sid);
  return f.id;
}
function dataBytes(data) {
  const m = /^data:([^;,]+)(?:;[^,]*)?;base64,(.*)$/s.exec(String(data || ""));
  const b64 = m ? m[2] : String(data || "");
  const bin = atob(b64.replace(/\s+/g, "")); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return { mime: m ? m[1] : "image/jpeg", bytes: out };
}
async function driveSave(sid, ws, p, uid) {
  const { mime, bytes } = dataBytes(p.data);
  if (!/^image\/(jpeg|png|webp)$/.test(mime)) throw herr(400, "Solo JPG, PNG o WEBP");
  if (bytes.length > 25 * 1024 * 1024) throw herr(413, "La foto supera 25 MB");
  const folder = await musaFolder(sid), ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const name = String(p.name || "Foto editada").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 120) + "." + ext;
  const bnd = "musa" + Math.random().toString(36).slice(2);
  const head = new TextEncoder().encode("--" + bnd + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify({ name, parents: [folder], mimeType: mime, description: "Editada en Musa" + (p.fromName ? " a partir de «" + p.fromName + "»" : "") }) + "\r\n--" + bnd + "\r\nContent-Type: " + mime + "\r\n\r\n");
  const tail = new TextEncoder().encode("\r\n--" + bnd + "--");
  const body = new Uint8Array(head.length + bytes.length + tail.length); body.set(head, 0); body.set(bytes, head.length); body.set(tail, head.length + bytes.length);
  const f = await gjson(sid, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=" + encodeURIComponent(FILE_FIELDS), { method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + bnd }, body });
  return driveAsset(ws, sid, f, { tags: p.tags || [], meta: { folder: "Musa", from: p.fromAssetId || null, recipe: p.recipe || null, edited: true, by: uid || null } });
}

/* ── proxy de imágenes de Drive (público, firmado) ── */
function cacheStore() { try { return (typeof caches !== "undefined" && caches && caches.default) || null; } catch (e) { return null; } }
const IMG_HEADERS = (ct, len) => { const h = new Headers({ "Content-Type": ct || "image/jpeg", "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800", "Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "cross-origin", "X-Content-Type-Options": "nosniff" }); if (len) h.set("Content-Length", len); return h; };
async function proxyDrive(request, sid, fileId, sig, size) {
  if (!(await verify(sid + ":" + fileId, sig))) return new Response("Enlace inválido", { status: 403 });
  const cache = cacheStore(), key = new Request(request.url, { method: "GET" });
  if (cache) { try { const hit = await cache.match(key); if (hit) return hit; } catch (e) { /* sin caché */ } }
  let res = null;
  try {
    const meta = await gjson(sid, "/files/" + encodeURIComponent(fileId) + "?fields=mimeType,thumbnailLink,size&supportsAllDrives=true");
    const heic = /hei[cf]|tiff|x-adobe|raw|dng/i.test(meta.mimeType || "");
    if ((size || heic) && meta.thumbnailLink) {
      const tu = meta.thumbnailLink.replace(/=s\d+(-[a-z]+)?$/, "=s" + Math.min(4000, size || 2400));
      let r = await fetch(tu);
      if (!r.ok) r = await gapi(sid, tu);
      if (r.ok) res = new Response(r.body, { status: 200, headers: IMG_HEADERS(r.headers.get("content-type") || "image/jpeg", r.headers.get("content-length")) });
    }
    if (!res) {
      const r = await gapi(sid, "/files/" + encodeURIComponent(fileId) + "?alt=media&supportsAllDrives=true");
      if (!r.ok) return new Response("Drive respondió " + r.status, { status: r.status === 404 ? 404 : 502, headers: { "Access-Control-Allow-Origin": "*" } });
      res = new Response(r.body, { status: 200, headers: IMG_HEADERS(r.headers.get("content-type") || meta.mimeType, r.headers.get("content-length")) });
    }
  } catch (e) {
    return new Response(e.message || "Error", { status: e.status || 502, headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });
  }
  if (cache) { try { const put = cache.put(key, res.clone()).catch(() => {}); if (typeof globalThis.__musaWaitUntil === "function") globalThis.__musaWaitUntil(put); } catch (e) { /* sin caché */ } }
  return res;
}
/* enlaces (Dropbox, web): para editarlos en el lienzo hace falta CORS; se pasan por Musa solo si están firmados */
async function proxyLink(request, assetId, sig) {
  if (!(await verify("l:" + assetId, sig))) return new Response("Enlace inválido", { status: 403 });
  const cache = cacheStore(), key = new Request(request.url, { method: "GET" });
  if (cache) { try { const hit = await cache.match(key); if (hit) return hit; } catch (e) { /* sin caché */ } }
  const { data } = await db().from("assets").select("url,deleted_at").eq("id", assetId).maybeSingle();
  if (!data || data.deleted_at || !/^https:\/\//.test(data.url || "")) return new Response("No existe", { status: 404 });
  const r = await fetch(data.url, { redirect: "follow", headers: { "User-Agent": "MusaFotos/1.0" } });
  const ct = (r.headers.get("content-type") || "").split(";")[0];
  if (!r.ok || !/^image\//.test(ct)) return new Response("No es una imagen", { status: 502, headers: { "Access-Control-Allow-Origin": "*" } });
  const len = Number(r.headers.get("content-length") || 0); if (len > 40 * 1024 * 1024) return new Response("Muy pesada", { status: 413 });
  const res = new Response(r.body, { status: 200, headers: IMG_HEADERS(ct, r.headers.get("content-length")) });
  if (cache) { try { const put = cache.put(key, res.clone()).catch(() => {}); if (typeof globalThis.__musaWaitUntil === "function") globalThis.__musaWaitUntil(put); } catch (e) { /* idem */ } }
  return res;
}

/* ── lo que puede hacer la persona (HTTP) y su IA (MCP) ── */
export async function sourcesStatus(auth, ws) {
  await need(auth, ws, "viewer");
  const g = googleCfg();
  let accounts = [], migrated = true;
  const { data, error } = await db().from("photo_sources").select("id,provider,account_email,account_name,meta,created_at").eq("workspace_id", ws).order("created_at");
  if (error) { if (NO_TABLE.test(error.message)) migrated = false; else throw herr(500, error.message); }
  else accounts = (data || []).map((r) => ({ id: r.id, provider: r.provider, email: r.account_email, name: r.account_name, picture: (r.meta || {}).picture || null, createdAt: r.created_at }));
  return { migrated, google: { configured: g.ok, picker: !!(g.ok && g.apiKey), fullBrowse: g.full, appId: g.appId || null }, dropbox: { appKey: env("DROPBOX_APP_KEY") || null }, accounts };
}
export async function listPhotos(auth, p) {
  const ws = String(p.workspaceId || ""); await need(auth, ws, "viewer");
  let q = db().from("assets").select("id,name,url,mime_type,size_bytes,width,height,tags,source,source_ref,source_account,source_meta,created_at", { count: "exact" }).eq("workspace_id", ws).is("deleted_at", null).like("mime_type", "image/%");
  if (p.source) q = q.eq("source", p.source);
  if (p.search) q = q.ilike("name", "%" + String(p.search).replace(/[%_]/g, "") + "%");
  if (p.tag) q = q.contains("tags", [String(p.tag)]);
  const lim = Math.min(200, Math.max(1, Number(p.limit) || 60)), off = Math.max(0, Number(p.offset) || 0);
  const { data, count, error } = await q.order("created_at", { ascending: false }).range(off, off + lim - 1);
  if (error && NO_TABLE.test(error.message)) {
    /* sin la migración 44: las fotos subidas a Musa (todavía no hay de Drive, Dropbox ni enlaces) */
    if (p.source && p.source !== "musa") return { photos: [], total: 0, warning: "Falta aplicar la migración 44 (fotos)" };
    let q2 = db().from("assets").select("id,name,url,mime_type,size_bytes,width,height,tags,created_at", { count: "exact" }).eq("workspace_id", ws).is("deleted_at", null).like("mime_type", "image/%");
    if (p.search) q2 = q2.ilike("name", "%" + String(p.search).replace(/[%_]/g, "") + "%");
    if (p.tag) q2 = q2.contains("tags", [String(p.tag)]);
    const r2 = await q2.order("created_at", { ascending: false }).range(off, off + lim - 1);
    if (r2.error) throw herr(500, r2.error.message);
    return { photos: (r2.data || []).map(assetOut), total: r2.count || 0, warning: "Falta aplicar la migración 44 (fotos): por ahora solo las fotos subidas a Musa" };
  }
  if (error) throw herr(500, error.message);
  return { photos: (data || []).map(assetOut), total: count || 0 };
}
async function srcFor(auth, sid, role) {
  const row = await sourceRow(sid);
  await need(auth, row.workspace_id, role || "viewer");
  return row;
}
async function driveList(auth, p) {
  const row = await srcFor(auth, String(p.sourceId || ""), "viewer"), g = googleCfg();
  const folder = String(p.folderId || "").replace(/[^\w-]/g, "");
  const qs = ["trashed = false", "(mimeType contains 'image/' or mimeType = 'application/vnd.google-apps.folder')"];
  if (folder) qs.push("'" + folder + "' in parents"); else if (g.full && !p.query) qs.push("'root' in parents");
  if (p.query) qs.push("name contains '" + String(p.query).replace(/['\\]/g, "") + "'");
  const u = "/files?pageSize=" + Math.min(100, Number(p.limit) || 60) + "&orderBy=" + encodeURIComponent("folder,modifiedTime desc") + "&q=" + encodeURIComponent(qs.join(" and ")) + "&fields=" + encodeURIComponent("nextPageToken,files(" + FILE_FIELDS + ")") + "&supportsAllDrives=true&includeItemsFromAllDrives=true" + (p.pageToken ? "&pageToken=" + encodeURIComponent(p.pageToken) : "");
  const j = await gjson(row.id, u);
  const files = await Promise.all((j.files || []).map(async (f) => ({ id: f.id, name: f.name, folder: f.mimeType === "application/vnd.google-apps.folder", mimeType: f.mimeType, size: Number(f.size) || 0, width: f.imageMediaMetadata && f.imageMediaMetadata.width, height: f.imageMediaMetadata && f.imageMediaMetadata.height, modifiedTime: f.modifiedTime, thumb: f.mimeType === "application/vnd.google-apps.folder" ? null : (await driveUrl(row.id, f.id)) + "?s=320" })));
  return { files, nextPageToken: j.nextPageToken || null, fullBrowse: g.full, note: g.full ? null : "Con el permiso básico de Google, Musa ve solo las fotos que elegiste en el selector de Google y las que Musa guardó en tu carpeta «Musa»." };
}
async function driveImport(auth, p, uid) {
  const row = await srcFor(auth, String(p.sourceId || ""), "editor");
  const ids = (Array.isArray(p.fileIds) ? p.fileIds : Array.isArray(p.files) ? p.files.map((f) => f && (f.id || f)) : []).map(String).filter(Boolean).slice(0, 200);
  if (!ids.length) throw herr(400, "Elige al menos una foto");
  const out = [], errors = [];
  for (let i = 0; i < ids.length; i += 8) {
    await Promise.all(ids.slice(i, i + 8).map(async (id) => {
      try {
        const f = await gjson(row.id, "/files/" + encodeURIComponent(id) + "?fields=" + encodeURIComponent(FILE_FIELDS) + "&supportsAllDrives=true");
        if (!/^image\//.test(f.mimeType || "")) { errors.push({ id, error: "no es una imagen (" + f.mimeType + ")" }); return; }
        const r = await driveAsset(row.workspace_id, row.id, f, { tags: p.tags || [], meta: { by: uid || null } });
        out.push({ ...assetOut(r.asset), existed: r.existed });
      } catch (e) { errors.push({ id, error: e.message }); }
    }));
  }
  return { imported: out, errors };
}
async function saveEdited(auth, p, uid) {
  /* la foto editada va donde está el original (o adonde se pida) */
  const from = p.fromAssetId ? (await db().from("assets").select("id,name,workspace_id,source,source_account").eq("id", String(p.fromAssetId)).maybeSingle()).data : null;
  const ws = String(p.workspaceId || (from && from.workspace_id) || ""); await need(auth, ws, "editor");
  const to = p.saveTo === "musa" ? "musa" : p.saveTo === "drive" ? "drive" : (from && from.source === "drive" ? "drive" : "musa");
  if (to === "drive") {
    const sid = String(p.sourceId || (from && from.source === "drive" && from.source_account) || "");
    if (!sid) throw herr(400, "Elige la cuenta de Google Drive donde guardarla");
    const row = await srcFor(auth, sid, "editor");
    const r = await driveSave(row.id, ws, { ...p, fromName: from && from.name }, uid);
    return { asset: assetOut(r.asset), savedTo: "drive", account: row.account_email };
  }
  return { savedTo: "musa", upload: true };
}
/* a Musa: se sube como cualquier imagen (Supabase Storage), unida a la foto de la que salió */
async function saveMusaCopy(auth, p) {
  const from = p.fromAssetId ? (await db().from("assets").select("workspace_id,name").eq("id", String(p.fromAssetId)).maybeSingle()).data : null;
  const ws = String(p.workspaceId || (from && from.workspace_id) || ""); await need(auth, ws, "editor");
  const { mime, bytes } = dataBytes(p.data);
  if (!/^image\/(jpeg|png|webp)$/.test(mime)) throw herr(400, "Solo JPG, PNG o WEBP");
  if (bytes.length > 5 * 1024 * 1024) throw herr(413, "Para guardarla en Musa la foto debe pesar menos de 5 MB (guárdala en Drive o bájale la calidad)");
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg", id = "asset_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  const url = await uploadAsset(id + "." + ext, typeof Buffer !== "undefined" ? Buffer.from(bytes) : bytes, mime, ws);
  const asset = await insertAsset({ id, workspace_id: ws, name: String(p.name || (from ? from.name + " · editada" : "Foto editada")).slice(0, 160), filename: id + "." + ext, mime_type: mime, size_bytes: bytes.length, url, tags: p.tags || [], source: "musa", source_meta: { from: p.fromAssetId || null, recipe: p.recipe || null, edited: true } });
  return { asset: assetOut(asset), savedTo: "musa" };
}
async function removePhoto(auth, p) {
  let { data: a, error: ea } = await db().from("assets").select("id,workspace_id,source").eq("id", String(p.assetId || "")).maybeSingle();
  if (ea && NO_TABLE.test(ea.message)) { const r = await db().from("assets").select("id,workspace_id").eq("id", String(p.assetId || "")).maybeSingle(); a = r.data ? { ...r.data, source: "musa" } : null; }
  if (!a) throw herr(404, "No existe esa foto");
  await need(auth, a.workspace_id, "editor");
  await db().from("assets").update({ deleted_at: new Date().toISOString() }).eq("id", a.id);
  return { ok: true, note: a.source === "musa" ? "La foto pasó a la papelera de Musa." : "La foto se quitó de Musa; el original sigue en " + (a.source === "drive" ? "tu Google Drive" : a.source === "dropbox" ? "tu Dropbox" : "su enlace") + "." };
}
async function updatePhoto(auth, p) {
  const { data: a } = await db().from("assets").select("id,workspace_id,tags").eq("id", String(p.assetId || "")).maybeSingle();
  if (!a) throw herr(404, "No existe esa foto");
  await need(auth, a.workspace_id, "editor");
  const patch = {};
  if (p.name != null) patch.name = String(p.name).slice(0, 160);
  if (Array.isArray(p.tags)) patch.tags = p.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 40);
  if (Array.isArray(p.addTags)) patch.tags = Array.from(new Set((patch.tags || a.tags || []).concat(p.addTags.map(String)))).slice(0, 40);
  if (Array.isArray(p.removeTags)) patch.tags = (patch.tags || a.tags || []).filter((t) => p.removeTags.indexOf(t) < 0);
  if (!Object.keys(patch).length) throw herr(400, "Nada que cambiar");
  const up = await db().from("assets").update(patch).eq("id", a.id);
  if (up.error) throw herr(500, up.error.message);
  let { data, error } = await db().from("assets").select("id,name,url,mime_type,size_bytes,width,height,tags,source,source_ref,source_account,source_meta,created_at").eq("id", a.id).single();
  if (error && NO_TABLE.test(error.message)) ({ data, error } = await db().from("assets").select("id,name,url,mime_type,size_bytes,width,height,tags,created_at").eq("id", a.id).single());
  if (error) throw herr(500, error.message);
  return { photo: assetOut(data) };
}
async function disconnect(auth, sid) {
  const row = await srcFor(auth, sid, "editor");
  try { const rt = decrypt(row.encrypted); await fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(rt), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" } }); } catch (e) { /* ya revocado */ }
  await db().from("photo_sources").delete().eq("id", sid);
  TOK.delete(sid);
  const { count } = await db().from("assets").select("id", { count: "exact", head: true }).eq("source_account", sid).is("deleted_at", null);
  return { ok: true, photosLeft: count || 0, note: count ? count + " foto(s) de esa cuenta dejan de verse en Musa hasta que la vuelvas a conectar." : null };
}

/* ── HTTP ── */
const JSONH = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const out = (status, body) => ({ statusCode: status, headers: JSONH, body: JSON.stringify(body) });
function page(title, msg, payload) {
  const html = "<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>" + title + "</title>"
    + "<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111;color:#f2f2f2;font:16px/1.5 Inter,system-ui,sans-serif}main{max-width:420px;padding:24px;text-align:center}b{display:block;font-size:20px;margin-bottom:8px}</style></head>"
    + "<body><main><b>" + title + "</b><p>" + msg + "</p></main><script>(function(){var d=" + JSON.stringify(payload || {}).replace(/</g, "\\u003c") + ";try{if(window.opener){window.opener.postMessage({musaPhotoSource:d},\"" + ORIGIN() + "\");setTimeout(function(){window.close();},400);}}catch(e){}})();</script></body></html>";
  return { statusCode: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }, body: html };
}
async function oauthCallback(event) {
  const q = event.queryStringParameters || {};
  if (q.error) return page("No se conectó Google Drive", "Google respondió: " + String(q.error).replace(/[<>]/g, "") + ". Puedes cerrar esta ventana.", { ok: false, error: q.error });
  const [payload, sig] = String(q.state || "").split(".");
  if (!payload || !(await verify("st:" + payload, sig, 16))) return page("No se conectó Google Drive", "El enlace venció o no es válido. Vuelve a intentarlo desde Musa.", { ok: false, error: "state" });
  let st; try { st = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))); } catch (e) { st = null; }
  if (!st || !st.ws || !st.uid || Date.now() > st.exp) return page("No se conectó Google Drive", "El enlace venció. Vuelve a intentarlo desde Musa.", { ok: false, error: "expired" });
  try {
    const j = await tokenCall({ grant_type: "authorization_code", code: String(q.code || ""), redirect_uri: redirectUri() });
    let who = {};
    try { const r = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: "Bearer " + j.access_token } }); who = r.ok ? await r.json() : {}; } catch (e) { /* sin perfil */ }
    const sb = db();
    const { data: prev } = await sb.from("photo_sources").select("id,encrypted,meta").eq("workspace_id", st.ws).eq("provider", "google_drive").eq("account_email", who.email || "").maybeSingle();
    const rt = j.refresh_token || (prev && prev.encrypted ? decrypt(prev.encrypted) : "");
    if (!rt) return page("Falta un permiso", "Google no entregó el permiso para seguir conectado. Quita a Musa en myaccount.google.com/permissions y vuelve a conectar.", { ok: false, error: "no_refresh" });
    const id = prev ? prev.id : rid("psrc_");
    const row = { id, workspace_id: st.ws, provider: "google_drive", account_email: who.email || null, account_name: who.name || null, encrypted: encrypt(rt), meta: { ...((prev && prev.meta) || {}), scope: j.scope || "", picture: who.picture || null }, created_by: st.uid, updated_at: new Date().toISOString() };
    const { error } = await sb.from("photo_sources").upsert(row, { onConflict: "id" });
    if (error) return page("No se conectó Google Drive", NO_TABLE.test(error.message) ? "Falta aplicar la migración 44 de Musa (fotos)." : "No se pudo guardar la conexión.", { ok: false, error: error.message });
    TOK.set(id, { at: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000, row });
    return page("Google Drive conectado", "Listo: " + (who.email || "tu cuenta") + " quedó conectada a Musa. Esta ventana se cierra sola.", { ok: true, id, email: who.email || null });
  } catch (e) {
    return page("No se conectó Google Drive", String(e.message || e).replace(/[<>]/g, ""), { ok: false, error: e.message });
  }
}

export async function handler(event) {
  try {
    const path = String(event.path || "").replace(/\/+$/, ""), seg = path.split("/").slice(3).map(decodeURIComponent), M = event.httpMethod;
    if (M === "OPTIONS") return { statusCode: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET", "Access-Control-Allow-Headers": "*" }, body: "" };
    /* públicos: proxy de imágenes y regreso de Google */
    if (seg[0] === "f" && M === "GET") return proxyDrive(new Request(event.url), seg[1], seg[2], seg[3], Math.max(0, Math.min(4000, Number((event.queryStringParameters || {}).s) || 0)));
    if (seg[0] === "l" && M === "GET") return proxyLink(new Request(event.url), seg[1], seg[2]);
    if (seg[0] === "google" && seg[1] === "callback") return oauthCallback(event);
    const user = await userOf(event);
    if (!user) return out(401, { error: "Inicia sesión" });
    const auth = { userId: user.id, authType: "user" }, q = event.queryStringParameters || {};
    let body = {}; try { body = event.body ? JSON.parse(event.isBase64Encoded ? atob(event.body) : event.body) : {}; } catch (e) { return out(400, { error: "JSON inválido" }); }
    if (!seg[0] && M === "GET") return out(200, await sourcesStatus(auth, String(q.workspaceId || "")));
    if (seg[0] === "photos" && M === "GET") return out(200, await listPhotos(auth, q));
    if (seg[0] === "google" && seg[1] === "start" && M === "POST") {
      const g = googleCfg(); if (!g.ok) return out(503, { error: "Google Drive aún no está configurado en Musa", setup: true });
      const ws = String(body.workspaceId || ""); await need(auth, ws, "editor");
      const payload = b64u(new TextEncoder().encode(JSON.stringify({ ws, uid: user.id, exp: Date.now() + 15 * 60000, n: Math.random().toString(36).slice(2, 8) })));
      const state = payload + "." + (await sign("st:" + payload, 16));
      const u = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({ client_id: g.id, redirect_uri: redirectUri(), response_type: "code", scope: g.scope, access_type: "offline", prompt: "consent select_account", include_granted_scopes: "true", state }).toString();
      return out(200, { url: u });
    }
    if (seg[0] === "link" && M === "POST") { const ws = String(body.workspaceId || ""); await need(auth, ws, "editor"); const r = await linkAsset(ws, body.url, body.name, body.tags, user.id); return out(200, { photo: assetOut(r.asset), existed: r.existed }); }
    if (seg[0] === "dropbox" && M === "POST") {
      const ws = String(body.workspaceId || ""); await need(auth, ws, "editor");
      const res = [], errors = [];
      for (const f of (body.files || []).slice(0, 100)) { try { const r = await linkAsset(ws, f.link || f.url, f.name, body.tags, user.id); res.push({ ...assetOut(r.asset), existed: r.existed }); } catch (e) { errors.push({ name: f.name, error: e.message }); } }
      return out(200, { imported: res, errors });
    }
    if (seg[0] === "save" && M === "POST") { const r = await saveEdited(auth, body, user.id); return out(200, r.upload ? await saveMusaCopy(auth, body) : r); }
    if (seg[0] === "asset" && seg[1] && M === "PATCH") return out(200, await updatePhoto(auth, { ...body, assetId: seg[1] }));
    if (seg[0] === "asset" && seg[1] && M === "DELETE") return out(200, await removePhoto(auth, { assetId: seg[1] }));
    if (seg[0] && seg[0].indexOf("psrc_") === 0) {
      const sid = seg[0];
      if (seg[1] === "token" && M === "POST") { const row = await srcFor(auth, sid, "editor"); const T = await accessToken(row.id); const g = googleCfg(); return out(200, { accessToken: T.at, expiresIn: Math.round((T.exp - Date.now()) / 1000), apiKey: g.apiKey || null, appId: g.appId || null, email: row.account_email }); }
      if (seg[1] === "browse" && M === "GET") return out(200, await driveList(auth, { ...q, sourceId: sid }));
      if (seg[1] === "import" && M === "POST") return out(200, await driveImport(auth, { ...body, sourceId: sid }, user.id));
      if (!seg[1] && M === "DELETE") return out(200, await disconnect(auth, sid));
    }
    return out(404, { error: "Ruta desconocida" });
  } catch (e) {
    return out(e.status || 500, { error: e.message || String(e) });
  }
}

/* ── MCP: la IA trabaja con las mismas fotos ── */
const S = (o) => ({ type: "string", ...o });
export const PHOTO_SOURCE_TOOLS = [
  { name: "photos_list", description: "Fotos de un espacio estén donde estén: Musa (subidas), Google Drive, Dropbox, OneDrive o un enlace. Cada foto trae source (musa | drive | dropbox | onedrive | link), url lista para usar en diseños, videos y webs (las de Drive pasan por un enlace firmado de Musa), thumb, etiquetas y, si es una edición, de qué foto salió (from) y su receta. Filtra por source, búsqueda en el nombre o etiqueta.",
    inputSchema: { type: "object", properties: { workspaceId: S({}), source: S({ enum: ["musa", "drive", "dropbox", "onedrive", "link"] }), search: S({}), tag: S({}), limit: { type: "number" }, offset: { type: "number" } }, required: ["workspaceId"] } },
  { name: "photos_sources", description: "De dónde puede traer fotos un espacio: cuentas de Google Drive conectadas (id psrc_…, correo), si Google Drive y el selector de Dropbox están disponibles en Musa, y si se puede explorar todo el Drive o solo lo elegido en el selector de Google.",
    inputSchema: { type: "object", properties: { workspaceId: S({}) }, required: ["workspaceId"] } },
  { name: "photos_import_link", description: "Suma a Fotos una imagen por su enlace sin copiarla a Musa: Dropbox (se pasa a enlace directo), Google Drive compartido como «Cualquier persona con el enlace», OneDrive o cualquier https. Queda con source dropbox | drive | onedrive | link.",
    inputSchema: { type: "object", properties: { workspaceId: S({}), url: S({}), name: S({}), tags: { type: "array", items: { type: "string" } } }, required: ["workspaceId", "url"] } },
  { name: "photos_drive_list", description: "Archivos de una cuenta de Google Drive conectada (sourceId de photos_sources): imágenes y carpetas, con miniatura. Con el permiso básico de Google solo aparecen las fotos que la persona eligió en el selector y las que Musa guardó en su carpeta «Musa».",
    inputSchema: { type: "object", properties: { sourceId: S({}), folderId: S({}), query: S({ description: "Busca en el nombre" }), pageToken: S({}), limit: { type: "number" } }, required: ["sourceId"] } },
  { name: "photos_drive_import", description: "Suma fotos de Google Drive a Fotos de Musa (por id de archivo). La foto queda en Drive; Musa guarda la referencia y una url firmada para usarla en diseños, videos y webs.",
    inputSchema: { type: "object", properties: { sourceId: S({}), fileIds: { type: "array", items: { type: "string" } }, tags: { type: "array", items: { type: "string" } } }, required: ["sourceId", "fileIds"] } },
  { name: "photos_update", description: "Renombra una foto o cambia sus etiquetas (tags, addTags, removeTags). Sirve para ordenar por campaña, cliente o tema sin mover el archivo de su lugar.",
    inputSchema: { type: "object", properties: { assetId: S({}), name: S({}), tags: { type: "array", items: { type: "string" } }, addTags: { type: "array", items: { type: "string" } }, removeTags: { type: "array", items: { type: "string" } } }, required: ["assetId"] } },
  { name: "photos_remove", description: "Quita una foto de Fotos. Si es de Drive, Dropbox o un enlace, el original sigue donde estaba (Musa nunca borra archivos de la cuenta de la persona); si se subió a Musa, pasa a la papelera.",
    inputSchema: { type: "object", properties: { assetId: S({}) }, required: ["assetId"] } },
  { name: "photos_save_copy", description: "Guarda una foto ya editada (data: imagen en base64 o data URL) junto al original: si el original es de Google Drive va a la carpeta «Musa» de esa cuenta; si no, a Musa. Queda unida al original (fromAssetId) con la receta del revelado (recipe). saveTo: same (por defecto), drive o musa.",
    inputSchema: { type: "object", properties: { workspaceId: S({}), fromAssetId: S({}), data: S({ description: "Imagen JPG/PNG/WEBP en base64 o data URL" }), name: S({}), recipe: { type: "object" }, saveTo: S({ enum: ["same", "drive", "musa"] }), sourceId: S({}), tags: { type: "array", items: { type: "string" } } }, required: ["data"] } },
];
export const PHOTO_SOURCE_NAMES = new Set(PHOTO_SOURCE_TOOLS.map((t) => t.name));
export const PHOTO_SOURCE_READ = ["photos_list", "photos_sources", "photos_drive_list"];
export async function handlePhotoSourceTool(method, p, auth) {
  try {
    if (method === "photos_list") return await listPhotos(auth, p);
    if (method === "photos_sources") return await sourcesStatus(auth, String(p.workspaceId || ""));
    if (method === "photos_import_link") { const ws = String(p.workspaceId || ""); await need(auth, ws, "editor"); const r = await linkAsset(ws, p.url, p.name, p.tags, auth.userId); return { photo: assetOut(r.asset), existed: r.existed }; }
    if (method === "photos_drive_list") return await driveList(auth, p);
    if (method === "photos_drive_import") return await driveImport(auth, p, auth.userId);
    if (method === "photos_update") return await updatePhoto(auth, p);
    if (method === "photos_remove") return await removePhoto(auth, p);
    if (method === "photos_save_copy") { const r = await saveEdited(auth, p, auth.userId); return r.upload ? await saveMusaCopy(auth, p) : r; }
  } catch (e) { throw { code: e.status === 404 ? -32004 : e.status === 403 ? -32003 : e.status === 400 ? -32602 : -32000, message: e.message || String(e) }; }
  throw { code: -32601, message: "Método desconocido: " + method };
}
