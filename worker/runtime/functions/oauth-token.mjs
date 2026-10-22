// ═══════════════════════════════════════════════════════════════
// REQ-012 — OAuth 2.1 token endpoint. Two grants:
//
//   authorization_code — validates the single-use code + PKCE S256
//     verifier and returns the USER session tokens stored at consent
//     time (real Supabase Auth tokens; mcp.mjs already accepts them
//     as Bearer). The row is deleted on exchange — the tokens pass
//     through exactly once and never live in two places.
//
//   refresh_token — straight pass-through to GoTrue's refresh grant,
//     so long-lived connectors survive access-token expiry (GoTrue
//     rotates the refresh token; the client keeps the new one).
//
// Errors follow RFC6749 §5.2 (400 + error/error_description, 401 for
// invalid_client). CORS is fully open per the OAuth 2.1 / MCP spec —
// browser-based clients call this endpoint cross-origin.
// ═══════════════════════════════════════════════════════════════
import { createHash, timingSafeEqual } from "node:crypto";
import { getSupabaseAdmin } from "../../../api/src/services/supabase.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
const PKCE_RE = /^[A-Za-z0-9\-._~]{43,128}$/;

function sha256hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function b64urlSha256(value) {
  return createHash("sha256").update(value, "ascii").digest("base64url"); // RFC7636 §4.2
}

function sameHex(a, b) {
  const ha = sha256hex(a);
  const hb = sha256hex(b);
  return ha.length === hb.length && timingSafeEqual(Buffer.from(ha), Buffer.from(hb));
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

async function gotrueRefresh(refreshToken) {
  const { url, apiKey } = supabaseRestConfig();
  if (!url || !apiKey) return null;
  try {
    const res = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json?.access_token || !json?.refresh_token) return null;
    return json;
  } catch {
    return null;
  }
}

// Fixed-window limiter — token endpoints are the brute-force target.
const RATE_LIMIT = 60;
const rateBuckets = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const windowStart = Math.floor(now / 3_600_000) * 3_600_000;
  const key = `${ip}:${windowStart}`;
  const count = rateBuckets.get(key) || 0;
  rateBuckets.set(key, count + 1);
  if (rateBuckets.size > 5000) rateBuckets.clear();
  return count >= RATE_LIMIT;
}

function oauthError(status, error, description) {
  return {
    statusCode: status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body: JSON.stringify({ error, error_description: description }),
  };
}

// Spec-mandated form-urlencoded; JSON accepted as a testing courtesy.
function parseBody(event) {
  const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : (event.body || "");
  if (!raw) return {};
  const contentType = String(event.headers["content-type"] || "");
  if (contentType.includes("application/json")) {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  const out = {};
  for (const [k, v] of new URLSearchParams(raw).entries()) out[k] = v;
  return out;
}

async function authenticateClient(sb, form) {
  const clientId = String(form.client_id || "");
  if (!clientId) return { error: oauthError(401, "invalid_client", "client_id is required") };
  const { data: client } = await sb.from("oauth_clients")
    .select("client_id, client_secret_hash, token_endpoint_auth_method").eq("client_id", clientId).maybeSingle();
  if (!client) return { error: oauthError(401, "invalid_client", "Unknown client") };
  if (client.token_endpoint_auth_method === "client_secret_post") {
    const secret = String(form.client_secret || "");
    if (!secret || !client.client_secret_hash || !sameHex(secret, client.client_secret_hash)) {
      return { error: oauthError(401, "invalid_client", "Client authentication failed") };
    }
  }
  return { client };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return oauthError(405, "invalid_request", "POST only");
  }

  const ip = event.headers["x-forwarded-for"] || event.headers["client-ip"] || "unknown";
  if (rateLimited(ip)) {
    return oauthError(429, "invalid_request", "Too many token requests from this IP. Try again later.");
  }

  try {
    const sb = getSupabaseAdmin();
    if (!sb) return oauthError(503, "temporarily_unavailable", "Token storage is not configured");

    const form = parseBody(event);

    // Opportunistic cleanup of abandoned codes.
    await sb.from("oauth_codes").delete().lt("expires_at", new Date().toISOString()).then(() => {}, () => {});

    const clientAuth = await authenticateClient(sb, form);
    if (clientAuth.error) return clientAuth.error;

    if (form.grant_type === "authorization_code") {
      const code = String(form.code || "");
      const redirectUri = String(form.redirect_uri || "");
      const verifier = String(form.code_verifier || "");
      if (!code || !redirectUri || !verifier) {
        return oauthError(400, "invalid_request", "code, redirect_uri and code_verifier are required");
      }
      if (!PKCE_RE.test(verifier)) {
        return oauthError(400, "invalid_grant", "code_verifier must be 43-128 characters from the unreserved set");
      }

      const { data: row } = await sb.from("oauth_codes")
        .select("*").eq("code_hash", sha256hex(code)).maybeSingle();
      const invalidGrant = () => oauthError(400, "invalid_grant",
        "Code is invalid, expired, already used, or does not match this client/redirect/PKCE verifier");
      if (!row || !row.approved || row.used || new Date(row.expires_at).getTime() < Date.now()) return invalidGrant();
      if (row.client_id !== clientAuth.client.client_id || row.redirect_uri !== redirectUri) return invalidGrant();
      if (row.code_challenge_method !== "S256" || b64urlSha256(verifier) !== row.code_challenge) return invalidGrant();
      if (!row.access_token || !row.refresh_token) return invalidGrant();

      // Single use: consume the row BEFORE returning the tokens, so a
      // replayed exchange can never win a race.
      const { error: consumeError } = await sb.from("oauth_codes")
        .update({ used: true, access_token: null, refresh_token: null })
        .eq("code_hash", row.code_hash).eq("used", false);
      if (consumeError) throw new Error(consumeError.message);

      return {
        statusCode: 200,
        headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Pragma": "no-cache" },
        body: JSON.stringify({
          access_token: row.access_token,
          token_type: "Bearer",
          expires_in: row.token_expires_in || 3600,
          refresh_token: row.refresh_token,
          scope: row.scope || "design.read design.write",
        }),
      };
    }

    if (form.grant_type === "refresh_token") {
      const refreshToken = String(form.refresh_token || "");
      if (!refreshToken) {
        return oauthError(400, "invalid_request", "refresh_token is required");
      }
      const session = await gotrueRefresh(refreshToken);
      if (!session) {
        return oauthError(400, "invalid_grant", "Refresh token is invalid, expired or revoked");
      }
      return {
        statusCode: 200,
        headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Pragma": "no-cache" },
        body: JSON.stringify({
          access_token: session.access_token,
          token_type: "Bearer",
          expires_in: session.expires_in || 3600,
          refresh_token: session.refresh_token,
          scope: "design.read design.write",
        }),
      };
    }

    return oauthError(400, "unsupported_grant_type", "Supported grants: authorization_code, refresh_token");
  } catch (err) {
    console.error("[oauth-token] error:", err?.message || err);
    return oauthError(500, "server_error", "Token endpoint failed. Check function logs.");
  }
};
