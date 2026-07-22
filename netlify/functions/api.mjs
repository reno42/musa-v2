import { Readable } from "node:stream";
import app from "../../api/src/index.js";
// NOTE: import path "../../api/src/index.js" resolves to TypeScript source
// at build time via esbuild. If the bundler changes, update this path.
import { getSupabase } from "../../api/src/services/supabase.js";
import { getNetlifyBodyBuffer, JSON_UTF8_CONTENT_TYPE } from "./http-encoding.mjs";

// ── Lightweight auth check (defense-in-depth, Express middleware does full validation) ──

function checkAdminKey(event) {
  const adminKey = process.env.MCP_ADMIN_KEY;
  if (!adminKey) return true; // Dev mode: no auth required

  const headers = event.headers || {};
  const apiKey = headers["x-api-key"] || "";
  const bearer = headers.authorization || headers.Authorization || "";

  // User-session writes are validated by the Express auth middleware. The
  // Netlify preflight must not reject a valid Supabase Bearer token merely
  // because an MCP admin key is also configured in the deployment.
  if (/^Bearer\s+\S+/i.test(bearer)) return true;

  // Admin key bypass
  if (apiKey === adminKey) return true;

  // For non-admin keys: allow through; Express middleware validates against api_keys table
  // At minimum require *some* key header
  return apiKey.length > 0;
}

function createRequest(event) {
  const { path, httpMethod, headers, queryStringParameters } = event;

  const url = new URL(path, "http://localhost");
  if (queryStringParameters) {
    for (const [k, v] of Object.entries(queryStringParameters)) {
      url.searchParams.set(k, v);
    }
  }

  const rawHeaders = [];
  for (const [k, v] of Object.entries(headers || {})) {
    rawHeaders.push(k.toLowerCase(), v);
  }

  const req = new Readable({ read() {} });
  req.method = httpMethod;
  req.url = url.pathname + url.search;
  req.headers = {};
  for (const [k, v] of Object.entries(headers || {})) {
    req.headers[k.toLowerCase()] = v;
  }
  req.rawHeaders = rawHeaders;

  const body = getNetlifyBodyBuffer(event);
  if (body.byteLength > 0) {
    const buf = body;
    req.headers["content-length"] = String(buf.byteLength);
    req.push(buf);
  } else {
    delete req.headers["content-length"];
  }
  req.push(null);

  return req;
}

export const handler = async (event, context) => {
  // ── Auth enforcement for write operations ──
  const writeMethods = new Set(["POST", "PUT", "DELETE", "PATCH"]);
  if (writeMethods.has(event.httpMethod)) {
    if (!checkAdminKey(event)) {
      return {
        statusCode: 401,
        headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ success: false, error: "Unauthorized: valid x-api-key required" }),
      };
    }
  }

  let req;
  try {
    req = createRequest(event);
  } catch {
    return {
      statusCode: 400,
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": JSON_UTF8_CONTENT_TYPE },
      body: JSON.stringify({ success: false, error: "Request body must be valid UTF-8" }),
    };
  }

  // ── Public slug resolution (pre-Express, guaranteed no-auth) ──
  // Bypasses the full middleware chain for fast, guaranteed-public
  // slug→UUID lookups. Express auth middleware also allows public GET,
  // but this interceptor is architectural isolation: resolve stays
  // public regardless of future auth middleware changes.
  if (event.httpMethod === "GET" && event.path.startsWith("/api/resolve/")) {
    const sb = getSupabase();
    if (!sb) {
      return {
        statusCode: 503,
        headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ success: false, error: "Supabase not connected" }),
      };
    }

    // Parse: /api/resolve/workspace/:wsSlug[/:tplSlug?]
    const parts = event.path.replace("/api/resolve/workspace/", "").split("/").filter(Boolean);
    const wsSlug = parts[0];
    const tplSlug = parts[1] || null;

    try {
      if (!wsSlug) {
        return {
          statusCode: 400,
          headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({ success: false, error: "Missing workspace slug" }),
        };
      }

      // Resolve workspace by slug
      const { data: ws, error: wsErr } = await sb.from("workspaces")
        .select("id, name, slug")
        .eq("slug", wsSlug)
        .maybeSingle();

      if (wsErr || !ws) {
        return {
          statusCode: 404,
          headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({ success: false, error: `Workspace not found: ${wsSlug}` }),
        };
      }

      // Workspace-only resolve
      if (!tplSlug) {
        return {
          statusCode: 200,
          headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({ success: true, data: { id: ws.id, name: ws.name, slug: ws.slug } }),
        };
      }

      // Template resolve within workspace
      const { data: tpl, error: tplErr } = await sb.from("templates")
        .select("id, name, slug")
        .eq("workspace_id", ws.id)
        .eq("slug", tplSlug)
        .is("deleted_at", null)
        .maybeSingle();

      if (tplErr || !tpl) {
        return {
          statusCode: 404,
          headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({ success: false, error: `Template not found: ${tplSlug}` }),
        };
      }

      return {
        statusCode: 200,
        headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          success: true,
          data: {
            workspaceId: ws.id,
            workspaceName: ws.name,
            workspaceSlug: ws.slug,
            templateId: tpl.id,
            templateName: tpl.name,
            templateSlug: tpl.slug,
          },
        }),
      };
    } catch (err) {
      return {
        statusCode: 500,
        headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ success: false, error: `Resolution failed: ${err.message}` }),
      };
    }
  }

  const chunks = [];
  const resHeaders = {};
  let statusCode = 200;

  const res = {
    statusCode: 200,
    setHeader(name, value) {
      resHeaders[name.toLowerCase()] = String(value);
    },
    getHeader(name) {
      return resHeaders[name.toLowerCase()];
    },
    removeHeader(name) {
      delete resHeaders[name.toLowerCase()];
    },
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      resHeaders["content-type"] = JSON_UTF8_CONTENT_TYPE;
      return {
        statusCode,
        headers: resHeaders,
        body: JSON.stringify(data),
      };
    },
    send(data) {
      if (typeof data === "object" && !Buffer.isBuffer(data)) {
        resHeaders["content-type"] = JSON_UTF8_CONTENT_TYPE;
        return { statusCode, headers: resHeaders, body: JSON.stringify(data) };
      }
      return { statusCode, headers: resHeaders, body: String(data || "") };
    },
    end(data) {
      if (data) chunks.push(Buffer.from(data));
      return { statusCode, headers: resHeaders, body: Buffer.concat(chunks).toString() };
    },
    write(chunk) {
      if (chunk) chunks.push(Buffer.from(chunk));
      return true;
    },
  };

  return new Promise((resolve) => {
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    const originalEnd = res.end.bind(res);

    res.json = (data) => resolve(originalJson(data));
    res.send = (data) => resolve(originalSend(data));
    res.end = (data) => resolve(originalEnd(data));

    app(req, res);
  });
};
