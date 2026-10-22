import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { BufferPublisher, verifyZernioSignature, buildZernioPayload } from "../api/src/services/socialPublishing.ts";
import { isZernioWebhookRequest, prepareSocialMedia, publicSocialMediaUrl, socialMediaType } from "../shared/socialPublishRequest.ts";
import { zonedDateTimeToIso } from "../shared/socialSchedule.ts";

const row = { id: "piece", workspace_id: "ws", template_id: "tpl", frame_id: "frame" };
function mediaDeps(overrides = {}) {
  const calls = [];
  return { calls,
    loadTemplate: async id => { calls.push(["load", id]); return { workspaceId: "ws", frames: [{ id: "frame", html: "<h1>Fresh art</h1>", width: 1080, height: 1350 }] }; },
    render: async source => { calls.push(["render", source]); return "data:image/png;base64,YQ=="; },
    upload: async data => { calls.push(["upload", data]); return "https://storage.example/art.png"; }, ...overrides };
}
test("linked exact frame is freshly rasterized and uploaded before publication", async () => {
  const deps = mediaDeps();
  assert.equal(await prepareSocialMedia(row, "", "post", deps), "https://storage.example/art.png");
  assert.deepEqual(deps.calls.map(call => call[0]), ["load", "render", "upload"]);
  assert.equal(deps.calls[1][1].height, 1350);
});
test("missing, ambiguous, foreign and unrenderable designs stop without text fallback", async () => {
  for (const template of [{ workspaceId: "other", frames: [] }, { workspaceId: "ws", frames: [] }]) {
    const deps = mediaDeps({ loadTemplate: async () => template });
    await assert.rejects(prepareSocialMedia(row, "", "post", deps));
    assert.equal(deps.calls.length, 0);
  }
  const deps = mediaDeps({ render: async () => { throw new Error("raster failed"); } });
  await assert.rejects(prepareSocialMedia(row, "", "post", deps), /raster failed/);
  assert.equal(deps.calls.some(call => call[0] === "upload"), false);
  await assert.rejects(prepareSocialMedia({ ...row, frame_id: null }, "", "post", mediaDeps({ loadTemplate: async () => ({ workspaceId: "ws", frames: [{ id: "a" }, { id: "b" }] }) })), /Selecciona/);
});
test("explicit media skips export; static design cannot silently become a Reel", async () => {
  const deps = mediaDeps();
  assert.equal(await prepareSocialMedia(row, "https://cdn.example/video.mp4", "reel", deps), "https://cdn.example/video.mp4");
  assert.equal(deps.calls.length, 0);
  await assert.rejects(prepareSocialMedia(row, "", "reel", deps), /video/);
  assert.throws(() => publicSocialMediaUrl("/assets/local.png"));
  assert.throws(() => publicSocialMediaUrl("https://localhost/a.png"));
});

const routeSource = fs.readFileSync(new URL("../api/src/routes/contentCalendar.ts", import.meta.url), "utf8");
const publishSource = routeSource.slice(routeSource.indexOf('contentRoutes.post("/:id/publish"'), routeSource.indexOf('contentRoutes.delete("/:id"'));
async function runPublish(existing, body, allowed = true) {
  let handler;
  const calls = [];
  const db = { from() {
    let patch;
    const query = { select() { return this; }, eq() { return this; }, in() { return this; }, update(value) { patch = value; calls.push(["update", value]); return this; },
      async maybeSingle() { return { data: patch ? { ...existing, ...patch } : existing }; }, async single() { return { data: { ...existing, ...patch } }; } };
    return query;
  } };
  const provider = { name: existing.publishing_provider || "zernio", publish: async payload => { calls.push(["publish", payload]); return { status: "published", externalId: "post", platformUrls: {} }; }, retry: async (...args) => { calls.push(["retry", args]); return { status: "published", externalId: "post", platformUrls: {} }; } };
  const context = { contentRoutes: { post: (_path, fn) => { handler = fn; } }, withSetupCheck: fn => fn,
    dbOr503: () => db, canAccessWorkspace: async () => allowed, getSupabaseAdmin: () => db,
    TIME_ZONES: new Set(["UTC", "America/Lima"]), SOCIAL_CONTENT_TYPES: new Set(["post", "story", "reel"]), SOCIAL_PROVIDERS: new Set(["buffer", "zernio"]),
    zonedDateTimeToIso, publicSocialMediaUrl, socialMediaType, publishProviderOrder: () => ["buffer", "zernio"],
    resolveSocialConnection: async () => ({ row: { id: "connection", provider: provider.name }, credentials: { apiKey: "private" }, config: { accounts: {} } }),
    createSocialPublisher: () => provider, newPublishRequestId: () => "new-request",
    listZernioAccounts: async () => { throw new Error("Retry must not query current accounts"); },
    listBufferAccounts: async () => { throw new Error("Retry must not query current accounts"); },
  };
  vm.runInNewContext(ts.transpileModule(publishSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const res = { code: 200, body: null, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
  await handler({ params: { id: existing.id }, auth: { userId: "user" }, body }, res);
  return { res, calls };
}
const snapshot = { requestId: "original", mode: "schedule", scheduledFor: "2025-01-01T12:00:00Z", timezone: "UTC", contentType: "post", content: "Original copy", channels: ["Instagram"], mediaUrl: "https://storage.example/original.png", accountRefs: [{ platform: "instagram", accountId: "original-account" }] };
const retryRow = { ...row, copy: "Edited copy", publishing_payload: snapshot, publishing_status: "error", publishing_provider: "buffer", publishing_request_id: "original", publishing_connection_id: "connection", publishing_destinations: { "original-account": { status: "published", externalId: "already-published" } } };
test("real publish handler replays original snapshot despite new UI accounts and edited copy", async () => {
  const { res, calls } = await runPublish(retryRow, { mode: "now", accountIds: ["wrong-account"], mediaUrl: "https://cdn.example/new.png" });
  assert.equal(res.code, 200);
  const payload = calls.find(call => call[0] === "publish")[1];
  assert.equal(payload.content, snapshot.content);
  assert.equal(payload.mediaUrl, snapshot.mediaUrl);
  assert.equal(payload.scheduledFor, snapshot.scheduledFor);
  assert.equal(payload.accountRefs[0].accountId, "original-account");
  assert.equal(payload.requestId, "original");
  assert.equal(payload.destinations["original-account"].externalId, "already-published");
});
test("minimal UI retry reaches Zernio retry endpoint, not another create", async () => {
  const { res, calls } = await runPublish({ ...retryRow, publishing_provider: "zernio", publishing_external_id: "existing-post" }, { retry: true });
  assert.equal(res.code, 200);
  assert.equal(calls.some(call => call[0] === "publish"), false);
  assert.equal(calls.find(call => call[0] === "retry")[1][0], "existing-post");
});
test("publish handler blocks missing linked artwork and unauthorized workspace before provider calls", async () => {
  const missing = await runPublish({ ...row, copy: "copy", channels: ["Instagram"] }, { mode: "now" });
  assert.equal(missing.res.code, 400);
  assert.equal(missing.calls.length, 0);
  const denied = await runPublish(retryRow, { retry: true }, false);
  assert.equal(denied.res.code, 403);
  assert.equal(denied.calls.length, 0);
});
test("Netlify outer guard admits only exact POST webhook path without weakening ordinary writes", () => {
  const source = fs.readFileSync(new URL("../worker/runtime/functions/api.mjs", import.meta.url), "utf8");
  const fn = source.slice(source.indexOf("function checkAdminKey"), source.indexOf("function createRequest"));
  const guard = vm.runInNewContext(`${fn}; checkAdminKey`, { process: { env: { MCP_ADMIN_KEY: "configured-admin" } }, isZernioWebhookRequest });
  assert.equal(guard({ httpMethod: "POST", path: "/api/content/webhooks/zernio/connection_1", headers: {} }), true);
  for (const path of ["/api/content/123/publish", "/api/content/webhooks/zernio/", "/api/content/webhooks/zernio/id/other", "/api/content/webhooks/zernio/id?foo=bar"]) {
    assert.equal(guard({ httpMethod: "POST", path, headers: {} }), false, path);
  }
  assert.equal(guard({ httpMethod: "PATCH", path: "/api/content/webhooks/zernio/id", headers: {} }), false);
});

test("Buffer retry skips accepted destinations and never retries an uncertain timeout", async () => {
  let saved = {};
  const sent = [];
  const publisher = new BufferPublisher("private", {}, async (_url, request) => {
    const account = JSON.parse(request.body).query.match(/channelId: "([^"]+)"/)[1];
    sent.push(account);
    const result = sent.length === 2 ? { message: "rejected" } : { post: { id: `post-${account}`, status: "sent" } };
    return new Response(JSON.stringify({ data: { createPost: result } }));
  });
  const input = { ...snapshot, mode: "now", accountRefs: [{ platform: "instagram", accountId: "a" }, { platform: "instagram", accountId: "b" }], saveDestinations: async value => { saved = value; } };
  assert.equal((await publisher.publish(input)).status, "partial");
  assert.equal((await publisher.publish({ ...input, destinations: saved })).status, "published");
  assert.deepEqual(sent, ["a", "b", "b"]);
  let attempts = 0;
  const uncertain = new BufferPublisher("private", {}, async () => { attempts++; throw new Error("timeout"); });
  await assert.rejects(uncertain.publish(input), /timeout/);
  await assert.rejects(uncertain.publish({ ...input, destinations: saved }), /incierto/);
  assert.equal(attempts, 1);
});

test("actual webhook handler rejects unsigned requests after Netlify bypass", async () => {
  let handler;
  const start = routeSource.indexOf('contentRoutes.post("/webhooks/zernio/:connectionId"');
  const end = routeSource.indexOf('\n}));', start) + 5;
  const db = { from() { return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { credentials_encrypted: "encrypted" } }; } }; } };
  const context = { contentRoutes: { post: (_path, fn) => { handler = fn; } }, asyncRoute: fn => fn, getSupabaseAdmin: () => db,
    decryptWorkspaceSecret: () => ({ webhookSecret: "only-this-connection" }), verifyZernioSignature };
  vm.runInNewContext(ts.transpileModule(routeSource.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const res = { code: 200, status(code) { this.code = code; return this; }, json() { return this; } };
  await handler({ params: { connectionId: "connection" }, rawBody: Buffer.from("{}"), header: () => undefined }, res);
  assert.equal(res.code, 401);
});

test("Story videos remain videos and Reel images fail before the provider", () => {
  const payload = buildZernioPayload({ ...snapshot, contentType: "story", mediaUrl: "https://cdn.example/story.mp4" }, {});
  assert.equal(payload.mediaItems[0].type, "video");
  assert.throws(() => buildZernioPayload({ ...snapshot, contentType: "reel" }, {}), /MP4/);
  for (const url of ["https://10.0.0.1/a", "https://172.16.0.1/a", "https://user:pass@example.com/a"]) assert.throws(() => publicSocialMediaUrl(url));
});

test("Buffer rejects video instead of sending it as an image", async () => {
  const publisher = new BufferPublisher("private", {}, async () => { throw new Error("Must not call provider"); });
  await assert.rejects(publisher.publish({ ...snapshot, mediaUrl: "https://cdn.example/video.mp4" }), /videos requieren Zernio/);
});
