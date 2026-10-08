// REQ-040 — Flows wake (pausa con reanudación por agente). Fase 1: config
// (migración v68 + tools flow_wake_set/get/test) y el módulo flows-wake.mjs
// (HMAC, backoff, payload §2). Fases 2-3 extienden este archivo.
//
// Lo red (dispatchWake) se prueba con fetch stubeado y backoff acortado
// (WAKE_BACKOFF_MS se muta IN-PLACE: el módulo comparte la referencia).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import crypto from "node:crypto";
import {
  WAKE_BACKOFF_MS, assertWakeUrl, dispatchWake, newWakeSecret, normalizeWakeConfig,
  runWakeTest, scheduleFlowWake, signWakeBody, wakePayload, wakeSecretHint,
} from "../netlify/functions/flows-wake.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mcp = readFileSync(join(root, "netlify", "functions", "mcp.mjs"), "utf8");

// ── stubs ────────────────────────────────────────────────────────────────────
const sbWake = (raw) => ({
  from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: raw === undefined ? null : { flows_wake: raw } }) }) }),
    update: () => ({ eq: () => ({ error: null }) }),
  }),
});
const WAIT = { nodeId: "w1", kind: "webhook", message: "Dame el título", resumeToken: "rw_abc123", expiresAt: "2026-10-08T01:50:35.524Z" };
const FLOW = { id: "flow_xyz", name: "PB·Evento 2 — Countdown", workspace_id: "ws_1" };

test("P040-1 signWakeBody = HMAC-SHA256 hex estándar (vector RFC conocido)", () => {
  // Vector público: key="key", msg="The quick brown fox jumps over the lazy dog"
  assert.equal(signWakeBody("key", "The quick brown fox jumps over the lazy dog"), "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
});

test("P040-2 el secret jamás sale completo: hint = ••• + últimos 4", () => {
  assert.equal(wakeSecretHint("abcd1234"), "•••1234");
  assert.equal(wakeSecretHint("ab"), null);
  assert.equal(wakeSecretHint(null), null);
  assert.ok(!JSON.stringify({ h: wakeSecretHint("abcd1234") }).includes("abcd1234".slice(0, 4)));
});

test("P040-3 newWakeSecret: 48 chars hex (24 bytes)", () => {
  const s = newWakeSecret();
  assert.match(s, /^[0-9a-f]{48}$/);
  assert.notEqual(s, newWakeSecret());
});

test("P040-4 normalizeWakeConfig: null en basura, default enabled:true, false explícito gana", () => {
  assert.equal(normalizeWakeConfig(null), null);
  assert.equal(normalizeWakeConfig("x"), null);
  assert.equal(normalizeWakeConfig({ url: "https://a.b" }), null, "sin secret no hay config usable");
  const cfg = normalizeWakeConfig({ url: " https://a.b/c ", secret: " s ".trim(), enabled: undefined, createdAt: "2026-10-07T00:00:00Z" });
  assert.equal(cfg.url, "https://a.b/c");
  assert.equal(cfg.enabled, true, "enabled default true");
  assert.equal(normalizeWakeConfig({ url: "https://a.b", secret: "s", enabled: false }).enabled, false);
});

test("P040-5 wakePayload: shape EXACTA del REQ §2 (10 claves, ni una más)", () => {
  const p = wakePayload({ workspaceId: "ws_1", flow: FLOW, runId: "run_1", wait: WAIT });
  assert.deepEqual(Object.keys(p).sort(), ["expiresAt", "flowId", "flowName", "kind", "message", "nodeId", "resumeToken", "runId", "type", "workspaceId"]);
  assert.equal(p.type, "flow_wait");
  assert.equal(p.flowId, "flow_xyz");
  assert.equal(p.flowName, "PB·Evento 2 — Countdown");
  assert.equal(p.resumeToken, "rw_abc123");
  assert.equal(p.expiresAt, "2026-10-08T01:50:35.524Z");
});

test("P040-6 dispatchWake: reintenta en 5xx y entrega con la firma en el header", async () => {
  WAKE_BACKOFF_MS.splice(0, WAKE_BACKOFF_MS.length, 5, 5, 5); // backoff acortado para test
  const seen = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), init });
    if (seen.length < 3) return new Response("boom", { status: 500 });
    return new Response("ok", { status: 200 });
  };
  try {
    const body = JSON.stringify({ type: "flow_wait" });
    const res = await dispatchWake("https://hook.example/x", "s3cret", body);
    assert.equal(res.delivered, true);
    assert.equal(res.attempts, 3);
    assert.equal(seen.length, 3);
    const expectedSig = crypto.createHmac("sha256", "s3cret").update(body).digest("hex");
    for (const call of seen) {
      assert.equal(call.init.headers["x-musa-signature"], expectedSig);
      assert.equal(call.init.headers["content-type"], "application/json");
    }
  } finally {
    globalThis.fetch = originalFetch;
    WAKE_BACKOFF_MS.splice(0, WAKE_BACKOFF_MS.length, 1_000, 5_000, 25_000);
  }
});

test("P040-7 dispatchWake: 4xx definitivo NO reintenta (misma firma no cambia nada)", async () => {
  WAKE_BACKOFF_MS.splice(0, WAKE_BACKOFF_MS.length, 5, 5, 5);
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { calls++; return new Response("no", { status: 400 }); };
  try {
    const res = await dispatchWake("https://hook.example/x", "s3cret", "{}");
    assert.equal(res.delivered, false);
    assert.equal(calls, 1, "400 es definitivo: un solo intento");
  } finally {
    globalThis.fetch = originalFetch;
    WAKE_BACKOFF_MS.splice(0, WAKE_BACKOFF_MS.length, 1_000, 5_000, 25_000);
  }
});

test("P040-8 scheduleFlowWake: fire-and-forget real, payload firmado vía waitUntil", async () => {
  WAKE_BACKOFF_MS.splice(0, WAKE_BACKOFF_MS.length, 5, 5, 5);
  const posts = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { posts.push({ url: String(url), init }); return new Response("ok", { status: 200 }); };
  const waited = [];
  const logs = [];
  try {
    const scheduled = scheduleFlowWake({
      sb: sbWake({ url: "https://hook.example/wake", secret: "s3cret-wake", enabled: true }),
      flow: FLOW, runId: "run_1", wait: WAIT, workspaceId: "ws_1",
      waitUntil: (p) => waited.push(p), log: (m) => logs.push(m),
    });
    assert.equal(scheduled, true, "retorna YA (fire-and-forget): el run nunca lo espera");
    assert.equal(posts.length, 0, "el POST no bloquea: corre en background");
    await Promise.all(waited);
    assert.equal(posts.length, 1);
    const body = JSON.parse(posts[0].init.body);
    assert.equal(body.type, "flow_wait");
    assert.equal(body.runId, "run_1");
    assert.equal(body.resumeToken, "rw_abc123");
    const expectedSig = crypto.createHmac("sha256", "s3cret-wake").update(posts[0].init.body).digest("hex");
    assert.equal(posts[0].init.headers["x-musa-signature"], expectedSig, "la firma cubre el body EXACTO que viaja");
  } finally {
    globalThis.fetch = originalFetch;
    WAKE_BACKOFF_MS.splice(0, WAKE_BACKOFF_MS.length, 1_000, 5_000, 25_000);
  }
});

test("P040-9 scheduleFlowWake: sin config (o disabled) → cero red, sin error", async () => {
  const posts = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { posts.push({ url: String(url) }); return new Response("ok", { status: 200 }); };
  const waited = [];
  try {
    assert.equal(scheduleFlowWake({ sb: sbWake(null), flow: FLOW, runId: "run_1", wait: WAIT, waitUntil: (p) => waited.push(p) }), true);
    assert.equal(scheduleFlowWake({
      sb: sbWake({ url: "https://hook.example/wake", secret: "s", enabled: false }),
      flow: FLOW, runId: "run_1", wait: WAIT, waitUntil: (p) => waited.push(p),
    }), true);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(posts.length, 0, "sin url configurada el comportamiento es el de hoy");
    assert.equal(scheduleFlowWake({ sb: null, flow: FLOW, runId: "run_1", wait: WAIT }), false, "sin sb no hay wake");
    assert.equal(scheduleFlowWake({ sb: sbWake(null), flow: FLOW, runId: "run_1", wait: { ...WAIT, resumeToken: null } }), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("P040-10 runWakeTest: sin config reporta configured:false (no revienta)", async () => {
  const res = await runWakeTest({ sb: sbWake(null), workspaceId: "ws_1" });
  assert.equal(res.configured, false);
  assert.equal(res.ok, false);
  assert.match(res.error, /flow_wake_set/);
});

test("P040-11 assertWakeUrl: HTTPS público o nada (mismo guard SSRF que los nodos http)", async () => {
  await assert.rejects(() => assertWakeUrl("http://hook.example/x"), /HTTPS/);
  await assert.rejects(() => assertWakeUrl("https://localhost/x"), /locales/);
  await assert.rejects(() => assertWakeUrl("https://127.0.0.1/x"), /dominio/);
  await assert.doesNotReject(() => assertWakeUrl("https://hooks.example.com/musa/wake"));
});

// ── contratos de fuente en mcp.mjs (fase 1: tools de config) ────────────────
test("P040-12 mcp.mjs: tools flow_wake_* con tenant desde la key y secret show-once", () => {
  for (const name of ["flow_wake_set", "flow_wake_get", "flow_wake_test"]) {
    assert.match(mcp, new RegExp(`case "${name}": \\{`), `handler ${name} existe`);
    assert.match(mcp, new RegExp(`name: "${name}"`), `def ${name} existe`);
    assert.ok((mcp.match(new RegExp(`case "${name}": \\{[\\s\\S]*?\\n    \\}`)) || [""])[0].includes("flowsAssertEnabled()"), `${name} respeta el kill switch`);
  }
  // Derivación de tenant: workspace_key → auth.workspaceId, NUNCA input.
  assert.match(mcp, /if \(!workspaceId && FLOW_WAKE_METHODS\.has\(method\) && auth\?\.authType === "workspace_key"\) \{\s*workspaceId = String\(auth\.workspaceId \|\| ""\)\.trim\(\);/);
  assert.match(mcp, /function requireWakeWorkspace\(params, auth\) \{\s*if \(auth\?\.authType === "workspace_key"\) \{/);
  // Gate de roles corre igual (viewer get, editor set/test).
  assert.match(mcp, /const FLOW_WAKE_METHODS = new Set\(\["flow_wake_set", "flow_wake_get", "flow_wake_test"\]\)/);
  assert.match(mcp, /"flow_static_data_get", "flow_wake_get"\]/, "flow_wake_get es read (viewer)");
  // Secret show-once: generado → completo UNA vez; heredado/pasado → solo hint.
  assert.match(mcp, /generated \? \{ secret: config\.secret/);
  assert.match(mcp, /\{ secretHint: wakeSecretHint\(config\.secret\) \}/);
  assert.doesNotMatch(mcp, /secret: config\.secret \}/, "fuera del path generated el secret no sale");
  // Persistencia fallida = error, nunca éxito mentiroso (REQ-014).
  assert.match(mcp, /SAVE_FAILED: no se pudo guardar la config de wake/);
});

// ── fase 2: disparo del wake en el runtime (punto de enganche exacto) ───────
test("P040-13 flows-runtime: AMBAS ramas waiting disparan el wake tras persistir", () => {
  const src = readFileSync(join(root, "netlify", "functions", "flows-runtime.mjs"), "utf8");
  assert.match(src, /import \{ scheduleFlowWake \} from "\.\/flows-wake\.mjs";/);
  // runFlow y resumeFlowRun aceptan waitUntil (threading desde el host).
  assert.match(src, /async function runFlow\(flow, \{ input, requestId, waitUntil \} = \{\}\)/);
  assert.match(src, /async function resumeFlowRun\(flow, \{ resumeToken, payload, waitUntil \} = \{\}\)/);
  // El disparo ocurre en el punto EXACTO del REQ: run persistido en waiting,
  // después del prune, ANTES del return — y jamás awaited.
  const calls = src.match(/scheduleFlowWake\(\{ sb, flow, runId: run\.id, wait, workspaceId, waitUntil \}\)/g) ?? [];
  assert.equal(calls.length, 2, "runFlow (nueva pausa) y resumeFlowRun (otro nodo de espera)");
  for (const call of calls) {
    const idx = src.indexOf(call);
    const after = src.slice(idx);
    assert.ok(src.slice(Math.max(0, idx - 600), idx).includes("store.pruneRuns(flow.id).catch(() => {})"), "wake DESPUÉS de persistir+prune");
    assert.match(after, /\r?\n\s*return \{ runId: run\.id, status: "waiting"/, "el return waiting sigue intacto (contrato B5 no tocado)");
  }
});

test("P040-14 mcp.mjs: waitUntil del host llega al runtime (handler → ctx → runFlow)", () => {
  assert.match(mcp, /export const handler = async \(event, context\) => \{/);
  assert.match(mcp, /const wakeWaitUntil = typeof context\?\.waitUntil === "function" \? context\.waitUntil\.bind\(context\) : null;/);
  assert.match(mcp, /export async function handleMethod\(method, params, userId, auth, ctx = \{\}\) \{/);
  // Ambos despachos autenticados (tools/call y batch) inyectan el waitUntil.
  assert.match(mcp, /handleMethod\(params\.name, scopedParams, auth\.userId, auth, \{ waitUntil: wakeWaitUntil \}\)/);
  assert.match(mcp, /handleMethod\(method, scopedParams, auth\.userId, auth, \{ waitUntil: wakeWaitUntil \}\)/);
  // flow_run / flow_resume lo pasan al runtime; resume no cambia su contrato.
  assert.match(mcp, /waitUntil: ctx\.waitUntil \?\? null,\r?\n      \}\);\r?\n      return \{\s*\r?\n\s*flowId: flow\.id, runId: result\.runId, status: result\.status,/);
  assert.match(mcp, /runtime\.resumeFlowRun\(flow, \{ resumeToken: token, payload: payload \?\? \{\}, waitUntil: ctx\.waitUntil \?\? null \}\)/);
});

test("P040-15 api webhook: mismo wake vía el puente __musaWaitUntil del worker", () => {
  const apiSrc = readFileSync(join(root, "api", "src", "index.ts"), "utf8");
  assert.match(apiSrc, /const musaWaitUntil = \(globalThis as any\)\.__musaWaitUntil;/);
  assert.match(apiSrc, /runtime\.runFlow\(flow, \{ input, requestId, waitUntil: typeof musaWaitUntil === "function" \? musaWaitUntil : null \}\)/);
  // La respuesta 202 waiting sigue SIN resumeToken (la URL es pública, QA req027).
  assert.match(apiSrc, /res\.status\(202\)\.json\(\{ ok: true, runId: result\.runId, status: "waiting" \}\)/);
});
