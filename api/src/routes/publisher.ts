/**
 * Musa Publisher — rutas /api/publisher/* (JWT de usuario obligatorio, salvo el
 * regreso de OAuth y el enlace para clientes, que se validan con un state de un solo uso).
 *
 *   GET    /providers                         catálogo para el asistente (+ redes que aún no)
 *   GET    /apps?workspaceId=                 apps de developer guardadas (sin secretos)
 *   POST   /apps                              { workspaceId, app, client_id, client_secret }
 *   DELETE /apps/:app?workspaceId=
 *   POST   /oauth/:provider/start             { workspaceId, brandId? } → { url } (abrir en ventana)
 *   POST   /oauth/:provider/link              { workspaceId, brandId? } → { url } enlace para el cliente (7 días, 1 uso)
 *   GET    /connect/:state                    público: el cliente abre el enlace → consentimiento de la red
 *   GET    /oauth/callback                    público: canjea, cifra y guarda la(s) cuenta(s)
 *   POST   /accounts/token                    { workspaceId, provider, input, brandId? } (token-BYOK)
 *   GET    /accounts?workspaceId=&brandId=
 *   PATCH  /accounts/:id                      { brand_id?, options: { subreddit?, board_id? } }
 *   POST   /accounts/:id/check                renueva / valida la conexión
 *   DELETE /accounts/:id
 *   POST   /publish                           { workspaceId, media_url, media_small_url?, media_mime, caption, captions?, account_ids[], mode, brand_id? }
 *   GET    /jobs?workspaceId=&brandId=  ·  GET /jobs/:id
 *   POST   /jobs/:id/run                      siguiente tanda (cuando hay muchas cuentas)
 *   POST   /jobs/:id/retry                    reintenta los destinos que fallaron
 *
 * Ningún GET devuelve tokens ni client_secret. Sin disparos automáticos.
 */
import { Router, type Request, type Response } from "express";
import { getSupabaseAdmin } from "../services/supabase.js";
import { canAccessWorkspace } from "../services/tenancy.js";
import { asyncRoute } from "../middleware/asyncRoute.js";
import { getProvider, providerCatalog, providersOfApp, appKeyOf, NOT_YET } from "../services/publishers/index.js";
import { seal, randomToken, pkceChallenge } from "../services/publishers/crypto.js";
import { appFor, liveEnabled, loadAccount, runJob, MAX_ATTEMPTS } from "../services/publishers/dispatch.js";
import type { AccountIdentity, Tokens } from "../services/publishers/types.js";

export const publisherRoutes = Router();
export const publisherCallbackRoutes = Router();

/** Cuentas por publicación. El envío va en tandas, así que una agencia puede usar muchas. */
const MAX_TARGETS = 60;
const STATE_TTL_MS = 10 * 60 * 1000;
const LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ACCOUNT_COLS = "id, workspace_id, brand_id, provider, kind, display_name, username, avatar_url, external_id, expires_at, options, status, last_error, checked_at, created_at";

function db() {
  const sb = getSupabaseAdmin();
  if (!sb) throw Object.assign(new Error("Supabase no está configurado"), { status: 503 });
  return sb;
}
function fail(res: Response, status: number, error: string) {
  return res.status(status).json({ success: false, error });
}
async function allowed(req: Request, workspaceId: string, min: "viewer" | "editor" = "editor") {
  return !!workspaceId && !!req.auth && (await canAccessWorkspace(req.auth, workspaceId, min));
}
function baseUrl(req: Request) {
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "localhost");
  const proto = /^(localhost|127\.)/.test(host) ? "http" : "https";
  return `${proto}://${host}`;
}
/** Una sola dirección de regreso para todas las redes (se pega una vez en cada portal). */
function redirectUri(req: Request) {
  return `${baseUrl(req)}/api/publisher/oauth/callback`;
}
function wsParam(req: Request) {
  return String((req.method === "GET" || req.method === "DELETE" ? req.query.workspaceId : req.body?.workspaceId) || "");
}
async function brandOk(ws: string, brandId: unknown) {
  if (brandId === null || brandId === undefined || brandId === "") return null;
  const { data } = await db().from("brands").select("id").eq("id", String(brandId)).eq("workspace_id", ws).maybeSingle();
  if (!data) throw Object.assign(new Error("Esa marca no es de este espacio"), { status: 400 });
  return data.id as string;
}
async function accountRow(req: Request, id: string, min: "viewer" | "editor" = "editor") {
  const { data } = await db().from("publisher_accounts").select("*").eq("id", id).maybeSingle();
  if (!data || !(await allowed(req, data.workspace_id, min))) return null;
  return data;
}
function supabaseHost() {
  try { return new URL(process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL_DE_REPO_DESIGN || "").host; } catch { return ""; }
}
function isMusaFile(raw: string) {
  try { const u = new URL(raw); return u.protocol === "https:" && u.host === supabaseHost() && u.pathname.startsWith("/storage/v1/object/public/"); } catch { return false; }
}
const err = (res: Response, e: any) => fail(res, e?.status || 400, String(e?.message || e));

/* ── catálogo ── */
publisherRoutes.get("/providers", (req, res) => {
  res.json({ success: true, data: providerCatalog(), notYet: NOT_YET, redirectUri: redirectUri(req), live: liveEnabled(), maxTargets: MAX_TARGETS });
});

/* ── apps de developer (BYOK OAuth), por «app» (meta = Facebook + Instagram, google = Business + Blogger…) ── */
publisherRoutes.get("/apps", asyncRoute(async (req, res) => {
  const ws = wsParam(req);
  if (!(await allowed(req, ws, "viewer"))) return fail(res, 403, "Sin acceso a este espacio");
  const { data } = await db().from("publisher_oauth_apps").select("provider, client_id, client_secret_encrypted, updated_at").eq("workspace_id", ws);
  res.json({ success: true, data: (data || []).map((a: any) => ({ app: a.provider, client_id: a.client_id, has_secret: !!a.client_secret_encrypted, updated_at: a.updated_at })) });
}));

publisherRoutes.post("/apps", asyncRoute(async (req, res) => {
  const ws = wsParam(req), key = String(req.body?.app || req.body?.provider || "");
  if (!(await allowed(req, ws))) return fail(res, 403, "Sin acceso a este espacio");
  const p = getProvider(key);
  const appKey = p ? appKeyOf(p) : key;
  if (!providersOfApp(appKey).length) return fail(res, 400, "App desconocida");
  const clientId = String(req.body?.client_id || "").trim(), secret = String(req.body?.client_secret || "").trim();
  if (clientId.length < 4) return fail(res, 400, "Falta el Client ID");
  const sb = db();
  const { data: prev } = await sb.from("publisher_oauth_apps").select("client_secret_encrypted").eq("workspace_id", ws).eq("provider", appKey).maybeSingle();
  if (!secret && !prev?.client_secret_encrypted) return fail(res, 400, "Falta el secreto de la app");
  const { error } = await sb.from("publisher_oauth_apps").upsert({
    workspace_id: ws, provider: appKey, client_id: clientId,
    client_secret_encrypted: secret ? await seal(secret) : prev?.client_secret_encrypted || null,
    created_by: req.auth!.userId, updated_at: new Date().toISOString(),
  }, { onConflict: "workspace_id,provider" });
  if (error) return fail(res, 500, error.message);
  res.json({ success: true });
}));

publisherRoutes.delete("/apps/:app", asyncRoute(async (req, res) => {
  const ws = wsParam(req);
  if (!(await allowed(req, ws))) return fail(res, 403, "Sin acceso a este espacio");
  await db().from("publisher_oauth_apps").delete().eq("workspace_id", ws).eq("provider", req.params.app);
  res.json({ success: true });
}));

/* ── OAuth ── */
async function newState(req: Request, link: boolean) {
  const ws = wsParam(req), provider = getProvider(req.params.provider);
  if (!(await allowed(req, ws))) throw Object.assign(new Error("Sin acceso a este espacio"), { status: 403 });
  if (!provider || provider.kind !== "oauth" || !provider.authUrl) throw new Error("Red desconocida o sin OAuth");
  const brandId = await brandOk(ws, req.body?.brandId);
  const sb = db();
  const app = await appFor(sb, ws, provider.id);
  if (!app) throw new Error(`Primero guarda el Client ID y el secreto de tu app de ${provider.appName || provider.name}`);
  const state = randomToken(24), verifier = randomToken(48), uri = redirectUri(req);
  await sb.from("publisher_oauth_states").delete().lt("expires_at", new Date().toISOString());
  const { error } = await sb.from("publisher_oauth_states").insert({
    state, workspace_id: ws, user_id: req.auth!.userId, provider: provider.id, code_verifier: verifier, redirect_uri: uri,
    brand_id: brandId, is_link: link, expires_at: new Date(Date.now() + (link ? LINK_TTL_MS : STATE_TTL_MS)).toISOString(),
  });
  if (error) throw new Error(error.message);
  return { provider, app, state, verifier, uri };
}
publisherRoutes.post("/oauth/:provider/start", asyncRoute(async (req, res) => {
  try {
    const s = await newState(req, false);
    res.json({ success: true, url: s.provider.authUrl!({ app: s.app, redirectUri: s.uri, state: s.state, codeChallenge: await pkceChallenge(s.verifier) }), redirectUri: s.uri });
  } catch (e) { err(res, e); }
}));
publisherRoutes.post("/oauth/:provider/link", asyncRoute(async (req, res) => {
  try {
    const s = await newState(req, true);
    res.json({ success: true, url: `${baseUrl(req)}/api/publisher/connect/${s.state}`, expiresAt: new Date(Date.now() + LINK_TTL_MS).toISOString() });
  } catch (e) { err(res, e); }
}));

function page(res: Response, status: number, title: string, message: string, script = "") {
  const safe = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
  res.status(status).setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  return res.send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Musa · Conexión</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#f4f2ea;color:#1a1a1a;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}main{max-width:440px;background:#fff;border-radius:16px;padding:24px;text-align:center}b{display:block;font-size:20px;margin-bottom:6px}a{color:#1a1a1a}</style></head>
<body><main><b>${safe(title)}</b><p>${safe(message)}</p></main>${script}</body></html>`);
}

/** El cliente abre el enlace que le mandó la agencia: va directo al consentimiento de la red. */
publisherCallbackRoutes.get("/connect/:state", asyncRoute(async (req, res) => {
  const sb = db();
  const { data: st } = await sb.from("publisher_oauth_states").select("*").eq("state", req.params.state).eq("is_link", true).maybeSingle();
  if (!st || new Date(st.expires_at).getTime() < Date.now()) return page(res, 410, "Enlace vencido", "Este enlace ya se usó o venció. Pide uno nuevo a quien te lo envió.");
  const provider = getProvider(st.provider);
  const app = provider ? await appFor(sb, st.workspace_id, provider.id) : null;
  if (!provider?.authUrl || !app) return page(res, 400, "No disponible", "La conexión ya no está configurada. Pide un enlace nuevo.");
  const url = provider.authUrl({ app, redirectUri: st.redirect_uri, state: st.state, codeChallenge: await pkceChallenge(st.code_verifier || "") });
  res.status(302).setHeader("Location", url);
  res.setHeader("Cache-Control", "no-store");
  return res.end();
}));

async function saveIdentity(ws: string, providerId: string, kind: "oauth" | "token", who: AccountIdentity, tokens: Tokens, userId: string, brandId: string | null) {
  const sb = db();
  const pid = who.provider || providerId, tk = who.tokens || tokens;
  const { data: prev } = await sb.from("publisher_accounts").select("options, brand_id").eq("workspace_id", ws).eq("provider", pid).eq("external_id", who.externalId).maybeSingle();
  const { data, error } = await sb.from("publisher_accounts").upsert({
    workspace_id: ws, provider: pid, kind, external_id: who.externalId,
    display_name: who.displayName, username: who.username || null, avatar_url: who.avatarUrl || null,
    access_token_encrypted: await seal(tk.accessToken),
    refresh_token_encrypted: tk.refreshToken ? await seal(tk.refreshToken) : null,
    expires_at: tk.expiresAt || null, options: { ...((prev?.options as any) || {}), ...(who.options || {}) },
    brand_id: brandId ?? prev?.brand_id ?? null,
    status: "active", last_error: null, checked_at: new Date().toISOString(), created_by: userId, updated_at: new Date().toISOString(),
  }, { onConflict: "workspace_id,provider,external_id" }).select(ACCOUNT_COLS).single();
  if (error) throw new Error(error.message);
  return data;
}

async function oauthCallback(req: Request, res: Response) {
  const state = String(req.query.state || ""), code = String(req.query.code || "");
  const sb = db();
  const { data: st } = state ? await sb.from("publisher_oauth_states").delete().eq("state", state).select("*").maybeSingle() : { data: null };
  const provider = st ? getProvider(st.provider) : null;
  const name = provider?.name || "la red";
  const reply = (ok: boolean, message: string) => {
    if (st?.is_link) return page(res, ok ? 200 : 400, ok ? "¡Listo, gracias!" : "No se pudo conectar", ok ? `${message} Ya puedes cerrar esta ventana.` : message);
    const payload = JSON.stringify({ type: "musa-publisher", ok, provider: st?.provider || "", message }).replace(/</g, "\\u003c");
    return page(res, ok ? 200 : 400, ok ? "Cuenta conectada" : "No se pudo conectar", message,
      `<script>try{if(window.opener){window.opener.postMessage(${payload},location.origin);setTimeout(function(){window.close()},${ok ? 900 : 4000})}}catch(e){}</script>`);
  };
  if (!st || !provider?.exchangeCode) return reply(false, "El enlace venció o ya se usó. Vuelve a apretar Conectar.");
  if (new Date(st.expires_at || st.created_at).getTime() + (st.expires_at ? 0 : STATE_TTL_MS) < Date.now()) return reply(false, "El enlace venció. Vuelve a apretar Conectar.");
  if (req.query.error) return reply(false, `${name} canceló la conexión (${String(req.query.error_description || req.query.error)})`);
  if (!code) return reply(false, `Faltan datos en la respuesta de ${name}`);
  try {
    const app = await appFor(sb, st.workspace_id, provider.id);
    if (!app) throw new Error("La app de developer ya no está guardada");
    let tokens = await provider.exchangeCode({ app, code, redirectUri: st.redirect_uri, codeVerifier: st.code_verifier || "" });
    if (provider.longLived) tokens = await provider.longLived({ app, tokens });
    const ids = provider.listAccounts ? await provider.listAccounts({ app, tokens }) : [await provider.identify({ tokens })];
    const saved = [];
    for (const who of ids) saved.push(await saveIdentity(st.workspace_id, provider.id, "oauth", who, tokens, st.user_id, st.brand_id || null));
    const names = saved.map((a: any) => a.display_name).slice(0, 6).join(", ") + (saved.length > 6 ? ` y ${saved.length - 6} más` : "");
    return reply(true, saved.length > 1 ? `Se conectaron ${saved.length} cuentas a Musa: ${names}.` : `${names} quedó conectada a Musa.`);
  } catch (e: any) {
    return reply(false, String(e?.message || e));
  }
}
publisherCallbackRoutes.get("/oauth/callback", asyncRoute(oauthCallback));
// Compatibilidad con la dirección por red de la fase 1.
publisherCallbackRoutes.get("/oauth/:provider/callback", asyncRoute(oauthCallback));

/* ── cuentas ── */
publisherRoutes.post("/accounts/token", asyncRoute(async (req, res) => {
  const ws = wsParam(req), provider = getProvider(String(req.body?.provider || ""));
  if (!(await allowed(req, ws))) return fail(res, 403, "Sin acceso a este espacio");
  if (!provider || provider.kind !== "token" || !provider.tokensFromInput) return fail(res, 400, "Esa red no se conecta con token");
  const input: Record<string, string> = {};
  for (const f of provider.fields) input[f.key] = String(req.body?.input?.[f.key] || "").trim();
  try {
    const brandId = await brandOk(ws, req.body?.brandId);
    const tokens = provider.tokensFromInput(input);
    const who = await provider.identify({ tokens, input });
    res.json({ success: true, data: await saveIdentity(ws, provider.id, "token", who, tokens, req.auth!.userId, brandId) });
  } catch (e: any) { err(res, e); }
}));

publisherRoutes.get("/accounts", asyncRoute(async (req, res) => {
  const ws = wsParam(req);
  if (!(await allowed(req, ws, "viewer"))) return fail(res, 403, "Sin acceso a este espacio");
  let q = db().from("publisher_accounts").select(ACCOUNT_COLS).eq("workspace_id", ws).order("created_at");
  if (req.query.brandId) q = q.or(`brand_id.eq.${String(req.query.brandId).replace(/[^\w-]/g, "")},brand_id.is.null`);
  const { data, error } = await q;
  if (error) return fail(res, 500, error.message);
  res.json({ success: true, data: data || [] });
}));

publisherRoutes.patch("/accounts/:id", asyncRoute(async (req, res) => {
  const row = await accountRow(req, req.params.id);
  if (!row) return fail(res, 404, "Cuenta no encontrada");
  const patch: any = { updated_at: new Date().toISOString() };
  const options = { ...(row.options || {}) };
  try {
    if (req.body && "brand_id" in req.body) patch.brand_id = await brandOk(row.workspace_id, req.body.brand_id);
    const o = req.body?.options || {};
    if (row.provider === "reddit" && o.subreddit !== undefined) {
      const sr = String(o.subreddit || "").trim().replace(/^\/?r\//i, "");
      if (sr && !/^[A-Za-z0-9_]{2,25}$/.test(sr)) return fail(res, 400, "Nombre de subreddit no válido");
      options.subreddit = sr || `u_${row.username}`;
    }
    if (row.provider === "pinterest" && o.board_id !== undefined) {
      if (!(options.boards || []).some((b: any) => b.id === String(o.board_id))) return fail(res, 400, "Ese tablero no está en la cuenta (aprieta Revisar para actualizar la lista)");
      options.board_id = String(o.board_id);
    }
  } catch (e) { return err(res, e); }
  patch.options = options;
  const { data, error } = await db().from("publisher_accounts").update(patch).eq("id", row.id).select(ACCOUNT_COLS).single();
  if (error) return fail(res, 500, error.message);
  res.json({ success: true, data });
}));

publisherRoutes.post("/accounts/:id/check", asyncRoute(async (req, res) => {
  const row = await accountRow(req, req.params.id);
  if (!row) return fail(res, 404, "Cuenta no encontrada");
  const sb = db(), provider = getProvider(row.provider)!;
  try {
    const acc = await loadAccount(sb, row, { forceRefresh: !!provider.refresh && !!row.refresh_token_encrypted });
    const who = await provider.identify({ tokens: acc.tokens, options: { ...(row.options || {}), external_id: row.external_id } });
    await sb.from("publisher_accounts").update({ display_name: who.displayName, avatar_url: who.avatarUrl || row.avatar_url, options: { ...(row.options || {}), ...(who.options || {}) }, status: "active", last_error: null, checked_at: new Date().toISOString() }).eq("id", row.id);
  } catch (e: any) {
    await sb.from("publisher_accounts").update({ status: e?.auth ? "expired" : "error", last_error: String(e?.message || e).slice(0, 500), checked_at: new Date().toISOString() }).eq("id", row.id);
  }
  const { data } = await sb.from("publisher_accounts").select(ACCOUNT_COLS).eq("id", row.id).single();
  res.json({ success: true, data });
}));

publisherRoutes.delete("/accounts/:id", asyncRoute(async (req, res) => {
  const row = await accountRow(req, req.params.id);
  if (!row) return fail(res, 404, "Cuenta no encontrada");
  await db().from("publisher_accounts").delete().eq("id", row.id);
  res.json({ success: true });
}));

/* ── publicar ── */
publisherRoutes.post("/publish", asyncRoute(async (req, res) => {
  const ws = wsParam(req);
  if (!(await allowed(req, ws))) return fail(res, 403, "Sin acceso a este espacio");
  const mediaUrl = String(req.body?.media_url || "").trim(), small = String(req.body?.media_small_url || "").trim() || null;
  const mime = String(req.body?.media_mime || "").trim().toLowerCase();
  const caption = String(req.body?.caption ?? "");
  const captionsIn = req.body?.captions && typeof req.body.captions === "object" ? req.body.captions : {};
  const mode = req.body?.mode === "live" ? "live" : "dry-run";
  const ids: string[] = Array.isArray(req.body?.account_ids) ? [...new Set(req.body.account_ids.map(String))] as string[] : [];
  if (!isMusaFile(mediaUrl) || (small && !isMusaFile(small))) return fail(res, 400, "La imagen debe ser un archivo público de Musa (súbela primero)");
  if (!["image/png", "image/jpeg"].includes(mime)) return fail(res, 400, "Por ahora solo se publican imágenes PNG o JPG (los videos llegan con los planes pagos)");
  if (!ids.length) return fail(res, 400, "Elige al menos una cuenta");
  if (ids.length > MAX_TARGETS) return fail(res, 400, `Máximo ${MAX_TARGETS} cuentas por publicación`);
  const sb = db();
  let brandId: string | null = null;
  try { brandId = await brandOk(ws, req.body?.brand_id); } catch (e) { return err(res, e); }
  const { data: accounts } = await sb.from("publisher_accounts").select("id, provider, display_name, status").eq("workspace_id", ws).in("id", ids);
  if ((accounts || []).length !== ids.length) return fail(res, 400, "Alguna cuenta no existe en este espacio");
  // Validar ANTES de crear la publicación: formato y largo del texto por red.
  const captions: Record<string, string> = {};
  for (const a of accounts!) {
    const p = getProvider(a.provider);
    if (!p) return fail(res, 400, `Red desconocida: ${a.provider}`);
    const text = typeof captionsIn[p.id] === "string" ? String(captionsIn[p.id]) : caption;
    if (typeof captionsIn[p.id] === "string") captions[p.id] = text;
    const useSmall = p.limits.maxBytes < 2 * 1048576 && small;
    if (!p.limits.formats.includes(useSmall ? "image/jpeg" : mime)) return fail(res, 400, `${p.name} solo acepta ${p.limits.formats.map((f) => f.replace("image/", "").toUpperCase()).join(" o ")}`);
    if (text.length > p.limits.maxChars) return fail(res, 400, `El texto para ${p.name} tiene ${text.length} caracteres y acepta hasta ${p.limits.maxChars}`);
  }
  const { data: job, error } = await sb.from("publish_jobs").insert({
    workspace_id: ws, brand_id: brandId, template_id: req.body?.template_id ? String(req.body.template_id) : null, content_id: req.body?.content_id ? String(req.body.content_id) : null,
    media_url: mediaUrl, media_small_url: small, media_mime: mime, caption, captions, mode, status: "queued", created_by: req.auth!.userId,
  }).select("id").single();
  if (error || !job) return fail(res, 500, error?.message || "No se pudo crear la publicación");
  const { error: tErr } = await sb.from("publish_targets").insert(accounts!.map((a: any) => ({ job_id: job.id, account_id: a.id, provider: a.provider, account_name: a.display_name })));
  if (tErr) return fail(res, 500, tErr.message);
  const r = await runJob(sb, job.id);
  const { data: targets } = await sb.from("publish_targets").select("*").eq("job_id", job.id).order("created_at");
  res.status(202).json({ success: true, job_id: job.id, status: r.status, remaining: r.remaining, mode, live: mode === "live" && liveEnabled(), targets: targets || [] });
}));

publisherRoutes.get("/jobs", asyncRoute(async (req, res) => {
  const ws = wsParam(req);
  if (!(await allowed(req, ws, "viewer"))) return fail(res, 403, "Sin acceso a este espacio");
  let q = db().from("publish_jobs").select("*, publish_targets(*)").eq("workspace_id", ws).order("created_at", { ascending: false }).limit(Math.min(Number(req.query.limit) || 20, 100));
  if (req.query.brandId) q = q.eq("brand_id", String(req.query.brandId));
  const { data, error } = await q;
  if (error) return fail(res, 500, error.message);
  res.json({ success: true, data: data || [] });
}));

async function jobFor(req: Request, id: string, min: "viewer" | "editor") {
  const { data } = await db().from("publish_jobs").select("*, publish_targets(*)").eq("id", id).maybeSingle();
  if (!data || !(await allowed(req, data.workspace_id, min))) return null;
  return data;
}

publisherRoutes.get("/jobs/:id", asyncRoute(async (req, res) => {
  const job = await jobFor(req, req.params.id, "viewer");
  if (!job) return fail(res, 404, "Publicación no encontrada");
  res.json({ success: true, data: job });
}));

publisherRoutes.post("/jobs/:id/run", asyncRoute(async (req, res) => {
  const job = await jobFor(req, req.params.id, "editor");
  if (!job) return fail(res, 404, "Publicación no encontrada");
  const r = await runJob(db(), job.id);
  const fresh = await jobFor(req, req.params.id, "viewer");
  res.json({ success: true, status: r.status, remaining: r.remaining, data: fresh });
}));

publisherRoutes.post("/jobs/:id/retry", asyncRoute(async (req, res) => {
  const job = await jobFor(req, req.params.id, "editor");
  if (!job) return fail(res, 404, "Publicación no encontrada");
  const failed = (job.publish_targets || []).filter((t: any) => t.status === "failed" && t.attempts < MAX_ATTEMPTS).map((t: any) => t.id);
  const only = Array.isArray(req.body?.target_ids) && req.body.target_ids.length ? failed.filter((id: string) => req.body.target_ids.includes(id)) : failed;
  if (!only.length) return fail(res, 400, "No hay destinos para reintentar");
  const r = await runJob(db(), job.id, { only, retry: true });
  const fresh = await jobFor(req, req.params.id, "viewer");
  res.json({ success: true, status: r.status, remaining: r.remaining, data: fresh });
}));
