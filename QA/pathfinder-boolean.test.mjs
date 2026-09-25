// QA/pathfinder-boolean.test.mjs — REQ-032 Item 4.2: smoke del motor pathBoolean
// que ahora alimenta el handlePathfinder client-side del editor. Cubre la
// verificación pedida en la spec: dos anillos que se solapan (rect 0,0,100x100
// y estrella aproximada en 50,50) y `booleanShapeOp("subtract")` devolviendo un
// anillo con área < rect. Corre con:
//   node --experimental-strip-types --test QA/pathfinder-boolean.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  booleanShapeOp,
  ringsBounds,
  sampleShapeRing,
} from "../src/lib/pathBoolean.ts";

/** Shoelace con signo: outer CCW positivo, holes CW negativos. El área de la
 * región con semántica evenodd es |Σ signedArea| — sumar absolutos contaría
 * cada agujero DOS veces (una como anillo, otra como suma). */
function signedArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

function ringArea(ring) {
  return Math.abs(signedArea(ring));
}

function regionArea(rings) {
  return Math.abs(rings.reduce((acc, ring) => acc + signedArea(ring), 0));
}

/** Estrella de 5 puntas aproximada como polígono de 10 vértices
 * (alterna radio exterior e interior cada 36°), centrada en (cx, cy). */
function starRing(cx, cy, outerR = 30, innerR = 12) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const angle = (-90 + i * 36) * (Math.PI / 180);
    const radius = i % 2 === 0 ? outerR : innerR;
    pts.push([
      Math.round((cx + radius * Math.cos(angle)) * 100) / 100,
      Math.round((cy + radius * Math.sin(angle)) * 100) / 100,
    ]);
  }
  return pts;
}

const RECT_D = "M0,0 H100 V100 H0 Z";
const rectRing = sampleShapeRing(RECT_D);
const star = starRing(50, 50);

test("sampleShapeRing aplana el rect a 4 vértices con área 10000 y la estrella cierra un anillo válido", () => {
  assert.ok(rectRing, "sampleShapeRing devolvió null para el rect");
  assert.equal(rectRing.length, 4);
  assert.ok(Math.abs(ringArea(rectRing) - 10000) < 0.01, `área rect ${ringArea(rectRing)}`);
  assert.equal(star.length, 10);
  assert.ok(ringArea(star) > 0, "la estrella no encierra área");
});

test("REQ-032 Item 4.2: subtract estrella(50,50) de rect 100x100 → anillo con área < rect y > 0", () => {
  const result = booleanShapeOp("subtract", [[rectRing], [star]]);
  assert.ok(result, "booleanShapeOp(subtract) devolvió null");
  assert.ok(result.length >= 1, "subtract no produjo ningún anillo");
  // Estrella contenida: el resultado es outer (rect) + hole (estrella).
  assert.equal(result.length, 2, `esperados outer+hole, llegaron ${result.length} anillos`);
  const area = regionArea(result);
  assert.ok(area < 10000, `área ${area} NO es menor que la del rect (10000)`);
  assert.ok(area > 0, "subtract aniquiló toda la figura");
  // La resta fue geométrica (agujero con la forma de la estrella), no por bbox:
  // el área resultante coincide con rect − estrella dentro de tolerancia de
  // redondeo (2 decimales por vértice + epsilon del clipper).
  const expected = 10000 - ringArea(star);
  assert.ok(
    Math.abs(area - expected) < 2,
    `área ${area} vs esperada rect−estrella ${expected}`,
  );
});

test("union de las mismas formas: una sola figura contenida, área = rect (estrella dentro)", () => {
  const result = booleanShapeOp("union", [[rectRing], [star]]);
  assert.ok(result, "booleanShapeOp(union) devolvió null");
  const area = regionArea(result);
  assert.ok(Math.abs(area - 10000) < 2, `área unión ${area} vs 10000`);
  // Sin teletransporte: la unión ocupa exactamente la caja del rect.
  assert.deepEqual(ringsBounds(result), ringsBounds([rectRing]));
});

test("intersect y exclude sobre las mismas formas devuelven geometrías disjuntas y coherentes", () => {
  const inter = booleanShapeOp("intersect", [[rectRing], [star]]);
  const excl = booleanShapeOp("exclude", [[rectRing], [star]]);
  assert.ok(inter && excl, "intersect/exclude devolvieron null");
  const interArea = regionArea(inter);
  const exclArea = regionArea(excl);
  const starArea = ringArea(star);
  // estrella contenida en el rect: intersect = estrella entera, exclude = rect − estrella
  assert.ok(Math.abs(interArea - starArea) < 2, `área intersect ${interArea} vs estrella ${starArea}`);
  assert.ok(Math.abs(exclArea - (10000 - starArea)) < 2, `área exclude ${exclArea} vs ${10000 - starArea}`);
  assert.ok(exclArea > interArea, "exclude debería cubrir más que intersect aquí");
});
