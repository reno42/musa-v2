// Worker entry — Futuraria Design (migración híbrida desde Netlify)
// MCP + OAuth + endpoints rápidos: nativo en Worker (rápido, barato)
// /api/* (express app): proxy transparente a Netlify hasta reescritura
// Resto: static assets de CF (ilimitado, no consume cuota)

import { handler as mcpHandler } from "../netlify/functions/mcp.mjs";
import { handler as renderHandler } from "../netlify/functions/render.mjs";
import { handler as keysHandler } from "../netlify/functions/keys.mjs";
import { handler as oauthAuthorize } from "../netlify/functions/oauth-authorize.mjs";
import { handler as oauthRegister } from "../netlify/functions/oauth-register.mjs";
import { handler as oauthToken } from "../netlify/functions/oauth-token.mjs";
import { handler as quiverStream } from "../netlify/functions/quiver-stream.mjs";
import apiApp from "./api-entry.js";


// ── Adapter: Request (Worker) → evento estilo Netlify ──
async function toNetlifyEvent(request, url) {
  const headers = {};
  request.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });

  let body = null;
  let isBase64Encoded = false;
  if (request.method !== "GET" && request.method !== "HEAD") {
    const ct = headers["content-type"] || "";
    if (ct.includes("application/json") || ct.includes("text/") || ct.includes("javascript")) {
      body = await request.text();
    } else {
      const buf = await request.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      }
      body = btoa(bin);
      isBase64Encoded = true;
    }
  }

  return {
    httpMethod: request.method,
    headers,
    queryStringParameters: Object.fromEntries(url.searchParams),
    body,
    isBase64Encoded,
    url: url.href,
    path: url.pathname,
  };
}

// ── Adapter: respuesta Netlify → Response (Worker) ──
function fromNetlifyResponse(res) {
  if (!res) return new Response("Internal error", { status: 500 });
  const headers = new Headers();
  for (const [k, v] of Object.entries(res.headers || {})) {
    try { headers.set(k, v); } catch { /* skip */ }
  }
  let body = res.body ?? "";
  if (res.isBase64Encoded && typeof body === "string") {
    const bin = atob(body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Response(bytes, { status: res.statusCode || 200, headers });
  }
  return new Response(body, { status: res.statusCode || 200, headers });
}

async function callHandler(handler, event) {
  const out = await handler(event, { getRemainingTimeInMillis: () => 30000 });
  if (out instanceof Response) return out;
  return fromNetlifyResponse(out);
}

// ── Routing ──
const routes = [
  { pattern: /^\/mcp$/, handler: mcpHandler },
  { pattern: /^\/api\/render(\/|$)/, handler: renderHandler },
  { pattern: /^\/api\/templates\/[^/]+\/render(\/|$)/, handler: renderHandler },
  { pattern: /^\/api\/keys(\/|$)/, handler: keysHandler },
  { pattern: /^\/api\/quiver(\/|$)/, handler: quiverStream },
  { pattern: /^\/oauth\/register$/, handler: oauthRegister },
  { pattern: /^\/oauth\/authorize$/, handler: oauthAuthorize },
  { pattern: /^\/oauth\/token$/, handler: oauthToken },
];

// ── Self-fetch loopback (fix 522/523 en publish_content y tools afines) ──
// El MCP hace callWorkspaceApi -> fetch(`${process.env.URL}/api/...`) hacia SU
// PROPIO host. En Cloudflare ese fetch sale al edge y muere (522/523: el
// worker no puede alcanzarse a sí mismo como origin HTTP). Fix: interceptar
// globalThis.fetch — si el destino es el propio worker, despachar la Request
// DIRECTO al express-shim (apiApp) sin tocar la red.
let loopbackPatched = false;
const selfHosts = new Set();
function patchLoopback(env) {
  if (loopbackPatched) return;
  loopbackPatched = true;
  try { if (process.env.URL) selfHosts.add(new URL(process.env.URL).host); } catch {}
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    try {
      const u = new URL(typeof input === "string" ? input : input.url);
      // Loopback = cualquier host servido por este worker (URL secret, custom
      // domains, workers.dev). Solo interceptamos /api/* y /mcp: lo demás no
      // se auto-llama.
      const isApi = u.pathname.startsWith("/api/") || u.pathname === "/mcp";
      if (isApi && selfHosts.has(u.host)) {
        const req = new Request(u.href, input instanceof Request ? input : init);
        return apiApp.fetch(req, env, {});
      }
    } catch { /* URL rara: dejar pasar */ }
    return realFetch(input, init);
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    patchLoopback(env);
    // Registrar TODOS los hosts propios (el secret URL y el host con el que
    // llegó el request): cualquier variante debe resolver como loopback.
    try { if (process.env.URL) { const h = new URL(process.env.URL).host; selfHosts.add(h); } } catch {}
    try { selfHosts.add(url.host); } catch {}

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key, Mcp-Session-Id",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    if (url.pathname === "/worker-health") {
      return Response.json({ ok: true, ts: Date.now() });
    }

    try {
      for (const r of routes) {
        if (r.pattern.test(url.pathname)) {
          const event = await toNetlifyEvent(request, url);
          return await callHandler(r.handler, event);
        }
      }

      // /api/* restante → express app vía shim (100% Cloudflare, sin Netlify)
      if (url.pathname.startsWith("/api/")) {
        return apiApp.fetch(request, env, ctx);
      }

      // /.well-known/* → discovery OAuth público (antes caía en la app Express
      // y respondía 401 — los clientes MCP no podían descubrir el login).
      // Issuer dinámico: el host con el que el cliente llegó (workers.dev hoy,
      // dominio propio mañana). Cuerpo espejo de public/.well-known.
      if (url.pathname === "/.well-known/oauth-authorization-server") {
        return Response.json({
          issuer: url.origin,
          authorization_endpoint: `${url.origin}/oauth/authorize`,
          token_endpoint: `${url.origin}/oauth/token`,
          registration_endpoint: `${url.origin}/oauth/register`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
          scopes_supported: ["design.read", "design.write"],
          service_documentation: `${url.origin}/docs/`,
        }, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } });
      }
      if (url.pathname === "/.well-known/oauth-protected-resource") {
        return Response.json({
          resource: `${url.origin}/mcp`,
          authorization_servers: [url.origin],
          scopes_supported: ["design.read", "design.write"],
          bearer_methods_supported: ["header"],
          resource_documentation: `${url.origin}/SKILL.md`,
        }, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } });
      }
      if (url.pathname.startsWith("/.well-known/")) {
        // resto (mcp.json, robots.txt): estático, igual que Netlify
        return env.ASSETS.fetch(request);
      }

    } catch (err) {
      console.error("[worker]", url.pathname, err);
      return Response.json(
        { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Internal error: " + (err?.message || err) } },
        { status: 500, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    return env.ASSETS.fetch(request);
  },
};
