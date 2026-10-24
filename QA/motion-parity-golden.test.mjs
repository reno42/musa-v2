// REQ-055 F3 foundation: golden-frame parity for motion. Run with:
// node --experimental-strip-types --test QA/motion-parity-golden.test.mjs
//
// Pins the END-TO-END pipeline (preset builder / Lottie mapping → schema →
// sampleAnimationAt — the same sampler export uses) at control times. The
// literal strings below are the goldens: if one fails, something changed the
// motion contract and the diff shows exactly what moved. Mid-flight values
// are derived from evalBezier so an easing regression surfaces as numbers,
// not just strings.
import assert from "node:assert/strict";
import test from "node:test";
import { evalBezier, normalizeAnimation, sampleAnimationAt } from "../shared/animationSchema.ts";
import { applyMotionPresetToSchema } from "../shared/motionPresets.ts";
import { mapLottieMotion } from "../shared/lottieImport.ts";

const GOLDEN_IDENTITY = "translateX(0px) translateY(0px) scale(1) rotate(0deg)";

function combinedSchema() {
  const withRise = applyMotionPresetToSchema(null, "hero", "musa.motion.rise-in", { distPx: 64 }, { startSec: 1, endSec: 3 });
  const withFloat = applyMotionPresetToSchema(withRise, "bg", "musa.motion.float-loop", {}, { startSec: 0, endSec: 4 });
  const lottie = mapLottieMotion(
    {
      v: "5.9.0", fr: 30, ip: 0, op: 60, w: 1080, h: 1920,
      layers: [{
        nm: "title", ind: 1, ty: 5, ip: 0, op: 60,
        ks: {
          p: { a: 1, k: [
            { t: 0, s: [100, 500], o: { x: 0.42, y: 0 }, i: { x: 0.58, y: 1 } },
            { t: 30, s: [100, 400] },
          ] },
          s: { a: 0, k: [100, 100] },
          r: { a: 0, k: 0 },
          o: { a: 1, k: [{ t: 0, s: [0] }, { t: 24, s: [100] }] },
        },
      }],
    },
    { title: "layer-title" },
  );
  assert.ok(lottie.schema);
  return { schema: { ...withFloat, clips: [...withFloat.clips, ...lottie.schema.clips] }, lottie };
}

test("GOLDEN: estados exactos en tiempos de control (strings literales)", () => {
  const { schema } = combinedSchema();
  const at = (layer, t) => sampleAnimationAt(schema, t).get(layer);

  // hero — rise-in window [1,3]
  assert.equal(at("hero", 1).transform, "translateX(0px) translateY(64px) scale(1) rotate(0deg)");
  assert.equal(at("hero", 1).opacity, "0");
  assert.equal(at("hero", 3).transform, GOLDEN_IDENTITY);
  assert.equal(at("hero", 3).opacity, "1");
  assert.equal(at("hero", 0.5).transform, "translateX(0px) translateY(64px) scale(1) rotate(0deg)", "fill-both antes de la ventana");

  // bg — float-loop window [0,4]
  assert.equal(at("bg", 0).transform, GOLDEN_IDENTITY);
  assert.equal(at("bg", 2).transform, "translateX(0px) translateY(-14px) scale(1) rotate(0deg)");
  assert.equal(at("bg", 4).transform, GOLDEN_IDENTITY);

  // layer-title — clip Lottie [0,1]: p 500→400 con bezier, opacity 0→1 lineal sin handles
  assert.equal(at("layer-title", 0).transform, "translateX(100px) translateY(500px) scale(1) rotate(0deg)");
  assert.equal(at("layer-title", 1).transform, "translateX(100px) translateY(400px) scale(1) rotate(0deg)");
  // 0→1 lineal sobre el segmento real [0, 0.8]: a mitad de ventana va 0.625.
  assert.equal(at("layer-title", 0.5).opacity, "0.625", "opacity sin handles interpola lineal");
  assert.equal(at("layer-title", 0.8).opacity, "1", "fin del segmento real de opacity");
});

test("GOLDEN: la curva del medio es la del easing declarado (pipeline numérico)", () => {
  const { schema } = combinedSchema();
  const at = (layer, t) => sampleAnimationAt(schema, t).get(layer);

  // rise-in: la opacidad usa ease-out [0,0,0.58,1] y el transform
  // ease-out-expo [0.19, 1, 0.22, 1]. Cada tween sampleado a mitad de
  // ventana debe reflejar EXACTAMENTE el progreso de su propio easing.
  const mid = 1 + (3 - 1) * 0.5;
  const expo = evalBezier([0.19, 1, 0.22, 1], 0.5);
  const out = evalBezier([0, 0, 0.58, 1], 0.5);
  const gotOpacity = Number(at("hero", mid).opacity);
  assert.ok(Math.abs(gotOpacity - out) < 1e-9, `opacity ${gotOpacity} ≠ ease-out ${out}`);

  // El translateY del tween de transform recorre 64→0 con el progreso expo.
  const ty = Number(at("hero", mid).transform.match(/translateY\((-?[\d.]+)px\)/)[1]);
  assert.ok(Math.abs(ty - (64 * (1 - expo))) < 0.01, `translateY ${ty} ≠ ${64 * (1 - expo)}`);
});

test("GOLDEN: el documento combinado es determinista y estable bajo normalize", () => {
  const a = combinedSchema();
  const b = combinedSchema();
  assert.equal(JSON.stringify(a.schema), JSON.stringify(b.schema));
  const again = normalizeAnimation(JSON.parse(JSON.stringify(a.schema)));
  assert.deepEqual(again, a.schema);
});
