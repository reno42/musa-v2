/**
 * REQ-045 — compound, distorsiones líquidas, warp, blend y width:
 * motores puros (compat Cloudflare, sin DOM/Node).
 *
 * Corre con: npm run test:path-ops3
 * (node --experimental-strip-types --test — importa .ts directo, patrón path-ops2)
 */

import assert from "node:assert/strict";
import test from "node:test";
import { parsePathData, serializePathData } from "../src/lib/pathData.ts";
import {
  splitSubpaths,
  makeCompoundD,
  releaseCompoundD,
  countSubpaths,
} from "../src/lib/pathOps/compound.ts";
import {
  mulberry32,
  samplePathPoints,
  applyDistortion,
  warpPath,
} from "../src/lib/pathOps/distort.ts";
import { resamplePath, blendPaths } from "../src/lib/pathOps/blend.ts";
import { widthAt, widthProfileOutline, pickWidthT } from "../src/lib/pathOps/width.ts";

// ── Fixtures ──

const SQUARE_D = "M 0 0 L 100 0 L 100 100 L 0 100 Z";
const LINE_D = "M 0 0 L 100 0";
/** Círculo aproximado con 4 cúbicas (k ≈ 0.5523). */
const CIRCLE_D =
  "M 50 0 C 77.6 0 100 22.4 100 50 C 100 77.6 77.6 100 50 100 " +
  "C 22.4 100 0 77.6 0 50 C 0 22.4 22.4 0 50 0 Z";

function bboxOf(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return [minX, minY, maxX, maxY];
}

// ── Compound ──

test("compound: split hace roundtrip con make/release y conserva contenido", () => {
  const compound = makeCompoundD([SQUARE_D, "M 200 0 L 220 0 L 220 20 Z"]);
  assert.ok(compound);
  assert.equal(countSubpaths(compound), 2);
  const parts = splitSubpaths(compound);
  assert.equal(parts.length, 2);
  assert.equal(parts[0], SQUARE_D);
  assert.deepEqual(releaseCompoundD(compound), parts);
  // Un solo subtrazado no es compound: null en ambas direcciones.
  assert.equal(makeCompoundD([SQUARE_D]), null);
  assert.equal(releaseCompoundD(LINE_D), null);
  assert.equal(countSubpaths(" "), 0);
});

test("compound: el Z de cierre viaja con su subtrazado y m relativo arranca válido", () => {
  const parts = splitSubpaths("M 0 0 L 10 10 Zm 5 5 l 1 1");
  assert.equal(parts.length, 2);
  assert.match(parts[0], /Z$/);
  assert.match(parts[1], /^m 5 5/);
  // Cada trozo vuelve a parsear sin explotar (m a inicio = absoluto por spec).
  assert.equal(parsePathData(parts[1]).length, 2);
});

// ── Distorsiones ──

test("twirl kernel: mismo radio, centro fijo, fuera del radio intacto", () => {
  // import dinámico para tomar el kernel real
  const kernels = require_kernels();
  const poly = [[80, 50], [50, 80], [20, 50], [50, 20], [200, 200]];
  const params = { cx: 50, cy: 50, radius: 60, amount: 30, seed: 1 };
  const out = kernels.twirl(poly, params);
  for (let i = 0; i < poly.length; i++) {
    const rIn = Math.hypot(poly[i][0] - 50, poly[i][1] - 50);
    const rOut = Math.hypot(out[i][0] - 50, out[i][1] - 50);
    assert.ok(Math.abs(rIn - rOut) < 1e-6, `r ${rIn} vs ${rOut}`);
  }
  assert.deepEqual(out[4], [200, 200], "punto fuera del radio intacto");
});

test("mulberry32: determinista y distinto por semilla", () => {
  const a1 = mulberry32(7);
  const a2 = mulberry32(7);
  const b = mulberry32(8);
  const seqA = [a1(), a1(), a1()];
  const seqA2 = [a2(), a2(), a2()];
  const seqB = [b(), b(), b()];
  assert.deepEqual(seqA, seqA2);
  assert.notDeepEqual(seqA, seqB);
});

test("warp arc/twist: fórmulas exactas en puntos conocidos", () => {
  const box = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const arc = warpPath(box, "arc", 20);
  assert.ok(Math.abs(arc[2][1] - (100 - 20 * Math.sin(Math.PI))) < 1e-9);
  // u=0.5 → y = y - amount (sin(π/2) = 1): fila horizontal con u=0.5 real.
  const mid = warpPath([[0, 50], [50, 50], [100, 50]], "arc", 20);
  assert.ok(Math.abs(mid[1][1] - 30) < 1e-9);
  // twist en v=0.5 → ángulo 0 → el centro exacto no se mueve.
  const twistMid = warpPath([...box, [50, 50]], "twist", 100);
  assert.deepEqual(twistMid[4], [50, 50]);
  // twist en v=0 con bbox 100×100 y amount 100 → rotación 0.5 rad alrededor de (50,50).
  const twistTop = warpPath(box, "twist", 100);
  const cosH = Math.cos(0.5);
  const sinH = Math.sin(0.5);
  assert.ok(Math.abs(twistTop[0][0] - (50 - 50 * cosH + 50 * sinH)) < 1e-6);
  assert.ok(Math.abs(twistTop[0][1] - (50 - 50 * sinH - 50 * cosH)) < 1e-6);
});

test("pucker/bloat: dirección monótona y amount 0 = identidad", () => {
  const kernels = require_kernels();
  const poly = [[80, 50], [50, 80], [20, 50], [50, 20]];
  const params = { cx: 50, cy: 50, radius: 60, amount: 10, seed: 1 };
  const inR = poly.map(p => Math.hypot(p[0] - 50, p[1] - 50));
  const puck = kernels.pucker(poly, params).map(p => Math.hypot(p[0] - 50, p[1] - 50));
  const blo = kernels.bloat(poly, params).map(p => Math.hypot(p[0] - 50, p[1] - 50));
  for (let i = 0; i < poly.length; i++) {
    assert.ok(puck[i] < inR[i], "pucker acerca al centro");
    assert.ok(blo[i] > inR[i], "bloat aleja del centro");
  }
  const zero = { ...params, amount: 0 };
  assert.deepEqual(kernels.pucker(poly, zero), poly);
  assert.deepEqual(kernels.bloat(poly, zero), poly);
});

test("applyDistortion: cuadrado → refit válido, determinista y degenerados en null", () => {
  const points = parsePathData(SQUARE_D);
  const out1 = applyDistortion(points, true, "crystallize", { params: { amount: 8, radius: 120, seed: 3 } });
  const out2 = applyDistortion(points, true, "crystallize", { params: { amount: 8, radius: 120, seed: 3 } });
  assert.ok(out1 && out1.length >= 3);
  assert.equal(serializePathData(out1, true), serializePathData(out2, true), "mismo seed → mismo output");
  // El bbox sigue razonable (crystallize solo mete picos hacia adentro).
  const bb = bboxOf(out1);
  assert.ok(bb[0] >= -2 && bb[1] >= -2 && bb[2] <= 102 && bb[3] <= 102);
  // Warp preset obligatorio.
  assert.equal(applyDistortion(points, true, "warp", {}), null);
  assert.equal(applyDistortion(points, true, "warp", { preset: "wave", params: { amount: 10 } })?.length >= 3, true);
  // Degenerados.
  assert.equal(applyDistortion([], true, "twirl", {}), null);
  assert.equal(applyDistortion([{ type: "anchor", x: 0, y: 0 }], false, "twirl", {}), null);
});

test("scallop y wrinkle producen anclas válidas", () => {
  const points = parsePathData(CIRCLE_D);
  for (const effect of ["scallop", "wrinkle"]) {
    const out = applyDistortion(points, true, effect, { params: { amount: 6, radius: 90, seed: 5 } });
    assert.ok(out && out.length >= 3, effect);
    for (const p of out) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${effect} finito`);
    }
  }
});

// ── Blend ──

test("resamplePath: n exacto, extremos y punto medio exactos", () => {
  const line = parsePathData(LINE_D);
  const pts = resamplePath(line, false, 11);
  assert.equal(pts.length, 11);
  assert.deepEqual(pts[0], [0, 0]);
  assert.deepEqual(pts[10], [100, 0]);
  assert.deepEqual(pts[5], [50, 0]);
});

test("blendPaths: nº de pasos y paso medio = midpoint", () => {
  const a = parsePathData("M 0 0 L 100 0 L 100 100 L 0 100 Z");
  const b = parsePathData("M 200 0 L 300 0 L 300 100 L 200 100 Z");
  const steps = blendPaths(a, b, true, true, 3);
  assert.equal(steps.length, 3);
  const mid = steps[1];
  const bb = bboxOf(mid);
  // Caja interpolada al 50%: x 100..200, y 0..100.
  assert.ok(Math.abs(bb[0] - 100) < 3 && Math.abs(bb[2] - 200) < 3, `bbox x ${bb}`);
  assert.ok(Math.abs(bb[1]) < 3 && Math.abs(bb[3] - 100) < 3, `bbox y ${bb}`);
  assert.equal(blendPaths(a, b, true, true, 0), null);
  assert.equal(blendPaths(a, b, true, true, 51), null);
  assert.equal(blendPaths(a, [], true, true, 3), null);
});

test("blend: auto-flip alinea extremos (B invertido se recorre solo)", () => {
  const a = parsePathData("M 0 0 L 100 0");
  // B empieza en (300,100): su inicio queda MÁS LEJOS de A0 que su final → auto-flip ON.
  const bFar = parsePathData("M 300 100 L 200 100");
  const flipped = blendPaths(a, bFar, false, false, 1, { fit: { polygonTol: 0.1, fitTol: 0.1, cornerAngle: 179, snapLines: false } });
  assert.equal(flipped.length, 1);
  // Con flip, A0(0,0) interpola hacia B-reverse-start(200,100) → primer punto ≈ (100·t?, ...) en t=0.5 → (100, 50).
  const p0 = flipped[0][0];
  assert.ok(Math.abs(p0.x - 100) < 4 && Math.abs(p0.y - 50) < 4, `flip: primer ancla ${p0.x},${p0.y}`);
  // flipB:false explícito desactiva el auto-flip → interpola hacia (300,100).
  const noFlip = blendPaths(a, bFar, false, false, 1, { flipB: false, fit: { polygonTol: 0.1, fitTol: 0.1, cornerAngle: 179, snapLines: false } });
  const q0 = noFlip[0][0];
  assert.ok(Math.abs(q0.x - 150) < 4 && Math.abs(q0.y - 50) < 4, `no-flip: primer ancla ${q0.x},${q0.y}`);
});

// ── Width ──

test("widthAt: piecewise-linear sujeto en extremos", () => {
  const stops = [{ t: 0, w: 10 }, { t: 0.5, w: 30 }, { t: 1, w: 0 }];
  assert.equal(widthAt(stops, 0.25), 20);
  assert.equal(widthAt(stops, 0.75), 15);
  assert.equal(widthAt(stops, -1), 10);
  assert.equal(widthAt(stops, 2), 0);
});

test("width: perfil uniforme = outline de ancho constante (caps planos)", () => {
  const line = parsePathData("M 20 50 L 120 50");
  const outline = widthProfileOutline(line, false, 10, [], "flat");
  assert.ok(outline && outline.length >= 3);
  const bb = bboxOf(outline);
  assert.ok(Math.abs(bb[0] - 20) < 1.5 && Math.abs(bb[2] - 120) < 1.5, `x ${bb}`);
  assert.ok(Math.abs(bb[1] - 45) < 1.5 && Math.abs(bb[3] - 55) < 1.5, `y (ancho 10) ${bb}`);
  // pickWidthT sobre el trazo original.
  const pick = pickWidthT(line, false, [60, 55]);
  assert.ok(pick);
  assert.ok(Math.abs(pick.t - 0.4) < 0.02, `t ${pick.t}`);
  assert.ok(Math.abs(pick.distance - 5) < 0.5, `dist ${pick.distance}`);
  assert.ok(Math.abs(pick.point[0] - 60) < 1 && Math.abs(pick.point[1] - 50) < 1);
});

test("width: perfil variable engorda del lado t=1 (4 → 20)", () => {
  const line = parsePathData("M 20 50 L 120 50");
  const outline = widthProfileOutline(line, false, 0, [{ t: 0, w: 4 }, { t: 1, w: 20 }], "flat");
  assert.ok(outline && outline.length >= 3);
  const bb = bboxOf(outline);
  // En x≈20 el semiancho ≈2 (y 48..52); en x≈120 el semiancho ≈10 (y 40..60).
  const near = (x, target) => {
    let best = Infinity;
    for (const p of outline) {
      if (Math.abs(p.x - x) < 6) best = Math.min(best, Math.abs(p.y - target));
    }
    return best;
  };
  assert.ok(near(20, 48) < 1.5 && near(20, 52) < 1.5, `arranque delgado ${bb}`);
  assert.ok(near(120, 40) < 1.5 && near(120, 60) < 1.5, `final grueso ${bb}`);
  // Perfil inválido → null.
  assert.equal(widthProfileOutline(line, false, 10, [{ t: 0.5, w: -4 }], "flat"), null);
});

// ── Refit del círculo: el pipeline distorsión conserva la forma ──

test("refit de círculo: bbox fiel y anclas acotadas", () => {
  const circle = parsePathData(CIRCLE_D);
  const poly = samplePathPoints(circle, true, 24);
  const { refitPathPoints } = require_kernels();
  const fitted = refitPathPoints(poly, true);
  assert.ok(fitted && fitted.length >= 4 && fitted.length <= 40);
  // El bbox se mide sobre la CURVA refiteada: los extremos de un círculo
  // viven a mitad de segmento, no sobre las anclas.
  const round = samplePathPoints(fitted, true, 24);
  const minMax = (pts) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of pts) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    return [minX, minY, maxX, maxY];
  };
  const bbIn = minMax(poly);
  const bbOut = minMax(round);
  for (let i = 0; i < 4; i++) assert.ok(Math.abs(bbIn[i] - bbOut[i]) < 1.5, `bbox ${i}: ${bbIn[i]} vs ${bbOut[i]}`);
});

// ── Helpers de test ──

/** Importa los kernels reales una sola vez (top-level await no: node:test lo
 * soporta, pero mantener el estilo sync del resto del archivo es más simple). */
import * as kernelsMod from "../src/lib/pathOps/distort.ts";
function require_kernels() {
  return kernelsMod;
}
