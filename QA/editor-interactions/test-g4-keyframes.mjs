/**
 * G4 — "keyframes visuales" (gap-analysis G4, W2.2) — the EDITOR timeline's
 * rombos become editable (spec Propuesta 07-oct §4/6.3, scoped to the panel
 * surface; typed rows + auto-key on VALUES already live in video mode V4.1).
 *
 * Pre-fix reality: G1's rombos were read-only — click seeked, nothing else.
 * You could not retime a keyframe with the pointer, nor add one at the
 * playhead, nor copy/paste, nor edit an exact time.
 *
 * Fix under test (AnimationTimeline + layerKeyframes):
 *   G4.0  estructura: carril con rombos [0, 1.2] + ◇ (keyframe en cabezal)
 *         por carril + pista de ayuda en el pie.
 *   G4.1  ◇/◆ (auto-key en el cabezal, §4.2/4.3): con el cabezal a 0.6s
 *         añade un rombo EXACTO en 0.6 (y persiste); vuelve a ◇ al quitarlo;
 *         re-añade para los siguientes checks.
 *   G4.2  arrastrar un rombo interior cambia SOLO su tiempo: 0.6 → suelta a
 *         0.9, imán a la marca de 1s → 1.00 exacto; valor y vecinos intactos.
 *   G4.3  tiempo exacto: seleccionar el rombo (click) abre la barra de
 *         acciones; t= 0.9 + Enter lo mueve exacto.
 *   G4.4  copiar/pegar entre capas: Copiar el rombo de card, seleccionar un
 *         rombo de pill, cabezal a 0.3, Pegar en cabezal → pill gana un
 *         keyframe en 0.3 con el VALOR copiado (misma propiedad).
 *   G4.5  duplicar/borrar: Duplicar el rombo 1.2 cae justo al lado (1.05);
 *         Borrar lo elimina y el carril vuelve a [0, 0.9, 1.2].
 *
 * Fixture: lib/seed.mjs — frame card/pill/dot; Fade-in ×3 como en G1/G2
 * (clips 0→1.2s, timeline 5s, kfs conocidos en 0 y 1.2, opacity "0"→"1").
 */
import { setTimeout as sleep } from "node:timers/promises";
import { makeReport } from "./lib/assert.mjs";
import { seedEditorFixture, injectSession, clearInjectedSession, fetchTemplateRow } from "./lib/seed.mjs";

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

/** Apply the first preset ("Fade in") to one layer (G2 idiom). */
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

/** Ruler geometry + the transport time (G1 idiom). */
async function tlState(page) {
  return page.evaluate(() => {
    const ruler = document.querySelector('[data-qa="g1-ruler"]');
    const head = document.querySelector('[data-qa="g1-playhead"]');
    if (!ruler || !head) return null;
    const r = ruler.getBoundingClientRect();
    const span = [...document.querySelectorAll("span")].find(s => /\d\.\d\d \/ \d/.test(s.textContent || ""));
    return { rect: { left: r.left, top: r.top }, pps: ruler.offsetWidth / 5, transportT: span ? parseFloat(span.textContent) : null };
  });
}

/** Pause the transport and wait for a stable time — preset applies auto-play
 *  a confirmation (playFrame(0)); drifting reads fake offsets (G1 lesson). */
async function pauseAndWait(page) {
  for (let i = 0; i < 12; i++) {
    const playing = await page.evaluate(() => {
      const row = document.querySelector('[data-qa="g1-prev-kf"]')?.parentElement;
      const btn = row ? [...row.querySelectorAll("button")].find(b => b.textContent.includes("Pausa")) : null;
      if (!btn) return false;
      btn.click();
      return true;
    });
    if (!playing) {
      const a = (await tlState(page))?.transportT ?? null;
      await sleep(120);
      const b = (await tlState(page))?.transportT ?? null;
      if (a !== null && a === b) return true;
    }
    await sleep(120);
  }
  return false;
}

/** Drag the mouse (trusted events) from a selector's center to an absolute x. */
async function dragToX(page, selector, x) {
  const c = await page.evaluate(sel => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
  if (!c) return false;
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(x, c.y, { steps: 10 });
  await page.mouse.up();
  return true;
}

/** React-safe control write (G2 idiom) + Enter to commit (g4-t commits on
 *  Enter/blur — one operation, not one per keystroke). */
async function setControlEnter(page, selector, value) {
  return page.evaluate((sel, val) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const proto = window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, String(val));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    return true;
  }, selector, value);
}

/** Expand one layer's property lanes (G1 idiom). */
async function expandLayer(page, layerId) {
  return page.evaluate(lid => {
    const row = document.querySelector(`[data-qa="g1-layer-row"][data-layer-id="${lid}"]`);
    if (!row) return false;
    row.querySelector('[data-qa="g1-layer-toggle"]')?.click();
    return true;
  }, layerId);
}

/** Lane state of one layer: kfs (t + value) of its FIRST lane. */
async function laneState(page, layerId) {
  return page.evaluate(lid => {
    const row = document.querySelector(`[data-qa="g1-layer-row"][data-layer-id="${lid}"]`);
    const rowRoot = row?.parentElement;
    const lane = rowRoot?.querySelector('[data-qa="g1-lane"]');
    const kfs = [...(rowRoot?.querySelectorAll('[data-qa="g1-kf"]') || [])].map(k => ({ t: k.getAttribute("data-t"), v: k.getAttribute("data-value") }));
    return { prop: lane?.getAttribute("data-prop") ?? null, kfs, toggle: lane?.querySelector('[data-qa="g4-kf-toggle"]')?.getAttribute("data-state") ?? null };
  }, layerId);
}

/** Poll the DB until the layer's opacity tween matches pred (autosave). */
async function waitAnim(fx, layerId, pred, tries = 12) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    await sleep(900);
    try {
      const design = await fetchTemplateRow(fx.templateId);
      const frame = (design?.frames || []).find(f => f.id === fx.frameId);
      const clip = (frame?.animation?.clips || []).find(c => c.layerId === layerId);
      const tw = (clip?.tweens || []).find(t => String(t.prop) === "opacity");
      if (tw && clip) {
        const dur = Math.max(0.0001, clip.endSec - clip.startSec);
        const sorted = [...tw.keyframes].sort((a, b) => a.t - b.t);
        last = {
          times: sorted.map(k => Math.round((clip.startSec + k.t * dur) * 100) / 100),
          values: sorted.map(k => String(k.value)),
        };
        if (pred(last)) return last;
      }
    } catch { /* retry */ }
  }
  return last;
}

const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;
const eq2 = (arr, want) => arr.length === want.length && want.every((w, i) => near(arr[i], w));

export async function run(harness) {
  const report = makeReport("G4 · keyframes visuales — arrastrar rombos, ◇/◆ en el cabezal, copiar/pegar, tiempo exacto");
  const fx = await seedEditorFixture({ name: "QA — G4 keyframes" });
  try {
    const page = harness.page;
    await injectSession(page, fx.session);
    await harness.open(fx.templateId, fx.frameId);

    const framePicked = await selectFrame(page, fx.frameId);
    const tabOk = framePicked ? await openAnimationTab(page) : false;
    for (const layer of ["card", "pill", "dot"]) {
      if (tabOk) { await applyFadeIn(page, layer); await sleep(350); }
    }
    const paused = await pauseAndWait(page);

    // G4.0 — structure: lanes with rombos + ◇ per lane + footer hint.
    await expandLayer(page, "card");
    await sleep(250);
    const st0 = await laneState(page, "card");
    const hint = await page.evaluate(() => (document.querySelector('[data-qa="g1-timeline"]')?.textContent || "").includes("rombo interior"));
    report.ok(
      "G4.0 carril con rombos [0, 1.2] + botón ◇ (keyframe en cabezal) por carril + ayuda en el pie",
      paused && tabOk && st0?.prop === "opacity" && st0.kfs.length === 2 && st0.kfs.some(k => k.t === "0") && st0.kfs.some(k => k.t === "1.2") && !!st0.toggle && hint,
      `pausado=${paused} carril=${st0?.prop} rombos=[${st0?.kfs.map(k => k.t)}] ◇=${st0?.toggle} ayuda=${hint}`,
    );

    // Cabezal a 0.6s (dentro del clip 0→1.2) — click en la regla, sin imán cerca.
    let st = await tlState(page);
    if (st) await page.mouse.click(st.rect.left + 0.6 * st.pps, st.rect.top + 8);
    await sleep(250);
    const headT = (await tlState(page))?.transportT ?? null;

    // G4.1 — ◇/◆ add / remove at the playhead.
    const tgl1 = await page.evaluate(() => { document.querySelector('[data-qa="g1-lane"] [data-qa="g4-kf-toggle"]')?.click(); return !!document.querySelector('[data-qa="g1-lane"] [data-qa="g4-kf-toggle"]'); });
    await sleep(300);
    const stAdd = await laneState(page, "card");
    const dbAdd = await waitAnim(fx, "card", a => a.times.length === 3 && a.times.some(t => near(t, 0.6)));
    await page.evaluate(() => { document.querySelector('[data-qa="g1-lane"] [data-qa="g4-kf-toggle"]')?.click(); });
    await sleep(300);
    const stRem = await laneState(page, "card");
    await page.evaluate(() => { document.querySelector('[data-qa="g1-lane"] [data-qa="g4-kf-toggle"]')?.click(); });
    await sleep(300);
    const stRe = await laneState(page, "card");
    report.ok(
      "G4.1 ◇→◆ añade keyframe EXACTO en el cabezal (0.6s) y persiste; ◆→◇ lo quita; re-añade",
      tgl1 && headT !== null && near(headT, 0.6, 0.05)
        && stAdd?.toggle === "on" && stAdd.kfs.length === 3 && stAdd.kfs.some(k => k.t === "0.6")
        && !!dbAdd && dbAdd.times.length === 3 && dbAdd.times.some(t => near(t, 0.6))
        && stRem?.toggle === "off" && stRem.kfs.length === 2
        && stRe?.kfs.length === 3 && stRe.kfs.some(k => k.t === "0.6"),
      `cabezal=${headT?.toFixed(2)} añade=[${stAdd?.kfs.map(k => k.t)}] ◇=${stAdd?.toggle}→${stRem?.toggle} DB=[${dbAdd?.times}] re-añade=[${stRe?.kfs.map(k => k.t)}]`,
    );

    // G4.2 — drag the INNER 0.6s rombo: drop at 0.9, magnet lands 1.00 exact.
    const valBefore = stRe.kfs.find(k => k.t === "0.6")?.v ?? null;
    st = await tlState(page);
    const dragged = st ? await dragToX(page, '[data-qa="g1-kf"][data-t="0.6"]', st.rect.left + 0.9 * st.pps) : false;
    await sleep(350);
    const stDrag = await laneState(page, "card");
    const dbDrag = await waitAnim(fx, "card", a => a.times.length === 3 && a.times.some(t => near(t, 1)));
    const valAfter = stDrag.kfs.map(k => k.t).includes("1") ? stDrag.kfs.find(k => k.t === "1")?.v : null;
    report.ok(
      "G4.2 arrastrar el rombo interior cambia SOLO su tiempo: 0.6 → imán 1.00 exacto; valor y vecinos intactos",
      dragged && stDrag.kfs.length === 3 && stDrag.kfs.some(k => k.t === "1")
        && stDrag.kfs.some(k => k.t === "0") && stDrag.kfs.some(k => k.t === "1.2")
        && valBefore !== null && valAfter === valBefore
        && !!dbDrag && eq2(dbDrag.times, [0, 1, 1.2]) && dbDrag.values[1] === valBefore,
      `rombo 0.6→[${stDrag.kfs.map(k => k.t)}] valor=${valAfter} (antes ${valBefore}) DB t=[${dbDrag?.times}] v1=${dbDrag?.values[1]}`,
    );

    // G4.3 — exact time: select (click) → actions bar → t= 0.9 + Enter.
    const clicked = await page.evaluate(() => {
      const kf = document.querySelector('[data-qa="g1-kf"][data-t="1"]');
      if (!kf) return false;
      kf.click();
      return true;
    });
    await sleep(250);
    const actionsOpen = await page.evaluate(() => !!document.querySelector('[data-qa="g4-actions"] input[data-qa="g4-t"]'));
    const typed = actionsOpen ? await setControlEnter(page, 'input[data-qa="g4-t"]', "0.9") : false;
    await sleep(350);
    const stT = await laneState(page, "card");
    const dbT = await waitAnim(fx, "card", a => a.times.length === 3 && a.times.some(t => near(t, 0.9)));
    report.ok(
      "G4.3 tiempo exacto: click selecciona y abre la barra; t= 0.9 + Enter mueve el rombo exacto",
      clicked && actionsOpen && typed && stT.kfs.length === 3 && stT.kfs.some(k => k.t === "0.9")
        && !!dbT && eq2(dbT.times, [0, 0.9, 1.2]),
      `seleccionado=${clicked} barra=${actionsOpen} rombos=[${stT.kfs.map(k => k.t)}] DB=[${dbT?.times}]`,
    );

    // G4.4 — copy (card) / paste (pill) at the playhead, same property.
    const copiedVal = stT.kfs.find(k => k.t === "0.9")?.v ?? null;
    // Two ticks: the bar mounts only after React renders the selection —
    // clicking copy in the same evaluate would query a stale DOM.
    await page.evaluate(() => { document.querySelector('[data-qa="g1-kf"][data-t="0.9"]')?.click(); });
    await sleep(250);
    const copyClicked = await page.evaluate(() => {
      const btn = document.querySelector('[data-qa="g4-copy"]');
      if (!btn) return false;
      btn.click();
      return true;
    });
    await sleep(250);
    const copiedNote = await page.evaluate(() => (document.querySelector('[data-qa="g4-actions"]')?.textContent || "").includes("copiado: Opacidad"));
    await expandLayer(page, "pill");
    await sleep(250);
    const pillSel = await page.evaluate(() => {
      const row = document.querySelector('[data-qa="g1-layer-row"][data-layer-id="pill"]');
      const kf = [...(row?.parentElement?.querySelectorAll('[data-qa="g1-kf"]') || [])].find(k => k.getAttribute("data-t") === "1.2");
      if (!kf) return false;
      kf.click();
      return true;
    });
    await sleep(250);
    st = await tlState(page);
    if (st) await page.mouse.click(st.rect.left + 0.3 * st.pps, st.rect.top + 8); // cabezal a 0.3
    await sleep(250);
    const pasted = await page.evaluate(() => {
      const btn = document.querySelector('[data-qa="g4-paste"]');
      if (!btn || btn.disabled) return false;
      btn.click();
      return true;
    });
    await sleep(350);
    const stPill = await laneState(page, "pill");
    const dbPill = await waitAnim(fx, "pill", a => a.times.length === 3 && a.times.some(t => near(t, 0.3)));
    const pastedVal = stPill.kfs.find(k => k.t === "0.3")?.v ?? null;
    report.ok(
      "G4.4 copiar/pegar entre capas: Copiar (card) → seleccionar pill → cabezal 0.3 → Pegar crea el keyframe con el valor copiado",
      copyClicked && copiedNote && pillSel && pasted && stPill.kfs.length === 3 && stPill.kfs.some(k => k.t === "0.3")
        && copiedVal !== null && pastedVal === copiedVal
        && !!dbPill && eq2(dbPill.times, [0, 0.3, 1.2]) && dbPill.values[1] === copiedVal,
      `copiar=${copyClicked}(nota)=${copiedNote} pill=[${stPill.kfs.map(k => k.t)}] valor=${pastedVal} (copiado ${copiedVal}) DB=[${dbPill?.times}]`,
    );

    // G4.5 — duplicate lands next-door; delete removes it.
    await page.evaluate(() => {
      const kf = document.querySelector('[data-qa="g1-layer-row"][data-layer-id="card"]')?.parentElement?.querySelector('[data-qa="g1-kf"][data-t="1.2"]');
      kf?.click();
    });
    await sleep(200);
    await page.evaluate(() => { document.querySelector('[data-qa="g4-dup"]')?.click(); });
    await sleep(350);
    const stDup = await laneState(page, "card");
    const dupOk = stDup.kfs.some(k => k.t === "1.05");
    if (dupOk) {
      await page.evaluate(() => { document.querySelector('[data-qa="g1-kf"][data-t="1.05"]')?.click(); });
      await sleep(200);
      await page.evaluate(() => { document.querySelector('[data-qa="g4-del"]')?.click(); });
      await sleep(350);
    }
    const stDel = await laneState(page, "card");
    const dbFinal = await waitAnim(fx, "card", a => a.times.length === 3 && a.times.some(t => near(t, 0.9)));
    report.ok(
      "G4.5 Duplicar cae justo al lado (1.2 → 1.05) y Borrar lo elimina; el carril vuelve a [0, 0.9, 1.2]",
      dupOk && stDel.kfs.length === 3 && stDel.kfs.some(k => k.t === "0.9") && !stDel.kfs.some(k => k.t === "1.05")
        && !!dbFinal && eq2(dbFinal.times, [0, 0.9, 1.2]),
      `duplicado=[${stDup.kfs.map(k => k.t)}] tras borrar=[${stDel.kfs.map(k => k.t)}] DB=[${dbFinal?.times}]`,
    );

    return report;
  } finally {
    // The injected session belongs to a user that cleanup() deletes — leaving
    // it would 401 every API call of later suites (GoTrue: user_not_found).
    if (harness.page) await clearInjectedSession(harness.page);
    await fx.cleanup();
  }
}
