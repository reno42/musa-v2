import { Readable } from "node:stream";
import app from "../../api/src/index.js";

// ── Lightweight auth check (defense-in-depth, Express middleware does full validation) ──

function checkAdminKey(event) {
  const adminKey = process.env.MCP_ADMIN_KEY;
  if (!adminKey) return true; // Dev mode: no auth required

  const headers = event.headers || {};
  const apiKey = headers["x-api-key"] || "";

  // Admin key bypass
  if (apiKey === adminKey) return true;

  // For non-admin keys: allow through; Express middleware validates against api_keys table
  // At minimum require *some* key header
  return apiKey.length > 0;
}

function createRequest(event) {
  const { path, httpMethod, headers, body, queryStringParameters, isBase64Encoded } = event;

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

  if (body) {
    const buf = isBase64Encoded ? Buffer.from(body, "base64") : Buffer.from(body, "utf-8");
    req.push(buf);
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

  const req = createRequest(event);

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
      resHeaders["content-type"] = "application/json";
      return {
        statusCode,
        headers: resHeaders,
        body: JSON.stringify(data),
      };
    },
    send(data) {
      if (typeof data === "object" && !Buffer.isBuffer(data)) {
        resHeaders["content-type"] = "application/json";
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
