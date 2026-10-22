// ═══════════════════════════════════════════════════════════════════
// segment-selftest.mjs — local smoke test of the ONNX calado engines.
//
// Runs worker/runtime/segment/segment-core.mjs selfTest() against the
// ./models-cache/ weights (see scripts/fetch-segment-models.mjs).
// No Supabase, no bucket, no network — pure inference validation:
// the u2netp / MobileSAM / CLIPSeg feeds written against the printed
// IO contracts are exercised end-to-end (mask → SVG path).
//
// Usage:
//   node scripts/fetch-segment-models.mjs --verify-only   # weights present
//   node scripts/segment-selftest.mjs                     # all 3 engines
//   node scripts/segment-selftest.mjs u2netp              # just one
// ═══════════════════════════════════════════════════════════════════
const engines = process.argv.slice(2).filter(a => !a.startsWith("-"));
const core = await import("../worker/runtime/segment/segment-core.mjs");

const expectedFg = Math.PI * 90 * 90 / (400 * 300); // ≈ 0.212 (the circle)
const out = await core.selfTest(engines.length ? engines : undefined);

let failed = 0;
for (const [name, r] of Object.entries(out)) {
  // u2netp/SAM must find the circle as a coherent blob (fg 5–60%, ≥1
  // contour). CLIPSeg int8 on a flat synthetic SVG is speckle-prone — the
  // local bar is only “ran + produced a mask”; coherent text-segmentation
  // on real photos is validated by QA/segmentation-e2e.mjs (phase 6).
  const ok = name === "clipseg"
    ? r.fgRatio >= 0 && r.fgRatio < 0.85
    : r.fgRatio > 0.05 && r.fgRatio < 0.6 && r.subpaths >= 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: fg=${r.fgRatio} (expected ≈${expectedFg.toFixed(2)}) subpaths=${r.subpaths} ${r.ms}ms`);
  if (!ok) failed++;
}
process.exit(failed ? 1 : 0);
