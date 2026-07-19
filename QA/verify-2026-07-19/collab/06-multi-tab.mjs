/**
 * 06-multi-tab.mjs — ÍTEM 6: MULTI-TAB (mismo perfil, dos tabs del editor)
 * a) Edita en tab1, observa tab2 (¿se actualiza solo?).
 * b) Carrera: tab1 arrastra hum_card y tab2 arrastra tab_card (<5s de diferencia,
 *    ambas en frame1). Cada tab hace su autosave PUT con SU copia completa del
 *    template. ¿Quién gana? (esperado: el último PUT; el trabajo del otro tab se
 *    pierde silenciosamente — cada tab es ciego al otro).
 */
import { mcp, log, logJson, launchBrowser, openEditor, waitEditorReady, shot, sleep } from "./lib.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const { templateId } = JSON.parse(readFileSync(join(HERE, "state.json"), "utf8"));
const F1 = "vc_frame1";

const frame1Html = [
  '<div data-layer-id="hum_card" data-layer-name="HumanCard" style="position:absolute;left:40px;top:40px;width:420px;height:240px;background:#12203a;border-radius:20px;padding:24px;box-sizing:border-box;">',
  '  <h1 data-layer-id="hum_h1" data-layer-name="Title" style="margin:0;font-family:sans-serif;font-size:32px;color:#EDE8DC;">TAB1-CARD</h1>',
  '</div>',
  '<div data-layer-id="tab_card" data-layer-name="TabCard" style="position:absolute;left:40px;top:400px;width:420px;height:240px;background:#3a2a12;border-radius:20px;padding:24px;box-sizing:border-box;">',
  '  <h1 data-layer-id="tab_h1" data-layer-name="Title" style="margin:0;font-family:sans-serif;font-size:32px;color:#EDE8DC;">TAB2-CARD</h1>',
  '</div>',
].join("\n");

async function layerComputedLeft(page, layerId) {
  return page.evaluate((fid, lid) => {
    const wrapper = document.querySelector('[data-frame-id="' + fid + '"]');
    const host = wrapper && [...wrapper.querySelectorAll("div")].find((el) => el.shadowRoot && el.shadowRoot.getElementById("__df_content"));
    const el = host && host.shadowRoot.getElementById("__df_content").querySelector('[data-layer-id="' + lid + '"]');
    if (!el) return null;
    return parseInt(getComputedStyle(el).left || "0", 10);
  }, F1, layerId);
}

async function humanDrag(page, layerId, dxContentPx) {
  const c = await page.evaluate((fid, lid) => {
    const wrapper = document.querySelector('[data-frame-id="' + fid + '"]');
    const host = wrapper && [...wrapper.querySelectorAll("div")].find((el) => el.shadowRoot && el.shadowRoot.getElementById("__df_content"));
    const el = host && host.shadowRoot.getElementById("__df_content").querySelector('[data-layer-id="' + lid + '"]');
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, zoom: r.width / (el.offsetWidth || 1) };
  }, F1, layerId);
  const dxScreen = dxContentPx * c.zoom;
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(c.x + (dxScreen * i) / 12, c.y, { steps: 1 }); await sleep(25); }
  await page.mouse.up();
}

async function main() {
  log("═══ ÍTEM 6: MULTI-TAB ═══");
  await mcp("update_template", { id: templateId, frames: [
    { id: F1, name: "VC Frame 1", x: 0, y: 0, width: 1080, height: 1080, background: "#0E0D0B", html: frame1Html, css: "" },
  ] });
  log("reset hecho (frame1 con hum_card + tab_card)");

  const browser = await launchBrowser();
  try {
    const page1 = await openEditor(browser, templateId);           // tab1
    const page2 = await openEditor(browser, templateId);           // tab2 (mismo contexto/perfil)
    await waitEditorReady(page1, F1);
    await waitEditorReady(page2, F1);
    await sleep(2500);
    log("ambas tabs cargadas");

    // ── (a) edita tab1, observa tab2 ──
    log("(a) tab1: drag hum_card +300px");
    await humanDrag(page1, "hum_card", 300);
    await sleep(500);
    log(`tab1 hum_card computed left: ${await layerComputedLeft(page1, "hum_card")}`);
    let tab2SyncA = null;
    for (let i = 1; i <= 8; i++) {
      await sleep(1000);
      const v = await layerComputedLeft(page2, "hum_card");
      log(`t+${i}s tab2 hum_card computed left: ${v}`);
      if (v !== null && v > 100) { tab2SyncA = i; break; }
    }
    await shot(page1, "item6-tab1-after-edit");
    await shot(page2, "item6-tab2-after-8s");

    // ── (b) carrera: los dos tabs editan <5s ──
    log("(b) carrera: tab1 drag hum_card +100 y tab2 drag tab_card +100 con 1s de diferencia");
    await humanDrag(page1, "hum_card", 100);   // tab1 → PUT a ~t+2.4s con SU copia (sin tab_card movida)
    await sleep(1000);
    await humanDrag(page2, "tab_card", 100);   // tab2 → PUT a ~t+3.4s con SU copia (sin hum_card movida)
    await sleep(6000);                          // deja que ambos autosaves disparen

    const tpl = await mcp("get_template", { id: templateId });
    const f1 = (tpl.frames || []).find((f) => f.id === F1);
    const css = f1?.css || "";
    const cssTieneHum = /hum_card/.test(css);
    const cssTieneTab = /tab_card/.test(css);
    logJson("server frame1.css tras la carrera", { cssTieneHumCard: cssTieneHum, cssTieneTabCard: cssTieneTab, css });
    await shot(page1, "item6-tab1-final");
    await shot(page2, "item6-tab2-final");

    logJson("RESULTADO ÍTEM 6", {
      a_tab2SeActualizoSolo: tab2SyncA !== null,
      a_latenciaSegundos: tab2SyncA,
      b_ganador: cssTieneTab && !cssTieneHum ? "tab2 (último PUT) — el movimiento de tab1 se perdió"
        : cssTieneHum && !cssTieneTab ? "tab1"
        : cssTieneHum && cssTieneTab ? "ambos (¿merge inesperado?)"
        : "ninguno (¿ningún PUT?)",
      nota: "Cada PUT lleva el template COMPLETO de su tab; el último PUT pisa al anterior sin aviso",
    });
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
