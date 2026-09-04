import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  BufferPublisher,
  ZernioPublisher,
  buildZernioPayload,
  parseZernioAccounts,
  pickAccountsByIds,
  zernioPlatform,
  parseZernioWebhook,
  verifyZernioSignature,
  parseZernioInboxItem,
} from "../api/src/services/socialPublishing.ts";
import {
  SOCIAL_CAPABILITIES,
  pickPublishProvider,
  platformToChannel,
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

// ── Multi-account: explicit picks win over the per-channel default ──

test("platformToChannel translates provider platforms into calendar channels", () => {
  assert.equal(platformToChannel("instagram"), "Instagram");
  assert.equal(platformToChannel("twitter"), "X");
  assert.equal(platformToChannel("TIKTOK"), "TikTok");
  assert.equal(platformToChannel("gmb"), "Gmb");
  assert.equal(platformToChannel(""), "");
});

test("buildZernioPayload ships one platform entry per picked account", () => {
  // The whole point of multi-account: two Instagram accounts ride in one
  // post, side by side, and the legacy channel map is not consulted.
  const body = buildZernioPayload({
    ...base,
    channels: ["Instagram"],
    accountRefs: [
      { platform: "instagram", accountId: "ig-main" },
      { platform: "instagram", accountId: "ig-qr" },
      { platform: "twitter", accountId: "x-1" },
    ],
  }, {});
  assert.deepEqual(body.platforms, [
    { platform: "instagram", accountId: "ig-main" },
    { platform: "instagram", accountId: "ig-qr" },
    { platform: "twitter", accountId: "x-1" },
  ]);
});

test("explicit refs carry the story marker and reject unsupported platforms", () => {
  const story = buildZernioPayload({
    ...base, channels: ["Instagram"], contentType: "story",
    accountRefs: [{ platform: "instagram", accountId: "ig-main" }],
  }, {});
  assert.deepEqual(story.platforms[0].platformSpecificData, { contentType: "story" });
  assert.throws(() => buildZernioPayload({
    ...base, channels: [], accountRefs: [{ platform: "gmb", accountId: "g-1" }],
  }, {}), /no soporta la plataforma gmb/);
});

test("pickAccountsByIds resolves, collapses duplicates and refuses unknown or inactive ids", () => {
  const live = [
    { id: "ig-main", platform: "instagram", username: "acme", displayName: "Acme", profileUrl: null, isActive: true },
    { id: "ig-qr", platform: "instagram", username: "acme.qr", displayName: "Acme QR", profileUrl: null, isActive: true },
    { id: "x-old", platform: "twitter", username: "acme", displayName: "Acme X", profileUrl: null, isActive: false },
  ];
  // Unknown ids collect into one error AFTER the loop: the user fixes every
  // stale pick in one round, not one per retry.
  assert.deepEqual(pickAccountsByIds(live, ["ig-qr", "ig-main", "ig-qr"]), [
    { platform: "instagram", accountId: "ig-qr" },
    { platform: "instagram", accountId: "ig-main" },
  ]);
  assert.throws(() => pickAccountsByIds(live, ["nope"]), /nope/);
  assert.throws(() => pickAccountsByIds(live, ["x-old"]), /inactiva/);
  assert.throws(() => pickAccountsByIds(live, []), /al menos una cuenta/);
});

test("Buffer keys destinations by accountId when explicit refs arrive", async () => {
  const saved = [];
  const channelIds = [];
  const publisher = new BufferPublisher("buffer-secret", {}, async (url, request) => {
    channelIds.push(JSON.parse(String(request.body)).query.match(/channelId: "([^"]+)"/)[1]);
    return new Response(JSON.stringify({ data: { createPost: { post: { id: `bp-${channelIds.length}`, status: "sent" } } } }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  });
  const result = await publisher.publish({
    ...base, channels: ["Instagram"], mode: "now", scheduledFor: undefined,
    accountRefs: [
      { platform: "instagram", accountId: "ig-a" },
      { platform: "instagram", accountId: "ig-b" },
    ],
    saveDestinations: async d => { saved.push(structuredClone(d)); },
  });
  assert.deepEqual(channelIds, ["ig-a", "ig-b"]);
  assert.equal(result.externalId, "bp-1,bp-2", "one external id per destination, joined");
  const final = saved[saved.length - 1];
  assert.equal(final["ig-a"].channelId, "ig-a");
  assert.equal(final["ig-b"].channelId, "ig-b");
  assert.equal(final["ig-a"].externalId, "bp-1");
  assert.equal(final["ig-b"].externalId, "bp-2");
  assert.equal(final["ig-a"].status, "published");
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

// ── Multi-account wiring: routes resolve picks, dialog picks destinations ──

test("publish resolves accountIds against the live list and derives channels", () => {
  const routes = fs.readFileSync(new URL("../api/src/routes/contentCalendar.ts", import.meta.url), "utf8");
  const publishRoute = routes.slice(routes.indexOf('contentRoutes.post("/:id/publish"'));
  assert.match(publishRoute, /req\.body\.accountIds/);
  assert.match(publishRoute, /pickAccountsByIds\(live, accountIds\)/);
  assert.match(publishRoute, /platformToChannel\(ref\.platform\)/, "recorded channels stay in calendar vocabulary");
  assert.match(publishRoute, /req\.body\.provider/);
});

test("the accounts endpoint lists live accounts and caches them as knownAccounts", () => {
  const routes = fs.readFileSync(new URL("../api/src/routes/contentCalendar.ts", import.meta.url), "utf8");
  assert.match(routes, /integrations\/social\/:provider\/accounts/);
  const accountsRoute = routes.slice(routes.indexOf('contentRoutes.get("/integrations/social/:provider/accounts"'));
  assert.match(accountsRoute, /canAccessWorkspace\(req\.auth, workspaceId, "editor"\)/);
  assert.match(accountsRoute, /knownAccounts: accounts/);
});

test("PUT merges brandAccounts without clobbering saved accounts or other brands", () => {
  const routes = fs.readFileSync(new URL("../api/src/routes/contentCalendar.ts", import.meta.url), "utf8");
  const putRoute = routes.slice(
    routes.indexOf('contentRoutes.put("/integrations/social/:provider"'),
    routes.indexOf('contentRoutes.get("/integrations/social/:provider/accounts"'),
  );
  assert.match(putRoute, /brandAccountsIn/);
  assert.match(putRoute, /\(existing\?\.public_config as SocialConnectionConfig \| null\)\?\.accounts \|\| \{\}/,
    "an update without accounts keeps the saved mapping");
  assert.match(putRoute, /\(existing\?\.public_config as SocialConnectionConfig \| null\)\?\.brandAccounts \|\| \{\}/,
    "a partial brandAccounts body must not erase other brands' picks");
});

test("the dialog resolves destinations and the table schedules in one click", () => {
  const ui = fs.readFileSync(new URL("../src/components/ContentTab.tsx", import.meta.url), "utf8");
  assert.match(ui, /const publishRow = useState|const \[publishRow, setPublishRow\]/);
  assert.match(ui, /publishProviderOrder\(contentType\)/);
  assert.match(ui, /conn\.brandAccounts\[row\.brand_id\]/, "brand defaults preselect the dialog");
  assert.match(ui, /from === "sheet" && quickSchedule\(row\)/, "table: one click when fecha, hora and destinations exist");
  assert.match(ui, /openPublishDialog\(row, "schedule"\)/, "calendar always confirms through the dialog");
  assert.match(ui, /integrations\/social\/\$\\{provider\\}\/accounts|integrations\/social\/\$\{provider\}\/accounts/);
  assert.match(ui, /Guardar como destinos predeterminados/);
});

test("both views share the multi-brand filter and the sheet has a Marca column", () => {
  const ui = fs.readFileSync(new URL("../src/components/ContentTab.tsx", import.meta.url), "utf8");
  assert.match(ui, /brandIds: next\.length \? next : undefined/);
  assert.match(ui, /aria-label="Marcas"/);
  assert.match(ui, /aria-label="Marca de la pieza"/, "Marca is editable per row in the sheet");
  assert.ok(ui.includes('"Fecha", "Hora", "Tipo", "Marca"'), "Marca column lives beside Tipo");
  const lib = fs.readFileSync(new URL("../src/lib/contentCalendar.ts", import.meta.url), "utf8");
  assert.match(lib, /brandIds\?\.length \? f\.brandIds : f\.brandId/);
});
