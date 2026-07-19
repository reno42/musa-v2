/**
 * 03-presence.mjs — ÍTEM 3: PRESENCE
 * Afirmación: presencia = código muerto. trackPresence nunca se llama (solo se define
 * en src/lib/supabaseRealtime.ts:87); el panel muestra "No agents connected" y
 * get_active_agents vía MCP devuelve vacío.
 */
import { mcp, log, logJson, launchBrowser, openEditor, waitEditorReady, shot, sleep } from "./lib.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const { templateId } = JSON.parse(readFileSync(join(HERE, "state.json"), "utf8"));

async function main() {
  log("═══ ÍTEM 3: PRESENCE ═══");
  const browser = await launchBrowser();
  try {
    const page = await openEditor(browser, templateId);
    await waitEditorReady(page, "vc_frame1");
    await sleep(2000);

    // Abrir la pestaña Agents del panel derecho
    await page.click('button[title="Agents"]');
    await sleep(1200);
    await shot(page, "item3-agents-panel");

    const panelText = await page.evaluate(() => {
      // El panel derecho es el contenedor de ActiveAgentsPanel
      const divs = [...document.querySelectorAll("div")];
      const header = divs.find((d) => d.textContent === "Active Agents" || d.textContent?.startsWith("Active Agents"));
      return header ? header.parentElement?.innerText : "(panel no encontrado)";
    });
    logJson("texto del ActiveAgentsPanel", panelText);

    const agents = await mcp("get_active_agents", { templateId });
    logJson("get_active_agents (MCP)", agents);

    const empty = (Array.isArray(agents) && agents.length === 0) ||
      (agents?.agents && agents.agents.length === 0) ||
      (agents?.data && agents.data.length === 0) ||
      Object.keys(agents || {}).length === 0;

    logJson("RESULTADO ÍTEM 3", {
      panelDice: panelText,
      panelMuestraNoAgents: typeof panelText === "string" && panelText.includes("No agents connected"),
      getActiveAgentsVacio: !!empty,
      evidenciaEstatica: "trackPresence solo se define (src/lib/supabaseRealtime.ts:87), ningún caller en src/; además el bundle de prod no trae VITE_SUPABASE_* → getClient()=null → ni siquiera se crea el canal de presencia",
      veredicto: "VERIFICADO",
    });
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
