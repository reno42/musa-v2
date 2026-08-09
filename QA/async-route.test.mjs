/**
 * Async middleware must never end a request by doing nothing.
 *
 * Express 4 drops a rejected promise from an `async` handler on the floor: no
 * response is written and the request just stops. Locally that is a hung
 * curl; on Netlify the function adapter only settles when Express calls
 * json/send/end, so the invocation runs to the platform timeout and the
 * browser gets a bodyless 503 — the failure Renzo hit saving rows.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { asyncRoute } from "../api/src/middleware/asyncRoute.ts";

const run = (handler) => new Promise((resolve) => {
  const res = {
    code: null, body: null, sent: false,
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; this.sent = true; resolve({ res, nextErr: undefined }); return this; },
  };
  asyncRoute(handler)({ method: "PUT", path: "/api/meta/x" }, res, (err) => resolve({ res, nextErr: err }));
});

test("a rejected async gate reaches next(err) instead of vanishing", async () => {
  const boom = new Error("fetch failed");
  const { nextErr, res } = await run(async () => { throw boom; });
  assert.equal(nextErr, boom);
  assert.equal(res.sent, false, "the gate itself must not answer; the error handler does");
});

test("a rejected promise that is not thrown is caught the same way", async () => {
  const { nextErr } = await run(() => Promise.reject(new Error("ECONNRESET")));
  assert.equal(nextErr.message, "ECONNRESET");
});

test("a synchronous throw is caught too", async () => {
  const { nextErr } = await run(() => { throw new Error("sync boom"); });
  assert.equal(nextErr.message, "sync boom");
});

test("a gate that passes calls next with nothing", async () => {
  const { nextErr } = await run(async (_req, _res, next) => { next(); });
  assert.equal(nextErr, undefined);
});

test("a gate that answers still answers, and next is never reached", async () => {
  const { res, nextErr } = await run(async (_req, res) => {
    res.status(404).json({ success: false, error: "Template not found" });
  });
  assert.equal(nextErr, undefined);
  assert.equal(res.code, 404);
  assert.deepEqual(res.body, { success: false, error: "Template not found" });
});

test("a handler returning a non-promise is passed through untouched", async () => {
  const { nextErr } = await run((_req, _res, next) => { next(); });
  assert.equal(nextErr, undefined);
});
