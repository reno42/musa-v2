/**
 * S2a — "Clickeo algo y se destruye/reordena el DOM debajo del cursor."
 *
 * Root cause (PLAN_EDITOR_CORE §2 S2a, DesignFrame.tsx:1343-1347): when the
 * clicked node lacks data-layer-id, the mousedown handler ASSIGNS the id and
 * calls onHtmlChange DURING the click → setFrames → `content.innerHTML` rebuild
 * mid-gesture.
 *
 * ⚠ VERIFICATION FINDING (2026-07-16): this is ALREADY MITIGATED. `ensureLayerIds`
 * (src/lib/htmlMutations.ts) now runs on every frame at load (EditorV2.tsx:377,397),
 * so rendered text/leaf nodes already carry a data-layer-id and the id-assignment
 * branch at line 1343 is dead for loaded content. Sprint 0.2 is effectively done
 * for the normal path. This test is therefore a REGRESSION GUARD, not a red test:
 * it must stay green; if ensureLayerIds is removed or the load path changes, it
 * goes red and warns us. (Residual risk lives only in nodes inserted at runtime
 * that bypass ensureLayerIds — out of scope here.)
 *
 * Guards:
 *   S2.1  clicking a nested node does NOT rebuild the content subtree.
 *   S2.2  the clicked node keeps its identity (not replaced by innerHTML).
 */
import { makeReport } from "./lib/assert.mjs";
import { createNestedTemplate, deleteTemplate } from "./lib/mcp.mjs";

export async function run(harness) {
  const report = makeReport("S2 · el click no muta el documento");
  const { templateId, frameId } = await createNestedTemplate();
  try {
    await harness.open(templateId, frameId);
    await harness.markNodes(frameId);

    // Tag the no-id heading inside the card so we can detect its destruction.
    await harness.page.evaluate((fid) => {
      const dom = document.querySelector(`[data-frame-id="${fid}"]`);
      const host = [...dom.querySelectorAll("div")].find(el => el.shadowRoot?.getElementById("__df_content"));
      const h1 = host.shadowRoot.getElementById("__df_content").querySelector('[data-layer-id="card"] h1');
      if (h1) h1.__qaClicked = true;
      return !!h1;
    }, frameId);

    await harness.beginMutationSpy(frameId);
    await harness.clickChild(frameId, '[data-layer-id="card"] h1');
    const mut = await harness.endMutationSpy();

    // S2.1 — a plain click must not rebuild the subtree.
    report.ok(
      "S2.1 el click no reconstruye el subárbol",
      mut.added + mut.removed <= 2,
      `mutaciones estructurales: +${mut.added}/-${mut.removed} (hoy rebuild masivo)`,
    );

    // S2.2 — the clicked node keeps its identity (not replaced by innerHTML).
    const survived = await harness.page.evaluate((fid) => {
      const dom = document.querySelector(`[data-frame-id="${fid}"]`);
      const host = [...dom.querySelectorAll("div")].find(el => el.shadowRoot?.getElementById("__df_content"));
      const h1 = host.shadowRoot.getElementById("__df_content").querySelector('[data-layer-id="card"] h1');
      return !!(h1 && h1.__qaClicked === true);
    }, frameId);
    report.ok(
      "S2.2 el nodo clickeado conserva su identidad",
      survived,
      survived ? "mismo nodo" : "nodo destruido y re-creado",
    );

    return report;
  } finally {
    await deleteTemplate(templateId);
  }
}
