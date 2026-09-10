import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { createServer } from "vite";
import puppeteer from "puppeteer-core";

const importedDocument = {
  version: "futuraria-import/v1", name: "Fonts", source: "figma", warnings: [], report: { editable: 1, approximate: 0, raster: 0 },
  fonts: { used: ["Unavailable Sans", "Unavailable Serif"], missing: ["Unavailable Sans", "Unavailable Serif"] },
  artboards: [{ id: "a", name: "a", width: 200, height: 100, background: "#fff", layers: [{ id: "t", name: "Title", kind: "text", x: 0, y: 0, width: 100, height: 30, fidelity: "editable", fontFamilies: ["Unavailable Sans", "Unavailable Serif"], html: '<span data-figma-font="Unavailable Sans" style="font-family:&quot;Unavailable Sans&quot;">Title</span><span data-figma-font="Unavailable Serif" style="font-family:&quot;Unavailable Serif&quot;"> subtitle</span>' }] }],
};

test("Figma import blocks insertion until every missing font is replaced and cancel remains atomic", { timeout: 90_000 }, async () => {
  const executablePath = process.env.CHROME_PATH || ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
  assert.ok(executablePath);
  const server = await createServer({ configFile: false, server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
  await server.listen();
  const browser = await puppeteer.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(10_000);
    const port = server.httpServer.address().port;
    await page.setRequestInterception(true);
    page.on("request", request => {
      const url = request.url();
      if (url.includes("/api/design-imports/figma/scan")) return request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { id: "figma-job", status: "ready", progress: 5, result: { frames: [{ id: "1:1", name: "Cover", width: 200, height: 100 }] } } }) });
      if (url.includes("/figma-selection")) return request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { id: "figma-job", status: "analyzing", progress: 10 } }) });
      if (url.includes("/figma-batch")) return request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { id: "figma-job", status: "ready", progress: 100, result: importedDocument } }) });
      if (url.includes("/api/fonts/custom")) return request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { fonts: [] } }) });
      if (url.includes("/api/fonts/catalog")) return request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { fonts: [{ family: "Arial", category: "sans-serif", variants: ["regular", "700"], source: "system", stack: "Arial, Helvetica, sans-serif" }], total: 1, live: true } }) });
      if (url === `http://127.0.0.1:${port}/blank`) return request.respond({ status: 200, contentType: "text/html", body: "<!doctype html><body></body>" });
      return request.continue();
    });
    const openHarness = async () => {
      await page.goto(`http://127.0.0.1:${port}/blank`);
      await page.evaluate(() => import("/QA/fixtures/designImportHarness.tsx"));
      await page.waitForSelector("dialog[open]");
      await page.type("#figma-design-url", "https://www.figma.com/design/abc/Test");
      await page.evaluate(() => [...document.querySelectorAll("button")].find(button => button.textContent === "Ver frames").click());
      await page.waitForFunction(() => document.body.textContent.includes("Frames del archivo"));
      await page.evaluate(() => [...document.querySelectorAll("button")].find(button => button.textContent === "Importar 1 frame").click());
      await page.waitForFunction(() => document.body.textContent.includes("Fuentes que necesitan reemplazo"));
    };
    await openHarness();
    assert.equal(await page.evaluate(() => window.importedFrames.length), 0);
    assert.match(await page.evaluate(() => document.querySelector("details").textContent), /no impone hoy un máximo numérico de frames/);
    assert.match(await page.evaluate(() => document.querySelector("details").textContent), /1 solicitud Tier 1/);
    assert.match(await page.evaluate(() => document.querySelector("details").textContent), /32 megapíxeles/);
    assert.equal(await page.evaluate(() => document.querySelectorAll('[id^="font-error-"]').length), 2);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('button[aria-label^="Reemplazo para"]')].every(button => Boolean(button.getAttribute("aria-describedby")))), true);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll("button")].find(button => button.textContent === "Aplicar e importar").disabled), true);
    for (let index = 0; index < 2; index++) {
      await page.evaluate(index => [...document.querySelectorAll('button[aria-label^="Reemplazo para"]')][index].click(), index);
      await new Promise(resolve => setTimeout(resolve, 300));
      const pickerText = await page.evaluate(() => document.body.textContent);
      assert.match(pickerText, /Arial/);
      await page.evaluate(() => [...document.querySelectorAll("span")].find(element => element.textContent === "Arial").parentElement.click());
      assert.equal(await page.evaluate(() => [...document.querySelectorAll("button")].find(button => button.textContent === "Aplicar e importar").disabled), index === 0);
    }
    await page.evaluate(() => { const button = [...document.querySelectorAll("button")].find(item => item.textContent === "Aplicar e importar"); button.click(); button.click(); });
    await page.waitForFunction(() => window.importedFrames.length === 1);
    const imported = await page.evaluate(() => window.importedFrames[0]);
    assert.match(imported.html, /font-family:Arial, Helvetica, sans-serif/);
    assert.doesNotMatch(imported.html, /Unavailable (?:Sans|Serif)/);

    await openHarness();
    await page.evaluate(() => [...document.querySelectorAll("section button")].find(button => button.textContent === "Cancelar").click());
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await page.evaluate(() => window.importedFrames.length), 0);
  } finally { await browser.close(); await server.close(); }
});
