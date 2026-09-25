// Express-compatible shim para Workers (sobre Hono)
// Reusa las route files del repo (Router(), req/res de Express) sin reescribirlas.
// Subset soportado (el que la codebase usa):
//   app: use(path|mw, ...), get/post/put/patch/delete, __hono
//   Router(): get/post/put/patch/delete/use + __stack
//   req: params, query, body, headers, header(), method, path, originalUrl, socket
//   res: json(), send(), type(), write(), webResponse(), status(), setHeader(), end(), headersSent

import { Hono } from "hono";

// ── res ──
// El shim expone res.json()/status()/end() sincrónicos como Express, PERO las
// routes del repo envuelven handlers async con asyncRoute(): el wrapper retorna
// inmediatamente y escribe res.json() DESPUÉS, desde una promesa detached.
// Si el shim devolviera __result() al terminar el loop de handlers, esas
// respuestas saldrían 200-vacío (bug real de publish_content). Fix: makeRes
// expone `untilSent()` — una promesa que resuelve al primer write — y
// runHandlers/mount la esperan cuando ningún handler envió headers.
function makeRes() {
  const headers = new Headers();
  let status = 200;
  let sent = false;
  let body = null;
  let nativeResponse = null;
  const chunks = [];
  let wakeSent = () => {};
  const untilSent = new Promise((r) => { wakeSent = r; });

  const finish = (value) => {
    if (value !== undefined && value !== null) chunks.push(value);
    if (chunks.length > 0) body = joinBodyChunks(chunks);
    sent = true;
    wakeSent();
    return res;
  };

  const res = {
    get headersSent() { return sent; },
    setHeader(k, v) { headers.set(k, String(v)); return res; },
    status(code) { status = code; return res; },
    webResponse(response) {
      if (!(response instanceof Response)) throw new TypeError("webResponse requires a Response");
      nativeResponse = response;
      sent = true;
      wakeSent();
      return response;
    },
    type(value) {
      headers.set("content-type", resolveContentType(value));
      return res;
    },
    json(obj) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(obj);
      return finish();
    },
    send(value) {
      if (value === undefined || value === null) return finish();
      if (isBinaryChunk(value)) {
        if (!headers.has("content-type")) headers.set("content-type", "application/octet-stream");
        return finish(value);
      }
      if (typeof value === "object") return res.json(value);
      if (!headers.has("content-type")) headers.set("content-type", "text/html; charset=utf-8");
      return finish(String(value));
    },
    write(chunk, encoding, callback) {
      if (sent) throw new TypeError("write after end");
      if (chunk !== undefined && chunk !== null) chunks.push(chunk);
      const cb = typeof encoding === "function" ? encoding : callback;
      cb?.();
      return true;
    },
    end(chunk, encoding, callback) {
      const finalChunk = typeof chunk === "function" ? undefined : chunk;
      const cb = typeof chunk === "function" ? chunk : (typeof encoding === "function" ? encoding : callback);
      const result = finish(finalChunk);
      cb?.();
      return result;
    },
    __result() {
      if (nativeResponse) return nativeResponse;
      const responseBody = status === 204 || status === 205 || status === 304 ? null : body;
      return new Response(responseBody, { status, headers });
    },
    __untilSent: untilSent,
  };
  return res;
}

function isBinaryChunk(value) {
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value);
}

function joinBodyChunks(chunks) {
  if (chunks.every((chunk) => typeof chunk === "string")) return chunks.join("");

  const encoder = new TextEncoder();
  const byteChunks = chunks.map((chunk) => {
    if (typeof chunk === "string") return encoder.encode(chunk);
    if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
    if (ArrayBuffer.isView(chunk)) {
      return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    }
    throw new TypeError("response chunks must be strings, ArrayBuffers, or typed arrays");
  });
  const length = byteChunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of byteChunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

function resolveContentType(value) {
  const requested = String(value || "").trim();
  if (!requested) return "application/octet-stream";
  const aliases = {
    html: "text/html",
    json: "application/json",
    text: "text/plain",
    txt: "text/plain",
    xml: "application/xml",
  };
  const normalized = requested.replace(/^\./, "").toLowerCase();
  const mime = requested.includes("/") ? requested : (aliases[normalized] || "application/octet-stream");
  return mime.startsWith("text/") && !/;\s*charset=/i.test(mime)
    ? `${mime}; charset=utf-8`
    : mime;
}

/** Espera (con tope) a que un handler async-detached escriba la respuesta. */
async function settleIfUnsent(res) {
  if (res.headersSent) return;
  // Carrera: si el fn async escribe dentro de ~30s, usa ese resultado; si no,
  // devuelve el default (evita colgar el worker para siempre).
  const timeout = new Promise((r) => setTimeout(r, 30000).unref?.());
  await Promise.race([res.__untilSent, timeout]);
}

// ── req ──
function makeReq(c, params, body) {
  const url = new URL(c.req.url);
  return {
    method: c.req.method,
    path: c.req.path,
    originalUrl: c.req.path + (url.search || ""),
    params: params || {},
    query: Object.fromEntries(url.searchParams),
    headers: Object.fromEntries(c.req.raw.headers),
    header(name) { return c.req.header(name.toLowerCase()); },
    body,
    auth: undefined,
    templateWorkspaceId: undefined,
    socket: { remoteAddress: c.req.header("cf-connecting-ip") || "0.0.0.0" },
  };
}

function isRouter(obj) { return obj && obj.__stack; }

export function Router() {
  const stack = [];
  const addRoute = (method) => (pattern, ...handlers) => {
    stack.push({ method: method.toUpperCase(), pattern, handlers });
  };
  return {
    get: addRoute("GET"),
    post: addRoute("POST"),
    put: addRoute("PUT"),
    patch: addRoute("PATCH"),
    delete: addRoute("DELETE"),
    all: addRoute("ALL"), // wildcard de Hono: casa cualquier método
    use(path, ...handlers) {
      if (typeof path === "function") { handlers = [path, ...handlers]; path = "/"; }
      // Express error handler (4 args) -> Hono onError
      const errHandler = handlers.find((h) => typeof h === "function" && h.length >= 4);
      if (errHandler && handlers.length === 1) {
        hono.onError(async (err, c) => {
          const req = c.get("__req") || makeReq(c, {}, {});
          const res = makeRes();
          await errHandler(err, req, res, () => {});
          return res.__result();
        });
        return app;
      }
      stack.push({ method: "USE", pattern: path, handlers });
    },
    __stack: stack,
  };
}

async function runHandlers(handlers, c, body, params, externalReq) {
  const req = externalReq ?? makeReq(c, params, body);
  const res = makeRes();
  let nextErr = undefined;

  for (const h of handlers) {
    if (typeof h !== "function") continue;
    if (res.headersSent) break;
    // Deferred FRESCO por handler: next() solo relevante para el middleware en
    // curso; reutilizarlo haría que un handler posterior no espere su write
    // (el promise ya estaría resuelto) y saldría 200-vacío.
    let wakeNext = () => {};
    const nextCalled = new Promise((r) => { wakeNext = r; });
    const next = (err) => { if (err) nextErr = err; wakeNext(); };
    await h(req, res, next);
    if (nextErr) throw nextErr;
    if (res.headersSent) return res.__result();
    // asyncRoute: el wrapper retorna al instante y el fn async llama next()
    // (middleware) o escribe la respuesta (handler terminal) DESPUES. Continuar
    // en cuanto next() se invoque — esperar el write (con tope de 30s) solo si
    // el handler escribe detached sin llamar next. Antes se esperaba SIEMPRE el
    // write: cada middleware asyncRoute en el camino de éxito agregaba 30s
    // (create_api_key desde la UI = POST 30s + reload GET 30s = ~60s).
    await Promise.race([nextCalled, res.__untilSent, new Promise((r) => setTimeout(r, 30000).unref?.())]);
    if (nextErr) throw nextErr;
    if (res.headersSent) return res.__result();
  }
  return res.__result();
}

// Envuelve handlers directos de app.get/post con el adapter req/res
function wrapRoute(h) {
  return async (c) => {
    let body = {};
    try { body = await c.req.json(); } catch { /* sin body */ }
    let req = c.get("__req");
    if (!req) { req = makeReq(c, c.req.param(), body); c.set("__req", req); }
    else { req.params = c.req.param(); req.body = body; }
    const res = makeRes();
    const out = await h(req, res, () => {});
    if (out instanceof Response) return out;
    // asyncRoute: el wrapper retorna al instante y el fn async escribe luego.
    // Sin esta espera, app.get directo saldria 200-vacio (bug de /api/fonts/catalog).
    if (!res.headersSent) await settleIfUnsent(res);
    return res.__result();
  };
}

export function createExpressApp() {
  const hono = new Hono();

  // Registra un layer (de Router) bajo un prefijo
  function mountLayer(prefix, layer) {
    const fullPath = normalizePath(prefix + "/" + layer.pattern);
    const handlers = layer.handlers;
    if (layer.method === "USE") {
      const mount = fullPath === "/" || fullPath === "" ? "*" : normalizePath(fullPath) + "/*";
      hono.use(mount, async (c, nxt) => {
        // Los middleware "use" de express corren para el prefijo; los handlers de ruta despues
        const body = c.get("__body") ?? {};
        let req = c.get("__req");
        if (!req) { req = makeReq(c, c.req.param(), body); c.set("__req", req); }
        const res = makeRes();
        let nextErr;
        const callNext = (err) => { if (err) nextErr = err; };
        for (const h of handlers) {
          if (typeof h !== "function") continue;
          if (res.headersSent) { return res.__result(); }
          await h(req, res, callNext);
          if (nextErr) throw nextErr;
          if (res.headersSent) return res.__result();
        }
        await nxt();
      });
      return;
    }
    hono.on(layer.method, fullPath, async (c) => {
      let body = {};
      try { body = await c.req.json(); } catch { /* sin body */ }
      c.set("__body", body);
      let req = c.get("__req");
      if (!req) { req = makeReq(c, c.req.param(), body); c.set("__req", req); }
      else { req.params = c.req.param(); req.body = body; }
      return runHandlers(handlers, c, body, c.req.param(), req);
    });
  }

  function normalizePath(p) {
    p = p.replace(/\/+/g, "/");
    if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
    return p || "/";
  }

  const app = {
    use(path, ...handlers) {
      if (typeof path === "function") { handlers = [path, ...handlers]; path = "/"; }
      // Express error handler (4 args) -> Hono onError
      const errHandler = handlers.find((h) => typeof h === "function" && h.length >= 4);
      if (errHandler && handlers.length === 1) {
        hono.onError(async (err, c) => {
          const req = c.get("__req") || makeReq(c, {}, {});
          const res = makeRes();
          await errHandler(err, req, res, () => {});
          return res.__result();
        });
        return app;
      }
      // Si el primer handler extra es un Router -> montar sus layers bajo el prefijo
      for (const h of handlers) {
        if (isRouter(h)) {
          for (const layer of h.__stack) mountLayer(path, layer);
        }
      }
      // middlewares funcionales globales o con path
      const fns = handlers.filter((h) => typeof h === "function");
      if (fns.length) {
        const mount = path === "/" ? "*" : normalizePath(path) + "/*";
        hono.use(mount, async (c, nxt) => {
          let body = c.get("__body") ?? {};
          let req = c.get("__req");
          if (!req) { req = makeReq(c, c.req.param(), body); c.set("__req", req); }
          const res = makeRes();
          let nextErr;
          const callNext = (err) => { if (err) nextErr = err; };
          for (const h of fns) {
            if (res.headersSent) return res.__result();
            await h(req, res, callNext);
            if (nextErr) throw nextErr;
            if (res.headersSent) return res.__result();
          }
          await nxt();
        });
      }
      return app;
    },
    get: (p, ...h) => { hono.get(p, ...h.map(wrapRoute)); return app; },
    post: (p, ...h) => { hono.post(p, ...h.map(wrapRoute)); return app; },
    put: (p, ...h) => { hono.put(p, ...h.map(wrapRoute)); return app; },
    patch: (p, ...h) => { hono.patch(p, ...h.map(wrapRoute)); return app; },
    delete: (p, ...h) => { hono.delete(p, ...h.map(wrapRoute)); return app; },
    all: (p, ...h) => { hono.on("ALL", p, ...h.map(wrapRoute)); return app; },
    __hono: hono,
  };
  return app;
}
