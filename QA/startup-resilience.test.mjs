import assert from "node:assert/strict";
import test from "node:test";
import { apiFetch } from "../src/lib/supabase.ts";
import { bootstrapAccountSession } from "../src/lib/accountBootstrap.ts";
import { validateBearerToken } from "../api/src/services/bearerValidation.ts";
import {
  createSupabaseFetch,
  supabaseClientOptions,
  supabaseFetch,
  supabaseRequestDeadlineMs,
} from "../api/src/services/supabase.ts";
import {
  LEGACY_TEMPLATE_CACHE_KEY,
  clearLegacyTemplateCache,
  readTemplateCache,
  templateCacheKey,
  writeTemplateCache,
} from "../src/lib/templateCache.ts";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("concurrent identical GETs share one browser request", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    await new Promise(resolve => setTimeout(resolve, 20));
    return jsonResponse({ success: true, calls });
  };
  try {
    const [first, second] = await Promise.all([
      apiFetch("/api/test/dedupe-a", { retries: 0 }),
      apiFetch("/api/test/dedupe-a", { retries: 0 }),
    ]);
    assert.equal(calls, 1);
    assert.deepEqual(first, second);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GET retries a transient 504, while a POST does not", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  let getCalls = 0;
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "POST") return jsonResponse({ error: "slow" }, 504);
    getCalls += 1;
    return getCalls === 1
      ? jsonResponse({ error: "slow" }, 504)
      : jsonResponse({ success: true });
  };
  try {
    assert.deepEqual(await apiFetch("/api/test/retry-a"), { success: true });
    assert.equal(getCalls, 2);
    await assert.rejects(
      apiFetch("/api/test/write-a", { method: "POST", retries: 5 }),
      /API error: 504/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a non-transient GET failure is not retried", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse({ error: "missing" }, 404);
  };
  try {
    await assert.rejects(apiFetch("/api/test/missing-a", { retries: 2 }), /API error: 404/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("account bootstrap is shared and cached per user", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    await new Promise(resolve => setTimeout(resolve, 20));
    return jsonResponse({ success: true, data: { personalWorkspaceId: "ws_bootstrap" } });
  };
  const session = { access_token: "token-bootstrap-a", user: { id: "user-bootstrap-a" } };
  const [first, second] = await Promise.all([
    bootstrapAccountSession(session, { fetchImpl, retries: 0 }),
    bootstrapAccountSession(session, { fetchImpl, retries: 0 }),
  ]);
  const third = await bootstrapAccountSession(session, { fetchImpl, retries: 0 });
  assert.equal(calls, 1);
  assert.deepEqual(first, second);
  assert.deepEqual(second, third);
});

test("concurrent API requests share one Supabase bearer validation", async () => {
  let calls = 0;
  const authClient = {
    auth: {
      async getUser() {
        calls += 1;
        await new Promise(resolve => setTimeout(resolve, 20));
        return { data: { user: { id: "user-auth-a" } }, error: null };
      },
    },
  };
  const results = await Promise.all([
    validateBearerToken(authClient, "bearer-auth-a"),
    validateBearerToken(authClient, "bearer-auth-a"),
    validateBearerToken(authClient, "bearer-auth-a"),
  ]);
  assert.deepEqual(results, ["user-auth-a", "user-auth-a", "user-auth-a"]);
  assert.equal(calls, 1);
  assert.equal(await validateBearerToken(authClient, "bearer-auth-a"), "user-auth-a");
  assert.equal(calls, 1, "the short cache should absorb the rest of the startup burst");
});

test("failed bearer validation is not cached", async () => {
  let calls = 0;
  const authClient = {
    auth: {
      async getUser() {
        calls += 1;
        return calls === 1
          ? { data: { user: null }, error: new Error("temporary") }
          : { data: { user: { id: "user-auth-b" } }, error: null };
      },
    },
  };
  assert.equal(await validateBearerToken(authClient, "bearer-auth-b"), null);
  assert.equal(await validateBearerToken(authClient, "bearer-auth-b"), "user-auth-b");
  assert.equal(calls, 2);
});

test("a retryable Supabase Auth failure stays retryable instead of becoming an invalid session", async () => {
  const authClient = {
    auth: {
      async getUser() {
        return {
          data: { user: null },
          error: Object.assign(new Error("fetch failed"), { name: "AuthRetryableFetchError", status: 0 }),
        };
      },
    },
  };
  await assert.rejects(
    validateBearerToken(authClient, "bearer-auth-network-a"),
    /fetch failed/,
  );
});

test("Supabase REST/auth calls have deadlines below the platform watchdog, while Storage does not", () => {
  const restDeadline = supabaseRequestDeadlineMs("https://project.supabase.co/rest/v1/templates?select=*");
  const authDeadline = supabaseRequestDeadlineMs("https://project.supabase.co/auth/v1/user");
  assert.ok(restDeadline > 0 && restDeadline < 9_000);
  assert.ok(authDeadline > 0 && authDeadline < 9_000);
  assert.equal(
    supabaseRequestDeadlineMs("https://project.supabase.co/storage/v1/object/design-assets/file.psd"),
    null,
  );
});

test("admin/auth and per-request scoped clients all use the deadline-aware fetch", () => {
  const admin = supabaseClientOptions();
  const scoped = supabaseClientOptions("user-token");
  assert.equal(admin.global.fetch, supabaseFetch);
  assert.equal(scoped.global.fetch, supabaseFetch);
  assert.deepEqual(scoped.global.headers, { Authorization: "Bearer user-token" });
});

test("the Supabase fetch wrapper actively cancels a timed-out REST request", async () => {
  let observedAbort = false;
  const hangingFetch = (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      observedAbort = true;
      reject(init.signal.reason);
    }, { once: true });
  });
  const timedFetch = createSupabaseFetch(hangingFetch, () => 15);
  await assert.rejects(
    timedFetch("https://project.supabase.co/rest/v1/templates"),
    error => error?.name === "TimeoutError",
  );
  assert.equal(observedAbort, true);
});

test("Storage requests keep their normal lifetime and are not given the REST deadline", async () => {
  let receivedSignal;
  const immediateFetch = async (_input, init) => {
    receivedSignal = init?.signal;
    return jsonResponse({ ok: true });
  };
  const wrappedFetch = createSupabaseFetch(immediateFetch);
  await wrappedFetch("https://project.supabase.co/storage/v1/object/design-assets/large.psd");
  assert.equal(receivedSignal, undefined);
});

function memoryStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    has: key => values.has(key),
  };
}

test("template cache is isolated by user and workspace and unavailable before identity", () => {
  const storage = memoryStorage();
  const now = 10_000;
  assert.equal(writeTemplateCache("user-a", "ws-a", [{ id: "tpl-a", workspaceId: "ws-a" }], { storage, now }), true);
  assert.deepEqual(readTemplateCache("user-a", "ws-a", { storage, now }), [{ id: "tpl-a", workspaceId: "ws-a" }]);
  assert.deepEqual(readTemplateCache("user-b", "ws-a", { storage, now }), []);
  assert.deepEqual(readTemplateCache("user-a", "ws-b", { storage, now }), []);
  assert.deepEqual(readTemplateCache(undefined, undefined, { storage, now }), []);
});

test("expired, malformed, cross-workspace and legacy template caches are discarded", () => {
  const now = 2_000_000;
  const expiredKey = templateCacheKey("user-a", "ws-a");
  const poisonedKey = templateCacheKey("user-a", "ws-b");
  const storage = memoryStorage({
    [LEGACY_TEMPLATE_CACHE_KEY]: JSON.stringify({ data: [{ id: "legacy" }] }),
    [expiredKey]: JSON.stringify({ version: 2, userId: "user-a", workspaceId: "ws-a", ts: 1, data: [] }),
    [poisonedKey]: JSON.stringify({ version: 2, userId: "user-a", workspaceId: "ws-b", ts: now, data: [{ id: "tpl-x", workspaceId: "ws-other" }] }),
  });
  clearLegacyTemplateCache(storage);
  assert.equal(storage.has(LEGACY_TEMPLATE_CACHE_KEY), false);
  assert.deepEqual(readTemplateCache("user-a", "ws-a", { storage, now, ttlMs: 1_000 }), []);
  assert.equal(storage.has(expiredKey), false);
  assert.deepEqual(readTemplateCache("user-a", "ws-b", { storage, now }), []);
  assert.equal(storage.has(poisonedKey), false);
});
