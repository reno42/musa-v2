// Verify the shim fix: asyncRoute middleware success path, terminal handler
// writing detached, and error propagation — all through the express-shim.
import { createExpressApp, Router } from "../worker/express-shim.js";

const shimApp = createExpressApp();

const asyncRoute = (fn) => (req, res, next) => {
  try { Promise.resolve(fn(req, res, next)).catch(next); } catch (e) { next(e); }
};

const requireRole = () => asyncRoute(async (req, res, next) => {
  await new Promise(r => setTimeout(r, 20));
  next();
});

const router = new Router();
// case 1: middleware success path + terminal handler (the create_api_key shape)
router.post("/:id/api-keys", requireRole("admin"), asyncRoute(async (req, res) => {
  await new Promise(r => setTimeout(r, 30));
  res.json({ success: true, case: 1 });
}));
// case 2: middleware writes 403 (error path) — terminal must never run
router.post("/:id/deny", asyncRoute(async (req, res, next) => {
  await new Promise(r => setTimeout(r, 20));
  res.status(403).json({ error: "no access" });
}), (req, res) => res.json({ case: "never" }));
// case 3: thrown error in asyncRoute handler
router.post("/:id/boom", requireRole("admin"), asyncRoute(async () => {
  throw new Error("boom");
}));

shimApp.use("/api/workspaces", router);

const keepAlive = setInterval(() => {}, 1000);
let failures = 0;
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!cond) failures++;
};

const call = async (path) => {
  const t0 = Date.now();
  const res = await shimApp.__hono.fetch(new Request("https://x" + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  }));
  return { ms: Date.now() - t0, status: res.status, body: await res.text() };
};

const r1 = await call("/api/workspaces/ws_123/api-keys");
check("case1 fast (<1000ms)", r1.ms < 1000, `${r1.ms}ms`);
check("case1 correct body", r1.status === 200 && r1.body.includes('"case":1'), r1.body);

const r2 = await call("/api/workspaces/ws_123/deny");
check("case2 fast (<1000ms)", r2.ms < 1000, `${r2.ms}ms`);
check("case2 403 from middleware", r2.status === 403, `${r2.status} ${r2.body}`);

const r3 = await call("/api/workspaces/ws_123/boom");
check("case3 error propagates (not 200-empty)", r3.status !== 200 || r3.body.includes("boom"), `${r3.status} ${r3.body.slice(0, 120)}`);

clearInterval(keepAlive);
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures ? 1 : 0);
