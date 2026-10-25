// REQ-053 F3 — aplanado de grupos (matemática pura). Run with:
// node --experimental-strip-types --test QA/motion-groups.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  IDENTITY_TRANSFORM,
  composeChain,
  composeInto,
  flattenGroupTransforms,
  sampleNodeTransform,
} from "../shared/motionGroups.ts";

const approx = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test("nodo sin padre: identidad + su propio transform, no está encadenado", () => {
  const { combinedByNodeId, chainedNodeIds, issues } = flattenGroupTransforms(
    [{ id: "a", props: { x: 30, rotation: 15 } }],
    undefined,
  );
  assert.equal(issues.length, 0, JSON.stringify(issues));
  assert.deepEqual(combinedByNodeId.get("a"), { x: 30, y: 0, scale: 1, rotation: 15, opacity: 1 });
  assert.equal(chainedNodeIds.has("a"), false);
  assert.deepEqual(IDENTITY_TRANSFORM, { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 });
});

test("CASO DE ACEPTACIÓN: rotación 90° del padre + hijo a x=10 → (0,10)", () => {
  // El aplanado manual de "translateX(10px)" dentro de un contenedor con
  // rotate(90deg) manda el hijo 10px hacia ABAJO — la matemática tiene que
  // dar exactamente eso.
  const { combinedByNodeId, chainedNodeIds, issues } = flattenGroupTransforms(
    [
      { id: "g", props: { rotation: 90 } },
      { id: "child", parentId: "g", props: { x: 10 } },
    ],
    undefined,
  );
  assert.equal(issues.length, 0, JSON.stringify(issues));
  const child = combinedByNodeId.get("child");
  assert.ok(approx(child.x, 0, 1e-9), `x=${child.x}`);
  assert.ok(approx(child.y, 10, 1e-9), `y=${child.y}`);
  assert.equal(child.scale, 1);
  assert.equal(child.rotation, 90);
  assert.equal(chainedNodeIds.has("child"), true);
  assert.equal(chainedNodeIds.has("g"), false, "el group mismo no está encadenado desde otro");
});

test("escala del padre multiplica la traslación del hijo (semántica CSS anidada)", () => {
  const composed = composeInto({ x: 100, y: 50, scale: 2, rotation: 0, opacity: 1 }, { x: 10, y: 0, scale: 1, rotation: 0, opacity: 1 });
  assert.deepEqual({ x: composed.x, y: composed.y }, { x: 120, y: 50 });
  assert.equal(composed.scale, 2);
});

test("cadena de 2 groups: composeChain es asociativa con el flatten completo", () => {
  const nodes = [
    { id: "g1", props: { rotation: 45 } },
    { id: "g2", parentId: "g1", props: { scale: 2 } },
    { id: "leaf", parentId: "g2", props: { x: 10 } },
  ];
  const { combinedByNodeId, issues } = flattenGroupTransforms(nodes, undefined);
  assert.equal(issues.length, 0, JSON.stringify(issues));
  const flat = combinedByNodeId.get("leaf");
  const manual = composeChain([
    sampleNodeTransform(nodes[0], undefined, 0),
    sampleNodeTransform(nodes[1], undefined, 0),
    sampleNodeTransform(nodes[2], undefined, 0),
  ]);
  assert.ok(approx(flat.x, manual.x) && approx(flat.y, manual.y));
  assert.equal(flat.scale, 2);
  assert.ok(approx(flat.rotation, 45));
  // valor absoluto conocido: 10px rotado 45° y escalado ×2 → (10√2, 10√2)
  assert.ok(approx(flat.x, 10 * Math.SQRT2, 1e-9));
  assert.ok(approx(flat.y, 10 * Math.SQRT2, 1e-9));
});

test("keyframes del padre muestrean escalonado por atMs (espejo de numericAt, sin lerp)", () => {
  // numericAt NO interpola: toma el último keyframe numérico con timeMs <=
  // atMs. El lerp suave lo hace la capa de tween al compilar — acá el
  // flatten respeta el mismo muestreo escalonado.
  const keyframes = [
    { nodeId: "g", property: "rotation", timeMs: 0, value: 0 },
    { nodeId: "g", property: "rotation", timeMs: 1000, value: 90 },
    { nodeId: "child", property: "x", timeMs: 0, value: 10 },
  ];
  const nodes = [{ id: "g" }, { id: "child", parentId: "g" }];
  const mid = flattenGroupTransforms(nodes, keyframes, { atMs: 500 }).combinedByNodeId.get("child");
  assert.deepEqual({ x: mid.x, y: mid.y }, { x: 10, y: 0 }, "a 500ms la rotación vigente es 0 (último kf <= t)");

  const end = flattenGroupTransforms(nodes, keyframes, { atMs: 1000 }).combinedByNodeId.get("child");
  assert.ok(approx(end.x, 0, 1e-9) && approx(end.y, 10, 1e-9), "a 1000ms rota 90° → el hijo cae en (0,10)");

  const past = flattenGroupTransforms(nodes, keyframes, { atMs: 5000 }).combinedByNodeId.get("child");
  assert.ok(approx(past.rotation, 90), "más allá del último kf se mantiene el valor");
});

test("opacity se multiplica por la cadena", () => {
  const { combinedByNodeId } = flattenGroupTransforms(
    [
      { id: "g1", props: { opacity: 0.5 } },
      { id: "g2", parentId: "g1", props: { opacity: 0.8 } },
      { id: "leaf", parentId: "g2" },
    ],
    undefined,
  );
  assert.ok(approx(combinedByNodeId.get("leaf").opacity, 0.4, 1e-9));
});

test("props no numéricos se ignoran (espejo de numericAt: solo typeof number)", () => {
  const t = sampleNodeTransform({ id: "n", props: { x: "10", scale: "2px", rotation: null } }, undefined, 0);
  assert.deepEqual(t, { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 });
});

test("ciclo en parentId: los nodos del ciclo se excluyen con error y el resto se resuelve", () => {
  const res = flattenGroupTransforms(
    [
      { id: "a", parentId: "b" },
      { id: "b", parentId: "a" },
      { id: "c", props: { x: 5 } },
    ],
    undefined,
  );
  assert.equal(res.combinedByNodeId.has("a"), false);
  assert.equal(res.combinedByNodeId.has("b"), false);
  assert.equal(res.combinedByNodeId.get("c").x, 5);
  const cycle = res.issues.filter(i => i.code === "GROUP_CYCLE");
  assert.equal(cycle.length, 2, JSON.stringify(res.issues));
  assert.ok(cycle.every(i => i.severity === "error" && i.path.startsWith("$.nodes.")));
});

test("auto-padre y padre inexistente son error accionable", () => {
  const self = flattenGroupTransforms([{ id: "x", parentId: "x" }], undefined);
  assert.ok(self.issues[0].code === "GROUP_CYCLE" || self.issues[0].code === "GROUP_PARENT_MISSING");

  const missing = flattenGroupTransforms([{ id: "y", parentId: "fantasma" }], undefined);
  assert.equal(missing.issues[0].code, "GROUP_PARENT_MISSING");
  assert.ok(missing.issues[0].message.includes("fantasma"));
});

test("maxDepth corta cadenas patológicas con GROUP_DEPTH_EXCEEDED", () => {
  const nodes = [1, 2, 3, 4, 5].map(n => ({ id: `n${n}`, parentId: n > 1 ? `n${n - 1}` : undefined }));
  const res = flattenGroupTransforms(nodes, undefined, { maxDepth: 3 });
  assert.ok(res.issues.some(i => i.code === "GROUP_DEPTH_EXCEEDED"));
  assert.equal(res.combinedByNodeId.has("n5"), false);
  // con profundidad suficiente, todo se resuelve
  const ok = flattenGroupTransforms(nodes, undefined, { maxDepth: 8 });
  assert.equal(ok.issues.length, 0, JSON.stringify(ok.issues));
  assert.equal(ok.combinedByNodeId.get("n5").scale, 1);
});
