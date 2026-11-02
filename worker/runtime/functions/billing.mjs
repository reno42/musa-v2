// Cobros con Creem — Musa v2.
//   GET  /api/billing/plans                       planes a la venta (billing_plans activos con producto en Creem)
//   GET  /api/billing/me                          tu suscripción y tus premios de referidos
//   POST /api/billing/checkout { planCode, workspaceId?, discountCode? }  → { url }  (página de pago de Creem)
//   POST /api/billing/portal                      → { url }  (portal del cliente: facturas, tarjeta, cancelar)
//   POST /api/billing/webhook                     eventos de Creem (firma HMAC-SHA256 en «creem-signature»)
// Secrets: CREEM_API_KEY, CREEM_WEBHOOK_SECRET y CREEM_MODE=test|live (test usa test-api.creem.io y creem_product_id_test).
import { createHmac, timingSafeEqual } from "node:crypto";
import { getSupabaseAdmin } from "../../../api/src/services/supabase.js";
import { decodeHandlerBody, JSON_UTF8_CONTENT_TYPE } from "./http-encoding.mjs";

const cors = () => ({ "Content-Type": JSON_UTF8_CONTENT_TYPE, "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" });
const out = (statusCode, data) => ({ statusCode, headers: cors(), body: JSON.stringify(data) });
const live = () => String(process.env.CREEM_MODE || "test").toLowerCase() === "live";
const BASE = () => (live() ? "https://api.creem.io" : "https://test-api.creem.io");
const productOf = (p) => (live() ? p.creem_product_id : p.creem_product_id_test || p.creem_product_id);

async function creem(path, body) {
  const key = process.env.CREEM_API_KEY;
  if (!key) throw new Error("Creem no está configurado (falta CREEM_API_KEY)");
  const r = await fetch(BASE() + path, { method: body ? "POST" : "GET", headers: { "x-api-key": key, "Content-Type": "application/json", Accept: "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`Creem ${r.status}: ${j?.message || j?.error || "error"}`);
  return j;
}

const STATUS = { active: "active", paid: "active", trialing: "trialing", past_due: "past_due", unpaid: "past_due", canceled: "canceled", cancelled: "canceled", expired: "expired", scheduled_cancel: "active" };

/** Aplica lo que da el plan: IA de la plataforma si es «Musa IA» y acceso corporativo si es Corp. */
async function applyEntitlements(sb, userId) {
  const { data: subs } = await sb.from("subscriptions").select("plan_code,status,billing_plans(mode,segment)").eq("user_id", userId).in("status", ["active", "trialing", "past_due"]);
  const act = subs || [];
  const ai = act.some((s) => s.billing_plans?.mode === "musa_ia") ? "platform" : "byok";
  const patch = { ai_plan: ai, updated_at: new Date().toISOString() };
  if (act.some((s) => s.billing_plans?.segment === "corp")) patch.access_plan = "corporate";
  await sb.from("user_profiles").update(patch).eq("id", userId);
}

/** Premio al que invitó: la primera vez que su invitado paga. */
async function rewardReferrer(sb, userId, subId) {
  const { data: p } = await sb.from("user_profiles").select("referred_by").eq("id", userId).maybeSingle();
  if (!p?.referred_by) return;
  const { data: ex } = await sb.from("referral_rewards").select("id").eq("referred_id", userId).maybeSingle();
  if (ex) return;
  await sb.from("referral_rewards").insert({ referrer_id: p.referred_by, referred_id: userId, subscription_id: subId, reward: "1_month", status: "earned" });
}

async function webhook(event, sb) {
  const secret = process.env.CREEM_WEBHOOK_SECRET;
  if (!secret) return out(503, { error: "webhook sin configurar" });
  const raw = decodeHandlerBody(event, "");
  const sig = String(event.headers?.["creem-signature"] || event.headers?.["Creem-Signature"] || "");
  const calc = createHmac("sha256", secret).update(raw).digest("hex");
  if (!sig || sig.length !== calc.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(calc))) return out(401, { error: "firma inválida" });
  let ev; try { ev = JSON.parse(raw); } catch { return out(400, { error: "JSON inválido" }); }
  const type = ev.eventType || ev.type || "", obj = ev.object || ev.data || {};
  if (ev.id) {
    const { error } = await sb.from("billing_events").insert({ id: String(ev.id), type, payload: ev });
    if (error && /duplicate|unique/i.test(error.message)) return out(200, { ok: true, duplicate: true });
  }
  const meta = obj.metadata || obj.subscription?.metadata || {};
  const sub = obj.subscription && typeof obj.subscription === "object" ? obj.subscription : (type.startsWith("subscription.") ? obj : null);
  const custId = (typeof obj.customer === "object" ? obj.customer?.id : obj.customer) || (typeof sub?.customer === "object" ? sub.customer?.id : sub?.customer) || null;
  const subId = sub?.id || (typeof obj.subscription === "string" ? obj.subscription : null);
  const periodEnd = sub?.current_period_end_date || sub?.current_period_end || null;
  // la fila se encuentra por la suscripción de Creem, o por el request_id que mandamos al crear el checkout
  let row = null;
  if (subId) row = (await sb.from("subscriptions").select("id,user_id").eq("creem_subscription_id", subId).maybeSingle()).data;
  if (!row && (obj.request_id || meta.subscription_row)) row = (await sb.from("subscriptions").select("id,user_id").eq("id", obj.request_id || meta.subscription_row).maybeSingle()).data;
  if (!row && meta.user_id && meta.plan_code) {
    const ins = await sb.from("subscriptions").insert({ user_id: meta.user_id, workspace_id: meta.workspace_id || null, plan_code: meta.plan_code, status: "pending" }).select("id,user_id").single();
    row = ins.data;
  }
  if (!row) return out(200, { ok: true, ignored: "sin suscripción asociada" });
  let status = null;
  if (type === "checkout.completed") status = STATUS[sub?.status] || "active";
  else if (type.startsWith("subscription.")) status = STATUS[sub?.status] || STATUS[type.split(".")[1]] || null;
  else if (type === "refund.created") status = "refunded";
  const patch = { updated_at: new Date().toISOString(), raw: ev };
  if (status) patch.status = status;
  if (subId) patch.creem_subscription_id = subId;
  if (custId) patch.creem_customer_id = custId;
  if (type === "checkout.completed" && obj.id) patch.creem_checkout_id = obj.id;
  if (periodEnd) patch.current_period_end = periodEnd;
  if (sub?.canceled_at) patch.cancel_at = sub.canceled_at;
  await sb.from("subscriptions").update(patch).eq("id", row.id);
  await applyEntitlements(sb, row.user_id);
  if (status === "active" && (type === "checkout.completed" || type === "subscription.paid")) await rewardReferrer(sb, row.user_id, row.id);
  return out(200, { ok: true });
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors(), body: "" };
  const sb = getSupabaseAdmin(); if (!sb) return out(503, { error: "Base de datos no configurada" });
  const sub = (event.path || "").replace(/^\/+|\/+$/g, "").split("/")[2];
  if (sub === "webhook" && event.httpMethod === "POST") return webhook(event, sb);
  if (sub === "plans" && event.httpMethod === "GET") {
    const { data } = await sb.from("billing_plans").select("code,name,mode,segment,interval,price_usd,entitlements,creem_product_id,creem_product_id_test,sort").eq("active", true).order("sort");
    return out(200, { mode: live() ? "live" : "test", configured: !!process.env.CREEM_API_KEY, plans: (data || []).map(({ creem_product_id, creem_product_id_test, ...p }) => ({ ...p, purchasable: !!(live() ? creem_product_id : creem_product_id_test || creem_product_id) })) });
  }
  const bearer = (event.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return out(401, { error: "Inicia sesión" });
  let user; try { const { data, error } = await sb.auth.getUser(bearer); if (error || !data?.user) return out(401, { error: "Sesión inválida" }); user = data.user; } catch { return out(401, { error: "Sesión inválida" }); }
  let body = {}; if (event.httpMethod === "POST") { try { body = JSON.parse(decodeHandlerBody(event, "{}")); } catch { return out(400, { error: "JSON inválido" }); } }
  try {
    if (sub === "me" && event.httpMethod === "GET") {
      const [{ data: subs }, { data: rewards }] = await Promise.all([
        sb.from("subscriptions").select("id,plan_code,status,current_period_end,cancel_at,workspace_id,billing_plans(name,mode,segment)").eq("user_id", user.id).order("created_at", { ascending: false }).limit(10),
        sb.from("referral_rewards").select("reward,status,discount_code,created_at").eq("referrer_id", user.id),
      ]);
      return out(200, { subscriptions: subs || [], rewards: rewards || [] });
    }
    if (sub === "checkout" && event.httpMethod === "POST") {
      const { data: plan } = await sb.from("billing_plans").select("*").eq("code", String(body.planCode || "")).eq("active", true).maybeSingle();
      if (!plan) return out(404, { error: "Plan no encontrado" });
      const product = productOf(plan); if (!product) return out(400, { error: "Ese plan todavía no está a la venta" });
      const { data: prof } = await sb.from("user_profiles").select("referral_code,referred_by").eq("id", user.id).maybeSingle();
      const { data: row } = await sb.from("subscriptions").insert({ user_id: user.id, workspace_id: body.workspaceId || null, plan_code: plan.code, status: "pending" }).select("id").single();
      const origin = String(process.env.URL || "").replace(/\/$/, "") || `https://${event.headers?.host}`;
      const c = await creem("/v1/checkouts", { product_id: product, request_id: row.id, success_url: `${origin}/?checkout=ok`, customer: { email: user.email }, ...(body.discountCode ? { discount_code: String(body.discountCode).slice(0, 60) } : {}), metadata: { user_id: user.id, workspace_id: body.workspaceId || null, plan_code: plan.code, subscription_row: row.id, referred_by: prof?.referred_by || null } });
      return out(200, { url: c.checkout_url || c.url });
    }
    if (sub === "portal" && event.httpMethod === "POST") {
      const { data: s } = await sb.from("subscriptions").select("creem_customer_id").eq("user_id", user.id).not("creem_customer_id", "is", null).order("updated_at", { ascending: false }).limit(1).maybeSingle();
      if (!s) return out(404, { error: "Todavía no tienes una suscripción pagada" });
      const p = await creem("/v1/customers/billing", { customer_id: s.creem_customer_id });
      return out(200, { url: p.customer_portal_link || p.url });
    }
    return out(404, { error: "Ruta de cobros no encontrada" });
  } catch (e) {
    return out(502, { error: e.message || "Error con Creem" });
  }
}
