// QA/req028-ghost-platform-llm.test.mjs — REQ-028 Item 5: cadena
// plataforma→BYOK (resolveGhostChain), cuota freemium atómica (§2-Item 5.2:
// 2 claims del último run ⇒ exactamente 1 ganador) y contratos de source del
// gate / proxy / migración / badge. Los 2 reason codes freemium del preflight
// ya viven en QA/ghost-preflight.test.mjs (mismo suite test:regression).
// Corre con:
//   node --experimental-strip-types --test QA/req028-ghost-platform-llm.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { pickPlatformLlm, resolveGhostChain } from "../worker/runtime/functions/ghostLlmChain.mjs";
import { checkAndConsumeQuota, peekQuota, platformFreeRunLimit } from "../worker/runtime/functions/quota.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(ROOT + rel, "utf8");

const ENDPOINTS = {
  deepseek: "https://api.deepseek.com/chat/completion",
  zhipu: "https://open.bigmodel.cn/api/paas/v4/chat/completion",
  openrouter: "https://openrouter.ai/api/v1/chat/completion",
  anthropic: "https://api.anthropic.com/v1/messages",
};

/** sb fake: la cadena solo lee user_profiles.prefs (select→eq→maybeSingle). */
const fakePrefsDb = (prefs, error = null) => ({
  from: () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: error ? null : { prefs }, error }),
      }),
    }),
  }),
});
const noKey = async () => null;
const keyOf = (k) => async () => ({ key: k });

// ── Capa 1 pura: pickPlatformLlm (misma cadena que resolveTextLlm) ──────────

test("pickPlatformLlm: sin env key → null (el server no regala nada)", () => {
  assert.equal(pickPlatformLlm(ENDPOINTS, {}), null);
});

test("pickPlatformLlm: ZHIPU_API_KEY → zhipu glm-5.3-flash thinking off", () => {
  const p = pickPlatformLlm(ENDPOINTS, { ZHIPU_API_KEY: "zk-test" });
  assert.equal(p.provider, "zhipu");
  assert.equal(p.model, "glm-5.3-flash");
  assert.equal(p.endpoint, ENDPOINTS.zhipu);
  assert.deepEqual(p.extraBody, { thinking: { type: "disabled" } });
  assert.equal(p.headers.Authorization, "Bearer zk-test");
});

test("pickPlatformLlm: OPENROUTER_API_KEY gana (mismo orden que resolveTextLlm) y ZHIPU_TEXT_MODEL respeta override", () => {
  const both = pickPlatformLlm(ENDPOINTS, { ZHIPU_API_KEY: "zk", OPENROUTER_API_KEY: "or" });
  assert.equal(both.provider, "openrouter");
  assert.equal(both.model, "openai/gpt-6-sol");
  assert.deepEqual(both.extraBody, {});
  const override = pickPlatformLlm(ENDPOINTS, { ZHIPU_API_KEY: "zk", ZHIPU_TEXT_MODEL: "glm-5.3-air" });
  assert.equal(override.model, "glm-5.3-air");
});

// ── Cadena completa (req §2-Item 5.1) ───────────────────────────────────────

test("cadena: sin env key y sin BYOK → none + PLATFORM_LLM_UNAVAILABLE", async () => {
  // §2-Item 5.1 resume "none/FREEMIUM_QUOTA_EXHAUSTED", pero §2-Item 1.2 fija
  // el criterio: server SIN env key = config del operador ⇒
  // PLATFORM_LLM_UNAVAILABLE. FREEMIUM_QUOTA_EXHAUSTED es del cobro (gate,
  // probado abajo y en los contratos de mcp.mjs).
  const r = await resolveGhostChain("u1", { sb: fakePrefsDb({}), endpoints: ENDPOINTS, env: {}, getUserKey: noKey });
  assert.equal(r.tier, "none");
  assert.equal(r.reasonCode, "PLATFORM_LLM_UNAVAILABLE");
  assert.match(r.detail, /operador/);
});

test("cadena: env key + usuario sin BYOK → platform (freemium, keyLast4 null)", async () => {
  const r = await resolveGhostChain("u1", { sb: fakePrefsDb({}), endpoints: ENDPOINTS, env: { ZHIPU_API_KEY: "zk-test" }, getUserKey: noKey });
  assert.equal(r.tier, "platform");
  assert.equal(r.provider, "zhipu");
  assert.equal(r.model, "glm-5.3-flash");
  assert.equal(r.keyLast4, null); // la key es del server: jamás hay last4 de usuario
  assert.deepEqual(r.extraBody, { thinking: { type: "disabled" } });
  assert.match(r.headers.Authorization, /^Bearer zk-test$/);
});

test("cadena: CON BYOK su IA manda SIEMPRE aunque haya env key (cuota intacta)", async () => {
  const r = await resolveGhostChain("u1", {
    sb: fakePrefsDb({ chatRoles: { leader: { provider: "deepseek", model: "deepseek-chat" } } }),
    endpoints: ENDPOINTS,
    env: { ZHIPU_API_KEY: "zk-test" },
    getUserKey: keyOf("sk-usuario-9999"),
  });
  assert.equal(r.tier, "byok");
  assert.equal(r.provider, "deepseek");
  assert.equal(r.keyLast4, "9999");
  assert.equal(r.headers.Authorization, "Bearer sk-usuario-9999");
  assert.equal(r.extraBody && r.extraBody.thinking, undefined); // thinking off solo zhipu
});

test("cadena: leader anthropic → headers x-api-key + anthropic-version", async () => {
  const r = await resolveGhostChain("u1", {
    sb: fakePrefsDb({ chatRoles: { leader: { provider: "anthropic", model: "claude-sonnet-4-5" } } }),
    endpoints: ENDPOINTS,
    env: {},
    getUserKey: keyOf("sk-ant-8888"),
  });
  assert.equal(r.tier, "byok");
  assert.equal(r.headers["x-api-key"], "sk-ant-8888");
  assert.equal(r.headers["anthropic-version"], "2023-06-01");
});

test("cadena: flag ghost_platform_llm_v1=false apaga la capa 1 sin redeploy", async () => {
  const r = await resolveGhostChain("u1", {
    sb: fakePrefsDb({ ghost_platform_llm_v1: false }),
    endpoints: ENDPOINTS,
    env: { ZHIPU_API_KEY: "zk-test" },
    getUserKey: noKey,
  });
  assert.equal(r.tier, "none");
  assert.equal(r.reasonCode, "PLATFORM_LLM_UNAVAILABLE");
  assert.match(r.detail, /ghost_platform_llm_v1/);
});

test("cadena: getUserKey que falla NO bloquea — cae a plataforma", async () => {
  const r = await resolveGhostChain("u1", {
    sb: fakePrefsDb({}),
    endpoints: ENDPOINTS,
    env: { ZHIPU_API_KEY: "zk-test" },
    getUserKey: async () => { throw new Error("DB caída"); },
  });
  assert.equal(r.tier, "platform");
});

test("cadena: prefs ilegibles → leader default deepseek y resuelve igual", async () => {
  const r = await resolveGhostChain("u1", {
    sb: fakePrefsDb(null, { message: "timeout" }),
    endpoints: ENDPOINTS,
    env: { ZHIPU_API_KEY: "zk-test" },
    getUserKey: noKey,
  });
  assert.equal(r.tier, "platform");
  assert.equal(r.leader.provider, "deepseek");
});

test("cadena: sin sb o sin endpoints → null (fail-open del gate es del caller)", async () => {
  assert.equal(await resolveGhostChain("u1", { endpoints: ENDPOINTS }), null);
  assert.equal(await resolveGhostChain("u1", { sb: fakePrefsDb({}) }), null);
});

// ── Cuota freemium (req §2-Item 5.2 — carrera) ──────────────────────────────

/** rpc fake con la MISMA semántica de consume_llm_quota: UNA sola sentencia
 *  (acá, la sección crítica del single-thread de node) que incrementa y
 *  devuelve out_calls. Nada vuelve a leer el valor: el returning ES la verdad. */
function fakeQuotaDb({ initial = 0, fail = false } = {}) {
  let used = initial;
  return {
    used: () => used,
    rpc: (_name, params) => ({
      single: async () => {
        if (fail) return { data: null, error: { message: "conexión a la DB rehusada" } };
        used += Math.max(1, Number(params?.p_cost) || 1);
        return { data: { out_calls: used, out_window: new Date().toISOString() }, error: null };
      },
    }),
  };
}

test("platformFreeRunLimit: default 30; env entero >0 respeta; basura/0/negativo caen a 30", () => {
  assert.equal(platformFreeRunLimit({}), 30);
  assert.equal(platformFreeRunLimit({ PLATFORM_FREE_GHOST_RUNS: "5" }), 5);
  assert.equal(platformFreeRunLimit({ PLATFORM_FREE_GHOST_RUNS: "cincuenta" }), 30);
  assert.equal(platformFreeRunLimit({ PLATFORM_FREE_GHOST_RUNS: "0" }), 30);
  assert.equal(platformFreeRunLimit({ PLATFORM_FREE_GHOST_RUNS: "-3" }), 30);
});

test("CARRERA (§2-Item 5.2): 2 claims simultáneos del último run → exactamente 1 ganador", async () => {
  const db = fakeQuotaDb({ initial: 29 });
  const [a, b] = await Promise.all([
    checkAndConsumeQuota(db, "u1", { limit: platformFreeRunLimit({}) }),
    checkAndConsumeQuota(db, "u1", { limit: platformFreeRunLimit({}) }),
  ]);
  const winners = [a, b].filter(r => r.ok);
  assert.equal(winners.length, 1);              // 1 solo ganador
  assert.deepEqual(winners[0], { ok: true, used: 30, limit: 30, remaining: 0 });
  const losers = [a, b].filter(r => !r.ok);
  assert.equal(losers.length, 1);
  assert.deepEqual(losers[0], { ok: false, used: 30, limit: 30, remaining: 0 }); // used capado al límite
  assert.equal(db.used(), 31);                  // el contador real NO mintió (31 = 30+1)
});

test("cuota: consumos secuenciales dentro del límite descuentan y reportan remaining", async () => {
  const db = fakeQuotaDb({ initial: 0 });
  const limit = platformFreeRunLimit({ PLATFORM_FREE_GHOST_RUNS: "5" });
  const results = [];
  for (let i = 0; i < 3; i++) results.push(await checkAndConsumeQuota(db, "u1", { limit }));
  assert.deepEqual(results.map(r => r.used), [1, 2, 3]);
  assert.deepEqual(results.map(r => r.remaining), [4, 3, 2]);
  assert.ok(results.every(r => r.ok));
});

test("cuota: DB caída LANZA — fail-closed es del caller (nunca cuota infinita)", async () => {
  await assert.rejects(
    () => checkAndConsumeQuota(fakeQuotaDb({ fail: true }), "u1", { limit: 30 }),
    /rehusada/,
  );
});

test("peekQuota: check-only — vigente 29/30 queda 1; 30/30 rechaza; ventana vieja cuenta 0; error → null", async () => {
  const fakePeekDb = (data, error = null) => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error }) }) }) }),
  });
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  const oldStart = "2000-01-01T00:00:00Z";
  assert.deepEqual(
    await peekQuota(fakePeekDb({ window_start: monthStart, platform_calls: 29 }), "u1", 30),
    { ok: true, used: 29, limit: 30, remaining: 1 },
  );
  assert.deepEqual(
    await peekQuota(fakePeekDb({ window_start: monthStart, platform_calls: 30 }), "u1", 30),
    { ok: false, used: 30, limit: 30, remaining: 0 },
  );
  assert.deepEqual(
    await peekQuota(fakePeekDb({ window_start: oldStart, platform_calls: 999 }), "u1", 30),
    { ok: true, used: 0, limit: 30, remaining: 30 }, // ventana vencida: el gate la reinicia al próximo consumo
  );
  assert.equal(await peekQuota(fakePeekDb(null, { message: "rls" }), "u1", 30), null);
});

// ── Contratos de source (gate, proxy, migración, badge) ────────────────────

test("mcp.mjs: el gate cobra ANTES de insertJob en tab Y queued_no_tab; headless no paga", () => {
  const mcp = read("worker/runtime/functions/mcp.mjs");
  assert.equal((mcp.match(/await chargePlatformRun\(\)/g) || []).length, 2);
  assert.equal((mcp.match(/if \(!ghostCharge\.ok\) return ghostCharge;/g) || []).length, 2);
  assert.equal((mcp.match(/tier: ghostTier/g) || []).length, 3); // 3 insertJob llevan tier
  assert.match(mcp, /reasonCode: "FREEMIUM_QUOTA_EXHAUSTED"/);
  assert.match(mcp, /reasonCode: "PLATFORM_LLM_UNAVAILABLE"/);
});

test("mcp.mjs: todo rechazo de la capa plataforma queda en el log del operador (Item 3)", () => {
  const mcp = read("worker/runtime/functions/mcp.mjs");
  assert.match(mcp, /const rejectGhostChain = \(rejection\) => \{[\s\S]*?console\.error\(`\[ghost_perform\] capa plataforma rechazó el run: \$\{rejection\.reasonCode\}[\s\S]*?`\);[\s\S]*?return rejection;/);
  // los 4 puntos de rechazo pasan por el wrapper
  assert.equal((mcp.match(/rejectGhostChain\(chainRejection\(/g) || []).length, 4);
});

test("llmProxy.ts: X-Musa-Quota-Remaining en las 3 salidas (SSE webResponse, SSE express, JSON)", () => {
  const proxy = read("api/src/routes/llmProxy.ts");
  // con comillas = las 3 llamadas reales (set/setHeader/setHeader); el nombre
  // suelto en comentarios no cuenta.
  assert.equal((proxy.match(/"X-Musa-Quota-Remaining"/g) || []).length, 3);
  assert.match(proxy, /peekQuota\(getSupabaseAdmin\(\), userId, platformFreeRunLimit\(\)\)/);
  // agotada = 402 con el token que clasifica el bridge; DB caída = 503 técnico
  assert.match(proxy, /status\(402\)[\s\S]{0,200}FREEMIUM_QUOTA_EXHAUSTED/);
  assert.match(proxy, /status\(503\)[\s\S]{0,160}no se pudo verificar la cuota/);
});

test("llm_quota_v58.sql: upsert atómico en UNA sentencia, RLS y rollback documentados", () => {
  const sql = read("supabase_migrations/llm_quota_v58.sql");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS llm_quota_usage/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION consume_llm_quota/);
  assert.match(sql, /INSERT INTO llm_quota_usage AS q[\s\S]*?ON CONFLICT \(user_id\) DO UPDATE[\s\S]*?RETURNING q\.platform_calls, q\.window_start INTO out_calls, out_window;/);
  // rollback reconstruible (regla §6)
  assert.match(sql, /DROP FUNCTION IF EXISTS consume_llm_quota/);
  assert.match(sql, /DROP TABLE IF EXISTS llm_quota_usage/);
});

test("bridge: badge con tier y cuota — header con guard Number(null)≠0 y setLabel en vivo", () => {
  const bridge = read("src/lib/ghostBridge.ts");
  assert.match(bridge, /ghost\.start\(badgeLabel\(llmInfo\.tier, llmInfo\.provider, null\)\)/);
  assert.match(bridge, /remainingRaw == null \? NaN : Number\(remainingRaw\)/);
  assert.match(bridge, /onQuotaRemaining\?\.\(remaining\)/);
  assert.match(bridge, /ghost\.setLabel\(badgeLabel\(/);
  assert.match(bridge, /jobTier === "platform" \? null : await preflightLeaderLlm\(\)/); // jobs platform saltan preflight BYOK
  const cursor = read("src/lib/ghostCursor.ts");
  assert.match(cursor, /text\.id = "ghost-badge-text"/);
  assert.match(cursor, /setLabel\(label: string\)/);
  const fab = read("src/components/ChatFAB.tsx");
  assert.match(fab, /Sin llave: el Ghost usa la IA de Musa gratis \(30 runs\/mes\)\. Con tu llave: ilimitado\./);
});

test("resolveTextLlm delega en pickPlatformLlm (compartida, no duplicada) y la cadena no importa en ciclo", () => {
  const core = read("worker/runtime/functions/musa-batch-core.mjs");
  assert.match(core, /const platform = pickPlatformLlm\(PROVIDER_ENDPOINTS\);\s*\n\s*if \(platform\) return platform;/);
  // las branches de env key duplicadas murieron: solo quedan en comentarios
  const code = core.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /ZHIPU_API_KEY|OPENROUTER_API_KEY/);
  const chain = read("worker/runtime/functions/ghostLlmChain.mjs");
  assert.doesNotMatch(chain, /^\s*import .*musa-batch-core/m); // sin ciclos
  assert.doesNotMatch(chain, /^\s*import .*ghost-preflight/m);
});
