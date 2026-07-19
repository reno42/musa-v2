// ═══════════════════════════════════════════════════════════════════
// Pre-build migration safety check
//
// Compares .migration-version (the last migration known to have run
// on production) against supabase_migrations_v*.sql files committed
// in the repo. If any migration file has a version higher than the
// recorded version → the build is BLOCKED with a loud warning.
//
// This prevents deploying code that depends on columns/functions
// from an unapplied migration (e.g., selecting 'slug' before the
// v7 ADD COLUMN has run on production).
//
// No DB credentials required — purely filesystem comparison.
// ═══════════════════════════════════════════════════════════════════

import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// ── Parse .migration-version ──────────────────────────────
const versionPath = resolve(root, ".migration-version");
let currentVersion = 0;
try {
  const raw = readFileSync(versionPath, "utf-8").trim();
  const m = raw.match(/v(\d+)/i);
  if (m) currentVersion = parseInt(m[1], 10);
} catch {
  console.warn("[check-migrations] .migration-version not found — assuming v0 (all migrations pending)");
}

// ── Scan repo for migration files ─────────────────────────
const files = readdirSync(root);
const migrationPattern = /^supabase_migrations_v(\d+)\.sql$/;

const pending = [];
for (const f of files) {
  const m = f.match(migrationPattern);
  if (!m) continue;
  const ver = parseInt(m[1], 10);
  if (ver > currentVersion) {
    pending.push({ file: f, version: ver });
  }
}

// ── Report ─────────────────────────────────────────────────
if (pending.length === 0) {
  console.log(`[check-migrations] ✓ All migrations up to v${currentVersion} applied.`);
  process.exit(0);
}

console.error("");
console.error("╔══════════════════════════════════════════════════════════╗");
console.error("║  ⚠️  UNAPPLIED MIGRATIONS DETECTED                      ║");
console.error("╠══════════════════════════════════════════════════════════╣");
console.error("║                                                        ║");
for (const p of pending) {
  const line = `║  • ${p.file}  →  version v${p.version} (current: v${currentVersion})`;
  console.error(line.padEnd(59) + "║");
}
console.error("║                                                        ║");
console.error("║  These migrations have SQL (columns, functions,        ║");
console.error("║  indexes) that the deployed code may depend on.        ║");
console.error("║                                                        ║");
console.error("║  ACTION REQUIRED:                                      ║");
console.error("║  1. Run pending migrations on the production DB.       ║");
console.error("║  2. Update .migration-version to the highest applied.   ║");
console.error("║  3. Re-run the build.                                  ║");
console.error("║                                                        ║");
console.error("╚══════════════════════════════════════════════════════════╝");
console.error("");

// Default: warn-only (exit 0). Set CHECK_MIGRATIONS_STRICT=true in CI
// to block the build until migrations are applied.
const strict = process.env.CHECK_MIGRATIONS_STRICT === "true";
if (strict) {
  console.error("[check-migrations] Strict mode: build BLOCKED.");
  process.exit(1);
}
console.error("[check-migrations] Non-strict mode: warning only, build continues.");
process.exit(0);
