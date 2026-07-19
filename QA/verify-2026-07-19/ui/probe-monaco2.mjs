/** Sonda 2: ¿cómo entra texto en el Monaco del CodePanel? */
import { EditorHarness, createVerifyTemplate, deleteTemplate, log, sleep, shot } from "./lib.mjs";

const HTML = '<div data-layer-id="box" data-layer-name="Box" style="position:absolute;left:10px;top:10px;width:100px;height:100px;background:#EF4444;"></div>';

async function main() {
  const harness = new EditorHarness();
  await harness.start();
  const { templateId, frameId } = await createVerifyTemplate("monacoprobe2", { html: HTML });
  try {
    await harness.open(templateId, frameId);
    await harness.settle(200);
    await harness.qa("key", "keydown", "/", { ctrlKey: true });
    await harness.page.waitForFunction(() => document.querySelector(".monaco-editor"), { timeout: 25000 });
    await sleep(700);

    const info0 = await harness.page.evaluate(() => {
      const eds = [...document.querySelectorAll(".monaco-editor")];
      return eds.map(e => ({ visible: e.offsetParent !== null, aria: e.getAttribute("aria-label") || "", dataUri: (e.getAttribute("data-uri") || "").slice(-30) }));
    });
    log(`[m2] editores: ${JSON.stringify(info0)}`);

    // click REAL con CDP en el centro de view-lines
    const pt = await harness.page.evaluate(() => {
      const ed = [...document.querySelectorAll(".monaco-editor")].find(e => e.offsetParent !== null);
      const r = ed.querySelector(".view-lines").getBoundingClientRect();
      return { x: r.left + 60, y: r.top + 12 };
    });
    await harness.page.mouse.click(pt.x, pt.y);
    await sleep(200);
    log(`[m2] activeElement tras click real: ${await harness.page.evaluate(() => document.activeElement?.tagName + "/" + document.activeElement?.className)}`);

    await harness.page.keyboard.type("HELLOQA", { delay: 15 });
    await sleep(400);
    const after = await harness.page.evaluate(() => {
      const ed = [...document.querySelectorAll(".monaco-editor")].find(e => e.offsetParent !== null);
      const ta = ed?.querySelector("textarea");
      return {
        viewText: ed?.querySelector(".view-lines")?.textContent.slice(0, 80) || null,
        taValue: ta ? ta.value.slice(0, 40) : null,
        hasWindowMonaco: typeof window.monaco !== "undefined",
      };
    });
    log(`[m2] tras teclear: ${JSON.stringify(after)}`);
    await shot(harness.page, "probe-monaco-typing");
  } finally {
    await deleteTemplate(templateId);
    await harness.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
