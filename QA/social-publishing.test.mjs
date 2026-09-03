import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  BufferPublisher,
  ZernioPublisher,
  buildZernioPayload,
  parseZernioAccounts,
  zernioPlatform,
  parseZernioWebhook,
  verifyZernioSignature,
  parseZernioInboxItem,
} from "../api/src/services/socialPublishing.ts";
import {
  SOCIAL_CAPABILITIES,
  pickPublishProvider,
  publishProviderOrder,
} from "../shared/socialProviders.ts";
import fs from "node:fs";

const base = {
  requestId: "req-1",
  content: "Hola mundo",
  channels: ["Instagram", "X"],
  mode: "schedule",
  scheduledFor: "2026-09-02T15:00:00",
  timezone: "America/Lima",
};

test("maps UI channel names to Zernio platform names", () => {
  assert.equal(zernioPlatform("Instagram"), "instagram");
  assert.equal(zernioPlatform("X"), "twitter");
  assert.equal(zernioPlatform("Email"), null);
});

test("builds a scheduled Zernio request with configured account ids", () => {
  const body = buildZernioPayload(base, { instagram: "ig-1", x: "x-1" });
  assert.deepEqual(body.platforms, [
    { platform: "instagram", accountId: "ig-1" },
    { platform: "twitter", accountId: "x-1" },
  ]);
  assert.equal(body.scheduledFor, base.scheduledFor);
  assert.equal(body.timezone, "America/Lima");
  assert.equal(String(body.scheduledFor).endsWith("Z"), false, "timezone must not be interpreted twice");
  assert.equal(body.publishNow, undefined);
});

test("rejects a channel without a configured Zernio account", () => {
  assert.throws(() => buildZernioPayload(base, { instagram: "ig-1" }), /X/);
});

test("parses account configuration without accepting arrays", () => {
  assert.deepEqual(parseZernioAccounts('{"Instagram":"ig-1"}'), { instagram: "ig-1" });
  assert.throws(() => parseZernioAccounts("[]"), /mapear/);
});

test("sends the stable request id and understands an idempotent response", async () => {
  let init;
  const publisher = new ZernioPublisher("secret", { instagram: "ig-1", x: "x-1" }, async (_url, request) => {
    init = request;
    return new Response(JSON.stringify({ existingPost: { _id: "post-1", status: "scheduled" } }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  });
  const result = await publisher.publish(base);
  assert.equal(init.headers["x-request-id"], "req-1");
  assert.equal(result.externalId, "post-1");
  assert.equal(result.status, "scheduled");
});

test("verifies the webhook HMAC against the exact raw body", () => {
  const raw = Buffer.from('{"event":"post.published"}');
  const signature = crypto.createHmac("sha256", "webhook-secret").update(raw).digest("hex");
  assert.equal(verifyZernioSignature(raw, signature, "webhook-secret"), true);
  assert.equal(verifyZernioSignature(Buffer.from("changed"), signature, "webhook-secret"), false);
});

test("parses published webhook URLs for persistence after reload", () => {
  const update = parseZernioWebhook({
    id: "evt-1", event: "post.published", timestamp: "2026-09-02T20:00:00Z",
    post: {
      _id: "post-1",
      platforms: [
        { platform: "instagram", status: "published", platformPostUrl: "https://instagram.example/post-1" },
        { platform: "facebook", status: "published", platformPostUrl: "https://facebook.example/post-1" },
      ],
    },
  });
  assert.equal(update.status, "published");
  assert.equal(update.permalink, "https://instagram.example/post-1");
  assert.deepEqual(update.platformUrls, {
    instagram: "https://instagram.example/post-1",
    facebook: "https://facebook.example/post-1",
  });
});

test("partial webhook remains a terminal error and carries platform detail", () => {
  const update = parseZernioWebhook({
    id: "evt-2", event: "post.partial", timestamp: "2026-09-02T20:00:00Z",
    post: {
      id: "post-2",
      platforms: [
        { platform: "instagram", status: "published", platformPostUrl: "https://instagram.example/post-2" },
        { platform: "facebook", status: "failed", errorMessage: "Token expired" },
      ],
    },
  });
  assert.equal(update.status, "partial");
  assert.match(update.error, /facebook: Token expired/);
});

test("retry uses Zernio retry endpoint and does not reinterpret failed as publishing", async () => {
  let calledUrl = "";
  const publisher = new ZernioPublisher("secret", {}, async (url) => {
    calledUrl = String(url);
    return new Response(JSON.stringify({ post: {
      _id: "post-3", status: "failed",
      platforms: [{ platform: "instagram", status: "failed", errorMessage: "Media rejected" }],
    } }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const result = await publisher.retry("post-3", "retry-1");
  assert.match(calledUrl, /posts\/post-3\/retry$/);
  assert.equal(result.status, "failed");
  assert.match(result.error, /Media rejected/);
});

test("Buffer uses its GraphQL endpoint and shareNow for immediate posts", async () => {
  let calledUrl = "";
  let query = "";
  const publisher = new BufferPublisher("buffer-secret", { instagram: "channel-ig" }, async (url, request) => {
    calledUrl = String(url);
    query = JSON.parse(String(request.body)).query;
    return new Response(JSON.stringify({ data: { createPost: { post: { id: "buffer-post-1", status: "sent" } } } }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  });
  const result = await publisher.publish({ ...base, channels: ["Instagram"], mode: "now", scheduledFor: undefined });
  assert.equal(calledUrl, "https://api.buffer.com");
  assert.match(query, /mode: shareNow/);
  assert.match(query, /channelId: "channel-ig"/);
  assert.equal(result.externalId, "buffer-post-1");
});

test("workspace BYOK never returns encrypted credentials and publishing resolves by workspace", () => {
  const route = fs.readFileSync(new URL("../api/src/routes/contentCalendar.ts", import.meta.url), "utf8");
  assert.match(route, /encryptWorkspaceSecret\(credentials\)/);
  assert.match(route, /decryptWorkspaceSecret<SocialConnectionSecret>/);
  assert.match(route, /\.eq\("workspace_id", workspaceId\)/);
  assert.doesNotMatch(route, /ZERNIO_API_KEY/);
  const publicResponse = route.slice(route.indexOf('contentRoutes.get("/integrations/social"'), route.indexOf('contentRoutes.put("/integrations/social'));
  assert.doesNotMatch(publicResponse, /credentials_encrypted:/);
});

test("Calendario and Tabla reuse one publish dropdown with now and schedule", () => {
  const ui = fs.readFileSync(new URL("../src/components/ContentTab.tsx", import.meta.url), "utf8");
  assert.match(ui, /const publishControls =/);
  assert.ok((ui.match(/publishControls\(/g) || []).length >= 2);
  assert.match(ui, /Post ahora/);
  assert.match(ui, /Story ahora/);
  assert.match(ui, /Reel ahora/);
  assert.match(ui, /Programar…/);
});

// ── Capability matrix: Buffer publishes; only Zernio owns inbox + CRM ──

test("capabilities: Buffer publishes and schedules, only Zernio has inbox and CRM capture", () => {
  assert.deepEqual(SOCIAL_CAPABILITIES.buffer, { publish: true, schedule: true, inbox: false, crmCapture: false });
  assert.deepEqual(SOCIAL_CAPABILITIES.zernio, { publish: true, schedule: true, inbox: true, crmCapture: true });
});

test("routing: posts prefer Buffer, stories and reels are Zernio-only, nothing without a key", () => {
  assert.deepEqual(publishProviderOrder("post"), ["buffer", "zernio"]);
  assert.deepEqual(publishProviderOrder("story"), ["zernio"]);
  assert.deepEqual(publishProviderOrder("reel"), ["zernio"]);
  assert.equal(pickPublishProvider(["buffer", "zernio"], "post"), "buffer");
  assert.equal(pickPublishProvider(["zernio"], "post"), "zernio", "Zernio alone still carries posts");
  assert.equal(pickPublishProvider(["buffer", "zernio"], "story"), "zernio");
  assert.equal(pickPublishProvider(["buffer"], "reel"), null, "Buffer cannot place reels");
  assert.equal(pickPublishProvider([], "post"), null);
});

// ── Zernio inbox parser ──

test("parses a Zernio inbox message with the author envelope", () => {
  const item = parseZernioInboxItem({
    _id: "m1", type: "message", platform: "Instagram",
    author: { name: "Ana", username: "ana.py", email: "ana@x.com" },
    content: "¿precio?", createdAt: "2026-09-01T10:00:00Z",
  });
  assert.equal(item.externalId, "m1");
  assert.equal(item.kind, "message");
  assert.equal(item.platform, "instagram");
  assert.equal(item.authorName, "Ana");
  assert.equal(item.authorHandle, "ana.py");
  assert.equal(item.authorEmail, "ana@x.com");
  assert.equal(item.content, "¿precio?");
  assert.equal(item.occurredAt, new Date("2026-09-01T10:00:00Z").toISOString());
});

test("marks comments, falls back to flat author fields and rejects shapeless rows", () => {
  const comment = parseZernioInboxItem({
    item: { id: "c1", type: "story_comment", authorHandle: "bob", text: "hola" },
  });
  assert.equal(comment.kind, "comment");
  assert.equal(comment.authorHandle, "bob");
  assert.equal(comment.authorName, "Sin nombre");
  assert.equal(comment.content, "hola");
  assert.ok(!comment.authorEmail);
  assert.ok(!comment.occurredAt);
  assert.equal(parseZernioInboxItem(null), null);
  assert.equal(parseZernioInboxItem({}), null);
});

// ── Presence: UI panes, wiring and routes ──

test("copywriting has the Bandeja pane and the Conexiones popover hands off to Configuración", () => {
  const ui = fs.readFileSync(new URL("../src/components/ContentTab.tsx", import.meta.url), "utf8");
  assert.match(ui, /pane === "inbox"/);
  assert.match(ui, /InboxPane/);
  assert.match(ui, />Bandeja</);
  assert.match(ui, /Conexiones\{publishProvider/);
  assert.match(ui, /Capturar al CRM/);
  assert.match(ui, /onOpenSettings\?: \(\) => void/);
  const dashboard = fs.readFileSync(new URL("../src/components/Dashboard.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /onOpenSettings=\{\(\) => setActiveTab\("configuracion"\)\}/);
  assert.ok(!dashboard.includes("`/content/integrations/social"), "Settings social calls must carry the /api prefix");
});

test("the API exposes inbox sync, reply and capture plus the routing policy", () => {
  const routes = fs.readFileSync(new URL("../api/src/routes/contentCalendar.ts", import.meta.url), "utf8");
  assert.match(routes, /integrations\/social\/zernio\/inbox"/);
  assert.match(routes, /inbox\/:itemId\/reply/);
  assert.match(routes, /inbox\/:itemId\/capture/);
  assert.match(routes, /pickPublishProvider\(connected\)/);
  assert.match(routes, /publishProviderOrder\(contentType\)/);
  assert.match(routes, /onConflict: "provider,external_id"/);
});

test("v43 creates social_inbox with provider+external_id uniqueness", () => {
  const sql = fs.readFileSync(new URL("../supabase_migrations_v43.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS social_inbox/);
  assert.match(sql, /UNIQUE \(provider, external_id\)/);
});
