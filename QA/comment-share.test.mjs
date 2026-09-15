/**
 * QA — Share growth loop (/c/:templateId, SharedDesignGate, private by
 * default, Google sign-in).
 *
 * Two layers:
 *  1. Content assertions — the wire contract between API, migration and UI
 *     stays honest without a live server.
 *  2. Real HTTP e2e against the LOCAL API (:3001) when it is up: inserts a
 *     throwaway template via Supabase REST, checks the public endpoint
 *     returns the design frames while is_public=true and 403 PRIVATE when
 *     false, then cleans up.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const read = (...parts) => readFileSync(resolve(root, ...parts), "utf8");

// ── 1. Content assertions ────────────────────────────────────────────

test("comments-share GET serves the full design (frames html/css) behind the is_public gate", () => {
  const route = read("api", "src", "routes", "commentShare.ts");
  assert.match(route, /MAX_SHARE_FRAMES = 30/);
  assert.match(route, /MAX_SHARE_FRAME_BYTES = 2 \* 1024 \* 1024/);
  assert.match(route, /payload\.frames/);
  assert.match(route, /framesTruncated/);
  assert.match(route, /is_public === false/);
  assert.match(route, /code: "PRIVATE"/);
  // Thumbnail now comes from the data JSONB (the old row column never existed).
  assert.match(route, /thumbnail: payload\.thumbnail/);
});

test("v50 makes is_public private by default for ALL designs", () => {
  assert.ok(existsSync(resolve(root, "supabase_migrations_v50.sql")), "falta supabase_migrations_v50.sql");
  const v50 = read("supabase_migrations_v50.sql");
  assert.match(v50, /ALTER COLUMN is_public SET DEFAULT FALSE/);
  assert.match(v50, /UPDATE templates\s+SET is_public = FALSE/);
  assert.equal(read(".migration-version").trim(), "v50", ".migration-version debe ser v50");
  // The editor no longer fails open.
  const editor = read("src", "pages", "EditorV2.tsx");
  assert.match(editor, /useState\(false\); \/\/ fail-closed: private by default/);
});

test("guest route renders SharedDesignGate; the old mobile-only page is gone", () => {
  assert.ok(existsSync(resolve(root, "src", "components", "SharedDesignGate.tsx")), "falta SharedDesignGate.tsx");
  assert.ok(!existsSync(resolve(root, "src", "components", "MobileComments.tsx")), "MobileComments.tsx debe estar eliminada");
  const app = read("src", "App.tsx");
  assert.match(app, /import \{ SharedDesignGate \} from "\.\/components\/SharedDesignGate"/);
  assert.match(app, /<SharedDesignGate templateId=\{route\.templateId\} \/>/);
  // The gate paints the real design blurred and lifts it in place.
  const gate = read("src", "components", "SharedDesignGate.tsx");
  assert.match(gate, /sg-board-locked/);
  assert.match(gate, /signInWithOAuth\(\{\s*provider: "google"/);
  assert.match(gate, /comments-share\/\$\{encodeURIComponent\(templateId\)\}/);
});

test("Google sign-in is available on the normal auth screen too", () => {
  const auth = read("src", "components", "AuthScreen.tsx");
  assert.match(auth, /auth-google/);
  assert.match(auth, /signInWithOAuth\(\{\s*provider: "google"/);
  assert.match(auth, /redirectTo: authRedirectUrl\(\)/);
});

test("comments-share stays public in the auth middleware (guests have no session yet)", () => {
  const auth = read("api", "src", "middleware", "auth.ts");
  assert.match(auth, /publicCommentShare/);
});

// ── 2. Real HTTP e2e (skipped when the local API is down) ───────────

function loadEnv(path) {
  if (!existsSync(path)) return {};
  const vars = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (value && !(key in vars)) vars[key] = value;
  }
  return vars;
}

test("e2e HTTP: público sirve frames, privado responde 403 PRIVATE", async (t) => {
  const env = { ...loadEnv(resolve(root, ".env")), ...loadEnv(resolve(root, "api", ".env")) };
  const base = "http://localhost:3001";
  let apiUp = false;
  try {
    const health = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(4000) });
    apiUp = health.ok;
  } catch { apiUp = false; }
  if (!apiUp) {
    t.skip("API :3001 no responde — e2e HTTP omitido (arranca el dev server para ejecutarlo)");
    return;
  }
  assert.ok(env.SUPABASE_URL && env.SUPABASE_SECRET_KEY, "faltan SUPABASE_URL/SUPABASE_SECRET_KEY en el entorno");

  const sbHeaders = {
    apikey: env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    "Content-Type": "application/json",
  };

  const wsRes = await fetch(`${env.SUPABASE_URL}/rest/v1/workspaces?select=id&limit=1`, { headers: sbHeaders });
  const ws = (await wsRes.json())[0];
  assert.ok(ws?.id, "no hay workspaces en Supabase");

  const templateId = `qa_share_${Date.now().toString(36)}`;
  const insert = await fetch(`${env.SUPABASE_URL}/rest/v1/templates`, {
    method: "POST",
    headers: sbHeaders,
    body: JSON.stringify({
      id: templateId,
      name: "QA share gate",
      workspace_id: ws.id,
      is_public: true,
      data: {
        width: 800, height: 600,
        thumbnail: null,
        frames: [{
          id: "qa_frame_1", name: "Portada", x: 0, y: 0, width: 800, height: 600,
          html: '<div class="qa-marker">QA SHARE MARKER</div>',
          css: '.qa-marker{color:#e8734a;font:700 40px sans-serif}',
        }],
      },
    }),
  });
  assert.ok(insert.ok, `insert de template falló: ${insert.status} ${await insert.text()}`);

  try {
    // Público: el invitado recibe el diseño real (frames html/css).
    const pub = await fetch(`${base}/api/comments-share/${templateId}`);
    const pubBody = await pub.json();
    assert.equal(pub.status, 200, `GET público respondió ${pub.status}`);
    assert.equal(pubBody.success, true);
    assert.equal(pubBody.data.template.frames.length, 1);
    assert.match(pubBody.data.template.frames[0].html, /QA SHARE MARKER/);
    assert.equal(pubBody.data.template.width, 800);
    assert.equal(pubBody.data.template.framesTruncated, false);

    // Privado: sin datos, código PRIVATE para que la gate muestre el modal.
    const priv = await fetch(`${env.SUPABASE_URL}/rest/v1/templates?id=eq.${templateId}`, {
      method: "PATCH",
      headers: sbHeaders,
      body: JSON.stringify({ is_public: false }),
    });
    assert.ok(priv.ok, `PATCH is_public falló: ${priv.status}`);

    const locked = await fetch(`${base}/api/comments-share/${templateId}`);
    const lockedBody = await locked.json();
    assert.equal(locked.status, 403, `GET privado respondió ${locked.status}`);
    assert.equal(lockedBody.code, "PRIVATE");
  } finally {
    await fetch(`${env.SUPABASE_URL}/rest/v1/templates?id=eq.${templateId}`, { method: "DELETE", headers: sbHeaders });
  }
});
