/**
 * S1 — "Muevo/edito algo y se cuelga; pierdo la selección."
 *
 * Root cause (PLAN_EDITOR_CORE §2 S1): any html-committing operation runs the
 * `frame.html` effect → `content.innerHTML = frame.html`, which re-creates every
 * node and does `selectedRef = null; clearOverlay()`. So a change that touches
 * ONE layer destroys the identity of ALL layers and drops the selection overlay.
 *
 * What we prove:
 *   S1.1  (RED today) after an html commit, untouched layers keep their node
 *         identity — survivors must be ≥ the layer count. Today innerHTML rebuild
 *         re-creates everything → 0 survivors. This is the core fluidity bug.
 *   S1.2  (guard) after a committing gesture the overlay is never left empty —
 *         the current selection stays visualized. Passes today because the
 *         alt-drag duplicate gets selected; it guards that a commit doesn't wipe
 *         the overlay and leave the user with nothing selected.
 *
 * Fixed target (Sprint 0.1/0.3 + Sprint 2): incremental reconcile keeps
 * untouched nodes, and selection is re-resolved by data-layer-id.
 */
import { makeReport } from "./lib/assert.mjs";
import { createNestedTemplate, deleteTemplate } from "./lib/mcp.mjs";

export async function run(harness) {
  const report = makeReport("S1 · commit preserva identidad + selección");
  const { templateId, frameId } = await createNestedTemplate();
  try {
    await harness.open(templateId, frameId);

    // Baseline: mark every layer node with an identity token.
    const total = await harness.markNodes(frameId);
    report.ok("frame cargó con capas", total >= 4, `${total} capas marcadas`);

    // Select a layer so there is a live selection to preserve.
    await harness.clickLayer(frameId, "dot");
    const selBefore = await harness.selectedLayerId(frameId);
    report.ok("selección inicial visible", selBefore !== null, `seleccionado: ${selBefore}`);

    // An html-committing operation on an UNRELATED layer (duplicate via alt-drag).
    await harness.altDragLayer(frameId, "pill", 320, 0);

    // S1.1 — untouched nodes should survive as the same DOM nodes.
    const survivors = await harness.countSurvivors(frameId);
    report.ok(
      "S1.1 identidad de nodos preservada tras commit html",
      survivors >= total,
      `sobrevivieron ${survivors}/${total} (hoy se re-crean todos → 0)`,
    );

    // S1.2 — after the commit, the current selection is still drawn.
    const selAfter = await harness.selectionBox(frameId);
    report.ok(
      "S1.2 selección sigue visualizada tras commit html",
      selAfter !== null,
      selAfter ? "overlay presente" : "overlay vacío (selección perdida)",
    );

    return report;
  } finally {
    await deleteTemplate(templateId);
  }
}
