// netlify/functions/api.ts
// Netlify Function wrapper for the Futuraria Express API.
// Forwards incoming requests to the Express app running on a local port.

import type { Context } from "@netlify/functions";
import { app } from "../../packages/api/src/app";

let listening = false;
let port = 0;

function ensureServer(): Promise<number> {
  if (listening) return Promise.resolve(port);
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      port = (server.address() as any).port;
      listening = true;
      resolve(port);
    });
  });
}

export default async (req: Request, _context: Context) => {
  const p = await ensureServer();
  const url = new URL(req.url);
  const target = `http://127.0.0.1:${p}${url.pathname}${url.search}`;

  const headers = new Headers();
  req.headers.forEach((v, k) => headers.set(k, v));

  const res = await fetch(target, {
    method: req.method,
    headers,
    body: req.method !== "GET" && req.method !== "HEAD" ? await req.text() : undefined,
  });

  const resHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    resHeaders[k] = v;
  });

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: resHeaders,
  });
};

export const config = {
  path: "/api/*",
};
