/**
 * G2 — "stagger / timing por capa" (gap-analysis G2, W1.2).
 *
 * Pre-fix reality: el panel de animación solo ofrecía Inicio/Fin absolutos en
 * modo capa, y NINGÚN comando de escalonado — cada capa que debía entrar en
 * cascada se retocaba a mano, una por una.
 *
 * Fix under test:
 *   G2.0  el panel de frame lista los clips con checkbox y el comando
 *         "Escalonar selección" está honesto (deshabilitado con <2 marcados).
 *   G2.1  Escalonar 250 ms sobre card/pill/dot: inicios 0 · 0.25 · 0.5 con
 *         cada duración conservada — persiste vía autosave (DB).
 *   G2.2  visual REAL: al buscar 0.3s la capa dot (inicio 0.5s) sigue
 *         retenida en su primer keyframe (opacidad 0) mientras card/pill ya
 *         animan; a 0.55s dot entró en fade — y su valor coincide con el de
 *         pill a 0.3s (mismo Δt de cascada, sampling del motor, no toasts).
 *   G2.3  re-escalonar a 2500 ms: la línea de tiempo CRECE para alcanzar la
 *         cascada (dot termina ~6.2s, timeline extendido desde 5s).
 *   G2.4  modo capa: Retraso (s) y Duración (s) editan el clip de ESA capa —
 *         el retraso desplaza la ventana conservando la duración, y la
 *         duración la estira desde el inicio (DB).
 *
 * Fixture: lib/seed.mjs — frame card/pill/dot sin animación (worst case).
 */
import { setTimeout as sleep } from "node:timers/promises";
import { makeReport } from "./lib/assert.mjs";
import { seedEditorFixture, injectSession, clearInjectedSession, fetchTemplateRow } from "./lib/seed.mjs";

/** Click the contextual panel's "animation" tab (same button text in frame and
 *  layer hosts; poke the topbar Props button if the panel is closed). */
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

/** Select the frame (not a layer): clicking its canvas label selects the
 *  frame itself → the right panel hosts AnimationPanel in FRAME mode. */
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
 *  "Biblioteca a capa" dropdown + card click. */
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

/** Set a controlled <input> the React way (native value setter + input). */
async function setInput(page, selector, value) {
  return page.evaluate((sel, val) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const proto = el.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, String(val));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }, selector, value);
}

/** Poll the DB until the persisted frame.animation matches pred (autosave). */
async function waitSchema(fx, pred, tries = 15) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    await sleep(1000);
    try {
      const design = await fetchTemplateRow(fx.templateId);
      const frame = (design?.frames || []).find(f => f.id === fx.frameId);
      const anim = frame?.animation ?? null;
      last = anim ? {
        byLayer: Object.fromEntries((anim.clips || []).map(c => [c.layerId, { start: c.startSec, end: c.endSec }])),
        durationSec: anim.timeline?.durationSec ?? null,
      } : null;
      if (last && pred(last)) return last;
    } catch { /* retry */ }
  }
  return null;
}

/** Live computed opacity of a layer inside the frame's shadow DOM (S4 idiom). */
async function layerOpacity(page, frameId, layer) {
  return page.evaluate((fid, lid) => {
    const dom = document.querySelector(`[data-frame-id="${fid}"]`);
    const host = [...dom.querySelectorAll("div")].find(el => el.shadowRoot?.getElementById("__df_content"));
    const content = host.shadowRoot.getElementById("__df_content");
    const el = content.querySelector(`[data-layer-id='${lid}']`);
    return el ? Number(getComputedStyle(el).opacity) : null;
  }, frameId, layer);
}

/** Seek the transport scrubber (paused sampling through the real engine). */
async function seekTo(page, t) {
  const ok = await setInput(page, '[data-qa="anim-scrub"]', t);
  await sleep(200);
  return ok;
}

const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;

export async function run(harness) {
  const report = makeReport("G2 · stagger/timing por capa — Retraso/Duración + Escalonar selección");
  const fx = await seedEditorFixture({ name: "QA — G2 stagger" });
  try {
    const page = harness.page;
    await injectSession(page, fx.session);
    await harness.open(fx.templateId, fx.frameId);

    // Frame mode: label click → contextual panel → animation tab.
    const framePicked = await selectFrame(page, fx.frameId);
    const tabOk = framePicked ? await openAnimationTab(page) : false;
    const framePanel = tabOk ? await page.evaluate(() =>
      (document.body.textContent || "").includes("Clips (0)") && !!document.querySelector('[data-qa="g2-stagger"]')) : false;
    if (!framePanel) {
      report.ok("G2.0 panel de frame (Clips + Escalonar) alcanzable", false,
        `label=${framePicked} tab=${tabOk} — sin panel de animación en modo frame`);
      return report;
    }

    // Three presets (card → pill → dot): every layer gets a fade-in clip.
    for (const layer of ["card", "pill", "dot"]) {
      const applied = await applyFadeIn(page, layer);
      if (!applied) {
        report.ok("G2.0 aplicar Fade-in a card/pill/dot", false, `falló al aplicar a ${layer}`);
        return report;
      }
      await sleep(350);
    }

    // G2.0 — clips listed with checkboxes; the command is honest (disabled <2).
    const base0 = await waitSchema(fx, s => ["card", "pill", "dot"].every(l => s.byLayer[l] && near(s.byLayer[l].start, 0)), 10);
    const panelState = await page.evaluate(() => {
      const checks = document.querySelectorAll('[data-qa="g2-clip-check"]').length;
      const btn = document.querySelector('[data-qa="g2-stagger"]');
      return { checks, disabled: btn ? btn.disabled : null, label: btn ? btn.textContent.trim() : "" };
    });
    report.ok(
      "G2.0 3 clips con checkbox y 'Escalonar selección' deshabilitado sin marcas",
      !!base0 && panelState.checks === 3 && panelState.disabled === true,
      `clips=${!!base0} checks=${panelState.checks} deshabilitado=${panelState.disabled} («${panelState.label}»)`,
    );

    // G2.1 — stagger 250ms: starts 0 · 0.25 · 0.5, durations preserved.
    const durs = base0 ? {
      card: base0.byLayer.card.end - base0.byLayer.card.start,
      pill: base0.byLayer.pill.end - base0.byLayer.pill.start,
      dot: base0.byLayer.dot.end - base0.byLayer.dot.start,
    } : null;
    await page.evaluate(() => { document.querySelectorAll('[data-qa="g2-clip-check"]').forEach(c => { if (!c.checked) c.click(); }); });
    await setInput(page, '[data-qa="g2-stagger-ms"]', 250);
    await sleep(120);
    await page.evaluate(() => { document.querySelector('[data-qa="g2-stagger"]')?.click(); });
    const st1 = await waitSchema(fx, s =>
      near(s.byLayer.card?.start ?? -1, 0) && near(s.byLayer.pill?.start ?? -1, 0.25) && near(s.byLayer.dot?.start ?? -1, 0.5));
    const notice1 = await page.evaluate(() => (document.body.textContent || "").includes("escalonados cada 250 ms"));
    const dursKept = st1 && durs
      ? near(st1.byLayer.card.end - st1.byLayer.card.start, durs.card)
        && near(st1.byLayer.pill.end - st1.byLayer.pill.start, durs.pill)
        && near(st1.byLayer.dot.end - st1.byLayer.dot.start, durs.dot)
      : false;
    report.ok(
      "G2.1 Escalonar 250ms: inicios 0 · 0.25 · 0.5 conservando cada duración",
      !!st1 && notice1 && dursKept,
      st1
        ? `card@${st1.byLayer.card.start.toFixed(2)} pill@${st1.byLayer.pill.start.toFixed(2)} dot@${st1.byLayer.dot.start.toFixed(2)} durs ${durs.card.toFixed(2)}/${durs.pill.toFixed(2)}/${durs.dot.toFixed(2)}→ok=${dursKept} aviso=${notice1}`
        : "el schema escalonado no persistió",
    );

    // G2.2 — visual: stop, then sample the REAL engine at 0.3s and 0.55s.
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find(b => (b.getAttribute("title") || "").includes("Stop y rebobinar"));
      btn?.click();
    });
    await sleep(250);
    await seekTo(page, 0.3);
    const o3 = {
      card: await layerOpacity(page, fx.frameId, "card"),
      pill: await layerOpacity(page, fx.frameId, "pill"),
      dot: await layerOpacity(page, fx.frameId, "dot"),
    };
    await seekTo(page, 0.55);
    const o55 = { dot: await layerOpacity(page, fx.frameId, "dot") };
    report.ok(
      "G2.2 cascada visible en el motor: a 0.3s dot retenida (op 0) y a 0.55s en fade (≡ pill@0.3s)",
      o3.dot !== null && o3.dot <= 0.001 && o3.card > 0 && o3.card < 1 && o3.pill > 0 && o3.pill < 1
        && o55.dot !== null && o55.dot > 0 && o55.dot < 1 && near(o55.dot, o3.pill, 0.03),
      `@0.3s card=${o3.card?.toFixed(3)} pill=${o3.pill?.toFixed(3)} dot=${o3.dot?.toFixed(3)} · @0.55s dot=${o55.dot?.toFixed(3)} (pill@0.3=${o3.pill?.toFixed(3)})`,
    );

    // G2.3 — re-stagger at 2500ms: the timeline GROWS to reach the cascade.
    await setInput(page, '[data-qa="g2-stagger-ms"]', 2500);
    await sleep(120);
    await page.evaluate(() => { document.querySelector('[data-qa="g2-stagger"]')?.click(); });
    const dotDur = st1 ? st1.byLayer.dot.end - st1.byLayer.dot.start : 1.2;
    const st2 = await waitSchema(fx, s =>
      near(s.byLayer.dot?.start ?? -1, 5) && (s.durationSec ?? 0) >= 5 + dotDur - 0.05);
    report.ok(
      "G2.3 re-escalonar 2500ms: dot inicia a 5s y la línea crece para alcanzarlo",
      !!st2,
      st2
        ? `dot@${st2.byLayer.dot.start.toFixed(2)} fin~${st2.byLayer.dot.end.toFixed(2)} · timeline ${st2.durationSec?.toFixed(1)}s (antes 5.0)`
        : "el timeline extendido no persistió",
    );

    // G2.4 — layer mode: Retraso + Duración edit THAT layer's clip.
    await harness.clickLayer(fx.frameId, "pill");
    const layerTab = await openAnimationTab(page);
    const delaySeen = layerTab ? await page.evaluate(() => !!document.querySelector('[data-qa="g2-delay"]') && !!document.querySelector('[data-qa="g2-duration"]')) : false;
    const pillDurBefore = st2 ? st2.byLayer.pill.end - st2.byLayer.pill.start : null;
    let delayOk = false;
    let durOk = false;
    if (delaySeen) {
      await setInput(page, '[data-qa="g2-delay"]', 1.5);
      const afterDelay = await waitSchema(fx, s => near(s.byLayer.pill?.start ?? -1, 1.5), 12);
      delayOk = !!afterDelay && near(afterDelay.byLayer.pill.end - afterDelay.byLayer.pill.start, pillDurBefore ?? 1.2);
      await sleep(300);
      await setInput(page, '[data-qa="g2-duration"]', 2);
      const afterDur = await waitSchema(fx, s => near((s.byLayer.pill?.end ?? -1) - (s.byLayer.pill?.start ?? -9), 2), 12);
      durOk = !!afterDur && near(afterDur.byLayer.pill.start, 1.5);
    }
    report.ok(
      "G2.4 modo capa: Retraso desplaza (conserva duración) y Duración estira la ventana",
      delayOk && durOk,
      `retraso→[1.5, 1.5+${(pillDurBefore ?? 0).toFixed(2)}]=${delayOk} · duración→2s=${durOk} (inputs visibles=${delaySeen})`,
    );

    return report;
  } finally {
    // The injected session belongs to a user that cleanup() deletes — leaving
    // it would 401 every API call of later suites (GoTrue: user_not_found).
    if (harness.page) await clearInjectedSession(harness.page);
    await fx.cleanup();
  }
}
