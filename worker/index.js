// Worker entry — Futuraria Design en Cloudflare Workers.
// MCP, OAuth y API comparten el mismo runtime; los estáticos se sirven desde ASSETS.

import { handler as mcpHandler } from "./runtime/functions/mcp.mjs";
import { handler as renderHandler } from "./runtime/functions/render.mjs";
import { handler as keysHandler } from "./runtime/functions/keys.mjs";
// REQ-058 — Tomas de video: grabación en navegador → R2 presigned (24 h TTL).
// Todos los endpoints bajo /api/video-takes; el handler autentica con el JWT
// y las RPC de v84 aplican RLS + cupo server-side.
import { handler as videoTakesHandler } from "./runtime/functions/video-takes.mjs";
// REQ-059 — AI Clones: proxy HeyGen v3. La BYOK se lee cifrada server-side
// (getUserKey) y jamás baja al browser; api.heygen.com tampoco es destino
// fiable desde el navegador (CORS), por eso existe esta ruta propia.
import { handler as heygenHandler } from "./runtime/functions/heygen.mjs";
import { handler as oauthAuthorize } from "./runtime/functions/oauth-authorize.mjs";
import { handler as oauthRegister } from "./runtime/functions/oauth-register.mjs";
import { handler as oauthToken } from "./runtime/functions/oauth-token.mjs";
import { handler as quiverStream } from "./runtime/functions/quiver-stream.mjs";
import { handler as musaBatchBackground } from "./runtime/functions/musa-batch-background.mjs";
import { handler as imageSegmentBackground } from "./runtime/functions/image-segment-background.mjs";
import apiApp from "./api-entry.js";
// Webhook dispatch sweep — imports the SAME service the Express app
// uses (esbuild resuelve .js → .ts). Sin self-HTTP: el cron corre el
// sweep en el mismo isolate (barato y sin depender de que /api/*
// responda a sí mismo).
import { sweepWebhookDeliveries } from "../api/src/services/webhooks.js";
import { getSupabaseAdmin } from "../api/src/services/supabase.js";
// Mantenimiento nightly (respaldos + barrido de papelera) — mismo patrón
// que el sweep de webhooks: corre en el isolate del cron, con kill
// switches propias (BACKUPS_ENABLED / ORPHAN_SWEEP_ENABLED).
import { runNightlyMaintenance } from "../api/src/services/platformMaintenance.js";
// REQ-051 — ingesta de Research (fuentes RSS/Nitter vencidas → tarjetas).
// Mismo contrato que el sweep de webhooks: corre en el isolate del cron,
// kill switch propia (RESEARCH_INGEST_ENABLED), fail-open por fuente.
import { ingestDueSources } from "./runtime/functions/research-ingest.mjs";


// ── Adapter: Request del Worker → contrato de handlers ──
async function toWorkerEvent(request, url) {
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

// ── Adapter: respuesta de handler → Response del Worker ──
function fromWorkerResponse(res) {
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
  // Contrato del handler: context.waitUntil. En Cloudflare el waitUntil real vive en el
  // ctx del fetch handler (puenteado a __musaWaitUntil arriba) — lo exponemos
  // acá para que los handlers (mcp → flows wake REQ-040) lo reciban estándar.
  // En Node/long-lived no hay puente: el handler cae a promesa flotante.
  const ctx = { getRemainingTimeInMillis: () => 30000 };
  if (typeof globalThis.__musaWaitUntil === "function") ctx.waitUntil = globalThis.__musaWaitUntil;
  const out = await handler(event, ctx);
  if (out instanceof Response) return out;
  return fromWorkerResponse(out);
}

// ── Routing ──
const routes = [
  { pattern: /^\/mcp$/, handler: mcpHandler },
  { pattern: /^\/api\/render(\/|$)/, handler: renderHandler },
  { pattern: /^\/api\/templates\/[^/]+\/render(\/|$)/, handler: renderHandler },
  { pattern: /^\/api\/keys(\/|$)/, handler: keysHandler },
  { pattern: /^\/api\/video-takes(\/|$)/, handler: videoTakesHandler },
  { pattern: /^\/api\/heygen(\/|$)/, handler: heygenHandler },
  { pattern: /^\/api\/quiver(\/|$)/, handler: quiverStream },
  { pattern: /^\/api\/musa-batch-background(\/|$)/, handler: musaBatchBackground, background: true },
  { pattern: /^\/api\/image-segment-background(\/|$)/, handler: imageSegmentBackground, background: true },
  { pattern: /^\/oauth\/register$/, handler: oauthRegister },
  { pattern: /^\/oauth\/authorize$/, handler: oauthAuthorize },
  { pattern: /^\/oauth\/token$/, handler: oauthToken },
];

// ── Caché de lectura pública del guest share (/c/:templateId) ──
// El GET /api/comments-share/:templateId es anónimo e idéntico para todos:
// se sirve desde caches.default (TTL 2 min que pone la propia ruta). El
// payload NO cambia solo: cualquier mutación del template (save/delete del
// editor en /api/templates/:id) o comentario invitado purga el URL en los
// hosts conocidos. Staleness máximo si algo se escapa (MCP writes): 2 min.
const SHARE_CACHE_RE = /^\/api\/comments-share\/([^/?#]+)$/;
const SHARE_PURGE_RE = /^\/api\/(?:templates|comments-share)\/([^/?#]+)/;

function shareCache() {
  return (typeof caches !== "undefined" && caches && caches.default) || null;
}

function purgeGuestShare(requestHost, templateId, ctx) {
  const cache = shareCache();
  if (!cache) return;
  const hosts = new Set([requestHost]);
  try { if (process.env.URL) hosts.add(new URL(process.env.URL).host); } catch {}
  const work = Promise.all([...hosts].map((h) =>
    cache.delete(`https://${h}/api/comments-share/${templateId}`, { ignoreMethod: true })
  )).catch(() => {});
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(work);
  else if (typeof globalThis.__musaWaitUntil === "function") globalThis.__musaWaitUntil(work);
  else void work;
}

async function dispatchBackground(route, request, url, ctx) {
  const event = await toWorkerEvent(request, url);
  const work = callHandler(route.handler, event).catch((error) => {
    console.error("[worker background]", url.pathname, error);
  });
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(work);
  else if (typeof globalThis.__musaWaitUntil === "function") globalThis.__musaWaitUntil(work);
  else void work;
  return Response.json({ accepted: true }, { status: 202 });
}

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
        const backgroundRoute = routes.find((route) => route.background && route.pattern.test(u.pathname));
        if (backgroundRoute) return dispatchBackground(backgroundRoute, req, u, null);
        return apiApp.fetch(req, env, {});
      }
      // v60 — self-fetch de ESTÁTICOS (get_playbook → /docs/*.md): mismo 522
      // que mataba /api/* — el worker no puede alcanzarse a sí mismo como
      // origin. El binding ASSETS responde por pathname, sin red.
      if (u.pathname.startsWith("/docs/") && selfHosts.has(u.host) && env.ASSETS) {
        return env.ASSETS.fetch(new Request(u.href, { method: "GET" }));
      }
    } catch { /* URL rara: dejar pasar */ }
    return realFetch(input, init);
  };
}

// (Rate limit de SSE retirado 18-sep: el GET /mcp ahora responde 405 definitivo,
// no hay stream que proteger. Historia: un Cursor en loop quemó 100k req/día.)

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    patchLoopback(env);
    // Registrar TODOS los hosts propios (el secret URL y el host con el que
    // llegó el request): cualquier variante debe resolver como loopback.
    try { if (process.env.URL) { const h = new URL(process.env.URL).host; selfHosts.add(h); } } catch {}
    try { selfHosts.add(url.host); } catch {}

    // waitUntil bridge — permite que el servicio de webhooks extienda la
    // entrega DESPUÉS de la respuesta (el shim Express no expone ctx).
    // En Node/long-lived el servicio cae a promesa flotante normal.
    if (ctx && typeof ctx.waitUntil === "function") {
      globalThis.__musaWaitUntil = ctx.waitUntil.bind(ctx);
    }

    // Guard ANTI-LOOP: GET /mcp (transporte SSE viejo, opcional en la spec MCP).
    // 17-sep: un Cursor en servidor remoto lo abría en bucle (~4 req/s, 350k/día)
    // y quemó el límite free de 100k antes de las 8am. Solución definitiva: NO
    // soportar el GET — 405 con Allow: POST es una respuesta DEFINITIVA que los
    // clientes respetan (no disparan reintentos como un 404/timeout). El
    // transporte real de Musa es Streamable HTTP (POST /mcp), el estándar actual.
    if (url.pathname === "/mcp" && request.method === "GET") {
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32000,
          message: "SSE transport (GET /mcp) is not supported. This server only accepts Streamable HTTP: send JSON-RPC via POST to this same URL. Update your client's MCP transport from SSE to HTTP/Streamable.",
        },
      }), {
        status: 405,
        headers: {
          "Content-Type": "application/json",
          "Allow": "POST",
          "Access-Control-Allow-Origin": "*",
          // Sin Retry-After a propósito: no es "vuelve luego", es "este camino no existe".
        },
      });
    }

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
          if (r.background) return dispatchBackground(r, request, url, ctx);
          const event = await toWorkerEvent(request, url);
          return await callHandler(r.handler, event);
        }
      }

      // /api/* restante → express app vía shim dentro del mismo Worker
      if (url.pathname.startsWith("/api/")) {
        // Guest share: caché de lectura (solo GET que responda 200 con
        // Cache-Control público) + purga en cualquier mutación del template.
        const cacheable = request.method === "GET" && SHARE_CACHE_RE.test(url.pathname);
        const cache = cacheable ? shareCache() : null;
        if (cache) {
          try {
            const hit = await cache.match(request.url);
            if (hit) return hit;
          } catch { /* cache API indisponible (dev): seguir sin caché */ }
        }
        if (request.method !== "GET" && request.method !== "HEAD") {
          const m = url.pathname.match(SHARE_PURGE_RE);
          if (m) purgeGuestShare(url.host, m[1], ctx);
        }
        const res = await apiApp.fetch(request, env, ctx);
        if (cache && res.status === 200 && /public/.test(res.headers.get("cache-control") || "")) {
          try {
            const put = cache.put(request.url, res.clone()).catch(() => {});
            if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(put);
            else if (typeof globalThis.__musaWaitUntil === "function") globalThis.__musaWaitUntil(put);
            else void put;
          } catch { /* sin cachear: la respuesta igual llega al invitado */ }
        }
        return res;
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
        // resto (mcp.json, robots.txt): asset estático
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

  // ── Cron trigger (wrangler.toml [triggers]): dispatch sweep ──
  // Entrega webhooks pendientes y reintenta fallidos con backoff
  // (1m → 5m → 30m → 2h → 6h, máx 5 intentos). Tres kill switches
  // ANTES de ejecutar, mismo contrato que el tick del batch:
  //   1. WEBHOOK_DISPATCH_SECRET unset → webhooks apagados (no-op).
  //   2. WEBHOOKS_TICK_ENABLED=false → off de emergencia.
  //   3. Demand check: cero entregas vencidas → skip (fail-open).
  // NOTA (decisión de producto): el server NO agenda flows. Los horarios
  // los ejecuta la IA del usuario desde su propio runtime: consulta
  // flow_due_check y llama flow_run con requestId cron:<flowId>:<slot>.
  async scheduled(controller, env, ctx) {
    // ── Mantenimiento nightly (respaldos + papelera) ──
    // AFUERA de los guards de webhooks a propósito: el plan free no configura
    // WEBHOOK_DISPATCH_SECRET y los respaldos no pueden depender de eso.
    // Kill switches propias adentro, cada paso fail-open (un bug acá JAMÁS
    // tumba la API). Tick silencioso ≈ 1-2 queries; solo loguea cuando algo
    // pasó de verdad (respaldo ok/error, papelera con purgas o error).
    try {
      const maint = await runNightlyMaintenance(new Date());
      const b = maint.backup || {};
      const s = maint.trashSweep || {};
      const interesting = b.status === "ok" || b.status === "error"
        || s.status === "error" || (s.purged || 0) > 0;
      if (interesting) console.log("[maintenance-cron]", JSON.stringify(maint));
    } catch (e) {
      console.error(`[maintenance-cron] fatal: ${e?.message || e}`);
    }

    // ── Research ingest sweep (REQ-051) ──
    // Fuentes RSS/Nitter vencidas → tarjetas del pane Research. INDEPENDIENTE
    // de los guards de webhooks a propósito (misma razón que el mantenimiento
    // nightly: el plan free no configura WEBHOOK_DISPATCH_SECRET). Kill
    // switch propia; fail-open total — un bug acá JAMÁS tumba la API.
    if (process.env.RESEARCH_INGEST_ENABLED === "false") {
      console.log("[research-cron] skipped: RESEARCH_INGEST_ENABLED=false");
    } else {
      try {
        const sbAdmin = getSupabaseAdmin();
        if (!sbAdmin) {
          console.log("[research-cron] skipped: Supabase no configurado");
        } else {
          const result = await ingestDueSources(sbAdmin);
          if (result.refreshed > 0 || result.errors.length > 0) {
            console.log(`[research-cron] sweep: ${result.refreshed} fuentes, +${result.added} items, ${result.errors.length} errores`);
          }
        }
      } catch (e) {
        console.error(`[research-cron] fatal: ${e?.message || e}`);
      }
    }

    const secret = process.env.WEBHOOK_DISPATCH_SECRET;
    if (!secret) {
      console.log("[webhooks-cron] skipped: WEBHOOK_DISPATCH_SECRET no configurado");
      return;
    }
    if (process.env.WEBHOOKS_TICK_ENABLED === "false") {
      console.log("[webhooks-cron] skipped: WEBHOOKS_TICK_ENABLED=false");
      return;
    }

    // Demand check — fail-open: si la DB no responde, ejecutamos igual.
    try {
      const sb = getSupabaseAdmin();
      if (sb) {
        const now = new Date().toISOString();
        const { count, error } = await sb.from("platform_webhook_deliveries")
          .select("id", { count: "exact", head: true })
          .in("status", ["pending", "failed"])
          .lt("attempts", 5)
          .lte("next_attempt_at", now);
        if (!error && (count || 0) === 0) {
          console.log("[webhooks-cron] skipped: nada vencido");
          return;
        }
      }
    } catch (e) {
      console.warn(`[webhooks-cron] demand check failed (fail-open → sweep): ${e?.message || e}`);
    }

    try {
      const result = await sweepWebhookDeliveries();
      console.log(`[webhooks-cron] sweep: ${result.processed} procesadas, ${result.delivered} ok, ${result.failed} fallidas`);
    } catch (e) {
      console.error(`[webhooks-cron] sweep error: ${e?.message || e}`);
    }
  },
};
