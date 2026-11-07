// Integraciones de ads — Musa v2. Cada usuario conecta SUS cuentas (BYOK); nada usa llaves de la plataforma.
//   GET  /api/ads/accounts?workspaceId=                   cuentas conectadas del espacio
//   POST /api/ads/discover   { network }                  cuentas publicitarias que ve tu credencial (Meta, LinkedIn, Google)
//   POST /api/ads/accounts   { workspaceId, network, accountId, accountName?, brandId? }   conectar una cuenta al espacio
//   DELETE /api/ads/accounts/:id?workspaceId=
//   POST /api/ads/sync       { workspaceId, days? }       campañas + métricas (gasto, impresiones, clics, conversiones)
//   POST /api/ads/campaigns/:extId/status { workspaceId, action: pause|resume }
//   POST /api/ads/campaigns/create { workspaceId, accountRef, name, objective, dailyBudget? }   (Meta y TikTok, se crea PAUSADA)
// Credenciales (user_api_keys, JSON cifrado): meta-ads {accessToken} · tiktok-ads {accessToken}
//   linkedin-ads {accessToken} · google-ads {developerToken, clientId, clientSecret, refreshToken, loginCustomerId?}
import { getSupabaseAdmin } from "../../../api/src/services/supabase.js";
import { canAccessWorkspace } from "../../../api/src/services/tenancy.js";
import { getUserKey } from "./keys.mjs";
import { decodeHandlerBody, JSON_UTF8_CONTENT_TYPE } from "./http-encoding.mjs";

const cors = () => ({ "Content-Type": JSON_UTF8_CONTENT_TYPE, "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS" });
const out = (statusCode, data) => ({ statusCode, headers: cors(), body: JSON.stringify(data) });
const PROVIDER = { meta: "meta-ads", tiktok: "tiktok-ads", linkedin: "linkedin-ads", google: "google-ads" };
const NAME = { meta: "Meta Ads", tiktok: "TikTok Ads", linkedin: "LinkedIn Ads", google: "Google Ads" };
const ymd = (d) => d.toISOString().slice(0, 10);

async function creds(userId, network) {
  const { key } = await getUserKey(userId, PROVIDER[network]).catch(() => ({ key: null }));
  if (!key) throw new Error(`Primero vincula tu credencial de ${NAME[network]} en Configuración › Integraciones`);
  try { const c = JSON.parse(key); if (c && typeof c === "object") return c; } catch { /* token suelto */ }
  return { accessToken: key };
}
async function jfetch(url, init, label) {
  let r; try { r = await fetch(url, init); } catch { throw new Error(`${label}: no se pudo conectar`); }
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const m = j?.error?.message || j?.error?.error_user_msg || j?.message || j?.error_description || (Array.isArray(j) && j[0]?.error?.message) || `HTTP ${r.status}`;
    const e = new Error(`${label}: ${m}`); e.status = r.status; e.body = j; throw e;
  }
  return j;
}

/* ───────── Meta (Graph API) ───────── */
const META = (p) => `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ? process.env.META_GRAPH_VERSION + "/" : ""}${p}`;
const actId = (id) => (String(id).startsWith("act_") ? String(id) : "act_" + String(id).replace(/\D/g, ""));
const meta = {
  async discover(c) {
    const j = await jfetch(META(`me/adaccounts?fields=id,name,currency,account_status&limit=100&access_token=${encodeURIComponent(c.accessToken)}`), {}, "Meta");
    return (j.data || []).map((a) => ({ id: a.id, name: a.name, currency: a.currency, active: a.account_status === 1 }));
  },
  async sync(c, acc, from, to) {
    const tok = encodeURIComponent(c.accessToken), id = actId(acc.account_id);
    const [camps, ins] = await Promise.all([
      jfetch(META(`${id}/campaigns?fields=id,name,status,objective,daily_budget&limit=200&access_token=${tok}`), {}, "Meta"),
      jfetch(META(`${id}/insights?level=campaign&fields=campaign_id,spend,impressions,clicks,reach,actions&time_range=${encodeURIComponent(JSON.stringify({ since: from, until: to }))}&limit=500&access_token=${tok}`), {}, "Meta"),
    ]);
    const m = {}; (ins.data || []).forEach((r) => { m[r.campaign_id] = r; });
    const conv = (r) => (r?.actions || []).filter((a) => /purchase|lead|complete_registration|offsite_conversion/.test(a.action_type)).reduce((s, a) => s + Number(a.value || 0), 0);
    return (camps.data || []).map((x) => ({ external_id: x.id, name: x.name, status: x.status === "ACTIVE" ? "active" : x.status === "PAUSED" ? "paused" : String(x.status || "").toLowerCase(), objective: x.objective, daily_budget: x.daily_budget ? Number(x.daily_budget) / 100 : null, spend: Number(m[x.id]?.spend || 0), impressions: Number(m[x.id]?.impressions || 0), clicks: Number(m[x.id]?.clicks || 0), reach: Number(m[x.id]?.reach || 0), conversions: conv(m[x.id]) }));
  },
  async status(c, acc, ext, on) { await jfetch(META(`${ext}`), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `status=${on ? "ACTIVE" : "PAUSED"}&access_token=${encodeURIComponent(c.accessToken)}` }, "Meta"); },
  async create(c, acc, p) {
    const OBJ = { Ventas: "OUTCOME_SALES", Leads: "OUTCOME_LEADS", Tráfico: "OUTCOME_TRAFFIC", Reconocimiento: "OUTCOME_AWARENESS" };
    const body = new URLSearchParams({ name: p.name, objective: OBJ[p.objective] || "OUTCOME_TRAFFIC", status: "PAUSED", special_ad_categories: "[]", access_token: c.accessToken });
    if (p.dailyBudget) { body.set("daily_budget", String(Math.round(Number(p.dailyBudget) * 100))); body.set("bid_strategy", "LOWEST_COST_WITHOUT_CAP"); }
    const j = await jfetch(META(`${actId(acc.account_id)}/campaigns`), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() }, "Meta");
    return j.id;
  },
};

/* ───────── TikTok (Marketing API v1.3) ───────── */
const TT = "https://business-api.tiktok.com/open_api/v1.3/";
async function tt(c, path, init) {
  const j = await jfetch(TT + path, { ...(init || {}), headers: { "Access-Token": c.accessToken, "Content-Type": "application/json", ...((init || {}).headers || {}) } }, "TikTok");
  if (j && j.code !== 0) throw new Error(`TikTok: ${j.message || "error " + j.code}`);
  return j.data || {};
}
const tiktok = {
  async discover() { return null; /* TikTok no lista anunciantes con solo el token: se ingresa el Advertiser ID */ },
  async sync(c, acc, from, to) {
    const adv = acc.account_id;
    const [camps, rep] = await Promise.all([
      tt(c, `campaign/get/?advertiser_id=${adv}&page_size=200`),
      tt(c, `report/integrated/get/?advertiser_id=${adv}&report_type=BASIC&data_level=AUCTION_CAMPAIGN&dimensions=${encodeURIComponent('["campaign_id"]')}&metrics=${encodeURIComponent('["spend","impressions","clicks","conversion","reach"]')}&start_date=${from}&end_date=${to}&page_size=500`),
    ]);
    const m = {}; (rep.list || []).forEach((r) => { m[r.dimensions?.campaign_id] = r.metrics || {}; });
    return (camps.list || []).map((x) => ({ external_id: String(x.campaign_id), name: x.campaign_name, status: /ENABLE/.test(x.operation_status || x.secondary_status || "") ? "active" : "paused", objective: x.objective_type, daily_budget: x.budget_mode === "BUDGET_MODE_DAY" ? Number(x.budget) : null, spend: Number(m[x.campaign_id]?.spend || 0), impressions: Number(m[x.campaign_id]?.impressions || 0), clicks: Number(m[x.campaign_id]?.clicks || 0), reach: Number(m[x.campaign_id]?.reach || 0), conversions: Number(m[x.campaign_id]?.conversion || 0) }));
  },
  async status(c, acc, ext, on) { await tt(c, "campaign/status/update/", { method: "POST", body: JSON.stringify({ advertiser_id: acc.account_id, campaign_ids: [ext], operation_status: on ? "ENABLE" : "DISABLE" }) }); },
  async create(c, acc, p) {
    const OBJ = { Ventas: "WEB_CONVERSIONS", Leads: "LEAD_GENERATION", Tráfico: "TRAFFIC", Reconocimiento: "REACH" };
    const body = { advertiser_id: acc.account_id, campaign_name: p.name, objective_type: OBJ[p.objective] || "TRAFFIC", operation_status: "DISABLE", ...(p.dailyBudget ? { budget_mode: "BUDGET_MODE_DAY", budget: Number(p.dailyBudget) } : { budget_mode: "BUDGET_MODE_INFINITE" }) };
    const d = await tt(c, "campaign/create/", { method: "POST", body: JSON.stringify(body) });
    return String(d.campaign_id);
  },
};

/* ───────── LinkedIn (Marketing API, versionada YYYYMM) ───────── */
let liVersion = null;
async function li(c, path, init) {
  const now = new Date(), cands = liVersion ? [liVersion] : Array.from({ length: 10 }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`; });
  let last;
  for (const v of cands) {
    try {
      const j = await jfetch("https://api.linkedin.com/rest/" + path, { ...(init || {}), headers: { Authorization: `Bearer ${c.accessToken}`, "LinkedIn-Version": v, "X-Restli-Protocol-Version": "2.0.0", "Content-Type": "application/json", ...((init || {}).headers || {}) } }, "LinkedIn");
      liVersion = v; return j || {};
    } catch (e) { last = e; if (!(e.status === 426 || /version/i.test(e.message))) throw e; }
  }
  throw last;
}
const liId = (urn) => String(urn).split(":").pop();
const linkedin = {
  async discover(c) {
    const j = await li(c, "adAccountUsers?q=authenticatedUser&count=100");
    const ids = (j.elements || []).map((x) => liId(x.account));
    const out = [];
    for (const id of ids.slice(0, 20)) { const a = await li(c, `adAccounts/${id}`).catch(() => null); out.push({ id, name: a?.name || "Cuenta " + id, currency: a?.currency, active: a?.status === "ACTIVE" }); }
    return out;
  },
  async sync(c, acc, from, to) {
    const id = acc.account_id, [fy, fm, fd] = from.split("-").map(Number), [ty, tm, td] = to.split("-").map(Number);
    const camps = await li(c, `adAccounts/${id}/adCampaigns?q=search&count=200`);
    const an = await li(c, `adAnalytics?q=analytics&pivot=CAMPAIGN&timeGranularity=ALL&dateRange=(start:(year:${fy},month:${fm},day:${fd}),end:(year:${ty},month:${tm},day:${td}))&accounts=List(${encodeURIComponent("urn:li:sponsoredAccount:" + id)})&fields=impressions,clicks,costInLocalCurrency,externalWebsiteConversions,oneClickLeads,pivotValues`).catch(() => ({ elements: [] }));
    const m = {}; (an.elements || []).forEach((r) => { (r.pivotValues || []).forEach((pv) => { m[liId(pv)] = r; }); });
    return (camps.elements || []).map((x) => { const r = m[String(x.id)] || {}; return { external_id: String(x.id), name: x.name, status: x.status === "ACTIVE" ? "active" : String(x.status || "").toLowerCase(), objective: x.objectiveType, daily_budget: x.dailyBudget ? Number(x.dailyBudget.amount) : null, currency: x.dailyBudget?.currencyCode, spend: Number(r.costInLocalCurrency || 0), impressions: Number(r.impressions || 0), clicks: Number(r.clicks || 0), conversions: Number(r.externalWebsiteConversions || 0) + Number(r.oneClickLeads || 0) }; });
  },
  async status(c, acc, ext, on) { await li(c, `adAccounts/${acc.account_id}/adCampaigns/${ext}`, { method: "POST", headers: { "X-RestLi-Method": "PARTIAL_UPDATE" }, body: JSON.stringify({ patch: { $set: { status: on ? "ACTIVE" : "PAUSED" } } }) }); },
};

/* ───────── Google Ads (REST + OAuth refresh token) ───────── */
let gaVersion = null;
async function gaToken(c) {
  if (!c.developerToken || !c.clientId || !c.clientSecret || !c.refreshToken) throw new Error("Google Ads necesita developer token, client ID, client secret y refresh token");
  const j = await jfetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: c.refreshToken, grant_type: "refresh_token" }).toString() }, "Google");
  return j.access_token;
}
async function ga(c, tok, path, init) {
  const cands = gaVersion ? [gaVersion] : ["v24", "v23", "v22", "v21", "v20", "v19"];
  let last;
  for (const v of cands) {
    try { const j = await jfetch(`https://googleads.googleapis.com/${v}/${path}`, { ...(init || {}), headers: { Authorization: `Bearer ${tok}`, "developer-token": c.developerToken, ...(c.loginCustomerId ? { "login-customer-id": String(c.loginCustomerId).replace(/\D/g, "") } : {}), "Content-Type": "application/json" } }, "Google Ads"); gaVersion = v; return j; }
    catch (e) { last = e; if (!(e.status === 404 || /version|UNSUPPORTED|not found/i.test(e.message))) throw e; }
  }
  throw last;
}
const cid = (id) => String(id).replace(/\D/g, "");
const google = {
  async discover(c) {
    const tok = await gaToken(c), j = await ga(c, tok, "customers:listAccessibleCustomers");
    return (j.resourceNames || []).map((r) => ({ id: cid(r), name: "Cliente " + cid(r).replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3"), active: true }));
  },
  async sync(c, acc, from, to) {
    const tok = await gaToken(c);
    const q = `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}'`;
    const j = await ga(c, tok, `customers/${cid(acc.account_id)}/googleAds:search`, { method: "POST", body: JSON.stringify({ query: q }) });
    const m = {};
    (j.results || []).forEach((r) => { const k = r.campaign.id, x = m[k] || (m[k] = { external_id: String(k), name: r.campaign.name, status: r.campaign.status === "ENABLED" ? "active" : String(r.campaign.status || "").toLowerCase(), objective: r.campaign.advertisingChannelType, daily_budget: r.campaignBudget?.amountMicros ? Number(r.campaignBudget.amountMicros) / 1e6 : null, spend: 0, impressions: 0, clicks: 0, conversions: 0 }); x.spend += Number(r.metrics?.costMicros || 0) / 1e6; x.impressions += Number(r.metrics?.impressions || 0); x.clicks += Number(r.metrics?.clicks || 0); x.conversions += Number(r.metrics?.conversions || 0); });
    return Object.values(m);
  },
  async status(c, acc, ext, on) {
    const tok = await gaToken(c), cu = cid(acc.account_id);
    await ga(c, tok, `customers/${cu}/campaigns:mutate`, { method: "POST", body: JSON.stringify({ operations: [{ update: { resourceName: `customers/${cu}/campaigns/${ext}`, status: on ? "ENABLED" : "PAUSED" }, updateMask: "status" }] }) });
  },
};
const NET = { meta, tiktok, linkedin, google };

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors(), body: "" };
  const sb = getSupabaseAdmin(); if (!sb) return out(503, { error: "Base de datos no configurada" });
  const bearer = (event.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return out(401, { error: "Inicia sesión" });
  let userId; try { const { data, error } = await sb.auth.getUser(bearer); if (error || !data?.user) return out(401, { error: "Sesión inválida" }); userId = data.user.id; } catch { return out(401, { error: "Sesión inválida" }); }
  return adsCore(event, userId);
}

/** Núcleo del /api/ads con el usuario ya autenticado (también lo usa el MCP). */
export async function adsCore(event, userId) {
  const sb = getSupabaseAdmin(); if (!sb) return out(503, { error: "Base de datos no configurada" });
  const segs = (event.path || "").replace(/^\/+|\/+$/g, "").split("/"), sub = segs[2], id = segs[3], action = segs[4];
  let body = {}; if (event.httpMethod === "POST") { try { body = JSON.parse(decodeHandlerBody(event, "{}")); } catch { return out(400, { error: "JSON inválido" }); } }
  const ws = String(body.workspaceId || event.queryStringParameters?.workspaceId || "");
  const auth = { userId, isAdmin: false, authType: "user" };
  const need = async (role) => (!ws ? out(400, { error: "Falta workspaceId" }) : (await canAccessWorkspace(auth, ws, role)) ? null : out(403, { error: `Necesitas rol ${role} en este espacio` }));
  try {
    if (sub === "discover" && event.httpMethod === "POST") {
      const n = body.network; if (!NET[n]) return out(400, { error: "Red desconocida" });
      const list = await NET[n].discover(await creds(userId, n));
      return out(200, { accounts: list, manual: list === null });
    }
    if (sub === "accounts" && event.httpMethod === "GET") {
      const deny = await need("viewer"); if (deny) return deny;
      const { data } = await sb.from("workspace_ad_accounts").select("id,network,account_id,account_name,currency,brand_id,owner_user_id,last_synced_at,last_error").eq("workspace_id", ws).order("created_at");
      return out(200, { accounts: (data || []).map((a) => ({ ...a, isOwner: a.owner_user_id === userId })) });
    }
    if (sub === "accounts" && event.httpMethod === "POST") {
      const deny = await need("admin"); if (deny) return deny;
      const n = body.network, accId = String(body.accountId || "").trim(); if (!NET[n] || !accId) return out(400, { error: "Falta la red o el ID de la cuenta" });
      const c = await creds(userId, n);
      const today = ymd(new Date()), from = ymd(new Date(Date.now() - 7 * 864e5));
      await NET[n].sync(c, { account_id: accId }, from, today); // valida que la credencial ve esa cuenta
      const { data, error } = await sb.from("workspace_ad_accounts").upsert({ workspace_id: ws, network: n, account_id: accId, account_name: String(body.accountName || "").slice(0, 120) || null, currency: body.currency || null, brand_id: body.brandId || null, owner_user_id: userId, last_error: null }, { onConflict: "workspace_id,network,account_id" }).select("id").single();
      if (error) return out(500, { error: error.message });
      return out(200, { ok: true, id: data.id });
    }
    if (sub === "accounts" && id && event.httpMethod === "DELETE") {
      const deny = await need("admin"); if (deny) return deny;
      await sb.from("workspace_ad_accounts").delete().eq("id", id).eq("workspace_id", ws);
      return out(200, { ok: true });
    }
    if (sub === "sync" && event.httpMethod === "POST") {
      const deny = await need("editor"); if (deny) return deny;
      const days = Math.min(90, Math.max(1, Number(body.days) || 30)), to = ymd(new Date()), from = ymd(new Date(Date.now() - days * 864e5));
      const { data: accs } = await sb.from("workspace_ad_accounts").select("*").eq("workspace_id", ws);
      const res = [];
      for (const a of accs || []) {
        try {
          const rows = await NET[a.network].sync(await creds(a.owner_user_id, a.network), a, from, to);
          if (rows.length) await sb.from("ad_campaigns_ext").upsert(rows.map((r) => ({ workspace_id: ws, account_ref: a.id, network: a.network, currency: r.currency || a.currency, date_from: from, date_to: to, synced_at: new Date().toISOString(), brand_id: a.brand_id, ...r })), { onConflict: "account_ref,external_id" });
          await sb.from("workspace_ad_accounts").update({ last_synced_at: new Date().toISOString(), last_error: null }).eq("id", a.id);
          res.push({ network: a.network, account: a.account_name || a.account_id, campaigns: rows.length });
        } catch (e) {
          await sb.from("workspace_ad_accounts").update({ last_error: String(e.message).slice(0, 400) }).eq("id", a.id);
          res.push({ network: a.network, account: a.account_name || a.account_id, error: e.message });
        }
      }
      return out(200, { ok: true, results: res, from, to });
    }
    if (sub === "campaigns" && id && action === "status" && event.httpMethod === "POST") {
      const deny = await need("editor"); if (deny) return deny;
      const { data: x } = await sb.from("ad_campaigns_ext").select("id,external_id,network,account_ref").eq("id", id).eq("workspace_id", ws).maybeSingle();
      if (!x) return out(404, { error: "Campaña no encontrada" });
      const { data: a } = await sb.from("workspace_ad_accounts").select("*").eq("id", x.account_ref).single();
      const on = body.action === "resume";
      await NET[x.network].status(await creds(a.owner_user_id, x.network), a, x.external_id, on);
      await sb.from("ad_campaigns_ext").update({ status: on ? "active" : "paused" }).eq("id", x.id);
      return out(200, { ok: true, status: on ? "active" : "paused" });
    }
    if (sub === "campaigns" && id === "create" && event.httpMethod === "POST") {
      const deny = await need("editor"); if (deny) return deny;
      const { data: a } = await sb.from("workspace_ad_accounts").select("*").eq("id", body.accountRef).eq("workspace_id", ws).maybeSingle();
      if (!a) return out(404, { error: "Cuenta publicitaria no conectada" });
      if (!NET[a.network].create) return out(400, { error: `${NAME[a.network]}: crea la campaña en su administrador; Musa la trae al sincronizar y desde aquí la pausas o reactivas.` });
      const name = String(body.name || "").trim().slice(0, 200); if (!name) return out(400, { error: "Falta el nombre" });
      const ext = await NET[a.network].create(await creds(a.owner_user_id, a.network), a, { name, objective: body.objective, dailyBudget: body.dailyBudget });
      const { data: row } = await sb.from("ad_campaigns_ext").upsert({ workspace_id: ws, account_ref: a.id, network: a.network, external_id: ext, name, status: "paused", objective: body.objective, daily_budget: body.dailyBudget || null, currency: a.currency, campaign_id: body.campaignId || null, brand_id: body.brandId || a.brand_id }, { onConflict: "account_ref,external_id" }).select("id").single();
      return out(200, { ok: true, externalId: ext, id: row?.id });
    }
    return out(404, { error: "Ruta de ads no encontrada" });
  } catch (e) {
    return out(e.status && e.status < 500 ? 400 : 502, { error: e.message || "Error con la plataforma de ads" });
  }
}
