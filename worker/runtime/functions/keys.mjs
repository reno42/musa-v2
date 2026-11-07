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
import { getSupabaseAdmin } from "../../../api/src/services/supabase.js";
import { decryptWorkspaceSecret } from "../../../api/src/services/secrets.js";
import { decodeHandlerBody, JSON_UTF8_CONTENT_TYPE } from "./http-encoding.mjs";

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
 *    4. SUPABASE_SECRET_KEY_DE_REPO_DESIGN — deployment fallback
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

/** Cifra una clave BYOK con el esquema de este módulo (iv|tag|ciphertext b64).
 *  Exportado también para mcp.mjs (manage_byok_keys) — misma tabla/formato. */
export function encrypt(plain) {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Layout: [iv (12)] [tag (16)] [ciphertext]
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

/** Descifra con el esquema de este módulo. Exportado para flow_credentials
 *  (REQ-027): los nodos de un flow resuelven su credencial server-side y el
 *  secreto jamás sale del backend. */
export function decrypt(b64) {
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
      body = JSON.parse(decodeHandlerBody(event, "{}"));
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
/**
 * BYOK por defecto: cada usuario usa SUS llaves. La llave de la plataforma (variable de entorno) se entrega
 * solo si el usuario —o el dueño de un espacio donde es miembro— tiene créditos de Musa, y en ese momento
 * se cobran (v2_credit_available → v2_charge_credits). Video y voz quedan solo con llave propia.
 * 1 crédito ≈ 1 imagen normal (Nano Banana 2, US$0,067). Sin usuario identificado → nunca hay llave.
 */
const BYOK_ONLY = new Set(["RUNWAY_API_KEY", "WAVESPEED_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ELEVENLABS_API_KEY", "QUIVER_API_KEY"]);
const DEFAULT_COST = { GEMINI_API_KEY: 1, ZHIPU_API_KEY: 0.02, BATCH_LLM_KEY: 0.02 };
const envValue = (envName) => process.env[envName] || (envName === "BATCH_LLM_KEY" ? process.env.ZHIPU_API_KEY : "") || "";

/** Créditos de Musa por modelo de imagen. */
export function imageCredits(model) {
  const m = String(model || "");
  return /pro/i.test(m) ? 2 : /lite/i.test(m) ? 0.5 : 1;
}

/** ¿Hay créditos para este usuario? Devuelve quién paga o null. */
export async function creditPayer(userId) {
  if (!userId) return null;
  const sb = getSupabaseAdmin();
  if (!sb) return null;
  try { const { data } = await sb.rpc("v2_credit_available", { p_user: userId }); return data || null; } catch { return null; }
}

/** Cobra créditos (se usa cuando la llamada ya está decidida). */
export async function chargeCredits(userId, amount, reason, meta) {
  const sb = getSupabaseAdmin();
  if (!sb || !userId || !(amount > 0)) return null;
  try { const { data } = await sb.rpc("v2_charge_credits", { p_user: userId, p_amount: amount, p_reason: reason, p_meta: meta || null }); return data; } catch { return null; }
}

/** Compatibilidad: ¿puede usar la IA de la plataforma? (= tiene créditos). */
export async function platformAllowed(userId) {
  return !!(await creditPayer(userId));
}

/** Llave de la plataforma si hay créditos; cobra `cost` créditos al entregarla. */
export async function platformKey(userId, envName, cost) {
  if (BYOK_ONLY.has(envName)) return null;
  const value = envValue(envName);
  if (!value || !userId) return null;
  if (!(await creditPayer(userId))) return null;
  const r = await chargeCredits(userId, cost ?? DEFAULT_COST[envName] ?? 0.1, envName.replace(/_API_KEY|_KEY/, "").toLowerCase());
  return r?.ok ? value : null;
}

/** Igual que platformKey pero para el dueño de un espacio (flows, lotes). */
export async function platformKeyForWorkspace(workspaceId, envName, cost) {
  const sb = getSupabaseAdmin();
  if (!sb || !workspaceId) return null;
  const { data } = await sb.from("workspaces").select("owner_id").eq("id", workspaceId).maybeSingle();
  return data?.owner_id ? platformKey(data.owner_id, envName, cost) : null;
}

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
