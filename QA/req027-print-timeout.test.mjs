/**
 * QA REQ-027 Item 5 — timeout del motor de imprenta + contrato Ctrl+D.
 *
 * El bug del hang: el worker (instantiateWasm fire-and-forget) podía dejar
 * ensurePrintEngine colgado sin rechazar nunca → el diálogo clavado en
 * "Preparando…". La defensa en el cliente es withTimeout (techo de 60s).
 * Acá se prueba el contrato del techo con un "worker" que no responde
 * (promesa que jamás resuelve) y el contrato fuente del Ctrl+D
 * (selección primero, frame como fallback).
 *
 * Correr: node --experimental-strip-types --test QA/req027-print-timeout.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { withTimeout, PRINT_ENGINE_TIMEOUT_MS } from "../src/lib/cmykEngine.ts";

const here = dirname(fileURLToPath(import.meta.url));
const editorV2Source = readFileSync(join(here, "..", "src", "pages", "EditorV2.tsx"), "utf8");
const engineSource = readFileSync(join(here, "..", "src", "lib", "cmykEngine.ts"), "utf8");

test("PRINT_ENGINE_TIMEOUT_MS es 60s", () => {
  assert.equal(PRINT_ENGINE_TIMEOUT_MS, 60_000);
});

test("withTimeout resuelve si el trabajo termina antes del techo", async () => {
  const fast = new Promise(resolve => setTimeout(() => resolve("ok"), 10));
  assert.equal(await withTimeout(fast, 5_000, "no debería rechazar"), "ok");
});

test("worker mock que no responde → rechaza al vencer el techo, con mensaje accionable", async () => {
  // Réplica del hang: una promesa que NUNCA resuelve (el instantiateWasm
  // fire-and-forget original). El techo corto (50ms) simula los 60s.
  const hungWorker = new Promise(() => { /* nunca resuelve */ });
  const t0 = Date.now();
  await assert.rejects(
    withTimeout(hungWorker, 50, "El motor de imprenta no respondió"),
    /no respondió/,
  );
  const elapsed = Date.now() - t0;
  assert.ok(elapsed >= 45, `rechazó demasiado pronto (${elapsed}ms)`);
  assert.ok(elapsed < 5_000, `el techo no se aplicó (${elapsed}ms)`);
});

test("withTimeout deja pasar el rechazo real del trabajo (no lo traga)", async () => {
  const broken = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("job-error real del worker")), 10));
  await assert.rejects(withTimeout(broken, 60_000, "techo"), /job-error real/);
});

test("ensurePrintEngine corre bajo el techo y marca/remueve print_engine_ready", () => {
  // Contrato fuente: el init pasa por withTimeout y el flag de localStorage
  // se escribe tras el éxito y se remueve si falla.
  assert.match(engineSource, /await withTimeout\(\s*postJob\(\{ kind: "init"/);
  assert.match(engineSource, /localStorage\.setItem\("print_engine_ready", "1"\)/);
  assert.match(engineSource, /localStorage\.removeItem\("print_engine_ready"\)/);
});

test("contrato fuente: Ctrl+D duplica la selección; frame sólo como fallback", () => {
  // REQ-027 Item 2: el handler debe preferir handleDuplicateElement cuando
  // hay selectedElement y caer a duplicateFrame() sólo sin selección.
  const branch = editorV2Source.match(
    /if \(mod && e\.key\.toLowerCase\(\) === "d" && !e\.shiftKey\) \{\s*e\.preventDefault\(\);\s*if \(selectedElement\) handleDuplicateElement\(selectedElement\.layerId\);\s*else duplicateFrame\(\);\s*return;\s*\}/,
  );
  assert.ok(branch, "Ctrl+D debe ser: selectedElement → duplicar capa; else → duplicar frame");
});

test("contrato fuente: Ctrl+Shift+D NO cambió (sigue duplicando la capa)", () => {
  assert.match(
    editorV2Source,
    /if \(mod && e\.shiftKey && e\.key\.toLowerCase\(\) === "d"\) \{ e\.preventDefault\(\); if \(selectedElement\) handleDuplicateElement\(selectedElement\.layerId\); return; \}/,
  );
});

test("contrato fuente: el diálogo muestra el % real (progress.message) al preparar", () => {
  const dialogSource = readFileSync(
    join(here, "..", "src", "components", "PrintExportDialog.tsx"), "utf8");
  assert.match(dialogSource,
    /progress\.phase === "preparing" && \(progress\.message \|\| "Preparando motor de imprenta…"\)/);
  // ✕ nunca disabled={busy} — el regression del hang dejaba la única
  // salida (cerrar) bloqueada.
  assert.doesNotMatch(dialogSource, /onClick=\{onClose\} disabled=\{busy\}/);
});
