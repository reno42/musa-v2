// REQ-043 Fase 3 — Tijeras y Cuchillo: los dos verbos de corte sobre paths.
// Tijeras opera sobre el modelo de anclas (splitPathSegment); Cuchillo sobre
// la geometría aplanada con semiplanos. Motores puros (sin DOM), así que
// corren con node --experimental-strip-types igual que el resto de suites QA.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePathData, serializePathData, isPathClosed, findClosestPathSegment } from "../src/lib/pathData.ts";
import { deCasteljau } from "../src/lib/bezierMath.ts";
import { cutPathAtPoint } from "../src/lib/pathOps/scissors.ts";
import { knifeCutShape } from "../src/lib/pathOps/knife.ts";

const RECT_D = "M 0 0 L 100 0 L 100 100 L 0 100 Z";
// Cuadrado redondeado: 4 anclas, 4 curvas cúbicas (cerrado).
const CURVE_D = "M 0 0 C 55 0 100 45 100 100 C 100 155 55 200 0 200 C -55 200 -100 155 -100 100 C -100 45 -55 0 0 0 Z";

function ringArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

/** Área de una pieza del cuchillo: su `d` es M/L/Z puro (ringsToPathD),
 * así que los anclajes de parsePathData SON el polígono. */
function pieceArea(d) {
  const pts = parsePathData(d);
  return Math.abs(ringArea(pts.map(p => [p.x, p.y])));
}

/** Lado de cada vértice respecto a la línea: producto cruzado con signo. */
function sideSigns(d, x1, y1, x2, y2) {
  return parsePathData(d).map(p => (x2 - x1) * (p.y - y1) - (y2 - y1) * (p.x - x1));
}

test("tijeras sobre curva cerrada: un path ABIERTO con ambos extremos en el corte", () => {
  const points = parsePathData(CURVE_D);
  assert.equal(points.length, 4);
  const closed = isPathClosed(CURVE_D);
  assert.ok(closed);

  // Clic EXACTO sobre la primera cúbica (0,0)→(100,100) en t=0.5 — un punto
  // calculado, no estimado, para que el corte caiga donde se hizo clic.
  const onCurve = deCasteljau(
    [{ x: 0, y: 0 }, { x: 55, y: 0 }, { x: 100, y: 45 }, { x: 100, y: 100 }],
    0.5,
  );
  const closest = findClosestPathSegment(points, onCurve, closed);
  assert.ok(closest && closest.distance < 1.5, "el clic cae sobre la primera cúbica");
  assert.equal(closest.endIndex, 1, "el segmento más cercano es el primero");

  const pieces = cutPathAtPoint(points, closest.endIndex, closest.t, closed);
  assert.ok(pieces);
  assert.equal(pieces.length, 1, "cerrado → UNA pieza");

  const piece = pieces[0];
  assert.equal(piece.closed, false, "la pieza queda abierta");
  assert.equal(piece.paths.length, points.length + 2, "N anclas + corte duplicado");

  const first = piece.paths[0];
  const last = piece.paths[piece.paths.length - 1];
  assert.equal(first.x, last.x, "ambos extremos sobre el punto de corte");
  assert.equal(first.y, last.y);
  assert.ok(Math.abs(first.x - closest.point.x) < 0.01, "el corte cae donde se hizo clic");
  assert.ok(Math.abs(first.y - closest.point.y) < 0.01);
  assert.ok(Math.abs(first.x - onCurve.x) < 1.5, "el punto de corte coincide con la curva real");
  assert.ok(Math.abs(first.y - onCurve.y) < 1.5);

  // Los handles del ancla insertada son los controles de los sub-curvas del
  // Bézier partido: el inicio conserva su handle saliente, el final el entrante.
  assert.ok(first.cpOut, "el inicio conserva cpOut del sub-curve derecho");
  assert.ok(last.cpIn, "el final conserva cpIn del sub-curve izquierdo");
  assert.ok(!first.cpIn, "el inicio de un path abierto no tiene handle entrante");
  assert.ok(!last.cpOut, "el final de un path abierto no tiene handle saliente");

  // Serializa ABIERTO (sin Z) y re-parsea al mismo modelo de anclas.
  const d = serializePathData(piece.paths, false);
  assert.equal(isPathClosed(d), false, "sin Z tras el corte");
  const reparsed = parsePathData(d);
  assert.equal(reparsed.length, piece.paths.length);
});

test("tijeras sobre path abierto: DOS subpaths que comparten el ancla del corte", () => {
  const openD = "M 0 0 C 30 0 70 0 100 0 L 100 100";
  const points = parsePathData(openD);
  const closest = findClosestPathSegment(points, { x: 50, y: 0 }, false);
  assert.ok(closest && closest.distance < 2);

  const pieces = cutPathAtPoint(points, closest.endIndex, closest.t, false);
  assert.ok(pieces);
  assert.equal(pieces.length, 2, "abierto → DOS subpaths");

  const [head, tail] = pieces;
  assert.equal(head.closed, false);
  assert.equal(tail.closed, false);
  assert.ok(head.paths.length >= 2 && tail.paths.length >= 2);

  // Comparten el punto de corte (copias independientes del ancla).
  const hEnd = head.paths[head.paths.length - 1];
  const tStart = tail.paths[0];
  assert.equal(hEnd.x, tStart.x);
  assert.equal(hEnd.y, tStart.y);
  assert.ok(Math.abs(hEnd.x - closest.point.x) < 0.01);
  assert.ok(Math.abs(hEnd.y - closest.point.y) < 0.01);

  // La cabeza conserva el handle entrante, la cola el saliente; los handles
  // muertos de cada extremo se limpiaron sin corromper la copia vecina.
  assert.ok(hEnd.cpIn && !hEnd.cpOut, "el fin de la cabeza: solo cpIn");
  assert.ok(tStart.cpOut && !tStart.cpIn, "el inicio de la cola: solo cpOut");

  for (const piece of pieces) {
    const d = serializePathData(piece.paths, false);
    assert.equal(isPathClosed(d), false);
  }
});

test("tijeras degeneradas devuelven null sin lanzar", () => {
  assert.equal(cutPathAtPoint([], 1, 0.5, false), null);
  assert.equal(cutPathAtPoint(parsePathData(RECT_D), 0, 0.5, true), null, "endIndex < 1");
  assert.equal(cutPathAtPoint(parsePathData(RECT_D), 9, 0.5, true), null, "endIndex fuera de rango");
  const open = parsePathData("M 0 0 L 10 10 L 10 0");
  assert.equal(cutPathAtPoint(open, 3, 0.5, false), null, "extremo suelto de un path abierto");
});

test("cuchillo: línea vertical sobre el rect → dos mitades de 5000", () => {
  const pieces = knifeCutShape(RECT_D, "#e11d48", 50, -10, 50, 110);
  assert.ok(pieces);
  assert.equal(pieces.length, 2);

  for (const piece of pieces) {
    assert.equal(piece.fill, "#e11d48", "cada pieza conserva el relleno");
    assert.ok(isPathClosed(piece.d), "las piezas quedan cerradas");
    // Cada pieza estrictamente a un lado de la línea de corte.
    const signs = sideSigns(piece.d, 50, -10, 50, 110);
    const hasPos = signs.some(s => s > 1e-6);
    const hasNeg = signs.some(s => s < -1e-6);
    assert.ok(!(hasPos && hasNeg), "una pieza nunca cruza la línea");
  }

  const areas = pieces.map(p => pieceArea(p.d)).sort((a, b) => a - b);
  assert.ok(Math.abs(areas[0] - 5000) < 5, `mitad izquierda ≈ 5000 (got ${areas[0]})`);
  assert.ok(Math.abs(areas[1] - 5000) < 5, `mitad derecha ≈ 5000 (got ${areas[1]})`);
  assert.ok(Math.abs(areas[0] + areas[1] - 10000) < 5, "las piezas reconstruyen el rect");
});

test("cuchillo: diagonal sobre el rect → dos trapecios de 5000", () => {
  // Corta de (30,-10) a (70,110): los trapecios izquierdo y derecho miden
  // (30+70)/2 × 100 = 5000 cada uno.
  const pieces = knifeCutShape(RECT_D, "#2563eb", 30, -10, 70, 110);
  assert.ok(pieces);
  assert.equal(pieces.length, 2);
  const total = pieces.reduce((n, p) => n + pieceArea(p.d), 0);
  assert.ok(Math.abs(total - 10000) < 5, `área total preservada (got ${total})`);
  for (const piece of pieces) {
    const signs = sideSigns(piece.d, 30, -10, 70, 110);
    const hasPos = signs.some(s => s > 1e-6);
    const hasNeg = signs.some(s => s < -1e-6);
    assert.ok(!(hasPos && hasNeg));
  }
});

test("cuchillo: líneas que no cruzan COMPLETAMENTE devuelven null y no mutan", () => {
  assert.equal(knifeCutShape(RECT_D, "#fff", 150, -10, 150, 110), null, "línea fuera del rect");
  assert.equal(knifeCutShape(RECT_D, "#fff", -20, -20, -5, 110), null, "línea fuera por la izquierda");
  assert.equal(knifeCutShape(RECT_D, "#fff", 50, -10, 50, -5), null, "segmento que no llega a tocar");
  // Un drag que ENTRA pero no SALE recortaría la parte no alcanzada — el
  // chequeo de área lo rechaza en vez de botar geometría en silencio.
  assert.equal(knifeCutShape(RECT_D, "#fff", 50, -10, 50, 50), null, "drag a medias");
  assert.equal(knifeCutShape("M", "#fff", 0, 0, 100, 100), null, "path sin sentido");
});
