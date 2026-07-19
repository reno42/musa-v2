/**
 * Runner de la suite de verificación 2026-07-19.
 * Reutiliza los servidores vivos (:5173/:3001) si responden; no mata procesos ajenos.
 * Uso: node QA/verify-2026-07-19/ui/run-all.mjs [solo-test-n]
 */
import { ensureServers, EditorHarness, log } from "./lib.mjs";
import { run as t1 } from "./test-01-undo-visual.mjs";
import { run as t2 } from "./test-02-alt-drag-echo.mjs";
import { run as t3 } from "./test-03-scrub-flood.mjs";
import { run as t4 } from "./test-04-reconciler.mjs";
import { run as t5 } from "./test-05-codepanel-tab.mjs";
import { run as t6 } from "./test-06-error-boundary.mjs";
import { run as t7 } from "./test-07-visual-pass.mjs";

const SUITES = [
  { n: 1, fn: t1, tag: "T1 UNDO-VISUAL + UNDO-BUTTONS" },
  { n: 2, fn: t2, tag: "T2 ALT-DRAG + ECHO-HTML" },
  { n: 3, fn: t3, tag: "T3 SCRUB-FLOOD" },
  { n: 4, fn: t4, tag: "T4 RECONCILER-ORDER/REPARENT" },
  { n: 5, fn: t5, tag: "T5 CODEPANEL-TAB" },
  { n: 6, fn: t6, tag: "T6 ERROR-BOUNDARY" },
  { n: 7, fn: t7, tag: "T7 VISUAL PASS" },
];

async function main() {
  const only = process.argv[2] ? Number(process.argv[2]) : null;
  log("── Verificación en vivo 2026-07-19 ──");
  const servers = await ensureServers();
  const harness = new EditorHarness();
  try {
    await harness.start();
    for (const { n, fn, tag } of SUITES) {
      if (only && n !== only) continue;
      log(`\n▶ ${tag}`);
      try {
        await fn(harness);
      } catch (err) {
        log(`  ✖ ${tag} lanzó: ${err.message}\n${err.stack?.split("\n").slice(1, 4).join("\n") || ""}`);
      }
    }
  } finally {
    await harness.close();
    if (servers.startedCount > 0) await servers.stop();
  }
  log("\n── Fin (ver results.json) ──");
}

main().catch(err => { console.error("runner falló:", err); process.exit(2); });
