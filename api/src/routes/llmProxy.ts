import { Router } from "express";
import { getSupabaseAdmin } from "../services/supabase.js";
import { PROVIDER_ENDPOINTS } from "../../../netlify/functions/musa-batch-core.mjs";
import { getUserKey } from "../../../netlify/functions/keys.mjs";

// ── Proxy LLM same-origin (/api/llm) ─────────────────────────────────────────
// Por qué existe: varios proveedores (z.ai verificado con preflight sin
// Access-Control-Allow-Origin; Anthropic necesita header especial) no aceptan
// fetch directo del navegador, y el modelo BYOK anterior exigía bajar la key
// descifrada al cliente. Este relay autentica al usuario, lee la key
// DESCIFRADA server-side (getUserKey — la key nunca llega al browser) y
// reenvía el body verbatim al endpoint del proveedor.
//
// Cloudflare: /api/llm no está en la tabla de rutas del worker
// (worker/index.js solo intercepta /mcp, /api/render, /api/keys, /api/quiver,
// /oauth/*) → cae al fallback Express vía express-shim, igual que local.
// Sin APIs de node:crypto ni undici: solo fetch global — workerd-compatible.
export const llmProxyRoutes = Router();

/** Bearer JWT → user id (null si inválido), mismo contrato que keysStub. */
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

llmProxyRoutes.post("/", async (req, res) => {
  const userId = await authenticate(req);
  if (!userId) return res.status(401).json({ error: "Authentication required." });

  const provider = String(req.body?.provider || "");
  const endpoint = (PROVIDER_ENDPOINTS as Record<string, string>)[provider];
  if (!endpoint) return res.status(400).json({ error: `Proveedor desconocido: ${provider || "(vacío)"}` });

  // Key: opcional en el request (superficies legacy con key en localStorage,
  // p.ej. ChatTab); si no viene, se lee la BYOK DESCIFRADA del server.
  const clientKey = String(req.body?.key || "").trim();
  let key = clientKey;
  if (!key) {
    const owned = await getUserKey(userId, provider);
    key = owned.key || "";
  }
  if (!key) return res.status(404).json({ error: `No key configured for ${provider}` });

  const body = req.body?.body;
  if (!body || typeof body !== "object") return res.status(400).json({ error: "Missing 'body' (payload del proveedor)." });
  // GLM-5.3 piensa por defecto y devora el presupuesto antes del JSON: si el
  // cliente no pidió explícitamente otro modo, thinking off para zhipu.
  if (provider === "zhipu" && !body.thinking) body.thinking = { type: "disabled" };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (provider === "anthropic") {
    headers["x-api-key"] = key;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers["Authorization"] = `Bearer ${key}`;
  }

  let upstream: Response;
  try {
    upstream = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
  } catch (e: any) {
    return res.status(502).json({ error: `No se pudo contactar ${provider}: ${String(e?.message || e).slice(0, 160)}` });
  }

  // SSE (stream:true) → pipe en vivo; resto → JSON buffer.
  const ct = upstream.headers.get("content-type") || "";
  if (ct.includes("text/event-stream") && upstream.body) {
    res.status(upstream.status);
    res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    const reader = upstream.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    } catch {
      /* cliente cerró o upstream cortó: el catch evita unhandled */
    }
    res.end();
    return;
  }

  const text = await upstream.text();
  res.status(upstream.status);
  if (ct.includes("application/json")) {
    res.setHeader("Content-Type", ct);
    res.send(text);
  } else {
    res.type("text/plain").send(text);
  }
});
