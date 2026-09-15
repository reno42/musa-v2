import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { createServer } from "vite";
import puppeteer from "puppeteer-core";
import { jsPDF } from "jspdf";
import { createCanvas, ImageData } from "@napi-rs/canvas";
import { initializeCanvas, writePsdBuffer } from "ag-psd";

test("PDF, layered OCG and legacy .ai import through the shared pipeline", { timeout: 120000 }, async () => {
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
    // PDF with text + shapes: operators walk into editable layers (no raster).
    const pdf = new jsPDF({ unit: "pt", format: [200, 100], orientation: "landscape" });
    pdf.setFillColor(255, 0, 0); pdf.rect(10, 10, 80, 60, "F");
    pdf.setFont("helvetica"); pdf.setFontSize(24); pdf.setTextColor(0, 0, 0);
    pdf.text("Hola Musa", 20, 30);
    pdf.addPage(); pdf.setFillColor(0, 0, 255); pdf.rect(20, 20, 100, 50, "F");
    const pdfResult = await page.evaluate(async bytes => {
      const { importDesignFileResults } = await import("/src/lib/designImport.ts");
      const frames = await importDesignFileResults(new File([new Uint8Array(bytes)], "layers.pdf", { type: "application/pdf" }));
      const texts = [];
      for (const frame of frames) {
        const doc = new DOMParser().parseFromString(frame.html, "text/html");
        for (const el of doc.querySelectorAll('[data-layer-kind="text"]')) {
          texts.push({ text: el.textContent, family: el.style.fontFamily, size: el.style.fontSize });
        }
      }
      return {
        reports: frames.map(frame => frame.report),
        rasterized: frames.some(frame => frame.html.includes("data:image")),
        redVectors: frames.filter(frame => frame.html.includes('fill="#ff0000"')).length,
        texts,
      };
    }, Array.from(new Uint8Array(pdf.output("arraybuffer"))));
    assert.deepEqual(pdfResult.reports, [{ editable: 2, approximate: 0, raster: 0 }, { editable: 1, approximate: 0, raster: 0 }]);
    assert.ok(!pdfResult.rasterized, "PDF pages must import editable instead of rasterizing");
    assert.equal(pdfResult.redVectors, 1);
    assert.ok(
      pdfResult.texts.some(t => t.text === "Hola Musa" && /Helvetica/.test(t.family) && t.size === "24px"),
      `text layers: ${JSON.stringify(pdfResult.texts)}`,
    );

    // Handcrafted layered PDF: /OCProperties + BDC/EMC become a named group layer.
    const stream = "/OC /MC0 BDC\nq 1 0 0 rg 10 10 50 50 re f Q\nEMC\nBT /F1 12 Tf 20 80 Td (Hola AI) Tj ET";
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [4 0 R] /D << /ON [4 0 R] >> >> >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 5 0 R >> /Properties << /MC0 4 0 R >> >> /Contents 6 0 R >>",
      "<< /Type /OCG /Name (Fondo) >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    ];
    let crafted = "%PDF-1.7\n";
    const offsets = [];
    objects.forEach((body, index) => {
      offsets.push(crafted.length);
      crafted += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xrefOffset = crafted.length;
    crafted += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) crafted += `${String(offset).padStart(10, "0")} 00000 n \n`;
    crafted += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    const ocgResult = await page.evaluate(async bytes => {
      const { importDesignFileResults } = await import("/src/lib/designImport.ts");
      const frames = await importDesignFileResults(new File([new Uint8Array(bytes)], "layers-ocg.pdf", { type: "application/pdf" }));
      const frame = frames[0];
      if (!frame) return null;
      const doc = new DOMParser().parseFromString(frame.html, "text/html");
      const group = doc.querySelector('[data-layer-kind="group"]');
      const text = [...doc.querySelectorAll('[data-layer-kind="text"]')].find(el => el.textContent === "Hola AI");
      return {
        report: frame.report,
        groupName: group?.getAttribute("data-layer-name") ?? null,
        redInsideGroup: (group?.innerHTML ?? "").includes('fill="#ff0000"'),
        text: text ? { left: parseFloat(text.style.left), top: parseFloat(text.style.top), size: text.style.fontSize, family: text.style.fontFamily } : null,
      };
    }, Array.from(new TextEncoder().encode(crafted)));
    assert.ok(ocgResult, "layered PDF produced no frame");
    assert.deepEqual(ocgResult.report, { editable: 3, approximate: 0, raster: 0 });
    assert.equal(ocgResult.groupName, "Fondo");
    assert.ok(ocgResult.redInsideGroup, "OCG group must contain the red vector");
    assert.ok(ocgResult.text, "text outside the OCG must stay a top-level editable layer");
    assert.equal(ocgResult.text.size, "12px");
    assert.equal(ocgResult.text.left, 20);
    assert.ok(Math.abs(ocgResult.text.top - 9.8) < 0.6, `text top ${ocgResult.text.top}`);
    assert.ok(/Helvetica/.test(ocgResult.text.family));

    // Legacy .ai (%!PS-Adobe, no PDF): honest raster preview with a warning.
    const previewCanvas = createCanvas(4, 4);
    previewCanvas.getContext("2d").fillRect(0, 0, 4, 4);
    const legacyAi = Buffer.concat([
      Buffer.from("%!PS-Adobe-3.0 EPSF-3.0\n%%Creator: Adobe Illustrator(R) 24.3\n%%BoundingBox: 0 0 4 4\n"),
      previewCanvas.toBuffer("image/jpeg"),
    ]);
    const aiResult = await page.evaluate(async bytes => {
      const { importDesignFileResults } = await import("/src/lib/designImport.ts");
      const frames = await importDesignFileResults(new File([new Uint8Array(bytes)], "legacy.ai", { type: "application/postscript" }));
      return frames[0] ? { report: frames[0].report, html: frames[0].html, warning: frames[0].warning } : null;
    }, Array.from(legacyAi));
    assert.ok(aiResult, "legacy .ai produced no frame");
    assert.deepEqual(aiResult.report, { editable: 0, approximate: 0, raster: 1 });
    assert.match(aiResult.warning || "", /vista previa/i);
    assert.match(aiResult.html, /src="data:image\/jpeg/);

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
