// REQ-056 foundation: Lottie → Musa motion mapping. Run with:
// node --experimental-strip-types --test QA/lottie-import.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { mapLottieMotion } from "../shared/lottieImport.ts";
import { normalizeAnimation, sampleAnimationAt } from "../shared/animationSchema.ts";

function lottieFixture() {
  return {
    v: "5.9.0",
    fr: 30,
    ip: 0,
    op: 90,
    w: 1920,
    h: 1080,
    layers: [
      {
        nm: "title", ind: 1, ty: 5, ip: 0, op: 90,
        ks: {
          p: { a: 1, k: [
            { t: 0, s: [100, 500], o: { x: 0.42, y: 0 }, i: { x: 0.58, y: 1 } },
            { t: 30, s: [100, 400] },
          ] },
          s: { a: 0, k: [100, 100] },
          r: { a: 0, k: 0 },
          o: { a: 1, k: [
            { t: 0, s: [0], o: { x: [0.3], y: [0] }, i: { x: [0.7], y: [1] } },
            { t: 24, s: [100] },
          ] },
        },
      },
      {
        nm: "split", ind: 2, ty: 4, ip: 0, op: 90,
        ks: {
          p: { s: true, x: { a: 1, k: [{ t: 0, s: [0] }, { t: 30, s: [200] }] }, y: { a: 0, k: [300] } },
          s: { a: 0, k: [50, 50] },
          r: { a: 0, k: 0 },
          o: { a: 0, k: 80 },
        },
      },
      { nm: "child", ind: 3, ty: 4, parent: 1, ip: 0, op: 90, ks: { p: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } } },
      { nm: "matte", ind: 4, ty: 2, td: 1, ip: 0, op: 90, ks: { p: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } } },
      { nm: "ghost", ind: 5, ty: 2, ip: 0, op: 90, ks: { p: { a: 0, k: [10, 20] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 50 } } },
      { nm: "fx", ind: 6, ty: 2, ef: [{}], ip: 0, op: 90, ks: { p: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } } },
    ],
  };
}

const LAYER_MAP = { title: "layer-title", split: "layer-split" };

function importFixture() {
  return mapLottieMotion(lottieFixture(), LAYER_MAP);
}

test("mapea transform/opacity a clips con easing bezier y ventana por extent", () => {
  const { schema, mappedLayers, fidelity, warnings } = importFixture();
  assert.ok(schema, "schema debe existir");
  assert.equal(schema.timeline.durationSec, 3);
  assert.equal(schema.timeline.fps, 30);
  assert.equal(schema.timeline.width, 1920);
  assert.equal(schema.timeline.height, 1080);

  assert.equal(mappedLayers.length, 2);
  const title = mappedLayers.find(m => m.lottieLayer === "title");
  const split = mappedLayers.find(m => m.lottieLayer === "split");
  assert.ok(title?.clip && split?.clip);

  // Extent de "title" = frames 0..30 → clip [0, 1]s.
  assert.equal(title.clip.startSec, 0);
  assert.ok(Math.abs(title.clip.endSec - 1) < 1e-9);

  const transform = title.clip.tweens.find(t => t.prop === "transform");
  const opacity = title.clip.tweens.find(t => t.prop === "opacity");
  assert.ok(transform && opacity);
  assert.equal(transform.easing, "cubic-bezier(0.42, 0, 0.58, 1)");
  assert.deepEqual(transform.keyframes.map(k => k.t), [0, 1]);
  assert.equal(transform.keyframes[0].value, "translateX(100px) translateY(500px) scale(1) rotate(0deg)");
  assert.equal(transform.keyframes[1].value, "translateX(100px) translateY(400px) scale(1) rotate(0deg)");
  // Opacity termina en el frame 24 (local 0.8) y el hold extiende hasta 1.
  assert.equal(opacity.easing, "cubic-bezier(0.3, 0, 0.7, 1)");
  assert.deepEqual(opacity.keyframes.map(k => k.t), [0, 0.8, 1]);
  assert.deepEqual(opacity.keyframes.map(k => k.value), ["0", "1", "1"]);

  // "split": x animada, y/scale/opacidad estáticos → staticProps + clip lineal.
  assert.equal(split.clip.tweens.length, 1);
  assert.equal(split.clip.tweens[0].easing, "linear");
  assert.deepEqual(split.clip.tweens[0].keyframes.map(k => k.value), [
    "translateX(0px) translateY(300px) scale(0.5) rotate(0deg)",
    "translateX(200px) translateY(300px) scale(0.5) rotate(0deg)",
  ]);
  assert.deepEqual(split.staticProps, { opacity: "0.8" });
  assert.equal(title.staticProps.transform, undefined); // todo su transform anima

  const codes = warnings.map(w => w.code).sort();
  assert.ok(codes.includes("parent-chain"));
  assert.ok(codes.includes("matte"));
  assert.ok(codes.includes("unmapped-layer"));
  assert.ok(codes.includes("visual-not-imported"));
  assert.ok(codes.includes("expression"));

  const reasons = Object.fromEntries(fidelity.map(f => [f.lottieLayer, f.editability + (f.reason ? `:${f.reason}` : "")]));
  assert.equal(reasons.title, "editable");
  assert.equal(reasons.split, "editable");
  assert.equal(reasons.child, "unsupported:parent-chain");
  assert.equal(reasons.matte, "unsupported:matte");
  assert.equal(reasons.ghost, "unsupported:unmapped-layer");
});

test("el schema mapeado es estable bajo normalizeAnimation (round-trip idéntico)", () => {
  const { schema } = importFixture();
  assert.ok(schema);
  const again = normalizeAnimation(JSON.parse(JSON.stringify(schema)));
  assert.deepEqual(again, schema);
});

test("el mapeo es determinista: misma entrada → mismo JSON", () => {
  const a = importFixture();
  const b = importFixture();
  assert.equal(JSON.stringify(a.schema), JSON.stringify(b.schema));
  assert.equal(JSON.stringify(a.warnings), JSON.stringify(b.warnings));
});

test("sampleAnimationAt refleja holds de Lottie (opacity llega a 1 y queda)", () => {
  const { schema } = importFixture();
  assert.ok(schema);
  const at = t => sampleAnimationAt(schema, t).get("layer-title");
  assert.equal(at(0).opacity, "0");
  assert.equal(at(1).opacity, "1");
  assert.equal(at(1.5).opacity, "1", "hold tras el extent");
  assert.equal(at(2.9).transform, "translateX(100px) translateY(400px) scale(1) rotate(0deg)", "hold tras el segmento");
});

test("entradas malformadas no lanzan: schema null + warning accionable", () => {
  for (const bad of [null, undefined, 42, "lottie", {}, { fr: 30, layers: [] }]) {
    const res = mapLottieMotion(bad, {});
    assert.equal(res.schema, null, JSON.stringify(bad));
    assert.ok(res.warnings.some(w => w.code === "invalid-input"));
  }
});

test("layerMap por ind: alternativa cuando el nombre no es estable", () => {
  const res = mapLottieMotion(lottieFixture(), { "ind:1": "por-ind" });
  assert.ok(res.schema);
  assert.ok(res.mappedLayers.some(m => m.editorLayerId === "por-ind"));
});
