// QA/pathfinder-boolean.test.mjs — REQ-032 Item 4.2: smoke del motor pathBoolean
// que ahora alimenta el handlePathfinder client-side del editor. Cubre la
// verificación pedida en la spec: dos anillos que se solapan (rect 0,0,100x100
// y estrella aproximada en 50,50) y `booleanShapeOp("subtract")` devolviendo un
// anillo con área < rect. REQ-043 Fase 3 añade las pruebas del buscatrazos
// extendido (10 ops estilo Illustrator) vía `pathfinder()`. Corre con:
//   node --experimental-strip-types --test QA/pathfinder-boolean.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  booleanShapeOp,
  pathfinder,
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

// ─── REQ-043 Fase 3: buscatrazos extendido (10 ops) ───

/** Círculo aproximado como polígono de `n` vértices (para dividir con el rect). */
function circleRing(cx, cy, r, n = 48) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2;
    pts.push([
      Math.round((cx + r * Math.cos(angle)) * 100) / 100,
      Math.round((cy + r * Math.sin(angle)) * 100) / 100,
    ]);
  }
  return pts;
}

function facesArea(result) {
  return result.shapes.reduce((acc, face) => acc + regionArea(face.rings), 0);
}

function assertValidShapes(result, label) {
  assert.ok(result, `${label}: pathfinder devolvió null`);
  assert.ok(result.shapes.length >= 1, `${label}: sin caras`);
  for (const face of result.shapes) {
    assert.ok(face.rings.length >= 1, `${label}: cara sin anillos`);
    for (const ring of face.rings) {
      assert.ok(ring.length >= 3, `${label}: anillo con ${ring.length} vértices`);
      for (const [x, y] of ring) {
        assert.ok(Number.isFinite(x) && Number.isFinite(y), `${label}: coordenada no finita`);
      }
    }
  }
}

// Pila: rect A (atrás, rojo) + círculo B (adelante, azul) que se solapan.
const RECT_FILL = "#e11d48";
const CIRCLE_FILL = "#2563eb";
const circle = circleRing(70, 70, 40);
const stack = [
  { rings: [rectRing], fill: RECT_FILL },
  { rings: [circle], fill: CIRCLE_FILL },
];
// Áreas de referencia medidas con booleanShapeOp (validado numéricamente arriba):
const unionArea = regionArea(booleanShapeOp("union", [[rectRing], [circle]]));
const lensArea = regionArea(booleanShapeOp("intersect", [[rectRing], [circle]]));
const circleArea = ringArea(circle);

test("REQ-043 divide rect+circulo solapados → 3 caras y gana el relleno del más al frente", () => {
  const result = pathfinder("divide", stack);
  assertValidShapes(result, "divide");
  assert.equal(result.shapes.length, 3, `esperadas 3 caras, llegaron ${result.shapes.length}`);
  const fills = result.shapes.map(f => f.fill).sort();
  assert.deepEqual(fills, [CIRCLE_FILL, CIRCLE_FILL, RECT_FILL].sort(),
    "esperados 2 caras azules (frente) + 1 roja (atrás)");
  // La suma de caras reconstruye la unión (nada se pierde ni duplica).
  const total = facesArea(result);
  assert.ok(Math.abs(total - unionArea) < 2, `área caras ${total} vs unión ${unionArea}`);
  // La cara roja es el trozo del rect fuera del círculo.
  const redArea = result.shapes.filter(f => f.fill === RECT_FILL)
    .reduce((acc, f) => acc + regionArea(f.rings), 0);
  assert.ok(Math.abs(redArea - (10000 - lensArea)) < 2, `cara roja ${redArea} vs ${10000 - lensArea}`);
});

test("REQ-043 trim no borra la parte visible de la figura de atrás", () => {
  const result = pathfinder("trim", stack);
  assertValidShapes(result, "trim");
  assert.equal(result.shapes.length, 2, `esperadas 2 piezas, llegaron ${result.shapes.length}`);
  const back = result.shapes.find(f => f.fill === RECT_FILL);
  const front = result.shapes.find(f => f.fill === CIRCLE_FILL);
  assert.ok(back, "trim perdió la pieza de atrás");
  assert.ok(front, "trim perdió la pieza del frente");
  const backArea = regionArea(back.rings);
  assert.ok(backArea > 1000, `la parte visible de atrás quedó en ${backArea}`);
  assert.ok(Math.abs(backArea - (10000 - lensArea)) < 2, `pieza de atrás ${backArea} vs ${10000 - lensArea}`);
  // El frente conserva su figura ENTERA (trim no parte al frente en átomos).
  assert.ok(Math.abs(regionArea(front.rings) - circleArea) < 2,
    `pieza del frente ${regionArea(front.rings)} vs círculo ${circleArea}`);
});

test("REQ-043 minusFront conserva el relleno de atrás y minusBack es la inversa", () => {
  const mf = pathfinder("minusFront", stack);
  assertValidShapes(mf, "minusFront");
  assert.equal(mf.shapes.length, 1, "minusFront debería devolver una sola figura");
  assert.equal(mf.shapes[0].fill, RECT_FILL, "minusFront debe conservar el relleno de atrás");
  assert.ok(Math.abs(facesArea(mf) - (10000 - lensArea)) < 2,
    `área minusFront ${facesArea(mf)} vs ${10000 - lensArea}`);

  const mb = pathfinder("minusBack", stack);
  assertValidShapes(mb, "minusBack");
  assert.equal(mb.shapes.length, 1, "minusBack debería devolver una sola figura");
  assert.equal(mb.shapes[0].fill, CIRCLE_FILL, "minusBack debe conservar el relleno del frente");
  assert.ok(Math.abs(facesArea(mb) - (circleArea - lensArea)) < 2,
    `área minusBack ${facesArea(mb)} vs ${circleArea - lensArea}`);
});

test("REQ-043 crop = intersección con pintura de atrás; outline produce contornos sin relleno", () => {
  const crop = pathfinder("crop", stack);
  assertValidShapes(crop, "crop");
  assert.equal(crop.shapes.length, 1, "crop debería devolver una sola figura");
  assert.equal(crop.shapes[0].fill, RECT_FILL, "crop conserva la pintura de ATRÁS");
  assert.ok(Math.abs(facesArea(crop) - lensArea) < 2, `área crop ${facesArea(crop)} vs lente ${lensArea}`);

  const outline = pathfinder("outline", stack);
  assertValidShapes(outline, "outline");
  assert.equal(outline.shapes.length, 3, "outline debería partir en los mismos átomos de divide");
  for (const face of outline.shapes) {
    assert.equal(face.fill, "none", "outline no debe traer relleno");
  }
  assert.ok(Math.abs(facesArea(outline) - unionArea) < 2,
    `área contornos ${facesArea(outline)} vs unión ${unionArea}`);
});

test("REQ-043 las 10 ops no explotan con entradas límite (idénticas, disjuntas, anidadas)", () => {
  const ops = ["unite", "minusFront", "intersect", "exclude", "divide", "trim", "merge", "crop", "outline", "minusBack"];
  const nestedStar = starRing(50, 50);
  const disjointRect = sampleShapeRing("M200,200 H300 V300 H200 Z");
  const cases = {
    identicas: [
      { rings: [rectRing], fill: "#111" },
      { rings: [rectRing], fill: "#222" },
    ],
    disjuntas: [
      { rings: [rectRing], fill: "#111" },
      { rings: [disjointRect], fill: "#222" },
    ],
    anidadas: [
      { rings: [rectRing], fill: "#111" },
      { rings: [nestedStar], fill: "#222" },
    ],
  };
  for (const [label, inputs] of Object.entries(cases)) {
    for (const op of ops) {
      // No debe lanzar; null (aniquilación) o geometría válida son ambos válidos.
      const result = pathfinder(op, inputs);
      if (result) assertValidShapes(result, `${op}/${label}`);
    }
  }
  // Puntuaciones concretas: idénticas aniquilan minusFront/minusBack; disjuntas
  // aniquilan intersect/crop; unite disjunto conserva AMBAS áreas.
  assert.equal(pathfinder("minusFront", cases.identicas), null, "minusFront de idénticas debería aniquilar");
  assert.equal(pathfinder("minusBack", cases.identicas), null, "minusBack de idénticas debería aniquilar");
  assert.equal(pathfinder("intersect", cases.disjuntas), null, "intersect de disjuntas debería aniquilar");
  assert.equal(pathfinder("crop", cases.disjuntas), null, "crop de disjuntas debería aniquilar");
  const disjointUnion = pathfinder("unite", cases.disjuntas);
  assert.ok(disjointUnion && Math.abs(facesArea(disjointUnion) - 20000) < 2,
    "unite de disjuntas debería sumar ambas áreas");
});
