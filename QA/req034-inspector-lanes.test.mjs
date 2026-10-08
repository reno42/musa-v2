/**
 * REQ034 — P1.3 carriles de propiedades y rombos editables, from
 * Propuesta_UI_motion_graphics (2026-10-07): "mover/copiar/borrar keyframes y
 * editar tiempo exacto visualmente".
 *
 * Contract under test:
 *  - buildTimelineLanes projects ONE lane per clip·tween of a layer, so a
 *    wall-bounce layer (bounce transform·linear + llegada transform·ease-out
 *    + fade opacity·ease-in) shows as three lanes with their OWN easings.
 *  - Lane-addressed edits (clipIndex) hit exactly their clip; the legacy
 *    calls (no clipIndex) keep editing the first clip / every clip.
 *  - duplicateKeyframe copies a keyframe strictly between its neighbors so
 *    the pinned outer keys stay pinned.
 *  - The timeline paints per-lane diamonds and the inspector exposes the
 *    lanes panel (exact time, duplicate, delete, per-lane easing).
 *
 * Run: node --experimental-strip-types --test QA/req034-inspector-lanes.test.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildWallBounce } from "../shared/wallBounce.ts";
import { normalizeAnimation } from "../shared/animationSchema.ts";
import { buildTimelineLanes, lanePropLabel } from "../shared/timelineLanes.ts";
import { moveKeyframe, deleteKeyframe, duplicateKeyframe, setTweenEasing, parseTransform } from "../src/lib/layerKeyframes.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");

// Flujo 1 wall-bounce (same fixture as REQ033): three clips on one layer.
const base = {
  layerId: "pelota", width: 1080, height: 1080,
  startCenter: { x: 540, y: 540 }, origin: { x: 440, y: 500 },
  radius: 40, margin: 0, contacts: 20, durationSec: 4, dirDeg: 37,
  rhythm: "velocity", endMode: "center", arrivalSec: 0.8, exitMode: "fade", fadeSec: 0.6,
};

function bounceSchema() {
  const r = buildWallBounce(base);
  const schema = normalizeAnimation({
    timeline: { durationSec: 6, fps: 30, width: 1080, height: 1080, loop: "once" },
    clips: r.clips,
    transitions: [],
  });
  return { r, schema };
}

test("REQ034-LANE-1: bounce+llegada+fade = 3 carriles con easing propio y ventanas exactas", () => {
  const { r, schema } = bounceSchema();
  const lanes = buildTimelineLanes(schema, "pelota");
  assert.equal(lanes.length, 3);
  assert.deepEqual(lanes.map(l => l.prop), ["transform", "transform", "opacity"]);
  assert.deepEqual(lanes.map(l => l.easing), ["linear", "ease-out", "ease-in"]);
  assert.deepEqual(lanes.map(l => l.startSec), [0, 4, 4.8]);
  assert.deepEqual(lanes.map(l => l.endSec), [4, 4.8, 5.4]);
  assert.deepEqual(lanes.map(l => l.keyframes.length), [21, 2, 2]);
  // Bounce: keyframe times follow the contact timeline within the schema's
  // quantization (normalized t rounded to 2 decimals ⇒ ≤ dur·0.005 + r2).
  assert.equal(lanes[0].keyframes[0].tSec, 0);
  assert.ok(Math.abs(lanes[0].keyframes[1].tSec - r.contacts[0].tSec) <= 0.021,
    "el KF 1 cae en la ventana de cuantización del contacto 1");
  // Llegada: arranca donde termina el rebote y termina en el centro — sin contactos extra.
  assert.equal(lanes[1].keyframes[0].tSec, 4);
  assert.equal(lanes[1].keyframes[1].tSec, 4.8);
  const centro = parseTransform(lanes[1].keyframes[1].value);
  assert.ok(Math.abs(centro.x + base.origin.x - 540) < 0.01, "llegada termina en el centro X");
  // Fade: 1 → 0.
  assert.deepEqual(lanes[2].keyframes.map(k => k.value), ["1", "0"]);
  // Etiquetas de propiedad.
  assert.equal(lanePropLabel("transform"), "Transform");
  assert.equal(lanePropLabel("opacity"), "Opacidad");
  assert.equal(lanePropLabel("custom.thing"), "custom.thing");
});

test("REQ034-LANE-2: filtro por capa + clipIndex como identidad del carril", () => {
  const { schema } = bounceSchema();
  const multi = normalizeAnimation({
    ...schema,
    clips: [...schema.clips, {
      layerId: "logo", startSec: 1, endSec: 2,
      tweens: [{ prop: "opacity", easing: "linear", keyframes: [{ t: 0, value: "1" }, { t: 1, value: "0.5" }] }],
    }],
  });
  const logoLanes = buildTimelineLanes(multi, "logo");
  assert.equal(logoLanes.length, 1);
  const logoIdx = logoLanes[0].clipIndex;
  assert.equal(multi.clips[logoIdx].layerId, "logo", "el clipIndex apunta al clip correcto");
  // Editar por el índice del carril toca SOLO esa capa.
  const pelotaBefore = JSON.stringify(buildTimelineLanes(multi, "pelota"));
  const dup = duplicateKeyframe(multi, "logo", "opacity", 0, logoIdx);
  assert.ok(dup.schema);
  assert.equal(buildTimelineLanes(dup.schema, "logo")[0].keyframes.length, 3);
  assert.equal(JSON.stringify(buildTimelineLanes(dup.schema, "pelota")), pelotaBefore, "pelota intacta");
});

test("REQ034-LANE-3: mover por carril edita SOLO su clip; legacy (sin clipIndex) = primer clip", () => {
  const { schema } = bounceSchema();
  const lanes = buildTimelineLanes(schema, "pelota");
  const restBefore = JSON.stringify(lanes.slice(1));
  const kfs = lanes[0].keyframes;
  // Objetivo seguro: entre los vecinos del keyframe 2 (no cruza el orden).
  const newT = (kfs[1].tSec + kfs[3].tSec) / 2;
  const res = moveKeyframe(schema, "pelota", "transform", 2, newT, lanes[0].clipIndex);
  assert.ok(res.schema);
  const after = buildTimelineLanes(res.schema, "pelota");
  assert.equal(after[0].keyframes[2].tSec, Math.round(newT * 100) / 100);
  assert.equal(JSON.stringify(after.slice(1)), restBefore, "llegada y fade intactas");
  // Legacy: sin clipIndex produce EXACTAMENTE lo mismo que el carril 0.
  const legacy = moveKeyframe(schema, "pelota", "transform", 2, newT);
  const addressed = moveKeyframe(schema, "pelota", "transform", 2, newT, lanes[0].clipIndex);
  assert.equal(JSON.stringify(legacy.schema), JSON.stringify(addressed.schema));
});

test("REQ034-LANE-4: borrar por carril — baja a valor estático (normalize rellena), resto intacto", () => {
  const { schema } = bounceSchema();
  const lanes = buildTimelineLanes(schema, "pelota");
  const d1 = deleteKeyframe(schema, "pelota", "transform", 1, lanes[1].clipIndex);
  assert.ok(d1.schema);
  const lanes1 = buildTimelineLanes(d1.schema, "pelota");
  assert.equal(lanes1.length, 3, "el carril de llegada sobrevive como valor estático");
  assert.equal(lanes1[1].keyframes.length, 2, "1 KF ⇒ normalize lo rellena a hold 0..1");
  assert.equal(lanes1[1].keyframes[0].value, lanes1[1].keyframes[1].value);
  assert.equal(lanes1[0].keyframes.length, 21, "el bounce no se entera");
  // Borrar de nuevo mantiene el hold (2 → 1 → rellenado): la salida real del
  // carril es "Limpiar animación", no el borrado a medias.
  const d2 = deleteKeyframe(d1.schema, "pelota", "transform", 1, lanes[1].clipIndex);
  assert.ok(d2.schema);
  const lanes2 = buildTimelineLanes(d2.schema, "pelota");
  assert.equal(lanes2.length, 3);
  assert.equal(lanes2[1].keyframes[0].value, lanes2[1].keyframes[1].value);
});

test("REQ034-LANE-5: duplicar copia el valor entre vecinos sin romper los pins", () => {
  const { schema } = bounceSchema();
  const lanes = buildTimelineLanes(schema, "pelota");
  const l0 = lanes[0].keyframes;
  const dup = duplicateKeyframe(schema, "pelota", "transform", 2, lanes[0].clipIndex);
  assert.ok(dup.schema);
  const after = buildTimelineLanes(dup.schema, "pelota");
  assert.equal(after[0].keyframes.length, 22);
  const lo = l0[1].tSec, hi = l0[3].tSec;
  const copy = after[0].keyframes.find(k => k.value === l0[2].value && k.tSec > lo && k.tSec < hi && k.tSec !== l0[2].tSec);
  assert.ok(copy, "la copia cae estrictamente entre los vecinos del original");
  assert.equal(after[0].keyframes[0].tSec, 0, "pin inicial intacto");
  assert.equal(after[0].keyframes[21].tSec, 4, "pin final intacto");
  // Duplicar un extremo de la llegada: los pins siguen en 4.0 / 4.8.
  const dup2 = duplicateKeyframe(dup.schema, "pelota", "transform", 1, lanes[1].clipIndex);
  assert.ok(dup2.schema);
  const l1 = buildTimelineLanes(dup2.schema, "pelota")[1];
  assert.equal(l1.keyframes.length, 3);
  assert.equal(l1.keyframes[0].tSec, 4);
  assert.equal(l1.keyframes[2].tSec, 4.8);
  const extremo = parseTransform(l1.keyframes[2].value);
  const copia = parseTransform(l1.keyframes[1].value);
  assert.equal(copia.x, extremo.x, "la copia hereda el valor del extremo duplicado");
  assert.equal(copia.y, extremo.y);
  // Tween de 1 KF: normalize lo rellena a hold — duplicar inserta una copia
  // interior con el mismo valor (el hold se mantiene).
  const single = normalizeAnimation({
    timeline: { durationSec: 2, fps: 30, width: 100, height: 100, loop: "once" },
    clips: [{ layerId: "x", startSec: 0, endSec: 1, tweens: [{ prop: "opacity", easing: "linear", keyframes: [{ t: 0, value: "1" }] }] }],
    transitions: [],
  });
  const dupSingle = duplicateKeyframe(single, "x", "opacity", 0);
  assert.ok(dupSingle.schema);
  const sLane = buildTimelineLanes(dupSingle.schema, "x")[0];
  assert.equal(sLane.keyframes.length, 3);
  assert.ok(sLane.keyframes[1].tSec > 0 && sLane.keyframes[1].tSec < 1);
  assert.deepEqual(sLane.keyframes.map(k => k.value), ["1", "1", "1"]);
});

test("REQ034-LANE-6: easing por carril — addressed cambia uno, legacy cambia todos los del prop", () => {
  const { schema } = bounceSchema();
  const lanes = buildTimelineLanes(schema, "pelota");
  const res = setTweenEasing(schema, "pelota", "transform", "ease-in", lanes[1].clipIndex);
  const after = buildTimelineLanes(res.schema, "pelota");
  assert.equal(after[1].easing, "ease-in", "solo la llegada cambia");
  assert.equal(after[0].easing, "linear", "el bounce conserva su linear");
  assert.equal(after[0].keyframes.length, 21, "los keyframes no se tocan");
  const legacy = setTweenEasing(schema, "pelota", "transform", "ease-in");
  const afterLegacy = buildTimelineLanes(legacy.schema, "pelota");
  assert.deepEqual(afterLegacy.map(l => l.easing), ["ease-in", "ease-in", "ease-in"]);
});

test("REQ034-UI-1: el timeline pinta rombos por carril (clip·propiedad) con drag y delete", () => {
  const src = read("src/components/video/VideoTimeline.tsx");
  assert.match(src, /layerLanes\?/);
  assert.match(src, /onKfMove\?: \(clipIndex: number, prop: string, index: number, tGlobal: number\) => void/);
  assert.match(src, /onKfDelete\?: \(clipIndex: number, prop: string, index: number\) => void/);
  assert.match(src, /mode: "kf", clipIndex: ln\.clipIndex/);
  assert.match(src, /data-kf/);
  assert.match(src, /carriles por clip·propiedad/);
  assert.match(src, /lanePropLabel\(ln\.prop\)/);
});

test("REQ034-UI-2: el inspector expone carriles con easing propio y edición de tiempo exacto", () => {
  const src = read("src/components/video/VideoInspector.tsx");
  assert.match(src, /Carriles \(\{lanes\.length\}\)/);
  assert.match(src, /buildTimelineLanes/);
  assert.match(src, /Tiempo exacto \(s\)/);
  assert.match(src, /Duplicar/);
  assert.match(src, /Borrar/);
  assert.match(src, /kind: "easing", clipIndex: ln\.clipIndex/);
  assert.match(src, /onKeyframeOp: \(frameId: string, layerId: string, op: KeyframeOp\) => void/);
  assert.match(src, /onSeek: \(tGlobal: number\) => void/);
  assert.match(src, /onSeek\(takeStart \+ k\.tSec\)/);
  assert.match(src, /Extremo del carril/);
});

test("REQ034-UI-3: el modo video conecta carriles y ops sobre la misma gramática del schema", () => {
  const overlay = read("src/components/VideoModeOverlay.tsx");
  assert.match(overlay, /buildTimelineLanes/);
  assert.match(overlay, /layerLanes=\{selLayerLanes\}/);
  assert.match(overlay, /onKeyframeOp=\{handleKeyframeOp\}/);
  assert.match(overlay, /duplicateKeyframe/);
  assert.match(overlay, /setTweenEasing\(schema, layerId, op\.prop, op\.easing, op\.clipIndex\)/);
});
