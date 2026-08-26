// QA/oauth-qa-user-setup.mjs — one-time bootstrap for oauth-flow-test.mjs.
//
// Registers the dedicated QA user through the SAME public path a real user
// takes (GoTrue signup + POST /api/account/nda-acceptance), so it needs NO
// service key — only the public config endpoint and the publishable key:
//
//   1. GET  {SITE}/api/auth/config           → live Supabase URL + publishable key
//   2. POST {sb}/auth/v1/signup              → account + session (requires
//      "Confirm email" OFF in Supabase Auth — true for the alfa access phase)
//   3. POST {SITE}/api/account/nda-acceptance → NDA gate satisfied (v30)
//   4. write QA/.env.qa-oauth (git-ignored) for oauth-flow-test.mjs
//
// Usage:
//   node QA/oauth-qa-user-setup.mjs                 // register + accept NDA
//   node QA/oauth-qa-user-setup.mjs --prune-clients // optional cleanup of
//       throwaway oauth_clients rows (this ONE mode needs SUPABASE_URL +
//       SUPABASE_SECRET_KEY of the LIVE project as env vars — note that the
//       repo's .env.design-supabase may hold a stale project ref)
//
// If the QA user already exists and QA/.env.qa-oauth is gone (password lost):
// delete it in Supabase Dashboard -> Authentication -> Users and re-run.

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const ENV_LOCAL = join(HERE, ".env.qa-oauth");

function parseEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith("#")) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const die = (msg) => { console.error("ERROR: " + msg); process.exit(1); };
const local = parseEnvFile(ENV_LOCAL);
const SITE = (process.env.FDR_SITE || local.FDR_SITE || "https://design.futuraria.com").replace(/\/+$/, "");
const EMAIL = process.env.QA_EMAIL || local.FDR_EMAIL || "qa.oauth.test@design.futuraria.com";

// ── --prune-clients: optional cleanup, the only service-key mode ──
if (process.argv.includes("--prune-clients")) {
  const fileEnv = parseEnvFile(join(ROOT, ".env.design-supabase"));
  const url = (process.env.SUPABASE_URL || fileEnv.SUPABASE_URL || "").replace(/\/+$/, "");
  const secret = process.env.SUPABASE_SECRET_KEY || fileEnv.SUPABASE_SECRET_KEY || "";
  if (!url || !secret) die("--prune-clients needs SUPABASE_URL + SUPABASE_SECRET_KEY of the live project as env vars.");
  const res = await fetch(url + "/rest/v1/oauth_clients?client_name=eq." + encodeURIComponent("QA oauth-flow-test") + "&select=client_id", { headers: { apikey: secret, Authorization: "Bearer " + secret } });
  const rows = await res.json();
  if (!res.ok) die("listing oauth_clients failed: " + res.status + " " + JSON.stringify(rows));
  for (const row of rows) {
    const del = await fetch(url + "/rest/v1/oauth_clients?client_id=eq." + encodeURIComponent(row.client_id), { method: "DELETE", headers: { apikey: secret, Authorization: "Bearer " + secret } });
    if (!del.ok) die("delete failed for " + row.client_id + ": " + del.status);
  }
  console.log("Pruned " + rows.length + " throwaway oauth_clients row(s) — related oauth_codes cascade-deleted.");
  process.exit(0);
}

console.log("Site:     " + SITE);
console.log("QA user:  " + EMAIL);

// ── 1. Live Supabase config from the public endpoint (never a secret) ──
const cfgRes = await fetch(SITE + "/api/auth/config");
if (!cfgRes.ok) die("GET /api/auth/config -> " + cfgRes.status);
const cfg = (await cfgRes.json()).data || {};
const SB_URL = (cfg.url || "").replace(/\/+$/, "");
const PUB_KEY = cfg.publishableKey || "";
if (!SB_URL || !PUB_KEY) die("config endpoint is missing url/publishableKey");
console.log("Supabase: " + SB_URL);

// ── 2. Signup — or sign back in if the QA user already exists ──
const PASSWORD = process.env.QA_PASSWORD || local.FDR_PASSWORD || "fdr_qa_" + randomBytes(12).toString("hex");
let accessToken = null;

const signupRes = await fetch(SB_URL + "/auth/v1/signup", {
  method: "POST",
  headers: { apikey: PUB_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
const signup = await signupRes.json().catch(() => null);

// GoTrue REST returns tokens FLAT ({access_token, refresh_token, user}) — the
// {session:{...}} wrapper is a supabase-js client construct, not the wire shape.
if (signupRes.ok && (signup?.access_token || signup?.session?.access_token)) {
  accessToken = signup.access_token || signup.session.access_token;
  console.log("Registered via public signup (email confirmation is OFF).");
} else if (signupRes.status === 422 && /already/i.test(String(signup?.msg || signup?.message || ""))) {
  if (!local.FDR_PASSWORD && !process.env.QA_PASSWORD) {
    die("User " + EMAIL + " already exists but QA/.env.qa-oauth is missing. Delete the user in Supabase Dashboard -> Authentication -> Users and re-run.");
  }
  const pwRes = await fetch(SB_URL + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { apikey: PUB_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const pw = await pwRes.json().catch(() => null);
  if (!pwRes.ok || !pw?.access_token) die("stored QA password no longer valid: " + pwRes.status + " " + JSON.stringify(pw).slice(0, 200));
  accessToken = pw.access_token;
  console.log("Existing QA user — signed back in with stored credentials.");
} else {
  die("signup failed: " + signupRes.status + " " + JSON.stringify(signup).slice(0, 300)
    + (signupRes.ok && !(signup?.access_token || signup?.session?.access_token) ? " — no tokens returned: is 'Confirm email' enabled? Disable it for the alfa phase, delete the pending user and re-run." : ""));
}

// ── 3. NDA gate through the same endpoint the SPA uses (idempotent) ──
const ndaRes = await fetch(SITE + "/api/account/nda-acceptance", {
  method: "POST",
  headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
  body: JSON.stringify({ plan: "friends_family" }),
});
if (!ndaRes.ok) die("POST /api/account/nda-acceptance -> " + ndaRes.status + " " + (await ndaRes.text()).slice(0, 200));
console.log("NDA accepted via /api/account/nda-acceptance — gate satisfied.");

// ── 4. Persist credentials where oauth-flow-test.mjs picks them up ──
writeFileSync(ENV_LOCAL, "FDR_SITE=" + SITE + "\nFDR_EMAIL=" + EMAIL + "\nFDR_PASSWORD=" + PASSWORD + "\n", "utf8");
console.log("Wrote " + ENV_LOCAL + " (git-ignored).");
console.log("\nNext: node QA/oauth-flow-test.mjs");
