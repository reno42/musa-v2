import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createExpressApp } from "../worker/express-shim.js";

async function request(route, handler) {
  const app = createExpressApp();
  app.get(route, handler);
  return app.__hono.request(`http://localhost${route}`);
}

test("send preserves an explicit JSON content type and status", async () => {
  const response = await request("/json-string", (_req, res) => {
    res.status(202).setHeader("Content-Type", "application/json; charset=utf-8");
    res.send('{"ok":true}');
  });

  assert.equal(response.status, 202);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(await response.text(), '{"ok":true}');
});

test("type and send return plain text", async () => {
  const response = await request("/text", (_req, res) => {
    res.type("text/plain").send("hola amigos");
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(await response.text(), "hola amigos");
});

test("write joins SSE chunks without corrupting binary data", async () => {
  const response = await request("/events", (_req, res) => {
    res.type("text/event-stream");
    res.write(Buffer.from("data: uno\n\n"));
    res.write(new Uint8Array([100, 97, 116, 97, 58, 32]));
    res.end("dos\n\n");
  });

  assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
  assert.equal(await response.text(), "data: uno\n\ndata: dos\n\n");
});

test("webResponse forwards a native ReadableStream without write buffering", async () => {
  let releaseSecondChunk;
  const secondChunkGate = new Promise((resolve) => { releaseSecondChunk = resolve; });
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("data: primero\n\n"));
    },
    async pull(controller) {
      await secondChunkGate;
      controller.enqueue(new TextEncoder().encode("data: segundo\n\n"));
      controller.close();
    },
  });
  let nativeResponse;
  let writeCalls = 0;

  const response = await request("/native-events", (_req, res) => {
    res.write = () => { writeCalls += 1; throw new Error("native streaming must not call write"); };
    nativeResponse = new Response(stream, {
      status: 206,
      headers: { "Content-Type": "text/event-stream" },
    });
    return res.webResponse(nativeResponse);
  });

  assert.strictEqual(response, nativeResponse);
  assert.strictEqual(response.body, stream);
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  assert.equal(writeCalls, 0);

  const reader = response.body.getReader();
  const first = await reader.read();
  assert.equal(new TextDecoder().decode(first.value), "data: primero\n\n");
  assert.equal(first.done, false);

  const secondRead = reader.read();
  let secondSettled = false;
  void secondRead.then(() => { secondSettled = true; });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(secondSettled, false);

  releaseSecondChunk();
  const second = await secondRead;
  assert.equal(new TextDecoder().decode(second.value), "data: segundo\n\n");
  assert.equal(second.done, false);
  assert.deepEqual(await reader.read(), { value: undefined, done: true });
});

test("the LLM proxy selects native streaming before its Express write fallback", () => {
  const source = readFileSync(new URL("../api/src/routes/llmProxy.ts", import.meta.url), "utf8");
  const nativeIndex = source.indexOf('(res as any).webResponse(new Response(upstream.body');
  const fallbackIndex = source.indexOf("res.write(Buffer.from(value))");

  assert.notEqual(nativeIndex, -1, "the Cloudflare path must reuse the upstream ReadableStream");
  assert.notEqual(fallbackIndex, -1, "the local Express fallback must remain available");
  assert.ok(nativeIndex < fallbackIndex, "native streaming must be selected before buffering writes");
});

test("end accepts a final body and preserves headers", async () => {
  const response = await request("/end", (_req, res) => {
    res.status(201).setHeader("X-Test", "yes").end("created");
  });

  assert.equal(response.status, 201);
  assert.equal(response.headers.get("x-test"), "yes");
  assert.equal(await response.text(), "created");
});

test("json keeps the existing response contract", async () => {
  const response = await request("/json", (_req, res) => {
    res.status(418).json({ ok: false });
  });

  assert.equal(response.status, 418);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.deepEqual(await response.json(), { ok: false });
});

test("bodyless statuses do not construct an invalid Fetch response", async () => {
  const response = await request("/empty", (_req, res) => {
    res.status(204).end();
  });

  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
});
