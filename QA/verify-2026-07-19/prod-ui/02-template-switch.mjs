/**
 * 02-template-switch.mjs — ÍTEM 2: TEMPLATE-SWITCH en PRODUCCIÓN
 *
 * Flujo: abrir t1, editar, cambiar INMEDIATAMENTE a t2 por la UI real
 * (Back to Dashboard → click en la card de t2) antes del debounce de 2s.
 *
 * Se observa con timestamps de red:
 *  - ¿El PUT pendiente de t1 se dispara? (análisis estático: NO — el desmontaje
 *    de EditorV2 limpia saveTimerRef, EditorV2.tsx:484-486)
 *  - ¿Parpadea el badge "Saving..." en t2? (polling del DOM cada 200ms)
 *  - ¿selectedFrameId queda stale? (listFrames de t2 debe mostrar SUS frames)
 *  - Ground truth: t1 reabierto en PERFIL LIMPIO (¿el servidor recibió la edición?)
 *    y localStorage del perfil original (¿la edición sobrevive localmente?)
 */
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import {
  log, ts, createTemplate, getTemplate, purgeTemplate,
  launchProfile, attachNetLog, openEditor, shot, lsInfo, layerRect,
  PROFILES,
} from "./lib.mjs";

const F1 = "frame_a2_t1", F2 = "frame_a2_t2";
const L1 = "boxT1", L2 = "boxT2";
const N1 = "verify-a2-t1", N2 = "verify-a2-t2";

const frames1 = [{ id: F1, name: "T1", x: 0, y: 0, width: 1080, height: 1080, background: "#0E0D0B",
  html: `<div data-layer-id="${L1}" data-layer-name="BoxT1" style="position:absolute;left:100px;top:100px;width:200px;height:200px;background:#C8B898;border-radius:12px;"></div>`, css: "" }];
const frames2 = [{ id: F2, name: "T2", x: 0, y: 0, width: 1080, height: 1080, background: "#1a2a1a",
  html: `<div data-layer-id="${L2}" data-layer-name="BoxT2" style="position:absolute;left:300px;top:300px;width:260px;height:160px;background:#EF4444;border-radius:12px;"></div>`, css: "" }];

const results = { item: "2-TEMPLATE-SWITCH", timeline: [] };
const mark = (label, data = {}) => { const e = { t: ts(), ms: Date.now(), label, ...data }; results.timeline.push(e); log(label, JSON.stringify(data)); };
let t1 = null, t2 = null;

try {
  t1 = await createTemplate(N1, frames1);
  t2 = await createTemplate(N2, frames2);
  results.ids = { t1, t2 };

  const browser = await launchProfile(path.join(PROFILES, "c-switch"));
  const page = await browser.newPage();
  const net = attachNetLog(page, "SW", { captureBody: true });

  await openEditor(page, t1, F1);
  await shot(page, "02-01-t1-cargado");
  mark("t1 editor listo", { t1 });

  // Edición en t1
  const t0 = Date.now();
  await page.evaluate((f, l) => window.__qa.dragLayer(f, l, 120, 0), F1, L1);
  const r1 = await layerRect(page, F1, L1);
  mark("edición en t1 (drag +120)", { rectX: r1?.x });

  // Cambio INMEDIATO: Back to Dashboard (~300ms tras la edición)
  await sleep(300);
  await page.click('button[title="Back to Dashboard"]');
  const tBack = Date.now();
  mark("click Back to Dashboard", { msTrasEdicion: tBack - t0 });

  // Esperar la card de t2 en el dashboard y hacer click
  await page.waitForFunction(
    (name) => [...document.querySelectorAll("div")].some(e => e.childElementCount <= 6 && e.textContent.includes(name)),
    { timeout: 30000 }, N2,
  );
  mark("dashboard visible con card de t2");
  await shot(page, "02-02-dashboard-con-cards");
  await page.evaluate((name) => {
    const cands = [...document.querySelectorAll("div")]
      .filter(e => e.textContent.includes(name))
      .sort((a, b) => a.textContent.length - b.textContent.length);
    cands[0].click();
  }, N2);
  const tClick2 = Date.now();
  mark("click card t2", { msTrasEdicion: tClick2 - t0 });

  // Editor t2
  await openEditor(page, t2, F2);
  const tReady2 = Date.now();
  mark("t2 editor listo", { msTrasEdicion: tReady2 - t0 });
  await shot(page, "02-03-t2-recien-abierto");

  // Polling del badge "Saving..." durante 4.5s (ventana del debounce de t1 + margen)
  const badgeSightings = [];
  const pollUntil = Date.now() + 4500;
  while (Date.now() < pollUntil) {
    const visible = await page.evaluate(() => Boolean(document.querySelector(".editor-v2-saving")));
    if (visible) badgeSightings.push(ts());
    await sleep(200);
  }
  mark("fin ventana de observación", { badgeSightings: badgeSightings.length });
  await shot(page, "02-04-t2-tras-ventana");

  // ¿Frames de t2 (no stale de t1)?
  const framesInT2 = await page.evaluate(() => window.futurariaAgent.listFrames().map(f => f.id || f.frameId));
  mark("frames visibles en t2", { framesInT2 });

  // PUTs observados desde la edición
  const puts = net.filter(e => e.phase === "req" && e.method === "PUT" && e.ms >= t0);
  const putsT1 = puts.filter(e => e.url.includes(t1));
  const putsT2 = puts.filter(e => e.url.includes(t2));
  results.network = {
    putsTrasEdicion: puts.map(e => ({ t: e.t, url: e.url, bytes: e.bytes, msTrasEdicion: e.ms - t0, bodySnippet: e.bodySnippet })),
    putT1: putsT1.length, putT2: putsT2.length,
  };
  mark("PUTs tras la edición", { aT1: putsT1.length, aT2: putsT2.length });

  // localStorage del perfil actual: ¿la edición de t1 sobrevive localmente?
  const ls = await lsInfo(page);
  results.localStorage = ls;
  mark("localStorage", { chars: ls.localTemplatesChars, templates: ls.templateIds });

  await browser.close();

  // Ground truth del servidor: t1 en PERFIL LIMPIO
  const browserClean = await launchProfile(path.join(PROFILES, "c-clean"));
  const pageC = await browserClean.newPage();
  attachNetLog(pageC, "CLEAN");
  await openEditor(pageC, t1, F1);
  await sleep(400);
  const rClean = await layerRect(pageC, F1, L1);
  mark("t1 en perfil limpio: rect", { rectX: rClean?.x, esperadoSiPerdido: 100, esperadoSiGuardado: 220 });
  await shot(pageC, "02-05-t1-en-perfil-limpio");
  results.cleanProfileT1 = { rectX: rClean?.x };
  await browserClean.close();

  const g1 = await getTemplate(t1);
  const html1 = g1.json?.data?.frames?.[0]?.html || "";
  const i1 = html1.indexOf(L1);
  results.serverT1HtmlSnippet = i1 >= 0 ? html1.slice(i1, i1 + 200) : "(no encontrada)";

  results.observations = {
    pendingPutOfT1Fired: putsT1.length > 0,
    putToT2WithT1Content: putsT2.some(e => (e.bodySnippet || "").includes(L1)),
    savingBadgeSightingsInT2: badgeSightings,
    framesInT2,
    t1EditSurvivesLocalStorage: ls.templateIds.includes(t1),
    t1EditInServerCleanProfile: rClean?.x,
  };
} catch (err) {
  results.fatal = err.message;
  log("FATAL", err.message);
} finally {
  if (t1) log("cleanup t1", JSON.stringify(await purgeTemplate(t1)));
  if (t2) log("cleanup t2", JSON.stringify(await purgeTemplate(t2)));
  results.cleanedUp = Boolean(t1 && t2);
}

const o = results.observations || {};
const lsIds = results.localStorage?.templateIds || [];
results.verdict = {
  pendingPutCancelledOnSwitch: (results.network?.putT1 ?? 1) === 0,
  noCrossContaminationToT2: o.putToT2WithT1Content !== true,
  noSavingFlickerInT2: (o.savingBadgeSightingsInT2 || []).length === 0,
  t2ShowsOwnFrames: (o.framesInT2 || []).includes(F2) && !(o.framesInT2 || []).includes(F1),
  t1EditLostOnServer: (results.cleanProfileT1?.rectX ?? 999) <= 103,
  t1EditKeptLocally: lsIds.length > 0 && lsIds.includes(results.ids?.t1),
};
console.log("\n===== RESULT ITEM-2 =====");
console.log(JSON.stringify(results, null, 2));
