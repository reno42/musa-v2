// Cobros con Creem — Musa v2 (planes por valor).
//   GET  /api/billing/plans                       planes, personas extra y paquetes a la venta (sin códigos de oferta)
//   GET  /api/billing/me                          tus suscripciones, premios de referidos y si te conviene pasar a anual
//   POST /api/billing/checkout { planCode, units?, discountCode?, workspaceId? }  → { url }
//        · plan mensual + cuenta nueva → oferta de 3 meses (4 si llegó invitado), aplicada sola
//        · persona extra → units = cuántas personas; paquete → pago único de créditos
//   POST /api/billing/upgrade { planCode }        cambia tu plan activo (p. ej. a anual) con prorrateo
//   POST /api/billing/portal                      → { url }  (portal del cliente: facturas, tarjeta, cancelar)
//   POST /api/billing/webhook                     eventos de Creem (firma HMAC-SHA256 en «creem-signature»)
// Créditos: cada pago del plan recarga los créditos del mes (oferta: intro_credits; fundadores: x2 los 3 primeros pagos);
// los anuales se recargan solos cada mes (v2_credit_available). Personas extra IA y paquetes suman créditos que no vencen.
// Referidos: cuando el invitado paga su 2.º mes, quien invitó gana medio mes; con 2 medios se le devuelve
// su siguiente pago completo (Creem solo hace reembolsos totales). Anuales: el mes ganado llega como créditos.
// Secrets: CREEM_API_KEY, CREEM_WEBHOOK_SECRET y CREEM_MODE=test|live.
import { createHmac, timingSafeEqual } from "node:crypto";
import { getSupabaseAdmin } from "../../../api/src/services/supabase.js";
import { decodeHandlerBody, JSON_UTF8_CONTENT_TYPE } from "./http-encoding.mjs";

const cors = () => ({ "Content-Type": JSON_UTF8_CONTENT_TYPE, "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" });
const out = (statusCode, data) => ({ statusCode, headers: cors(), body: JSON.stringify(data) });
const live = () => String(process.env.CREEM_MODE || "test").toLowerCase() === "live";
const BASE = () => (live() ? "https://api.creem.io" : "https://test-api.creem.io");
const productOf = (p) => (live() ? p.creem_product_id : p.creem_product_id_test || p.creem_product_id);
const ACTIVE = ["active", "trialing", "past_due"];
const MAX_BANK = 24; // medios meses guardados como máximo (12 meses)

async function creem(path, body) {
  const key = process.env.CREEM_API_KEY;
  if (!key) throw new Error("Creem no está configurado (falta CREEM_API_KEY)");
  const r = await fetch(BASE() + path, { method: body ? "POST" : "GET", headers: { "x-api-key": key, "Content-Type": "application/json", Accept: "application/json", "User-Agent": "musa-v2/1.0" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`Creem ${r.status}: ${Array.isArray(j?.message) ? j.message.join(", ") : j?.message || j?.error || "error"}`);
  return j;
}

const STATUS = { active: "active", paid: "active", trialing: "trialing", past_due: "past_due", unpaid: "past_due", canceled: "canceled", cancelled: "canceled", expired: "expired", scheduled_cancel: "active", paused: "past_due" };

/** La IA de la plataforma queda marcada si hay un plan «IA de Musa» activo (los créditos son los que realmente mandan). */
async function applyEntitlements(sb, userId) {
  const { data: subs } = await sb.from("subscriptions").select("billing_plans(mode,kind)").eq("user_id", userId).in("status", ACTIVE);
  const ai = (subs || []).some((s) => s.billing_plans?.kind === "plan" && s.billing_plans?.mode === "musa_ia") ? "platform" : "byok";
  await sb.from("user_profiles").update({ ai_plan: ai, updated_at: new Date().toISOString() }).eq("id", userId);
}

async function grant(sb, userId, plan, pack, reason, meta, monthlyGrant) {
  await sb.rpc("v2_grant_credits", { p_user: userId, p_plan: plan, p_pack: pack, p_reason: reason, p_meta: meta || null });
  if (monthlyGrant != null) await sb.from("credit_accounts").update({ plan_grant: monthlyGrant, next_refill: new Date(Date.now() + 30 * 864e5).toISOString() }).eq("user_id", userId);
}

/** Créditos del mes según el pago n.º paidCount de la suscripción. */
function planCreditsFor(plan, row, paidCount) {
  let c = row.intro && plan.intro_credits != null && paidCount <= (plan.intro_months || 3) ? plan.intro_credits : plan.credits_month;
  if (row.founder && paidCount <= 3) c *= 2;
  return c;
}

/** Medio mes para quien invitó cuando su invitado paga el 2.º mes. */
async function earnReferral(sb, userId, subRowId) {
  const { data: p } = await sb.from("user_profiles").select("referred_by").eq("id", userId).maybeSingle();
  if (!p?.referred_by) return;
  const { count } = await sb.from("referral_rewards").select("id", { count: "exact", head: true }).eq("referrer_id", p.referred_by).eq("status", "earned");
  if ((count || 0) >= MAX_BANK) return;
  await sb.from("referral_rewards").insert({ referrer_id: p.referred_by, referred_id: userId, subscription_id: subRowId, reward: "half_month", status: "earned" });
}

/** Con 2 medios meses guardados: se devuelve este pago (mensual) o llega un mes de créditos (anual). */
async function redeemReferral(sb, userId, plan, txId) {
  const { data: rws } = await sb.from("referral_rewards").select("id").eq("referrer_id", userId).eq("status", "earned").order("created_at").limit(2);
  if ((rws || []).length < 2) return;
  const ids = rws.map((r) => r.id);
  if (plan.interval === "month" && txId) {
    await sb.from("referral_rewards").update({ status: "used", refund_tx: txId }).in("id", ids);
    try { await creem("/v1/refunds", { transaction_id: txId }); }
    catch (e) { await sb.from("referral_rewards").update({ status: "earned", refund_tx: null }).in("id", ids); console.error("[billing] reembolso de referido falló:", e?.message); }
  } else {
    await sb.from("referral_rewards").update({ status: "used" }).in("id", ids);
    await grant(sb, userId, null, plan.credits_month, "referidos", { months: 1 });
  }
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
  // un reembolso que hicimos nosotros por referidos no cancela nada
  if (type === "refund.created") {
    const tx = obj.transaction?.id || obj.transaction_id || (typeof obj.transaction === "string" ? obj.transaction : null);
    if (tx) { const { data: mine } = await sb.from("referral_rewards").select("id").eq("refund_tx", tx).limit(1); if (mine?.length) return out(200, { ok: true, referral_refund: true }); }
  }
  const meta = obj.metadata || obj.subscription?.metadata || {};
  const sub = obj.subscription && typeof obj.subscription === "object" ? obj.subscription : (type.startsWith("subscription.") ? obj : null);
  const custId = (typeof obj.customer === "object" ? obj.customer?.id : obj.customer) || (typeof sub?.customer === "object" ? sub.customer?.id : sub?.customer) || null;
  const subId = sub?.id || (typeof obj.subscription === "string" ? obj.subscription : null);
  const periodEnd = sub?.current_period_end_date || sub?.current_period_end || null;
  const cols = "id,user_id,plan_code,paid_count,last_transaction_id,intro,founder,units,status";
  let row = null;
  if (subId) row = (await sb.from("subscriptions").select(cols).eq("creem_subscription_id", subId).maybeSingle()).data;
  if (!row && (obj.request_id || meta.subscription_row)) row = (await sb.from("subscriptions").select(cols).eq("id", obj.request_id || meta.subscription_row).maybeSingle()).data;
  if (!row && meta.user_id && meta.plan_code) row = (await sb.from("subscriptions").insert({ user_id: meta.user_id, workspace_id: meta.workspace_id || null, plan_code: meta.plan_code, status: "pending" }).select(cols).single()).data;
  if (!row) return out(200, { ok: true, ignored: "sin suscripción asociada" });
  // si Creem cambió el producto (subida de plan), seguimos al producto
  const prodId = (typeof sub?.product === "object" ? sub.product?.id : sub?.product) || null;
  let plan = (await sb.from("billing_plans").select("*").eq("code", row.plan_code).maybeSingle()).data;
  if (prodId && plan && productOf(plan) !== prodId) {
    const np = (await sb.from("billing_plans").select("*").or(`creem_product_id.eq.${prodId},creem_product_id_test.eq.${prodId}`).maybeSingle()).data;
    if (np) { plan = np; row.plan_code = np.code; }
  }
  if (!plan) return out(200, { ok: true, ignored: "plan desconocido" });

  let status = null;
  if (type === "checkout.completed") status = plan.kind === "pack" ? "expired" : STATUS[sub?.status] || "active";
  else if (type.startsWith("subscription.")) status = STATUS[sub?.status] || STATUS[type.split(".")[1]] || null;
  else if (type === "refund.created") status = "refunded";
  const patch = { updated_at: new Date().toISOString(), raw: ev, plan_code: row.plan_code };
  if (status) patch.status = status;
  if (subId) patch.creem_subscription_id = subId;
  if (custId) patch.creem_customer_id = custId;
  if (type === "checkout.completed" && obj.id) patch.creem_checkout_id = obj.id;
  if (periodEnd) patch.current_period_end = periodEnd;
  if (sub?.canceled_at) patch.cancel_at = sub.canceled_at;
  if (sub?.items?.[0]?.units) patch.units = sub.items[0].units;

  // pagos: subscription.paid cuenta (sin repetir la misma transacción); el primer checkout ya recarga créditos
  const tx = obj.last_transaction_id || obj.last_transaction?.id || obj.order?.transaction || null;
  let paidNow = false;
  if (type === "subscription.paid" && (!tx || tx !== row.last_transaction_id)) { paidNow = true; patch.paid_count = (row.paid_count || 0) + 1; if (tx) patch.last_transaction_id = tx; }
  await sb.from("subscriptions").update(patch).eq("id", row.id);
  const n = patch.paid_count || row.paid_count || 0;
  const units = patch.units || row.units || 1;

  if (plan.kind === "pack" && type === "checkout.completed" && row.status !== "expired") {
    await grant(sb, row.user_id, null, plan.pack_credits || 0, "paquete", { plan: plan.code, sub: row.id });
  } else if (plan.kind === "seat" && plan.credits_month > 0 && paidNow) {
    await grant(sb, row.user_id, null, plan.credits_month * units, "persona extra", { plan: plan.code, units });
  } else if (plan.kind === "plan" && (paidNow || (type === "checkout.completed" && n === 0))) {
    const c = planCreditsFor(plan, row, Math.max(n, 1));
    await grant(sb, row.user_id, c, null, "plan", { plan: plan.code, payment: Math.max(n, 1) }, plan.interval === "year" ? plan.credits_month : null);
  }
  await applyEntitlements(sb, row.user_id);
  if (plan.kind === "plan" && paidNow) {
    if (n === 2) await earnReferral(sb, row.user_id, row.id);
    await redeemReferral(sb, row.user_id, plan, tx);
  }
  return out(200, { ok: true });
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors(), body: "" };
  const sb = getSupabaseAdmin(); if (!sb) return out(503, { error: "Base de datos no configurada" });
  const sub = (event.path || "").replace(/^\/+|\/+$/g, "").split("/")[2];
  if (sub === "webhook" && event.httpMethod === "POST") return webhook(event, sb);
  if (sub === "plans" && event.httpMethod === "GET") {
    const { data } = await sb.from("billing_plans").select("code,name,mode,segment,interval,price_usd,entitlements,kind,credits_month,intro_credits,seats,brands,emails_month,intro_price_usd,intro_months,annual_of,pack_credits,creem_product_id,creem_product_id_test,sort").eq("active", true).order("sort");
    const { data: cfg } = await sb.from("platform_config").select("value").eq("key", "billing").maybeSingle();
    return out(200, { mode: live() ? "live" : "test", configured: !!process.env.CREEM_API_KEY, founder_until: cfg?.value?.founder_until || null, plans: (data || []).map(({ creem_product_id, creem_product_id_test, ...p }) => ({ ...p, purchasable: !!(live() ? creem_product_id : creem_product_id_test || creem_product_id) })) });
  }
  const bearer = (event.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return out(401, { error: "Inicia sesión" });
  let user; try { const { data, error } = await sb.auth.getUser(bearer); if (error || !data?.user) return out(401, { error: "Sesión inválida" }); user = data.user; } catch { return out(401, { error: "Sesión inválida" }); }
  let body = {}; if (event.httpMethod === "POST") { try { body = JSON.parse(decodeHandlerBody(event, "{}")); } catch { return out(400, { error: "JSON inválido" }); } }
  const activePlan = async () => (await sb.from("subscriptions").select("id,plan_code,paid_count,creem_subscription_id,status,billing_plans!inner(kind,interval,mode,segment,annual_of)").eq("user_id", user.id).in("status", ACTIVE).eq("billing_plans.kind", "plan").order("created_at", { ascending: false }).limit(1).maybeSingle()).data;
  try {
    if (sub === "me" && event.httpMethod === "GET") {
      const [{ data: subs }, { data: rewards }, act] = await Promise.all([
        sb.from("subscriptions").select("id,plan_code,status,units,paid_count,intro,founder,current_period_end,cancel_at,workspace_id,billing_plans(name,mode,segment,kind,interval,price_usd,intro_price_usd,intro_months)").eq("user_id", user.id).neq("status", "pending").order("created_at", { ascending: false }).limit(20),
        sb.from("referral_rewards").select("reward,status,created_at").eq("referrer_id", user.id),
        activePlan(),
      ]);
      let annual = null;
      if (act && act.billing_plans.interval === "month" && (act.paid_count || 0) >= 2) annual = (await sb.from("billing_plans").select("code,price_usd").eq("annual_of", act.plan_code).eq("active", true).maybeSingle()).data;
      const rw = rewards || [];
      return out(200, { subscriptions: subs || [], rewards: rw, referral: { half_months: rw.filter((r) => r.status === "earned" && r.reward === "half_month").length, months_used: rw.filter((r) => r.status === "used" && r.reward === "half_month").length / 2 }, annual_offer: annual });
    }
    if (sub === "checkout" && event.httpMethod === "POST") {
      const { data: plan } = await sb.from("billing_plans").select("*").eq("code", String(body.planCode || "")).eq("active", true).maybeSingle();
      if (!plan) return out(404, { error: "Plan no encontrado" });
      const product = productOf(plan); if (!product) return out(400, { error: "Ese plan todavía no está a la venta" });
      const act = await activePlan();
      if (plan.kind === "plan" && act) return out(409, { error: "Ya tienes un plan activo. Cámbialo desde «Cambiar a este plan»." });
      let units = 1;
      if (plan.kind === "seat") {
        if (!act || !["agencia", "empresa"].includes(act.billing_plans.segment)) return out(400, { error: "Las personas extra son para los planes Agencia y Empresa" });
        if ((act.billing_plans.mode === "musa_ia") !== (plan.mode === "musa_ia") || act.billing_plans.interval !== plan.interval) return out(400, { error: "Elige la persona extra que corresponde a tu plan" });
        units = Math.min(50, Math.max(1, parseInt(body.units, 10) || 1));
      }
      const { data: prof } = await sb.from("user_profiles").select("referral_code,referred_by").eq("id", user.id).maybeSingle();
      // el campo de código acepta el código de referido de otra persona (RENZO420) o un descuento de Creem
      let discount = String(body.discountCode || "").trim().toUpperCase().replace(/\s/g, "").slice(0, 60);
      if (discount) {
        const { data: owner } = await sb.from("user_profiles").select("id").eq("referral_code", discount).maybeSingle();
        if (owner) {
          if (owner.id === user.id) return out(400, { error: "No puedes usar tu propio código de referido" });
          if (!prof?.referred_by) { await sb.from("user_profiles").update({ referred_by: owner.id, referred_at: new Date().toISOString() }).eq("id", user.id); if (prof) prof.referred_by = owner.id; }
          discount = "";
        } else {
          const { data: internal } = await sb.from("billing_discounts").select("code").eq("code", discount).maybeSingle();
          if (internal) discount = ""; // las ofertas se aplican solas, no se escriben
        }
      }
      // oferta de los primeros meses: solo cuentas que nunca pagaron un plan
      let intro = false;
      if (plan.kind === "plan" && !discount) {
        const { count } = await sb.from("subscriptions").select("id", { count: "exact", head: true }).eq("user_id", user.id).gt("paid_count", 0);
        if (!count) {
          const { data: d } = await sb.from("billing_discounts").select("code").eq("plan_code", plan.code).eq("kind", prof?.referred_by ? "ref" : "intro").maybeSingle();
          if (d) { discount = d.code; intro = true; }
        }
      }
      const { data: cfg } = await sb.from("platform_config").select("value").eq("key", "billing").maybeSingle();
      const founder = plan.kind === "plan" && !!cfg?.value?.founder_until && Date.now() < Date.parse(cfg.value.founder_until + "T23:59:59Z");
      const { data: row } = await sb.from("subscriptions").insert({ user_id: user.id, workspace_id: body.workspaceId || null, plan_code: plan.code, status: "pending", units, intro, founder }).select("id").single();
      const origin = String(process.env.URL || "").replace(/\/$/, "") || `https://${event.headers?.host}`;
      const c = await creem("/v1/checkouts", { product_id: product, request_id: row.id, units: plan.kind === "seat" ? units : undefined, success_url: `${origin}/?checkout=ok`, customer: { email: user.email }, ...(discount ? { discount_code: discount } : {}), metadata: { user_id: user.id, workspace_id: body.workspaceId || null, plan_code: plan.code, subscription_row: row.id, referred_by: prof?.referred_by || null } });
      return out(200, { url: c.checkout_url || c.url, intro });
    }
    if (sub === "upgrade" && event.httpMethod === "POST") {
      const act = await activePlan();
      if (!act?.creem_subscription_id) return out(404, { error: "No tienes un plan activo para cambiar" });
      const { data: plan } = await sb.from("billing_plans").select("*").eq("code", String(body.planCode || "")).eq("active", true).eq("kind", "plan").maybeSingle();
      if (!plan || plan.code === act.plan_code) return out(400, { error: "Elige otro plan" });
      await creem(`/v1/subscriptions/${act.creem_subscription_id}/upgrade`, { product_id: productOf(plan), update_behavior: "proration-charge-immediately" });
      await sb.from("subscriptions").update({ plan_code: plan.code, intro: false, updated_at: new Date().toISOString() }).eq("id", act.id);
      await sb.rpc("v2_grant_credits", { p_user: user.id, p_plan: plan.credits_month, p_pack: null, p_reason: "cambio de plan", p_meta: { plan: plan.code } });
      await sb.from("credit_accounts").update({ plan_grant: plan.interval === "year" ? plan.credits_month : 0, next_refill: plan.interval === "year" ? new Date(Date.now() + 30 * 864e5).toISOString() : null }).eq("user_id", user.id);
      await applyEntitlements(sb, user.id);
      return out(200, { ok: true, plan: plan.code });
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
