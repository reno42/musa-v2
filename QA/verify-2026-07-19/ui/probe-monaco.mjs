/** Sonda: rellenar el Monaco del CodePanel con keyboard.insertText (CDP). */
import { EditorHarness, createVerifyTemplate, deleteTemplate, log, sleep } from "./lib.mjs";

const HTML = '<div data-layer-id="box" data-layer-name="Box" style="position:absolute;left:10px;top:10px;width:100px;height:100px;background:#EF4444;"></div>';
const NEW_HTML = '<div data-layer-id="zzprobe" data-layer-name="Z" style="position:absolute;left:50px;top:50px;width:80px;height:80px;background:#22C55E;"></div>\n' + HTML;

async function main() {
  const harness = new EditorHarness();
  await harness.start();
  const { templateId, frameId } = await createVerifyTemplate("monacoprobe", { html: HTML });
  try {
    await harness.open(templateId, frameId);
    await harness.settle(200);
    await harness.qa("key", "keydown", "/", { ctrlKey: true });
    await harness.page.waitForFunction(() => document.querySelector(".monaco-editor"), { timeout: 25000 });
    await sleep(700);

    await harness.page.evaluate(() => {
      const ed = [...document.querySelectorAll(".monaco-editor")].find(e => e.offsetParent !== null);
      const lines = ed?.querySelector(".view-lines");
      if (lines) {
        const r = lines.getBoundingClientRect();
        lines.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: r.left + 40, clientY: r.top + 12 }));
        lines.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: r.left + 40, clientY: r.top + 12 }));
      }
      ed?.querySelector("textarea")?.focus();
    });
    await sleep(150);
    await page_selectAll(harness.page);
    await sleep(150);
    log(`[monaco] activeElement: ${await harness.page.evaluate(() => document.activeElement?.tagName + "/" + (document.activeElement?.className || ""))}`);
    const cdp = await harness.page.createCDPSession();
    await cdp.send("Input.insertText", { text: NEW_HTML });
    await sleep(1200);

    const inFrame = await harness.page.evaluate((fid) => {
      const wrapper = document.querySelector(`[data-frame-id="${fid}"]`);
      const host = [...wrapper.querySelectorAll("div")].find(el => el.shadowRoot && el.shadowRoot.getElementById("__df_content"));
      return host.shadowRoot.getElementById("__df_content").innerHTML.includes("zzprobe");
    }, frameId);
    const viewText = await harness.page.evaluate(() => {
      const ed = [...document.querySelectorAll(".monaco-editor")].find(e => e.offsetParent !== null);
      return ed?.querySelector(".view-lines")?.textContent.slice(0, 120) || null;
    });
    log(`[monaco] view-lines empieza: ${JSON.stringify(viewText)}`);
    log(`[monaco] zzprobe en frame DOM: ${inFrame}`);
  } finally {
    await deleteTemplate(templateId);
    await harness.close();
  }
}

async function page_selectAll(page) {
  await page.keyboard.down("Control");
  await page.keyboard.press("a");
  await page.keyboard.up("Control");
}

main().catch(e => { console.error(e); process.exit(1); });
