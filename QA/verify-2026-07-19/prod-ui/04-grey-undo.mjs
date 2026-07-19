/**
 * 04-grey-undo.mjs — ÍTEM 4: GREY-UNDO-PROD en PRODUCCIÓN
 *
 * Tras una edición en prod, screenshot del FloatingToolbar mostrando el estado
 * del botón Undo (corroboración visual de que permanece deshabilitado).
 * Extra: sondeo funcional (click/Ctrl+Z) para documentar el comportamiento real.
 */
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import {
  log, ts, createTemplate, purgeTemplate,
  launchProfile, attachNetLog, openEditor, shot, layerRect,
  PROFILES, SHOTS,
} from "./lib.mjs";

const FRAME = "frame_a2_undo";
const LAYER = "boxU";
const NAME = "verify-a2-undo";
const frames = [{ id: FRAME, name: "Undo", x: 0, y: 0, width: 1080, height: 1080, background: "#0E0D0B",
  html: `<div data-layer-id="${LAYER}" data-layer-name="BoxU" style="position:absolute;left:120px;top:120px;width:220px;height:180px;background:#C8B898;border-radius:12px;"></div>`, css: "" }];

const results = { item: "4-GREY-UNDO-PROD" };
let tplId = null;

const undoState = (page) => page.evaluate(() => {
  const btn = document.querySelector('button[title="Undo (Ctrl+Z)"]');
  if (!btn) return { found: false };
  const cs = getComputedStyle(btn);
  const r = btn.getBoundingClientRect();
  return {
    found: true, disabled: btn.disabled, opacity: cs.opacity, color: cs.color, cursor: cs.cursor,
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
  };
});

const redoState = (page) => page.evaluate(() => {
  const btn = document.querySelector('button[title="Redo (Ctrl+Shift+Z)"]');
  return btn ? { disabled: btn.disabled, opacity: getComputedStyle(btn).opacity } : { found: false };
});

try {
  tplId = await createTemplate(NAME, frames);
  const browser = await launchProfile(path.join(PROFILES, "e-undo"));
  const page = await browser.newPage();
  attachNetLog(page, "UNDO");
  await openEditor(page, tplId, FRAME);

  // Estado ANTES de editar
  const before = await undoState(page);
  log("undo ANTES de editar:", JSON.stringify(before));
  await shot(page, "04-01-undo-antes-de-editar");

  // Edición (drag visible)
  await page.evaluate((f, l) => window.__qa.dragLayer(f, l, 160, 0), FRAME, LAYER);
  await sleep(300);
  const rAfter = await layerRect(page, FRAME, LAYER);
  log("rect tras drag:", rAfter?.x);

  // Estado DESPUÉS de editar
  const after = await undoState(page);
  const afterRedo = await redoState(page);
  log("undo DESPUÉS de editar:", JSON.stringify(after), "redo:", JSON.stringify(afterRedo));
  await shot(page, "04-02-undo-despues-de-editar-full");

  // Crop del botón Undo (+ contexto de la toolbar)
  if (after.found) {
    const clip = {
      x: Math.max(0, after.rect.x - 12), y: Math.max(0, after.rect.y - 160),
      width: 220, height: 260,
    };
    await page.screenshot({ path: path.join(SHOTS, "04-03-undo-boton-crop.png"), clip });
    log("screenshot shots/04-03-undo-boton-crop.png");
  }

  // Sondeo funcional: ¿revierte algo Ctrl+Z? (contexto: S3.1 round-trip roto en QA local)
  await page.evaluate(() => window.__qa.undo());
  await sleep(300);
  const rUndo = await layerRect(page, FRAME, LAYER);
  const undoBtnAfterCtrlZ = await undoState(page);
  log("rect tras Ctrl+Z:", rUndo?.x, "| botón undo ahora:", JSON.stringify(undoBtnAfterCtrlZ));
  await shot(page, "04-04-tras-ctrl-z");

  await browser.close();

  results.states = {
    beforeEdit: before,
    afterEdit: { ...after, redo: afterRedo },
    rectAfterDrag: rAfter?.x,
    rectAfterCtrlZ: rUndo?.x,
    undoBtnAfterCtrlZ,
  };
  results.verdict = {
    undoDisabledBeforeEdit: before.disabled === true,
    undoStillDisabledAfterEdit: after.disabled === true,
    ctrlZRevertedEdit: typeof rUndo?.x === "number" && Math.abs(rUndo.x - 120) <= 3,
    corroboratesGreyUndo: after.disabled === true,
  };
} catch (err) {
  results.fatal = err.message;
  log("FATAL", err.message);
} finally {
  if (tplId) log("cleanup", JSON.stringify(await purgeTemplate(tplId)));
}

console.log("\n===== RESULT ITEM-4 =====");
console.log(JSON.stringify(results, null, 2));
