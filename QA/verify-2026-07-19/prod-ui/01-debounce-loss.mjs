/**
 * 01-debounce-loss.mjs — ÍTEM 1: DEBOUNCE-LOSS en PRODUCCIÓN
 *
 * Afirmación a verificar: una edición seguida de cierre de pestaña en <2s nunca
 * llega al servidor (debounce de 2s sin flush al desmontar ni beforeunload).
 *
 * Diseño:
 *  FASE A (control): editar y esperar 3s → el PUT SÍ dispara (prueba que la vía
 *           de edición y el autosave funcionan en este entorno).
 *  FASE B (test): editar y cerrar la pestaña a ~600ms → el PUT NO debe disparar.
 *  FASE C: reabrir con el MISMO perfil → ¿sobrevive vía localStorage?
 *  FASE D: reabrir con PERFIL LIMPIO → ¿está el cambio? (ground truth = API GET)
 */
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import {
  log, ts, createTemplate, getTemplate, purgeTemplate,
  launchProfile, attachNetLog, openEditor, shot, lsInfo, layerRect,
  PAGE_HELPERS, PROFILES,
} from "./lib.mjs";

const FRAME = "frame_a2_deb";
const LAYER = "box1";
const NAME = "verify-a2-debounce";

const seedHtml = [
  `<div data-layer-id="${LAYER}" data-layer-name="Box1" style="position:absolute;left:100px;top:100px;width:200px;height:200px;background:#C8B898;border-radius:12px;"></div>`,
].join("\n");
const seedFrames = [{ id: FRAME, name: "Deb", x: 0, y: 0, width: 1080, height: 1080, background: "#0E0D0B", html: seedHtml, css: "" }];

// Ground truth del servidor = html crudo del frame (la posición puede serializarse
// como left o como transform; por eso el veredicto usa el rect del perfil limpio).
const serverHtmlSnippet = async (id) => {
  const g = await getTemplate(id);
  const html = g.json?.data?.frames?.[0]?.html || "";
  const i = html.indexOf(LAYER);
  return i >= 0 ? html.slice(i, i + 220) : "(capa no encontrada)";
};

const results = { item: "1-DEBOUNCE-LOSS", phases: {} };
let tplId = null;

try {
  tplId = await createTemplate(NAME, seedFrames);
  results.templateId = tplId;
  log("server baseline:", await serverHtmlSnippet(tplId));

  const profileA = path.join(PROFILES, "a-debounce");
  const browser = await launchProfile(profileA);
  const page = await browser.newPage();
  const net = attachNetLog(page, "A", { captureBody: true });
  const consoleErrs = [];
  page.on("console", m => { if (/\[SAVE\]|error/i.test(m.text())) consoleErrs.push({ t: ts(), text: m.text().slice(0, 200) }); });

  await openEditor(page, tplId, FRAME);
  await shot(page, "01-01-editor-cargado");
  const r0 = await layerRect(page, FRAME, LAYER);
  log("rect inicial", JSON.stringify(r0));

  // ── FASE A (control): editar y esperar 3s ──
  const tA0 = Date.now();
  await page.evaluate((f, l) => window.__qa.dragLayer(f, l, 150, 0), FRAME, LAYER);
  await sleep(200);
  const rA = await layerRect(page, FRAME, LAYER);
  log(`[control] drag hecho en ${Date.now() - tA0}ms, rect ahora x=${rA?.x}`);
  await shot(page, "01-02-control-edit-hecho");
  await sleep(3200); // > 2s debounce
  const putA = net.filter(e => e.phase === "req" && e.method === "PUT" && e.url.includes(tplId) && e.ms >= tA0);
  const putARes = net.filter(e => e.phase === "res" && e.method === "PUT" && e.url.includes(tplId) && e.ms >= tA0);
  results.phases.control = {
    editAt: new Date(tA0).toISOString(), rectAfterDrag: rA?.x,
    putFired: putA.length, putStatus: putARes.map(e => e.status),
    putDelayMs: putA.length ? putA[0].ms - tA0 : null,
  };
  log("[control] PUTs tras edición:", putA.length, "delayMs:", results.phases.control.putDelayMs, "status:", JSON.stringify(results.phases.control.putStatus));
  log("[control] server html:", await serverHtmlSnippet(tplId));
  await shot(page, "01-03-control-put-disparado");

  // ── FASE B (test): editar y cerrar pestaña a ~600ms ──
  const tB0 = Date.now();
  await page.evaluate((f, l) => window.__qa.dragLayer(f, l, 150, 0), FRAME, LAYER);
  const tBEdit = Date.now();
  const rB = await layerRect(page, FRAME, LAYER);
  log(`[test] segundo drag en ${tBEdit - tB0}ms, rect ahora x=${rB?.x}`);
  const lsAntesCierre = await lsInfo(page);
  await shot(page, "01-04-test-edit-antes-de-cerrar");
  await sleep(600); // << 2s debounce
  const tBClose = Date.now();
  await page.close();
  log(`[test] pestaña cerrada ${tBClose - tBEdit}ms tras la edición (<2000ms)`);
  await sleep(3500); // ventana donde el PUT habría disparado de seguir viva la pestaña
  const putB = net.filter(e => e.phase === "req" && e.method === "PUT" && e.url.includes(tplId) && e.ms >= tBEdit);
  results.phases.fastClose = {
    editAt: new Date(tBEdit).toISOString(), closeAt: new Date(tBClose).toISOString(),
    msEditToClose: tBClose - tBEdit, rectAfterDrag: rB?.x,
    putFiredAfterEdit: putB.length,
    lsCharsBeforeClose: lsAntesCierre.localTemplatesChars,
  };
  log(`[test] PUTs tras 2ª edición: ${putB.length} (afirmación: 0)`);
  log("[test] server html tras cierre:", await serverHtmlSnippet(tplId));
  results.phases.fastClose.serverHtmlAfterClose = await serverHtmlSnippet(tplId);

  // ── FASE C: reabrir MISMO perfil ──
  const pageC = await browser.newPage();
  attachNetLog(pageC, "A2");
  await openEditor(pageC, tplId, FRAME);
  await sleep(500);
  const rC = await layerRect(pageC, FRAME, LAYER);
  const lsReopen = await lsInfo(pageC);
  log(`[mismo perfil] rect al reabrir x=${rC?.x} (localStorage resiliente si ~400)`);
  await shot(pageC, "01-05-reapertura-mismo-perfil");
  results.phases.sameProfile = { rectOnReopen: rC?.x, lsChars: lsReopen.localTemplatesChars, lsTemplates: lsReopen.templateIds };
  await pageC.close();
  await browser.close();

  // ── FASE D: PERFIL LIMPIO ──
  const browserB = await launchProfile(path.join(PROFILES, "b-clean"));
  const pageD = await browserB.newPage();
  attachNetLog(pageD, "B");
  await openEditor(pageD, tplId, FRAME);
  await sleep(500);
  const rD = await layerRect(pageD, FRAME, LAYER);
  const lsClean = await lsInfo(pageD);
  log(`[perfil limpio] rect al abrir x=${rD?.x} (pérdida si 250, sobrevive si 400)`);
  await shot(pageD, "01-06-apertura-perfil-limpio");
  results.phases.cleanProfile = { rectOnOpen: rD?.x, lsChars: lsClean.localTemplatesChars, lsTemplates: lsClean.templateIds };
  await browserB.close();

  results.consoleErrs = consoleErrs.slice(0, 10);
  results.netPutTimeline = net.filter(e => e.method === "PUT").map(e => ({ tag: e.tag, t: e.t, phase: e.phase, status: e.status, bytes: e.bytes, bodySnippet: e.bodySnippet }));
} catch (err) {
  results.fatal = err.message;
  log("FATAL", err.message);
} finally {
  if (tplId) {
    const d = await purgeTemplate(tplId);
    log("cleanup", NAME, JSON.stringify(d));
    results.cleanedUp = d;
  }
}

// Veredicto — ground truth = rect leído del documento renderizado (agent bridge),
// con tolerancia ±3px por redondeos de zoom. Posiciones esperadas:
//   baseline x=100 · tras control (+150) ≈250 · tras 2ª edición (+150) ≈400.
const c = results.phases.control || {};
const t = results.phases.fastClose || {};
const s = results.phases.sameProfile || {};
const cl = results.phases.cleanProfile || {};
const near = (v, target) => typeof v === "number" && Math.abs(v - target) <= 3;
results.verdict = {
  controlPutFired: c.putFired > 0,
  controlPersistedServerSide: near(cl.rectOnOpen, 250), // perfil limpio ve la 1ª edición
  fastClosePutFired: t.putFiredAfterEdit > 0,
  survivedSameProfile: near(s.rectOnReopen, 400),       // mismo perfil ve la 2ª edición
  lostInCleanProfile: near(cl.rectOnOpen, 250) && !near(cl.rectOnOpen, 400),
};
results.verdict.confirmsClaim =
  results.verdict.controlPutFired && !results.verdict.fastClosePutFired &&
  results.verdict.survivedSameProfile && results.verdict.lostInCleanProfile;
console.log("\n===== RESULT ITEM-1 =====");
console.log(JSON.stringify(results, null, 2));
