/**
 * Musa Publisher — rutas /api/publisher/* (JWT de usuario obligatorio, salvo el
 * callback de OAuth, que llega del navegador del proveedor y se valida con el state).
 *
 *   GET    /providers                       catálogo para el asistente
 *   GET    /apps?workspaceId=               apps de developer guardadas (sin secretos)
 *   POST   /apps                            { workspaceId, provider, client_id, client_secret }
 *   DELETE /apps/:provider?workspaceId=
 *   POST   /oauth/:provider/start           { workspaceId } → { url } (abrir en ventana)
 *   GET    /oauth/:provider/callback        público: canjea, cifra y guarda la cuenta
 *   POST   /accounts/token                  { workspaceId, provider, input } (token-BYOK)
 *   GET    /accounts?workspaceId=
 *   PATCH  /accounts/:id                    { options: { subreddit } }
 *   POST   /accounts/:id/check              renueva / valida la conexión
 *   DELETE /accounts/:id
 *   POST   /publish                         { workspaceId, media_url, media_mime, caption, account_ids[], mode }
 *   GET    /jobs?workspaceId=  ·  GET /jobs/:id  ·  POST /jobs/:id/retry
 *
 * Ningún GET devuelve tokens ni client_secret. Sin disparos automáticos.
 */
import { Router, type Request, type Response } from "express";
import { getSupabaseAdmin } from "../services/supabase.js";
import { canAccessWorkspace } from "../services/tenancy.js";
import { asyncRoute } from "../middleware/asyncRoute.js";
import { getProvider, providerCatalog } from "../services/publishers/index.js";
import { seal, randomToken, pkceChallenge } from "../services/publishers/crypto.js";
import { appFor, liveEnabled, loadAccount, runJob, MAX_ATTEMPTS } from "../services/publishers/dispatch.js";

export const publisherRoutes = Router();
export const publisherCallbackRoutes = Router();

const MAX_TARGETS = 6; // plan gratis de Workers: 50 llamadas externas por pedido
const STATE_TTL_MS = 10 * 60 * 1000;
const ACCOUNT_COLS = "id, workspace_id, provider, kind, display_name, username, avatar_url, external_id, expires_at, options, status, last_error, checked_at, created_at";

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
function redirectUri(req: Request, provider: string) {
  return `${baseUrl(req)}/api/publisher/oauth/${provider}/callback`;
}
function wsParam(req: Request) {
  return String((req.method === "GET" || req.method === "DELETE" ? req.query.workspaceId : req.body?.workspaceId) || "");
}
async function accountRow(req: Request, id: string, min: "viewer" | "editor" = "editor") {
  const { data } = await db().from("publisher_accounts").select("*").eq("id", id).maybeSingle();
  if (!data || !(await allowed(req, data.workspace_id, min))) return null;
  return data;
}
function publicAccount(row: any) {
  const out: any = {};
  for (const k of ACCOUNT_COLS.split(", ")) out[k] = row[k];
  return out;
}
function supabaseHost() {
  try { return new URL(process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL_DE_REPO_DESIGN || "").host; } catch { return ""; }
}

/* ── catálogo ── */
publisherRoutes.get("/providers", (req, res) => {
  res.json({
    success: true,
    data: providerCatalog().map((p) => ({ ...p, redirectUri: p.kind === "oauth" ? redirectUri(req, p.id) : null })),
    live: liveEnabled(),
    maxTargets: MAX_TARGETS,
  });
});

/* ── apps de developer (BYOK OAuth) ── */
publisherRoutes.get("/apps", asyncRoute(async (req, res) => {
  const ws = wsParam(req);
  if (!(await allowed(req, ws, "viewer"))) return fail(res, 403, "Sin acceso a este espacio");
  const { data } = await db().from("publisher_oauth_apps").select("provider, client_id, client_secret_encrypted, updated_at").eq("workspace_id", ws);
  res.json({ success: true, data: (data || []).map((a: any) => ({ provider: a.provider, client_id: a.client_id, has_secret: !!a.client_secret_encrypted, updated_at: a.updated_at })) });
}));

publisherRoutes.post("/apps", asyncRoute(async (req, res) => {
  const ws = wsParam(req), provider = getProvider(String(req.body?.provider || ""));
  if (!(await allowed(req, ws))) return fail(res, 403, "Sin acceso a este espacio");
  if (!provider || provider.kind !== "oauth") return fail(res, 400, "Red desconocida o sin OAuth");
  const clientId = String(req.body?.client_id || "").trim(), secret = String(req.body?.client_secret || "").trim();
  if (clientId.length < 4) return fail(res, 400, "Falta el Client ID");
  const sb = db();
  const { data: prev } = await sb.from("publisher_oauth_apps").select("client_secret_encrypted").eq("workspace_id", ws).eq("provider", provider.id).maybeSingle();
  const { error } = await sb.from("publisher_oauth_apps").upsert({
    workspace_id: ws, provider: provider.id, client_id: clientId,
    client_secret_encrypted: secret ? await seal(secret) : prev?.client_secret_encrypted || null,
    created_by: req.auth!.userId, updated_at: new Date().toISOString(),
  }, { onConflict: "workspace_id,provider" });
  if (error) return fail(res, 500, error.message);
  res.json({ success: true });
}));

publisherRoutes.delete("/apps/:provider", asyncRoute(async (req, res) => {
  const ws = wsParam(req);
  if (!(await allowed(req, ws))) return fail(res, 403, "Sin acceso a este espacio");
  await db().from("publisher_oauth_apps").delete().eq("workspace_id", ws).eq("provider", req.params.provider);
  res.json({ success: true });
}));

/* ── OAuth ── */
publisherRoutes.post("/oauth/:provider/start", asyncRoute(async (req, res) => {
  const ws = wsParam(req), provider = getProvider(req.params.provider);
  if (!(await allowed(req, ws))) return fail(res, 403, "Sin acceso a este espacio");
  if (!provider || provider.kind !== "oauth" || !provider.authUrl) return fail(res, 400, "Red desconocida o sin OAuth");
  const sb = db();
  const app = await appFor(sb, ws, provider.id);
  if (!app) return fail(res, 400, `Primero guarda el Client ID y el Secret de tu app de ${provider.name}`);
  const state = randomToken(24), verifier = randomToken(48), uri = redirectUri(req, provider.id);
  await sb.from("publisher_oauth_states").delete().lt("created_at", new Date(Date.now() - STATE_TTL_MS).toISOString());
  const { error } = await sb.from("publisher_oauth_states").insert({ state, workspace_id: ws, user_id: req.auth!.userId, provider: provider.id, code_verifier: verifier, redirect_uri: uri });
  if (error) return fail(res, 500, error.message);
  res.json({ success: true, url: provider.authUrl({ app, redirectUri: uri, state, codeChallenge: await pkceChallenge(verifier) }), redirectUri: uri });
}));

function callbackPage(res: Response, ok: boolean, message: string, provider: string) {
  const payload = JSON.stringify({ type: "musa-publisher", ok, provider, message }).replace(/</g, "\\u003c");
  const safe = message.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
  res.status(ok ? 200 : 400).setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Musa · Conexión</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#f4f2ea;color:#1a1a1a;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}main{max-width:420px;background:#fff;border-radius:16px;padding:24px;text-align:center}b{display:block;font-size:20px;margin-bottom:6px}a{color:#1a1a1a}</style></head>
<body><main><b>${ok ? "Cuenta conectada" : "No se pudo conectar"}</b><p>${safe}</p><p><a href="/#configuracion/publicar">Volver a Musa</a></p></main>
<script>try{if(window.opener){window.opener.postMessage(${payload},location.origin);setTimeout(function(){window.close()},${ok ? 900 : 4000})}}catch(e){}</script></body></html>`);
}

publisherCallbackRoutes.get("/oauth/:provider/callback", asyncRoute(async (req, res) => {
  const provider = getProvider(req.params.provider);
  const name = provider?.name || req.params.provider;
  if (!provider || !provider.exchangeCode) return callbackPage(res, false, "Red desconocida", name);
  if (req.query.error) return callbackPage(res, false, `${name} canceló la conexión (${String(req.query.error)})`, provider.id);
  const state = String(req.query.state || ""), code = String(req.query.code || "");
  if (!state || !code) return callbackPage(res, false, "Faltan datos en la respuesta de la red", provider.id);
  const sb = db();
  const { data: st } = await sb.from("publisher_oauth_states").delete().eq("state", state).eq("provider", provider.id).select("*").maybeSingle();
  if (!st || Date.now() - new Date(st.created_at).getTime() > STATE_TTL_MS) return callbackPage(res, false, "El enlace venció o ya se usó. Vuelve a apretar Conectar.", provider.id);
  try {
    const app = await appFor(sb, st.workspace_id, provider.id);
    if (!app) throw new Error("La app de developer ya no está guardada");
    const tokens = await provider.exchangeCode({ app, code, redirectUri: st.redirect_uri, codeVerifier: st.code_verifier || "" });
    const who = await provider.identify({ tokens });
    const { data: prev } = await sb.from("publisher_accounts").select("options").eq("workspace_id", st.workspace_id).eq("provider", provider.id).eq("external_id", who.externalId).maybeSingle();
    const { error } = await sb.from("publisher_accounts").upsert({
      workspace_id: st.workspace_id, provider: provider.id, kind: "oauth", external_id: who.externalId,
      display_name: who.displayName, username: who.username || null, avatar_url: who.avatarUrl || null,
      access_token_encrypted: await seal(tokens.accessToken),
      refresh_token_encrypted: tokens.refreshToken ? await seal(tokens.refreshToken) : null,
      expires_at: tokens.expiresAt || null, options: { ...(who.options || {}), ...((prev?.options as any) || {}) },
      status: "active", last_error: null, checked_at: new Date().toISOString(), created_by: st.user_id, updated_at: new Date().toISOString(),
    }, { onConflict: "workspace_id,provider,external_id" });
    if (error) throw new Error(error.message);
    return callbackPage(res, true, `${who.displayName} quedó conectada a Musa. Ya puedes cerrar esta ventana.`, provider.id);
  } catch (e: any) {
    return callbackPage(res, false, String(e?.message || e), provider.id);
  }
}));

/* ── cuentas ── */
publisherRoutes.post("/accounts/token", asyncRoute(async (req, res) => {
  const ws = wsParam(req), provider = getProvider(String(req.body?.provider || ""));
  if (!(await allowed(req, ws))) return fail(res, 403, "Sin acceso a este espacio");
  if (!provider || provider.kind !== "token" || !provider.tokensFromInput) return fail(res, 400, "Esa red no se conecta con token");
  const input: Record<string, string> = {};
  for (const f of provider.fields) input[f.key] = String(req.body?.input?.[f.key] || "").trim();
  try {
    const tokens = provider.tokensFromInput(input);
    const who = await provider.identify({ tokens, input });
    const { data, error } = await db().from("publisher_accounts").upsert({
      workspace_id: ws, provider: provider.id, kind: "token", external_id: who.externalId,
      display_name: who.displayName, username: who.username || null, avatar_url: who.avatarUrl || null,
      access_token_encrypted: await seal(tokens.accessToken), refresh_token_encrypted: null, expires_at: null,
      options: who.options || {}, status: "active", last_error: null, checked_at: new Date().toISOString(), created_by: req.auth!.userId, updated_at: new Date().toISOString(),
    }, { onConflict: "workspace_id,provider,external_id" }).select(ACCOUNT_COLS).single();
    if (error) return fail(res, 500, error.message);
    res.json({ success: true, data });
  } catch (e: any) {
    return fail(res, 400, String(e?.message || e));
  }
}));

publisherRoutes.get("/accounts", asyncRoute(async (req, res) => {
  const ws = wsParam(req);
  if (!(await allowed(req, ws, "viewer"))) return fail(res, 403, "Sin acceso a este espacio");
  const { data, error } = await db().from("publisher_accounts").select(ACCOUNT_COLS).eq("workspace_id", ws).order("created_at");
  if (error) return fail(res, 500, error.message);
  res.json({ success: true, data: data || [] });
}));

publisherRoutes.patch("/accounts/:id", asyncRoute(async (req, res) => {
  const row = await accountRow(req, req.params.id);
  if (!row) return fail(res, 404, "Cuenta no encontrada");
  const options = { ...(row.options || {}) };
  if (row.provider === "reddit" && req.body?.options?.subreddit !== undefined) {
    const sr = String(req.body.options.subreddit || "").trim().replace(/^\/?r\//i, "");
    if (sr && !/^[A-Za-z0-9_]{2,25}$/.test(sr)) return fail(res, 400, "Nombre de subreddit no válido");
    options.subreddit = sr || `u_${row.username}`;
  }
  const { data, error } = await db().from("publisher_accounts").update({ options, updated_at: new Date().toISOString() }).eq("id", row.id).select(ACCOUNT_COLS).single();
  if (error) return fail(res, 500, error.message);
  res.json({ success: true, data });
}));

publisherRoutes.post("/accounts/:id/check", asyncRoute(async (req, res) => {
  const row = await accountRow(req, req.params.id);
  if (!row) return fail(res, 404, "Cuenta no encontrada");
  const sb = db(), provider = getProvider(row.provider)!;
  try {
    const acc = await loadAccount(sb, row, { forceRefresh: !!provider.refresh && !!row.refresh_token_encrypted });
    const who = await provider.identify({ tokens: acc.tokens, input: { chat: String(row.options?.chat_id ?? row.external_id) } });
    await sb.from("publisher_accounts").update({ display_name: who.displayName, avatar_url: who.avatarUrl || row.avatar_url, status: "active", last_error: null, checked_at: new Date().toISOString() }).eq("id", row.id);
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
  const mediaUrl = String(req.body?.media_url || "").trim(), mime = String(req.body?.media_mime || "").trim().toLowerCase();
  const caption = String(req.body?.caption ?? "");
  const mode = req.body?.mode === "live" ? "live" : "dry-run";
  const ids: string[] = Array.isArray(req.body?.account_ids) ? [...new Set(req.body.account_ids.map(String))] as string[] : [];
  let u: URL;
  try { u = new URL(mediaUrl); } catch { return fail(res, 400, "media_url no es una dirección válida"); }
  if (u.protocol !== "https:" || u.host !== supabaseHost() || !u.pathname.startsWith("/storage/v1/object/public/")) return fail(res, 400, "La imagen debe ser un archivo público de Musa (súbela primero)");
  if (!["image/png", "image/jpeg"].includes(mime)) return fail(res, 400, "Por ahora solo se publican imágenes PNG o JPG (los videos llegan con los planes pagos)");
  if (!ids.length) return fail(res, 400, "Elige al menos una cuenta");
  if (ids.length > MAX_TARGETS) return fail(res, 400, `Máximo ${MAX_TARGETS} cuentas por publicación`);
  const sb = db();
  const { data: accounts } = await sb.from("publisher_accounts").select("id, provider, display_name, status").eq("workspace_id", ws).in("id", ids);
  if ((accounts || []).length !== ids.length) return fail(res, 400, "Alguna cuenta no existe en este espacio");
  // Validar ANTES de crear la publicación: largo del texto por red.
  for (const a of accounts!) {
    const p = getProvider(a.provider);
    if (!p) return fail(res, 400, `Red desconocida: ${a.provider}`);
    if (!p.limits.formats.includes(mime)) return fail(res, 400, `${p.name} no acepta ${mime}`);
    if (caption.length > p.limits.maxChars) return fail(res, 400, `El texto tiene ${caption.length} caracteres y ${p.name} acepta hasta ${p.limits.maxChars}`);
  }
  const { data: job, error } = await sb.from("publish_jobs").insert({
    workspace_id: ws, template_id: req.body?.template_id ? String(req.body.template_id) : null, content_id: req.body?.content_id ? String(req.body.content_id) : null,
    media_url: mediaUrl, media_mime: mime, caption, mode, status: "queued", created_by: req.auth!.userId,
  }).select("id").single();
  if (error || !job) return fail(res, 500, error?.message || "No se pudo crear la publicación");
  const { error: tErr } = await sb.from("publish_targets").insert(accounts!.map((a: any) => ({ job_id: job.id, account_id: a.id, provider: a.provider, account_name: a.display_name })));
  if (tErr) return fail(res, 500, tErr.message);
  const status = await runJob(sb, job.id);
  const { data: targets } = await sb.from("publish_targets").select("*").eq("job_id", job.id);
  res.status(202).json({ success: true, job_id: job.id, status, mode, live: mode === "live" && liveEnabled(), targets: targets || [] });
}));

publisherRoutes.get("/jobs", asyncRoute(async (req, res) => {
  const ws = wsParam(req);
  if (!(await allowed(req, ws, "viewer"))) return fail(res, 403, "Sin acceso a este espacio");
  const { data, error } = await db().from("publish_jobs").select("*, publish_targets(*)").eq("workspace_id", ws).order("created_at", { ascending: false }).limit(Math.min(Number(req.query.limit) || 20, 100));
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

publisherRoutes.post("/jobs/:id/retry", asyncRoute(async (req, res) => {
  const job = await jobFor(req, req.params.id, "editor");
  if (!job) return fail(res, 404, "Publicación no encontrada");
  const failed = (job.publish_targets || []).filter((t: any) => t.status === "failed" && t.attempts < MAX_ATTEMPTS).map((t: any) => t.id);
  const only = Array.isArray(req.body?.target_ids) && req.body.target_ids.length ? failed.filter((id: string) => req.body.target_ids.includes(id)) : failed;
  if (!only.length) return fail(res, 400, "No hay destinos para reintentar");
  const status = await runJob(db(), job.id, { only });
  const fresh = await jobFor(req, req.params.id, "viewer");
  res.json({ success: true, status, data: fresh });
}));

