/**
 * 02-last-write-wins.mjs — ÍTEM 2: LAST-WRITE-WINS (pisada silenciosa)
 * (v2: drag con ratón CDP real — page.mouse — y verificación en DOM del movimiento)
 *
 * Secuencia (timestamps en el log):
 *  0. Reset de los 3 frames a estado conocido.
 *  1. Abre editor, carga completa. Screenshot.
 *  2. (a) Edición humana #1: drag de hum_card en frame1 (+60px). Verifica en DOM que
 *         left cambió; espera 5s autosave; verifica server-side que persistió.
 *  3. (b) MCP update_html_frame frame2 → "MCP-PROBE-2". Verifica server-side.
 *  4. (c) Espera 2s. Edición humana #2: otro drag. Espera 5s autosave. Verifica server.
 *  5. (d) MCP get_template → ¿frame2 sigue teniendo MCP-PROBE-2?
 */
import { mcp, log, logJson, launchBrowser, openEditor, waitEditorReady, shot, sleep } from "./lib.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const { templateId } = JSON.parse(readFileSync(join(HERE, "state.json"), "utf8"));

const F1 = "vc_frame1", F2 = "vc_frame2", F3 = "vc_frame3";

const frame1Html = (left) => [
  `<div data-layer-id="hum_card" data-layer-name="HumanCard" style="position:absolute;left:${left}px;top:40px;width:520px;height:300px;background:#12203a;border-radius:20px;padding:32px;box-sizing:border-box;">`,
  '  <h1 data-layer-id="hum_h1" data-layer-name="Title" style="margin:0;font-family:sans-serif;font-size:40px;color:#EDE8DC;">HUMAN-BASE-1</h1>',
  '  <p data-layer-id="hum_p" data-layer-name="Body" style="margin:16px 0 0;font-family:sans-serif;font-size:20px;color:#8A8375;">Base humana frame 1</p>',
  '</div>',
].join("\n");

const frame2Html = (text) => [
  '<div data-layer-id="ai_card" data-layer-name="AiCard" style="position:absolute;left:40px;top:40px;width:520px;height:300px;background:#1a2f1a;border-radius:20px;padding:32px;box-sizing:border-box;">',
  `  <h1 data-layer-id="ai_h1" data-layer-name="Title" style="margin:0;font-family:sans-serif;font-size:40px;color:#EDE8DC;">${text}</h1>`,
  '  <p data-layer-id="ai_p" data-layer-name="Body" style="margin:16px 0 0;font-family:sans-serif;font-size:20px;color:#8A8375;">Base IA frame 2</p>',
  '</div>',
].join("\n");

const frame3Html = [
  '<div data-layer-id="g_card" data-layer-name="GammaCard" style="position:absolute;left:40px;top:40px;width:520px;height:300px;background:#2f1a1a;border-radius:20px;padding:32px;box-sizing:border-box;">',
  '  <h1 data-layer-id="g_h1" data-layer-name="Title" style="margin:0;font-family:sans-serif;font-size:40px;color:#EDE8DC;">VC-GAMMA</h1>',
  '</div>',
].join("\n");

function framesPayload(f1html, f2html) {
  return [
    { id: F1, name: "VC Frame 1", x: 0, y: 0, width: 1080, height: 1080, background: "#0E0D0B", html: f1html, css: "" },
    { id: F2, name: "VC Frame 2", x: 1200, y: 0, width: 1080, height: 1080, background: "#0E0D0B", html: f2html, css: "" },
    { id: F3, name: "VC Frame 3", x: 2400, y: 0, width: 1080, height: 1080, background: "#0E0D0B", html: frame3Html, css: "" },
  ];
}

async function serverFrame(id) {
  const tpl = await mcp("get_template", { id: templateId });
  return (tpl.frames || []).find((f) => f.id === id);
}
const leftOf = (html) => { const m = /left:\s*(\d+)px/.exec(html || ""); return m ? Number(m[1]) : null; };

/** Centro en coords de pantalla de una capa dentro del shadow DOM del frame. */
async function layerCenterScreen(page, frameId, layerId) {
  return page.evaluate((fid, lid) => {
    const wrapper = document.querySelector('[data-frame-id="' + fid + '"]');
    if (!wrapper) return null;
    const host = [...wrapper.querySelectorAll("div")].find((el) => el.shadowRoot && el.shadowRoot.getElementById("__df_content"));
    if (!host) return null;
    const el = host.shadowRoot.getElementById("__df_content").querySelector('[data-layer-id="' + lid + '"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, zoom: r.width / (el.offsetWidth || 1) };
  }, frameId, layerId);
}

/** Lee el left actual (content px) de la capa en el DOM del editor. */
async function layerLeftDom(page, frameId, layerId) {
  return page.evaluate((fid, lid) => {
    const wrapper = document.querySelector('[data-frame-id="' + fid + '"]');
    const host = wrapper && [...wrapper.querySelectorAll("div")].find((el) => el.shadowRoot && el.shadowRoot.getElementById("__df_content"));
    const el = host && host.shadowRoot.getElementById("__df_content").querySelector('[data-layer-id="' + lid + '"]');
    return el ? parseInt(el.style.left || "0", 10) : null;
  }, frameId, layerId);
}

async function humanDrag(page, dxContentPx) {
  const c = await layerCenterScreen(page, F1, "hum_card");
  if (!c) throw new Error("hum_card no encontrada en pantalla");
  const dxScreen = dxContentPx * c.zoom;
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(c.x + (dxScreen * i) / 10, c.y, { steps: 1 });
    await sleep(30);
  }
  await page.mouse.up();
  return c;
}

async function main() {
  log("═══ ÍTEM 2: LAST-WRITE-WINS (v2, ratón CDP) ═══");

  log("reset de frames (hum_card left:40, frame2 AI-BASE)");
  await mcp("update_template", { id: templateId, frames: framesPayload(frame1Html(40), frame2Html("AI-BASE")) });

  const browser = await launchBrowser();
  try {
    const page = await openEditor(browser, templateId);
    await waitEditorReady(page, F1);
    await sleep(2500);
    await shot(page, "item2-loaded");

    // ── (a) Edición humana #1 ──
    const domLeft0 = await layerLeftDom(page, F1, "hum_card");
    log(`(a) edición humana #1: drag hum_card +60px (DOM left antes: ${domLeft0})`);
    await humanDrag(page, 60);
    await sleep(500);
    const domLeft1 = await layerLeftDom(page, F1, "hum_card");
    log(`DOM left tras drag #1: ${domLeft1} (esperado ≈100)`);
    await shot(page, "item2-after-human-edit1");
    await sleep(5000); // debounce 2s + PUT + write
    let f1 = await serverFrame(F1);
    const left1 = leftOf(f1?.html);
    log(`server frame1 hum_card left tras autosave #1: ${left1} (esperado ≈100)`);

    // ── (b) MCP write frame2 → MCP-PROBE-2 ──
    log("(b) MCP update_html_frame frame2 → MCP-PROBE-2");
    await mcp("update_html_frame", { templateId, frameId: F2, html: frame2Html("MCP-PROBE-2") });
    let f2 = await serverFrame(F2);
    const probe2AfterMcp = !!(f2 && (f2.html || "").includes("MCP-PROBE-2"));
    log(`server frame2 contiene MCP-PROBE-2 tras escritura MCP: ${probe2AfterMcp}`);

    // ── (c) espera 2s, edición humana #2 ──
    await sleep(2000);
    log("(c) edición humana #2: drag hum_card +60px");
    await humanDrag(page, 60);
    await sleep(500);
    const domLeft2 = await layerLeftDom(page, F1, "hum_card");
    log(`DOM left tras drag #2: ${domLeft2} (esperado ≈160)`);
    await shot(page, "item2-after-human-edit2");
    await sleep(5000);
    f1 = await serverFrame(F1);
    const left2 = leftOf(f1?.html);
    log(`server frame1 hum_card left tras autosave #2: ${left2} (esperado ≈160)`);

    // ── (d) ¿sobrevivió MCP-PROBE-2? ──
    f2 = await serverFrame(F2);
    const probe2Final = !!(f2 && (f2.html || "").includes("MCP-PROBE-2"));
    const f2TextNow = f2 ? ((/<h1[^>]*>([^<]*)<\/h1>/.exec(f2.html || "") || [])[1] || "?") : "?";
    log(`(d) server frame2 contiene MCP-PROBE-2 al final: ${probe2Final} (h1 actual: ${JSON.stringify(f2TextNow)})`);
    await shot(page, "item2-final-browser-view");

    logJson("RESULTADO ÍTEM 2", {
      domLeft: [domLeft0, domLeft1, domLeft2],
      serverLeft: [40, left1, left2],
      humanEdit1Persistio: left1 !== null && left1 > 40,
      probe2ExistiaTrasMcp: probe2AfterMcp,
      humanEdit2Persistio: left2 !== null && left2 > (left1 || 0),
      probe2Sobrevivio: probe2Final,
      afirmacion: "MCP-PROBE-2 desaparece: el PUT del editor pisa el trabajo de la IA",
      veredicto: (probe2AfterMcp && !probe2Final) ? "VERIFICADO (mecanismo)" : "REFUTADO (ver detalle)",
    });
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
