/**
 * 01-ai-write-not-live.mjs — ÍTEM 1: AI-WRITE-NOT-LIVE
 * Afirmación: un update_html_frame vía MCP NO se ve en el editor abierto hasta recargar,
 * porque el MCP no emite realtime y el polling (5s) solo corre si Supabase no está configurado.
 *
 * Secuencia:
 *  1. Abre verify-c-collab en el editor, espera carga completa. Screenshot + texto inicial.
 *  2. MCP update_html_frame: h1 de vc_frame1 → "MCP-LIVE-PROBE-1".
 *  3. 12s SIN tocar el navegador, sondeando el DOM cada 2s. Screenshot.
 *  4. Reload → espera carga → lee texto + screenshot.
 * Evidencia extra: WebSockets creados por la página (¿hay wss://*.supabase.co/realtime?).
 */
import { mcp, log, logJson, launchBrowser, openEditor, waitEditorReady, readFrameText, shot, sleep, SHOTS } from "./lib.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const state = JSON.parse(readFileSync(join(HERE, "state.json"), "utf8"));
const { templateId } = state;
const F1 = "vc_frame1";

const PROBED_HTML = [
  '<div data-layer-id="card_VCALPHA" data-layer-name="Card" style="position:absolute;left:40px;top:40px;width:520px;height:300px;background:#12203a;border-radius:20px;padding:32px;box-sizing:border-box;">',
  '  <h1 data-layer-id="h1_VCALPHA" data-layer-name="Title" style="margin:0;font-family:sans-serif;font-size:40px;color:#EDE8DC;">MCP-LIVE-PROBE-1</h1>',
  '  <p data-layer-id="p_VCALPHA" data-layer-name="Body" style="margin:16px 0 0;font-family:sans-serif;font-size:20px;color:#8A8375;">Texto original frame 1</p>',
  '</div>',
].join("\n");

async function main() {
  log("═══ ÍTEM 1: AI-WRITE-NOT-LIVE ═══");
  const browser = await launchBrowser();
  try {
    const page = await openEditor(browser, templateId);

    // Detectar WebSockets (evidencia de Supabase Realtime activo)
    const wsUrls = [];
    const cdp = await page.createCDPSession();
    await cdp.send("Network.enable");
    cdp.on("Network.webSocketCreated", ({ url }) => { wsUrls.push(url); log(`WebSocket creado: ${url}`); });

    log("esperando carga completa del editor...");
    await waitEditorReady(page, F1);
    await sleep(3000); // deja que terminen subscripciones realtime / primer render

    const before = await readFrameText(page, F1);
    logJson("texto frame1 ANTES del probe", before);
    await shot(page, "item1-editor-loaded");

    // ── Escritura de la IA vía MCP ──
    log("MCP update_html_frame → h1 = MCP-LIVE-PROBE-1");
    const upd = await mcp("update_html_frame", { templateId, frameId: F1, html: PROBED_HTML });
    logJson("respuesta update_html_frame", typeof upd === "object" ? Object.keys(upd) : upd);

    // ── 12s sin tocar el navegador, sondeando cada 2s ──
    let appeared = false;
    for (let i = 1; i <= 6; i++) {
      await sleep(2000);
      const txt = await readFrameText(page, F1);
      const has = !!(txt && txt.includes("MCP-LIVE-PROBE-1"));
      log(`t+${i * 2}s DOM frame1 contiene PROBE-1: ${has}${has ? "" : " | texto actual: " + JSON.stringify((txt || "").slice(0, 60))}`);
      if (has) { appeared = true; break; }
    }
    await shot(page, "item1-after-mcp-write-12s");

    // ── Reload ──
    log("recargando la página...");
    await page.reload({ waitUntil: "networkidle2", timeout: 90000 });
    await waitEditorReady(page, F1);
    await sleep(2000);
    const afterReload = await readFrameText(page, F1);
    const visibleAfterReload = !!(afterReload && afterReload.includes("MCP-LIVE-PROBE-1"));
    log(`texto frame1 TRAS reload contiene PROBE-1: ${visibleAfterReload}`);
    await shot(page, "item1-after-reload");

    // Verificación servidor-side (estado real persistido)
    const tpl = await mcp("get_template", { id: templateId });
    const f1 = (tpl.frames || []).find((f) => f.id === F1);
    const persistedHasProbe = !!(f1 && (f1.html || "").includes("MCP-LIVE-PROBE-1"));
    log(`servidor (get_template) frame1 tiene PROBE-1 persistido: ${persistedHasProbe}`);

    logJson("RESULTADO ÍTEM 1", {
      websockets: wsUrls,
      supabaseRealtimeActivo: wsUrls.some((u) => u.includes("supabase")),
      cambioVisibleSinRecargar: appeared,
      cambioVisibleTrasRecargar: visibleAfterReload,
      persistidoEnServidor: persistedHasProbe,
      afirmacion: "NO se ve sin recargar; SÍ tras recargar",
      veredicto: (!appeared && visibleAfterReload && persistedHasProbe) ? "VERIFICADO" : "REFUTADO (ver detalle)",
    });
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
