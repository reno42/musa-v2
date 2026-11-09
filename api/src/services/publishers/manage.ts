/**
 * Musa Publisher — operaciones de conexión y publicación, compartidas por las rutas /api/publisher/*
 * (la pantalla Configuración › Publicar) y por las herramientas MCP publisher_* (una IA conectando
 * redes sin que nadie use la pantalla). Mismo código, mismos permisos: editor del espacio para
 * cambiar, lector para mirar. Nada devuelve tokens ni secretos.
 */
import { getSupabaseAdmin } from "../supabase.js";
import { canAccessWorkspace } from "../tenancy.js";
import type { RequestAuth } from "../requestContext.js";
import { getProvider, providerCatalog, providersOfApp, appKeyOf, NOT_YET } from "./index.js";
import { seal, randomToken, pkceChallenge } from "./crypto.js";
import { appFor, liveEnabled, loadAccount, runJob, MAX_ATTEMPTS } from "./dispatch.js";
import type { AccountIdentity, Tokens } from "./types.js";

/** Cuentas por publicación. El envío va en tandas, así que una agencia puede usar muchas. */
export const MAX_TARGETS = 60;
export const STATE_TTL_MS = 10 * 60 * 1000;
export const LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const ACCOUNT_COLS = "id, workspace_id, brand_id, provider, kind, display_name, username, avatar_url, external_id, expires_at, options, status, last_error, checked_at, created_at";

export class PubError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
export function db() {
  const sb = getSupabaseAdmin();
  if (!sb) throw new PubError("Supabase no está configurado", 503);
  return sb;
}
async function need(auth: RequestAuth, workspaceId: string, min: "viewer" | "editor" = "editor") {
  if (!workspaceId || !auth || !(await canAccessWorkspace(auth, workspaceId, min))) throw new PubError("Sin acceso a este espacio", 403);
}
async function brandOk(ws: string, brandId: unknown) {
  if (brandId === null || brandId === undefined || brandId === "") return null;
  const { data } = await db().from("brands").select("id").eq("id", String(brandId)).eq("workspace_id", ws).maybeSingle();
  if (!data) throw new PubError("Esa marca no es de este espacio");
  return data.id as string;
}
async function accountRow(auth: RequestAuth, id: string, min: "viewer" | "editor" = "editor") {
  const { data } = await db().from("publisher_accounts").select("*").eq("id", id).maybeSingle();
  if (!data || !(await canAccessWorkspace(auth, data.workspace_id, min))) throw new PubError("Cuenta no encontrada", 404);
  return data;
}
function supabaseHost() {
  try { return new URL(process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL_DE_REPO_DESIGN || "").host; } catch { return ""; }
}
function isMusaFile(raw: string) {
  try { const u = new URL(raw); return u.protocol === "https:" && u.host === supabaseHost() && u.pathname.startsWith("/storage/v1/object/public/"); } catch { return false; }
}
export function redirectUriFor(base: string) {
  return `${base}/api/publisher/oauth/callback`;
}

/* ── catálogo ── */
export function catalog(base: string) {
  return { data: providerCatalog(), notYet: NOT_YET, redirectUri: redirectUriFor(base), live: liveEnabled(), maxTargets: MAX_TARGETS };
}

/* ── apps de developer (BYOK OAuth) ── */
export async function listApps(auth: RequestAuth, ws: string) {
  await need(auth, ws, "viewer");
  const { data } = await db().from("publisher_oauth_apps").select("provider, client_id, client_secret_encrypted, updated_at").eq("workspace_id", ws);
  return (data || []).map((a: any) => ({ app: a.provider, client_id: a.client_id, has_secret: !!a.client_secret_encrypted, updated_at: a.updated_at }));
}
export async function saveApp(auth: RequestAuth, ws: string, body: { app?: string; provider?: string; client_id?: string; client_secret?: string }) {
  await need(auth, ws);
  const key = String(body.app || body.provider || "");
  const p = getProvider(key);
  const appKey = p ? appKeyOf(p) : key;
  if (!providersOfApp(appKey).length) throw new PubError("App desconocida");
  const clientId = String(body.client_id || "").trim(), secret = String(body.client_secret || "").trim();
  if (clientId.length < 4) throw new PubError("Falta el Client ID");
  const sb = db();
  const { data: prev } = await sb.from("publisher_oauth_apps").select("client_secret_encrypted").eq("workspace_id", ws).eq("provider", appKey).maybeSingle();
  if (!secret && !prev?.client_secret_encrypted) throw new PubError("Falta el secreto de la app");
  const { error } = await sb.from("publisher_oauth_apps").upsert({
    workspace_id: ws, provider: appKey, client_id: clientId,
    client_secret_encrypted: secret ? await seal(secret) : prev?.client_secret_encrypted || null,
    created_by: auth.userId, updated_at: new Date().toISOString(),
  }, { onConflict: "workspace_id,provider" });
  if (error) throw new PubError(error.message, 500);
  return { app: appKey, networks: providersOfApp(appKey).map((x) => x.id) };
}
export async function deleteApp(auth: RequestAuth, ws: string, app: string) {
  await need(auth, ws);
  await db().from("publisher_oauth_apps").delete().eq("workspace_id", ws).eq("provider", app);
  return { app };
}

/* ── OAuth: enlace para abrir (10 min) o para mandar al cliente (7 días, un uso) ── */
export async function oauthUrl(auth: RequestAuth, ws: string, providerId: string, opts: { brandId?: unknown; link: boolean; base: string }) {
  await need(auth, ws);
  const provider = getProvider(providerId);
  if (!provider || provider.kind !== "oauth" || !provider.authUrl) throw new PubError("Red desconocida o sin OAuth");
  const brandId = await brandOk(ws, opts.brandId);
  const sb = db();
  const app = await appFor(sb, ws, provider.id);
  if (!app) throw new PubError(`Primero guarda el Client ID y el secreto de tu app de ${provider.appName || provider.name}`);
  const state = randomToken(24), verifier = randomToken(48), uri = redirectUriFor(opts.base);
  await sb.from("publisher_oauth_states").delete().lt("expires_at", new Date().toISOString());
  const expiresAt = new Date(Date.now() + (opts.link ? LINK_TTL_MS : STATE_TTL_MS)).toISOString();
  const { error } = await sb.from("publisher_oauth_states").insert({
    state, workspace_id: ws, user_id: auth.userId, provider: provider.id, code_verifier: verifier, redirect_uri: uri,
    brand_id: brandId, is_link: opts.link, expires_at: expiresAt,
  });
  if (error) throw new PubError(error.message, 500);
  const url = opts.link ? `${opts.base}/api/publisher/connect/${state}` : provider.authUrl({ app, redirectUri: uri, state, codeChallenge: await pkceChallenge(verifier) });
  return { url, redirectUri: uri, expiresAt };
}

/** Guarda (o actualiza) una cuenta conectada; la usan el token-BYOK y el regreso de OAuth. */
export async function saveIdentity(ws: string, providerId: string, kind: "oauth" | "token", who: AccountIdentity, tokens: Tokens, userId: string, brandId: string | null) {
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
  if (error) throw new PubError(error.message, 500);
  return data;
}

/* ── cuentas ── */
export async function connectToken(auth: RequestAuth, ws: string, providerId: string, rawInput: Record<string, unknown>, brandIdIn?: unknown) {
  await need(auth, ws);
  const provider = getProvider(String(providerId || ""));
  if (!provider) throw new PubError("Red desconocida");
  if (provider.kind !== "token" || !provider.tokensFromInput) throw new PubError(`${provider.name} se conecta con OAuth: guarda su app y abre el enlace de conexión`);
  const input: Record<string, string> = {};
  for (const f of provider.fields) input[f.key] = String(rawInput?.[f.key] ?? "").trim();
  const brandId = await brandOk(ws, brandIdIn);
  try {
    const tokens = provider.tokensFromInput(input);
    const who = await provider.identify({ tokens, input });
    return await saveIdentity(ws, provider.id, "token", who, tokens, auth.userId, brandId);
  } catch (e: any) {
    if (e instanceof PubError) throw e;
    throw new PubError(String(e?.message || e));
  }
}
export async function listAccounts(auth: RequestAuth, ws: string, brandId?: string) {
  await need(auth, ws, "viewer");
  let q = db().from("publisher_accounts").select(ACCOUNT_COLS).eq("workspace_id", ws).order("created_at");
  if (brandId) q = q.or(`brand_id.eq.${String(brandId).replace(/[^\w-]/g, "")},brand_id.is.null`);
  const { data, error } = await q;
  if (error) throw new PubError(error.message, 500);
  return data || [];
}
export async function updateAccount(auth: RequestAuth, id: string, body: { brand_id?: unknown; options?: { subreddit?: string; board_id?: string } }) {
  const row = await accountRow(auth, id);
  const patch: any = { updated_at: new Date().toISOString() };
  const options = { ...(row.options || {}) };
  if (body && "brand_id" in body) patch.brand_id = await brandOk(row.workspace_id, body.brand_id);
  const o = body?.options || {};
  if (row.provider === "reddit" && o.subreddit !== undefined) {
    const sr = String(o.subreddit || "").trim().replace(/^\/?r\//i, "");
    if (sr && !/^[A-Za-z0-9_]{2,25}$/.test(sr)) throw new PubError("Nombre de subreddit no válido");
    options.subreddit = sr || `u_${row.username}`;
  }
  if (row.provider === "pinterest" && o.board_id !== undefined) {
    if (!(options.boards || []).some((b: any) => b.id === String(o.board_id))) throw new PubError("Ese tablero no está en la cuenta (revisa la cuenta para actualizar la lista)");
    options.board_id = String(o.board_id);
  }
  patch.options = options;
  const { data, error } = await db().from("publisher_accounts").update(patch).eq("id", row.id).select(ACCOUNT_COLS).single();
  if (error) throw new PubError(error.message, 500);
  return data;
}
export async function checkAccount(auth: RequestAuth, id: string) {
  const row = await accountRow(auth, id);
  const sb = db(), provider = getProvider(row.provider)!;
  try {
    const acc = await loadAccount(sb, row, { forceRefresh: !!provider.refresh && !!row.refresh_token_encrypted });
    const who = await provider.identify({ tokens: acc.tokens, options: { ...(row.options || {}), external_id: row.external_id } });
    await sb.from("publisher_accounts").update({ display_name: who.displayName, avatar_url: who.avatarUrl || row.avatar_url, options: { ...(row.options || {}), ...(who.options || {}) }, status: "active", last_error: null, checked_at: new Date().toISOString() }).eq("id", row.id);
  } catch (e: any) {
    await sb.from("publisher_accounts").update({ status: e?.auth ? "expired" : "error", last_error: String(e?.message || e).slice(0, 500), checked_at: new Date().toISOString() }).eq("id", row.id);
  }
  const { data } = await sb.from("publisher_accounts").select(ACCOUNT_COLS).eq("id", row.id).single();
  return data;
}
export async function deleteAccount(auth: RequestAuth, id: string) {
  const row = await accountRow(auth, id);
  await db().from("publisher_accounts").delete().eq("id", row.id);
  return { id: row.id };
}

/* ── publicar ── */
export type PublishInput = {
  media_url?: string; media_small_url?: string | null; media_mime?: string; caption?: string; captions?: Record<string, string>;
  account_ids?: string[]; mode?: string; brand_id?: unknown; template_id?: string; content_id?: string;
};
export async function publish(auth: RequestAuth, ws: string, b: PublishInput) {
  await need(auth, ws);
  const mediaUrl = String(b.media_url || "").trim(), small = String(b.media_small_url || "").trim() || null;
  const mime = String(b.media_mime || "").trim().toLowerCase();
  const caption = String(b.caption ?? "");
  const captionsIn: Record<string, unknown> = b.captions && typeof b.captions === "object" ? b.captions : {};
  const mode = b.mode === "live" ? "live" : "dry-run";
  const ids: string[] = Array.isArray(b.account_ids) ? [...new Set(b.account_ids.map(String))] : [];
  if (!isMusaFile(mediaUrl) || (small && !isMusaFile(small))) throw new PubError("La imagen debe ser un archivo público de Musa (súbela primero)");
  if (!["image/png", "image/jpeg"].includes(mime)) throw new PubError("Por ahora solo se publican imágenes PNG o JPG (los videos llegan con los planes pagos)");
  if (!ids.length) throw new PubError("Elige al menos una cuenta");
  if (ids.length > MAX_TARGETS) throw new PubError(`Máximo ${MAX_TARGETS} cuentas por publicación`);
  const sb = db();
  const brandId = await brandOk(ws, b.brand_id);
  const { data: accounts } = await sb.from("publisher_accounts").select("id, provider, display_name, status").eq("workspace_id", ws).in("id", ids);
  if ((accounts || []).length !== ids.length) throw new PubError("Alguna cuenta no existe en este espacio");
  // Validar ANTES de crear la publicación: formato y largo del texto por red.
  const captions: Record<string, string> = {};
  for (const a of accounts!) {
    const p = getProvider(a.provider);
    if (!p) throw new PubError(`Red desconocida: ${a.provider}`);
    const text = typeof captionsIn[p.id] === "string" ? String(captionsIn[p.id]) : caption;
    if (typeof captionsIn[p.id] === "string") captions[p.id] = text;
    const useSmall = p.limits.maxBytes < 2 * 1048576 && small;
    if (!p.limits.formats.includes(useSmall ? "image/jpeg" : mime)) throw new PubError(`${p.name} solo acepta ${p.limits.formats.map((f) => f.replace("image/", "").toUpperCase()).join(" o ")}`);
    if (text.length > p.limits.maxChars) throw new PubError(`El texto para ${p.name} tiene ${text.length} caracteres y acepta hasta ${p.limits.maxChars}`);
  }
  const { data: job, error } = await sb.from("publish_jobs").insert({
    workspace_id: ws, brand_id: brandId, template_id: b.template_id ? String(b.template_id) : null, content_id: b.content_id ? String(b.content_id) : null,
    media_url: mediaUrl, media_small_url: small, media_mime: mime, caption, captions, mode, status: "queued", created_by: auth.userId,
  }).select("id").single();
  if (error || !job) throw new PubError(error?.message || "No se pudo crear la publicación", 500);
  const { error: tErr } = await sb.from("publish_targets").insert(accounts!.map((a: any) => ({ job_id: job.id, account_id: a.id, provider: a.provider, account_name: a.display_name })));
  if (tErr) throw new PubError(tErr.message, 500);
  const r = await runJob(sb, job.id);
  const { data: targets } = await sb.from("publish_targets").select("*").eq("job_id", job.id).order("created_at");
  return { job_id: job.id, status: r.status, remaining: r.remaining, mode, live: mode === "live" && liveEnabled(), targets: targets || [] };
}
export async function listJobs(auth: RequestAuth, ws: string, opts: { brandId?: string; limit?: number } = {}) {
  await need(auth, ws, "viewer");
  let q = db().from("publish_jobs").select("*, publish_targets(*)").eq("workspace_id", ws).order("created_at", { ascending: false }).limit(Math.min(Number(opts.limit) || 20, 100));
  if (opts.brandId) q = q.eq("brand_id", String(opts.brandId));
  const { data, error } = await q;
  if (error) throw new PubError(error.message, 500);
  return data || [];
}
export async function getJob(auth: RequestAuth, id: string, min: "viewer" | "editor" = "viewer") {
  const { data } = await db().from("publish_jobs").select("*, publish_targets(*)").eq("id", id).maybeSingle();
  if (!data || !(await canAccessWorkspace(auth, data.workspace_id, min))) throw new PubError("Publicación no encontrada", 404);
  return data;
}
/** Siguiente tanda (cuando hay muchas cuentas). */
export async function continueJob(auth: RequestAuth, id: string) {
  const job = await getJob(auth, id, "editor");
  const r = await runJob(db(), job.id);
  return { status: r.status, remaining: r.remaining, data: await getJob(auth, id) };
}
export async function retryJob(auth: RequestAuth, id: string, targetIds?: string[]) {
  const job = await getJob(auth, id, "editor");
  const failed = (job.publish_targets || []).filter((t: any) => t.status === "failed" && t.attempts < MAX_ATTEMPTS).map((t: any) => t.id);
  const only = Array.isArray(targetIds) && targetIds.length ? failed.filter((x: string) => targetIds.includes(x)) : failed;
  if (!only.length) throw new PubError("No hay destinos para reintentar");
  const r = await runJob(db(), job.id, { only, retry: true });
  return { status: r.status, remaining: r.remaining, data: await getJob(auth, id) };
}
