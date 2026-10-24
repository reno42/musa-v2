// REQ-057 foundation: preset library. Run with:
// node --experimental-strip-types --test QA/motion-presets.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  MOTION_PRESETS,
  applyMotionPresetToSchema,
  buildMotionClip,
  findMotionPreset,
  motionPresetCatalogSummary,
  sanitizeMotionParams,
} from "../shared/motionPresets.ts";
import { normalizeAnimation, sampleAnimationAt } from "../shared/animationSchema.ts";

test("catálogo: ids únicos, builders deterministas y params saneados por defecto", () => {
  const ids = new Set(MOTION_PRESETS.map(p => p.id));
  assert.equal(ids.size, MOTION_PRESETS.length);
  for (const preset of MOTION_PRESETS) {
    const defaults = sanitizeMotionParams(preset, null);
    const a = JSON.stringify(preset.build(defaults));
    const b = JSON.stringify(preset.build({ ...defaults }));
    assert.equal(a, b, `${preset.id} no es determinista`);
    for (const tween of preset.build(defaults)) {
      assert.ok(tween.keyframes.length >= 2, `${preset.id}: tween sin keyframes suficientes`);
      const ts = tween.keyframes.map(k => k.t);
      assert.deepEqual([...ts].sort((x, y) => x - y), ts, `${preset.id}: keyframes desordenados`);
      for (const kf of tween.keyframes) assert.equal(typeof kf.value, "string");
    }
  }
  assert.ok(motionPresetCatalogSummary().length === MOTION_PRESETS.length);
});

test("sanitizeMotionParams: clampea rangos, valida enums y descarta desconocidos", () => {
  const preset = findMotionPreset("musa.motion.rise-in");
  assert.ok(preset);
  const clamped = sanitizeMotionParams(preset, { distPx: 9999, hack: "alert(1)" });
  assert.equal(clamped.distPx, 480);
  assert.equal("hack" in clamped, false);
  const nan = sanitizeMotionParams(preset, { distPx: "abc" });
  assert.equal(nan.distPx, 64, "no numérico cae al default");
  const kebab = findMotionPreset("musa.motion.ken-burns-in");
  assert.ok(kebab);
  const over = sanitizeMotionParams(kebab, { toScale: 99 });
  assert.equal(over.toScale, 1.6);
});

test("buildMotionClip: ventana saneada y clip con instanceId opcional", () => {
  const { clip } = buildMotionClip("musa.motion.rise-in", { distPx: 100 }, { startSec: 1, endSec: 3 });
  assert.equal(clip.startSec, 1);
  assert.equal(clip.endSec, 3);
  assert.equal(clip.layerId, "");
  const tiny = buildMotionClip("musa.motion.rise-in", {}, { startSec: 5, endSec: 5 });
  assert.ok(tiny.clip.endSec - tiny.clip.startSec >= 0.1 - 1e-9, "ventana mínima 0.1s (épsilon por punto flotante)");
  assert.throws(() => buildMotionClip("musa.motion.nope", {}), /desconocido/);
});

test("applyMotionPresetToSchema: reemplaza su propio clip, es idempotente y sobrevive normalize", () => {
  const applied1 = applyMotionPresetToSchema(null, "hero", "musa.motion.rise-in", { distPx: 80 }, { startSec: 1, endSec: 3 });
  assert.equal(applied1.clips.length, 1);
  assert.equal(applied1.clips[0].instanceId, "musa.motion.rise-in:hero");
  assert.equal(applied1.instances?.[0].params.distPx, 80);

  const applied2 = applyMotionPresetToSchema(applied1, "hero", "musa.motion.rise-in", { distPx: 120 }, { startSec: 1, endSec: 3 });
  assert.equal(applied2.clips.length, 1, "re-aplicar no duplica clips");
  assert.equal(applied2.clips[0].tweens[0].keyframes[0].value, "translateX(0px) translateY(120px) scale(1) rotate(0deg)");

  // Otro preset en otra capa no toca el clip del primero.
  const applied3 = applyMotionPresetToSchema(applied2, "bg", "musa.motion.float-loop", {}, { startSec: 0, endSec: 4 });
  assert.equal(applied3.clips.length, 2);
  assert.equal(applied3.clips.find(c => c.layerId === "hero").instanceId, "musa.motion.rise-in:hero");

  const stable = normalizeAnimation(JSON.parse(JSON.stringify(applied3)));
  assert.deepEqual(stable, applied3);
});

test("muestreo: la entrada empieza en el estado inicial y termina en el final", () => {
  const schema = applyMotionPresetToSchema(null, "hero", "musa.motion.rise-in", { distPx: 64 }, { startSec: 1, endSec: 3 });
  const at = t => sampleAnimationAt(schema, t).get("hero");
  assert.equal(at(1).transform, "translateX(0px) translateY(64px) scale(1) rotate(0deg)");
  assert.equal(at(1).opacity, "0");
  assert.equal(at(3).transform, "translateX(0px) translateY(0px) scale(1) rotate(0deg)");
  assert.equal(at(3).opacity, "1");
  // fill-both: antes y después de la ventana el estado se mantiene.
  assert.equal(at(0.5).opacity, "0");
  assert.equal(at(3.5).opacity, "1");
});

test("loops: los bucles vuelven al valor identity en el fin de ventana", () => {
  for (const id of ["musa.motion.pulse-loop", "musa.motion.float-loop", "musa.motion.wobble-loop"]) {
    const schema = applyMotionPresetToSchema(null, "x", id, {}, { startSec: 0, endSec: 2 });
    const at = t => sampleAnimationAt(schema, t).get("x").transform;
    assert.equal(at(0), at(2), `${id} no cierra el loop`);
  }
});
