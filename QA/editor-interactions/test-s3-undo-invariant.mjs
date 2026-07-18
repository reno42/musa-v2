/**
 * S3 — "Ctrl+Z a veces sí, a veces no."
 *
 * Root cause (PLAN_EDITOR_CORE §2 S3): undo is 77 manual pushUndo call sites with
 * per-tick granularity, so (a) round-trips are not guaranteed and (b) a control
 * that commits on every change (the panel inputs) floods the stack — one logical
 * "gesture" becomes dozens of undo steps, so one Ctrl+Z undoes 1px / 1 unit.
 *
 * What we prove today:
 *   S3.1  round-trip invariant: after N moves, undo×N must return to the exact
 *         initial fingerprint and redo×N to the final one.
 *   S3.2  gesture coalescing (RED today): a font-size scrub of ~15 rapid commits
 *         must be ONE undo. Each panel onChange pushes its own undo entry today,
 *         so a single Ctrl+Z reverts one step instead of the whole scrub.
 */
import { makeReport } from "./lib/assert.mjs";
import { createNestedTemplate, deleteTemplate } from "./lib/mcp.mjs";

// Runs in page context: drive N rapid commits on the font-size input, return the
// original + final values so the test can check what a single undo restores.
const SCRUB_FONT = /* js */ `
(function(steps){
  const panel = document.querySelector('.html-contextual-panel');
  if (!panel) return { ok:false, reason:'no panel' };
  const inputs = [...panel.querySelectorAll('input')];
  // The font-size field's value is a px string like "44px".
  const sizeInput = inputs.find(i => /^\\d+(\\.\\d+)?px$/.test(i.value));
  if (!sizeInput) return { ok:false, reason:'no font-size input', values: inputs.map(i=>i.value) };
  const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  const original = parseFloat(sizeInput.value);
  let val = original;
  for (let i = 0; i < steps; i++) {
    val += 1;
    nativeSet.call(sizeInput, val + 'px');
    sizeInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
  return { ok:true, original, final: val, selector: sizeInput.value };
})(${"__STEPS__"});
`;

const READ_FONT = /* js */ `
(function(){
  const panel = document.querySelector('.html-contextual-panel');
  if (!panel) return null;
  const input = [...panel.querySelectorAll('input')].find(i => /^\\d+(\\.\\d+)?px$/.test(i.value));
  return input ? parseFloat(input.value) : null;
})();
`;

export async function run(harness) {
  const report = makeReport("S3 · undo invariante + coalescing");
  const { templateId, frameId } = await createNestedTemplate();
  try {
    await harness.open(templateId, frameId);

    // ── S3.1 round-trip over N moves ──
    const layers = ["dot", "pill", "card"];
    const deltas = [[60, 0], [0, 40], [-30, 25], [50, -50]];
    const f0 = await harness.fingerprint(frameId);
    const moves = 6;
    for (let i = 0; i < moves; i++) {
      await harness.dragLayer(frameId, layers[i % layers.length], ...deltas[i % deltas.length]);
    }
    const f1 = await harness.fingerprint(frameId);
    report.ok("las operaciones cambiaron el estado", f0 !== f1, `${moves} movimientos`);

    for (let i = 0; i < moves; i++) await harness.undo();
    const fUndo = await harness.fingerprint(frameId);
    report.ok(
      "S3.1 undo×N devuelve al estado inicial exacto",
      fUndo === f0,
      fUndo === f0 ? "coincide" : "round-trip roto (undo no restaura el inicio)",
    );

    for (let i = 0; i < moves; i++) await harness.redo();
    const fRedo = await harness.fingerprint(frameId);
    report.ok(
      "S3.1 redo×N devuelve al estado final exacto",
      fRedo === f1,
      fRedo === f1 ? "coincide" : "redo no restaura el final",
    );

    // ── S3.2 scrub coalescing on the font-size panel input ──
    await harness.clickChild(frameId, '[data-layer-id="card"] h1');
    await harness.settle(150);
    const steps = 15;
    const scrub = await harness.page.evaluate(SCRUB_FONT.replace("__STEPS__", String(steps)));
    await harness.settle(500); // let any debounce settle
    if (!scrub.ok) {
      report.ok("S3.2 pudo iniciar el scrub de tamaño", false, scrub.reason + (scrub.values ? " valores:" + JSON.stringify(scrub.values) : ""));
    } else {
      report.ok("el scrub cambió el tamaño de fuente", scrub.final > scrub.original, `${scrub.original}px → ${scrub.final}px en ${steps} commits`);
      await harness.undo(); // ONE undo should revert the whole scrub gesture
      const afterUndo = await harness.page.evaluate(READ_FONT);
      report.ok(
        "S3.2 un Ctrl+Z revierte el scrub completo",
        afterUndo === scrub.original,
        `tamaño=${afterUndo}px (esperado ${scrub.original}; hoy revierte 1 paso → ${scrub.final - 1})`,
      );
    }

    return report;
  } finally {
    await deleteTemplate(templateId);
  }
}
