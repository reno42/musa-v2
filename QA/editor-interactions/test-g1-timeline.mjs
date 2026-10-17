/**
 * G1 — "timeline multipista" (gap-analysis G1, W2.1).
 *
 * Pre-fix reality: el panel de animación en modo frame solo tenía un slider
 * de scrub — sin regla, sin pistas por capa, sin carriles por propiedad,
 * sin zoom, sin snap, sin navegación de keyframes ni área de trabajo.
 *
 * Fix under test:
 *   G1.0  estructura: regla en segundos con ticks etiquetados, cabezal,
 *         fila por capa animada (card/pill/dot), handles del área de
 *         trabajo, botones prev/next keyframe en el transporte.
 *   G1.1  regla/cabezal: click y arrastre mueven el cabezal al tiempo
 *         exacto (snap OFF) — el motor sigue la misma posición.
 *   G1.2  snap ON: arrastrar cerca de un keyframe (1.2s) aterriza EXACTO
 *         en el keyframe (imán real, no decorativo).
 *   G1.3  carriles: desplegar una capa muestra un carril por propiedad con
 *         rombos en sus tiempos; click en un rombo lleva el cabezal ahí.
 *   G1.4  zoom: + / − cambian los px/s y el ancho de la regla acorde.
 *   G1.5  prev/next keyframe: saltan entre los tiempos con keyframes y se
 *         quedan quietos en el último (no hay nada después).
 *   G1.6  área de trabajo: arrastrar el fin del área a 0.6s y dar Play →
 *         la reproducción arranca en el inicio del área y PAUSA al salir.
 *
 * Fixture: lib/seed.mjs — frame card/pill/dot; se aplican Fade-in ×3 como
 * en G2 (clips 0→1.2s, timeline 5s → keyframes conocidos en 0 y 1.2).
 */
import { setTimeout as sleep } from "node:timers/promises";
import { makeReport } from "./lib/assert.mjs";
import { seedEditorFixture, injectSession, clearInjectedSession } from "./lib/seed.mjs";

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

/** Ruler geometry + the head's time decoded from its own style. */
async function tlState(page) {
  return page.evaluate(() => {
    const ruler = document.querySelector('[data-qa="g1-ruler"]');
    const head = document.querySelector('[data-qa="g1-playhead"]');
    if (!ruler || !head) return null;
    const r = ruler.getBoundingClientRect();
    const span = [...document.querySelectorAll("span")].find(s => /\d\.\d\d \/ \d/.test(s.textContent || ""));
    const transportT = span ? parseFloat(span.textContent) : null;
    return {
      rectW: r.width, offsetW: ruler.offsetWidth, rect: { left: r.left, top: r.top },
      pps: ruler.offsetWidth / 5, transportT,
      styleLeft: parseFloat(head.style.left || "0") || 0,
    };
  });
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

/** Pause the transport and wait until the displayed time stops moving.
 *  Applying a preset auto-plays a confirmation (playFrame(0) in the panel),
 *  and every check below compares exact seek positions — a drifting head
 *  would read as a constant +sleep() offset, not as a mapping bug. */
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

const near = (a, b, eps = 0.15) => Math.abs(a - b) <= eps;

export async function run(harness) {
  const report = makeReport("G1 · timeline multipista — regla, cabezal, pistas, carriles, zoom, snap, prev/next y área de trabajo");
  const fx = await seedEditorFixture({ name: "QA — G1 timeline" });
  try {
    const page = harness.page;
    await injectSession(page, fx.session);
    await harness.open(fx.templateId, fx.frameId);

    const framePicked = await selectFrame(page, fx.frameId);
    const tabOk = framePicked ? await openAnimationTab(page) : false;
    for (const layer of ["card", "pill", "dot"]) {
      if (tabOk) { await applyFadeIn(page, layer); await sleep(350); }
    }

    // G1.0 — structure.
    const struct = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-qa="g1-layer-row"]')];
      const playBtn = [...document.querySelectorAll("button")].find(b => b.textContent.includes("Play") || b.textContent.includes("Pausa"));
      return {
        timeline: !!document.querySelector('[data-qa="g1-timeline"]'),
        ruler: !!document.querySelector('[data-qa="g1-ruler"]'),
        head: !!document.querySelector('[data-qa="g1-playhead"]'),
        workIn: !!document.querySelector('[data-qa="g1-work-in"]'),
        workOut: !!document.querySelector('[data-qa="g1-work-out"]'),
        layers: rows.map(r => r.getAttribute("data-layer-id")),
        zeroLabel: (document.querySelector('[data-qa="g1-ruler"]')?.textContent || "").includes("0s"),
        prevKf: !!document.querySelector('[data-qa="g1-prev-kf"]'),
        nextKf: !!document.querySelector('[data-qa="g1-next-kf"]'),
        zoomIn: !!document.querySelector('[data-qa="g1-zoom-in"]'),
        playBtn: !!playBtn,
      };
    });
    report.ok(
      "G1.0 regla con ticks + cabezal + 3 filas de capa + handles de área + prev/next en el transporte",
      struct.timeline && struct.ruler && struct.head && struct.workIn && struct.workOut
        && struct.layers.length === 3 && ["card", "pill", "dot"].every(l => struct.layers.includes(l))
        && struct.zeroLabel && struct.prevKf && struct.nextKf && struct.zoomIn && struct.playBtn,
      `timeline=${struct.timeline} regla=${struct.ruler}(0s=${struct.zeroLabel}) cabezal=${struct.head} capas=[${struct.layers}] área=${struct.workIn && struct.workOut} prev/next=${struct.prevKf && struct.nextKf}`,
    );

    // G1.1 — click + drag seek exactly (snap OFF, transport PAUSED so the
    // read is the seek result, not playback drift).
    const paused0 = await pauseAndWait(page);
    await page.evaluate(() => { document.querySelector('[data-qa="g1-snap"]')?.click(); }); // off
    await sleep(120);
    let st = await tlState(page);
    if (st) await page.mouse.click(st.rect.left + 2.5 * st.pps, st.rect.top + 8);
    await sleep(250);
    const tClick = (await tlState(page))?.transportT ?? null;
    st = await tlState(page);
    const dragged = st ? await dragToX(page, '[data-qa="g1-playhead"]', st.rect.left + 1.25 * st.pps) : false;
    await sleep(250);
    const tDrag = (await tlState(page))?.transportT ?? null;
    report.ok(
      "G1.1 click en la regla y arrastre del cabezal buscan el tiempo exacto (snap off)",
      paused0 && tClick !== null && near(tClick, 2.5, 0.05) && dragged && tDrag !== null && near(tDrag, 1.25, 0.05),
      `pausado=${paused0} click@2.5s → ${tClick?.toFixed(2)}s · drag@1.25s → ${tDrag?.toFixed(2)}s`,
    );

    // G1.2 — snap ON: land EXACTLY on the 1.2s keyframe.
    await page.evaluate(() => { document.querySelector('[data-qa="g1-snap"]')?.click(); }); // on
    await sleep(120);
    st = await tlState(page);
    const snapped = st ? await dragToX(page, '[data-qa="g1-playhead"]', st.rect.left + 1.35 * st.pps) : false;
    await sleep(250);
    st = await tlState(page);
    const tSnap = st ? st.transportT : null;
    report.ok(
      "G1.2 snap activo: soltar cerca del keyframe (1.2s) aterriza exacto en él",
      snapped && tSnap !== null && near(tSnap, 1.2, 0.005),
      `drag a 1.35s → cabezal en ${tSnap?.toFixed(3)}s (esp 1.200)`,
    );

    // G1.3 — expand a layer: property lanes with diamonds; a diamond seeks.
    const lanes = await page.evaluate(() => {
      const row = document.querySelector('[data-qa="g1-layer-row"][data-layer-id="card"]');
      if (!row) return null;
      row.querySelector('[data-qa="g1-layer-toggle"]')?.click();
      return true;
    });
    await sleep(250);
    const laneState = await page.evaluate(() => {
      const row = document.querySelector('[data-qa="g1-layer-row"][data-layer-id="card"]');
      const rowRoot = row?.parentElement; // the flex row holds label + track cells
      const lane = rowRoot?.querySelector('[data-qa="g1-lane"]');
      const kfs = [...(rowRoot?.querySelectorAll('[data-qa="g1-kf"]') || [])].map(k => k.getAttribute("data-t"));
      return { laneProp: lane?.getAttribute("data-prop") ?? null, kfs };
    });
    const kfClicked = await page.evaluate(() => {
      const row = document.querySelector('[data-qa="g1-layer-row"][data-layer-id="card"]');
      const kf = [...(row?.parentElement?.querySelectorAll('[data-qa="g1-kf"]') || [])].find(k => k.getAttribute("data-t") === "1.2");
      if (!kf) return false;
      kf.click();
      return true;
    });
    await sleep(250);
    st = await tlState(page);
    const tKf = st ? st.transportT : null;
    report.ok(
      "G1.3 carril por propiedad al desplegar la capa: rombos en 0 y 1.2; click en el rombo busca su tiempo",
      lanes && laneState.laneProp === "opacity" && laneState.kfs.length === 2 && laneState.kfs.includes("0") && laneState.kfs.includes("1.2")
        && kfClicked && tKf !== null && near(tKf, 1.2, 0.005),
      `carril=${laneState?.laneProp} rombos=[${laneState?.kfs}] click→${tKf?.toFixed(3)}s`,
    );

    // G1.4 — zoom: ruler width follows pps.
    const w0 = (await tlState(page))?.rectW ?? 0;
    await page.evaluate(() => { document.querySelector('[data-qa="g1-zoom-in"]')?.click(); });
    await page.evaluate(() => { document.querySelector('[data-qa="g1-zoom-in"]')?.click(); });
    await sleep(200);
    const wIn = (await tlState(page))?.rectW ?? 0;
    await page.evaluate(() => { document.querySelector('[data-qa="g1-zoom-out"]')?.click(); });
    await page.evaluate(() => { document.querySelector('[data-qa="g1-zoom-out"]')?.click(); });
    await page.evaluate(() => { document.querySelector('[data-qa="g1-zoom-out"]')?.click(); });
    await sleep(200);
    const wOut = (await tlState(page))?.rectW ?? 0;
    report.ok(
      "G1.4 zoom: + agranda la regla y − la reduce (px/s reales, no cosmética)",
      w0 > 0 && wIn > w0 * 1.8 && wOut < w0 * 0.9,
      `ancho ${w0.toFixed(0)}px → ×2 zoom-in ${wIn.toFixed(0)}px → ×3 zoom-out ${wOut.toFixed(0)}px`,
    );

    // G1.5 — prev/next keyframe navigation (kfs live at 0 and 1.2).
    await page.evaluate(() => { document.querySelector('[data-qa="g1-prev-kf"]')?.click(); });
    await sleep(250);
    const tPrev = (await tlState(page))?.transportT ?? null;
    await page.evaluate(() => { document.querySelector('[data-qa="g1-next-kf"]')?.click(); });
    await sleep(250);
    const tNext = (await tlState(page))?.transportT ?? null;
    await page.evaluate(() => { document.querySelector('[data-qa="g1-next-kf"]')?.click(); });
    await sleep(250);
    const tNextEnd = (await tlState(page))?.transportT ?? null;
    report.ok(
      "G1.5 prev/next keyframe: 1.2 → 0 → 1.2, y en el último se queda (no salta al vacío)",
      tPrev !== null && near(tPrev, 0, 0.005) && tNext !== null && near(tNext, 1.2, 0.005)
        && tNextEnd !== null && near(tNextEnd, 1.2, 0.005),
      `prev→${tPrev?.toFixed(2)} next→${tNext?.toFixed(2)} next-final→${tNextEnd?.toFixed(2)}`,
    );

    // G1.6 — work area: drag the out handle to 0.6s, Play pauses there.
    st = await tlState(page);
    const outDragged = st ? await dragToX(page, '[data-qa="g1-work-out"]', st.rect.left + 0.6 * st.pps) : false;
    await sleep(250);
    const areaNote = await page.evaluate(() => (document.body.textContent || "").includes("Área de trabajo"));
    await page.evaluate(() => {
      const row = document.querySelector('[data-qa="g1-prev-kf"]')?.parentElement;
      const btn = row ? [...row.querySelectorAll("button")].find(b => b.textContent.includes("Play")) : null;
      btn?.click();
    });
    await sleep(1500);
    const afterPlay = await page.evaluate(() => {
      const head = document.querySelector('[data-qa="g1-playhead"]');
      const ruler = document.querySelector('[data-qa="g1-ruler"]');
      const row = document.querySelector('[data-qa="g1-prev-kf"]')?.parentElement;
      const btn = row ? [...row.querySelectorAll("button")].find(b => b.textContent.includes("Play")) : null;
      const left = parseFloat(head?.style.left || "0") || 0;
      const pps = ruler ? ruler.getBoundingClientRect().width / 5 : 1;
      return { t: (left + 5) / pps, paused: !!btn && btn.textContent.includes("▶") };
    });
    report.ok(
      "G1.6 área de trabajo: out arrastrado a ~0.6s → Play pausa al salir del área (y solo entonces)",
      outDragged && areaNote && afterPlay.t >= 0.5 && afterPlay.t <= 0.75 && afterPlay.paused,
      `nota=${areaNote} cabezal tras Play=${afterPlay.t.toFixed(2)}s (esp ~0.60) pausado=${afterPlay.paused}`,
    );

    return report;
  } finally {
    // The injected session belongs to a user that cleanup() deletes — leaving
    // it would 401 every API call of later suites (GoTrue: user_not_found).
    if (harness.page) await clearInjectedSession(harness.page);
    await fx.cleanup();
  }
}
