/**
 * Ítem 4 SCRUB-FLOOD — scrub REAL (asíncrono, ~60ms entre ticks) sobre el input
 * de font-size del panel contextual. Luego Ctrl+Z repetidos contando cuántos
 * hacen falta para volver al valor inicial. Afirmación: ~1 entrada de undo por
 * tick (sin coalescing por gesto).
 *
 * OJO: los ticks se hacen con pausas reales (setTimeout) — síncronos, React 18
 * los batch-earía y daría un falso verde.
 */
import {
  createVerifyTemplate, deleteTemplate,
  shot, record, log, sleep,
} from "./lib.mjs";

const HTML = [
  '<div data-layer-id="card" data-layer-name="Card" style="position:absolute;left:80px;top:80px;width:520px;height:360px;background:#12203a;border-radius:24px;padding:40px;box-sizing:border-box;">',
  '  <h1 style="margin:0;font-family:sans-serif;font-size:44px;color:#EDE8DC;">Titular de prueba</h1>',
  '</div>',
].join("\n");

// Scrub asíncrono dentro de la página: N ticks con pausa real entre ellos.
// Apunta al input de la fila "Size" (Typography) — no al primer input px que
// aparezca (eso sería margin/padding del contenedor).
async function scrubAsync(page, steps, pauseMs) {
  return page.evaluate(async (steps, pauseMs) => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const panel = document.querySelector(".html-contextual-panel");
    if (!panel) return { ok: false, reason: "no panel" };
    const rows = [...panel.querySelectorAll("div")].filter(d =>
      d.firstElementChild && d.firstElementChild.tagName === "SPAN" &&
      d.firstElementChild.textContent.trim() === "Size");
    const sizeInput = rows.length ? rows[0].querySelector("input") : null;
    if (!sizeInput) {
      const labels = [...panel.querySelectorAll("div > span")].map(s => s.textContent.trim()).filter(Boolean).slice(0, 30);
      return { ok: false, reason: "no Size row input", labels };
    }
    const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    const original = parseFloat(sizeInput.value);
    let val = original;
    for (let i = 0; i < steps; i++) {
      val += 1;
      nativeSet.call(sizeInput, val + "px");
      sizeInput.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(pauseMs); // pausa real → cada tick es su propio macrotask/commit
    }
    return { ok: true, original, final: val };
  }, steps, pauseMs);
}

// Ctrl+click (deep select) sobre el h1: sin Ctrl el click selecciona el
// contenedor top-level (resolveHitTarget), no el texto.
function ctrlClickChild(frameId, selector) {
  const wrapper = document.querySelector(`[data-frame-id="${frameId}"]`);
  if (!wrapper) return { ok: false, reason: "no wrapper" };
  const host = [...wrapper.querySelectorAll("div")].find(el => el.shadowRoot && el.shadowRoot.getElementById("__df_content"));
  if (!host) return { ok: false, reason: "no host" };
  const el = host.shadowRoot.getElementById("__df_content").querySelector(selector);
  if (!el) return { ok: false, reason: "no element" };
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const fire = (t, type) => t.dispatchEvent(new MouseEvent(type, {
    bubbles: true, cancelable: true, composed: true, view: window, button: 0,
    clientX: x, clientY: y, ctrlKey: true,
  }));
  fire(el, "mousedown");
  fire(document, "mouseup");
  return { ok: true, tag: el.tagName, layerId: el.getAttribute("data-layer-id") };
}

function readComputedFontSize(frameId) {
  const wrapper = document.querySelector(`[data-frame-id="${frameId}"]`);
  if (!wrapper) return null;
  const host = [...wrapper.querySelectorAll("div")].find(el => el.shadowRoot && el.shadowRoot.getElementById("__df_content"));
  if (!host) return null;
  const h1 = host.shadowRoot.getElementById("__df_content").querySelector('[data-layer-id="card"] h1');
  if (!h1) return null;
  return parseFloat(h1.ownerDocument.defaultView.getComputedStyle(h1).fontSize);
}

export async function run(harness) {
  const { templateId, frameId } = await createVerifyTemplate("scrub", { html: HTML });
  try {
    await harness.open(templateId, frameId);
    await harness.settle(200);

    const click = await harness.page.evaluate(ctrlClickChild, frameId, '[data-layer-id="card"] h1');
    await harness.settle(300);
    log(`[scrub] ctrl+click h1: ${JSON.stringify(click)}`);

    const font0 = await harness.page.evaluate(readComputedFontSize, frameId);
    await shot(harness.page, "item4-panel-before-scrub");

    const STEPS = 18, PAUSE = 60;
    const t0 = Date.now();
    const scrub = await scrubAsync(harness.page, STEPS, PAUSE);
    const wallMs = Date.now() - t0;
    await harness.settle(900); // dejar que cualquier debounce/commit termine

    if (!scrub.ok) {
      record("4 SCRUB-FLOOD", "NO VERIFICADO", `no se pudo hacer scrub: ${scrub.reason} ${JSON.stringify(scrub.labels || "")}`);
      return { scrub };
    }

    const font1 = await harness.page.evaluate(readComputedFontSize, frameId);
    log(`[scrub] ${STEPS} ticks asíncronos en ${wallMs}ms (~${Math.round(wallMs / STEPS)}ms/tick). font-size: ${font0} → computado ${font1} (final esperado ${scrub.final})`);
    await shot(harness.page, "item4-panel-after-scrub");
    if (font1 !== scrub.final) {
      record("4 SCRUB-FLOOD", "NO VERIFICADO",
        `el scrub no cambió el font-size computado (${font0} → ${font1}, esperado ${scrub.final}); no se puede medir el undo flood así.`);
      return { scrub, font0, font1 };
    }

    // Contar undos hasta volver al valor inicial
    const trail = [];
    let undos = 0;
    let current = font1;
    const MAXU = 45;
    while (undos < MAXU && current !== font0) {
      await harness.undo();
      await harness.settle(160);
      current = await harness.page.evaluate(readComputedFontSize, frameId);
      undos++;
      if (undos <= 3 || current === font0) trail.push(`undo#${undos}→${current}px`);
    }
    log(`[scrub] undos para volver a ${font0}px: ${undos}. Trayectoria: ${trail.join(", ")}`);
    await shot(harness.page, "item4-after-undos");

    const oneUndoValue = trail.length ? parseFloat(trail[0].split("→")[1]) : null;
    const perTick = undos >= STEPS - 1; // tolerancia ±1 por redondeo de px
    record("4 SCRUB-FLOOD", perTick ? "VERIFICADO" : "REFUTADO",
      `scrub de ${STEPS} ticks con pausas reales de ~${Math.round(wallMs / STEPS)}ms: font-size ${font0}px → ${font1}px. ` +
      `Un solo Ctrl+Z revierte a ${oneUndoValue}px (1 paso de 1px, no el gesto completo). ` +
      `Undos necesarios para volver a ${font0}px: ${undos} (≈${STEPS} ticks → ~1 entrada de undo por tick, sin coalescing). ` +
      `Screenshots item4-*.png.`,
      "Cada onChange del panel llama handleCssChange → store.replaceAllWithUndo (EditorV2.tsx:579-590); el 'coalesce' de 300ms es código muerto (solo actualiza un ref, no filtra nada).");

    return { scrub, font0, font1, undos };
  } finally {
    await deleteTemplate(templateId);
  }
}
