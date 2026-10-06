import { Router } from "express";
import { getSupabaseAdmin } from "../services/supabase.js";
import { PROVIDER_ENDPOINTS } from "../../../netlify/functions/musa-batch-core.mjs";
import { getUserKey } from "../../../netlify/functions/keys.mjs";
import { pickPlatformLlm } from "../../../netlify/functions/ghostLlmChain.mjs";
import { peekQuota, platformFreeRunLimit } from "../../../netlify/functions/quota.mjs";

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

  // REQ-028 Item 1 — CAPA PLATAFORMA del Ghost: body.tier === "platform" ⇒ la
  // key la pone el SERVER (env OPENROUTER_API_KEY/ZHIPU_API_KEY vía
  // pickPlatformLlm — la MISMA cadena que el gate de ghost_perform), nunca la
  // BYOK del usuario. El server es autoridad: provider/model se toman del
  // pick, así si la env cambia entre accept y run manda la env actual.
  const wantsPlatform = req.body?.tier === "platform";
  let provider = String(req.body?.provider || "");
  let endpoint = (PROVIDER_ENDPOINTS as Record<string, string>)[provider];
  let platformHeaders: Record<string, string> | null = null;
  let platformModel = "";
  // REQ-028 Item 2.6: cuota restante del mes — viaja en X-Musa-Quota-Remaining
  // en TODAS las respuestas de la capa plataforma (SSE y JSON).
  let quotaRemaining: number | null = null;
  if (wantsPlatform) {
    const platform = pickPlatformLlm(PROVIDER_ENDPOINTS);
    if (!platform) {
      // El token en el cuerpo lo clasifica ghostPreflight como
      // PLATFORM_LLM_UNAVAILABLE (config del operador, no culpa del usuario).
      return res.status(503).json({ error: "PLATFORM_LLM_UNAVAILABLE: el server no tiene ZHIPU_API_KEY ni OPENROUTER_API_KEY." });
    }
    // REQ-028 Item 2 — check de cuota ANTES de relayar con la key del server.
    // El COBRO fue 1× en el gate de ghost_perform (por RUN, req §2-Item 2.4);
    // acá es check-only: los ~25 micro-pasos del bridge no vuelven a pagar.
    // Fail-closed (Item 2.5): DB caída ⇒ 503 técnico, nunca cuota infinita.
    const peek = await peekQuota(getSupabaseAdmin(), userId, platformFreeRunLimit());
    if (!peek) {
      return res.status(503).json({ error: "PLATFORM_LLM_UNAVAILABLE: no se pudo verificar la cuota (error técnico de base de datos)." });
    }
    if (!peek.ok) {
      // El token en el cuerpo lo clasifica el bridge como FREEMIUM_QUOTA_EXHAUSTED.
      return res.status(402).json({ error: `FREEMIUM_QUOTA_EXHAUSTED: cuota gratis agotada (${peek.used}/${peek.limit}) este mes. Subí tu llave en Configuración → Invita IAs para uso ilimitado.` });
    }
    quotaRemaining = peek.remaining;
    provider = platform.provider;
    endpoint = platform.endpoint;
    platformHeaders = platform.headers; // incluye la Authorization de la env — jamás se loguea
    platformModel = platform.model;
  }
  if (!endpoint) return res.status(400).json({ error: `Proveedor desconocido: ${provider || "(vacío)"}` });

  const body = req.body?.body;
  if (!body || typeof body !== "object") return res.status(400).json({ error: "Missing 'body' (payload del proveedor)." });
  // GLM-5.3 piensa por defecto y devora el presupuesto antes del JSON: si el
  // cliente no pidió explícitamente otro modo, thinking off para zhipu.
  if (provider === "zhipu" && !body.thinking) body.thinking = { type: "disabled" };

  let headers: Record<string, string>;
  if (platformHeaders) {
    // La key (env) ya viaja en los headers del pick — NUNCA se loguea.
    headers = { ...platformHeaders };
    // Modelo autoritativo del server (el aceptado por el gate de ghost_perform).
    body.model = platformModel;
  } else {
    // Key: opcional en el request (superficies legacy con key en localStorage,
    // p.ej. ChatTab); si no viene, se lee la BYOK DESCIFRADA del server.
    const clientKey = String(req.body?.key || "").trim();
    let key = clientKey;
    if (!key) {
      const owned = await getUserKey(userId, provider);
      key = owned.key || "";
    }
    if (!key) return res.status(404).json({ error: `No key configured for ${provider}` });

    headers = { "Content-Type": "application/json" };
    if (provider === "anthropic") {
      headers["x-api-key"] = key;
      headers["anthropic-version"] = "2023-06-01";
    } else {
      headers["Authorization"] = `Bearer ${key}`;
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
  } catch (e: any) {
    return res.status(502).json({ error: `No se pudo contactar ${provider}: ${String(e?.message || e).slice(0, 160)}` });
  }

  // A-02: an upstream rejection never travels verbatim to the client —
  // providers (DeepSeek, seen in QA) embed masked API-key fragments in their
  // 4xx bodies and the chat rendered them as-is. Log the detail server-side
  // (key-like tokens redacted) and answer with a generic, actionable error.
  if (upstream.status >= 400) {
    const detail = await upstream.text().catch(() => "");
    console.error(
      `[llmProxy] ${provider} upstream ${upstream.status}:`,
      detail.replace(/sk-[A-Za-z0-9_-]+/g, "sk-***").slice(0, 400)
    );
    return res.status(upstream.status).json({
      error: `El proveedor ${provider} rechazó la request (HTTP ${upstream.status}). Revisá la clave del proveedor en Configuración.`,
    });
  }

  // SSE (stream:true) → pipe en vivo; resto → JSON buffer.
  const ct = upstream.headers.get("content-type") || "";
  if (ct.includes("text/event-stream") && upstream.body) {
    // Cloudflare: el shim puede devolver la Response nativa. Reutilizar el
    // ReadableStream evita acumular todo el SSE en memoria y entrega el primer
    // token al browser apenas llega del proveedor.
    if (typeof (res as any).webResponse === "function") {
      const streamHeaders = new Headers({
        "Content-Type": ct,
        "Cache-Control": "no-cache",
      });
      if (quotaRemaining != null) streamHeaders.set("X-Musa-Quota-Remaining", String(quotaRemaining));
      return (res as any).webResponse(new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: streamHeaders,
      }));
    }

    // Express local/Node: conserva el streaming tradicional.
    res.status(upstream.status);
    res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    if (quotaRemaining != null) res.setHeader("X-Musa-Quota-Remaining", String(quotaRemaining));
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
  if (quotaRemaining != null) res.setHeader("X-Musa-Quota-Remaining", String(quotaRemaining));
  if (ct.includes("application/json")) {
    res.setHeader("Content-Type", ct);
    res.send(text);
  } else {
    res.type("text/plain").send(text);
  }
});
