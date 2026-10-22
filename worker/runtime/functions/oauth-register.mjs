// ═══════════════════════════════════════════════════════════════
// REQ-012 — OAuth 2.1 for MCP. Dynamic Client Registration
// (RFC7591) so ChatGPT / Claude web can self-register when they
// discover the server via /.well-known/oauth-authorization-server.
//
// Registration is OPEN (rate-limited per IP): the big MCP clients
// register programmatically on first connect, with no human in the
// loop to pre-provision client_ids. Rows are inert metadata — the
// blast radius of a junk registration is one row in oauth_clients.
//
// Public clients (token_endpoint_auth_method "none") are the norm
// here: MCP clients are browser/desktop apps using PKCE. Confidential
// clients get a secret returned ONCE, stored only as SHA-256 (same
// pattern as keyHash in mcp.mjs).
// ═══════════════════════════════════════════════════════════════
import { createHash, randomBytes } from "node:crypto";
import { getSupabaseAdmin } from "../../../api/src/services/supabase.js";

const SITE_URL = (process.env.URL || "https://design.futuraria.com").replace(/\/$/, "");
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Small in-memory fixed-window limiter (same trade-off as checkRateLimit
// in mcp.mjs: resets on cold start, good enough against bulk abuse).
const RATE_LIMIT = 10;
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

function sha256hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

// RFC7591 §3.1 — reject junk before touching the DB.
function validateMetadata(meta) {
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
    return { error: "client metadata must be a JSON object" };
  }
  const uris = meta.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 20 || !uris.every(u => typeof u === "string")) {
    return { error: "redirect_uris must be a non-empty array of strings" };
  }
  for (const uri of uris) {
    let parsed;
    try { parsed = new URL(uri); } catch { return { error: `redirect_uri is not a valid URL: ${uri}` }; }
    // https only, except loopback plain-http which RFC8252 allows for
    // native dev clients.
    const isLoopback = parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !isLoopback) {
      return { error: `redirect_uri must be https (or http on localhost): ${uri}` };
    }
    if (parsed.hash) return { error: `redirect_uri must not contain a fragment: ${uri}` };
  }
  const authMethod = meta.token_endpoint_auth_method ?? "none";
  if (!["none", "client_secret_post"].includes(authMethod)) {
    return { error: `token_endpoint_auth_method not supported: ${authMethod}` };
  }
  const allowedGrants = ["authorization_code", "refresh_token"];
  const grants = meta.grant_types ?? ["authorization_code", "refresh_token"];
  if (!Array.isArray(grants) || !grants.every(g => allowedGrants.includes(g))) {
    return { error: "grant_types must be a subset of [authorization_code, refresh_token]" };
  }
  const responseTypes = meta.response_types ?? ["code"];
  if (!Array.isArray(responseTypes) || !responseTypes.every(r => r === "code")) {
    return { error: "response_types must be [\"code\"]" };
  }
  if (meta.client_name != null && (typeof meta.client_name !== "string" || meta.client_name.length > 120)) {
    return { error: "client_name must be a string of at most 120 characters" };
  }
  if (meta.scope != null && (typeof meta.scope !== "string" || meta.scope.length > 200)) {
    return { error: "scope must be a string of at most 200 characters" };
  }
  return {
    authMethod,
    grants,
    uris,
    clientName: typeof meta.client_name === "string" ? meta.client_name : "",
    scope: typeof meta.scope === "string" ? meta.scope : "design.read design.write",
  };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { ...CORS, Allow: "POST, OPTIONS", "Content-Type": "application/json" },
      body: JSON.stringify({ error: "invalid_request", error_description: "POST only" }),
    };
  }

  const ip = event.headers["x-forwarded-for"] || event.headers["client-ip"] || "unknown";
  if (rateLimited(ip)) {
    return {
      statusCode: 429,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "invalid_client_metadata", error_description: "Too many registrations from this IP. Try again later." }),
    };
  }

  try {
    const sb = getSupabaseAdmin();
    if (!sb) {
      return {
        statusCode: 503,
        headers: { ...CORS, "Content-Type": "application/json" },
        body: JSON.stringify({ error: "temporarily_unavailable", error_description: "Registration storage is not configured" }),
      };
    }

    let meta;
    try {
      const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : (event.body || "");
      meta = JSON.parse(raw || "{}");
    } catch {
      return {
        statusCode: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
        body: JSON.stringify({ error: "invalid_client_metadata", error_description: "Body must be valid JSON" }),
      };
    }

    const validated = validateMetadata(meta);
    if (validated.error) {
      return {
        statusCode: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
        body: JSON.stringify({ error: "invalid_client_metadata", error_description: validated.error }),
      };
    }

    const clientId = "fdr_oc_" + randomBytes(16).toString("hex");
    let clientSecret = null;
    let secretHash = null;
    if (validated.authMethod === "client_secret_post") {
      clientSecret = "fdr_ocs_" + randomBytes(24).toString("hex");
      secretHash = sha256hex(clientSecret);
    }

    const { error: insertError } = await sb.from("oauth_clients").insert({
      client_id: clientId,
      client_secret_hash: secretHash,
      client_name: validated.clientName,
      redirect_uris: validated.uris,
      grant_types: validated.grants,
      token_endpoint_auth_method: validated.authMethod,
      scope: validated.scope,
    });
    if (insertError) throw new Error(insertError.message);

    const responseBody = {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: validated.uris,
      grant_types: validated.grants,
      token_endpoint_auth_method: validated.authMethod,
      client_name: validated.clientName,
      scope: validated.scope,
    };
    if (clientSecret) {
      responseBody.client_secret = clientSecret;
      responseBody.client_secret_expires_at = 0; // RFC7591: 0 = never expires
    }

    return {
      statusCode: 201,
      headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      body: JSON.stringify(responseBody),
    };
  } catch (err) {
    console.error("[oauth-register] error:", err?.message || err);
    return {
      statusCode: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "server_error", error_description: "Registration failed. Check function logs." }),
    };
  }
};
