/**
 * setup-supabase.mjs — Initialize Supabase database schema via Management API.
 *
 * Prerequisites:
 *   1. SUPABASE_URL in .env (e.g. https://abc123.supabase.co)
 *   2. SUPABASE_PAT in .env (Personal Access Token from https://app.supabase.com/account/tokens)
 *      The PAT must have "Database" permissions on the target project.
 *
 * Usage:
 *   node scripts/setup-supabase.mjs
 *
 * What it does:
 *   - Reads supabase_schema_complete.sql (7 tables, 4 indexes, storage bucket, RLS)
 *   - Executes it against your Supabase project via Management API
 *   - All statements use IF NOT EXISTS / ON CONFLICT — safe to re-run
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ── Load env vars ──────────────────────────────────────────
// In Node 22+, --env-file is available. Fall back to manual parsing.
function loadEnv() {
  try {
    const envPath = resolve(ROOT, ".env");
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  } catch {
    // .env file not found — env vars may be set directly
  }
}

function assertEnv(name) {
  const val = process.env[name];
  if (!val || val.includes("your-project")) {
    console.error(`\n  ERROR: ${name} is not set in .env`);
    console.error(`  Copy .env.example to .env and fill in your credentials.\n`);
    process.exit(1);
  }
  return val;
}

// ── Extract project ref from Supabase URL ──────────────────
// e.g. https://abc123xyz.supabase.co → abc123xyz
function extractProjectRef(url) {
  const match = url.match(/https?:\/\/([^.]+)\.supabase\.co/);
  if (!match) {
    console.error(`\n  ERROR: Could not extract project ref from SUPABASE_URL: ${url}`);
    console.error(`  Expected format: https://<ref>.supabase.co\n`);
    process.exit(1);
  }
  return match[1];
}

// ── Execute SQL via Management API ─────────────────────────
async function execSql(pat, projectRef, sql) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${pat}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 500)}`);
  }

  return res.json();
}

// ── Main ───────────────────────────────────────────────────
async function main() {
  console.log("Futuraria Design — Supabase Schema Setup\n");

  loadEnv();

  const supabaseUrl = assertEnv("SUPABASE_URL");
  const pat = assertEnv("SUPABASE_PAT");
  const projectRef = extractProjectRef(supabaseUrl);

  console.log(`  Project:  ${supabaseUrl}`);
  console.log(`  Ref:      ${projectRef}`);

  // Execute complete SQL files as units. Splitting on semicolons corrupts
  // PL/pgSQL functions because their bodies contain semicolons too.
  const migrationFiles = readdirSync(ROOT)
    .filter(name => /^supabase_migrations_v\d+\.sql$/.test(name))
    .sort((a, b) => Number(a.match(/v(\d+)/)?.[1]) - Number(b.match(/v(\d+)/)?.[1]));
  const files = ["supabase_schema_complete.sql", ...migrationFiles];
  console.log(`  Schema:   ${files.length} idempotent SQL files to execute\n`);

  let ok = 0;
  let failed = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const sql = readFileSync(resolve(ROOT, file), "utf-8");
    process.stdout.write(`  [${i + 1}/${files.length}] ${file}... `);

    try {
      await execSql(pat, projectRef, sql);
      console.log("OK");
      ok++;
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      failed++;
      // Don't abort — many statements are idempotent (IF NOT EXISTS),
      // and some errors (e.g. adding existing realtime publication) are harmless.
    }
  }

  console.log(`\n  Done: ${ok} OK, ${failed} failed (check output above)\n`);

  if (failed > 0) {
    console.log("  Some statements failed — this is often harmless (e.g. objects already exist).");
    console.error("  Database setup is incomplete. Fix every reported SQL error before deploying.");
    console.log("  Verify your tables in: https://app.supabase.com/project/" + projectRef + "/database/tables\n");
    process.exitCode = 1;
  } else {
    const latestVersion = Math.max(...migrationFiles.map(file => Number(file.match(/v(\d+)/)?.[1]) || 0));
    writeFileSync(resolve(ROOT, ".migration-version"), `v${latestVersion}\n`, "utf8");
    console.log("  Schema ready. Your AI can now persist designs across restarts.\n");
  }
}

main().catch((err) => {
  console.error("\n  FATAL:", err.message, "\n");
  process.exit(1);
});
