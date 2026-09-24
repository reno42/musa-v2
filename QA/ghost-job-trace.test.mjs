// QA/ghost-job-trace.test.mjs — REQ-025.1 Item 3: telemetría del job.
// Verifica que un job fallido conserva un trace legible (phase + reasonCode)
// y que los merges nunca pisan lo ya escrito (accepted sobrevive). Corre con:
//   node --experimental-strip-types --test QA/ghost-job-trace.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { appendTrace, ghostTraceEvent } from "../src/lib/ghostJobTrace.ts";

test("ghostTraceEvent — timestamp ISO + ev + campos vacíos afuera", () => {
  const e = ghostTraceEvent("claimed", {
    provider: "deepseek", model: "deepseek-chat", keySource: "server", last4: null, note: "",
  });
  assert.equal(e.ev, "claimed");
  assert.ok(!Number.isNaN(Date.parse(e.t)));
  assert.equal(e.provider, "deepseek");
  assert.equal(e.model, "deepseek-chat");
  assert.equal(e.keySource, "server");
  assert.ok(!("last4" in e));      // null se omite
  assert.ok(!("note" in e));       // string vacío se omite
});

test("job fallido conserva trace legible: accepted → claimed → llm_first_call → failed(phase+reasonCode)", () => {
  const accepted = [ghostTraceEvent("accepted", { provider: "deepseek", model: "deepseek-chat", keySource: "server", last4: "eb52", reasonCode: "PREFLIGHT_OK" })];
  // El MCP insertó result = { trace: accepted }.
  let result = appendTrace(null, {}, accepted);
  assert.deepEqual(result.trace, accepted);

  // El bridge reclama (claimed) y la primera llamada LLM revienta con 402.
  result = appendTrace(result, { delivery: "tab" }, [ghostTraceEvent("claimed", { provider: "deepseek", model: "deepseek-chat", keySource: "server", last4: "eb52" })]);
  result = appendTrace(result, { delivery: "tab", error: "LLM 402: Insufficient Balance" }, [
    ghostTraceEvent("llm_first_call", { provider: "deepseek", model: "deepseek-chat", phase: "llm" }),
    ghostTraceEvent("failed", { phase: "llm", reasonCode: "BYOK_INSUFFICIENT_BALANCE", note: "LLM 402: Insufficient Balance" }),
  ]);

  assert.equal(result.delivery, "tab");
  assert.equal(result.error, "LLM 402: Insufficient Balance");
  assert.equal(result.trace.length, 4);
  const [acceptedEv, claimedEv, firstEv, failedEv] = result.trace;
  assert.equal(acceptedEv.ev, "accepted");
  assert.equal(claimedEv.ev, "claimed");
  assert.equal(firstEv.ev, "llm_first_call");
  assert.equal(failedEv.ev, "failed");
  assert.equal(failedEv.phase, "llm");
  assert.equal(failedEv.reasonCode, "BYOK_INSUFFICIENT_BALANCE");
  // Un query sobre result responde qué pasó y en qué fase.
  assert.ok([acceptedEv, claimedEv, firstEv, failedEv].every(e => e.t && e.ev));
});

test("appendTrace — el accepted previo NUNCA se pisa entre updates del bridge", () => {
  const base = { trace: [{ t: "2026-09-24T00:00:00Z", ev: "accepted" }], delivery: "tab" };
  const merged = appendTrace(base, { note: "x", steps: 3 }, [ghostTraceEvent("done", { phase: "agent" })]);
  assert.equal(merged.trace.length, 2);
  assert.equal(merged.trace[0].ev, "accepted"); // sobrevive
  assert.equal(merged.note, "x");
  assert.equal(merged.steps, 3);
  // El base no se muta (inmutabilidad — dos flushes en vuelo no se contaminan).
  assert.equal(base.trace.length, 1);
  assert.equal(base.note, undefined);
});

test("appendTrace — result basura (null/array/string) arranca limpio sin explotar", () => {
  for (const garbage of [null, undefined, [1, 2], "nope", 42]) {
    const merged = appendTrace(garbage, { delivery: "tab" }, [ghostTraceEvent("failed", { phase: "preflight", reasonCode: "BYOK_MISSING" })]);
    assert.equal(merged.delivery, "tab");
    assert.equal(merged.trace.length, 1);
    assert.equal(merged.trace[0].reasonCode, "BYOK_MISSING");
  }
});
