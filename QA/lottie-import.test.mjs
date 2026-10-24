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

// ── REQ-056 F3: precomps y anchor ────────────────────────────────────────

function precompFixture() {
  return {
    v: "5.9.0", fr: 30, ip: 0, op: 90, w: 1000, h: 1000,
    assets: [
      {
        id: "comp-1",
        layers: [
          { nm: "inner", ind: 1, ty: 4, ip: 0, op: 60,
            ks: {
              p: { a: 1, k: [{ t: 0, s: [100, 100] }, { t: 30, s: [200, 100] }] },
              s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 },
            } },
        ],
      },
    ],
    layers: [
      { nm: "wrap", ind: 1, ty: 0, refId: "comp-1", ip: 0, op: 90,
        ks: {
          p: { a: 0, k: [500, 500] },
          s: { a: 1, k: [{ t: 0, s: [100, 100] }, { t: 60, s: [200, 200] }] },
          r: { a: 0, k: 0 }, o: { a: 0, k: 100 },
        } },
    ],
  };
}

test("precomp: la transform del contenedor se compone sobre la hija (aplanado exacto)", () => {
  const { schema, mappedLayers, fidelity, warnings } = mapLottieMotion(precompFixture(), { "wrap/inner": "layer-x" });
  assert.ok(schema, "schema debe existir");
  assert.equal(mappedLayers.length, 1);
  assert.equal(mappedLayers[0].lottieLayer, "wrap/inner");
  const clip = mappedLayers[0].clip;
  assert.ok(clip);
  // Extent = unión de tiempos reales (hija 0..30, contenedor 0..60) → [0, 2]s.
  assert.equal(clip.startSec, 0);
  assert.ok(Math.abs(clip.endSec - 2) < 1e-9);
  const transform = clip.tweens.find(t => t.prop === "transform");
  assert.deepEqual(transform.keyframes.map(k => k.t), [0, 0.5, 1]);
  // world = T_c + R(0)·s_c·p_hija — con escala del contenedor 100%→200%.
  assert.equal(transform.keyframes[0].value, "translateX(600px) translateY(600px) scale(1) rotate(0deg)");
  assert.equal(transform.keyframes[1].value, "translateX(800px) translateY(650px) scale(1.5) rotate(0deg)");
  assert.equal(transform.keyframes[2].value, "translateX(900px) translateY(700px) scale(2) rotate(0deg)");
  assert.equal(warnings.some(w => w.code === "precomp-internals"), false, "ya no se avisa precomp-internals: se aplana");
  const reasons = Object.fromEntries(fidelity.map(f => [f.lottieLayer, f.editability]));
  assert.equal(reasons["wrap/inner"], "editable");
  // El schema mapeado sobrevive normalize y muestrea compuesto.
  const again = normalizeAnimation(JSON.parse(JSON.stringify(schema)));
  assert.deepEqual(again, schema);
  const at = t => sampleAnimationAt(schema, t).get("layer-x").transform;
  assert.equal(at(0), "translateX(600px) translateY(600px) scale(1) rotate(0deg)");
  assert.equal(at(1), "translateX(800px) translateY(650px) scale(1.5) rotate(0deg)");
  assert.equal(at(2), "translateX(900px) translateY(700px) scale(2) rotate(0deg)");
});

test("precomp: profundidad excesiva, ciclo y refId ausente se reportan sin adivinar", () => {
  const deep = {
    v: "5.9.0", fr: 30, ip: 0, op: 30, w: 100, h: 100,
    assets: [{ id: "a", layers: [{ nm: "hoja", ind: 1, ty: 2, ip: 0, op: 30, ks: { p: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } } }] }],
    layers: [
      { nm: "cap1", ind: 1, ty: 0, refId: "a", ip: 0, op: 30, ks: { p: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } } },
      { nm: "ciclo", ind: 2, ty: 0, refId: "self", ip: 0, op: 30, ks: { p: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } } },
      { nm: "fantasma", ind: 3, ty: 0, refId: "nope", ip: 0, op: 30, ks: { p: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } } },
    ],
  };
  deep.assets.push({ id: "self", layers: [{ nm: "auto", ind: 1, ty: 0, refId: "self", ip: 0, op: 30, ks: { p: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } } }] });
  const { warnings, mappedLayers } = mapLottieMotion(deep, { "cap1/hoja": "l1" });
  const codes = warnings.map(w => w.code);
  assert.ok(codes.includes("precomp-cycle"), "ciclo detectado");
  assert.ok(codes.includes("precomp-missing-ref"), "ref faltante detectada");
  assert.ok(mappedLayers.some(m => m.lottieLayer === "cap1/hoja"), "la rama válida se mapea igual");
});

test("anchor ≠ 0 estático: se pliega exacto en el translate (editable)", () => {
  const lottie = {
    v: "5.9.0", fr: 30, ip: 0, op: 30, w: 800, h: 600,
    layers: [{
      nm: "logo", ind: 1, ty: 4, ip: 0, op: 30,
      ks: {
        p: { a: 0, k: [400, 300] },
        a: { a: 0, k: [50, 25] },
        s: { a: 0, k: [200, 200] },
        r: { a: 0, k: 0 },
        o: { a: 0, k: 100 },
      },
    }],
  };
  const { schema, mappedLayers, fidelity, warnings } = mapLottieMotion(lottie, { logo: "l-logo" });
  assert.ok(schema);
  assert.equal(mappedLayers[0].staticProps.transform, "translateX(300px) translateY(250px) scale(2) rotate(0deg)", "p − R(0)·s·a = 400−100, 300−50");
  assert.equal(fidelity[0].editability, "editable", "sin rotación/escala animada el pliegue es exacto");
  assert.ok(warnings.some(w => w.code === "anchor-offset"));
});

test("anchor ≠ 0 con rotación animada: horneado en keyframes y fidelity baked", () => {
  const lottie = {
    v: "5.9.0", fr: 30, ip: 0, op: 30, w: 800, h: 600,
    layers: [{
      nm: "pivot", ind: 1, ty: 4, ip: 0, op: 30,
      ks: {
        p: { a: 0, k: [400, 300] },
        a: { a: 0, k: [50, 25] },
        s: { a: 0, k: [200, 200] },
        r: { a: 1, k: [{ t: 0, s: [0] }, { t: 30, s: [90] }] },
        o: { a: 0, k: 100 },
      },
    }],
  };
  const { schema, fidelity, warnings } = mapLottieMotion(lottie, { pivot: "l-pivot" });
  assert.ok(schema);
  const item = fidelity.find(f => f.lottieLayer === "pivot");
  assert.equal(item.editability, "baked");
  assert.equal(item.reason, "anchor-offset");
  assert.ok(warnings.some(w => w.code === "anchor-offset" && /hornea/.test(w.message)));
  const at = t => sampleAnimationAt(schema, t).get("l-pivot").transform;
  // Extremos exactos aunque el intermedio esté horneado.
  assert.equal(at(0), "translateX(300px) translateY(250px) scale(2) rotate(0deg)");
  assert.equal(at(1), "translateX(450px) translateY(200px) scale(2) rotate(90deg)");
});
