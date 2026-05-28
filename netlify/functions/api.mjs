import { Readable } from "node:stream";
import app from "../../api/src/index.js";

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
