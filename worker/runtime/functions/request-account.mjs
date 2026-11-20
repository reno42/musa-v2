// REQ-073 — request_account: una IA puede crearle la cuenta a su humano.
// El agente pide el email a su usuario, llama el tool/endpoint, y devuelve un
// LINK de activación de un solo uso. El HUMANO abre el link y define su propio
// password en musaworks.com/activar. Reglas de seguridad:
//  - Un password JAMÁS viaja por un chat ni por este endpoint.
//  - Si el email ya tiene cuenta CONFIRMADA no se genera link (anti-abuso:
//    ningún agente puede disparar mails de login a cuentas existentes).
//  - Rate limit por IP (antispam) + cooldown por email.
//  - El usuario nace via el trigger existente (perfil + workspace personal).
import { getSupabaseAdmin } from "../../../api/src/services/supabase.js";
import { rateLimited, ipOf } from "./antispam.mjs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const EMAIL_COOLDOWN_MS = 10 * 60 * 1000; // 10 min por email
const recentEmails = new Map(); // email -> last ts (cache del isolate)
// Cupo GLOBAL del isolate (todas las IPs/emails): frena creación masiva de
// usuarios basura vía MCP incluso rotando emails. ~1.000 usuarios/día = 7/10min.
const RA_WINDOW_MS = 10 * 60 * 1000;
const RA_MAX_PER_WINDOW = 40;
let raWindowStart = 0;
let raWindowCount = 0;
function globalLimited(now) {
  if (now - raWindowStart > RA_WINDOW_MS) { raWindowStart = now; raWindowCount = 0; }
  raWindowCount += 1;
  return raWindowCount > RA_MAX_PER_WINDOW;
}

function maskEmail(email) {
  const [user, domain] = String(email).split("@");
  const visible = user.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(user.length - 2, 1))}@${domain}`;
}
function sweep(now) {
  for (const [k, t] of recentEmails) if (now - t > EMAIL_COOLDOWN_MS) recentEmails.delete(k);
}

/** Núcleo compartido: endpoint HTTP y tool MCP usan exactamente esto.
 * Devuelve { status, body } con JSON listo para responder. */
export async function requestAccountCore(rawEmail, origin, request) {
  const email = String(rawEmail || "").trim().toLowerCase();
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  };
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return { status: 400, body: { ok: false, error: "invalid_email", message: "Pide al humano una dirección de correo válida y repite la llamada." } };
  }
  if (request && rateLimited(request)) {
    return { status: 429, body: { ok: false, error: "rate_limited", message: "Demasiadas peticiones desde esta IP. Espera un minuto." } };
  }
  const now = Date.now();
  sweep(now);
  if (globalLimited(now)) {
    return { status: 429, body: { ok: false, error: "rate_limited", message: "Servicio saturado temporalmente. Espera unos minutos." } };
  }
  const last = recentEmails.get(email) || 0;
  if (now - last < EMAIL_COOLDOWN_MS) {
    return { status: 429, body: { ok: false, error: "email_cooldown", message: `Este correo ya tiene una activación reciente. El link anterior sigue servido — reúsalo o espera ${Math.ceil((EMAIL_COOLDOWN_MS - (now - last)) / 60000)} min.` } };
  }
  const sb = getSupabaseAdmin();
  if (!sb) return { status: 503, body: { ok: false, error: "no_db", message: "Servicio no configurado." } };

  // 1) Crear el usuario (sin password — lo define el humano en /activar).
  // Si ya existe, generateLink(signup) hace de sonda: con usuario CONFIRMADO
  // falla (→ "ya tienes cuenta", sin link); sin confirmar, devuelve link nuevo.
  // (getUserByEmail no existe en supabase-js 2.108 y el filtro ?email= del REST
  // admin es ignorado por este GoTrue — verificado 20-nov contra prod.)
  let actionLink = null;
  let existedUnconfirmed = false;
  const created = await sb.auth.admin.createUser({ email, email_confirm: false });
  if (created.error) {
    const msg = String(created.error.message || "");
    if (!/already|exists|duplicate|registered|422/i.test(msg) && created.status !== 422) {
      return { status: 502, body: { ok: false, error: "create_failed", message: "No se pudo crear la cuenta ahora. Reintenta en unos minutos." } };
    }
    // Ya existe: ¿confirmado o pendiente?
    const probe = await sb.auth.admin.generateLink({ type: "signup", email });
    const probeLink = probe?.data?.properties?.action_link || probe?.data?.action_link;
    if (!probeLink) {
      return { status: 200, body: { ok: true, created: false, emailMasked: maskEmail(email), message: `El correo ${maskEmail(email)} ya tiene una cuenta activa en Musa. La persona entra directo en ${origin} con su contraseña (o pide recuperación ahí). No se genera ningún link.` } };
    }
    actionLink = probeLink;
    existedUnconfirmed = true;
  } else {
    const link = await sb.auth.admin.generateLink({ type: "signup", email });
    actionLink = link?.data?.properties?.action_link || link?.data?.action_link;
  }
  recentEmails.set(email, Date.now());
  if (!actionLink) return { status: 502, body: { ok: false, error: "no_link", message: "No se pudo generar el link de activación. Reintenta." } };

  // 3) Canjear el link server-side (patrón del auto-login): el verify marca el
  // token como usado y devuelve la sesión en el fragment (#access_token=...).
  // Reescribimos el destino a /activar en NUESTRO origen — el fragment viaja intacto.
  let location = "";
  try {
    const redeem = await fetch(actionLink, { redirect: "manual", headers: { "User-Agent": "musa-v2-request-account" } });
    location = redeem.headers.get("location") || "";
  } catch { /* red transitoria: el link sin canjear también sirve (redirect de Supabase) */ }
  const i = location.indexOf("#");
  if (i === -1) {
    // Sin sesión en el fragment: entregamos el action_link crudo (pide definir
    // password tras entrar;flujo nativo).Nunca exponemos el email completo.
    return { status: 200, body: { ok: true, created: !existedUnconfirmed, emailMasked: maskEmail(email), activationUrl: actionLink, mode: "raw_link" } };
  }
  const fragment = location.slice(i);
  const activationUrl = `${origin}/activar${fragment}`;
  return {
    status: 200,
    body: {
      ok: true,
      created: !existedUnconfirmed,
      emailMasked: maskEmail(email),
      activationUrl,
      instructions: "Entrégale ESTE link a tu humano para que lo abra en su navegador. En la página define su propia contraseña (nunca la pidas en el chat ni la escribas tú). El link es de un solo uso y la sesión que lleva expira en ~1 hora; si se vence, llama request_account otra vez con el mismo correo y se genera uno nuevo.",
    },
  };
}

/** Handler HTTP: POST /api/request-account { email } */
export async function handler(event, ctx = {}) {
  const origin = (() => { try { return new URL(event.url).origin; } catch { return "https://musaworks.com"; } })();
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" }, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: "method" }) };
  }
  let email = "";
  try { email = (JSON.parse(event.body || "{}").email || ""); } catch { /* vacío */ }
  const out = await requestAccountCore(email, origin, { headers: new Headers(event.headers || {}) });
  console.log(`[request-account] ip=${ipOf({ headers: new Headers(event.headers || {}) })} emailMasked=${maskEmail(email)} status=${out.status}`);
  return { statusCode: out.status, headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" }, body: JSON.stringify(out.body) };
}

function corsHeaders() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Cache-Control": "no-store" };
}
