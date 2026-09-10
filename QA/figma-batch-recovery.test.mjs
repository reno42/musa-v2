import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { createServer } from "vite";
import puppeteer from "puppeteer-core";

const executablePath = process.env.CHROME_PATH || ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
const importedDocument = {
  version: "futuraria-import/v1", name: "Batch", source: "figma", warnings: [], report: { editable: 1, approximate: 0, raster: 0 }, fonts: { used: [], missing: [] },
  artboards: [{ id: "frame-1", name: "First", width: 200, height: 100, background: "#fff", layers: [{ id: "layer", name: "Layer", kind: "vector", x: 0, y: 0, width: 10, height: 10, fidelity: "editable", html: "<div />" }] }],
};

function success(data, status = 200) {
  return { status, contentType: "application/json", body: JSON.stringify({ success: true, data }) };
}

async function openImport(page, port) {
  await page.goto(`http://127.0.0.1:${port}/blank`);
  await page.evaluate(() => import("/QA/fixtures/designImportHarness.tsx"));
  await page.waitForSelector("dialog[open]");
  await page.type("#figma-design-url", "https://www.figma.com/design/abc/Batch");
  await page.evaluate(() => [...document.querySelectorAll("button")].find(button => button.textContent === "Ver frames").click());
  await page.waitForFunction(() => document.body.textContent.includes("Frames del archivo"));
  await page.evaluate(() => [...document.querySelectorAll("button")].find(button => button.textContent === "Importar 1 frame").click());
}

test("a permanent Figma batch 400 is shown once instead of being polled forever", { timeout: 90_000 }, async () => {
  assert.ok(executablePath);
  const server = await createServer({ configFile: false, server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
  await server.listen();
  const browser = await puppeteer.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(10_000);
    const port = server.httpServer.address().port;
    let batches = 0;
    let statusReads = 0;
    await page.setRequestInterception(true);
    page.on("request", request => {
      const url = request.url();
      if (url.includes("/figma/scan")) return request.respond(success({ id: "job", status: "ready", progress: 5, result: { frames: [{ id: "1:1", name: "First", width: 200, height: 100 }] } }));
      if (url.includes("/figma-selection")) return request.respond(success({ id: "job", status: "analyzing", progress: 10 }));
      if (url.includes("/figma-batch")) { batches++; return request.respond({ status: 400, contentType: "application/json", body: JSON.stringify({ success: false, error: "Una capa de Figma supera el límite de 5 MB." }) }); }
      if (url.includes("/api/design-imports/jobs/job?")) { statusReads++; return request.respond(success({ id: "job", status: "error", error: "Una capa de Figma supera el límite de 5 MB." })); }
      if (url === `http://127.0.0.1:${port}/blank`) return request.respond({ status: 200, contentType: "text/html", body: "<!doctype html><body></body>" });
      return request.continue();
    });
    await openImport(page, port);
    await page.waitForFunction(() => document.body.textContent.includes("Una capa de Figma supera el límite de 5 MB."));
    await new Promise(resolve => setTimeout(resolve, 1_500));
    assert.equal(batches, 1);
    assert.equal(statusReads, 0);
    assert.equal(await page.evaluate(() => window.importedFrames.length), 0);
  } finally { await browser.close(); await server.close(); }
});

test("a 202 batch response continues from the persisted completed frames", { timeout: 90_000 }, async () => {
  assert.ok(executablePath);
  const server = await createServer({ configFile: false, server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
  await server.listen();
  const browser = await puppeteer.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(10_000);
    const port = server.httpServer.address().port;
    let batches = 0;
    await page.setRequestInterception(true);
    page.on("request", request => {
      const url = request.url();
      if (url.includes("/figma/scan")) return request.respond(success({ id: "job", status: "ready", progress: 5, result: { frames: [{ id: "1:1", name: "First", width: 200, height: 100 }] } }));
      if (url.includes("/figma-selection")) return request.respond(success({ id: "job", status: "analyzing", progress: 10 }));
      if (url.includes("/figma-batch")) {
        batches++;
        return request.respond(batches === 1
          ? success({ id: "job", status: "analyzing", progress: 95, result: { completedIds: ["1:1"] } }, 202)
          : success({ id: "job", status: "ready", progress: 100, result: importedDocument }));
      }
      if (url === `http://127.0.0.1:${port}/blank`) return request.respond({ status: 200, contentType: "text/html", body: "<!doctype html><body></body>" });
      return request.continue();
    });
    await openImport(page, port);
    await page.waitForFunction(() => window.importedFrames.length === 1);
    assert.equal(batches, 2);
  } finally { await browser.close(); await server.close(); }
});
