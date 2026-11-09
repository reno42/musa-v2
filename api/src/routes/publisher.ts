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
import { asyncRoute } from "../middleware/asyncRoute.js";
import { getProvider } from "../services/publishers/index.js";
import { pkceChallenge } from "../services/publishers/crypto.js";
import { appFor } from "../services/publishers/dispatch.js";
import * as M from "../services/publishers/manage.js";

export const publisherRoutes = Router();
export const publisherCallbackRoutes = Router();

const STATE_TTL_MS = M.STATE_TTL_MS;
const db = M.db;
const saveIdentity = M.saveIdentity;

function fail(res: Response, status: number, error: string) {
  return res.status(status).json({ success: false, error });
}
function baseUrl(req: Request) {
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "localhost");
  const proto = /^(localhost|127\.)/.test(host) ? "http" : "https";
  return `${proto}://${host}`;
}
function wsParam(req: Request) {
  return String((req.method === "GET" || req.method === "DELETE" ? req.query.workspaceId : req.body?.workspaceId) || "");
}
const err = (res: Response, e: any) => fail(res, e?.status || 400, String(e?.message || e));
/** Envuelve una operación de manage.ts: { success: true, ...extra } o el error con su código. */
function wrap(fn: (req: Request) => Promise<any>, shape: (r: any) => any = (r) => ({ data: r }), status = 200) {
  return asyncRoute(async (req: Request, res: Response) => {
    try { res.status(status).json({ success: true, ...shape(await fn(req)) }); } catch (e) { err(res, e); }
  });
}

/* ── catálogo ── */
publisherRoutes.get("/providers", (req, res) => { res.json({ success: true, ...M.catalog(baseUrl(req)) }); });

/* ── apps de developer (BYOK OAuth), por «app» (meta = Facebook + Instagram, google = Business + Blogger…) ── */
publisherRoutes.get("/apps", wrap((req) => M.listApps(req.auth!, wsParam(req))));
publisherRoutes.post("/apps", wrap((req) => M.saveApp(req.auth!, wsParam(req), req.body || {}), () => ({})));
publisherRoutes.delete("/apps/:app", wrap((req) => M.deleteApp(req.auth!, wsParam(req), req.params.app), () => ({})));

/* ── OAuth ── */
publisherRoutes.post("/oauth/:provider/start", wrap((req) => M.oauthUrl(req.auth!, wsParam(req), req.params.provider, { brandId: req.body?.brandId, link: false, base: baseUrl(req) }), (r) => ({ url: r.url, redirectUri: r.redirectUri })));
publisherRoutes.post("/oauth/:provider/link", wrap((req) => M.oauthUrl(req.auth!, wsParam(req), req.params.provider, { brandId: req.body?.brandId, link: true, base: baseUrl(req) }), (r) => ({ url: r.url, expiresAt: r.expiresAt })));

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
publisherRoutes.post("/accounts/token", wrap((req) => M.connectToken(req.auth!, wsParam(req), String(req.body?.provider || ""), req.body?.input || {}, req.body?.brandId)));
publisherRoutes.get("/accounts", wrap((req) => M.listAccounts(req.auth!, wsParam(req), req.query.brandId ? String(req.query.brandId) : undefined)));
publisherRoutes.patch("/accounts/:id", wrap((req) => M.updateAccount(req.auth!, req.params.id, req.body || {})));
publisherRoutes.post("/accounts/:id/check", wrap((req) => M.checkAccount(req.auth!, req.params.id)));
publisherRoutes.delete("/accounts/:id", wrap((req) => M.deleteAccount(req.auth!, req.params.id), () => ({})));

/* ── publicar ── */
publisherRoutes.post("/publish", wrap((req) => M.publish(req.auth!, wsParam(req), req.body || {}), (r) => r, 202));
publisherRoutes.get("/jobs", wrap((req) => M.listJobs(req.auth!, wsParam(req), { brandId: req.query.brandId ? String(req.query.brandId) : undefined, limit: Number(req.query.limit) || undefined })));
publisherRoutes.get("/jobs/:id", wrap((req) => M.getJob(req.auth!, req.params.id)));
publisherRoutes.post("/jobs/:id/run", wrap((req) => M.continueJob(req.auth!, req.params.id), (r) => r));
publisherRoutes.post("/jobs/:id/retry", wrap((req) => M.retryJob(req.auth!, req.params.id, req.body?.target_ids), (r) => r));
