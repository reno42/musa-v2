/**
 * Authenticated QA seeding for the editor-interaction suites.
 *
 * The MCP fixture path (lib/mcp.mjs) only works when the local api accepts the
 * shared dev key; against a developer api that enforces MCP_ADMIN_KEY it 401s.
 * This module uses the repo's sanctioned QA channel instead (same pattern as
 * QA/second-brain-notes.test.mjs): seed a disposable auth user + owned
 * workspace + html template straight through Supabase REST with the service
 * key (loaded from the repo .env files IN-PROCESS — never logged, never
 * committed), mint a password-grant JWT, and inject the session into the
 * puppeteer page's localStorage so the editor boots logged-in.
 */

import { readFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");

function loadEnv(path) {
  if (!existsSync(path)) return {};
  const vars = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (v && !(k in vars)) vars[k] = v;
  }
  return vars;
}

// api/.env wins over root .env (same precedence as second-brain-notes).
const env = { ...loadEnv(resolve(root, ".env")), ...loadEnv(resolve(root, "api/.env")) };

const sbUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL || "";
const serviceKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_KEY || env.SUPABASE_SECRET_KEYS || "";
const publishable = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || "";

export function seedAvailable() {
  return Boolean(sbUrl && serviceKey && publishable);
}

/** supabase-js v2 default localStorage key for this project ref. */
export function authStorageKey() {
  const host = new URL(sbUrl).hostname;
  return `sb-${host.split(".")[0]}-auth-token`;
}

const UA = { "User-Agent": "musa-qa/1.0" };

/** Layers mirror lib/mcp.mjs nestedFrameHtml so clickLayer targets are stable. */
function fixtureFrameHtml() {
  return [
    '<div data-layer-id="card" data-layer-name="Card" style="position:absolute;left:80px;top:80px;width:520px;height:360px;background:#12203a;border-radius:24px;padding:40px;box-sizing:border-box;">',
    '  <h1 style="margin:0;font-family:sans-serif;font-size:44px;color:#EDE8DC;">QA anim</h1>',
    '  <p style="margin:16px 0 0;font-family:sans-serif;font-size:20px;color:#8A8375;">Capa de prueba.</p>',
    '</div>',
    '<div data-layer-id="pill" data-layer-name="Pill" style="position:absolute;left:80px;top:520px;width:220px;height:64px;background:#C8B898;border-radius:999px;"></div>',
    '<div data-layer-id="dot" data-layer-name="Dot" style="position:absolute;left:700px;top:120px;width:120px;height:120px;background:#EF4444;border-radius:50%;"></div>',
  ].join("\n");
}

/**
 * Seed user + owned workspace + 1-frame html template; return everything the
 * suite needs, including the Session for browser injection and a cleanup().
 */
export async function seedEditorFixture({ name = "QA — animation preset" } = {}) {
  if (!seedAvailable()) {
    throw new Error("seed: faltan SUPABASE_URL / service key / publishable key en .env o api/.env");
  }
  const email = `qa-anim-${Date.now()}@example.com`;
  const password = `Qa!${randomBytes(6).toString("hex")}A1`;
  const svc = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", ...UA, Prefer: "return=minimal" };

  // 1. Disposable auth user (admin API; the signup trigger provisions its own
  //    default workspace, but the suite uses the dedicated owned one below).
  const uRes = await fetch(`${sbUrl}/auth/v1/admin/users`, {
    method: "POST", headers: svc,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!uRes.ok) throw new Error(`seed: user HTTP ${uRes.status}`);
  const user = await uRes.json();
  if (!user?.id) throw new Error("seed: user sin id");

  // 1b. Unlock the account exactly like POST /api/account/nda-acceptance does
  //     (api/src/routes/saas.ts): user_profiles.nda_accepted_at + access_plan.
  //     personalized_onboarding_completed skips the welcome flow too. For a
  //     disposable QA user this is seeding, not a legal act.
  const pRes = await fetch(`${sbUrl}/rest/v1/user_profiles`, {
    method: "POST",
    headers: { ...svc, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      id: user.id,
      nda_accepted_at: new Date().toISOString(),
      access_plan: "friends_family",
      personalized_onboarding_completed: true,
    }),
  });
  if (!pRes.ok) throw new Error(`seed: user_profiles HTTP ${pRes.status}`);

  // 2. Owned workspace → canAccessWorkspace(..., "editor") passes for the JWT.
  const wsId = crypto.randomUUID();
  const wsRes = await fetch(`${sbUrl}/rest/v1/workspaces`, {
    method: "POST", headers: svc,
    body: JSON.stringify({
      id: wsId, name: `QA Anim ${Date.now()}`, slug: `qa-anim-${Date.now()}`,
      owner_id: user.id, data: {}, updated_at: new Date().toISOString(),
    }),
  });
  if (!wsRes.ok) throw new Error(`seed: workspace HTTP ${wsRes.status}`);

  // 3. Template row — data JSONB is the full DesignTemplate (frames inside),
  //    exactly what GET/PUT /api/templates/:id serve to the editor.
  const frameId = `frame_qa_anim_${Date.now()}`;
  const templateId = `tpl_qa_anim_${randomBytes(5).toString("hex")}`;
  const now = new Date().toISOString();
  const design = {
    id: templateId, name, workspaceId: wsId,
    width: 1080, height: 1080, engine: "html", html: "", css: "",
    frames: [{
      id: frameId, name: "QA anim", x: 0, y: 0, width: 1080, height: 1080,
      background: "#0E0D0B", html: fixtureFrameHtml(), css: "",
    }],
    canvasObjects: [], styles: [], comments: [], versions: [],
    variables: { collections: [], variables: [], bindings: {} },
    metadata: { createdAt: now, updatedAt: now },
  };
  const tRes = await fetch(`${sbUrl}/rest/v1/templates`, {
    method: "POST", headers: svc,
    body: JSON.stringify({ id: templateId, name, workspace_id: wsId, user_id: user.id, data: design }),
  });
  if (!tRes.ok) throw new Error(`seed: template HTTP ${tRes.status}`);

  // 4. Session for the browser (password grant → full Session JSON).
  const tokRes = await fetch(`${sbUrl}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: publishable, "Content-Type": "application/json", ...UA },
    body: JSON.stringify({ email, password }),
  });
  if (!tokRes.ok) throw new Error(`seed: token HTTP ${tokRes.status}`);
  const session = await tokRes.json();
  if (!session?.access_token) throw new Error("seed: token sin access_token");

  async function cleanup() {
    const del = (url) => fetch(url, { method: "DELETE", headers: svc }).catch(() => {});
    await del(`${sbUrl}/rest/v1/templates?id=eq.${templateId}`);
    await del(`${sbUrl}/rest/v1/workspaces?id=eq.${wsId}`);
    await del(`${sbUrl}/auth/v1/admin/users/${user.id}`);
  }

  return { templateId, frameId, workspaceId: wsId, userId: user.id, email, session, cleanup };
}

/**
 * Read the seeded template straight from the DB (service key) — used to assert
 * the editor's autosave actually persisted frame.animation.
 */
export async function fetchTemplateRow(templateId) {
  const res = await fetch(`${sbUrl}/rest/v1/templates?id=eq.${templateId}&select=data`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, ...UA },
  });
  if (!res.ok) throw new Error(`fetchTemplateRow HTTP ${res.status}`);
  const rows = await res.json();
  return rows?.[0]?.data || null;
}

/**
 * Inject the supabase-js v2 session into localStorage BEFORE any app script runs.
 *
 * RETIREMENT BY SEQUENCE + STAMP (sessionStorage): evaluateOnNewDocument es
 * permanente por vida de la página y no se puede des-registrar, y pueden
 * convivir varios handlers de suites distintas (página compartida del runner).
 * Cada inject recibe un seq creciente y un stamp único (seq + user id); el
 * handler escribe solo si su seq supera al guardado, o si siendo el vigente
 * aún no estampó su sesión. Así, en CUALQUIER orden de ejecución, gana el
 * inject más nuevo; un handler cuya sesión ya corrió (o fue limpiada por
 * clearInjectedSession) queda retirado y no resucita sesiones muertas en las
 * navegaciones de las suites siguientes. No sirve comparar el token: todos
 * los JWT del proyecto comparten el mismo header ES256 (~40 chars), por lo
 * que un slice(0,40) hacía que un segundo inject en la misma tab viera "mi
 * stamp" y no escribiera nada.
 */
let injectSeq = 0;
export async function injectSession(page, session) {
  const seq = ++injectSeq;
  const stamp = `qa-${seq}-${(session?.user?.id || "").slice(0, 12)}`;
  await page.evaluateOnNewDocument((key, sess, mySeqStr, myStamp) => {
    try {
      const prevSeq = Number(window.sessionStorage.getItem("futuraria-qa-session-seq") || "0");
      const prevStamp = window.sessionStorage.getItem("futuraria-qa-session-stamp") || "";
      if (Number(mySeqStr) < prevSeq) return; // un inject más nuevo ya tomó esta página
      if (Number(mySeqStr) === prevSeq && prevStamp === myStamp) return; // ya escribí/fui limpiado
      window.sessionStorage.setItem("futuraria-qa-session-seq", mySeqStr);
      window.sessionStorage.setItem("futuraria-qa-session-stamp", myStamp);
      window.localStorage.setItem(key, JSON.stringify(sess));
    } catch { /* storage bloqueado */ }
  }, authStorageKey(), session, String(seq), stamp);
}

/**
 * Drop the injected session so suites that run later in the same tab start
 * from a neutral auth state (their login-wall flow signs in with the
 * persistent QA user again). Deliberately does NOT lower the seq stored in
 * sessionStorage: that would resurrect a retired (dead) handler's session on
 * the very next navigation.
 */
export async function clearInjectedSession(page) {
  await page.evaluate((key) => {
    try { window.localStorage.removeItem(key); } catch { /* storage bloqueado */ }
  }, authStorageKey()).catch(() => { /* page gone: nada que limpiar */ });
}
