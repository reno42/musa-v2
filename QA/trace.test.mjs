/**
 * REQ-043 Fase 1 — buscatrazos local: cuantización, contorno crack, ajuste
 * Bézier, centerlines, pipeline completo, decoder PNG puro y cliente sync.
 * Motor 100% TypeScript (mismo bundle que Cloudflare/worker del editor).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { otsuThreshold, pixelIndices, traceImage, traceResultToSvg } from "../src/lib/trace/index.ts";
import { denoise, quantizeImage, TRANSPARENT } from "../src/lib/trace/quantize.ts";
import { traceMask } from "../src/lib/trace/contour.ts";
import { anchorCount, fitLoop, polygon, rdp, subPathToD } from "../src/lib/trace/fit.ts";
import { centerlines } from "../src/lib/trace/centerline.ts";
import { TRACE_PRESETS, tracePresetByName } from "../src/lib/trace/presets.ts";
import { defaultTraceParams, deriveTolerances } from "../src/lib/trace/params.ts";
import { decodePngToRaster } from "../src/lib/trace/png.ts";
import { traceRasterSync } from "../src/lib/traceClient.ts";
import { parsePathData } from "../src/lib/pathData.ts";

// ── Helpers ──

/** White background with a black filled circle (B/N tracing fixture). */
function circleRaster(size = 64, r = 22) {
  const rgba = new Uint8ClampedArray(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      const v = Math.hypot(x - c, y - c) <= r ? 0 : 255;
      rgba[o] = v;
      rgba[o + 1] = v;
      rgba[o + 2] = v;
      rgba[o + 3] = 255;
    }
  }
  return { width: size, height: size, rgba };
}

function solidMask(w, h, on) {
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = on(i % w, (i / w) | 0) ? 1 : 0;
  return mask;
}

// ── Presets y parámetros ──

test("13 presets en orden de panel y lookup por nombre", () => {
  assert.equal(TRACE_PRESETS.length, 13);
  assert.equal(TRACE_PRESETS[0].name, "Default");
  assert.equal(TRACE_PRESETS[12].name, "Flat Logo");
  const logo = tracePresetByName("black and white logo");
  assert.ok(logo);
  assert.equal(logo.ignoreWhite, true);
  assert.equal(tracePresetByName("no existe"), null);
});

test("deriveTolerances: más fidelidad = tolerancias más finas", () => {
  const fine = deriveTolerances({ ...defaultTraceParams(), paths: 100, corners: 100 });
  const rough = deriveTolerances({ ...defaultTraceParams(), paths: 0, corners: 0 });
  assert.ok(fine.polygonTolerance < rough.polygonTolerance);
  assert.ok(fine.fitTolerance < rough.fitTolerance);
  assert.ok(fine.cornerAngle < rough.cornerAngle);
});

// ── Cuantización ──

test("B/N: luma bajo el umbral es negro (1), alpha < 128 transparente", () => {
  const rgba = new Uint8ClampedArray([
    0, 0, 0, 255, // negro → 1
    255, 255, 255, 255, // blanco → 0
    100, 100, 100, 255, // luma 100 < 128 → 1
    0, 0, 0, 64, // transparente
  ]);
  const q = quantizeImage({ width: 2, height: 2, rgba }, { ...defaultTraceParams(), threshold: 128 });
  assert.equal(q.labels[0], 1);
  assert.equal(q.labels[1], 0);
  assert.equal(q.labels[2], 1);
  assert.equal(q.labels[3], TRANSPARENT);
});

test("grayscale k-means: niveles del tamaño pedido", () => {
  const size = 32;
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const g = (i % 4) * 85;
    rgba[i * 4] = g;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = g;
    rgba[i * 4 + 3] = 255;
  }
  const q = quantizeImage({ width: size, height: size, rgba }, { ...defaultTraceParams(), mode: "grayscale", colors: 4 });
  const used = new Set(q.labels);
  assert.ok(used.size <= 4);
  assert.ok(q.palette.length <= 4);
});

test("denoise: un pixel aislado se absorbe por su vecino mayoritario", () => {
  const labels = new Uint16Array(16).fill(1);
  labels[0] = 2; // speck de 1 px
  denoise(labels, 4, 4, 2);
  assert.equal(labels[0], 1);
});

// ── Contorno crack ──

test("cuadrado: un componente, lazo de 4 esquinas, área positiva", () => {
  const mask = solidMask(4, 4, () => true);
  const comps = traceMask(mask, 4, 4);
  assert.equal(comps.length, 1);
  assert.equal(comps[0].outer.pts.length, 4);
  assert.equal(comps[0].outer.area2, 32); // 2 × área (shoelace)
  assert.equal(comps[0].pixels, 16);
  assert.equal(comps[0].holes.length, 0);
});

test("donut: agujero detectado con área negativa", () => {
  const mask = solidMask(5, 5, (x, y) => !(x === 2 && y === 2));
  const comps = traceMask(mask, 5, 5);
  assert.equal(comps.length, 1);
  assert.equal(comps[0].holes.length, 1);
  assert.ok(comps[0].holes[0].area2 < 0);
});

test("silla diagonal: 2 pixeles en diagonal quedan separados (4-conectividad)", () => {
  const comps = traceMask(new Uint8Array([1, 0, 0, 1]), 2, 2);
  assert.equal(comps.length, 2);
  for (const c of comps) {
    assert.equal(c.outer.pts.length, 4);
    assert.equal(c.outer.area2, 2); // 2 × área (shoelace)
  }
});

// ── Ajuste ──

test("rdp: colineales fuera, extremos dentro", () => {
  const pts = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [4, 3]];
  const out = rdp(pts, 0.5);
  assert.deepEqual(out, [[0, 0], [4, 0], [4, 3]]);
});

test("polygon: cuadrado se queda en 4 vértices", () => {
  const poly = polygon([[0, 0], [4, 0], [4, 4], [0, 4]], 0.6);
  assert.equal(poly.length, 4);
});

test("fitLoop: cuadrillo → subpath cerrado serializable por parsePathData", () => {
  const sp = fitLoop({ pts: [[0, 0], [4, 0], [4, 4], [0, 4]], area2: 16 }, { polygonTol: 0.6, fitTol: 0.4, cornerAngle: 35, snapLines: true });
  assert.ok(sp);
  assert.equal(sp.closed, true);
  assert.equal(anchorCount(sp), 4);
  const d = subPathToD(sp);
  const parsed = parsePathData(d);
  assert.equal(parsed.length, 4);
  assert.deepEqual(parsed.map(p => [p.x, p.y]).sort(), [[0, 0], [0, 4], [4, 0], [4, 4]]);
});

// ── Centerlines ──

test("barra fina horizontal → línea central con ancho dentro del máximo", () => {
  const labels = new Uint16Array(20 * 3).fill(1);
  const o = { polygonTol: 0.9, fitTol: 0.5, cornerAngle: 35, snapLines: true };
  const { lines, thin } = centerlines(labels, 1, 20, 3, 5, o);
  assert.ok(lines.length >= 1);
  assert.ok(lines[0].width >= 1 && lines[0].width <= 5);
  const thinCount = pixelIndices(thin, 20, 3).length;
  assert.ok(thinCount > 0 && thinCount <= 60);
  const d = subPathToD(lines[0].subPaths[0]);
  assert.ok(d.startsWith("M"));
});

// ── Pipeline completo ──

test("traceImage B/N logo: círculo negro sobre blanco → 1 fill negro", () => {
  const p = tracePresetByName("Black and White Logo");
  const outcome = traceImage(circleRaster(), p);
  assert.ok(outcome.ok, outcome.ok ? "" : outcome.failure.message);
  const fills = outcome.result.paths.filter(t => t.strokeWidth === undefined);
  assert.equal(fills.length, 1);
  assert.equal(fills[0].color, "#000000");
  const expected = Math.PI * 22 * 22;
  assert.ok(fills[0].pixels > expected * 0.85 && fills[0].pixels < expected * 1.15, `pixels=${fills[0].pixels} vs ${expected.toFixed(0)}`);
  assert.ok(outcome.result.anchorCount > 0);
  assert.deepEqual(outcome.result.palette, ["#ffffff", "#000000"]);
  const parsed = parsePathData(fills[0].d);
  assert.ok(parsed.length >= 3);
  assert.ok(parsed.every(pt => pt.x >= 0 && pt.x <= 64 && pt.y >= 0 && pt.y <= 64));
});

test("traceImage logo degrada a B/N con Otsu", () => {
  const p = { ...tracePresetByName("Flat Logo"), threshold: 0 };
  const outcome = traceImage(circleRaster(), p);
  assert.ok(outcome.ok, outcome.ok ? "" : outcome.failure.message);
  assert.ok(outcome.result.paths.length >= 1);
});

test("traceImage progress llega a 1", () => {
  const seen = [];
  const outcome = traceImage(circleRaster(), tracePresetByName("Black and White Logo"), undefined, f => seen.push(f));
  assert.ok(outcome.ok);
  assert.equal(seen[seen.length - 1], 1);
});

test("traceImage rechaza imagen vacía y demasiado grande", () => {
  const empty = traceImage({ width: 0, height: 0, rgba: new Uint8ClampedArray(0) }, defaultTraceParams());
  assert.equal(empty.ok, false);
  assert.equal(empty.failure.code, "empty");
  // 900 MP declarados sin buffer real: el guard corre antes de tocar rgba.
  const huge = traceImage({ width: 30000, height: 30000, rgba: new Uint8ClampedArray(4) }, defaultTraceParams());
  assert.equal(huge.ok, false);
  assert.equal(huge.failure.code, "tooLarge");
});

test("traceImage presupuesto de anchors → tooComplex", () => {
  const outcome = traceImage(circleRaster(), tracePresetByName("Black and White Logo"), 2);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.failure.code, "tooComplex");
});

test("traceImage strokes: barra negra fina → trazo, no fill", () => {
  const size = 48;
  const rgba = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 20; y <= 25; y++) {
    for (let x = 8; x <= 40; x++) {
      const o = (y * size + x) * 4;
      rgba[o] = 0;
      rgba[o + 1] = 0;
      rgba[o + 2] = 0;
      rgba[o + 3] = 255;
    }
  }
  const p = {
    ...tracePresetByName("Black and White Logo"),
    strokes: true,
    fills: false,
    strokeWidth: 8,
    noise: 0,
  };
  const outcome = traceImage({ width: size, height: size, rgba }, p);
  assert.ok(outcome.ok, outcome.ok ? "" : outcome.failure.message);
  const strokes = outcome.result.paths.filter(t => t.strokeWidth !== undefined);
  assert.ok(strokes.length >= 1, "esperaba al menos un trazo central");
  assert.ok(strokes[0].strokeWidth >= 1 && strokes[0].strokeWidth <= 8);
  assert.equal(outcome.result.paths.filter(t => t.strokeWidth === undefined).length, 0);
});

test("traceResultToSvg: viewBox y fill presente", () => {
  const outcome = traceImage(circleRaster(), tracePresetByName("Black and White Logo"));
  assert.ok(outcome.ok);
  const svg = traceResultToSvg(outcome.result, 64, 64, { "data-layer-kind": "svg" });
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes('viewBox="0 0 64 64"'));
  assert.ok(svg.includes('data-layer-kind="svg"'));
  assert.ok(svg.includes('fill="#000000"'));
});

test("otsuThreshold sobre histograma bimodal cae entre los dos picos", () => {
  const size = 32;
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const g = i % 2 === 0 ? 20 : 230;
    rgba[i * 4] = g;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = g;
    rgba[i * 4 + 3] = 255;
  }
  const t = otsuThreshold({ width: size, height: size, rgba });
  assert.ok(t > 20 && t < 230, `otsu=${t}`);
});

// ── Decoder PNG puro ──

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); // el decoder no verifica CRC
  return Buffer.concat([len, Buffer.from(type, "ascii"), data, crc]);
}

function makePng(w, h, colorType, bitDepth, rows) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  // Cada fila incluye su byte de filtro (posición 0).
  const raw = Buffer.concat(rows);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("decodePngToRaster: RGBA 8-bit con filtro Up", async () => {
  // Fila 2 = fila 1 vía filtro Up (deltas 0).
  const png = makePng(2, 2, 6, 8, [
    Buffer.from([0, 255, 0, 0, 255, 0, 255, 0, 255]),
    Buffer.from([2, 0, 0, 0, 0, 0, 0, 0, 0]),
  ]);
  const raster = await decodePngToRaster(new Uint8Array(png));
  assert.equal(raster.width, 2);
  assert.equal(raster.height, 2);
  assert.deepEqual([raster.rgba[0], raster.rgba[1], raster.rgba[2], raster.rgba[3]], [255, 0, 0, 255]);
  assert.deepEqual([raster.rgba[8], raster.rgba[9], raster.rgba[10], raster.rgba[11]], [255, 0, 0, 255]);
});

test("decodePngToRaster: grayscale 8-bit sin filtros", async () => {
  const png = makePng(3, 1, 0, 8, [Buffer.from([0, 0, 128, 255])]);
  const raster = await decodePngToRaster(new Uint8Array(png));
  assert.deepEqual([raster.rgba[0], raster.rgba[3]], [0, 255]);
  assert.deepEqual([raster.rgba[4], raster.rgba[6]], [128, 128]);
  assert.equal(raster.rgba[10], 255);
});

test("decodePngToRaster → traceImage extremo a extremo", async () => {
  const png = makePng(2, 2, 6, 8, [
    Buffer.from([0, 0, 0, 0, 255, 0, 0, 0, 255]),
    Buffer.from([0, 0, 0, 0, 255, 255, 255, 255, 255]),
  ]);
  const raster = await decodePngToRaster(new Uint8Array(png));
  const p = { ...tracePresetByName("Black and White Logo"), noise: 0 };
  const outcome = traceImage(raster, p);
  assert.ok(outcome.ok, outcome.ok ? "" : outcome.failure.message);
  assert.ok(outcome.result.paths.length >= 1);
});

test("decodePngToRaster rechaza no-PNG", async () => {
  await assert.rejects(() => decodePngToRaster(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), /PNG/);
});

// ── Cliente sync (sin Worker) ──

test("traceRasterSync produce el mismo resultado que traceImage", () => {
  const img = circleRaster();
  const p = tracePresetByName("Black and White Logo");
  const direct = traceImage(img, p);
  const viaClient = traceRasterSync(img, p);
  assert.ok(viaClient.ok);
  assert.equal(viaClient.result.paths.length, direct.result.paths.length);
  assert.equal(viaClient.result.anchorCount, direct.result.anchorCount);
});
