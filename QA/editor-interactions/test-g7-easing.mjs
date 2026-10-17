/**
 * G7 — "easing simple" (gap-analysis G7, W1.3).
 *
 * Pre-fix reality: el selector de easing era un <select> en inglés sin
 * curvas ("Linear", "Ease out expo"…) con una opción "custom…" que exponía
 * el string cubic-bezier(...) como texto editable; en modo video los
 * carriles listaban los valores crudos y los tooltips los mostraban.
 *
 * Fix under test:
 *   G7.0  modo capa: botón con mini-curva + etiqueta; abre menú de 5
 *         opciones (Lineal/Acelerar/Frenar/Acelerar-y-frenar/Salto), cada
 *         una con su curva dibujada — y NINGÚN texto "cubic-bezier(" en el
 *         panel de animación.
 *   G7.1  mapeo exacto: Fade-in (ease-out) → botón "Frenar" sin "≈" (DB).
 *   G7.2  elegir "Salto": el tween persiste como la curva overshoot que el
 *         motor ya resuelve (cubic-bezier(0.34, 1.56, 0.64, 1)), botón
 *         "Salto", menú cerrado, sin texto bezier en pantalla.
 *   G7.3  preview: al pasar el cursor por una opción, el punto recorre la
 *         curva (dos lecturas de cx difieren — rAF real, no estático).
 *   G7.4  honestidad con curva custom (seed directo al frame): botón
 *         "≈ <más parecida>" SIN mutar el valor; elegir "Lineal" sí lo
 *         reemplaza (DB linear, etiqueta exacta).
 *
 * Fixture: lib/seed.mjs — frame card/pill/dot. G7.4 usa el override `frame`
 * para hornear un tween con bezier custom antes de abrir el editor.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { makeReport } from "./lib/assert.mjs";
import { seedEditorFixture, injectSession, clearInjectedSession, fetchTemplateRow } from "./lib/seed.mjs";

const CUSTOM_EASING = "cubic-bezier(0.55, 0.05, 0.7, 0.35)";
const SALTO_VALUE = "cubic-bezier(0.34, 1.56, 0.64, 1)";
const FIVE_LABELS = ["Lineal", "Acelerar", "Frenar", "Acelerar y frenar", "Salto"];

/** Click the contextual panel's "animation" tab (S4/G2 idiom). */
async function openAnimationTab(page) {
  for (let i = 0; i < 8; i++) {
    const done = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "animation");
      if (!btn) {
        document.querySelector("button[title='Propiedades de lo seleccionado']")?.click();
        return false;
      }
      btn.click();
      return true;
    });
    if (done) return true;
    await sleep(400);
  }
  return false;
}

/** Select the frame itself (label click) → AnimationPanel in FRAME mode. */
async function selectFrame(page, frameId) {
  const ok = await page.evaluate(fid => {
    const label = document.querySelector(`[data-frame-label-id="${fid}"]`);
    if (!label) return false;
    label.click();
    return true;
  }, frameId);
  await sleep(350);
  return ok;
}

/** Apply the first preset ("Fade in") to one layer via the frame-mode
 *  "Biblioteca a capa" dropdown + card click (G2 idiom). */
async function applyFadeIn(page, layerId) {
  const picked = await page.select('[data-qa="g2-preset-target"]', layerId);
  if (!picked || picked[0] !== layerId) return false;
  await sleep(150);
  return page.evaluate(() => {
    const input = document.querySelector("input[placeholder^='Buscar preset']");
    if (!input) return false;
    const btn = [...input.parentElement.querySelectorAll("button")].find(b => / — /.test(b.getAttribute("title") || ""));
    if (!btn) return false;
    btn.click();
    return true;
  });
}

/** Visible text of the AnimationPanel as seen from the picker: first
 *  ancestor whose text includes the layer-mode section "Ventana temporal",
 *  with <style>/<script> internals stripped — the preset hover-preview CSS
 *  legitimately contains cubic-bezier() timing functions that are STYLING,
 *  not text shown to the user (G7's invariant is about the latter). */
async function panelVisibleText(page) {
  return page.evaluate(() => {
    const btn = document.querySelector('[data-qa="g7-easing"]');
    if (!btn) return null;
    let n = btn.parentElement;
    for (let i = 0; i < 15 && n; i++) {
      if ((n.textContent || "").includes("Ventana temporal")) {
        const clone = n.cloneNode(true);
        clone.querySelectorAll("style, script").forEach(e => e.remove());
        return clone.textContent || "";
      }
      n = n.parentElement;
    }
    return null;
  });
}

/** First tween easing of a layer's clip, straight from the DB row. */
async function tweenEasingFromDb(fx, layerId) {
  const design = await fetchTemplateRow(fx.templateId);
  const frame = (design?.frames || []).find(f => f.id === fx.frameId);
  const clip = (frame?.animation?.clips || []).find(c => c.layerId === layerId);
  return clip?.tweens?.[0]?.easing ?? null;
}

/** Poll the DB until the tween easing matches pred (autosave latency). */
async function waitTweenEasing(fx, layerId, pred, tries = 12) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    try {
      last = await tweenEasingFromDb(fx, layerId);
      if (last !== null && pred(last)) return last;
    } catch { /* retry */ }
    await sleep(1000);
  }
  return null;
}

export async function run(harness) {
  const report = makeReport("G7 · easing simple — selector con mini-curva, sin cubic-bezier como texto");
  const fx = await seedEditorFixture({ name: "QA — G7 easing" });
  let fx2 = null;
  try {
    const page = harness.page;
    await injectSession(page, fx.session);
    await harness.open(fx.templateId, fx.frameId);

    // Frame mode → Fade-in on pill → layer mode (the tween editor lives there).
    const framePicked = await selectFrame(page, fx.frameId);
    const tab0 = framePicked ? await openAnimationTab(page) : false;
    const applied = tab0 ? await applyFadeIn(page, "pill") : false;
    if (!applied) {
      report.ok("G7.0 setup: aplicar Fade-in a pill (modo frame)", false,
        `label=${framePicked} tab=${tab0} — sin panel de animación o sin preset aplicado`);
      return report;
    }
    await sleep(400);
    await harness.clickLayer(fx.frameId, "pill");
    const layerTab = await openAnimationTab(page);
    const pickerSeen = layerTab ? await page.evaluate(() => !!document.querySelector('[data-qa="g7-easing"]')) : false;
    if (!pickerSeen) {
      report.ok("G7.0 picker de easing presente en el editor de tween (modo capa)", false,
        `tab=${layerTab} — el tween row no muestra el selector`);
      return report;
    }

    // G7.0 — menu of five, each with a drawn curve; no bezier text in the panel.
    await page.evaluate(() => { document.querySelector('[data-qa="g7-easing"]')?.click(); });
    await sleep(150);
    const menuState = await page.evaluate(() => {
      const opts = [...document.querySelectorAll('[data-qa="g7-option"]')];
      return {
        open: !!document.querySelector('[data-qa="g7-menu"]'),
        count: opts.length,
        withCurve: opts.filter(o => !!o.querySelector('[data-qa="g7-curve"]')).length,
        labels: opts.map(o => (o.textContent || "").trim()),
      };
    });
    const panelText = await panelVisibleText(page);
    const noBezierText = panelText !== null && !/cubic-bezier\(/.test(panelText);
    const allLabels = menuState.labels.join(" ");
    const labelsOk = FIVE_LABELS.every(l => allLabels.includes(l));
    report.ok(
      "G7.0 menú de 5 curvas (Lineal/Acelerar/Frenar/Acelerar-y-frenar/Salto) y cero texto cubic-bezier( en el panel",
      menuState.open && menuState.count === 5 && menuState.withCurve === 5 && labelsOk && noBezierText,
      `menú=${menuState.open} opciones=${menuState.count} conCurva=${menuState.withCurve} etiquetas=${labelsOk} sinBezier=${noBezierText}`,
    );

    // G7.1 — exact mapping: Fade-in's ease-out reads "Frenar", no "≈".
    // (tries=10: the preset's autosave flushes a few seconds after apply.)
    const dbEaseOut = await waitTweenEasing(fx, "pill", e => e === "ease-out", 10);
    const labelState = await page.evaluate(() => {
      const btn = document.querySelector('[data-qa="g7-easing"]');
      const span = btn?.querySelector("span");
      return span ? span.textContent.trim() : null;
    });
    report.ok(
      "G7.1 Fade-in (ease-out) se lee como su nombre — «Frenar» exacto, sin «≈»",
      dbEaseOut === "ease-out" && labelState === "Frenar",
      `DB=${dbEaseOut} botón=«${labelState}»`,
    );

    // G7.2 — pick "Salto": overshoot curve persists, UI stays text-clean.
    await page.evaluate(v => {
      const opt = document.querySelector(`[data-qa="g7-option"][data-value="${CSS.escape(v)}"]`);
      opt?.click();
    }, SALTO_VALUE);
    const dbSalto = await waitTweenEasing(fx, "pill", e => e === SALTO_VALUE);
    const afterSalto = await page.evaluate(() => ({
      menuOpen: !!document.querySelector('[data-qa="g7-menu"]'),
      label: document.querySelector('[data-qa="g7-easing"] span')?.textContent.trim() ?? null,
      legacyCustomInput: !!document.querySelector("input[title^='CSS easing']"),
    }));
    const panel2Text = await panelVisibleText(page);
    const noBezier2 = panel2Text !== null && !/cubic-bezier\(/.test(panel2Text);
    report.ok(
      "G7.2 elegir «Salto» persiste la curva overshoot (la que el motor ya resuelve) y el string nunca aparece como texto",
      dbSalto === SALTO_VALUE && afterSalto.label === "Salto" && !afterSalto.menuOpen && !afterSalto.legacyCustomInput && noBezier2,
      `DB=${dbSalto === SALTO_VALUE} botón=«${afterSalto.label}» menúCerrado=${!afterSalto.menuOpen} inputViejo=${afterSalto.legacyCustomInput} sinBezier=${noBezier2}`,
    );

    // G7.3 — hover preview: the dot travels the curve (two reads differ).
    await page.evaluate(() => { document.querySelector('[data-qa="g7-easing"]')?.click(); });
    await sleep(150);
    await page.hover('[data-qa="g7-option"][data-value="ease-in"]');
    await sleep(200);
    const cx1 = await page.evaluate(() =>
      document.querySelector('[data-qa="g7-option"][data-value="ease-in"] [data-qa="g7-dot"]')?.getAttribute("cx") ?? null);
    await sleep(350);
    const cx2 = await page.evaluate(() =>
      document.querySelector('[data-qa="g7-option"][data-value="ease-in"] [data-qa="g7-dot"]')?.getAttribute("cx") ?? null);
    report.ok(
      "G7.3 preview real: al pasar el cursor el punto recorre la curva (cx cambia entre lecturas)",
      cx1 !== null && cx2 !== null && cx1 !== cx2,
      `cx ${cx1} → ${cx2}`,
    );
    await page.evaluate(() => { document.querySelector('[data-qa="g7-easing"]')?.click(); }); // cerrar menú

    // G7.4 — custom easing seeded straight into the frame: "≈" display, no
    // mutation; picking "Lineal" replaces it.
    fx2 = await seedEditorFixture({
      name: "QA — G7 custom easing",
      frame: {
        animation: {
          timeline: { durationSec: 2, fps: 30, loop: "once" },
          clips: [{
            layerId: "pill", startSec: 0, endSec: 1.2,
            tweens: [{ prop: "opacity", easing: CUSTOM_EASING, keyframes: [{ t: 0, value: "0" }, { t: 1, value: "1" }] }],
          }],
        },
      },
    });
    // fx2 lives in ANOTHER seeded user's workspace — inject its session too
    // (seq retirement: the newest inject wins, the old one stays retired).
    await injectSession(page, fx2.session);
    await harness.open(fx2.templateId, fx2.frameId);
    await harness.clickLayer(fx2.frameId, "pill");
    const tab2 = await openAnimationTab(page);
    const customSeen = tab2 ? await page.evaluate(() => !!document.querySelector('[data-qa="g7-easing"]')) : false;
    let approxOk = false;
    let dbUnmutated = null;
    if (customSeen) {
      const label = await page.evaluate(() => document.querySelector('[data-qa="g7-easing"] span')?.textContent.trim() ?? null);
      approxOk = !!label && label.startsWith("≈ ") && FIVE_LABELS.some(l => label === `≈ ${l}`);
      dbUnmutated = await tweenEasingFromDb(fx2, "pill"); // display must NOT have written
    }
    let replacedOk = false;
    let dbLinear = null;
    if (approxOk) {
      await page.evaluate(() => { document.querySelector('[data-qa="g7-easing"]')?.click(); });
      await sleep(150);
      await page.evaluate(() => {
        document.querySelector('[data-qa="g7-option"][data-value="linear"]')?.click();
      });
      dbLinear = await waitTweenEasing(fx2, "pill", e => e === "linear");
      const label = await page.evaluate(() => document.querySelector('[data-qa="g7-easing"] span')?.textContent.trim() ?? null);
      replacedOk = dbLinear === "linear" && label === "Lineal";
    }
    report.ok(
      "G7.4 curva custom: se muestra «≈ <la más parecida>» sin mutar el valor; elegir una opción sí reemplaza",
      approxOk && dbUnmutated === CUSTOM_EASING && replacedOk,
      `≈=${approxOk} DBSinMutación=${dbUnmutated} → Lineal=${replacedOk} (DB=${dbLinear})`,
    );

    return report;
  } finally {
    // The injected session belongs to a user that cleanup() deletes — leaving
    // it would 401 every API call of later suites (GoTrue: user_not_found).
    if (harness.page) await clearInjectedSession(harness.page);
    await fx.cleanup();
    if (fx2) await fx2.cleanup();
  }
}
