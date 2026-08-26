// QA/oauth-flow-test.mjs — end-to-end OAuth 2.1 flow test (REQ-012).
//
// A headless MCP client: performs EXACTLY the sequence ChatGPT / Claude web
// ("Conectores") perform against production, minus the browser UI:
//
//   1. RFC9728 + RFC8414 discovery endpoints
//   2. The 401 + WWW-Authenticate discovery trigger on /mcp
//   3. RFC7591 dynamic client registration (public client, PKCE)
//   4. /oauth/authorize: login -> consent -> code redirect (state + iss)
//   5. /oauth/token: authorization_code exchange (PKCE S256)
//   6. The issued token authorizes tools/call on /mcp as Bearer
//   7. refresh_token grant (GoTrue pass-through)
//   8. Single-use codes: replaying a spent code must fail
//
// This is how we regression-test OAuth WITHOUT any paid AI client.
//
// Usage (PowerShell):
//   node QA/oauth-qa-user-setup.mjs      // once: QA user + QA/.env.qa-oauth
//   node QA/oauth-flow-test.mjs          // the flow (auto-loads QA/.env.qa-oauth)
// Explicit alternative:
//   $env:FDR_EMAIL="..."; $env:FDR_PASSWORD="..."; node QA/oauth-flow-test.mjs
//
// Blast radius per run: one throwaway row in oauth_clients (prune with
// `node QA/oauth-qa-user-setup.mjs --prune-clients`). Requires an
// NDA-accepted account — the setup script handles that for the QA user.

import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ── Config: real env vars win, then QA/.env.qa-oauth (git-ignored) ──
function parseEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith("#")) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
const local = parseEnvFile(join(dirname(fileURLToPath(import.meta.url)), ".env.qa-oauth"));
const SITE = (process.env.FDR_SITE || local.FDR_SITE || "https://design.futuraria.com").replace(/\/+$/, "");
const EMAIL = process.env.FDR_EMAIL || local.FDR_EMAIL || "";
const PASSWORD = process.env.FDR_PASSWORD || local.FDR_PASSWORD || "";
const REDIRECT_URI = "http://127.0.0.1:8941/callback"; // RFC8252 loopback — never actually followed
// A PRIVATE tool (not in mcp.mjs PUBLIC_TOOLS) so the 401/Bearer checks are meaningful.
const PRIVATE_TOOL = "list_workspaces";

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) { pass++; console.log("  [PASS] " + name); }
  else { fail++; console.log("  [FAIL] " + name + (detail ? " — " + detail : "")); }
};
const mask = (t) => (t ? t.slice(0, 14) + "…" : "(none)");
// Must match oauth-token.mjs b64urlSha256 (verifier is ASCII — utf8 === ascii here).
const b64urlSha256 = (s) => createHash("sha256").update(s, "utf8").digest("base64url");
const mcp = async (method, params, headers = {}) => {
  const res = await fetch(SITE + "/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: Math.floor(Math.random() * 1e6), method, params: params || {} }),
  });
  return { status: res.status, headers: res.headers, json: await res.json().catch(() => null) };
};

if (!EMAIL || !PASSWORD) {
  console.error("No credentials. Run `node QA/oauth-qa-user-setup.mjs` first (writes QA/.env.qa-oauth),");
  console.error("or set FDR_EMAIL + FDR_PASSWORD for any NDA-accepted account.");
  process.exit(2);
}

console.log("OAuth 2.1 flow test — " + SITE);
console.log("Account: " + EMAIL + "\n");

// ── 1. Discovery (RFC9728 / RFC8414) — what a client fetches first ──
console.log("[1/8] Discovery");
const prRes = await fetch(SITE + "/.well-known/oauth-protected-resource");
const pr = await prRes.json().catch(() => null);
check("GET /.well-known/oauth-protected-resource -> 200 JSON", prRes.status === 200 && !!pr, "status " + prRes.status);
check("metadata lists authorization_servers", Array.isArray(pr?.authorization_servers) && pr.authorization_servers.length > 0);
const asRes = await fetch(SITE + "/.well-known/oauth-authorization-server");
const as = await asRes.json().catch(() => null);
check("GET /.well-known/oauth-authorization-server -> 200 JSON", asRes.status === 200 && !!as, "status " + asRes.status);
check("AS metadata exposes the 3 endpoints", !!as?.authorization_endpoint && !!as?.token_endpoint && !!as?.registration_endpoint);

// ── 2. The discovery trigger: anonymous tools/call on a PRIVATE tool ──
console.log("[2/8] 401 + WWW-Authenticate trigger on /mcp");
const anon = await mcp("tools/call", { name: PRIVATE_TOOL, arguments: {} });
const wwwAuth = anon.headers.get("www-authenticate") || "";
check("unauthenticated tools/call -> 401", anon.status === 401, "got " + anon.status);
check("WWW-Authenticate points at resource metadata (RFC9728)", wwwAuth.includes('resource_metadata="'), wwwAuth || "(header missing)");
check("JSON-RPC error mentions OAuth", (anon.json?.error?.message || "").includes("OAuth"), JSON.stringify(anon.json?.error || "").slice(0, 160));

// ── 3. Dynamic client registration (RFC7591) ──
console.log("[3/8] Dynamic client registration");
const regRes = await fetch(SITE + "/oauth/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    client_name: "QA oauth-flow-test",
    redirect_uris: [REDIRECT_URI],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: "design.read design.write",
  }),
});
const client = await regRes.json().catch(() => null);
check("POST /oauth/register -> 201 with client_id", regRes.status === 201 && typeof client?.client_id === "string",
  "status " + regRes.status + " " + JSON.stringify(client).slice(0, 200));
if (!client?.client_id) {
  console.error("Cannot continue without a client_id — aborting.");
  process.exit(1);
}

// ── 4. Authorize: login -> consent -> code ──
console.log("[4/8] Authorization endpoint (login + consent)");
const verifier = randomBytes(32).toString("base64url");
const challenge = b64urlSha256(verifier);
const state = randomBytes(16).toString("hex");
const oauthParams = {
  response_type: "code",
  client_id: client.client_id,
  redirect_uri: REDIRECT_URI,
  scope: "design.read design.write",
  state,
  code_challenge: challenge,
  code_challenge_method: "S256",
};
const loginGet = await fetch(SITE + "/oauth/authorize?" + new URLSearchParams(oauthParams));
const loginHtml = await loginGet.text();
check("GET /oauth/authorize -> 200 login page", loginGet.status === 200 && loginHtml.includes("Iniciar sesi"), "status " + loginGet.status);
if (/Falta aceptar/i.test(loginHtml)) {
  console.error("  Account has NOT accepted the NDA — accept it in the web app (or re-run the setup script) and retry.");
  process.exit(1);
}
const loginPost = await fetch(SITE + "/oauth/authorize", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ ...oauthParams, step: "login", email: EMAIL, password: PASSWORD }),
  redirect: "manual",
});
const consentHtml = await loginPost.text();
check("POST login -> consent page", loginPost.status === 200 && consentHtml.includes("Permitir acceso"),
  "status " + loginPost.status + (loginPost.status === 200 ? " (login page again? wrong credentials)" : ""));
const handle = (consentHtml.match(/name="handle"\s+value="([^"]+)"/) || [])[1];
check("consent page carries the hidden handle", !!handle);
const consentPost = await fetch(SITE + "/oauth/authorize", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ step: "consent", handle, client_id: client.client_id, redirect_uri: REDIRECT_URI, state, action: "allow" }),
  redirect: "manual",
});
check("POST consent allow -> 302 redirect", [301, 302, 303].includes(consentPost.status), "status " + consentPost.status);
const location = consentPost.headers.get("location") || "";
const redirectUrl = new URL(location, SITE);
const code = redirectUrl.searchParams.get("code");
check("redirect carries the authorization code", !!code, location.slice(0, 160) || "(no Location header)");
check("redirect echoes state (CSRF guard)", redirectUrl.searchParams.get("state") === state);
check("redirect carries iss (RFC9207)", redirectUrl.searchParams.get("iss") !== null);
if (!code) {
  console.error("Cannot continue without a code — aborting.");
  process.exit(1);
}

// ── 5. Token exchange (authorization_code + PKCE S256) ──
console.log("[5/8] Token exchange");
const tokenRes = await fetch(SITE + "/oauth/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: client.client_id,
    code_verifier: verifier,
  }),
});
const tokens = await tokenRes.json().catch(() => null);
check("POST /oauth/token -> 200 with access_token", tokenRes.status === 200 && !!tokens?.access_token,
  "status " + tokenRes.status + " " + JSON.stringify(tokens).slice(0, 200));
check("response includes refresh_token + Bearer type", !!tokens?.refresh_token && tokens?.token_type === "Bearer");
console.log("         access_token: " + mask(tokens?.access_token));
if (!tokens?.access_token) {
  console.error("Cannot continue without an access token — aborting.");
  process.exit(1);
}

// ── 6. The whole point: the OAuth token authorizes /mcp ──
console.log("[6/8] Bearer on /mcp tools/call");
const bearer = { Authorization: "Bearer " + tokens.access_token };
const init = await mcp("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "qa-oauth-flow-test", version: "1.0.0" } }, bearer);
check("initialize with Bearer", init.status === 200 && !init.json?.error);
const call = await mcp("tools/call", { name: PRIVATE_TOOL, arguments: {} }, bearer);
check("tools/call '" + PRIVATE_TOOL + "' with Bearer succeeds", call.status === 200 && !call.json?.error,
  "status " + call.status + " " + JSON.stringify(call.json?.error || "").slice(0, 200));
const callText = call.json?.result?.content?.[0]?.text;
if (callText) {
  try {
    const data = JSON.parse(callText);
    console.log("         " + PRIVATE_TOOL + " returned " + (Array.isArray(data?.data) ? data.data.length + " workspace(s)" : "a result") + " for the QA user");
  } catch { /* text payload not JSON — irrelevant here */ }
}

// ── 7. Refresh grant (GoTrue pass-through) ──
console.log("[7/8] Refresh token");
const refreshRes = await fetch(SITE + "/oauth/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: client.client_id }),
});
const refreshed = await refreshRes.json().catch(() => null);
check("refresh -> 200 with a new access_token", refreshRes.status === 200 && !!refreshed?.access_token,
  "status " + refreshRes.status + " " + JSON.stringify(refreshed).slice(0, 160));

// ── 8. Negative control: single-use codes ──
console.log("[8/8] Single-use codes");
const replayRes = await fetch(SITE + "/oauth/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: client.client_id,
    code_verifier: verifier,
  }),
});
const replay = await replayRes.json().catch(() => null);
check("code replay -> 400 invalid_grant", replayRes.status === 400 && replay?.error === "invalid_grant",
  "status " + replayRes.status + " " + JSON.stringify(replay).slice(0, 160));

console.log("\nResult: " + pass + " passed, " + fail + " failed" + (fail === 0 ? " — OAuth flow is GREEN without any paid AI client." : ""));
process.exit(fail === 0 ? 0 : 1);
