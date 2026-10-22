// ═══════════════════════════════════════════════════════════════
// REQ-012 — OAuth 2.1 authorization endpoint (code flow + PKCE
// S256, RFC6749 + RFC7636). Serves three browser pages in one
// function: login → consent → 302 back to the client with a
// single-use code.
//
// Token strategy (no custom crypto, no JWT signing): the login does
// a server-side password grant against Supabase Auth (GoTrue) and
// the resulting USER session tokens ARE the OAuth tokens. mcp.mjs
// already validates Supabase JWTs as Bearer in checkAuth, so the
// resource server needs zero changes to accept them. Each connector
// gets its own GoTrue session — independent from the SPA login.
//
// Between login and consent the tokens live in an UNAPPROVED
// oauth_codes row addressed by a random handle (never in HTML);
// approval swaps the row's hash to the real code and the client only
// ever sees that code. Rows expire in 5 minutes and are single-use.
//
// The NDA gate (v30) is enforced here: no code is issued for an
// account that has not accepted the Acuerdo de Acceso Alfa on the
// web app.
// ═══════════════════════════════════════════════════════════════
import { createHash, randomBytes } from "node:crypto";
import { getSupabaseAdmin } from "../../../api/src/services/supabase.js";

const SITE_URL = (process.env.URL || "https://design.futuraria.com").replace(/\/$/, "");
const CODE_TTL_MS = 5 * 60 * 1000;
const PKCE_RE = /^[A-Za-z0-9\-._~]{43,128}$/;

function sha256hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function randomToken() {
  return randomBytes(32).toString("base64url");
}

function supabaseRestConfig() {
  const url = process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL_DE_REPO_DESIGN || "";
  const apiKey =
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEYS?.split(",")[0] ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    "";
  return { url: url.replace(/\/$/, ""), apiKey };
}

// GoTrue password grant. Returns { access_token, refresh_token,
// expires_in, user } or null on bad credentials/unavailable.
async function gotruePasswordGrant(email, password) {
  const { url, apiKey } = supabaseRestConfig();
  if (!url || !apiKey) return null;
  try {
    const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json?.access_token || !json?.refresh_token || !json?.user?.id) return null;
    return json;
  } catch {
    return null;
  }
}

// ── HTML (neutral Spanish, self-contained, no external assets) ──

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

const PAGE_CSS = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         background: #0b0d10; color: #e7e9ee; min-height: 100vh; display: flex;
         align-items: center; justify-content: center; padding: 24px; }
  .card { width: 100%; max-width: 400px; background: #12151b; border: 1px solid rgba(255,255,255,0.08);
          border-radius: 14px; padding: 32px 28px; }
  .brand { font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase;
           color: rgba(231,233,238,0.5); margin-bottom: 20px; }
  h1 { font-size: 19px; font-weight: 600; margin-bottom: 8px; }
  p.sub { font-size: 14px; color: rgba(231,233,238,0.65); line-height: 1.5; margin-bottom: 22px; }
  label { display: block; font-size: 13px; color: rgba(231,233,238,0.7); margin: 14px 0 6px; }
  input { width: 100%; padding: 11px 12px; background: #0b0d10; color: #e7e9ee;
          border: 1px solid rgba(255,255,255,0.12); border-radius: 9px; font-size: 15px; }
  input:focus { outline: none; border-color: #7aa2f7; }
  button { width: 100%; margin-top: 22px; padding: 12px; border: none; border-radius: 9px;
           font-size: 15px; font-weight: 600; cursor: pointer; }
  button.primary { background: #7aa2f7; color: #0b0d10; }
  button.ghost { background: transparent; color: rgba(231,233,238,0.7);
                 border: 1px solid rgba(255,255,255,0.14); margin-top: 10px; }
  .error { background: rgba(230,80,80,0.12); border: 1px solid rgba(230,80,80,0.35);
           color: #f0a0a0; border-radius: 9px; padding: 10px 12px; font-size: 13px; margin-bottom: 6px; }
  ul.scopes { list-style: none; margin: 16px 0 4px; }
  ul.scopes li { padding: 10px 12px; border: 1px solid rgba(255,255,255,0.08);
                 border-radius: 9px; font-size: 14px; margin-bottom: 8px; }
  ul.scopes li span.mono { font-family: ui-monospace, monospace; font-size: 12px;
                           color: rgba(231,233,238,0.45); display: block; margin-top: 2px; }
  .meta { font-size: 13px; color: rgba(231,233,238,0.5); margin-top: 18px; line-height: 1.5; }
  .meta a { color: #7aa2f7; text-decoration: none; }
`;

function page(body) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Conectar con Futuraria Design</title>
<style>${PAGE_CSS}</style>
</head>
<body>
  <div class="card">
    <div class="brand">Futuraria Design</div>
    ${body}
  </div>
</body>
</html>`;
}

function loginPage(oauth, errorMessage) {
  const hidden = Object.entries({
    step: "login",
    client_id: oauth.client_id,
    redirect_uri: oauth.redirect_uri,
    scope: oauth.scope,
    state: oauth.state,
    code_challenge: oauth.code_challenge,
    code_challenge_method: oauth.code_challenge_method,
  }).map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join("\n      ");
  return page(`
    <h1>Iniciar sesión</h1>
    <p class="sub">${esc(oauth.clientName || "Una aplicación")} quiere conectarse a tu cuenta de Futuraria Design. Ingresa tus credenciales para continuar.</p>
    ${errorMessage ? `<div class="error">${esc(errorMessage)}</div>` : ""}
    <form method="POST" action="/oauth/authorize">
      ${hidden}
      <label for="email">Correo</label>
      <input id="email" name="email" type="email" autocomplete="email" required>
      <label for="password">Contraseña</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button class="primary" type="submit">Continuar</button>
    </form>
    <p class="meta">¿No tienes cuenta? Crea una en <a href="${SITE_URL}">${SITE_URL.replace("https://", "")}</a> y luego vuelve aquí.</p>`);
}

function consentPage(oauth, email, handle) {
  const scopes = (oauth.scope || "design.read design.write").split(/\s+/).filter(Boolean);
  const descriptions = {
    "design.read": "Ver tus workspaces, diseños y activos",
    "design.write": "Crear y editar diseños en tu nombre",
  };
  const items = scopes.map(s =>
    `<li>${esc(descriptions[s] || s)}<span class="mono">${esc(s)}</span></li>`).join("\n      ");
  const hidden = Object.entries({
    step: "consent",
    handle,
    client_id: oauth.client_id,
    redirect_uri: oauth.redirect_uri,
    state: oauth.state,
  }).map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join("\n      ");
  return page(`
    <h1>Permitir acceso</h1>
    <p class="sub"><strong>${esc(oauth.clientName || oauth.client_id)}</strong> podrá acceder a la cuenta <strong>${esc(email)}</strong> de Futuraria Design.</p>
    <ul class="scopes">
      ${items}
    </ul>
    <form method="POST" action="/oauth/authorize">
      ${hidden}
      <button class="primary" type="submit" name="action" value="allow">Permitir</button>
      <button class="ghost" type="submit" name="action" value="deny">Cancelar</button>
    </form>
    <p class="meta">Puedes revocar este acceso en cualquier momento cerrando la sesión del conector desde Supabase o eliminando el conector en tu cliente.</p>`);
}

function ndaPage() {
  return page(`
    <h1>Falta aceptar el acuerdo</h1>
    <p class="sub">Esta cuenta todavía no ha aceptado el Acuerdo de Acceso Alfa, requerido antes de conectar aplicaciones externas.</p>
    <p class="meta">Inicia sesión en <a href="${SITE_URL}">${SITE_URL.replace("https://", "")}</a>, acepta el acuerdo y vuelve a intentarlo.</p>`);
}

function errorPage(message) {
  return page(`
    <h1>No se pudo completar la conexión</h1>
    <p class="sub">${esc(message)}</p>
    <p class="meta">Vuelve a la aplicación desde la que intentabas conectar e inténtalo de nuevo. Si el problema persiste, verifica la configuración del conector.</p>`);
}

function htmlResponse(body, status = 200) {
  return {
    statusCode: status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY" },
    body,
  };
}

function redirectWithParams(uri, params) {
  const url = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, v);
  return { statusCode: 302, headers: { Location: url.toString(), "Cache-Control": "no-store" }, body: "" };
}

function parseForm(body, isBase64) {
  const raw = isBase64 ? Buffer.from(body || "", "base64").toString("utf8") : (body || "");
  const params = new URLSearchParams(raw);
  const out = {};
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
}

// OAuth params from GET query or POST hidden fields.
function readOauthParams(source) {
  return {
    response_type: source.response_type || "",
    client_id: source.client_id || "",
    redirect_uri: source.redirect_uri || "",
    scope: (source.scope || "").slice(0, 200),
    state: (source.state || "").slice(0, 2000),
    code_challenge: source.code_challenge || "",
    code_challenge_method: source.code_challenge_method || "",
  };
}

async function loadClient(sb, clientId) {
  const { data } = await sb.from("oauth_clients").select("*").eq("client_id", clientId).maybeSingle();
  return data || null;
}

async function cleanupExpired(sb) {
  await sb.from("oauth_codes").delete().lt("expires_at", new Date().toISOString()).then(() => {}, () => {});
}

export const handler = async (event) => {
  try {
    const sb = getSupabaseAdmin();
    if (!sb) return htmlResponse(errorPage("El servidor de autenticación no está disponible en este momento."), 503);

    if (event.httpMethod === "GET") {
      const oauth = readOauthParams(event.queryStringParameters || {});
      const client = await loadClient(sb, oauth.client_id);
      // Unknown client or unregistered redirect_uri: NEVER redirect —
      // that would be an open-redirect vector (RFC6749 §4.1.2.1).
      if (!client || !client.redirect_uris?.includes(oauth.redirect_uri)) {
        return htmlResponse(errorPage("Cliente o dirección de retorno no reconocidos."));
      }
      // Params invalid but redirect_uri already validated: bounce back
      // through the registered URI with the OAuth error, as the RFC says.
      const valid =
        oauth.response_type === "code" &&
        oauth.code_challenge_method === "S256" &&
        PKCE_RE.test(oauth.code_challenge);
      if (!valid) {
        return redirectWithParams(oauth.redirect_uri, {
          error: oauth.response_type === "code" ? "invalid_request" : "unsupported_response_type",
          state: oauth.state,
        });
      }
      return htmlResponse(loginPage({ ...oauth, clientName: client.client_name }));
    }

    if (event.httpMethod !== "POST") {
      return htmlResponse(errorPage("Método no permitido."), 405);
    }

    const form = parseForm(event.body, event.isBase64Encoded);

    // ── Step: login ──
    if (form.step === "login") {
      const oauth = readOauthParams(form);
      const client = await loadClient(sb, oauth.client_id);
      if (!client || !client.redirect_uris?.includes(oauth.redirect_uri) ||
          oauth.code_challenge_method !== "S256" || !PKCE_RE.test(oauth.code_challenge)) {
        return htmlResponse(errorPage("Parámetros de conexión inválidos. Vuelve a iniciar la conexión desde la aplicación."));
      }
      const email = String(form.email || "").trim();
      const password = String(form.password || "");
      if (!email || !password) {
        return htmlResponse(loginPage({ ...oauth, clientName: client.client_name }, "Ingresa tu correo y contraseña."));
      }
      const session = await gotruePasswordGrant(email, password);
      if (!session) {
        return htmlResponse(loginPage({ ...oauth, clientName: client.client_name }, "Correo o contraseña incorrectos."));
      }
      // NDA gate (v30): consent records exist only via the web app.
      const { data: profile } = await sb.from("user_profiles")
        .select("nda_accepted_at").eq("id", session.user.id).maybeSingle();
      if (!profile?.nda_accepted_at) return htmlResponse(ndaPage());

      await cleanupExpired(sb);
      // Pre-approval row: addressed by a random handle; the real OAuth
      // code only exists after the user clicks Permitir.
      const handle = randomToken();
      const { error: insertError } = await sb.from("oauth_codes").insert({
        code_hash: sha256hex(handle),
        client_id: oauth.client_id,
        user_id: session.user.id,
        redirect_uri: oauth.redirect_uri,
        code_challenge: oauth.code_challenge,
        code_challenge_method: "S256",
        scope: oauth.scope || "design.read design.write",
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        token_expires_in: session.expires_in || 3600,
        approved: false,
        used: false,
        expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
      });
      if (insertError) throw new Error(insertError.message);
      return htmlResponse(consentPage({ ...oauth, clientName: client.client_name }, session.user.email || email, handle));
    }

    // ── Step: consent ──
    if (form.step === "consent") {
      const client = await loadClient(sb, form.client_id || "");
      if (!client || !client.redirect_uris?.includes(form.redirect_uri || "")) {
        return htmlResponse(errorPage("Cliente o dirección de retorno no reconocidos."));
      }
      const redirectUri = form.redirect_uri;
      const state = form.state || "";
      const deny = () => redirectWithParams(redirectUri, { error: "access_denied", state });

      const { data: row } = await sb.from("oauth_codes")
        .select("*").eq("code_hash", sha256hex(String(form.handle || ""))).maybeSingle();
      if (!row || row.approved || row.used || new Date(row.expires_at).getTime() < Date.now()) {
        return deny();
      }
      if (form.action !== "allow") {
        await sb.from("oauth_codes").delete().eq("code_hash", row.code_hash).then(() => {}, () => {});
        return deny();
      }

      // Swap the handle for the real single-use code (RFC9207 `iss`
      // included — newer clients validate it against the issuer).
      const code = randomToken();
      const { error: swapError } = await sb.from("oauth_codes")
        .update({ code_hash: sha256hex(code), approved: true, expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString() })
        .eq("code_hash", row.code_hash);
      if (swapError) throw new Error(swapError.message);
      return redirectWithParams(redirectUri, { code, state, iss: SITE_URL });
    }

    return htmlResponse(errorPage("Solicitud incompleta. Vuelve a iniciar la conexión desde la aplicación."));
  } catch (err) {
    console.error("[oauth-authorize] error:", err?.message || err);
    return htmlResponse(errorPage("Error interno del servidor de autenticación."), 500);
  }
};
