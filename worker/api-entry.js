// API Worker entry: monta la express app del repo via shim Hono-compatible
import app from "../api/src/index.js";

export default {
  async fetch(request, env, ctx) {
    // Express shim expone __hono (Hono app con las rutas montadas)
    if (app.__hono) {
      return app.__hono.fetch(request, env, ctx);
    }
    return new Response("API not initialized", { status: 500 });
  },
};
