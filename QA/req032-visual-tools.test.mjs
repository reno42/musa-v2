// QA/req032-visual-tools.test.mjs — REQ-032 (tools de verificación visual para
// agentes): contratos de los 3 tools nuevos. mcp.mjs y render.mjs corren en el
// worker (no bajo node:test), así que los contratos se afirman sobre el source
// (convención del repo: crm-inbox-capture / css-mutations) y la matemática
// pura (text_metrics, diff de bloques) se testea de verdad importándola.
// Corre con:
//   node --experimental-strip-types --test QA/req032-visual-tools.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const mcp = readFileSync(ROOT + "netlify/functions/mcp.mjs", "utf8");
const render = readFileSync(ROOT + "netlify/functions/render.mjs", "utf8");

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `no se encontró el marcador de inicio: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end !== -1, `no se encontró el marcador de fin: ${endMarker}`);
  return source.slice(start, end);
}

// ── Tool 1 — render_frame_png ───────────────────────────────────────────────

test("render_frame_png: registrado en MCP_TOOLS con schema honesto", () => {
  const entry = sourceSlice(mcp, 'name: "render_frame_png"', "name: \"export_frame\"");
  assert.match(entry, /captureUrl/);
  assert.match(entry, /SEE their own work before declaring done/);
  assert.match(entry, /required: \["templateId", "frameId"\]/);
});

test("render_frame_png: el handler arma captureUrl del pipeline EXISTENTE y no finge rasterizar", () => {
  const block = sourceSlice(mcp, 'case "render_frame_png":', "case \"optimize_image\"");
  // Reusa la página de captura de render.mjs con upload=1 (cero renderer nuevo)
  assert.match(block, /templates\.getTemplate\(params\.templateId\)/);
  assert.match(block, /getApiKey\(event\)/);
  assert.match(block, /\/api\/render\/\$\{encodeURIComponent\(params\.templateId\)\}\/frame\//);
  assert.match(block, /upload: "1"/);
  // Contrato de honestidad: el server NO inventa un PNG sincrónico — sin
  // storage directo en el case (eso sería fingir un raster que no ejecutó).
  assert.doesNotMatch(block, /createSignedUrl/);
  // pasos + nota honesta para el agente
  assert.match(block, /steps: \[/);
  assert.match(block, /does not fake one/);
});

test("render_frame_png: la página de captura sube vía /mcp upload_image y muestra el JSON", () => {
  // El frame GET arma el modo capture cuando upload=1 (?key= — convención del video)
  assert.match(render, /qs\.upload === "1"/);
  assert.match(render, /includeBase64: qs\.base64 === "1"/);
  assert.match(render, /buildRenderPageHtml\(frameTpl, width, height, format, scale, templateId \+ "_" \+ frameId, capture\)/);
  // La página inyecta CAPTURE y sube por el MISMO tool upload_image (cero
  // endpoints nuevos, mismo pipeline de assets firmados)
  assert.match(render, /var CAPTURE = /);
  assert.match(render, /name: 'upload_image'/);
  assert.match(render, /upload-result/);
  // El flujo normal de descarga sigue intacto cuando no hay modo asset
  assert.match(render, /if \(CAPTURE\) \{ window\.__uploadPng\(\); return; \}/);
  assert.match(render, /Preparing download/);
});
