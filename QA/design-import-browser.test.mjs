import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { createServer } from "vite";
import puppeteer from "puppeteer-core";
import { jsPDF } from "jspdf";
import { createCanvas, ImageData } from "@napi-rs/canvas";
import { initializeCanvas, writePsdBuffer } from "ag-psd";

test("PDF and PDF-compatible Illustrator render every page with visible pixels", { timeout: 90000 }, async () => {
  const executablePath = process.env.CHROME_PATH || [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ].find(existsSync);
  assert.ok(executablePath, "Set CHROME_PATH to run the local browser test");
  const server = await createServer({ configFile: false, server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
  await server.listen();
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath, headless: true });
    const page = await browser.newPage();
    const uploads = [];
    const port = server.httpServer.address().port;
    // A blank same-origin page avoids the application and every provider/API.
    await page.setRequestInterception(true);
    page.on("request", request => {
      if (request.url().endsWith("/api/assets/upload")) {
        uploads.push(JSON.parse(request.postData()));
        return request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ url: "https://assets.invalid/persisted.png" }) });
      }
      if (request.url() === `http://127.0.0.1:${port}/test-blank`) return request.respond({ status: 200, contentType: "text/html", body: "<!doctype html><body></body>" });
      if (!request.url().startsWith(`http://127.0.0.1:${port}/`) && !request.url().startsWith("data:") && !request.url().startsWith("blob:")) return request.abort();
      return request.continue();
    });
    await page.goto(`http://127.0.0.1:${port}/test-blank`);
    const pdf = new jsPDF({ unit: "pt", format: [200, 100], orientation: "landscape" });
    pdf.setFillColor(255, 0, 0); pdf.rect(0, 0, 200, 100, "F");
    pdf.addPage(); pdf.setFillColor(0, 0, 255); pdf.rect(0, 0, 200, 100, "F");
    const bytes = Array.from(new Uint8Array(pdf.output("arraybuffer")));
    const result = await page.evaluate(async bytes => {
      const { importDesignFileResults } = await import("/src/lib/designImport.ts");
      const summaries = [];
      for (const extension of ["pdf", "ai"]) {
        const frames = await importDesignFileResults(new File([new Uint8Array(bytes)], `two.${extension}`, { type: "application/pdf" }));
        const colors = [];
        for (const frame of frames) {
          const image = new Image(); image.src = new DOMParser().parseFromString(frame.html, "text/html").querySelector("img").src;
          await image.decode();
          const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
          const context = canvas.getContext("2d"); context.drawImage(image, 0, 0, 1, 1);
          colors.push(Array.from(context.getImageData(0, 0, 1, 1).data));
        }
        summaries.push({ count: frames.length, reports: frames.map(f => f.report), colors });
      }
      return summaries;
    }, bytes);
    for (const summary of result) {
      assert.equal(summary.count, 2);
      assert.deepEqual(summary.reports, [{ editable: 0, approximate: 0, raster: 1 }, { editable: 0, approximate: 0, raster: 1 }]);
      assert.ok(summary.colors[0][0] > 240 && summary.colors[0][2] < 10);
      assert.ok(summary.colors[1][2] > 240 && summary.colors[1][0] < 10);
    }
    initializeCanvas(createCanvas, (w, h) => new ImageData(w, h));
    const canvas = createCanvas(20, 20); canvas.getContext("2d").fillRect(0, 0, 20, 20);
    const psd = writePsdBuffer({ width: 20, height: 20, canvas, children: [
      { name: "Visible", canvas, opacity: 1 }, { name: "Hidden", canvas, hidden: true },
    ] });
    const psdResult = await page.evaluate(async bytes => {
      const { importDesignFileResults } = await import("/src/lib/designImport.ts");
      const frames = await importDesignFileResults(new File([new Uint8Array(bytes)], "layers.psd"));
      return frames[0];
    }, Array.from(psd));
    assert.match(psdResult.html, /opacity:1;/);
    assert.doesNotMatch(psdResult.html, /Hidden/);
    assert.equal(psdResult.report.raster, 1);

    await page.evaluate(() => import("/QA/fixtures/designImportHarness.tsx"));
    await page.waitForSelector('dialog[open] input[type="file"]');
    await page.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 20;
      canvas.getContext("2d").fillRect(0, 0, 20, 20);
      const bytes = Uint8Array.from(atob(canvas.toDataURL("image/png").split(",")[1]), c => c.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], "one.png", { type: "image/png" }));
      transfer.items.add(new File([bytes], "two.png", { type: "image/png" }));
      const input = document.querySelector('input[type="file"]'); input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => window.importedFrames.length === 2);
    const imported = await page.evaluate(() => window.importedFrames);
    assert.equal(uploads.length, 2);
    for (const frame of imported) {
      assert.doesNotMatch(frame.html, /data:image/);
      assert.match(frame.html, /https:\/\/assets.invalid\/persisted.png/);
    }
  } finally { await browser?.close(); await server.close(); }
});
