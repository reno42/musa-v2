/**
 * Sonda: ¿el editor hace polling de /api/templates/:id cada 5s?
 * ¿Qué devuelve getTemplate (localStorage vs API)? ¿Hay canal supabase?
 */
import { EditorHarness, createVerifyTemplate, deleteTemplate, remoteUpdateFrame, log, sleep } from "./lib.mjs";

const HTML = '<div data-layer-id="la" data-layer-name="A" style="position:absolute;left:50px;top:50px;width:200px;height:200px;background:#EF4444;"></div>';
const HTML2 = HTML + '\n<div data-layer-id="lnew" data-layer-name="N" style="position:absolute;left:300px;top:50px;width:200px;height:200px;background:#22C55E;"></div>';

async function main() {
  const harness = new EditorHarness();
  await harness.start();
  const { templateId, frameId } = await createVerifyTemplate("pollprobe", { html: HTML });
  try {
    const apiCalls = [];
    harness.page.on("response", async (res) => {
      if (res.url().includes(`/api/templates/${templateId}`) && res.request().method() === "GET") {
        let updatedAt = null, frameCount = null, layerIds = null;
        try {
          const b = await res.json();
          const t = b.data || b;
          updatedAt = t.metadata?.updatedAt || null;
          frameCount = t.frames?.length ?? null;
          layerIds = JSON.stringify(t.frames?.[0]?.html || "").match(/data-layer-id=\\"(\w+)\\"/g)?.slice(0, 5) || null;
        } catch { /* noop */ }
        apiCalls.push({ t: new Date().toISOString().slice(11, 19), updatedAt, frameCount });
      }
    });
    harness.page.on("request", (req) => {
      if (req.url().includes("supabase") || req.url().includes("realtime")) {
        log(`[probe] supabase traffic: ${req.url().slice(0, 90)}`);
      }
    });

    await harness.open(templateId, frameId);
    await harness.settle(300);
    const ls = await harness.page.evaluate((id) => {
      const keys = Object.keys(localStorage);
      const mine = keys.filter(k => localStorage.getItem(k)?.includes(id));
      return { totalKeys: keys.length, keysWithTemplate: mine, sample: keys.slice(0, 8) };
    }, templateId);
    log(`[probe] localStorage: ${JSON.stringify(ls)}`);

    log("[probe] esperando 12s (2+ ciclos de poll)…");
    await sleep(12000);
    log(`[probe] llamadas GET /api/templates hasta ahora: ${apiCalls.length} ${JSON.stringify(apiCalls)}`);

    log("[probe] enviando update remoto (añade capa lnew)…");
    await remoteUpdateFrame(templateId, frameId, { html: HTML2, name: "QA pollprobe" });
    for (let i = 0; i < 25; i++) {
      await sleep(1000);
      const got = await harness.page.evaluate((fid) => {
        const wrapper = document.querySelector(`[data-frame-id="${fid}"]`);
        const host = [...wrapper.querySelectorAll("div")].find(el => el.shadowRoot && el.shadowRoot.getElementById("__df_content"));
        return !!host.shadowRoot.getElementById("__df_content").querySelector('[data-layer-id="lnew"]');
      }, frameId);
      if (got) { log(`[probe] ✓ lnew apareció en el DOM tras ${i + 1}s`); break; }
      if (i === 24) log("[probe] ✗ lnew NUNCA apareció en 25s");
    }
    log(`[probe] llamadas GET totales: ${apiCalls.length} ${JSON.stringify(apiCalls)}`);
  } finally {
    await deleteTemplate(templateId);
    await harness.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
