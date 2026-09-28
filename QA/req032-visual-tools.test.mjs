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
import { parseFontMetrics, measureTextBox, FontMetricsError } from "../netlify/functions/textMetrics.mjs";
import { diffFrames } from "../netlify/functions/frameDiff.mjs";

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

// ── Tool 2 — text_metrics ─────────────────────────────────────────────

/** Sintetiza un TTF mínimo REAL (4 glifos: .notdef, A, B, space) para
 *  testear el parser de verdad — no un mock. Advances: 500/600/600/250,
 *  unitsPerEm 1000, cmap formato 4 con 3 segmentos + sentinel 0xFFFF. */
function buildSyntheticTtf() {
  const w16 = (a, o, v) => { a[o] = (v >> 8) & 0xff; a[o + 1] = v & 0xff; };
  const w32 = (a, o, v) => { a[o] = (v >>> 24) & 0xff; a[o + 1] = (v >>> 16) & 0xff; a[o + 2] = (v >>> 8) & 0xff; a[o + 3] = v & 0xff; };

  const head = new Uint8Array(54);
  w32(head, 0, 0x00010000); w32(head, 12, 0x5f0f3cf5); w16(head, 18, 1000); // unitsPerEm
  const hhea = new Uint8Array(36);
  w16(hhea, 34, 4); // numberOfHMetrics
  const maxp = new Uint8Array(6);
  w16(maxp, 4, 4); // numGlyphs
  const hmtx = new Uint8Array(16); // .notdef=500, A=600, B=600, space=250
  [500, 600, 600, 250].forEach((a, i) => w16(hmtx, i * 4, a));

  // cmap (3,1) formato 4: gids space=3, A=1, B=2 vía idDelta; idRangeOffset=0
  const segCount = 3;
  const subLen = 14 + segCount * 8 + 2;
  const cmap = new Uint8Array(12 + subLen);
  w16(cmap, 2, 1); // numTables
  w16(cmap, 4, 3); w16(cmap, 6, 1); w32(cmap, 8, 12);
  const s = 12;
  w16(cmap, s, 4); w16(cmap, s + 2, subLen);
  w16(cmap, s + 6, segCount * 2); w16(cmap, s + 8, 4); w16(cmap, s + 10, 1); w16(cmap, s + 12, 2);
  [32, 66, 0xffff].forEach((v, i) => w16(cmap, s + 14 + i * 2, v)); // endCode
  // reservedPad @ s+20 queda en 0
  [32, 65, 0xffff].forEach((v, i) => w16(cmap, s + 22 + i * 2, v)); // startCode
  [(3 - 32) & 0xffff, (1 - 65) & 0xffff, (2 - 66) & 0xffff].forEach((v, i) => w16(cmap, s + 28 + i * 2, v)); // idDelta
  // idRangeOffset=0 (ceros)

  const tables = [["cmap", cmap], ["head", head], ["hhea", hhea], ["hmtx", hmtx], ["maxp", maxp]];
  let off = 12 + tables.length * 16;
  const placed = tables.map(([tag, data]) => {
    const o = off; off += data.length + ((4 - (data.length % 4)) % 4);
    return [tag, data, o];
  });
  const font = new Uint8Array(off);
  w32(font, 0, 0x00010000); w16(font, 4, tables.length);
  w16(font, 6, 64); w16(font, 8, 2); w16(font, 10, 16);
  placed.forEach(([tag, data, o], i) => {
    const rec = 12 + i * 16;
    for (let k = 0; k < 4; k++) font[rec + k] = tag.charCodeAt(k);
    w32(font, rec + 8, o); w32(font, rec + 12, data.length);
    font.set(data, o);
  });
  return font;
}

const synFont = parseFontMetrics(buildSyntheticTtf());

test("text_metrics: el parser TTF es real — advances vía cmap format 4 + hmtx", () => {
  assert.equal(synFont.unitsPerEm, 1000);
  assert.equal(synFont.codepointWidth(65), 600); // A
  assert.equal(synFont.codepointWidth(66), 600); // B
  assert.equal(synFont.codepointWidth(32), 250); // espacio
  assert.ok(synFont.hasGlyph(65));
  assert.ok(!synFont.hasGlyph(90)); // Z no existe en la fuente
});

test("text_metrics: wrap por palabras y altura con lineHeight", () => {
  const wide = measureTextBox({ text: "A B", font: synFont, fontSize: 100, boxWidth: 1000 });
  assert.equal(wide.lines, 1);
  assert.equal(wide.renderedWidth, 145); // (600+250+600)/1000*100
  assert.equal(wide.renderedHeight, 120); // 1 línea × 1.2 × 100
  assert.equal(wide.overflows, false);

  // El wrap rompe entre palabras (como CSS) — una sola palabra jamás se parte
  const wrapped = measureTextBox({ text: "A B", font: synFont, fontSize: 100, boxWidth: 70 });
  assert.equal(wrapped.lines, 2); // "A" / "B"
  assert.equal(wrapped.renderedWidth, 60);
  assert.equal(wrapped.renderedHeight, 240);
});

test("text_metrics: suggestedFontSize es el mayor ENTERO que cabe, verificado re-midiendo", () => {
  // Desborde por altura: "A B" sigue en 2 líneas hasta s=83 (2×1.2×83=199.2)
  const over = measureTextBox({ text: "A B", font: synFont, fontSize: 100, boxWidth: 70, boxHeight: 200 });
  assert.equal(over.overflows, true);
  assert.equal(over.suggestedFontSize, 83);
  const at83 = measureTextBox({ text: "A B", font: synFont, fontSize: 83, boxWidth: 70, boxHeight: 200 });
  assert.equal(at83.overflows, false); // identidad: lo sugerido sí cabe
  const at84 = measureTextBox({ text: "A B", font: synFont, fontSize: 84, boxWidth: 70, boxHeight: 200 });
  assert.equal(at84.overflows, true); // y +1 ya no (2×1.2×84=201.6)

  // Desborde por ancho de palabra única: 1.2 × s ≤ 90 → s = 75
  const single = measureTextBox({ text: "AB", font: synFont, fontSize: 100, boxWidth: 90 });
  assert.equal(single.overflows, true);
  assert.equal(single.suggestedFontSize, 75);
});

test("text_metrics: letter-spacing por carácter y \\n manuales", () => {
  const ls = measureTextBox({ text: "A", font: synFont, fontSize: 100, letterSpacing: 10 });
  assert.equal(ls.renderedWidth, 70); // 60 + 1×10
  const manual = measureTextBox({ text: "A\nB", font: synFont, fontSize: 100, boxWidth: 1000 });
  assert.equal(manual.lines, 2);
  assert.equal(manual.renderedHeight, 240);
});

test("text_metrics: rechaza wOFF/wOF2 con mensaje accionable", () => {
  const enc = (tag) => new TextEncoder().encode(tag + "\0".repeat(16));
  assert.throws(() => parseFontMetrics(enc("wOFF")), (e) => e instanceof FontMetricsError && /WOFF not supported/.test(e.message));
  assert.throws(() => parseFontMetrics(enc("wOF2")), (e) => e instanceof FontMetricsError && /WOFF2/.test(e.message));
  assert.throws(() => parseFontMetrics(new TextEncoder().encode("nope")), FontMetricsError);
});

test("text_metrics: registrado en MCP_TOOLS con la prohibición de autofit", () => {
  const entry = sourceSlice(mcp, 'name: "text_metrics"', 'name: "export_frame"');
  assert.match(entry, /PROHIBIDO autofit/);
  assert.match(entry, /suggestedFontSize/);
  assert.match(entry, /required: \["text", "fontSize"\]/);
  // El import del módulo de métricas existe en mcp.mjs
  assert.match(mcp, /import \{ parseFontMetrics, measureTextBox, loadFontFromUrl, FontMetricsError \} from "\.\/textMetrics\.mjs";/);
});

test("text_metrics: el handler resuelve fontUrl → custom_fonts y mide de verdad", () => {
  const block = sourceSlice(mcp, 'case "text_metrics":', 'case "optimize_image"');
  // Resolución: fontUrl → loadFontFromUrl; fontFamily → custom_fonts + bucket
  assert.match(block, /loadFontFromUrl\(params\.fontUrl\)/);
  assert.match(block, /from\("custom_fonts"\)/);
  assert.match(block, /from\("custom-fonts"\)/);
  assert.match(block, /\.download\(row\.storage_path\)/);
  // Medición real + cache de binarios parseados
  assert.match(block, /measureTextBox\(/);
  assert.match(block, /__tmFontCache/);
  assert.match(block, /fontResolved/);
  // Error honesto cuando no hay fuente (nada de medir "a ojo")
  assert.match(block, /No font to measure against/);
  // La decisión de producto, documentada en la respuesta
  assert.match(block, /never auto-fits text at render time/);
});

// ── Tool 3 — diff_overlay ─────────────────────────────────────────────

function solidImg(w, h, r, g, b) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255; }
  return { data, width: w, height: h };
}

function stripesImg(w, h, shift) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = ((x + shift) % 4) < 2 ? 30 : 220;
      const i = (y * w + x) * 4;
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

test("diff_overlay: render vs sí mismo → divergentAreaPct = 0 (DoD del REQ)", () => {
  const img = stripesImg(64, 64, 0);
  const res = diffFrames(img, img, { block: 32 });
  assert.equal(res.divergentAreaPct, 0);
  assert.deepEqual(res.topDivergences, []);
});

test("diff_overlay: bloques 32px, umbral 12% default y normalización de tamaños", () => {
  const red = solidImg(64, 64, 255, 0, 0);
  const blue = solidImg(64, 64, 0, 0, 255);
  const res = diffFrames(red, blue, { block: 32, threshold: 0.12 });
  assert.equal(res.block, 32);
  assert.equal(res.threshold, 0.12);
  assert.equal(res.divergentAreaPct, 100);
  assert.equal(res.topDivergences.length, 1);
  assert.deepEqual(
    [res.topDivergences[0].x, res.topDivergences[0].y, res.topDivergences[0].w, res.topDivergences[0].h],
    [0, 0, 64, 64],
  );
  // Umbral 1 → ningún bloque divergente aunque el diff sea total
  assert.equal(diffFrames(red, blue, { block: 32, threshold: 1 }).divergentAreaPct, 0);
  // Tamaños distintos → normaliza al mínimo común vía nearest-neighbor
  const mixed = diffFrames(red, solidImg(32, 32, 0, 0, 255), { block: 32 });
  assert.equal(mixed.width, 32);
  assert.equal(mixed.height, 32);
  assert.equal(mixed.divergentAreaPct, 100);
});

test("diff_overlay: heurística de kinds — color-shift / missing / extra / text-shape-shift", () => {
  const red = solidImg(64, 64, 255, 0, 0);
  const blue = solidImg(64, 64, 0, 0, 255);
  assert.equal(diffFrames(red, blue, { block: 32 }).topDivergences[0].kind, "color-shift");

  // missing-element: render plano vs referencia con estructura DENTRO del
  // bloque (mitad de bloque de 16px — si fuera 32px alineado, el bloque sería
  // uniforme y caería en color-shift)
  const flat = solidImg(64, 64, 128, 128, 128);
  const withShape = solidImg(64, 64, 128, 128, 128);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 16; x++) {
      const i = (y * 64 + x) * 4;
      withShape.data[i] = 40; withShape.data[i + 1] = 40; withShape.data[i + 2] = 40;
    }
  }
  const miss = diffFrames(flat, withShape, { block: 32 });
  assert.equal(miss.divergentAreaPct, 25);
  assert.equal(miss.topDivergences[0].kind, "missing-element");
  assert.deepEqual(
    [miss.topDivergences[0].x, miss.topDivergences[0].y, miss.topDivergences[0].w, miss.topDivergences[0].h],
    [0, 0, 32, 32],
  );
  // extra-element: misma escena, dirección inversa
  assert.equal(diffFrames(withShape, flat, { block: 32 }).topDivergences[0].kind, "extra-element");
  // text-shape-shift: la misma estructura desplazada 1px
  const shifted = diffFrames(stripesImg(64, 64, 0), stripesImg(64, 64, 1), { block: 32 });
  assert.equal(shifted.divergentAreaPct, 100);
  assert.equal(shifted.topDivergences[0].kind, "text-shape-shift");
});

test("diff_overlay: el DIFF-ALGO de la página es copia EXACTA de frameDiff.mjs", () => {
  const BEGIN = "── DIFF-ALGO-BEGIN";
  const END = "── DIFF-ALGO-END";
  const mod = readFileSync(ROOT + "netlify/functions/frameDiff.mjs", "utf8");
  const norm = (src) => src.slice(src.indexOf(BEGIN), src.indexOf(END))
    .split("\n").map((l) => l.replace(/^export /, "").trim()).filter(Boolean);
  assert.deepEqual(norm(mod), norm(render));
});

test("diff_overlay: registrado en MCP_TOOLS con el flujo réplica encadenado", () => {
  const entry = sourceSlice(mcp, 'name: "diff_overlay"', 'name: "export_frame"');
  assert.match(entry, /Flujo réplica: import_design → render_frame_png → diff_overlay/);
  assert.match(entry, /"side-by-side", "heatmap", "score"/);
  assert.match(entry, /required: \["templateId", "frameId"\]/);
});

test("diff_overlay: el handler arma diffUrl del pipeline existente", () => {
  const block = sourceSlice(mcp, 'case "diff_overlay":', 'case "render_frame_png":');
  assert.match(block, /templates\.getTemplate\(params\.templateId\)/);
  assert.match(block, /getApiKey\(event\)/);
  assert.match(block, /\/api\/render\/\$\{encodeURIComponent\(params\.templateId\)\}\/frame\//);
  assert.match(block, /diff: "1"/);
  // referenceBase64 viaja como asset firmado (se sube antes, mismo pipeline)
  assert.match(block, /referenceBase64/);
  assert.match(block, /createSignedUrl/);
  assert.match(block, /Provide referenceUrl or referenceBase64/);
  assert.match(block, /threshold/);
  assert.match(block, /steps: \[/);
  assert.match(block, /Localization aid, not an oracle/);
});

test("diff_overlay: la página computa el diff y sube el compuesto vía upload_image", () => {
  assert.match(render, /qs\.diff === "1"/);
  assert.match(render, /window\.__diffPng/);
  assert.match(render, /if \(CAPTURE && CAPTURE\.diff\) \{ window\.__diffPng\(\); return; \}/);
  assert.match(render, /ref\.crossOrigin = 'anonymous'/);
  assert.match(render, /DIFF-ALGO-BEGIN/);
  // El flujo normal de render_frame_png sigue intacto
  assert.match(render, /if \(CAPTURE\) \{ window\.__uploadPng\(\); return; \}/);
  assert.match(render, /tags: \['render', 'diff'\]/);
});
