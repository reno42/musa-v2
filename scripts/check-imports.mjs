#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
// check-imports.mjs — prebuild guard ("works locally, breaks on deploy").
//
// Netlify builds a FRESH clone: only git-tracked files exist there. If a
// tracked file imports a module that lives on disk but was never committed
// (2026-08-29 incident: src/components/DesignSystemPanel.tsx), local tsc
// passes while the deploy dies with TS2307 plus cascading TS7006s wherever
// an inline callback lost its contextual type.
//
// This guard simulates that clone: every relative/alias import made by a
// TRACKED source file (src/, shared/, api/src/) must resolve to a file git
// also tracks. Fails loudly with the exact `git add` needed. Nonexistent
// import targets are left to tsc, which already reports them precisely.
// ═══════════════════════════════════════════════════════════════════════
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Directories whose code is compiled by the repo's tsc configs.
const SCOPE = ["src", "shared", join("api", "src")];
// Mirrors tsconfig paths + vite resolve.alias.
const ALIASES = { "@futuraria/shared": join(root, "src", "shared") };
const EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".json"];
const SUFFIXES = ["", ...EXTS, ...EXTS.map(ext => `/index${ext}`)];
const CODE_RE = /\.(ts|tsx|js|jsx)$/;

const toPosix = p => p.replace(/\\/g, "/");
const relFromRoot = p => toPosix(relative(root, p));
const isAliased = spec => Object.keys(ALIASES).some(a => spec === a || spec.startsWith(a + "/"));

// ── What git tracks (the "fresh clone" view): full repo, so imports that
//    escape the scope (e.g. ../../docs) are still validated correctly. ──
const tracked = new Set(
  execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean),
);

// ── Walk the scope on disk for readable code files ──
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (CODE_RE.test(entry)) out.push(full);
  }
  return out;
}

// Covers `import x from "…"`, `export … from "…"`, side-effect
// `import "…"` and dynamic `import("…")`. Bare package specifiers (not
// relative, not aliased) are skipped — npm installs those on the deploy.
const SPEC_RE = /\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

function resolveSpecifier(spec, importer) {
  let base;
  if (spec.startsWith(".")) {
    base = resolve(dirname(importer), spec);
  } else if (isAliased(spec)) {
    const alias = Object.keys(ALIASES).find(a => spec === a || spec.startsWith(a + "/"));
    base = join(ALIASES[alias], spec.slice(alias.length));
  } else {
    return null; // bare package — not our problem
  }
  for (const suffix of SUFFIXES) {
    const candidate = base + suffix;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null; // not on disk → tsc owns this failure, not us
}

const errors = [];
let filesChecked = 0;
let importsChecked = 0;

for (const file of SCOPE.flatMap(dir => walk(join(root, dir)))) {
  const rel = relFromRoot(file);
  // Only tracked files are compiled on the deploy — an untracked file's
  // own imports become relevant the moment someone commits it, and tsc
  // checks them locally right now.
  if (!tracked.has(rel)) continue;
  filesChecked++;
  const source = readFileSync(file, "utf8");
  for (const m of source.matchAll(SPEC_RE)) {
    const spec = m[1];
    if (!spec.startsWith(".") && !isAliased(spec)) continue;
    importsChecked++;
    const resolved = resolveSpecifier(spec, file);
    if (!resolved) continue;
    const relResolved = relFromRoot(resolved);
    if (!tracked.has(relResolved)) {
      errors.push(
        `  ✗ ${rel}: importa "${spec}" → ${relResolved} existe en disco pero NO está en git.\n` +
        `      Un deploy limpio fallaría ahí (TS2307). Ejecuta: git add ${relResolved}`,
      );
    }
  }
}

if (errors.length) {
  console.error(`[check-imports] ${errors.length} import(s) apuntan a archivos sin commitear:`);
  console.error(errors.join("\n"));
  console.error("[check-imports] ✗ El deploy fallaría — commitea los archivos listados antes de pushear.");
  process.exit(1);
}
console.log(`[check-imports] ✓ ${filesChecked} archivos, ${importsChecked} imports relativos/alias — todos resuelven a archivos tracked.`);
