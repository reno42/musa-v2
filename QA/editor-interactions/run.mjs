/**
 * Editor-interactions runner — `npm run test:editor`.
 *
 * Ensures vite (:5173) + api (:3001) are up, drives the editor in a headless
 * system Chrome via puppeteer-core, and runs the S1/S2/S3 + perf suites.
 *
 * These interaction tests are RED BY DESIGN today: they encode the bugs from
 * PLAN_EDITOR_CORE §2 and are the Agente IDE's definition of done. The runner's
 * exit code reflects reality; pass EXPECT_RED=1 to invert it (fails if any bug
 * test unexpectedly passes) so CI can assert "the red suite is still red" until
 * a sprint flips it on purpose.
 */
import { ensureServers } from "./lib/servers.mjs";
import { EditorHarness } from "./lib/harness.mjs";
import { run as s1 } from "./test-s1-commit-selection.mjs";
import { run as s2 } from "./test-s2-click-mutation.mjs";
import { run as s3 } from "./test-s3-undo-invariant.mjs";
import { run as s4 } from "./test-s4-animation-preset.mjs";
import { run as s5 } from "./test-s5-video-mode-entry.mjs";
import { run as s6 } from "./test-s6-render-parity.mjs";
import { run as perf } from "./test-perf-budgets.mjs";
import { run as g11 } from "./test-g11-rect-drag.mjs";
import { run as g12 } from "./test-g12-effects.mjs";
import { run as g17 } from "./test-g17-export-dialog.mjs";
import { run as g2 } from "./test-g2-stagger.mjs";
import { run as g7 } from "./test-g7-easing.mjs";

const SUITES = [
  { fn: s1, tag: "S1" },
  { fn: s2, tag: "S2" },
  { fn: s3, tag: "S3" },
  { fn: s4, tag: "S4" },
  { fn: s5, tag: "S5" },
  { fn: s6, tag: "S6" },
  { fn: perf, tag: "PERF" },
  { fn: g11, tag: "G11" },
  { fn: g12, tag: "G12" },
  { fn: g17, tag: "G17" },
  { fn: g2, tag: "G2" },
  { fn: g7, tag: "G7" },
];

// ONLY=<tag> corre una sola suite (p.ej. ONLY=G11 npm run test:editor) — útil
// para diagnosticar sin esperar las rojas-by-design S1-S3.
const only = process.env.ONLY;
const selected = only ? SUITES.filter(s => s.tag === only) : SUITES;

async function main() {
  const expectRed = process.env.EXPECT_RED === "1";
  console.log("── Editor interactions suite ──");
  const servers = await ensureServers();
  const harness = new EditorHarness();
  const reports = [];
  try {
    await harness.start();
    for (const { fn, tag } of selected) {
      console.log(`\n▶ ${tag}`);
      try {
        const report = await fn(harness);
        reports.push(report);
      } catch (err) {
        console.error(`  ✖ ${tag} lanzó: ${err.message}`);
        reports.push({ suiteName: tag, passed: false, results: [{ name: "ejecución", pass: false, detail: err.message }], threw: true });
      }
    }
  } finally {
    await harness.close();
    if (servers.startedCount > 0) await servers.stop();
  }

  console.log("\n── Resumen ──");
  let allPassed = true;
  for (const r of reports) {
    const passed = r.passed;
    allPassed = allPassed && passed;
    console.log(`${passed ? "PASS" : "FAIL"}  ${r.suiteName}`);
  }

  if (expectRed) {
    // Guard mode: the bug suites (S1-S3) SHOULD still be failing.
    const bugSuites = reports.filter(r => /^S[123]/.test(r.suiteName));
    const stillRed = bugSuites.some(r => !r.passed);
    console.log(`\nEXPECT_RED: ${stillRed ? "las pruebas de bug siguen rojas (esperado)" : "¡una prueba de bug pasó! revisa si un sprint la resolvió"}`);
    process.exit(stillRed ? 0 : 1);
  }

  process.exit(allPassed ? 0 : 1);
}

main().catch(err => { console.error("runner falló:", err); process.exit(2); });
