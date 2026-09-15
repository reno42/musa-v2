/** QA — Preview reminder snooze (popup "Tu preview tiene cambios pendientes").
 *
 * 1. Unit: isPreviewStale / shouldShowPreviewReminder semantics (Fix B).
 * 2. Content: identity fix in designMeta (Fix A) + capture stamp (Fix C).
 * 3. E2E HTTP against :3001 — a workspace API key (x-api-key, no Bearer) can
 *    save and read a snooze (the exact silent-loss path users hit).
 *
 * Run: npx tsx QA/preview-reminder.test.mjs   (needs API on :3001 + Supabase env)
 */
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isPreviewStale, shouldShowPreviewReminder } from "../shared/previewReminder.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
let pass = 0, fail = 0;
function check(label, ok, detail = "") {
  if (ok) { pass++; console.log(`  PASS ${label}`); }
  else { fail++; console.error(`  FAIL ${label}${detail ? " — " + detail : ""}`); }
}

// ── 1. Unit semantics ─────────────────────────────────────────────
console.log("[1] previewReminder semantics");
const T0 = "2026-09-13T12:00:00Z";
const T1 = "2026-09-13T18:00:00Z";
check("sin captura → NO stale (Fix B)", isPreviewStale(T1, null) === false);
check("sin diseño → NO stale", isPreviewStale(null, T0) === false);
check("diseño > captura → stale", isPreviewStale(T1, T0) === true);
check("captura > diseño → NO stale", isPreviewStale(T0, T1) === false);
check("stale + sin snooze → mostrar", shouldShowPreviewReminder({ designUpdatedAt: T1, coverCapturedAt: T0 }) === true);
check("stale + snooze futuro → oculto", shouldShowPreviewReminder({ designUpdatedAt: T1, coverCapturedAt: T0, snoozedUntil: "2026-10-13T00:00:00Z", now: new Date("2026-09-14T00:00:00Z") }) === false);
check("stale + snooze vencido → mostrar", shouldShowPreviewReminder({ designUpdatedAt: T1, coverCapturedAt: T0, snoozedUntil: "2026-09-13T23:00:00Z", now: new Date("2026-09-14T00:00:00Z") }) === true);
check("fresco → oculto aunque sin snooze", shouldShowPreviewReminder({ designUpdatedAt: T0, coverCapturedAt: T1 }) === false);

// ── 2. Content assertions ─────────────────────────────────────────
console.log("[2] Fix A / Fix C en el código");
const metaSrc = readFileSync(resolve(root, "api/src/routes/designMeta.ts"), "utf8");
check("reminderUserId acepta workspace_key", metaSrc.includes('auth.authType !== "user" && auth.authType !== "workspace_key"'));
check("GET usa reminderUserId", metaSrc.includes("const userId = reminderUserId(req.auth);"));
check("PUT usa ownerId (ya no exige authType user)", metaSrc.includes("const ownerId = reminderUserId(req.auth);") && metaSrc.includes("user_id: ownerId,"));
const tplSrc = readFileSync(resolve(root, "api/src/services/templates.ts"), "utf8");
check("updateTemplate detecta captura nueva", tplSrc.includes("const captureChanged = typeof updates.thumbnail"));
check("upsertSupabase estampa cover_captured_at", tplSrc.includes("cover_captured_at: stampedAt"));

// ── 3. E2E HTTP (Fix A: x-api-key path) ───────────────────────────
console.log("[3] E2E HTTP :3001");
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
const env = { ...loadEnv(resolve(root, ".env")), ...loadEnv(resolve(root, "api/.env")) };
const serviceKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_KEY || env.SUPABASE_SECRET_KEYS;
const publishable = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
const sbUrl = env.SUPABASE_URL;
const API = "http://localhost:3001";
const TEMPLATE = process.argv[2] || "tpl_13723783-fd1";

const health = await fetch(`${API}/api/health`);
if (!health.ok) {
  console.log(`  SKIP e2e — API no disponible (${health.status}). Sube :3001 para el e2e completo.`);
} else {
  const email = `qa-reminder-${Date.now()}@example.com`;
  const password = `Qa!${randomBytes(6).toString("hex")}A1`;
  const svcHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", "User-Agent": "musa-qa/1.0" };
  let qaUserId = null, apiKeyRowId = null;

  const createRes = await fetch(`${sbUrl}/auth/v1/admin/users`, {
    method: "POST", headers: svcHeaders,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const user = await createRes.json();
  qaUserId = user?.id || null;
  check("QA user creado", Boolean(qaUserId));

  if (qaUserId) {
    const wsId = (await (await fetch(`${sbUrl}/rest/v1/templates?select=workspace_id&id=eq.${TEMPLATE}`, { headers: svcHeaders })).json())[0]?.workspace_id;
    check("workspace del template encontrado", Boolean(wsId));
    if (wsId) {
      await fetch(`${sbUrl}/rest/v1/workspace_members`, {
        method: "POST", headers: { ...svcHeaders, Prefer: "resolution=ignore-duplicates" },
        body: JSON.stringify({ workspace_id: wsId, user_id: qaUserId, role: "editor" }),
      });
      // Workspace API key en nombre del QA user — el camino x-api-key puro.
      const rawKey = `wsk_qa_${randomBytes(24).toString("hex")}`;
      const keyRes = await fetch(`${sbUrl}/rest/v1/workspace_api_keys`, {
        method: "POST", headers: svcHeaders,
        body: JSON.stringify({
          workspace_id: wsId,
          created_by: qaUserId,
          label: "qa-preview-reminder",
          key_prefix: rawKey.slice(0, 12),
          key_hash: createHash("sha256").update(rawKey).digest("hex"),
          role: "editor",
        }),
      });
      check("API key creada", keyRes.status === 201, `HTTP ${keyRes.status}`);

      // PUT del snooze con SOLO x-api-key (antes del fix: 403)
      const putRes = await fetch(`${API}/api/meta/${TEMPLATE}/preview-reminder`, {
        method: "PUT",
        headers: { "Content-Type": "application/json; charset=utf-8", "x-api-key": rawKey, "User-Agent": "musa-qa/1.0" },
        body: JSON.stringify({ days: 30 }),
      });
      const putBody = await putRes.json().catch(() => null);
      check("PUT snooze vía x-api-key → 200", putRes.status === 200 && Boolean(putBody?.data?.snoozed_until), `HTTP ${putRes.status}`);

      // GET meta con SOLO x-api-key (antes del fix: preview_snoozed_until null)
      const getRes = await fetch(`${API}/api/meta/${TEMPLATE}`, { headers: { "x-api-key": rawKey, "User-Agent": "musa-qa/1.0" } });
      const getBody = await getRes.json().catch(() => null);
      check("GET meta vía x-api-key devuelve el snooze", getRes.status === 200 && Boolean(getBody?.data?.preview_snoozed_until), `HTTP ${getRes.status} snoozed=${getBody?.data?.preview_snoozed_until}`);

      // Regresión: el camino JWT sigue funcionando
      const tokenRes = await fetch(`${sbUrl}/auth/v1/token?grant_type=password`, {
        method: "POST", headers: { apikey: publishable, "Content-Type": "application/json", "User-Agent": "musa-qa/1.0" },
        body: JSON.stringify({ email, password }),
      });
      const jwt = (await tokenRes.json())?.access_token;
      check("JWT emitido", Boolean(jwt));
      if (jwt) {
        const putJwt = await fetch(`${API}/api/meta/${TEMPLATE}/preview-reminder`, {
          method: "PUT",
          headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${jwt}`, "User-Agent": "musa-qa/1.0" },
          body: JSON.stringify({ days: 5 }),
        });
        const getJwt = await fetch(`${API}/api/meta/${TEMPLATE}`, { headers: { Authorization: `Bearer ${jwt}`, "User-Agent": "musa-qa/1.0" } });
        const getJwtBody = await getJwt.json().catch(() => null);
        check("PUT+GET vía JWT → 200 con snooze", putJwt.status === 200 && getJwt.status === 200 && Boolean(getJwtBody?.data?.preview_snoozed_until), `PUT ${putJwt.status} GET ${getJwt.status}`);
      }

      // Limpieza
      const keyDel = await fetch(`${sbUrl}/rest/v1/workspace_api_keys?created_by=eq.${qaUserId}`, { method: "DELETE", headers: svcHeaders });
      console.log(`  cleanup: api key HTTP ${keyDel.status}`);
      const memDel = await fetch(`${sbUrl}/rest/v1/workspace_members?user_id=eq.${qaUserId}`, { method: "DELETE", headers: svcHeaders });
      console.log(`  cleanup: membership HTTP ${memDel.status}`);
    }
    const userDel = await fetch(`${sbUrl}/auth/v1/admin/users/${qaUserId}`, { method: "DELETE", headers: svcHeaders });
    console.log(`  cleanup: user HTTP ${userDel.status} (preferencias en cascada)`);
  }
}

// Creds sobrantes de la sesión de diagnóstico UI, si aún existen
try { unlinkSync(resolve(root, "api/.tmp/qa-reminder-creds.txt")); console.log("  cleanup: qa-reminder-creds.txt eliminado"); } catch {}

console.log(`\nRESULTADO: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
