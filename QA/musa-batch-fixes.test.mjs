// ═══════════════════════════════════════════════════════════════
// musa-batch-fixes.test.mjs — v2.3 batch fixes regression tests
// ═══════════════════════════════════════════════════════════════
// Covers the three 2026-08 fixes in worker/runtime/functions/musa-batch-core.mjs:
//   1. resolveBrandId  — server-side brand resolution (LLM never decides IDs)
//   2. copy fast-path  — (exercised indirectly: leader internals, not exported)
//   3. normalizeFrameCount / frameHint — multi-frame planning (deterministic)
//
// Self-contained: Node cannot import musa-batch-core.mjs directly (its
// ../../api/src/services/*.js imports resolve to .ts sources — esbuild
// does that mapping when Netlify bundles, plain Node does not). So this
// test bundles the core with the local esbuild and imports the result.
//
// Run: node QA/musa-batch-fixes.test.mjs
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "musa-core-"));
const outfile = join(outDir, "core.bundle.mjs");

try {
  await build({
    entryPoints: [join(root, "netlify", "functions", "musa-batch-core.mjs")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    external: ["@supabase/supabase-js"],
    logLevel: "silent",
  });
  const core = await import(pathToFileURL(outfile).href);

  let passed = 0;
  let failed = 0;
  function check(name, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) { passed++; console.log("  ok  " + name); }
    else {
      failed++;
      console.log(`  FAIL ${name}\n    expected: ${JSON.stringify(expected)}\n    got:      ${JSON.stringify(actual)}`);
    }
  }

  console.log("── Module integrity ──");
  check("runDailyBatch still exported", typeof core.runDailyBatch, "function");
  check("resolveBrandId exported", typeof core.resolveBrandId, "function");
  check("normalizeFrameCount exported", typeof core.normalizeFrameCount, "function");
  check("frameHint exported", typeof core.frameHint, "function");

  console.log("── normalizeFrameCount (clamp 1..10, garbage → 1) ──");
  check("undefined → 1", core.normalizeFrameCount(undefined), 1);
  check("null → 1", core.normalizeFrameCount(null), 1);
  check("0 → 1", core.normalizeFrameCount(0), 1);
  check("-3 → 1", core.normalizeFrameCount(-3), 1);
  check("\"abc\" → 1", core.normalizeFrameCount("abc"), 1);
  check("3 → 3", core.normalizeFrameCount(3), 3);
  check("\"5\" → 5", core.normalizeFrameCount("5"), 5);
  check("15 → 10 (hard cap)", core.normalizeFrameCount(15), 10);

  console.log("── frameHint (deterministic per-frame roles) ──");
  check("single frame → no hint", core.frameHint(1, 1, null), "");
  check("frame 1 of 3 → COVER", core.frameHint(1, 3, "Comprar"), "This is the COVER frame: dominant title, strong hook, minimal text.");
  check("last of 3 with CTA → CLOSING + cta", core.frameHint(3, 3, "Comprar"), 'This is the CLOSING frame: reinforce the call to action ("Comprar").');
  check("last of 2 without CTA → CLOSING bare", core.frameHint(2, 2, null), "This is the CLOSING frame: reinforce the call to action.");
  check("frame 2 of 4 → DEVELOPMENT", core.frameHint(2, 4, null), "This is a DEVELOPMENT frame (2 of 4): communicate ONE key idea with supporting detail.");

  console.log("── resolveBrandId (LLM never decides DB IDs) ──");

  // Minimal sb mock: only the two query shapes resolveBrandId issues.
  function makeSb({ ownBrand = null, workspaceBrands = null, throwOnBrands = false } = {}) {
    return {
      from(table) {
        if (throwOnBrands) throw new Error("db down");
        if (table !== "brands") throw new Error("unexpected table: " + table);
        return {
          select() {
            return {
              eq(col, val) {
                if (col === "id") {
                  return {
                    maybeSingle: async () => ({ data: ownBrand && ownBrand.id === val ? ownBrand : null, error: null }),
                  };
                }
                if (col === "workspace_id") {
                  return {
                    limit: async () => ({ data: workspaceBrands, error: null }),
                  };
                }
                throw new Error("unexpected eq column: " + col);
              },
            };
          },
        };
      },
    };
  }

  // 1. Card has a brand that still exists → keep it.
  check("valid card brand → kept",
    await core.resolveBrandId(makeSb({ ownBrand: { id: "b1" } }), { brand_id: "b1", workspace_id: "ws1" }),
    "b1");

  // 2. Stale brand_id (row deleted) + exactly one workspace brand → that brand.
  check("stale brand + single workspace brand → workspace brand",
    await core.resolveBrandId(makeSb({ ownBrand: { id: "other" }, workspaceBrands: [{ id: "w1" }] }), { brand_id: "stale", workspace_id: "ws1" }),
    "w1");

  // 3. Stale brand + two workspace brands → ambiguous → null (valid).
  check("stale brand + 2 workspace brands → null",
    await core.resolveBrandId(makeSb({ ownBrand: { id: "other" }, workspaceBrands: [{ id: "w1" }, { id: "w2" }] }), { brand_id: "stale", workspace_id: "ws1" }),
    null);

  // 4. No brand on card + single workspace brand → that brand.
  check("no card brand + single workspace brand → workspace brand",
    await core.resolveBrandId(makeSb({ workspaceBrands: [{ id: "w1" }] }), { workspace_id: "ws1" }),
    "w1");

  // 5. DB error mid-resolution → non-fatal → null.
  check("db throws → null (non-fatal)",
    await core.resolveBrandId(makeSb({ throwOnBrands: true }), { brand_id: "b1", workspace_id: "ws1" }),
    null);

  // 6. Nothing to resolve → null.
  check("no brand_id, no workspace_id → null",
    await core.resolveBrandId(makeSb({}), {}),
    null);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
