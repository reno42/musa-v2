/**
 * 01b-polling-timing.mjs — complemento del ÍTEM 1.
 * El ÍTEM 1 escribió vía MCP ~3s tras la carga (antes de que el polling de 5s
 * cebara su baseline `lastRemoteUpdate`). Aquí el probe llega DESPUÉS de ≥2 polls
 * (12s tras carga) para determinar si el polling llega a mostrar escrituras MCP.
 * También registra qué hay en localStorage para el template (grace window de 5s).
 */
import { mcp, log, logJson, launchBrowser, openEditor, waitEditorReady, readFrameText, shot, sleep } from "./lib.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const { templateId } = JSON.parse(readFileSync(join(HERE, "state.json"), "utf8"));
const F1 = "vc_frame1";

const PROBE = "MCP-LIVE-PROBE-1b";
const HTML = [
  '<div data-layer-id="card_VCALPHA" data-layer-name="Card" style="position:absolute;left:40px;top:40px;width:520px;height:300px;background:#12203a;border-radius:20px;padding:32px;box-sizing:border-box;">',
  `  <h1 data-layer-id="h1_VCALPHA" data-layer-name="Title" style="margin:0;font-family:sans-serif;font-size:40px;color:#EDE8DC;">${PROBE}</h1>`,
  '  <p data-layer-id="p_VCALPHA" data-layer-name="Body" style="margin:16px 0 0;font-family:sans-serif;font-size:20px;color:#8A8375;">Texto original frame 1</p>',
  '</div>',
].join("\n");

async function main() {
  log("═══ ÍTEM 1b: timing del polling (probe tardío) ═══");
  const browser = await launchBrowser();
  try {
    const page = await openEditor(browser, templateId);
    await waitEditorReady(page, F1);
    log("editor cargado; esperando 12s para que el polling cebe su baseline...");
    await sleep(12000);

    const lsInfo = await page.evaluate((tplId) => {
      const out = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.includes(tplId)) {
          try { const v = JSON.parse(localStorage.getItem(k)); out[k] = { updatedAt: v.updatedAt || v?.data?.updatedAt || null }; }
          catch { out[k] = "(no JSON)"; }
        }
      }
      return out;
    }, templateId);
    logJson("localStorage keys del template antes del probe", lsInfo);

    log(`MCP update_html_frame → h1 = ${PROBE}`);
    await mcp("update_html_frame", { templateId, frameId: F1, html: HTML });
    const t0 = Date.now();

    let appearedAt = null;
    for (let i = 1; i <= 10; i++) {
      await sleep(2000);
      const txt = await readFrameText(page, F1);
      const has = !!(txt && txt.includes(PROBE));
      log(`t+${i * 2}s DOM contiene ${PROBE}: ${has}`);
      if (has) { appearedAt = (Date.now() - t0) / 1000; break; }
    }
    await shot(page, "item1b-after-late-probe");

    logJson("RESULTADO ÍTEM 1b", {
      probeTardioVisibleSinRecargar: appearedAt !== null,
      latenciaAproxSegundos: appearedAt,
      nota: appearedAt !== null
        ? "El polling (5s) SÍ recoge escrituras MCP si el probe llega tras cebar el baseline"
        : "Ni con probe tardío aparece: polling ineficaz para escrituras MCP",
    });
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
