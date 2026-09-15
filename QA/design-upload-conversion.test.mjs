import assert from "node:assert/strict";
import test from "node:test";
import { createCanvas, ImageData } from "@napi-rs/canvas";
import { initializeCanvas, writePsdBuffer } from "ag-psd";
import { jsPDF } from "jspdf";
import { convertDesignUpload } from "../api/src/services/designUploadConversion.ts";
import { importFigmaUrl } from "../api/src/services/designImports.ts";

test("server conversion renders PDF/AI pages and PSD composite", async () => {
  const pdf = new jsPDF({ unit: "pt", format: [100, 100] });
  pdf.setFillColor(255, 0, 0); pdf.rect(0, 0, 100, 100, "F"); pdf.addPage();
  const pdfBytes = Buffer.from(pdf.output("arraybuffer"));
  for (const source of ["pdf", "ai"]) {
    const converted = await convertDesignUpload(pdfBytes, source, "Test");
    assert.equal(converted.artboards.length, 2);
    assert.deepEqual(converted.report, { editable: 0, approximate: 0, raster: 2 });
    assert.match(converted.artboards[0].layers[0].html, /data:image\/png;base64,/);
  }
  initializeCanvas(createCanvas, (w, h) => new ImageData(w, h));
  const canvas = createCanvas(20, 20);
  canvas.getContext("2d").fillRect(0, 0, 20, 20);
  const psd = writePsdBuffer({ width: 20, height: 20, canvas, children: [] });
  const converted = await convertDesignUpload(psd, "psd", "Photoshop");
  assert.equal(converted.report.raster, 1);
  assert.equal(converted.artboards[0].width, 20);
  await assert.rejects(convertDesignUpload(Buffer.from("not a PDF"), "ai", "bad"), /compatibilidad PDF/);
  await assert.rejects(convertDesignUpload(Buffer.from("not a PSD"), "psd", "bad"), /PSD inválido/);
});

test("Figma selection imports an editable leaf with private token only sent to Figma API", async () => {
  const node = { id: "1:2", type: "RECTANGLE", name: "Square", absoluteBoundingBox: { x: 10, y: 20, width: 100, height: 50 } };
  const calls = [];
  const fetchMock = async (url, options) => {
    calls.push({ url, options });
    if (url.includes("/files/")) return Response.json({ name: "Design", document: { children: [{ children: [node] }] } });
    if (url.includes("/images/")) return Response.json({ images: { "1:2": "https://cdn.example/export.svg" } });
    return new Response('<svg width="100" height="50"><rect width="100" height="50" fill="red"/></svg>', { headers: { "content-type": "image/svg+xml" } });
  };
  const document = await importFigmaUrl("https://www.figma.com/design/abc/Design?node-id=1-2", "secret-test-token", fetchMock);
  assert.equal(document.artboards[0].layers.length, 1);
  assert.equal(document.artboards[0].layers[0].fidelity, "editable");
  assert.doesNotMatch(JSON.stringify(document), /secret-test-token/);
  assert.equal(calls[0].options.headers["X-Figma-Token"], "secret-test-token");
  // The token may only travel to Figma hosts, never to a CDN download.
  for (const call of calls) {
    const isFigmaHost = /^https:\/\/([\w-]+\.)?figma\.com\//.test(String(call.url));
    assert.ok(isFigmaHost || !call.options?.headers?.["X-Figma-Token"], "el token no debe salir del dominio de Figma");
  }
});
