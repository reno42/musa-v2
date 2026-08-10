/**
 * Provider keys — stored encrypted, server-side, and never handed back.
 *
 * GET    /api/chat/keys            which providers are configured (last 4 only)
 * PUT    /api/chat/keys            store or rotate one
 * DELETE /api/chat/keys/:provider  remove one
 * POST   /api/chat/llm             proxy a completion using the stored key
 *
 * The proxy is the point. A key that the browser can read is a key an
 * extension, an XSS, or anyone holding the laptop can read — so the browser
 * never receives it. It asks this endpoint for a completion; this endpoint
 * decrypts, calls the provider, and streams the answer back. Backend for
 * Frontend, and the credential stays on one side of it.
 */

import { Router } from "express";
import { asyncRoute } from "../middleware/asyncRoute.js";
import { getSupabaseAdmin } from "../services/supabase.js";
import { encryptWorkspaceSecret, decryptWorkspaceSecret } from "../services/secrets.js";

export const providerKeyRoutes = Router();

/**
 * Where each provider's completions live, and how it wants to be authenticated.
 * Kept here rather than taken from the request: a caller-supplied URL would
 * turn this proxy into an open relay for the stored credential.
 */
const PROVIDERS: Record<string, {
  url: string;
  auth: (key: string) => Record<string, string>;
}> = {
  deepseek: {
    url: "https://api.deepseek.com/chat/completions",
    auth: key => ({ Authorization: `Bearer ${key}` }),
  },
  openai: {
    url: "https://api.openai.com/v1/chat/completions",
    auth: key => ({ Authorization: `Bearer ${key}` }),
  },
  anthropic: {
    url: "https://api.anthropic.com/v1/messages",
    auth: key => ({ "x-api-key": key, "anthropic-version": "2023-06-01" }),
  },
  groq: {
    url: "https://api.groq.com/openai/v1/chat/completions",
    auth: key => ({ Authorization: `Bearer ${key}` }),
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1/chat/completions",
    auth: key => ({ Authorization: `Bearer ${key}` }),
  },
  google: {
    // Gemini takes the key on the query string; the model is part of the path,
    // so the URL is completed per request below.
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    auth: () => ({}),
  },
};

function requireUser(req: any, res: any): string | null {
  const userId = req.auth?.userId;
  if (!userId || req.auth?.authType !== "user") {
    res.status(401).json({ success: false, error: "Necesitas iniciar sesión" });
    return null;
  }
  return userId;
}

const dbOr503 = (res: any) => {
  // Service role deliberately: this table is never read through the browser's
  // own connection, so nothing can select the ciphertext client-side.
  const sb = getSupabaseAdmin();
  if (!sb) { res.status(503).json({ success: false, error: "Supabase no está configurado" }); return null; }
  return sb;
};

function isMissingTable(error: unknown): boolean {
  const err = error as { code?: string; message?: string } | null;
  if (err?.code === "PGRST205" || err?.code === "42P01") return true;
  const message = String(err?.message ?? "").toLowerCase();
  return message.includes("user_provider_keys")
    && (message.includes("schema cache") || message.includes("does not exist"));
}

const SETUP_MESSAGE =
  "Falta crear la tabla de llaves. Ejecuta supabase_migrations_v24.sql y recarga "
  + "el esquema (Settings → API → Reload schema cache).";

function guarded(fn: (req: any, res: any) => Promise<unknown>) {
  return asyncRoute(async (req: any, res: any) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (isMissingTable(err)) {
        if (req.method === "GET") return res.json({ success: true, data: [], setupRequired: true });
        return res.status(503).json({ success: false, error: SETUP_MESSAGE, setupRequired: true });
      }
      throw err;
    }
  });
}

/** Which providers this user has configured. Never the key itself. */
providerKeyRoutes.get("/keys", guarded(async (req, res) => {
  const userId = requireUser(req, res); if (!userId) return;
  const sb = dbOr503(res); if (!sb) return;
  const { data, error } = await sb.from("user_provider_keys")
    .select("provider, last4, updated_at").eq("user_id", userId);
  if (error) throw error;
  res.json({ success: true, data: data || [] });
}));

providerKeyRoutes.put("/keys", guarded(async (req, res) => {
  const userId = requireUser(req, res); if (!userId) return;
  const sb = dbOr503(res); if (!sb) return;

  const provider = String(req.body?.provider || "").trim().toLowerCase();
  const key = String(req.body?.key || "").trim();
  if (!PROVIDERS[provider]) {
    return res.status(400).json({ success: false, error: `Proveedor desconocido: ${provider}` });
  }
  if (key.length < 8) {
    return res.status(400).json({ success: false, error: "Esa llave es demasiado corta" });
  }

  const { error } = await sb.from("user_provider_keys").upsert({
    user_id: userId,
    provider,
    key_cipher: encryptWorkspaceSecret(key),
    last4: key.slice(-4),
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
  // The response says which key landed, never the key. Rotation is an upsert:
  // the previous ciphertext is gone the moment this returns.
  res.json({ success: true, provider, last4: key.slice(-4) });
}));

providerKeyRoutes.delete("/keys/:provider", guarded(async (req, res) => {
  const userId = requireUser(req, res); if (!userId) return;
  const sb = dbOr503(res); if (!sb) return;
  const { error } = await sb.from("user_provider_keys")
    .delete().eq("user_id", userId).eq("provider", String(req.params.provider).toLowerCase());
  if (error) throw error;
  res.json({ success: true });
}));

/** Reads and decrypts one key. Never leaves this module. */
async function keyFor(sb: any, userId: string, provider: string): Promise<string | null> {
  const { data, error } = await sb.from("user_provider_keys")
    .select("key_cipher").eq("user_id", userId).eq("provider", provider).maybeSingle();
  if (error) throw error;
  if (!data?.key_cipher) return null;
  try {
    return decryptWorkspaceSecret<string>(data.key_cipher);
  } catch {
    // A key encrypted under a rotated server secret cannot be recovered, and
    // saying so beats a confusing 401 from the provider.
    throw new Error("No se pudo descifrar la llave guardada. Vuelve a ingresarla.");
  }
}

/**
 * Completion proxy. The browser sends messages and a model; this adds the
 * credential and forwards. The upstream URL comes from the table above and
 * never from the request — otherwise this would relay the stored key anywhere
 * a caller pointed it.
 */
providerKeyRoutes.post("/llm", guarded(async (req, res) => {
  const userId = requireUser(req, res); if (!userId) return;
  const sb = dbOr503(res); if (!sb) return;

  const provider = String(req.body?.provider || "").trim().toLowerCase();
  const spec = PROVIDERS[provider];
  if (!spec) return res.status(400).json({ success: false, error: `Proveedor desconocido: ${provider}` });

  const key = await keyFor(sb, userId, provider);
  if (!key) {
    return res.status(412).json({
      success: false,
      needsKey: provider,
      error: `No hay una llave de ${provider} guardada en tu cuenta. Agrégala en la configuración del chat.`,
    });
  }

  const { provider: _p, ...payload } = req.body || {};
  let url = spec.url;
  let body = payload;
  if (provider === "google") {
    const model = String(payload.model || "gemini-2.5-flash");
    url = `${spec.url}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
    const { model: _m, ...rest } = payload;
    body = rest;
  }

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...spec.auth(key) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    const text = await upstream.text();
    // Passed through as-is so the client keeps the provider's own error
    // shapes, which the agent runtime already knows how to read. The key is
    // not in any of them.
    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
    res.send(text);
  } catch (err: any) {
    const message = err?.name === "TimeoutError"
      ? "El proveedor no respondió a tiempo"
      : err?.message || "No se pudo contactar al proveedor";
    // Never echo the request: it would put the key in a log line.
    console.error(`[llm] ${provider} failed for user ${userId.slice(0, 8)}: ${message}`);
    res.status(502).json({ success: false, error: message });
  }
}));
