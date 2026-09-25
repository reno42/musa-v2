import { Router } from "express";
import { getSupabaseAdmin } from "../services/supabase.js";
// Implementación local de BYOK con el MISMO esquema que producción: la fuente
// de verdad es netlify/functions/keys.mjs (AES-256-GCM, sal
// "futuraria-byok-encryption-v1", tabla user_api_keys) e importamos SUS
// helpers (encrypt/getUserKey) en vez de duplicar crypto que pudiera
// divergir — mismo patrón que index.ts ya usa con mcp.mjs.
//
// Cloudflare: el worker intercepta /api/keys* ANTES del fallback Express
// (worker/index.js routes → keysHandler), así que en producción CF esta
// router nunca corre; solo sirve local dev, donde antes había un stub 501
// que dejaba al chat y al ghost del bridge sin key (fetchDecryptedKey → 501).
import { encrypt, getUserKey } from "../../../netlify/functions/keys.mjs";

export const keysStubRoutes = Router();

/** Misma auth que keys.mjs: Bearer JWT → user id (null si inválido). */
async function authenticate(req: any): Promise<string | null> {
  const bearer = (req.headers?.authorization || "").replace(/^Bearer\s+/i, "");
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

// GET /api/keys — list configured providers (last4 only, never the key).
keysStubRoutes.get("/", async (req, res) => {
  const userId = await authenticate(req);
  if (!userId) return res.status(401).json({ error: "Authentication required. Sign in to manage API keys." });
  const sb = getSupabaseAdmin()!;
  const { data, error } = await sb.from("user_api_keys").select("provider, model, last4").eq("user_id", userId);
  if (error) return res.status(500).json({ error: error.message });
  const result: Record<string, unknown> = {};
  for (const row of data || []) {
    result[row.provider] = { configured: true, model: row.model || null, last4: row.last4 || null };
  }
  res.json(result);
});

// GET /api/keys/:provider/decrypt — decrypted key to the owner.
// getUserKey (keys.mjs) resuelve decrypt + migración legacy user_provider_keys.
keysStubRoutes.get("/:provider/decrypt", async (req, res) => {
  const userId = await authenticate(req);
  if (!userId) return res.status(401).json({ error: "Authentication required. Sign in to manage API keys." });
  const { key, model } = await getUserKey(userId, req.params.provider);
  if (!key) return res.status(404).json({ error: `No key configured for ${req.params.provider}` });
  res.json({ key, model });
});

// PUT /api/keys/:provider — encrypt & upsert (incluye update solo-modelo).
keysStubRoutes.put("/:provider", async (req, res) => {
  const userId = await authenticate(req);
  if (!userId) return res.status(401).json({ error: "Authentication required. Sign in to manage API keys." });
  const provider = req.params.provider;
  const key = String(req.body?.key || "").trim();
  const model = req.body?.model !== undefined ? String(req.body.model).trim() : undefined;
  const sb = getSupabaseAdmin()!;
  if (!key && model !== undefined) {
    const { error } = await sb
      .from("user_api_keys")
      .update({ model: model || null, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("provider", provider);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, provider, configured: true });
  }
  if (!key) return res.status(400).json({ error: "Missing 'key' in request body." });
  let encrypted: string;
  try {
    encrypted = encrypt(key);
  } catch {
    return res.status(500).json({ error: "Server encryption is not configured." });
  }
  const { error } = await sb
    .from("user_api_keys")
    .upsert(
      { user_id: userId, provider, encrypted_key: encrypted, last4: key.slice(-4), model: model || null, updated_at: new Date().toISOString() },
      { onConflict: "user_id,provider" },
    );
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, provider, configured: true, last4: key.slice(-4) });
});

// DELETE /api/keys/:provider — remove.
keysStubRoutes.delete("/:provider", async (req, res) => {
  const userId = await authenticate(req);
  if (!userId) return res.status(401).json({ error: "Authentication required. Sign in to manage API keys." });
  const sb = getSupabaseAdmin()!;
  const { error } = await sb
    .from("user_api_keys")
    .delete()
    .eq("user_id", userId)
    .eq("provider", req.params.provider);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, provider: req.params.provider, configured: false });
});
