/**
 * 03-localstorage-risk.mjs — ÍTEM 3: LOCALSTORAGE-RISK en PRODUCCIÓN
 *
 * Afirmación: cada autosave serializa el documento COMPLETO a UNA clave compartida
 * (futuraria_local_templates) → riesgo de QuotaExceededError con varios templates grandes.
 *
 * Hallazgo previo (logs/03b): el SERVIDOR elimina data:image/...;base64 de frames[].html
 * en cada PUT (api/src/routes/templates.ts:204-222, "502 prevention"), así que sembrar
 * la imagen por API no llega al cliente. Por eso la data URI se inyecta POR LA UI:
 * panel de código (Monaco) → setValue → onHtmlChange → autoSave (mismo camino que un
 * usuario que pega HTML con imagen inline).
 *
 *  A) Mecanismo: instrumentar localStorage.setItem; inyectar img ~780KB data URI;
 *     hacer 3 ediciones → registrar cada escritura (key, chars, ts) + tamaño del PUT.
 *  B) Cuota: hasta 9 templates verify-a2-imgNN con el mismo doc grande editados en el
 *     mismo perfil → crecimiento acumulado de la clave compartida hasta QuotaExceeded
 *     (o agotar la lista). Se captura el error de setItem, console [SAVE] y el toast.
 */
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import {
  log, ts, createTemplate, purgeTemplate,
  launchProfile, attachNetLog, openEditor, shot, lsInfo,
  PROFILES,
} from "./lib.mjs";

// ── PNG de ruido mínimo (sin dependencias) ──
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const pngChunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function noisePngDataUri(w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    crypto.randomBytes(w * 3).copy(raw, y * (1 + w * 3) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 0 });
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

const FRAME = "frame_a2_img";
const MAX_TPL = 9;
const results = { item: "3-LOCALSTORAGE-RISK", editsPhaseA: [], quotaPhase: [] };
const createdIds = [];

const smallFrames = () => [{ id: FRAME, name: "Img", x: 0, y: 0, width: 1080, height: 1080, background: "#0E0D0B",
  html: `<div data-layer-id="tag" data-layer-name="Tag" style="position:absolute;left:80px;top:420px;width:120px;height:40px;background:#C8B898;"></div>`, css: "" }];

async function mk(name) {
  const id = await createTemplate(name, smallFrames());
  createdIds.push(id);
  return id;
}

/** Abre el panel de código y pone el html vía Monaco (camino del usuario que pega código). */
async function injectHtmlViaCodePanel(page, html) {
  await page.click('button[title="Show Code (Ctrl+/)"]');
  await page.waitForSelector(".monaco-editor", { timeout: 45000 });
  await page.waitForFunction(() => window.monaco && monaco.editor.getModels().length > 0, { timeout: 45000 });
  await sleep(400);
  await page.evaluate((h) => { monaco.editor.getModels()[0].setValue(h); }, html);
  await sleep(700); // debounce del panel (200ms) + autoSave (LS síncrono)
}

try {
  log("generando PNG de ruido 450x450…");
  const imgUri = noisePngDataUri(450, 450);
  log(`data URI: ${imgUri.length} chars (~${Math.round(imgUri.length / 1024)}KB)`);
  results.imgDataUriChars = imgUri.length;
  const bigHtml = `<img data-layer-id="img1" data-layer-name="Img1" src="${imgUri}" style="position:absolute;left:80px;top:80px;width:450px;height:450px;object-fit:cover;border-radius:8px;">` +
    `<div data-layer-id="tag" data-layer-name="Tag" style="position:absolute;left:80px;top:560px;width:120px;height:40px;background:#C8B898;"></div>`;

  const browser = await launchProfile(path.join(PROFILES, "d2-ls"));
  const page = await browser.newPage();
  const net = attachNetLog(page, "LS");
  const consoleLog = [];
  page.on("console", m => { if (/\[SAVE\]|quota/i.test(m.text())) consoleLog.push({ t: ts(), text: m.text().slice(0, 220) }); });

  const instrument = () => page.evaluate(() => {
    window.__lsWrites = window.__lsWrites || [];
    window.__lsFail = null;
    if (!window.__lsWrapped) {
      const orig = localStorage.setItem.bind(localStorage);
      localStorage.setItem = (k, v) => {
        try {
          window.__lsWrites.push({ t: new Date().toISOString(), key: k, chars: (v || "").length });
          return orig(k, v);
        } catch (e) { window.__lsFail = String(e); throw e; }
      };
      window.__lsWrapped = true;
    }
  });

  // ── FASE A ──
  const tplA = await mk("verify-a2-img");
  await openEditor(page, tplA, FRAME);
  await instrument();
  await injectHtmlViaCodePanel(page, bigHtml);
  await shot(page, "03-01-img-inyectada");
  // 2 ediciones adicionales (drag del tag) → cada una re-serializa el doc completo
  for (let i = 1; i <= 2; i++) {
    await page.evaluate((f, dx) => window.__qa.dragLayer(f, "tag", dx, 0), FRAME, 10 * i);
    await sleep(400);
  }
  const writesA = await page.evaluate(() => window.__lsWrites);
  const lsA = await lsInfo(page);
  results.setItemWritesPhaseA = writesA;
  results.editsPhaseA.push({ t: ts(), lsChars: lsA.localTemplatesChars, perTemplateChars: lsA.perTemplateChars });
  const putBig = net.filter(e => e.phase === "req" && e.method === "PUT" && e.bytes > 100000).map(e => ({ t: e.t, bytes: e.bytes }));
  results.putsGrandes = putBig;
  log("fase A: writes =", JSON.stringify(writesA.map(w => w.chars)), "PUTs >100KB:", JSON.stringify(putBig.map(p => p.bytes)));

  // ── FASE B: cuota acumulada ──
  let quotaError = null;
  for (let n = 2; n <= MAX_TPL; n++) {
    const name = `verify-a2-img${String(n).padStart(2, "0")}`;
    const id = await mk(name);
    await openEditor(page, id, FRAME);
    await instrument();
    try {
      await injectHtmlViaCodePanel(page, bigHtml);
    } catch (e) {
      log(`fase B ${name}: fallo inyección Monaco: ${e.message}`);
    }
    await sleep(300);
    const fail = await page.evaluate(() => window.__lsFail);
    const ls = await lsInfo(page);
    const toastVisible = await page.evaluate(() => document.body.textContent.includes("no se pudo guardar localmente"));
    const entry = { n, name, t: ts(), lsChars: ls.localTemplatesChars, templatesEnLS: ls.templateIds.length, setItemError: fail, toastVisible };
    results.quotaPhase.push(entry);
    log(`fase B ${name}: LS = ${(ls.localTemplatesChars / 1e6).toFixed(2)}M chars, templates=${ls.templateIds.length}, error=${fail || "no"}, toast=${toastVisible}`);
    if (fail || toastVisible) {
      quotaError = entry;
      await shot(page, "03-02-quota-exceeded");
      break;
    }
  }
  await shot(page, "03-03-estado-final");
  await browser.close();
  results.quotaError = quotaError;
  results.consoleSAVE = consoleLog;
} catch (err) {
  results.fatal = err.message;
  log("FATAL", err.message);
} finally {
  for (const id of createdIds) {
    try { await purgeTemplate(id); } catch { /* best effort */ }
  }
  log(`cleanup: ${createdIds.length} templates purgados`);
  results.cleanedUp = createdIds.length;
}

const w = results.setItemWritesPhaseA || [];
results.verdict = {
  oneSetItemPerAutosave: w.length >= 2 && w.every(x => x.key === "futuraria_local_templates"),
  fullDocumentPerWrite: w.length >= 2 && w.filter(x => x.chars > (results.imgDataUriChars || 1e6) * 0.8).length >= 2,
  sharedSingleKey: w.length > 0 && w.every(x => x.key === "futuraria_local_templates"),
  cumulativeGrowth: results.quotaPhase.length > 0,
  quotaExceededObserved: Boolean(results.quotaError),
  quotaErrorDetail: results.quotaError || null,
};
console.log("\n===== RESULT ITEM-3 =====");
console.log(JSON.stringify(results, null, 2));
