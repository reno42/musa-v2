// REQ-044 Fase 1 — Operaciones de trazado nuevas: reverse (invertir dirección),
// average (promediar anclas) y removeStrayAnchors (limpiar anclas sueltas).
// Motores puros (sin DOM), así que corren con node --experimental-strip-types
// igual que el resto de suites QA.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePathData, serializePathData, isPathClosed } from "../src/lib/pathData.ts";
import { averagePath, removeStrayAnchors, reversePath } from "../src/lib/pathOps/edit.ts";

const CLOSED_CURVE_D = "M 0 0 C 55 0 100 45 100 100 C 100 155 55 200 0 200 C -55 200 -100 155 -100 100 C -100 45 -55 0 0 0 Z";
const OPEN_CURVE_D = "M 0 0 C 30 0 60 30 60 60 L 120 60";

function anchors(points) {
  return points.map(p => [p.x, p.y]);
}

/** Firma posicional de anclas+handles, independiente del orden: sirve para
 * comprobar que invertir NO mueve geometría, sólo permuta el recorrido y el
 * rol entrada/salida de cada par de handles. */
function geometryKey(points) {
  const parts = [];
  for (const p of points) {
    const handles = [[p.cpIn?.x, p.cpIn?.y], [p.cpOut?.x, p.cpOut?.y]]
      .map(h => h.join(","))
      .sort()
      .join("#");
    parts.push([p.x, p.y, handles].join(","));
  }
  return parts.sort().join("|");
}

test("reverse cerrado: mismas anclas y handles, sólo permuta el recorrido", () => {
  assert.ok(isPathClosed(CLOSED_CURVE_D));
  const pts = parsePathData(CLOSED_CURVE_D);
  const rev = reversePath(pts, true);
  assert.equal(rev.length, pts.length, "conserva el número de anclas");
  assert.equal(geometryKey(rev), geometryKey(pts), "misma geometría absoluta");
  // El punto de partida pasa a ser el que era el último.
  assert.deepEqual(anchors(rev)[0], anchors(pts)[pts.length - 1]);
});

test("reverse abierto: orden invertido y handles intercambiados cpIn↔cpOut", () => {
  const pts = parsePathData(OPEN_CURVE_D);
  // Modelo original: P0.cpOut=(30,0), P1.cpIn=(60,30), P2 pelado.
  assert.deepEqual([pts[0].cpOut.x, pts[0].cpOut.y], [30, 0]);
  assert.deepEqual([pts[1].cpIn.x, pts[1].cpIn.y], [60, 30]);

  const rev = reversePath(pts, false);
  assert.deepEqual(anchors(rev), [[120, 60], [60, 60], [0, 0]]);
  // P2 (antes pelado) sigue pelado; el handle de entrada de P1 sale como
  // handle de salida, y el de salida de P0 entra como entrada de P2.
  assert.equal(rev[0].cpIn, undefined);
  assert.equal(rev[0].cpOut, undefined);
  assert.equal(rev[1].cpIn, undefined);
  assert.deepEqual([rev[1].cpOut.x, rev[1].cpOut.y], [60, 30]);
  assert.deepEqual([rev[2].cpIn.x, rev[2].cpIn.y], [30, 0]);
  assert.equal(rev[2].cpOut, undefined);
});

test("reverse ida y vuelta: serializa idéntico al original (cerrado y abierto)", () => {
  for (const [d, closed] of [[CLOSED_CURVE_D, true], [OPEN_CURVE_D, false]]) {
    const forward = serializePathData(parsePathData(d), closed);
    const back = serializePathData(reversePath(reversePath(parsePathData(d), closed), closed), closed);
    assert.equal(back, forward, "doble inversión = identidad");
  }
});

test("average h/v: comparte Y (horizontal) o X (vertical) sin mover el otro eje", () => {
  const pts = parsePathData("M 0 0 L 100 40 L 200 -40");

  const h = averagePath(pts, "h");
  assert.deepEqual(anchors(h).map(a => a[1]), [0, 0, 0], "Y promediada (=0)");
  assert.deepEqual(anchors(h).map(a => a[0]), [0, 100, 200], "X intacta");

  const v = averagePath(pts, "v");
  assert.deepEqual(anchors(v).map(a => a[0]), [100, 100, 100], "X promediada (=100)");
  assert.deepEqual(anchors(v).map(a => a[1]), [0, 40, -40], "Y intacta");
});

test("average both: todas las anclas al centroide; los handles viajan con su ancla", () => {
  const pts = parsePathData(OPEN_CURVE_D); // mean X=60, mean Y=40

  const both = averagePath(pts, "both");
  for (const a of both) {
    assert.equal(a.x, 60);
    assert.equal(a.y, 40);
  }

  // h desplaza cada ancla (y sus handles) con el MISMO delta.
  const h = averagePath(pts, "h"); // mean Y=40 → deltas +40, -20, -20
  assert.deepEqual([h[0].cpOut.x, h[0].cpOut.y], [30, 40], "handle 0 viaja con delta +40");
  assert.deepEqual([h[1].cpIn.x, h[1].cpIn.y], [60, 10], "handle 1 viaja con delta -20");

  // Modo por defecto = both.
  const implicit = averagePath(pts);
  assert.deepEqual(anchors(implicit), anchors(both));
});

test("average degenerado: <2 anclas devuelve copia sin tocar", () => {
  const single = parsePathData("M 5 5 L 5 5").slice(0, 1);
  const out = averagePath(single, "both");
  assert.equal(out.length, 1);
  assert.deepEqual([out[0].x, out[0].y], [5, 5]);
});

test("removeStrayAnchors: elimina anclas peladas que duplican al vecino", () => {
  const withStray = parsePathData("M 0 0 L 50 0 L 50 0 L 100 0 L 100 50");
  const stray = removeStrayAnchors(withStray, false);
  assert.ok(stray, "hay una ancla suelta que quitar");
  assert.equal(stray.removed, 1);
  assert.deepEqual(anchors(stray.points), [[0, 0], [50, 0], [100, 0], [100, 50]]);
});

test("removeStrayAnchors: una curva sana queda intacta (devuelve null)", () => {
  const healthy = parsePathData(OPEN_CURVE_D);
  assert.equal(removeStrayAnchors(healthy, false), null);
  const closed = parsePathData(CLOSED_CURVE_D);
  assert.equal(removeStrayAnchors(closed, true), null);
});

test("removeStrayAnchors: ancla de cierre duplicada en path cerrado", () => {
  // Sin Z: el parseador deduplica el ancla previa al Z, así que el caso real
  // llega del modelo del UI (closed=true sobre un trazo que vuelve a su origen).
  const dupClose = parsePathData("M 0 0 L 100 0 L 100 100 L 0 0");
  assert.equal(dupClose.length, 4);
  const r = removeStrayAnchors(dupClose, true);
  assert.ok(r);
  assert.equal(r.removed, 1);
  assert.equal(r.points.length, 3);
  assert.deepEqual(anchors(r.points), [[0, 0], [100, 0], [100, 100]]);
});

test("removeStrayAnchors: nunca degenera por debajo del mínimo de anclas", () => {
  // Dos anclas idénticas abiertas: quitar dejaría 1 < 2 → null.
  const two = parsePathData("M 0 0 L 0 0");
  assert.equal(removeStrayAnchors(two, false), null);
});

test("integración serializePathData: cleanup y reverse re-parsean consistentes", () => {
  // cleanup + serialize mantiene 4 anclas y la geometría viva.
  const cleaned = removeStrayAnchors(parsePathData("M 0 0 L 50 0 L 50 0 L 100 0 L 100 50"), false);
  const d2 = serializePathData(cleaned.points, false);
  assert.equal(parsePathData(d2).length, 4);

  // reverse + serialize + parse de vuelta = mismo modelo invertido.
  const ui = parsePathData("M 10 10 C 15 10 20 15 20 20 L 30 20");
  const rev = reversePath(ui, false);
  const reparsed = parsePathData(serializePathData(rev, false));
  assert.deepEqual(anchors(reparsed), anchors(rev));
  assert.equal(reparsed[1].cpIn, undefined);
  assert.deepEqual([reparsed[1].cpOut.x, reparsed[1].cpOut.y], [20, 15]);
});
