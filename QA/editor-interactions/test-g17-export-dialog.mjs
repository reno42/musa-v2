/**
 * G17 — "Exportar MP4 H.264" con diálogo de export real (gap-analysis G17).
 *
 * Pre-fix reality:
 *   • MP4 era SOLO MediaRecorder en tiempo real (atajo cortado — nunca llegó a
 *     WebCodecs) y el formato era un toggle de 2 botones en el inspector: sin
 *     resolución, sin FPS, sin rango, sin estimado y sin GIF.
 *
 * Fix under test:
 *   G17.1  el inspector abre el diálogo (formato/resolución/FPS/rango) y la
 *          ruta de códec se VERIFICA para esa combinación exacta (✓ honesto).
 *   G17.2  el estimado sigue los ajustes: FPS 30→24 baja los frames en la
 *          proporción exacta; 0.5× anuncia la mitad de resolución.
 *   G17.3  GIF con rango 0→1s: render real con bytes "GIF89a", 20 frames
 *          (cap honesto de 20 fps), bloque resultado + descarga recuperable.
 *   G17.4  MP4 con rango 0→1s: contenedor real — caja ftyp, moov (faststart)
 *          y entrada avc1 (H.264) en los BYTES (window.__lastExport, no toasts).
 *
 * Fixture: lib/seed.mjs — una toma 1080×1080 sin animación (5s · 30fps).
 */
import { setTimeout as sleep } from "node:timers/promises";
import { makeReport } from "./lib/assert.mjs";
import { seedEditorFixture, injectSession, clearInjectedSession } from "./lib/seed.mjs";
import { VITE_URL } from "./lib/servers.mjs";

/** Click a [data-qa] element inside the export dialog. */
async function qaClick(page, qa) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.click();
    return true;
  }, `[data-qa="${qa}"]`);
}

/** Set a controlled <input type="number"> the React way (native setter + input). */
async function setNumberInput(page, qa, value) {
  return page.evaluate((sel, val) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, String(val));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }, `[data-qa="${qa}"]`, value);
}

/** Wait until the honest route line resolves to ✓ for the CURRENT combo. */
async function waitRouteOk(page, ms = 10000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const txt = await page.evaluate(() => (document.querySelector('[data-qa="route"]')?.textContent || "").trim());
    if (txt.startsWith("✓")) return txt;
    await sleep(250);
  }
  return null;
}

/** Wait for the render button to be enabled (probe resolved ok), then click it. */
async function renderWhenEnabled(page, ms = 15000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const enabled = await page.evaluate(() => {
      const b = document.querySelector('[data-qa="render"]');
      return !!b && !b.disabled;
    });
    if (enabled) return qaClick(page, "render");
    await sleep(250);
  }
  return false;
}

/** Poll window.__lastExport (the QA hook resets it to null on each render). */
async function waitForExport(page, mimeType, ms = 90000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const lx = await page.evaluate((m) => {
      const x = window.__lastExport;
      return x && x.mimeType === m
        ? { filename: x.filename, method: x.method, durationSec: x.durationSec, frameCount: x.frameCount }
        : null;
    }, mimeType);
    if (lx) return lx;
    await sleep(400);
  }
  return null;
}

/** First n bytes of the last export blob as a latin1 string (magic/box checks). */
async function exportBytes(page, n) {
  return page.evaluate(async (count) => {
    const x = window.__lastExport;
    if (!x || !x.blob) return null;
    const buf = await x.blob.slice(0, count).arrayBuffer();
    return Array.from(new Uint8Array(buf), b => String.fromCharCode(b)).join("");
  }, n);
}

export async function run(harness) {
  const report = makeReport("G17 · diálogo de export — MP4 H.264 real + GIF + rango");
  const fx = await seedEditorFixture({ name: "QA — G17 export dialog" });
  try {
    const page = harness.page;
    await injectSession(page, fx.session);
    // Deterministic panel layout: a persisted preference from an earlier suite
    // must not hide the inspector (where the dialog opens from).
    await page.goto(`${VITE_URL}/`, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    await page.evaluate(() => localStorage.removeItem("musa.videoPanels"));
    await page.goto(`${VITE_URL}/?template=${fx.templateId}&v=2&view=video`, { waitUntil: "domcontentloaded", timeout: 45000 });

    // Video mode up (same wait as G12.1).
    let opened = false;
    for (let i = 0; i < 50 && !opened; i++) {
      opened = await page.evaluate(() =>
        !!document.querySelector("[data-video-stage]") && (document.body.textContent || "").includes("MODO VIDEO"));
      if (!opened) await sleep(400);
    }
    if (!opened) {
      report.ok("G17.0 ?view=video abre el modo", false, "overlay nunca apareció");
      return report;
    }
    await sleep(600); // first paint — probe effect needs a tick

    // G17.1 — the inspector opens the dialog; honest route + 3 formats.
    const openedDialog = await qaClick(page, "open-export-dialog");
    let dialogUp = false;
    for (let i = 0; i < 10 && !dialogUp; i++) {
      dialogUp = await page.evaluate(() => !!document.querySelector('[data-qa="export-dialog"]'));
      if (!dialogUp) await sleep(200);
    }
    const have = await page.evaluate(() => ({
      mp4: !!document.querySelector('[data-qa="fmt-mp4"]'),
      webm: !!document.querySelector('[data-qa="fmt-webm"]'),
      gif: !!document.querySelector('[data-qa="fmt-gif"]'),
      half: !!document.querySelector('[data-qa="scale-0.5"]'),
      one: !!document.querySelector('[data-qa="scale-1"]'),
      two: !!document.querySelector('[data-qa="scale-2"]'),
      rangeAll: !!document.querySelector('[data-qa="range-all"]'),
    }));
    const route1 = dialogUp ? await waitRouteOk(page) : null;
    report.ok(
      "G17.1 inspector → diálogo con formato/resolución/fps/rango + ruta verificada",
      openedDialog && dialogUp && have.mp4 && have.webm && have.gif && have.half && have.one && have.two && have.rangeAll && !!route1,
      `botón=${openedDialog} diálogo=${dialogUp} chips=${have.mp4 && have.webm && have.gif ? "3/3" : "?"} ruta=${route1 ? route1.slice(0, 60) : "sin ✓"}`,
    );
    if (!dialogUp || !route1) return report;

    // G17.2 — the estimate tracks the settings (5s take: 150 @30fps → 120 @24fps).
    const estAt = async () => page.evaluate(() => {
      const t = (document.querySelector('[data-qa="estimate"]')?.textContent || "").trim();
      const m = t.match(/(\d+) frames · ([\d.]+)s/);
      const render = (document.querySelector('[data-qa="render"]')?.textContent || "").trim();
      const dims = render.match(/(\d+)×(\d+)/);
      return { frames: m ? Number(m[1]) : null, sec: m ? Number(m[2]) : null, dims: dims ? `${dims[1]}×${dims[2]}` : null, raw: t };
    });
    const est0 = await estAt(); // mp4 · 1× · fps 30 · todo el reel → 150 frames
    await qaClick(page, "fps-24");
    await sleep(150);
    const est1 = await estAt();
    await qaClick(page, "scale-0.5");
    await sleep(150);
    const est2 = await estAt();
    await qaClick(page, "scale-1"); // back to 1× for the renders
    report.ok(
      "G17.2 estimado honesto: FPS 30→24 (150→120 frames) y 0.5× (1080×1080→540×540)",
      est0.frames === 150 && est1.frames === 120 && est2.dims === "540×540",
      `est0=${est0.frames}f · est1=${est1.frames}f · dims@0.5×=${est2.dims} (raw: ${est2.raw.slice(0, 60)})`,
    );

    // G17.3 — GIF with a 0→1s range: real GIF89a bytes via __lastExport.
    await qaClick(page, "fmt-gif");
    await waitRouteOk(page);
    await qaClick(page, "range-all"); // uncheck → range inputs appear (0 → 3s default)
    await setNumberInput(page, "range-end", 1);
    await sleep(200);
    const estGif = await estAt(); // 1s @ capped 20fps → 20 frames
    const gifCapNote = await page.evaluate(() => (document.body.textContent || "").includes("GIF limitado a 20 fps"));
    const rendered = estGif.frames === 20 ? await renderWhenEnabled(page) : false;
    const gif = rendered ? await waitForExport(page, "image/gif") : null;
    let gifMagic = null;
    if (gif) {
      const head = await exportBytes(page, 6);
      gifMagic = head === "GIF89a" ? "GIF89a" : head;
    }
    const resultBlock = gif ? await page.evaluate(() => {
      const r = document.querySelector('[data-qa="result"]');
      return !!r && (r.textContent || "").includes("Descargar de nuevo") && (r.textContent || "").endsWith(".gif") === false
        ? { visible: true, name: (r.textContent || "").match(/reel_[^\s]+\.gif/)?.[1] ?? null }
        : { visible: false, name: null };
    }) : { visible: false, name: null };
    report.ok(
      "G17.3 GIF rango 0→1s: 20 frames (cap 20fps) + bytes GIF89a + resultado",
      estGif.frames === 20 && gifCapNote && !!gif && gifMagic === "GIF89a" && gif.filename.endsWith(".gif") && resultBlock.visible,
      `est=${estGif.frames}f cap20=${gifCapNote} export=${!!gif} magic=${JSON.stringify(gifMagic)} dur=${gif ? gif.durationSec.toFixed(2) : "-"} resultado=${resultBlock.visible}`,
    );

    // G17.4 — MP4 with the same range: ftyp + moov(faststart) + avc1 in bytes.
    await qaClick(page, "fmt-mp4");
    const route4 = await waitRouteOk(page);
    const rendered4 = route4 ? await renderWhenEnabled(page) : false;
    const mp4 = rendered4 ? await waitForExport(page, "video/mp4") : null;
    let boxes = null;
    if (mp4) {
      const head = await exportBytes(page, 16384);
      boxes = {
        ftyp: head.slice(4, 8) === "ftyp",
        moov: head.includes("moov"),
        avc1: head.includes("avc1"),
      };
    }
    // Close the dialog — the inspector keeps the persistent "Listo" block.
    await sleep(400);
    await page.evaluate(() => {
      const dlg = document.querySelector('[data-qa="export-dialog"]');
      const close = dlg?.querySelector('button[aria-label="Cerrar"]');
      if (close && !close.disabled) close.click();
    });
    await sleep(300);
    const inspectorReady = await page.evaluate(() => (document.body.textContent || "").includes("Listo — reel_"));
    report.ok(
      "G17.4 MP4 rango 0→1s: contenedor real (ftyp+moov+avc1) + 'Listo' persiste en el inspector",
      !!mp4 && mp4.filename.endsWith(".mp4") && !!boxes && boxes.ftyp && boxes.moov && boxes.avc1 && inspectorReady,
      `ruta=${route4 ? route4.slice(0, 55) : "sin ✓"} export=${!!mp4} frames=${mp4 ? mp4.frameCount : "-"} cajas=${JSON.stringify(boxes)} inspector=${inspectorReady}`,
    );

    return report;
  } finally {
    // The injected session belongs to a user that cleanup() deletes — leaving
    // it would 401 every API call of later suites (GoTrue: user_not_found).
    if (harness.page) await clearInjectedSession(harness.page);
    await fx.cleanup();
  }
}
