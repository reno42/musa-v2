// Reproduce the 60s key-creation stall: express-shim + asyncRoute success path.
// Local Express resolves next() instantly; the shim's settleIfUnsent waits for
// a write that never comes on the success path of an asyncRoute middleware.
import { createExpressApp, Router } from "../worker/express-shim.js";

const shimApp = createExpressApp();

// Mirror of api/src/middleware/asyncRoute.ts — returns synchronously, writes
// nothing on success, just calls next() from a detached promise.
const asyncRoute = (fn) => (req, res, next) => {
  try { Promise.resolve(fn(req, res, next)).catch(next); } catch (e) { next(e); }
};

// Mirror of requireWorkspaceRole (tenancy.ts): async, calls next() on success.
const requireWorkspaceRole = () => asyncRoute(async (req, res, next) => {
  await new Promise(r => setTimeout(r, 20)); // simulated supabase lookup
  next(); // success path: no write, headersSent stays false
});

const router = new Router();
router.post("/:id/api-keys", requireWorkspaceRole("admin"), async (req, res) => {
  await new Promise(r => setTimeout(r, 30)); // simulated insert
  res.json({ success: true, key: "fdr_ws_probe" });
});

shimApp.use("/api/workspaces", router);

const keepAlive = setInterval(() => {}, 1000); // keeps the event loop alive for the unref'd 30s timer

const t0 = Date.now();
const res = await shimApp.__hono.fetch(new Request("https://x/api/workspaces/ws_123/api-keys", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ label: "probe" }),
}));
const ms = Date.now() - t0;
const body = await res.text();
console.log(`shim: HTTP ${res.status} in ${ms}ms — body: ${body}`);
console.log(ms > 5000 ? `STALL CONFIRMED: ${ms}ms for a ~50ms handler` : `no stall (${ms}ms)`);
process.exit(ms > 5000 ? 1 : 0);
