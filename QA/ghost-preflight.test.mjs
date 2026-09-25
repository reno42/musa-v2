// QA/ghost-preflight.test.mjs — REQ-025.1 Item 2: preflight BYOK del ghost.
// Mocks de los reasonCodes de fallo + camino OK + invariantes del contrato
// (max_tokens ~1, nunca plaintext, hint de rotación). REQ-028 agrega los 2
// códigos de la capa freemium (FREEMIUM_QUOTA_EXHAUSTED, PLATFORM_LLM_UNAVAILABLE).
// Corre con:
//   node --experimental-strip-types --test QA/ghost-preflight.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  GHOST_PREFLIGHT_REASON_CODES,
  buildPreflightBody,
  classifyPreflightFailure,
  freemiumCta,
  preflightViaProxy,
  rotationHint,
} from "../src/lib/ghostPreflight.ts";

test("los 7 reasonCodes BYOK + PREFLIGHT_OK + los 2 freemium (REQ-028) existen en el contrato", () => {
  assert.deepEqual([...GHOST_PREFLIGHT_REASON_CODES].sort(), [
    "BYOK_INSUFFICIENT_BALANCE",
    "BYOK_INVALID",
    "BYOK_MISSING",
    "BYOK_WRONG_ENDPOINT",
    "FREEMIUM_QUOTA_EXHAUSTED",
    "MODEL_FORBIDDEN",
    "PLATFORM_LLM_UNAVAILABLE",
    "PREFLIGHT_OK",
    "PROVIDER_RATE_LIMITED",
    "PROVIDER_UNAVAILABLE",
  ]);
});

test("BYOK_MISSING — 404 'No key configured' del relay /api/llm", () => {
  assert.equal(
    classifyPreflightFailure(404, '{"error":"No key configured for deepseek"}'),
    "BYOK_MISSING",
  );
});

test("BYOK_INVALID — 401 y 403 (error literal de DeepSeek con request_id)", () => {
  assert.equal(
    classifyPreflightFailure(401, '{"error":{"message":"Authentication Fails, Your api key: ****eb52 is invalid","request_id":"x"}}'),
    "BYOK_INVALID",
  );
  assert.equal(classifyPreflightFailure(403, '{"error":"forbidden"}'), "BYOK_INVALID");
});

test("BYOK_INSUFFICIENT_BALANCE — 402 (saldo agotado DeepSeek) y 429 insufficient_quota (formato OpenAI)", () => {
  assert.equal(classifyPreflightFailure(402, "Insufficient Balance"), "BYOK_INSUFFICIENT_BALANCE");
  assert.equal(
    classifyPreflightFailure(429, '{"error":{"type":"insufficient_quota","message":"You exceeded your current quota"}}'),
    "BYOK_INSUFFICIENT_BALANCE",
  );
});

test("BYOK_WRONG_ENDPOINT — 404 sin key ni modelo (HTML del endpoint mal puesto)", () => {
  assert.equal(classifyPreflightFailure(404, "<html><body>404 page not found</body></html>"), "BYOK_WRONG_ENDPOINT");
  assert.equal(classifyPreflightFailure(404, ""), "BYOK_WRONG_ENDPOINT");
});

test("MODEL_FORBIDDEN — 404 que menciona el modelo ('Model Not Exist' de DeepSeek)", () => {
  assert.equal(
    classifyPreflightFailure(404, '{"error":{"message":"Model Not Exist"}}'),
    "MODEL_FORBIDDEN",
  );
});

test("PROVIDER_RATE_LIMITED — 429 sin señal de quota agotada", () => {
  assert.equal(classifyPreflightFailure(429, '{"error":"rate limit exceeded, retry later"}'), "PROVIDER_RATE_LIMITED");
});

// REQ-028 — capa freemium: el token del reasonCode en el cuerpo manda sobre
// el status (un 402/503 del proxy no es del proveedor).
test("FREEMIUM_QUOTA_EXHAUSTED — el cuerpo del proxy manda sobre el status (402 y 503)", () => {
  assert.equal(classifyPreflightFailure(402, "FREEMIUM_QUOTA_EXHAUSTED: cuota 30/30 agotada"), "FREEMIUM_QUOTA_EXHAUSTED");
  assert.equal(classifyPreflightFailure(503, '{"error":"FREEMIUM_QUOTA_EXHAUSTED: limite mensual"}'), "FREEMIUM_QUOTA_EXHAUSTED");
});

test("PLATFORM_LLM_UNAVAILABLE — server sin env key (503 del relay)", () => {
  assert.equal(
    classifyPreflightFailure(503, "PLATFORM_LLM_UNAVAILABLE: el server no tiene ZHIPU_API_KEY ni OPENROUTER_API_KEY."),
    "PLATFORM_LLM_UNAVAILABLE",
  );
});

test("freemiumCta — CTA por causa (cuota con n/n y platform sin culpar al usuario)", () => {
  assert.equal(
    freemiumCta("FREEMIUM_QUOTA_EXHAUSTED", { used: 30, limit: 30 }),
    "Cuota gratis agotada (30/30). Subí tu llave en Configuración → Invita IAs para uso ilimitado.",
  );
  assert.equal(
    freemiumCta("FREEMIUM_QUOTA_EXHAUSTED"),
    "Cuota gratis agotada. Subí tu llave en Configuración → Invita IAs para uso ilimitado.",
  );
  assert.ok(freemiumCta("PLATFORM_LLM_UNAVAILABLE").includes("configuración del servidor"));
  assert.ok(freemiumCta("PLATFORM_LLM_UNAVAILABLE").includes("Invita IAs"));
  assert.equal(freemiumCta("BYOK_MISSING"), null); // los BYOK_* siguen con rotationHint
});

test("PROVIDER_UNAVAILABLE — 5xx, 502 del relay y red caída (post lanza)", async () => {
  assert.equal(classifyPreflightFailure(500, "internal"), "PROVIDER_UNAVAILABLE");
  assert.equal(classifyPreflightFailure(502, "upstream error"), "PROVIDER_UNAVAILABLE");
  assert.equal(classifyPreflightFailure(400, "unexpected"), "PROVIDER_UNAVAILABLE");
  const thrown = await preflightViaProxy({
    provider: "deepseek", model: "deepseek-chat",
    post: async () => { throw new Error("ECONNRESET"); },
  });
  assert.equal(thrown.ok, false);
  assert.equal(thrown.reasonCode, "PROVIDER_UNAVAILABLE");
  assert.equal(thrown.keySource, "server");
});

test("camino OK — ping vía /api/llm con max_tokens 1 y sin key en el payload", async () => {
  const seen = [];
  const post = async (url, init) => {
    seen.push({ url, body: JSON.parse(init.body) });
    return {
      ok: true, status: 200,
      text: async () => '{"choices":[{"message":{"content":"pong"}}]}',
    };
  };
  const r = await preflightViaProxy({ provider: "deepseek", model: "deepseek-chat", last4: "eb52", post });
  assert.equal(r.ok, true);
  assert.equal(r.reasonCode, "PREFLIGHT_OK");
  assert.equal(r.provider, "deepseek");
  assert.equal(r.model, "deepseek-chat");
  assert.equal(r.keySource, "server");
  assert.equal(r.last4, "eb52");
  assert.equal(r.latencyMs >= 0, true);
  assert.equal(seen[0].url, "/api/llm");
  assert.equal(seen[0].body.provider, "deepseek");
  assert.equal(seen[0].body.body.model, "deepseek-chat");
  assert.equal(seen[0].body.body.max_tokens, 1);
  assert.ok(!JSON.stringify(seen[0]).includes("sk-"));
});

test("buildPreflightBody — shape por proveedor (anthropic param propio, zhipu thinking off)", () => {
  const anthropic = buildPreflightBody("anthropic", "claude-sonnet-5");
  assert.equal(anthropic.max_tokens, 1);
  assert.ok(!("system" in anthropic) || anthropic.system === undefined);
  const zhipu = buildPreflightBody("zhipu", "glm-5.3-flash");
  assert.deepEqual(zhipu.thinking, { type: "disabled" });
  const plain = buildPreflightBody("deepseek", "deepseek-chat");
  assert.equal(plain.max_tokens, 1);
  assert.deepEqual(plain.messages, [{ role: "user", content: "ping" }]);
});

test("rotationHint — instrucción de rotación apunta a Configuración → Invita IAs", () => {
  assert.equal(rotationHint("deepseek", "DeepSeek"), "Configuración → Invita IAs → DeepSeek");
  assert.equal(rotationHint("desconocido"), "Configuración → Invita IAs → desconocido");
});
