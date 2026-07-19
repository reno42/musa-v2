/**
 * 02b-last-write-wins-intercept.mjs — ÍTEM 2 (prueba balística)
 * Igual que 02 pero capturando los PUT /api/templates/:id que emite el editor:
 * método, timestamp, y qué html lleva cada frame en el payload.
 * Demuestra: el PUT del autosave lleva el template COMPLETO y STALE (frame2 = AI-BASE)
 * aunque el humano solo arrastró una card en frame1 (que viaja como CSS, no html).
 */
import { mcp, log, logJson, launchBrowser, openEditor, waitEditorReady, shot, sleep, LOGS } from "./lib.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const { templateId } = JSON.parse(readFileSync(join(HERE, "state.json"), "utf8"));
const F1 = "vc_frame1", F2 = "vc_frame2", F3 = "vc_frame3";

const frame1Html = (left) => [
  `<div data-layer-id="hum_card" data-layer-name="HumanCard" style="position:absolute;left:${left}px;top:40px;width:520px;height:300px;background:#12203a;border-radius:20px;padding:32px;box-sizing:border-box;">`,
  '  <h1 data-layer-id="hum_h1" data-layer-name="Title" style="margin:0;font-family:sans-serif;font-size:40px;color:#EDE8DC;">HUMAN-BASE-1</h1>',
  '</div>',
].join("\n");
const frame2Html = (text) => [
  '<div data-layer-id="ai_card" data-layer-name="AiCard" style="position:absolute;left:40px;top:40px;width:520px;height:300px;background:#1a2f1a;border-radius:20px;padding:32px;box-sizing:border-box;">',
  `  <h1 data-layer-id="ai_h1" data-layer-name="Title" style="margin:0;font-family:sans-serif;font-size:40px;color:#EDE8DC;">${text}</h1>`,
  '</div>',
].join("\n");
const frame3Html = '<div data-layer-id="g_card" data-layer-name="GammaCard" style="position:absolute;left:40px;top:40px;width:300px;height:200px;background:#2f1a1a;border-radius:20px;"></div>';

const framesPayload = (f1h, f2h) => [
  { id: F1, name: "VC Frame 1", x: 0, y: 0, width: 1080, height: 1080, background: "#0E0D0B", html: f1h, css: "" },
  { id: F2, name: "VC Frame 2", x: 1200, y: 0, width: 1080, height: 1080, background: "#0E0D0B", html: f2h, css: "" },
  { id: F3, name: "VC Frame 3", x: 2400, y: 0, width: 1080, height: 1080, background: "#0E0D0B", html: frame3Html, css: "" },
];

async function serverFrame(id) {
  const tpl = await mcp("get_template", { id: templateId });
  return (tpl.frames || []).find((f) => f.id === id);
}

async function layerCenterScreen(page) {
  return page.evaluate((fid) => {
    const wrapper = document.querySelector('[data-frame-id="' + fid + '"]');
    const host = wrapper && [...wrapper.querySelectorAll("div")].find((el) => el.shadowRoot && el.shadowRoot.getElementById("__df_content"));
    const el = host && host.shadowRoot.getElementById("__df_content").querySelector('[data-layer-id="hum_card"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, zoom: r.width / (el.offsetWidth || 1) };
  }, F1);
}

async function humanDrag(page, dxContentPx) {
  const c = await layerCenterScreen(page);
  const dxScreen = dxContentPx * c.zoom;
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(c.x + (dxScreen * i) / 10, c.y, { steps: 1 }); await sleep(30); }
  await page.mouse.up();
}

async function main() {
  log("═══ ÍTEM 2b: LAST-WRITE-WINS con interceptación de PUT ═══");
  await mcp("update_template", { id: templateId, frames: framesPayload(frame1Html(40), frame2Html("AI-BASE")) });
  log("reset hecho (frame1 left:40, frame2 AI-BASE)");

  const browser = await launchBrowser();
  try {
    const page = await openEditor(browser, templateId);

    // ── interceptación ──
    const puts = [];
    page.on("request", (req) => {
      if (req.method() === "PUT" && req.url().includes(`/api/templates/${templateId}`)) {
        try {
          const body = JSON.parse(req.postData() || "{}");
          const frames = (body.frames || []).map((f) => ({
            id: f.id,
            htmlHasProbe2: (f.html || "").includes("MCP-PROBE-2"),
            htmlHasAiBase: (f.html || "").includes("AI-BASE"),
            htmlLeft40: /left:\s*40px/.test(f.html || ""),
            cssSnippet: (f.css || "").slice(0, 120),
          }));
          puts.push({ ts: new Date().toISOString(), topCssSnippet: (body.css || "").slice(0, 120), frames });
          log(`PUT interceptado #${puts.length} — frames: ${JSON.stringify(frames)}`);
        } catch (e) { log(`PUT interceptado (body no JSON): ${e.message}`); }
      }
    });
    page.on("response", (res) => {
      if (res.request().method() === "PUT" && res.url().includes(`/api/templates/${templateId}`)) {
        log(`PUT → HTTP ${res.status()}`);
      }
    });

    await waitEditorReady(page, F1);
    await sleep(2500);
    await shot(page, "item2b-loaded");

    log("(a) drag humano #1 (+60px)");
    await humanDrag(page, 60);
    await sleep(5000);

    log("(b) MCP update_html_frame frame2 → MCP-PROBE-2");
    await mcp("update_html_frame", { templateId, frameId: F2, html: frame2Html("MCP-PROBE-2") });
    const f2b = await serverFrame(F2);
    log(`server frame2 tiene PROBE-2: ${!!(f2b && (f2b.html || "").includes("MCP-PROBE-2"))}`);

    await sleep(2000);
    log("(c) drag humano #2 (+60px)");
    await humanDrag(page, 60);
    await sleep(5000);

    const f1end = await serverFrame(F1);
    const f2end = await serverFrame(F2);
    writeFileSync(join(LOGS, "item2b-puts.json"), JSON.stringify(puts, null, 2));
    logJson("RESULTADO ÍTEM 2b", {
      putsCapturados: puts.length,
      algunPutConProbe2: puts.some((p) => p.frames.some((f) => f.htmlHasProbe2)),
      putsConFrame2StaleAiBase: puts.filter((p) => p.frames.some((f) => f.id === F2 && f.htmlHasAiBase)).length,
      serverF1HtmlLeft40AlFinal: /left:\s*40px/.test(f1end?.html || ""),
      serverF1CssTienePosicion: (f1end?.css || "").length > 0,
      serverF2TieneProbe2AlFinal: !!(f2end && (f2end.html || "").includes("MCP-PROBE-2")),
      serverF2H1AlFinal: (/<h1[^>]*>([^<]*)<\/h1>/.exec(f2end?.html || "") || [])[1] || null,
    });
    await shot(page, "item2b-final");
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
