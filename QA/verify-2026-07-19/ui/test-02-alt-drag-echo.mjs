/**
 * Ítem 3 ALT-DRAG — duplicateForDrag hace content.innerHTML a mitad del gesto:
 * ¿cuántos nodos marcados sobreviven? (afirmación: 0)
 * Ítem 8 ECHO-HTML — tras un commit local que emite HTML (alt-drag), ¿corre un
 * reconcile innecesario? Se siembra un centinela en futurariaAgent.__lastReconcile
 * y se mira si un reconcile posterior lo sobrescribe (afirmación: sí, y re-hashea
 * todas las capas). Contraste: un drag normal (solo CSS) NO debe disparar reconcile.
 */
import {
  EditorHarness, createVerifyTemplate, deleteTemplate,
  shot, record, log, sleep,
} from "./lib.mjs";

const HTML = [
  '<div data-layer-id="card" data-layer-name="Card" style="position:absolute;left:80px;top:80px;width:520px;height:360px;background:#12203a;border-radius:24px;"></div>',
  '<div data-layer-id="pill" data-layer-name="Pill" style="position:absolute;left:80px;top:520px;width:220px;height:64px;background:#C8B898;border-radius:999px;"></div>',
  '<div data-layer-id="dot" data-layer-name="Dot" style="position:absolute;left:700px;top:120px;width:120px;height:120px;background:#EF4444;border-radius:50%;"></div>',
].join("\n");

const SENTINEL = { patched: -1, inserted: -1, removed: -1, skipped: -1, durationMs: -1, sentinel: true };

export async function run(harness) {
  const { templateId, frameId } = await createVerifyTemplate("altdrag", { html: HTML });
  try {
    await harness.open(templateId, frameId);
    await harness.settle(200);

    const marked = await harness.markNodes(frameId);
    log(`[altdrag] nodos marcados: ${marked}`);

    // ── Contraste ítem 8: drag NORMAL (commit solo CSS) ──
    await harness.page.evaluate(s => { window.futurariaAgent.__lastReconcile = s; }, SENTINEL);
    await harness.dragLayer(frameId, "pill", 40, 20);
    await harness.settle(600);
    const afterNormalDrag = await harness.page.evaluate(() => window.futurariaAgent.__lastReconcile);
    const normalDragReconciled = !(afterNormalDrag && afterNormalDrag.sentinel);
    log(`[echo] drag normal → reconcile posterior: ${normalDragReconciled} (${JSON.stringify(afterNormalDrag)})`);

    // Restaurar estado para el alt-drag (undo del drag normal) y re-marcar
    await harness.undo();
    await harness.settle(300);
    const marked2 = await harness.markNodes(frameId);

    // ── Ítem 3: ALT-DRAG ──
    await harness.page.evaluate(s => { window.futurariaAgent.__lastReconcile = s; }, SENTINEL);
    await harness.beginMutationSpy(frameId);
    const drag = await harness.altDragLayer(frameId, "dot", 140, 70);
    await harness.settle(600);
    const muts = await harness.endMutationSpy();
    const survivors = await harness.countSurvivors(frameId);
    const totalAfter = await harness.page.evaluate(fid => {
      const wrapper = document.querySelector(`[data-frame-id="${fid}"]`);
      const host = [...wrapper.querySelectorAll("div")].find(el => el.shadowRoot && el.shadowRoot.getElementById("__df_content"));
      return host.shadowRoot.getElementById("__df_content").querySelectorAll("[data-layer-id]").length;
    }, frameId);
    log(`[altdrag] drag.ok=${drag.ok} mutaciones: +${muts.added}/-${muts.removed} supervivientes=${survivors}/${marked2} nodosTras=${totalAfter}`);
    await shot(harness.page, "item3-alt-drag-after");

    // ── Ítem 8: ¿corrió un reconcile tras el commit local con HTML? ──
    await sleep(700); // margen para el round-trip del echo
    const afterAltDrag = await harness.page.evaluate(() => window.futurariaAgent.__lastReconcile);
    const echoReconciled = !(afterAltDrag && afterAltDrag.sentinel);
    const layersRehashed = echoReconciled
      ? (afterAltDrag.patched + afterAltDrag.inserted + afterAltDrag.removed + afterAltDrag.skipped)
      : 0;
    log(`[echo] alt-drag → reconcile posterior: ${echoReconciled} stats=${JSON.stringify(afterAltDrag)} capasRehasheadas=${layersRehashed}`);

    // Ítem 3
    if (!drag.ok) {
      record("3 ALT-DRAG", "NO VERIFICADO", "altDragLayer no encontró el nodo o falló");
    } else {
      record("3 ALT-DRAG", survivors === 0 ? "VERIFICADO" : "REFUTADO",
        `marcados=${marked2}, supervivientes=${survivors} (misma referencia de nodo). Mutaciones durante el gesto: +${muts.added} nodos añadidos / -${muts.removed} eliminados. Nodos [data-layer-id] tras el gesto: ${totalAfter} (3 originales + 1 duplicado). Screenshot item3-alt-drag-after.png.`,
        "duplicateForDrag ejecuta content.innerHTML = duplicated.html a mitad del gesto (DesignFrame.tsx:1765).");
    }

    // Ítem 8
    if (!echoReconciled) {
      record("8 ECHO-HTML", "REFUTADO",
        `tras el commit con HTML del alt-drag NO corrió ningún reconcile (centinela intacto). Drag normal tampoco: ${!normalDragReconciled}.`);
    } else {
      const s = afterAltDrag;
      record("8 ECHO-HTML", "VERIFICADO",
        `tras el commit local (alt-drag → emitFrameChange con HTML) corrió un reconcile completo: patched=${s.patched}, inserted=${s.inserted}, removed=${s.removed}, skipped=${s.skipped}, durationMs=${s.durationMs?.toFixed?.(2)} → ${layersRehashed} capas re-hasheadas aunque el DOM ya estaba igual. ` +
        `Contraste: drag normal (solo CSS) → reconcile posterior = ${normalDragReconciled} (centinela ${normalDragReconciled ? "sobrescrito" : "intacto"}).`,
        "emitFrameChange marca lastEmittedCssRef pero no lastEmittedHtmlRef (DesignFrame.tsx:220-226) → el echo de vuelta del padre supera el gate y re-ejecuta reconcileFrameHtml.");
    }

    return { survivors, marked2, muts, afterAltDrag, normalDragReconciled };
  } finally {
    await deleteTemplate(templateId);
  }
}
