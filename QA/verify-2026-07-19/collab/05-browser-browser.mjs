/**
 * 05-browser-browser.mjs — ÍTEM 5: BROWSER↔BROWSER
 * Afirmación a probar: editar en ctx1 actualiza ctx2 solo (~4s) vía broadcast del editor.
 * OJO: el bundle de prod no trae VITE_SUPABASE_* → sin canal realtime; ctx2 depende
 * del polling (roto por stale closure, ver ítem 1b). La evidencia manda.
 *
 * Dos contextos AISLADOS (localStorage separado) con verify-c-collab abierto.
 * Edición humana en ctx1 = drag de hum_card +300px (visible en screenshot).
 * Se sondea el DOM de ctx2 cada 1s durante 15s midiendo latencia.
 */
import { mcp, log, logJson, launchBrowser, openEditor, waitEditorReady, shot, sleep } from "./lib.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const { templateId } = JSON.parse(readFileSync(join(HERE, "state.json"), "utf8"));
const F1 = "vc_frame1", F2 = "vc_frame2", F3 = "vc_frame3";

const frame1Html = [
  '<div data-layer-id="hum_card" data-layer-name="HumanCard" style="position:absolute;left:40px;top:40px;width:520px;height:300px;background:#12203a;border-radius:20px;padding:32px;box-sizing:border-box;">',
  '  <h1 data-layer-id="hum_h1" data-layer-name="Title" style="margin:0;font-family:sans-serif;font-size:40px;color:#EDE8DC;">CTX-BASE</h1>',
  '</div>',
].join("\n");
const frame2Html = '<div data-layer-id="ai_card" data-layer-name="AiCard" style="position:absolute;left:40px;top:40px;width:520px;height:300px;background:#1a2f1a;border-radius:20px;padding:32px;box-sizing:border-box;"><h1 data-layer-id="ai_h1" data-layer-name="Title" style="margin:0;font-family:sans-serif;font-size:40px;color:#EDE8DC;">AI-BASE</h1></div>';
const frame3Html = '<div data-layer-id="g_card" data-layer-name="GammaCard" style="position:absolute;left:40px;top:40px;width:300px;height:200px;background:#2f1a1a;border-radius:20px;"></div>';

async function layerLeftDom(page) {
  return page.evaluate((fid) => {
    const wrapper = document.querySelector('[data-frame-id="' + fid + '"]');
    const host = wrapper && [...wrapper.querySelectorAll("div")].find((el) => el.shadowRoot && el.shadowRoot.getElementById("__df_content"));
    const el = host && host.shadowRoot.getElementById("__df_content").querySelector('[data-layer-id="hum_card"]');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { inlineLeft: parseInt(el.style.left || "0", 10), computedLeft: parseInt(cs.left || "0", 10) };
  }, F1);
}

async function humanDrag(page, dxContentPx) {
  const c = await page.evaluate((fid) => {
    const wrapper = document.querySelector('[data-frame-id="' + fid + '"]');
    const host = wrapper && [...wrapper.querySelectorAll("div")].find((el) => el.shadowRoot && el.shadowRoot.getElementById("__df_content"));
    const el = host && host.shadowRoot.getElementById("__df_content").querySelector('[data-layer-id="hum_card"]');
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, zoom: r.width / (el.offsetWidth || 1) };
  }, F1);
  const dxScreen = dxContentPx * c.zoom;
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(c.x + (dxScreen * i) / 12, c.y, { steps: 1 }); await sleep(25); }
  await page.mouse.up();
}

async function main() {
  log("═══ ÍTEM 5: BROWSER↔BROWSER ═══");
  await mcp("update_template", { id: templateId, frames: [
    { id: F1, name: "VC Frame 1", x: 0, y: 0, width: 1080, height: 1080, background: "#0E0D0B", html: frame1Html, css: "" },
    { id: F2, name: "VC Frame 2", x: 1200, y: 0, width: 1080, height: 1080, background: "#0E0D0B", html: frame2Html, css: "" },
    { id: F3, name: "VC Frame 3", x: 2400, y: 0, width: 1080, height: 1080, background: "#0E0D0B", html: frame3Html, css: "" },
  ] });
  log("reset hecho");

  const browser = await launchBrowser();
  try {
    // ctx1 = contexto por defecto; ctx2 = contexto aislado
    const page1 = await openEditor(browser, templateId);
    const ctx2 = await browser.createBrowserContext();
    const page2 = await openEditor(browser, templateId, { context: ctx2 });

    log("esperando carga de ambos editores...");
    await waitEditorReady(page1, F1);
    await waitEditorReady(page2, F1);
    await sleep(2500);

    const p2before = await layerLeftDom(page2);
    logJson("ctx2 hum_card ANTES", p2before);
    await shot(page1, "item5-ctx1-before");
    await shot(page2, "item5-ctx2-before");

    log("edición humana en ctx1: drag hum_card +300px");
    const t0 = Date.now();
    await humanDrag(page1, 300);
    await sleep(500);
    const p1after = await layerLeftDom(page1);
    logJson("ctx1 hum_card tras drag", p1after);
    await shot(page1, "item5-ctx1-after-drag");

    // sondeo de ctx2 hasta 15s
    let syncedAt = null;
    for (let i = 1; i <= 15; i++) {
      await sleep(1000);
      const cur = await layerLeftDom(page2);
      const moved = cur && (cur.computedLeft > 100 || cur.inlineLeft > 100);
      log(`t+${i}s ctx2 hum_card: ${JSON.stringify(cur)} ${moved ? "← ACTUALIZADO" : ""}`);
      if (moved) { syncedAt = (Date.now() - t0) / 1000; break; }
    }
    await shot(page2, "item5-ctx2-after-15s");

    logJson("RESULTADO ÍTEM 5", {
      ctx1Movio: (p1after?.computedLeft || 0) > 100,
      ctx2SeActualizoSolo: syncedAt !== null,
      latenciaSegundos: syncedAt,
      afirmacion: "ctx2 se actualiza solo vía broadcast del editor",
      veredicto: syncedAt !== null ? "VERIFICADO" : "REFUTADO — sin Supabase en el bundle no hay broadcast; el polling está roto (ítem 1b); ctx2 queda ciego hasta recargar",
    });
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
