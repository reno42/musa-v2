/**
 * Ítem 1 UNDO-VISUAL — drag sintético + Ctrl+Z: ¿la capa vuelve a su posición?
 * Ítem 2 UNDO-BUTTONS — ¿los botones Undo/Redo salen de disabled tras editar?
 * Ítem 10d — screenshot de los botones grises tras la edición.
 *
 * Dos variantes para el ítem 1:
 *  A) capa posicionada SOLO inline (css vacío): undo revierte el <style>, pero el
 *     estilo inline del drag queda → la afirmación predice que NO vuelve.
 *  B) capa con regla CSS !important preexistente: undo restaura la regla, que
 *     vence al inline → la capa SÍ vuelve (matiza el mecanismo).
 */
import {
  EditorHarness, createVerifyTemplate, deleteTemplate,
  shot, record, log, layerState, undoButtons, sleep,
} from "./lib.mjs";

const htmlA = '<div data-layer-id="rect" data-layer-name="Rect" style="position:absolute;left:100px;top:100px;width:200px;height:150px;background:#EF4444;border-radius:8px;"></div>';
const cssB = '[data-layer-id="rect"] {\n  position: absolute;\n  left: 100px !important;\n  top: 100px !important;\n}\n';

async function variant(harness, suffix, html, css, tag) {
  const { templateId, frameId } = await createVerifyTemplate(suffix, { html, css });
  try {
    await harness.open(templateId, frameId);
    await harness.settle(200);

    const pos0 = await harness.page.evaluate(layerState, frameId, "rect");
    log(`[${tag}] inicial: box=(${pos0.box.x},${pos0.box.y}) inline=(${pos0.inlineLeft},${pos0.inlineTop})`);

    // Estado de botones ANTES de editar
    const before = await harness.page.evaluate(undoButtons);

    // Drag sintético (+150, +90)
    await harness.dragLayer(frameId, "rect", 150, 90);
    await harness.settle(300);
    const pos1 = await harness.page.evaluate(layerState, frameId, "rect");
    log(`[${tag}] post-drag: box=(${pos1.box.x},${pos1.box.y}) inline=(${pos1.inlineLeft},${pos1.inlineTop})`);
    const moved = Math.abs(pos1.box.x - pos0.box.x) > 40 && Math.abs(pos1.box.y - pos0.box.y) > 30;

    // Ítem 2: botones tras una edición válida (drag commiteado = entrada de undo)
    const afterEdit = await harness.page.evaluate(undoButtons);
    await shot(harness.page, `item2-undo-buttons-after-edit-${tag}`);
    // Crop de la zona del toolbar para el ítem 10d
    if (afterEdit.undo?.rect) {
      const r = afterEdit.undo.rect;
      await shot(harness.page, `item10d-undo-grey-${tag}`, {
        x: Math.max(0, r.x - 120), y: Math.max(0, r.y - 20), width: 320, height: 80,
      });
    }

    // Ctrl+Z
    await harness.undo();
    await harness.settle(300);
    const pos2 = await harness.page.evaluate(layerState, frameId, "rect");
    log(`[${tag}] post-undo: box=(${pos2.box.x},${pos2.box.y}) inline=(${pos2.inlineLeft},${pos2.inlineTop}) computed=(${pos2.computedLeft},${pos2.computedTop})`);
    log(`[${tag}] styleTag post-undo: ${JSON.stringify(pos2.styleTag.slice(0, 200))}`);

    const returned = Math.abs(pos2.box.x - pos0.box.x) <= 4 && Math.abs(pos2.box.y - pos0.box.y) <= 4;
    const stayed = Math.abs(pos2.box.x - pos1.box.x) <= 4 && Math.abs(pos2.box.y - pos1.box.y) <= 4;

    return {
      tag, moved, returned, stayed,
      pos0: pos0.box, pos1: pos1.box, pos2: pos2.box,
      inlineAfterUndo: { left: pos2.inlineLeft, top: pos2.inlineTop },
      styleTagAfterUndo: pos2.styleTag.slice(0, 300),
      buttons: { before, afterEdit },
    };
  } finally {
    await deleteTemplate(templateId);
  }
}

export async function run(harness) {
  const A = await variant(harness, "undoa", htmlA, "", "A-inline-only");
  const B = await variant(harness, "undob", htmlA, cssB, "B-css-important");

  // ── Ítem 1 ──
  if (!A.moved) {
    record("1 UNDO-VISUAL", "NO VERIFICADO", "el drag sintético no movió la capa (ver run.log)");
  } else if (A.stayed && !A.returned) {
    record("1 UNDO-VISUAL", "VERIFICADO",
      `variante A (posición solo inline): inicial=(${A.pos0.x},${A.pos0.y}) → drag=(${A.pos1.x},${A.pos1.y}) → undo=(${A.pos2.x},${A.pos2.y}). ` +
      `La capa NO volvió: inline residual left=${A.inlineAfterUndo.left} top=${A.inlineAfterUndo.top} con <style> revertido a ${JSON.stringify(A.styleTagAfterUndo.slice(0, 80))}. ` +
      `Variante B (regla !important preexistente): undo=(${B.pos2.x},${B.pos2.y}) → ${B.returned ? "SÍ vuelve (la regla !important restaurada vence al inline)" : "tampoco vuelve"}.`,
      "El bug se manifiesta cuando la posición original vivía solo en inline styles; con regla !important previa el undo sí restaura lo visual.");
  } else if (A.returned) {
    record("1 UNDO-VISUAL", "REFUTADO",
      `variante A: undo devolvió la capa a (${A.pos2.x},${A.pos2.y}) ≈ inicial (${A.pos0.x},${A.pos0.y}).`);
  } else {
    record("1 UNDO-VISUAL", "NO VERIFICADO",
      `resultado intermedio: pos0=${JSON.stringify(A.pos0)} pos1=${JSON.stringify(A.pos1)} pos2=${JSON.stringify(A.pos2)}`);
  }

  // ── Ítem 2 ──
  const u = A.buttons.afterEdit.undo, r = A.buttons.afterEdit.redo;
  if (u && r) {
    const stillDisabled = u.disabled && r.disabled;
    record("2 UNDO-BUTTONS", stillDisabled ? "VERIFICADO" : "REFUTADO",
      `tras drag válido (undo de teclado ${A.moved ? "funciona" : "?"}): undo.disabled=${u.disabled} (opacity ${u.opacity}, color ${u.color}), redo.disabled=${r.disabled}. ` +
      `Antes de editar: undo.disabled=${A.buttons.before.undo?.disabled}. Screenshots item2-*.png / item10d-*.png.`,
      "El store sí acumula entradas (Ctrl+Z revierte), pero canUndo/canRedo de React nunca se ponen a true.");
  } else {
    record("2 UNDO-BUTTONS", "NO VERIFICADO", "no se encontraron los botones por title en el DOM");
  }

  return { A, B };
}
