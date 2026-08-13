/**
 * Server-side BYOK key management.
 *
 * Endpoints:
 *   GET    /api/keys           → { [provider]: { configured: boolean, model: string|null } }
 *   PUT    /api/keys/:provider  → encrypts and stores the key + optional model
 *   DELETE /api/keys/:provider  → removes the key
 *
 * Keys are AES-256-GCM encrypted with WORKSPACE_SECRET_ENCRYPTION_KEY before hitting
 * the database. The GET endpoint NEVER returns the raw key — only whether
 * one exists and which model is selected. This keeps keys safe even if the
 * database is leaked without the secret.
 *
 * Auth: requires a valid Supabase JWT (Bearer token). RLS enforces that
 * users can only see their own rows.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { getSupabaseAdmin } from "../../api/src/services/supabase.js";
import { decryptWorkspaceSecret } from "../../api/src/services/secrets.js";
import { decodeNetlifyBody, JSON_UTF8_CONTENT_TYPE } from "./http-encoding.mjs";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function corsHeaders() {
  return {
    "Content-Type": JSON_UTF8_CONTENT_TYPE,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
  };
}

function jsonBody(statusCode, data) {
  return { statusCode, headers: corsHeaders(), body: JSON.stringify(data) };
}

/** Derive a 32-byte AES key for encrypting user BYOK secrets.
 *
 *  Resolution order (first non-empty, ≥24-char value wins):
 *    1. WORKSPACE_SECRET_ENCRYPTION_KEY — dedicated secret (optional override)
 *    2. SUPABASE_SECRET_KEY            — always present when DB is up
 *    3. SUPABASE_SERVICE_KEY           — legacy alias
 *    4. SUPABASE_SECRET_KEY_DE_REPO_DESIGN — Netlify fallback
 *
 *  This means BYOK encryption works out-of-the-box wherever Supabase is
 *  configured. No manual env var setup is required to enable key storage.
 *  WORKSPACE_SECRET_ENCRYPTION_KEY remains as an optional hardening layer.
 */
function getEncryptionKey() {
  const secret =
    process.env.WORKSPACE_SECRET_ENCRYPTION_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SECRET_KEY_DE_REPO_DESIGN;
  if (!secret || secret.length < 24) {
    throw new Error("No encryption source available — set WORKSPACE_SECRET_ENCRYPTION_KEY or configure Supabase");
  }
  return scryptSync(secret, "futuraria-byok-encryption-v1", 32);
}

function encrypt(plain) {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Layout: [iv (12)] [tag (16)] [ciphertext]
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

function decrypt(b64) {
  const key = getEncryptionKey();
  const buf = Buffer.from(b64, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

/**
 * Validate the Bearer JWT and return the user id.
 * Returns null if not authenticated.
 */
async function authenticate(event) {
  const bearer = (event.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return null;
  const sb = getSupabaseAdmin();
  if (!sb) return null;
  try {
    const { data, error } = await sb.auth.getUser(bearer);
    if (error || !data?.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
  }

  // ── Auth ──
  const userId = await authenticate(event);
  if (!userId) {
    return jsonBody(401, { error: "Authentication required. Sign in to manage API keys." });
  }

  const sb = getSupabaseAdmin();
  if (!sb) {
    return jsonBody(503, { error: "Database not configured on the server." });
  }

  // ── Parse path: /api/keys, /api/keys/:provider, or /api/keys/:provider/decrypt ──
  const path = (event.path || "").replace(/^\/+|\/+$/g, ""); // trim slashes
  const segments = path.split("/");
  // segments: ["api", "keys"], ["api", "keys", ":provider"], or ["api", "keys", ":provider", "decrypt"]
  const provider = segments.length >= 3 ? decodeURIComponent(segments[2]) : null;
  const action = segments.length >= 4 ? decodeURIComponent(segments[3]) : null;

  // ── GET /api/keys/:provider/decrypt — return decrypted key to owner ──
  if (event.httpMethod === "GET" && provider && action === "decrypt") {
    const { key, model } = await getUserKey(userId, provider);
    if (!key) {
      return jsonBody(404, { error: `No key configured for ${provider}` });
    }
    return jsonBody(200, { key, model });
  }

  // ── GET /api/keys — list all configured providers (last4 only, never the key) ──
  if (event.httpMethod === "GET" && !provider) {
    const { data, error } = await sb
      .from("user_api_keys")
      .select("provider, model, last4")
      .eq("user_id", userId);

    if (error) return jsonBody(500, { error: error.message });

    const result = {};
    for (const row of data || []) {
      result[row.provider] = { configured: true, model: row.model || null, last4: row.last4 || null };
    }
    return jsonBody(200, result);
  }

  // ── PUT /api/keys/:provider — encrypt & store ──
  if (event.httpMethod === "PUT" && provider) {
    let body;
    try {
      body = JSON.parse(decodeNetlifyBody(event, "{}"));
    } catch {
      return jsonBody(400, { error: "Invalid JSON body." });
    }
    const key = (body.key || "").trim();
    const model = body.model !== undefined ? String(body.model).trim() : undefined;

    // Model-only update: if no key is provided but a model is, just
    // update the model column without touching the encrypted key.
    if (!key && model !== undefined) {
      const { error: modelErr } = await sb
        .from("user_api_keys")
        .update({ model: model || null, updated_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("provider", provider);
      if (modelErr) return jsonBody(500, { error: modelErr.message });
      return jsonBody(200, { success: true, provider, configured: true });
    }

    if (!key) return jsonBody(400, { error: "Missing 'key' in request body." });

    let encrypted;
    try {
      encrypted = encrypt(key);
    } catch (e) {
      // Never leak the env var name to the client — the user can't fix it.
      console.error("[keys] Encryption failed:", e.message);
      return jsonBody(500, { error: "Server encryption is not configured. Ask the admin to set WORKSPACE_SECRET_ENCRYPTION_KEY (≥24 chars)." });
    }

    // Upsert: one key per provider per user
    const { error } = await sb
      .from("user_api_keys")
      .upsert(
        { user_id: userId, provider, encrypted_key: encrypted, last4: key.slice(-4), model: model || null, updated_at: new Date().toISOString() },
        { onConflict: "user_id,provider" },
      );

    if (error) return jsonBody(500, { error: error.message });

    return jsonBody(200, { success: true, provider, configured: true, last4: key.slice(-4) });
  }

  // ── DELETE /api/keys/:provider — remove ──
  if (event.httpMethod === "DELETE" && provider) {
    const { error } = await sb
      .from("user_api_keys")
      .delete()
      .eq("user_id", userId)
      .eq("provider", provider);

    if (error) return jsonBody(500, { error: error.message });

    return jsonBody(200, { success: true, provider, configured: false });
  }

  return jsonBody(405, { error: `Method ${event.httpMethod} not allowed.` });
}

/**
 * Exported for use by other server-side functions (mcp.mjs, quiver-stream.mjs).
 * Decrypts and returns a user's key for a given provider.
 *
 * Includes automatic migration from user_provider_keys (the old Express-only
 * table encrypted with a different salt). If the key isn't in user_api_keys
 * but exists in user_provider_keys, it is decrypted, re-encrypted, saved to
 * user_api_keys, and deleted from the old table — all transparently.
 *
 * Returns { key: string|null, model: string|null }.
 */
export async function getUserKey(userId, provider) {
  const sb = getSupabaseAdmin();
  if (!sb) return { key: null, model: null };

  // ── Primary: user_api_keys (this system's table) ──
  const { data, error } = await sb
    .from("user_api_keys")
    .select("encrypted_key, model")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();

  if (!error && data?.encrypted_key) {
    try {
      return { key: decrypt(data.encrypted_key), model: data.model || null };
    } catch {
      // Fall through to migration check — a corrupt ciphertext shouldn't
      // block a valid key that might live in the old table.
    }
  }

  // ── Migration: user_provider_keys (old Express system, different salt) ──
  // The old table uses secrets.ts format (v1.iv.tag.ciphertext, salt
  // 'futuraria-workspace-secrets-v1'). This decrypts with that format,
  // re-encrypts with keys.mjs format, and moves the row.
  const { data: oldData } = await sb
    .from("user_provider_keys")
    .select("key_cipher")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();

  if (oldData?.key_cipher) {
    try {
      const rawKey = decryptWorkspaceSecret(oldData.key_cipher);
      const reencrypted = encrypt(rawKey);
      await sb.from("user_api_keys").upsert(
        { user_id: userId, provider, encrypted_key: reencrypted, last4: rawKey.slice(-4), model: null, updated_at: new Date().toISOString() },
        { onConflict: "user_id,provider" },
      );
      // Remove from old table so this branch never runs again.
      await sb.from("user_provider_keys")
        .delete().eq("user_id", userId).eq("provider", provider);
      return { key: rawKey, model: null };
    } catch {
      return { key: null, model: null };
    }
  }

  return { key: null, model: null };
}
